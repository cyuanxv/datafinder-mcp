import {sqlOutputColumns} from './sql-columns.mjs';
import {z} from 'zod/v4';
import {QueryError} from './core.mjs';
import {database,record} from './governance.mjs';
import {metricSource,dictionaryCatalog,sourceFromReport} from './dictionary-source.mjs';
import {configHash} from './config-hash.mjs';
import {metricDefinition} from './definitions.mjs';
export const adviceLabels={ready:'可以直接使用',caution:'使用时需要注意',pending:'数据还在核对',paused:'数据有误，暂停使用'};
const text=z.string().trim().min(1).max(2000),optionalText=z.string().max(4000).default(''),key=z.string().regex(/^[\w.-]{1,80}$/),rid=z.string().regex(/^[1-9][0-9]{15,19}$/),hash=z.string().regex(/^[a-f0-9]{64}$/);
export const dictionaryMetricSchema=z.object({schema_version:z.literal(2),name:text,aliases:z.array(z.string().trim().min(1).max(100)).max(20).default([]),business:text,meaning:text,population:text,filters:optionalText,numerator:text,denominator:text,formula:optionalText,identity_rule:text,unit:text,time_basis:text,timezone:z.literal('Asia/Shanghai'),maturity:optionalText,limitations:optionalText,similar_metrics:optionalText,unresolved:optionalText,notes:optionalText,recommendation:z.enum(['ready','caution','pending','paused']),recommendation_reason:text,change_reason:text,sources:z.array(z.object({report_id:rid,source_version:hash,selector:text,metric_index:z.number().int().min(0).max(99).optional()}).strict()).max(10),default_report_id:rid.nullable()}).strict().superRefine((v,c)=>{if(new Set(v.sources.map(s=>s.report_id)).size!==v.sources.length)c.addIssue({code:'custom',message:'同一指标的来源报表不可重复，请在指标选择说明中列出所需项。'});if(v.sources.length?!v.sources.some(s=>s.report_id===v.default_report_id):v.default_report_id!==null)c.addIssue({code:'custom',message:'有来源时必须指定其中一个默认来源。'});if(v.recommendation==='ready'&&!v.sources.length)c.addIssue({code:'custom',message:'可直接使用的指标需要已核验来源。'});});
export const dictionaryShape={action:z.enum(['list','read','history','source','catalog','preview_import','save','save_batch']),key:key.optional(),revision:z.number().int().positive().optional(),keyword:z.string().max(200).default(''),business:z.string().max(200).optional(),dashboard_id:rid.optional(),source_type:z.enum(['report','saved_sql','manual']).optional(),recommendation:z.enum(['ready','caution','pending','paused']).optional(),page:z.number().int().min(1).max(10000).default(1),page_size:z.number().int().min(1).max(50).default(20),report_id:rid.optional(),dashboard_ids:z.array(rid).min(1).max(5).optional(),metric:dictionaryMetricSchema.optional(),expected_revision:z.number().int().min(0).optional(),confirmed:z.literal(true).optional(),preview_hash:hash.optional(),items:z.array(z.object({key,expected_revision:z.number().int().min(0),metric:dictionaryMetricSchema,preview_hash:hash}).strict()).min(1).max(10).optional()};
export function normalizeMetric(v){if(v.schema_version===2)return v;return {schema_version:2,name:v.name,aliases:v.aliases??[],business:'待分类',meaning:v.meaning,population:'待核对',filters:'',numerator:v.numerator,denominator:v.denominator,formula:'',identity_rule:v.identity_rule,unit:v.unit,time_basis:'待核对',timezone:'Asia/Shanghai',maturity:'待核对',limitations:v.notes??'',similar_metrics:'',unresolved:'历史版本尚未完成业务使用建议审核。',notes:v.notes??'',recommendation:'pending',recommendation_reason:'历史保存不代表已核对数据。',change_reason:'兼容读取旧记录，未修改存储。',sources:[{report_id:v.report_id,source_version:v.source_version,selector:'历史报表口径，需明确所选指标'}],default_report_id:v.report_id,source_snapshots:[],legacy:true};}
const rowRecord=r=>({key:r.record_key,revision:r.revision,created_at:r.created_at,value:normalizeMetric(JSON.parse(r.body))});
const indexRows=async(db,owner)=>(await db.prepare("SELECT g.* FROM governance_records g WHERE owner=? AND kind='metric' AND revision=(SELECT MAX(revision) FROM governance_records v WHERE v.owner=g.owner AND v.kind=g.kind AND v.record_key=g.record_key) ORDER BY record_key").bind(owner).all()).results.map(rowRecord);
function sourcesIndex(v){return v.source_snapshots??[];}
export function filterMetrics(rows,a){return rows.filter(r=>{const v=r.value;return (!a.keyword||[r.key,v.name,...v.aliases].join(' ').toLowerCase().includes(a.keyword.toLowerCase()))&&(!a.business||v.business===a.business)&&(!a.recommendation||v.recommendation===a.recommendation)&&(!a.dashboard_id||sourcesIndex(v).some(s=>s.dashboards.some(b=>b.id===a.dashboard_id)))&&(!a.source_type||(a.source_type==='manual'?!v.sources.length:sourcesIndex(v).some(s=>s.source_type===a.source_type)));});}
async function prepareSave(api,a,owner){
 if(!a.key||a.expected_revision===undefined||!a.metric)throw new QueryError('INVALID_ARGUMENT','保存需要 key、expected_revision 和完整指标。');
 const metric=dictionaryMetricSchema.parse(a.metric),snapshots=[];
 for(const s of metric.sources){const now=await metricSource(api,s.report_id);if(now.catalog_complete===false)throw new QueryError('INCOMPLETE_CATALOG','来源目录未完整读取，暂不保存以免丢失看板关联。');if(now.source_version!==s.source_version)throw new QueryError('VERSION_CONFLICT','来源配置已变化，请重新读取并核对指标。');if(s.metric_index!==undefined&&!now.metric_choices.some(m=>m.metric_index===s.metric_index))throw new QueryError('INVALID_ARGUMENT','所选指标不在来源候选中，请重新选择。');snapshots.push(now);}
 if(a.expected_revision>0){const old=await record(api,owner,'metric',a.key);if(old.revision!==a.expected_revision)throw new QueryError('VERSION_CONFLICT','指标版本已更新。');}
 const preview_hash=await configHash({key:a.key,expected_revision:a.expected_revision,metric,owner});
 return {preview_hash,value:{...metric,source_snapshots:snapshots,last_verified_at:snapshots.length?new Date().toISOString():null,verification_scope:'仅来源范围与配置版本，业务建议由用户确认。',editor:owner}};
}
async function save(api,a,owner){
 const db=database(api,owner),p=await prepareSave(api,a,owner);
 if(!a.confirmed)return {status:'preview',key:a.key,expected_revision:a.expected_revision,...p,datafinder_modified:false,saved:false};
 if(a.preview_hash!==p.preview_hash)throw new QueryError('PREVIEW_CHANGED','先预览完整内容，确认后传回该 preview_hash；内容改变必须重新预览。');
 const body=JSON.stringify(p.value);if(body.length>160000)throw new QueryError('RESULT_TOO_LARGE','来源配置过大，请拆分指标。');
 const r=await db.prepare('INSERT INTO governance_records (owner,kind,record_key,revision,body,created_at) SELECT ?,?,?,?,?,? WHERE COALESCE((SELECT MAX(revision) FROM governance_records WHERE owner=? AND kind=? AND record_key=?),0)=?').bind(owner,'metric',a.key,a.expected_revision+1,body,Date.now(),owner,'metric',a.key,a.expected_revision).run();
 if(r.meta?.changes!==1)throw new QueryError('VERSION_CONFLICT','指标已变化或标识已存在；请读取最新版本。');
 const result=await record(api,owner,'metric',a.key);if(await configHash(result.value)!==await configHash(p.value))throw new QueryError('READBACK_MISMATCH','已保存但回读不一致，请勿重复保存。');
 return {...result,status:'saved',readback_verified:true,datafinder_modified:false};
}
export async function metricDictionary(api,input,owner){
 const a=z.object(dictionaryShape).strict().parse(input),db=database(api,owner);
 // Cache the definition catalogue within this invocation only; never across requests.
 const context=Object.create(api);context._dictionaryCatalog=undefined;
 const rows=()=>indexRows(db,owner);
 if(a.action==='source'){if(!a.report_id)throw new QueryError('INVALID_ARGUMENT','需要 report_id。');return metricSource(context,a.report_id);}
 if(a.action==='save')return save(context,a,owner);
 if(a.action==='save_batch'){
  if(!a.confirmed||!a.items)throw new QueryError('INVALID_ARGUMENT','批量保存需确认已逐项预览的内容。');
  if(new Set(a.items.map(i=>i.key)).size!==a.items.length)throw new QueryError('INVALID_ARGUMENT','批次指标标识重复。');
  const items=[];for(const i of a.items){try{const r=await save(context,{...i,confirmed:true},owner);items.push({key:i.key,status:r.status,revision:r.revision,readback_verified:r.readback_verified});}catch(e){items.push({key:i.key,status:'failed',code:e.code??'INVALID_ARGUMENT'});}}return {status:items.every(i=>i.status==='saved')?'saved':'partial',items,datafinder_modified:false};
 }
 if(a.action==='list'){
  const all=await rows(),filtered=filterMetrics(all,a),counts={all:all.length,ready:0,caution:0,pending:0,paused:0};for(const r of all)counts[r.value.recommendation]++;
  return {counts,count_scope:'本人全部指标的最新版本；非报表数或历史版本数',matched_count:filtered.length,page:a.page,has_more:a.page*a.page_size<filtered.length,items:filtered.slice((a.page-1)*a.page_size,a.page*a.page_size).map(r=>({...r,value:{...r.value,source_snapshots:sourcesIndex(r.value).map(({definitions,...s})=>s)},source_status:'not_checked'})),facets:{businesses:[...new Set(all.map(r=>r.value.business))],dashboards:[...new Map(all.flatMap(r=>sourcesIndex(r.value).flatMap(s=>s.dashboards)).map(b=>[b.id,b])).values()]},fallback:filtered.length?'先 read 核对默认来源和变化，再用现有查询工具；暂停或来源变化不得直接采用。':'没有匹配的正式指标；可另行分析，但必须说明未采用正式指标口径。'};
 }
 if(a.action==='read'){
  if(!a.key)throw new QueryError('INVALID_ARGUMENT','需要指标标识。');const r=await record(api,owner,'metric',a.key,a.revision),v=normalizeMetric(r.value),checks=[];
  for(const s of v.sources){try{const now=await metricSource(context,s.report_id);checks.push({report_id:s.report_id,status:now.source_version===s.source_version?'unchanged':'drifted',current_source_version:now.source_version,date_capability:now.date_capability,source_type:now.source_type});}catch(e){checks.push({report_id:s.report_id,status:'unknown',code:e.code??'UPSTREAM_ERROR'});}}
  const usable=['ready','caution'].includes(v.recommendation)&&v.sources.length>0&&checks.every(c=>c.status==='unchanged');
  return {...r,value:v,checked_at:new Date().toISOString(),source_checks:checks,source_status:checks.some(c=>c.status==='drifted')?'drifted':checks.some(c=>c.status==='unknown')?'unknown':checks.length?'unchanged':'unbound',execution_guidance:{may_use_source:usable,business_approved:['ready','caution'].includes(v.recommendation),default_report_id:v.default_report_id,tool:checks.find(c=>c.report_id===v.default_report_id)?.source_type==='saved_sql'?'saved_sql':'run_analysis',warnings:['使用前展示使用建议、限制与成熟窗口；技术检查通过不代表业务正确。','SQL 不接收调用方日期；按保存 SQL 自带的日期逻辑查询。','默认来源不可用时，需明确选择备用来源并说明，不能静默切换。']}};
 }
 if(a.action==='history'){
  if(!a.key)throw new QueryError('INVALID_ARGUMENT','需要指标标识。');const result=await db.prepare("SELECT * FROM governance_records WHERE owner=? AND kind='metric' AND record_key=? ORDER BY revision DESC LIMIT ? OFFSET ?").bind(owner,a.key,a.page_size+1,(a.page-1)*a.page_size).all();return {items:result.results.slice(0,a.page_size).map(rowRecord),has_more:result.results.length>a.page_size,page:a.page};
 }
 const catalog=await dictionaryCatalog(context,a.dashboard_ids??(a.dashboard_id?[a.dashboard_id]:undefined));
 if(a.action==='catalog'){const items=catalog.entries.map(e=>({report_id:String(e.report.report_id),name:e.report.report_name,type:e.report.report_type,dashboards:e.dashboards})).filter(r=>!a.keyword||(`${r.name} ${r.report_id}`).toLowerCase().includes(a.keyword.toLowerCase()));return {...catalog,entries:undefined,items:items.slice((a.page-1)*a.page_size,a.page*a.page_size),has_more:a.page*a.page_size<items.length,matched_count:items.length};}
 if(a.action==='preview_import'){
  if(!a.dashboard_ids)throw new QueryError('INVALID_ARGUMENT','预览需明确看板 ID 列表。');const existing=await rows(),candidates=[],failed=[];
  for(const e of catalog.entries){try{const source=await sourceFromReport(e.report,api.env.DATAFINDER_ALLOW_PROJECT_WIDE==='true',e.dashboards);const extracted=[];
    if(source.source_type==='report')for(let i=0;i<e.report.dsls.length;i++){const d=await metricDefinition({...e.report,dsls:[e.report.dsls[i]]},source.report_id,api.env.DATAFINDER_ALLOW_PROJECT_WIDE==='true');extracted.push(...d.metrics.map((m,j)=>({selector:`DSL ${i+1} / 指标 ${j+1}: ${m.name??m.label??'待核对'}`,definition:m})));}
    if(source.source_type==='saved_sql')source.definitions.forEach((d,i)=>extracted.push(...sqlOutputColumns(d.sql).map(c=>({selector:`SQL ${i+1} / 输出列 ${c.name}（候选，需区分维度与指标）`,definition:c}))));
    candidates.push({source:{...source,definitions:undefined},metric_candidates:extracted,requires_manual_split:source.source_type==='saved_sql'||!extracted.length,existing_metrics:existing.filter(r=>r.value.sources.some(s=>s.report_id===source.report_id)).map(r=>({key:r.key,name:r.value.name,selectors:r.value.sources.filter(s=>s.report_id===source.report_id).map(s=>s.selector)})),suggested_recommendation:'pending',reason:'仅提取定义，不证明业务正确。SQL 需按输出指标人工拆分；同一报表可对应多个指标。'});
   }catch(e2){failed.push({report_id:String(e.report.report_id),code:e2.code??'UNVERIFIED_CONTRACT'});}}
  return {status:'preview_only',saved:false,datafinder_modified:false,unique_reports:catalog.entries.length,association_count:catalog.entries.reduce((n,e)=>n+e.dashboards.length,0),candidates,complete:catalog.complete&&!failed.length,failed_reports:failed,failed_dashboards:catalog.failed_dashboards,warning:'报表数不等于指标数；预览不会保存。选择指标、补充业务口径后逐项预览，确认再保存。'};
 }
}
