import {z} from 'zod/v4';
import {QueryError,dateRange} from './core.mjs';
import {configHash} from './config-hash.mjs';
import {metricDictionary} from './dictionary.mjs';
import {parseDraft,validateDraft,diffValues} from './editor.mjs';
import {database,record} from './governance.mjs';
import {queryTemplate} from './templates.mjs';
import {runAnalysis,freePlan,queryReportAdaptive} from './analysis.mjs';
import {runAdvanced,advancedPlan} from './advanced.mjs';
import {runDistribution,validateDistribution} from './distribution.mjs';
import {runFunnel,funnelPlan} from './funnel.mjs';
const binding=z.object({key:z.string().min(1).max(80),revision:z.number().int().positive()}).strict();
const definition=z.object({template:z.record(z.string(),z.unknown()).optional(),template_ref:binding.optional(),start_date:z.string(),end_date:z.string(),dictionary:binding.optional()}).strict();
export const workflowSchema=z.object({operation:z.enum(['preview','save','read','templates','records','history']).default('preview'),revision:z.number().int().positive().optional(),session_key:z.string().regex(/^[\w.-]{1,80}$/).optional(),expected_revision:z.number().int().min(0).optional(),confirmed:z.literal(true).optional(),keyword:z.string().max(100).default(''),page:z.number().int().min(1).max(1000).default(1),definition:definition.optional(),changes:z.object({config:z.record(z.string(),z.unknown()).optional(),start_date:z.string().optional(),end_date:z.string().optional()}).strict().optional(),execute:z.boolean().default(false),preview_hash:z.string().length(64).optional()}).strict();
// Stateless continuation: callers carry the complete canonical definition. No hidden defaults from prior chats.
export async function queryWorkflow(api,input,owner,deps={}){
 const a=workflowSchema.parse(input);
 if(['records','history'].includes(a.operation)){
  if(a.execute||a.definition||a.changes)throw new QueryError('INVALID_ARGUMENT','查询记录目录不能同时执行或改动。');
  const db=database(api,owner);
  if(a.operation==='history'){
   if(!a.session_key)throw new QueryError('INVALID_ARGUMENT','请指定查询记录名称。');
   const r=await db.prepare('SELECT revision,created_at FROM governance_records WHERE owner=? AND kind=? AND record_key=? ORDER BY revision DESC LIMIT 21 OFFSET ?').bind(owner,'query_workflow',a.session_key,(a.page-1)*20).all();
   return {session_key:a.session_key,page:a.page,items:r.results.slice(0,20),has_more:r.results.length>20,persisted:false};
  }
  const r=await db.prepare("SELECT g.record_key,g.revision,g.created_at FROM governance_records g WHERE owner=? AND kind=? AND instr(lower(record_key),lower(?))>0 AND revision=(SELECT MAX(v.revision) FROM governance_records v WHERE v.owner=g.owner AND v.kind=g.kind AND v.record_key=g.record_key) ORDER BY record_key LIMIT 21 OFFSET ?").bind(owner,'query_workflow',a.keyword,(a.page-1)*20).all();
  return {page:a.page,items:r.results.slice(0,20).map(r=>({key:r.record_key,revision:r.revision,created_at:r.created_at})),has_more:r.results.length>20,persisted:false};
 }
 if(a.operation==='templates')return queryTemplate(api,{action:'list',keyword:a.keyword,page:a.page},owner);
 if(a.operation==='read'){
  if(!a.session_key)throw new QueryError('INVALID_ARGUMENT','请指定查询记录名称。');
  if(a.execute||a.definition||a.changes)throw new QueryError('INVALID_ARGUMENT','读取记录不能同时执行或改动。');
  const saved=await record(api,owner,'query_workflow',a.session_key,a.revision);
  return {...saved,persisted:true,note:'历史配置；执行前需重新预览和检查来源。'};
 }
 if(!a.definition)throw new QueryError('INVALID_ARGUMENT','请提供完整查询或已保存模板引用。');
 const before=structuredClone(a.definition),d=structuredClone(before);
 if(d.template_ref){
  const saved=await (deps.template??queryTemplate)(api,{action:'read',key:d.template_ref.key},owner);
  if(saved.revision!==d.template_ref.revision||saved.source_status==='drifted')throw new QueryError('VERSION_CONFLICT','已保存的公式或模板发生变化，请重新选择。');
  const {name,...template}=saved.value;
  if(d.template&&JSON.stringify(parseDraft('template',d.template))!==JSON.stringify(parseDraft('template',template)))throw new QueryError('VERSION_CONFLICT','模板内容与引用版本不一致；修改后请解除引用再预览。');
  d.template=template;
 }
 if(!d.template)throw new QueryError('INVALID_ARGUMENT','缺少查询模板。');
 // Applying a follow-up creates an explicit derivative, leaving the saved template untouched.
 if(a.changes&&d.template_ref)delete d.template_ref;
 if(a.changes){if(!Object.keys(a.changes).length)throw new QueryError('INVALID_ARGUMENT','追问必须明确字段改动。');
  if(a.changes.config)d.template.config={...d.template.config,...a.changes.config};
  for(const k of ['start_date','end_date'])if(a.changes[k]!==undefined)d[k]=a.changes[k];
 }
 d.template=parseDraft('template',d.template);
 const args={...d.template.config,start_date:d.start_date,end_date:d.end_date};
 let range;
 if(d.template.kind==='analysis'&&!args.report_id){
  range=freePlan(args,true,true).range;
  // Freeze today's cutoff so preview and execution cover the same interval.
  if(range.includes_today&&args.end_clock===undefined){d.template.config.end_clock=range.end_at.slice(11);if(d.template_ref)delete d.template_ref;}
 }else{range=dateRange(d.start_date,d.end_date);if(d.template.kind==='advanced')advancedPlan(args,true);if(d.template.kind==='distribution')validateDistribution(args);if(d.template.kind==='funnel')funnelPlan(args,true);}

 if(d.template.kind==='mapped')throw new QueryError('UNSUPPORTED_QUERY','映射模板继续使用已有映射分析会话，避免丢失映射版本校验。');
 let metric=null;
 if(d.dictionary){
  metric=await (deps.dictionary??metricDictionary)(api,{action:'read',key:d.dictionary.key},owner);
  if(metric.revision!==d.dictionary.revision)throw new QueryError('VERSION_CONFLICT','指标字典版本已变化，请回读并重新预览。');
  if(!metric.execution_guidance?.may_use_source)throw new QueryError('METRIC_NOT_READY','指标暂停、待确认或来源发生变化，不能绑定执行。');
  if(d.template.kind!=='report'||d.template.config.report_id!==metric.value.default_report_id)throw new QueryError('METRIC_SOURCE_MISMATCH','字典执行必须使用明确的默认来源报表，不允许静默切换。');
  const check=metric.source_checks.find(c=>c.report_id===metric.value.default_report_id);
  if(check?.source_type==='saved_sql'||!check?.date_capability?.accepts_requested_dates)throw new QueryError('UNSUPPORTED_QUERY','此来源不支持日期覆盖；保存SQL须按原日期逻辑走专用工具。');
  const source=metric.value.sources.find(s=>s.report_id===metric.value.default_report_id);
  if(source?.metric_index!==undefined){if(d.template.config.metric_index!==undefined&&d.template.config.metric_index!==source.metric_index)throw new QueryError('METRIC_SOURCE_MISMATCH','所选指标与字典记录不一致。');d.template.config.metric_index=source.metric_index;}
  if(d.template.source_version!==source?.source_version)throw new QueryError('VERSION_CONFLICT','模板与字典绑定的来源版本不一致。');
 }
 const validation=await (deps.validate??validateDraft)(api,'template',d.template);
 if(!validation.valid)throw new QueryError('PROPERTY_TYPE_MISMATCH','配置检查未通过。');
 const preview={definition:d,changes:diffValues(before,d),timezone:'Asia/Shanghai',resolved_time_range:range,dictionary:metric?{key:metric.key,revision:metric.revision,name:metric.value.name,recommendation:metric.value.recommendation,meaning:metric.value.meaning,unit:metric.value.unit,maturity:metric.value.maturity,limitations:metric.value.limitations,source:metric.value.default_report_id,source_version:d.template.source_version}:null,validation,
  inheritance:'未指定字段继承；config按顶层字段合并，数组整体替换。更换分析类型或字典绑定须提交完整新定义。',
  scope:d.template.config.metric_index!==undefined?`只返回来源报表第${d.template.config.metric_index+1}个指标；公式依赖仅参与计算。`:metric?'返回默认来源报表的结果；旧字典selector是说明文字，不自动裁剪成单个业务指标。':'未采用正式指标字典；以完整查询配置为准。'};
 const hash=await configHash({definition:d,metric:preview.dictionary});
 if(a.operation==='save'){
  if(a.execute||!a.session_key||a.expected_revision===undefined||!a.confirmed||hash!==a.preview_hash)throw new QueryError('PREVIEW_CHANGED','保存查询记录需要固定预览、名称、版本及确认。');
  const body=JSON.stringify({definition:d});if(body.length>24000)throw new QueryError('RESULT_TOO_LARGE','查询配置过长。');
  const db=database(api,owner),r=await db.prepare('INSERT INTO governance_records(owner,kind,record_key,revision,body,created_at) SELECT ?,?,?,?,?,? WHERE COALESCE((SELECT MAX(revision) FROM governance_records WHERE owner=? AND kind=? AND record_key=?),0)=?').bind(owner,'query_workflow',a.session_key,a.expected_revision+1,body,Date.now(),owner,'query_workflow',a.session_key,a.expected_revision).run();
  if(r.meta?.changes!==1)throw new QueryError('VERSION_CONFLICT','查询记录已更新，请读取后再修改。');
  const saved=await record(api,owner,'query_workflow',a.session_key);if(JSON.stringify(saved.value)!==body)throw new QueryError('READBACK_MISMATCH','保存回读不一致。');
  return {...saved,status:'saved',persisted:true,readback_verified:true,upstream_modified:false};
 }
 if(!a.execute)return {...preview,status:'preview',preview_hash:hash,persisted:false};
 if(hash!==a.preview_hash)throw new QueryError('PREVIEW_CHANGED','查询配置或字典已变化，须先重新预览。');
 const output=deps.trial?await deps.trial(api,'template',d.template,d.start_date,d.end_date):await ({report:queryReportAdaptive,analysis:runAnalysis,advanced:runAdvanced,distribution:runDistribution,funnel:runFunnel})[d.template.kind](api,{...d.template.config,start_date:d.start_date,end_date:d.end_date});
 return {...preview,status:'executed',preview_hash:hash,output,persisted:false,upstream_modified:false};
}
