import {SUBJECT} from './scope-config.mjs';
import {formulaSchema,validateFormulas,computeFormulas} from './formulas.mjs';
import {eventRange,matchEventDates} from './event-time.mjs';
import {isSqlReport,savedSql} from './saved-sql.mjs';
import {readReportDefinition} from './dashboard.mjs';
import {z} from 'zod/v4';
import {APP,PROJECT,QueryError,dateRange,extractDSL,replayPlan,normalizeResults} from './core.mjs';
import {definitionHash} from './definitions.mjs';
import {paginateResults,reportQuality,expectedDays,querySavedReport} from './query.mjs';
const name=z.string().min(1).max(120).regex(/^[\w$.-]+$/);
const sensitive=/(^|[_$.])(uid|user_id|user_unique_id|unique_id|device_id|distinct_id|email|phone|mobile|ip|idfa|idfv|message|chat_content|password|token)([_$.]|$)/i;
export const propertySchema=z.object({property_name:name,property_type:z.enum(['common_param','event_param','user_profile','profile']),property_compose_type:z.enum(['origin','virtual']).default('origin')}).strict().refine(v=>!sensitive.test(v.property_name),'只支持聚合分析属性，不开放标识符和消息正文。');
export const filterLeafSchema=z.object({property:propertySchema,operator:z.enum(['=','!=','in','not_in','>','>=','<','<=','contain','not_contain','is_null','is_not_null']),values:z.array(z.union([z.string().max(200),z.number().finite()])).max(50).default([])}).strict().refine(f=>['is_null','is_not_null'].includes(f.operator)?f.values.length===0:['in','not_in'].includes(f.operator)?f.values.length>0:f.values.length===1,'筛选操作符与值数量不匹配。');
// Bounded groups keep discovery finite and reject malformed/empty branches before I/O.
const filterGroup=child=>z.object({logic:z.enum(['and','or']),conditions:z.array(child).min(1).max(10)}).strict();
const firstGroup=filterGroup(filterLeafSchema);
export const filterSchema=z.union([filterLeafSchema,firstGroup,filterGroup(z.union([filterLeafSchema,firstGroup]))]);
export function filterLeaves(filters){return filters.flatMap(f=>f.logic?filterLeaves(f.conditions):[f]);}
function compileGroup(logic,filters){
 const conditions=filters.filter(f=>!f.logic).map(f=>({...f.property,property_operation:f.operator,property_values:f.values}));
 const expressions=filters.filter(f=>f.logic).map(f=>compileGroup(f.logic,f.conditions));
 // Native mixed conditions/expressions dropped a branch in the 2026-10-18 probe.
 // Keep each level homogeneous; identical logic preserves leaf grouping semantics.
 if(expressions.length)return {logic,expressions:[...(conditions.length?[{logic,conditions}]:[]),...expressions]};
 return {logic,conditions};
}
export const eventSchema=z.object({event_name:name,event_type:z.enum(['origin','virtual']).default('origin'),indicator:z.enum(['events','event_users','events_per_user']).default('event_users'),filters:z.array(filterSchema).max(10).default([])}).strict();
export const aggregateEventSchema=eventSchema.extend({measure:z.object({operator:z.literal('sum'),property:propertySchema}).strict().optional()}).superRefine((e,c)=>{if(e.measure&&(e.indicator!=='event_users'||e.measure.property.property_type!=='event_param'))c.addIssue({code:'custom',message:'属性求和使用默认indicator和事件数值属性，不混用人数/次数算子。'});});
export const modifiers={filters:z.array(filterSchema).max(10).default([]),group_by:z.array(propertySchema).max(3).default([])};
export const analysisShape={formulas:z.array(formulaSchema).max(5).optional(),report_id:z.string().optional(),kind:z.enum(['event','retention']).default('event'),events:z.array(aggregateEventSchema).min(1).max(5).optional(),initial_event:eventSchema.optional(),return_event:eventSchema.optional(),retention_days:z.number().int().min(1).max(30).default(7),start_date:z.string(),end_date:z.string(),granularity:z.enum(['day','hour','all']).default('day'),start_clock:z.string().optional(),end_clock:z.string().optional(),include_today:z.boolean().default(false),...modifiers,metric_page:z.number().int().min(1).max(100).default(1),metric_page_size:z.number().int().min(1).max(10).default(5),limit:z.number().int().min(1).max(1000).default(100),page:z.number().int().min(1).max(1000).default(1),page_size:z.number().int().min(1).max(20).default(5)};
export const analysisSchema=z.object(analysisShape).strict();
export function expression(filters){if(filterLeaves(filters).length>100)throw new QueryError('INVALID_ARGUMENT','一次表达式最多100个属性条件。');return compileGroup('and',filters);}
function event(e,label){return {event_name:e.event_name,event_type:e.event_type,show_label:label,event_indicator:e.measure?'measure':e.indicator,...(e.measure?{measure_info:{measure_type:e.measure.operator,...e.measure.property}}:{}),groups_v2:[],filters:e.filters.length?[{expression:expression(e.filters)}]:[]};}
// Add conditions to EVERY existing comparison cohort, never introduce a new OR cohort.
export function applyModifiers(dsl,filters,groups){
 const d=structuredClone(dsl),c=d.content;
 if(filters.length){const extra=expression(filters);c.profile_filters=c.profile_filters?.length?c.profile_filters.map(f=>({...f,expression:{logic:'and',expressions:[f.expression,extra]}})):[{show_label:'1',expression:extra}];}
 if(groups.length){c.profile_groups_v2=groups.filter(g=>['profile','user_profile'].includes(g.property_type));for(const q of c.queries.flat()){if(!q.formula)q.groups_v2=groups.filter(g=>!['profile','user_profile'].includes(g.property_type));}}
 return d;
}
export function freePlan(args,wide,allowIntraday=false){
 const a=analysisSchema.parse(args);validateFormulas(a);const range=allowIntraday?eventRange(a):dateRange(a.start_date,a.end_date);
 if(!allowIntraday&&(a.granularity==='hour'||a.start_clock!==undefined||a.end_clock!==undefined||a.include_today))throw new QueryError('INVALID_ARGUMENT','小时/时段/当天参数仅开放自由事件查询。');
 if(a.report_id)throw new QueryError('INVALID_ANALYSIS','已有报表应走保存配置分支。');
 const queries=a.kind==='retention'?(a.initial_event&&a.return_event&&!a.events?[[event(a.initial_event,'A'),event(a.return_event,'B')]]:null):(a.events&&!a.initial_event&&!a.return_event?a.events.map((e,i)=>[event(e,String.fromCharCode(65+i))]):null);
 if(!queries)throw new QueryError('INVALID_ANALYSIS','事件分析传 events；留存传 initial_event 和 return_event，不能混用。');
 if(a.kind==='retention'&&a.granularity!=='day')throw new QueryError('INVALID_ANALYSIS','留存队列使用日粒度。');
 const d={version:3,use_app_cloud_id:true,...(wide?{resources:[{project_ids:[Number(PROJECT)],subject_ids:[SUBJECT],app_ids:[]}]}:{app_ids:[Number(APP)]}),periods:[{type:'range',range:[range.start_time,range.end_time],timezone:range.timezone,granularity:a.granularity}],content:{query_type:a.kind,queries,profile_filters:[],profile_groups_v2:[],page:{limit:a.limit,offset:0},option:{use_sample_data:false,refresh_cache:false,fusion:false,...(a.kind==='retention'?{retention_target:JSON.stringify([2,a.retention_days+1]),lost:false}:{})}},show_option:{}};
 if(range.partial_period||a.granularity==='hour')d.content.option.refresh_cache=true;
 return {dsl:applyModifiers(d,a.filters,a.group_by),range,args:a};
}
export function validateAnalysis(results,dsl,range){
 const issues=[],ids=new Set();
 const c=dsl.content,expected=dsl.periods.length*c.queries.length;
 if(results.length<expected)issues.push({code:'MISSING_SUBQUERY',expected,received:results.length});
 for(let p=0;p<dsl.periods.length;p++)for(let q=0;q<c.queries.length;q++){const id=`a00:p${String(p).padStart(2,'0')}:c00:q${String(q).padStart(2,'0')}`;if(!results.some(r=>r.query_id===id))issues.push({code:'MISSING_SUBQUERY',query_id:id});}
 for(const r of results){
  if(!r.query_id||ids.has(r.query_id))issues.push({code:'DUPLICATE_OR_MISSING_QUERY_ID'});ids.add(r.query_id);
  if(r.result_status!=='SUCCESS')issues.push({code:'SUBQUERY_NOT_SUCCESS',query_id:r.query_id});
  if(r.is_truncated)issues.push({code:'UPSTREAM_TRUNCATED',query_id:r.query_id});
  // Native blend may append a whole-interval period; accept only the requested day/interval forms.
  if(range){const days=expectedDays(range),whole=[`${range.start_date} 00:00:00-${range.end_date} 23:59:59`];
  if(range.granularity?!matchEventDates(r.date_index_list,range):![JSON.stringify(days),JSON.stringify(whole)].includes(JSON.stringify(r.date_index_list)))issues.push({code:'DATE_RANGE_MISMATCH',query_id:r.query_id});}
  for(const s of r.series){if(Array.isArray(s.data)&&s.data.length!==r.date_index_list?.length)issues.push({code:'SERIES_LENGTH_MISMATCH',query_id:r.query_id});if(Array.isArray(s.details)&&JSON.stringify(s.details.map(x=>x[0]))!==JSON.stringify(r.date_index_list))issues.push({code:'RETENTION_COHORT_MISMATCH',query_id:r.query_id});}
 }
 if(!results.length)issues.push({code:'EMPTY_RESULT'});
 return {status:issues.length?'incomplete':'verified',issues,time_range_verified:!!range&&results.length>0&&!issues.some(i=>['MISSING_SUBQUERY','DATE_RANGE_MISMATCH','SUBQUERY_NOT_SUCCESS'].includes(i.code))};
}
export async function runAnalysis(api,input,savedDefinition,savedPeriods=false){
 const a=analysisSchema.parse(input);validateFormulas(a);const wide=api.env.DATAFINDER_ALLOW_PROJECT_WIDE==='true';let plan,sourceVersion;
 if(a.report_id){
  if(a.include_today||a.start_clock!==undefined||a.end_clock!==undefined||a.granularity==='hour')throw new QueryError('UNSUPPORTED_QUERY','保存报表暂沿用原有完整日期口径；小时/时段/当天请传events使用自由事件查询。');
  if(a.events||a.initial_event||a.return_event)throw new QueryError('INVALID_ANALYSIS','report_id 与自定义事件不能同时提供。');
  const saved=savedDefinition??await readReportDefinition(api,a.report_id),original=extractDSL(saved.data,wide,true);
  sourceVersion=await definitionHash(original);plan=savedPeriods?{dsl:structuredClone(original),range:null}:replayPlan(original,a.start_date,a.end_date,wide);plan.dsl=applyModifiers(plan.dsl,a.filters,a.group_by);plan.dsl.content.page={limit:a.limit,offset:0};
 }else {plan=freePlan(a,wide,true);for(const e of a.events??[])if(e.measure){const {numericProperty}=await import('./metadata.mjs');await numericProperty(api,e.measure.property);}}
 const selection=selectMetrics(plan.dsl,a.metric_page,a.metric_page_size);
 const r=await executeAnalysis(api,selection.dsl),localResults=normalizeResults(r.data),validation=validateAnalysis(localResults,selection.dsl,plan.range);
 validation.coverage='requested_metric_page_and_formula_dependencies';
 const results=remapResults(localResults,selection);
 const bounded=results.some(r=>r.series.length>=a.limit);
 if(bounded){validation.status='incomplete';validation.issues.push({code:'GROUP_LIMIT_REACHED',limit:a.limit});}
 const computed=computeFormulas(a,results,validation.status==='verified');
 if(computed?.status==='incomplete'){validation.status='incomplete';validation.issues.push({code:'FORMULA_INPUT_OR_RESULT_UNKNOWN'});}
 const selected=results;
 const paged=paginateResults(selected,a.page,a.page_size);paged.pagination.metrics={page:a.metric_page,page_size:a.metric_page_size,total:plan.dsl.content.queries.length,has_more:a.metric_page*a.metric_page_size<plan.dsl.content.queries.length};
 return api.output({data:{...(a.formulas?.length?{computed_formulas:computed}:{ }),results:paged.results,pagination:{...paged.pagination,upstream_limit:a.limit,all_groups_complete:bounded?false:'unknown'},definition:{...plan.dsl.content,queries:plan.dsl.content.queries.slice((a.metric_page-1)*a.metric_page_size,a.metric_page*a.metric_page_size),formula_dependency_indices:selection.indices.filter(i=>!selection.requested.includes(i)),query_index_start:(a.metric_page-1)*a.metric_page_size,total_queries:plan.dsl.content.queries.length}},log_id:r.log_id},{status:validation.status==='verified'?'success':'incomplete',validation,time_range_verified:validation.time_range_verified,...reportQuality(results,{query_type:plan.dsl.content.query_type}),resolved_time_range:plan.range??{saved_periods:plan.dsl.periods,complete_days_only:false},query_method:'structured_analysis',execution:r.execution,log_ids:r.log_ids??[r.log_id],temporal_status:plan.range?.includes_today?'provisional_today':plan.range?.partial_period?'bounded_time_window':'historical',data_delay_seconds:null,source_report_id:a.report_id??null,source_definition_version:sourceVersion??null,definition_version:await definitionHash(plan.dsl),saved_configuration_modified:false,formula_source:'native_analysis_result',warnings:[...(plan.range?.includes_today?['今天尚未结束，数据可能延迟或回补；as_of是查询截点，不是入库水位，不与完整昨日直接比较。']:[]),...(a.granularity==='hour'?['首尾小时可能不是完整小时；小时UV不能相加得到区间UV。']:[]),'临时筛选以 AND 叠加到每个原有分群；指定分组替换原有分组。','普通分析仅支持前 N 组；分页是在已返回结果内翻页，不能通过 offset 取得遗漏分组。','区间UV不跨日累加，空值和未成熟留存不补零。']});
}
export const propertyShape={event:eventSchema,properties:z.array(propertySchema).min(1).max(5),start_date:z.string(),end_date:z.string(),filters:z.array(filterSchema).max(10).default([]),page:z.number().int().min(1).max(200).default(1),page_size:z.number().int().min(1).max(100).default(50)};
export async function inspectPropertyValues(api,input){
 const a=z.object(propertyShape).strict().parse(input),plan=freePlan({kind:'event',events:[a.event],start_date:a.start_date,end_date:a.end_date,granularity:'all',filters:a.filters},api.env.DATAFINDER_ALLOW_PROJECT_WIDE==='true');
 const c=plan.dsl.content;c.query_type='attribute';c.queries[0][0].event_indicator='None';c.queries[0][0].groups_v2=a.properties;c.option={is_paginate:true};c.page={limit:a.page_size+1,offset:(a.page-1)*a.page_size};c.orders=a.properties.map(p=>({field:`${p.property_type==='user_profile'?'profile':p.property_type}#${p.property_name}`,direction:'asc'}));
 const r=await api.request('POST','/openapi/v1/analysis',plan.dsl);
 if(!Array.isArray(r.data)||r.data.length!==1||r.data[0].result_status!=='SUCCESS')throw new QueryError('UNVERIFIED_CONTRACT','属性值响应失败或结构未知。');
 const expectedDate=[`${a.start_date} 00:00:00-${a.end_date} 23:59:59`];
 if(JSON.stringify(r.data[0].date_index_list)!==JSON.stringify(expectedDate))throw new QueryError('DATE_RANGE_MISMATCH','属性查询未返回请求日期范围。');
 const data=r.data[0].data_item_list?.[0]?.data;
 if(!Array.isArray(data?.attribute_list)||!Array.isArray(data?.value_list))throw new QueryError('UNVERIFIED_CONTRACT','属性值响应缺少列定义或值列表。');
 const expectedAttributes=a.properties.map(p=>`${p.property_type==='user_profile'?'profile':p.property_type}#${p.property_name}`);
 if(JSON.stringify([...data.attribute_list].sort())!==JSON.stringify([...expectedAttributes].sort())||data.value_list.some(row=>!Array.isArray(row)||row.length!==data.attribute_list.length))throw new QueryError('UNVERIFIED_CONTRACT','属性列或值行无法与请求匹配。');
 return api.output({data:{attributes:data.attribute_list,values:data.value_list.slice(0,a.page_size),pagination:{page:a.page,page_size:a.page_size,has_more:data.value_list.length>a.page_size,source:'upstream_attribute_offset'}},log_id:r.log_id},{status:'success',resolved_time_range:plan.range,query_method:'attribute_analysis',sampling:'unknown',truncated:r.data[0].is_truncated??'unknown',warnings:['属性值列表不等于频次分布；如需次数或人数分布，请按该属性做事件分组分析。','翻页重新查询上游，数据更新可能影响跨页一致性；未返回值不补零。']});
}

