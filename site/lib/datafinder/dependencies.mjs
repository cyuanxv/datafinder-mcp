import {z} from 'zod/v4';
import {APP,PROJECT,QueryError,extractDSL,parseLossless,assertScope} from './core.mjs';
import {dashboardCatalog,dashboardAssociations} from './dashboard.mjs';
import {sqlReference} from './sql-references.mjs';
import {resolveStaticSql} from './sql-dependencies.mjs';
import {configHash} from './config-hash.mjs';
export const dependencyShape={kind:z.enum(['virtual_events','virtual_params']),name:z.string().min(1).max(120).regex(/^[\w$.-]+$/),page:z.number().int().min(1).max(1000).default(1),catalog_version:z.string().length(64).optional(),metadata_version:z.string().length(64).optional(),max_pages:z.number().int().min(1).max(10).default(1),max_depth:z.number().int().min(1).max(10).default(5)};
// Exact structured references only. SQL text is a candidate, never a proven dependency.
export function references(value,name,kind){let exact=false,sql=false;function walk(v){if(!v||typeof v!=='object')return;for(const [k,x] of Object.entries(v)){if((k==='event_name'&&kind!=='virtual_params'||k==='property_name'&&kind!=='virtual_events')&&x===name)exact=true;if(['sql','sql_rule','sql_query'].includes(k)&&typeof x==='string'&&sqlReference(x,name,kind).candidate)sql=true;if(((kind!=='virtual_events'&&['relation_user_profile_properties','relation_event_param_properties'].includes(k))||(kind!=='virtual_params'&&k==='relation_event_names'))&&Array.isArray(x)&&x.includes(name))exact=true;if(typeof x==='object')walk(x);}}walk(value);return {exact,sql};}
export function dependencyClosure(objects,target,maxDepth){
 const affected=new Map([[target.kind+':'+target.name,{...target,depth:0,chain:[]}]]);let changed=true;
 while(changed){changed=false;for(const object of objects){const key=object.kind+':'+object.name;if(affected.has(key))continue;for(const parent of affected.values()){if(parent.depth>=maxDepth)continue;if(references(object.value,parent.name,parent.kind).exact){affected.set(key,{kind:object.kind,name:object.name,id:object.id,depth:parent.depth+1,chain:[...parent.chain,{kind:parent.kind,name:parent.name}]});changed=true;break;}}}}
 const depthLimited=objects.some(o=>!affected.has(o.kind+':'+o.name)&&[...affected.values()].some(p=>p.depth===maxDepth&&references(o.value,p.name,p.kind).exact));
 return {affected:[...affected.values()],depthLimited};
}
export async function scanDependencies(api,input){
 const a=z.object(dependencyShape).strict().parse(input),boards=(await dashboardCatalog(api)).sort((x,y)=>x.id.localeCompare(y.id));
 const cv=await configHash(boards.map(x=>x.id));if(a.page>1&&!a.catalog_version)throw new QueryError('INVALID_ARGUMENT','后续页必须携带catalog_version。');if(a.catalog_version&&a.catalog_version!==cv)throw new QueryError('VERSION_CONFLICT','看板目录已变化，请从第一页重扫。');
 const matches=[],unknown=[],failed=[],objects=[],scanned=new Set(),scannedBoards=[],emptyBoards=[],sqlChecks=[];let associationsIncomplete=false;
 for(const kind of ['virtual_events','virtual_params']){try{const r=await api.request('POST',`/openapi/v1/metadata/${APP}/list/${kind}`,{});if(!Array.isArray(r.data))throw new Error();for(const x of r.data){if(String(x.project_id)!==PROJECT||!(x.relation_app_ids??[]).map(String).includes(APP)){unknown.push({kind,reason:'out_of_scope_metadata'});continue;}objects.push({kind,name:x.name,id:String(x.id),value:x});}}catch{failed.push({kind,code:'METADATA_SCAN_FAILED'});}}
 const metadataVersion=await configHash(objects);if(a.metadata_version&&a.metadata_version!==metadataVersion)throw new QueryError('VERSION_CONFLICT','虚拟元数据已变化，请从第一页重扫。');
 const closure=dependencyClosure(objects,a,a.max_depth);
 for(const x of closure.affected.filter(x=>x.depth>0))matches.push({type:x.kind,id:x.id,name:x.name,match:'structured_reference',direct:x.depth===1,depth:x.depth,chain:x.chain});
 for(const o of objects){const refs=references(o.value,a.name,a.kind);if(refs.sql&&!closure.affected.some(x=>x.kind===o.kind&&x.name===o.name))matches.push({type:o.kind,id:o.id,name:o.name,match:'sql_lexical_candidate',direct:'unverified'});}
 const start=(a.page-1)*3,end=Math.min(start+a.max_pages*3,boards.length);let cursor=start;
 for(;cursor<end;cursor++){
  if(api.deadline-Date.now()<15000){unknown.push({reason:'scan_deadline',next_dashboard_index:cursor});break;}
  const b=boards[cursor];scannedBoards.push(b.id);
  try{const assoc=await dashboardAssociations(api,b.id);if(assoc.verified_empty)emptyBoards.push(b.id);if(assoc.reports.length<(assoc.available??assoc.total??assoc.reports.length)||Number(assoc.denied??0)>0)associationsIncomplete=true;
   for(const report of assoc.reports){const id=String(report.report_id);if(scanned.has(id))continue;scanned.add(id);if(!Array.isArray(report.dsls)||!report.dsls.length){unknown.push({report_id:id,reason:'definition_missing'});continue;}
    for(const d of report.dsls){try{let content,sqlResolution;if(report.report_type==='custom_sql_query'){const raw=typeof d.dsl_content==='string'?parseLossless(d.dsl_content):d.dsl_content;if(String(report.app_id)!==PROJECT||String(d.app_id)!==PROJECT||raw?.version!==3)throw Error();assertScope({resources:[{project_ids:[PROJECT],app_ids:raw.app_ids}]},api.env.DATAFINDER_ALLOW_PROJECT_WIDE==='true');content=raw;const resolved=sqlResolution=resolveStaticSql(raw);if(!resolved.resolved)unknown.push({report_id:id,reason:resolved.reason});else{sqlChecks.push({report_id:id,definition_version:await configHash(raw),...resolved});const collisions=objects.filter(o=>o.kind==='virtual_events'?resolved.event_names.includes(o.name):resolved.property_names.includes(o.name));if(collisions.length)unknown.push({report_id:id,reason:'sql_virtual_resolution_unverified'});}}else content=extractDSL({...report,dsls:[d]},api.env.DATAFINDER_ALLOW_PROJECT_WIDE==='true',true).content;
     for(const target of closure.affected){const refs=sqlResolution?.resolved?{exact:false,sql:(target.kind==='virtual_events'?sqlResolution.event_names:sqlResolution.property_names).includes(target.name)}:references(content,target.name,target.kind);if(refs.exact||refs.sql)matches.push({type:'report',id,name:report.report_name??id,dashboard_id:b.id,match:refs.exact?'structured_reference':'sql_lexical_candidate',direct:refs.exact?target.depth===0:'unverified',depth:target.depth+1,chain:[...target.chain,{kind:target.kind,name:target.name}]});}
    }catch{unknown.push({report_id:id,reason:'scope_or_definition_unverified'});}}
   }
  }catch(e){failed.push({dashboard_id:b.id,code:e instanceof QueryError?e.code:'SCAN_FAILED'});}
 }
 // Round down on interruption so resuming cannot skip a partly scanned page. Deduplicate on aggregation.
 const hasMore=cursor<boards.length,nextPage=hasMore?Math.floor(cursor/3)+1:null;
 const unique=values=>[...new Map(values.map(x=>[JSON.stringify(x),x])).values()];
 const allMatches=unique(matches),allUnknown=unique(unknown),omitted={matches:Math.max(0,allMatches.length-500),unknown:Math.max(0,allUnknown.length-500)};
 return {target:{kind:a.kind,name:a.name,found:objects.some(o=>o.kind===a.kind&&o.name===a.name)},project_id:PROJECT,app_id:APP,catalog_version:cv,metadata_version:metadataVersion,page:a.page,max_pages:a.max_pages,next_page:nextPage,has_more:hasMore,scanned_dashboard_ids:scannedBoards,verified_empty_dashboard_ids:emptyBoards,sql_dependency_checks:unique(sqlChecks),visible_dashboard_count:boards.length,scanned_report_count:scanned.size,scanned_report_ids:[...scanned],scanned_virtual_objects:objects.length,matches:allMatches.slice(0,500),unknown:allUnknown.slice(0,500),omitted,failed,coverage:'partial',page_complete:!failed.length&&!unknown.length&&!associationsIncomplete&&!closure.depthLimited&&!omitted.matches&&!omitted.unknown,transitive:{max_depth:a.max_depth,depth_limited:closure.depthLimited},limitations:['批量合并最多10页（30看板），去重报表；未关联或不可见报表仍未覆盖。','传递链仅使用结构化引用；SQL词法候选区分标识符、注释和字符串，不保证语义解析。','目录指纹只固定目录；定义可能在扫描期间变化。预算中断续扫可能重复本页，不会跳过未扫项。','无匹配不等于无影响；外部客户端、动态SQL和深度上限之外的依赖未知。']};
}
