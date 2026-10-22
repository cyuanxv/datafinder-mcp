import {z} from 'zod/v4';
import {mappingSchema,checkedMapping,trackingMapping} from './tracking-mapping.mjs';
import {database,record} from './governance.mjs';
import {configHash} from './config-hash.mjs';
import {diffValues} from './editor.mjs';
import {QueryError} from './core.mjs';
const key=z.string().min(1).max(80).regex(/^[\w.-]+$/);
export const mappingImportShape={action:z.enum(['preview','apply']),candidates:z.array(z.object({key,expected_revision:z.number().int().min(0),definition:mappingSchema}).strict()).min(1).max(5),preview_hash:z.string().regex(/^[a-f0-9]{64}$/).optional(),confirmed:z.literal(true).optional()};
const fail=(c,m)=>{throw new QueryError(c,m);};
export async function mappingImport(api,input,owner){
 const a=z.object(mappingImportShape).strict().parse(input),db=database(api,owner);
 if(new Set(a.candidates.map(c=>c.key)).size!==a.candidates.length)fail('INVALID_ARGUMENT','同一导入不能重复映射标识。');
 const rows=await db.prepare("SELECT g.* FROM governance_records g WHERE owner=? AND kind IN ('template','analysis_schedule','analysis_session') AND revision=(SELECT MAX(revision) FROM governance_records v WHERE v.owner=g.owner AND v.kind=g.kind AND v.record_key=g.record_key) ORDER BY kind,record_key LIMIT 501").bind(owner).all();
 const configs=rows.results.slice(0,500).map(r=>({kind:r.kind,key:r.record_key,revision:r.revision,value:JSON.parse(r.body)}));
 const items=[];
 for(const c of a.candidates){const definition=checkedMapping(c.definition);let before=null;try{before=await record(api,owner,'tracking_mapping',c.key);}catch(e){if(e.code!=='NOT_FOUND')throw e;}
  if((before?.revision??0)!==c.expected_revision)fail('VERSION_CONFLICT',`映射 ${c.key} 已变化，请重新预览。`);
  const templates=configs.filter(r=>r.kind==='template'&&r.value.kind==='mapped'&&r.value.config.key===c.key);
  const impacts=configs.filter(r=>templates.includes(r)||r.kind==='analysis_schedule'&&(r.value.mapping_key===c.key||templates.some(t=>t.key===r.value.template_key))).map(r=>({kind:r.kind,key:r.key,revision:r.revision,behavior:'pinned_version_unchanged_requires_explicit_upgrade'}));
  items.push({...c,definition,differences:diffValues(before?.value.definition??{},definition),impacts});
 }
 const preview={items,impact_coverage:rows.results.length>500?'partial':'latest_templates_and_analysis_plans_only',limitations:['仅结构化候选映射，不自动解释整份Excel；来源摘要由提交者提供，发布前仍需实时元数据校验。','未出现的映射保留，不推断删除；固定模板和计划不自动升级；临时查询和外部调用不在影响目录内。'],data_deleted:false};
 const hash=await configHash({owner,items});
 if(a.action==='preview')return {status:'preview',...preview,preview_hash:hash};
 if(!a.confirmed||a.preview_hash!==hash)fail('VERSION_CONFLICT','需要确认当前差异预览；内容或依赖变化须重新预览。');
 const results=[];for(const c of items){try{const r=await trackingMapping(api,{action:'save',key:c.key,expected_revision:c.expected_revision,definition:c.definition,confirmed:true},owner);results.push({key:c.key,status:'saved_draft',revision:r.revision});}catch(e){results.push({key:c.key,status:'failed',code:e instanceof QueryError?e.code:'SAVE_FAILED'});}}
 return {status:results.every(r=>r.status==='saved_draft')?'saved_drafts':'partial',items:results,publication:'not_published',atomic:false,data_deleted:false};
}