export function analysisBatches(dsl){
 const queries=dsl.content.queries;
 if(dsl.content.query_type!=='event'||queries.length<=6)return [{dsl,indices:queries.map((_,i)=>i),requested:queries.map((_,i)=>i)}];
 const owners=new Map();queries.forEach((group,i)=>group.forEach(q=>{if(q.show_label)owners.set(q.show_label,i);}));
 const batches=[];
 for(let start=0;start<queries.length;start+=4){
  const requested=queries.slice(start,start+4).map((_,i)=>start+i),selected=new Set(requested);
  const visit=(i,path=new Set())=>{if(path.has(i))throw new QueryError('INVALID_FORMULA','公式依赖成环。');const next=new Set([...path,i]);for(const q of queries[i])if(q.formula){for(const label of q.formula.match(/[A-Za-z][A-Za-z0-9_]*/g)??[]){const dependency=owners.get(label);if(dependency===undefined)throw new QueryError('UNSUPPORTED_FORMULA','公式含未识别的依赖；不能安全拆分。');selected.add(dependency);visit(dependency,next);}}};
  requested.forEach(i=>visit(i));const indices=[...selected].sort((a,b)=>a-b),copy=structuredClone(dsl);copy.content.queries=indices.map(i=>queries[i]);batches.push({dsl:copy,indices,requested});
 }
 return batches;
}
export async function executeAnalysis(api,dsl){
 const batches=analysisBatches(dsl),data=[],log_ids=[];
 for(let start=0;start<batches.length;start+=3){
  const rs=await Promise.all(batches.slice(start,start+3).map(async b=>{
   const r=await api.request('POST','/openapi/v1/analysis',b.dsl,{}, {maxBytes:8_000_000});
   if(!Array.isArray(r.data))throw new QueryError('UNVERIFIED_CONTRACT','分析结果不是数组。');
   if(batches.length===1)return r;
   const mapped=r.data.flatMap(result=>{
    const match=/:q(\d+)$/.exec(result.query_id??'');if(!match||b.indices[Number(match[1])]===undefined)throw new QueryError('UNVERIFIED_CONTRACT','拆分结果 query_id 无法匹配。');
    const index=b.indices[Number(match[1])];if(!b.requested.includes(index))return [];
    const query_id=result.query_id.replace(/:q\d+$/,`:q${String(index).padStart(2,'0')}`);
    return [{...result,query_id,data_item_list:result.data_item_list?.map(s=>({...s,item_key:typeof s.item_key==='string'?s.item_key.replace(result.query_id,query_id):s.item_key}))}];
   });return {...r,data:mapped};
  }));for(const r of rs){data.push(...r.data);if(r.log_id)log_ids.push(r.log_id);}
 }
 return {data,log_id:log_ids[0],log_ids,execution:{batches:batches.length,max_concurrency:3,metric_identity:'query_id remapped to saved query index; no positional arithmetic'}};
}

