import {distributionShape,runDistribution} from './distribution.mjs';
import {z} from 'zod/v4';
import {APP,PROJECT,QueryError,dateRange} from './core.mjs';
import {eventSchema,filterSchema,filterLeaves,propertySchema} from './analysis.mjs';
import {database,record} from './governance.mjs';
import {configHash} from './config-hash.mjs';
import {virtualList,virtualView} from './virtual.mjs';
import {insightSchema,runInsight} from './insights.mjs';
import {diffValues} from './editor.mjs';
const key=z.string().min(1).max(80).regex(/^[\w.-]+$/);
const text=z.string().trim().min(1).max(1000);
const valueType=z.enum(['string','int','float','datetime','list','version']);
const requirement=z.object({property:propertySchema,value_type:valueType}).strict();
export const mappingSchema=z.object({
 name:text,meaning:text,implementation_status:z.enum(['planned','live','legacy']),
 effective_from:z.string(),effective_to:z.string().optional(),
 events:z.array(eventSchema).min(1).max(5),filters:z.array(filterSchema).max(10).default([]),
 revenue_property:propertySchema.optional(),measure_property:propertySchema.optional(),measure_unit:z.string().trim().min(1).max(80).optional(),properties:z.array(requirement).max(30).default([]),
 sources:z.array(z.object({document:text,sheet:text,range:text,sha256:z.string().regex(/^[a-f0-9]{64}$/),note:z.string().max(1000).default('')}).strict()).min(1).max(10),
 business_contract:z.object({currency:z.string().regex(/^[A-Z]{3}$/).optional(),amount_unit:z.enum(['major','minor','source_unit']).default('source_unit'),order_deduplication:z.enum(['user_confirmed','unverified']).default('unverified'),refund_treatment:z.literal('unverified').default('unverified'),first_repeat_purchase:z.literal('not_available').default('not_available'),confirmation_source:z.string().max(1000).default('')}).strict().optional(),
 notes:z.string().max(2000).default('')
}).strict();
export const mappedQuerySchema=insightSchema.omit({events:true,filters:true,revenue_property:true});
const mappedDistributionSchema=z.object(distributionShape).omit({event:true,property:true,filters:true}).extend({kind:z.enum(['user_frequency','user_cumulative_measure','numeric_event_distribution']),granularity:z.enum(['day','all']).optional()}).strict();
export const mappingShape={action:z.enum(['list','read','history','save','validate','publish','run']),key:key.optional(),revision:z.number().int().positive().optional(),expected_revision:z.number().int().min(0).optional(),definition:mappingSchema.optional(),confirmed:z.literal(true).optional(),validation_hash:z.string().regex(/^[a-f0-9]{64}$/).optional(),query:z.union([mappedQuerySchema,mappedDistributionSchema]).optional(),extra_filters:z.array(filterSchema).max(10).default([]),page:z.number().int().min(1).max(1000).default(1)};
const fail=(code,msg)=>{throw new QueryError(code,msg);};
function validDate(x){if(!/^\d{4}-\d{2}-\d{2}$/.test(x)||!Number.isFinite(Date.parse(x+'T00:00:00Z'))||new Date(x+'T00:00:00Z').toISOString().slice(0,10)!==x)fail('INVALID_DATE','生效日期必须是有效 YYYY-MM-DD。');}
const propertyKey=p=>[p.property_type==='profile'?'user_profile':p.property_type,p.property_compose_type??'origin',p.property_name].join(':');
export function checkedMapping(input){
 const d=mappingSchema.parse(input);validDate(d.effective_from);if(d.effective_to){validDate(d.effective_to);if(d.effective_to<d.effective_from)fail('INVALID_DATE','映射生效结束日期不能早于开始日期。');}
 if(d.measure_unit&&!d.measure_property)fail('INVALID_ARGUMENT','累计指标单位需要measure_property。');
 const declared=new Map();for(const r of d.properties){const k=propertyKey(r.property);if(declared.has(k))fail('INVALID_ARGUMENT','属性预期类型重复。');declared.set(k,r.value_type);}
 const referenced=filterLeaves([...d.filters,...d.events.flatMap(e=>e.filters)]).map(f=>f.property);if(d.revenue_property)referenced.push(d.revenue_property);if(d.measure_property)referenced.push(d.measure_property);
 for(const p of referenced)if(!declared.has(propertyKey(p)))fail('INVALID_ARGUMENT',`映射须声明属性 ${p.property_name} 的预期类型。`);
 if([d.revenue_property,d.measure_property].filter(Boolean).some(p=>!['int','float'].includes(declared.get(propertyKey(p)))))fail('PROPERTY_TYPE_MISMATCH','收入属性必须为 int 或 float。');
 if(d.business_contract&&(!d.revenue_property||!d.business_contract.confirmation_source))fail('INVALID_ARGUMENT','金额口径需要金额属性和明确确认来源。');
 return d;
}
// Read selected metadata once per request; no persistent cache, no successful fallback on upstream failure.
export async function inspectMapping(api,definition,extraProperties=[]){
 const d=checkedMapping(definition),cache=new Map(),snapshot=[];
 const list=async kind=>{if(!cache.has(kind)){const r=kind.startsWith('virtual_')?await virtualList(api,kind):await api.request('POST',`/openapi/v1/metadata/${APP}/list/${kind}`,{});if(!Array.isArray(r.data)||r.data.some(x=>typeof x?.name!=='string'))fail('UNVERIFIED_CONTRACT','元数据目录结构未核验。');cache.set(kind,r.data);}return cache.get(kind);};
 const select=async(kind,name,predicate=()=>true)=>{const matches=(await list(kind)).filter(x=>x.name===name&&predicate(x));if(matches.length!==1)fail('MAPPING_METADATA_MISSING',`未找到唯一匹配的 ${kind}/${name}；未执行分析。`);const x=matches[0];return kind.startsWith('virtual_')?Object.fromEntries(Object.entries(virtualView(x,kind)).filter(([k])=>k!=='used_times')):Object.fromEntries(['id','name','type','value_type','status','description'].filter(k=>x[k]!==undefined).map(k=>[k,x[k]]));};
 for(const e of d.events){const kind=e.event_type==='virtual'?'virtual_events':'events';snapshot.push({kind,value:await select(kind,e.event_name)});}
 const required=new Map(d.properties.map(r=>[propertyKey(r.property),r]));
 for(const p of extraProperties){const k=propertyKey(p);if(!required.has(k))required.set(k,{property:p});}
 const types=new Map();for(const [k,r] of required){const p=r.property,user=['profile','user_profile'].includes(p.property_type),virtual=p.property_compose_type==='virtual';const kind=virtual?'virtual_params':user?'user_profiles':'params';const x=await select(kind,p.property_name,x=>virtual?x.property_type===(user?2:1):user||x.type===(p.property_type==='common_param'?2:1));if(!valueType.safeParse(x.value_type).success||r.value_type&&x.value_type!==r.value_type)fail('PROPERTY_TYPE_MISMATCH',`属性 ${p.property_name} 类型发生变化或未知；未执行分析。`);types.set(k,x.value_type);snapshot.push({kind,property:k,value:x});}
 for(const f of filterLeaves([...d.filters,...d.events.flatMap(e=>e.filters)]))checkValues(f,types.get(propertyKey(f.property)));
 snapshot.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b),'en'));
 return {metadata_fingerprint:await configHash(snapshot),metadata_app_id:APP,project_id:PROJECT,scope_note:'元数据校验仅覆盖 配置应用；不证明项目其他应用的埋点一致或枚举值已实际出现；虚拟对象仅校验自身定义，不递归验证全部依赖。',types:Object.fromEntries(types),checked_at:new Date().toISOString()};
}
function checkValues(f,type){if(['int','float'].includes(type)&&f.values.some(v=>typeof v!=='number'||type==='int'&&!Number.isInteger(v)))fail('PROPERTY_TYPE_MISMATCH',`属性 ${f.property.property_name} 需要数值筛选值。`);if(['string','version','datetime'].includes(type)&&f.values.some(v=>typeof v!=='string'))fail('PROPERTY_TYPE_MISMATCH',`属性 ${f.property.property_name} 需要字符串筛选值。`);}
async function append(api,owner,k,expected,value){const body=JSON.stringify(value);if(body.length>20000)fail('RESULT_TOO_LARGE','映射过大，请拆分。');const r=await database(api,owner).prepare('INSERT INTO governance_records(owner,kind,record_key,revision,body,created_at) SELECT ?,?,?,?,?,? WHERE COALESCE((SELECT MAX(revision) FROM governance_records WHERE owner=? AND kind=? AND record_key=?),0)=?').bind(owner,'tracking_mapping',k,expected+1,body,Date.now(),owner,'tracking_mapping',k,expected).run();if(r.meta?.changes!==1)fail('VERSION_CONFLICT','映射已更新，请重新读取和校验。');return {...await record(api,owner,'tracking_mapping',k),data_deleted:false};}
async function selected(api,owner,a){if(a.revision)return record(api,owner,'tracking_mapping',a.key,a.revision);return record(api,owner,'tracking_mapping',a.key);}
async function check(api,owner,a){const r=await selected(api,owner,a),d=checkedMapping(r.value.definition),live=await inspectMapping(api,d);return {record:r,validation:live,validation_hash:await configHash({owner,key:a.key,revision:r.revision,definition:d,metadata:live.metadata_fingerprint})};}
export async function trackingMapping(api,input,owner,execute=runInsight){
 const a=z.object(mappingShape).strict().parse(input),db=database(api,owner);
 if(a.action==='list'){const rows=await db.prepare("SELECT g.* FROM governance_records g WHERE owner=? AND kind='tracking_mapping' AND revision=(SELECT MAX(revision) FROM governance_records v WHERE v.owner=g.owner AND v.kind=g.kind AND v.record_key=g.record_key) ORDER BY record_key LIMIT 21 OFFSET ?").bind(owner,(a.page-1)*20).all();return {items:rows.results.slice(0,20).map(r=>({key:r.record_key,revision:r.revision,...JSON.parse(r.body)})),has_more:rows.results.length>20,data_deleted:false};}
 if(!a.key)fail('INVALID_ARGUMENT','需要映射 key。');
 if(a.action==='history'){const rows=await db.prepare('SELECT revision,body,created_at FROM governance_records WHERE owner=? AND kind=? AND record_key=? ORDER BY revision DESC LIMIT 21 OFFSET ?').bind(owner,'tracking_mapping',a.key,(a.page-1)*20).all();return {items:rows.results.slice(0,20).map(r=>({revision:r.revision,created_at:r.created_at,...JSON.parse(r.body)})),has_more:rows.results.length>20};}
 if(a.action==='read')return selected(api,owner,a);
 if(a.action==='save'){
  if(!a.definition||a.expected_revision===undefined)fail('INVALID_ARGUMENT','保存草稿需要 definition 和 expected_revision。');const d=checkedMapping(a.definition);let before=null;try{before=await record(api,owner,'tracking_mapping',a.key);}catch(e){if(e.code!=='NOT_FOUND')throw e;}
  if((before?.revision??0)!==a.expected_revision)fail('VERSION_CONFLICT','映射已变化。');const differences=diffValues(before?.value.definition??{},d);
  if(!a.confirmed)return {status:'preview',definition:d,differences,data_deleted:false};
  return {status:'saved_draft',...await append(api,owner,a.key,a.expected_revision,{state:'draft',definition:d,differences})};
 }
 if(a.action==='validate'||a.action==='publish'){
  const v=await check(api,owner,a);if(a.action==='validate')return {status:'metadata_checked',...v,business_semantics_verified:false};
  if(!a.confirmed||a.expected_revision===undefined||!a.validation_hash)fail('INVALID_ARGUMENT','发布需要 confirmed、expected_revision 和本次校验的 validation_hash。');
  if(v.validation_hash!==a.validation_hash)fail('VERSION_CONFLICT','元数据或映射变化，请重新校验。');if(v.record.value.definition.implementation_status==='planned')fail('MAPPING_NOT_LIVE','待上线定义只能保存草稿，不能发布查询。');
  return {status:'published',...await append(api,owner,a.key,a.expected_revision,{state:'published',definition:v.record.value.definition,source_revision:v.record.revision,validation:v.validation})};
 }
 if(!a.query)fail('INVALID_ARGUMENT','执行需要 query。');
 const distribution=['user_frequency','user_cumulative_measure','numeric_event_distribution'].includes(a.query.kind);const periods=distribution?[{start_date:a.query.start_date,end_date:a.query.end_date}]:[a.query.period,...(a.query.baseline?[a.query.baseline]:[])];periods.forEach(p=>dateRange(p.start_date,p.end_date));
 const observationDays=a.query.kind==='funnel_diagnosis'?a.query.window_days:['retention_diagnosis','adoption'].includes(a.query.kind)?a.query.retention_days:0;
 const coveragePeriods=periods.map(p=>({...p,end_date:observationDays?new Date(Date.parse(p.end_date+'T00:00:00Z')+observationDays*86400000).toISOString().slice(0,10):p.end_date}));
 let r;if(a.revision)r=await selected(api,owner,a);else{
  const all=await db.prepare('SELECT * FROM governance_records WHERE owner=? AND kind=? AND record_key=? ORDER BY revision DESC LIMIT 501').bind(owner,'tracking_mapping',a.key).all();if(all.results.length>500)fail('MAPPING_REVISION_REQUIRED','历史版本过多，请明确指定已发布 revision。');
  const published=all.results.map(x=>({key:x.record_key,revision:x.revision,value:JSON.parse(x.body)})).filter(x=>x.value.state==='published');const used=new Map();
  for(const p of coveragePeriods)for(let day=p.start_date;day<=p.end_date;day=new Date(Date.parse(day+'T00:00:00Z')+86400000).toISOString().slice(0,10)){const hit=published.find(x=>covers(x.value.definition,day,day));if(!hit)fail('MAPPING_DATE_GAP','查询日期没有已发布的适用映射。');used.set(hit.revision,hit);}
  if(used.size!==1)fail('MAPPING_VERSION_BOUNDARY','日期跨越映射版本，请分段核验；不自动累加UV、比例或漏斗。');r=[...used.values()][0];
 }
 if(r.value.state!=='published')fail('MAPPING_NOT_PUBLISHED','草稿不能执行。');const d=checkedMapping(r.value.definition);
 if(coveragePeriods.some(p=>!covers(d,p.start_date,p.end_date)))fail('MAPPING_DATE_GAP','指定映射不覆盖查询及基线日期。');
 const extras=filterLeaves([...a.extra_filters,...(a.query.segments??[]).flatMap(s=>s.filters)]);const props=[...(a.query.group_by??[]),...extras.map(f=>f.property)];
 // Fingerprint only the published contract; ad-hoc fields receive separate fresh validation.
 const live=await inspectMapping(api,d);if(live.metadata_fingerprint!==r.value.validation.metadata_fingerprint)fail('MAPPING_DRIFT','上游元数据已变化，请重新校验发布映射；本次未执行分析。');
 if(props.length){const extra=await inspectMapping(api,d,props);for(const f of extras)checkValues(f,extra.types[propertyKey(f.property)]);}
 let definition,output;const filters=[...d.filters,...a.extra_filters];if(filters.length>10)fail('INVALID_ARGUMENT','映射和额外筛选合计最多10项。');if(distribution){if(d.events.length!==1)fail('INVALID_ARGUMENT','分布映射必须恰好包含一个事件。');if(a.query.kind!=='user_frequency'&&!d.measure_property)fail('INVALID_ARGUMENT','数值分布需要映射中的measure_property。');definition={...a.query,event:d.events[0],filters,...(a.query.kind!=='user_frequency'?{property:d.measure_property}:{})};output=await runDistribution(api,definition);}else{definition=insightSchema.parse({...a.query,events:d.events,filters,...(['revenue_quality','channel_ltv'].includes(a.query.kind)?{revenue_property:d.revenue_property}:{})});output=await execute(api,definition);}if(a.query.kind==='revenue_quality'&&d.business_contract&&output.data?.business_contract)output.data.business_contract={...output.data.business_contract,...d.business_contract,verification:'caller_confirmed_not_independent_order_audit'};return {...output,tracking_mapping:{key:a.key,revision:r.revision,definition_hash:await configHash(d),metadata_fingerprint:live.metadata_fingerprint,sources:d.sources,business_contract:d.business_contract??null,measure_property:d.measure_property??null,measure_unit:d.measure_unit??null,effective_from:d.effective_from,effective_to:d.effective_to??null,validated_coverage_periods:coveragePeriods,metadata_scope:live.scope_note,checked_at:live.checked_at},data_deleted:false};
}
function covers(d,start,end){return d.effective_from<=start&&(!d.effective_to||d.effective_to>=end);}