export async function queryReportAdaptive(api,a){
 if(a.metric_index!==undefined){
  if(!a.filters?.length&&!a.group_by?.length)return querySavedReport(api,a.report_id,a.start_date,a.end_date,a.page,a.page_size,a.result_limit,a.metric_index);
  if(!Number.isInteger(a.metric_index)||a.metric_index<0)throw new QueryError('INVALID_ARGUMENT','指标编号无效。');
  const saved=await readReportDefinition(api,a.report_id);
  if(isSqlReport(saved?.data)||saved?.data?.dsls?.length!==1)throw new QueryError('UNSUPPORTED_QUERY','单指标选取仅支持单份事件或留存报表；SQL列不自动猜测。');
  return runAnalysis(api,{report_id:a.report_id,start_date:a.start_date,end_date:a.end_date,filters:a.filters,group_by:a.group_by,page:a.page,page_size:a.page_size,metric_page:a.metric_index+1,metric_page_size:1,limit:a.result_limit},saved);
 }
 if(a.filters?.length||a.group_by?.length)return runAnalysis(api,{report_id:a.report_id,start_date:a.start_date,end_date:a.end_date,filters:a.filters,group_by:a.group_by,page:a.page,page_size:a.page_size,metric_page:a.metric_page,limit:a.result_limit});
 let saved;
 try{saved=await readReportDefinition(api,a.report_id);}catch(e){if(!['UNVERIFIED_CONTRACT','UPSTREAM_UNAVAILABLE','UPSTREAM_BUSINESS_ERROR'].includes(e.code))throw e;}
 if(isSqlReport(saved?.data)){
  if(a.start_date!==undefined||a.end_date!==undefined||a.page>1||a.metric_page>1)throw new QueryError('UNSUPPORTED_QUERY','已保存SQL保留自身日期与行范围；不接受临时日期或指标分页。使用saved_sql读取定义。');
  const definition=await savedSql(api,{report_id:a.report_id,action:'read'});
  return savedSql(api,{report_id:a.report_id,action:'execute',expected_version:definition.data.version,count:a.result_limit??100});
 }
 if(saved?.data?.dsls?.length===1){const d=extractDSL(saved.data,api.env.DATAFINDER_ALLOW_PROJECT_WIDE==='true',true);
  if(d.content.query_type==='event'&&d.content.queries?.length>6){
   if((a.start_date===undefined)!==(a.end_date===undefined))throw new QueryError('INVALID_DATE','开始与结束日期必须同时提供。');
   return runAnalysis(api,{report_id:a.report_id,start_date:a.start_date??'',end_date:a.end_date??'',page:a.page,page_size:a.page_size,metric_page:a.metric_page,limit:a.result_limit},saved,a.start_date===undefined);
  }
 }
 return querySavedReport(api,a.report_id,a.start_date,a.end_date,a.page,a.page_size,a.result_limit);
}

export function selectMetrics(dsl,page,size){
 const queries=dsl.content.queries,start=(page-1)*size;
 if(start>=queries.length)throw new QueryError('INVALID_PAGE','指标页超出范围。');
 const requested=queries.slice(start,start+size).map((_,i)=>start+i),indices=new Set(requested),owners=new Map();queries.forEach((g,i)=>g.forEach(q=>{if(q.show_label)owners.set(q.show_label,i);}));
 const visit=(i,trail=new Set())=>{if(trail.has(i))throw new QueryError('INVALID_FORMULA','公式依赖成环。');for(const q of queries[i])if(q.formula)for(const label of q.formula.match(/[A-Za-z][A-Za-z0-9_]*/g)??[]){const dependency=owners.get(label);if(dependency===undefined)throw new QueryError('UNSUPPORTED_FORMULA','无法识别公式依赖，不能安全按指标分页。');indices.add(dependency);visit(dependency,new Set([...trail,i]));}};
 requested.forEach(i=>visit(i));const list=[...indices].sort((a,b)=>a-b),copy=structuredClone(dsl);copy.content.queries=list.map(i=>queries[i]);return {dsl:copy,indices:list,requested};
}
export function remapResults(results,selection){
 return results.flatMap(r=>{const local=Number(/:q(\d+)$/.exec(r.query_id??'')?.[1]),original=selection.indices[local];if(original===undefined)throw new QueryError('UNVERIFIED_CONTRACT','无法匹配指标页子查询。');if(!selection.requested.includes(original))return [];const query_id=r.query_id.replace(/:q\d+$/,`:q${String(original).padStart(2,'0')}`);return [{...r,query_id,series:r.series.map(s=>({...s,item_key:typeof s.item_key==='string'?s.item_key.replace(r.query_id,query_id):s.item_key}))}];});
}
