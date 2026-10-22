import {numericProperty} from './metadata.mjs';
import {z} from 'zod/v4';
import {QueryError,dateRange,normalizeResults} from './core.mjs';
import {eventSchema,filterSchema,propertySchema,freePlan,executeAnalysis,validateAnalysis,expression} from './analysis.mjs';
const dates={start_date:z.string(),end_date:z.string()};
const filters=z.array(filterSchema).max(10).default([]);
const qid=i=>`a00:p00:c00:q${String(i).padStart(2,'0')}`;
const ratio=(n,d)=>d>0?n/d:null;
const finiteCount=n=>Number.isSafeInteger(n)&&n>=0;
export function scalarCounts(raw,plan){
 const results=normalizeResults(raw),validation=validateAnalysis(results,plan.dsl,plan.range);
 if(validation.status!=='verified'||results.length!==plan.dsl.content.queries.length)throw new QueryError('INCOMPLETE_RESULT','计数子查询的身份、日期或完整性未通过验证。');
 return plan.dsl.content.queries.map((_,i)=>{const r=results.find(x=>x.query_id===qid(i));const s=r.series;
  if(r.is_truncated!==false||s.length!==1||s[0].data?.length!==1||!finiteCount(s[0].data[0]))throw new QueryError('INCOMPLETE_RESULT','必须返回完整、非负整数的区间聚合计数；未知不补零。');
  return s[0].data[0];
 });
}
export async function counts(api,a,events){
 const plan=freePlan({events:[{...events[0],filters:[]}],...a,granularity:'all'},api.env.DATAFINDER_ALLOW_PROJECT_WIDE==='true');
 plan.dsl.content.queries=events.map((input,i)=>{const e={...eventSchema.parse({...input,filters:[]}),filters:z.array(filterSchema).max(24).parse(input.filters??[])};return [{event_name:e.event_name,event_type:e.event_type,show_label:`M${i}`,event_indicator:e.indicator,groups_v2:[],filters:e.filters.length?[{expression:expression(e.filters)}]:[]}];});
 plan.dsl.content.option.refresh_cache=true;
 const r=await executeAnalysis(api,plan.dsl);return {values:scalarCounts(r.data,plan),range:plan.range,log_ids:r.log_ids,sampling:'unknown',data_freshness:'unknown'};
}
export const healthShape={...dates,events:z.array(eventSchema).min(1).max(5),filters,baseline_weeks:z.number().int().min(1).max(3).default(2),minimum_baseline_count:z.number().int().min(1).max(1000000).default(100),change_threshold:z.number().min(0.1).max(10).default(0.5)};
const shift=(s,n)=>new Date(Date.parse(`${s}T00:00:00Z`)+n*86400000).toISOString().slice(0,10);
export function healthAssessment(current,baseline,min,threshold){
 const mean=baseline.reduce((s,n)=>s+n,0)/baseline.length;
 const change=mean>0?(current-mean)/mean:null;
 return {current,baseline_mean:mean,relative_change:change,assessment:mean<min?'insufficient_baseline':current===0?'possible_event_loss':Math.abs(change)>=threshold?'volume_anomaly':'within_threshold'};
}
export async function checkTrackingHealth(api,input){
 const a=z.object(healthShape).strict().parse(input),range=dateRange(a.start_date,a.end_date);
 if(range.end_time-range.start_time>=7*86400)throw new QueryError('INVALID_DATE','健康检查一次最多 7 天，基线为前几周相同星期区间。');
 if(a.events.some(e=>e.indicator!=='event_users'))throw new QueryError('INVALID_ARGUMENT','健康检查固定同时查询事件次数和区间人数，不接受自选 indicator。');
 const events=a.events.flatMap(e=>[{...e,indicator:'events'},{...e,indicator:'event_users'}]);
 const windows=[];
 for(let week=0;week<=a.baseline_weeks;week++)windows.push(await counts(api,{start_date:shift(a.start_date,-7*week),end_date:shift(a.end_date,-7*week),filters:a.filters},events));
 const items=a.events.map((e,i)=>({event_name:e.event_name,event_type:e.event_type,event_filters:e.filters,events:healthAssessment(windows[0].values[2*i],windows.slice(1).map(w=>w.values[2*i]),a.minimum_baseline_count,a.change_threshold),users:healthAssessment(windows[0].values[2*i+1],windows.slice(1).map(w=>w.values[2*i+1]),a.minimum_baseline_count,a.change_threshold),events_per_user:ratio(windows[0].values[2*i],windows[0].values[2*i+1])}));
 return api.output({data:{items,windows:windows.map(w=>({range:w.range,counts:w.values})),rules:{baseline_weeks:a.baseline_weeks,minimum_baseline_count:a.minimum_baseline_count,change_threshold:a.change_threshold,filters:a.filters},count_order:events.map(e=>({event_name:e.event_name,indicator:e.indicator})),log_ids:windows.flatMap(w=>w.log_ids)}},{status:'success',resolved_time_range:range,query_method:'manual_tracking_health',sampling:'unknown',data_freshness:'unknown',warnings:['这是手动聚合检查，不代表埋点故障已确诊，也未排除整体流量变化。','阈值为可调整的探索规则；低基线不判异常，空结果不视为零。','区间人数分别查询，不累加每日UV；未独立确认采样及数据新鲜度。']});
}
export const qualityShape={...dates,event:eventSchema,property:propertySchema,filters,allowed_values:z.array(z.string().min(1).max(200)).min(1).max(10).optional(),required_when:z.array(filterSchema).max(5).default([]),numeric_bounds:z.object({min:z.number().finite().optional(),max:z.number().finite().optional()}).strict().refine(v=>(v.min!==undefined||v.max!==undefined)&&(v.min===undefined||v.max===undefined||v.min<=v.max),'至少提供一个上下限，且下限不能大于上限。').optional()};
export function qualityAssessment(values,allowed){
 const [total,missing,empty,present,...validCounts]=values;
 if(missing+present!==total||empty>present)throw new QueryError('INCONSISTENT_COUNTS','缺失与存在分区不守恒，不能计算质量比例。');
 const nonempty=present-empty,valid=allowed?validCounts.reduce((s,n)=>s+n,0):null;
 if(valid!==null&&valid>nonempty)throw new QueryError('INCONSISTENT_COUNTS','合法值计数超过非空分母，不能判定非法比例。');
 const invalid=valid===null?null:nonempty-valid;
 return {total_events:total,null_events:missing,empty_string_events:empty,missing_events:missing+empty,missing_rate:ratio(missing+empty,total),nonempty_events:nonempty,valid_events:valid,invalid_events:invalid,invalid_rate_among_nonempty:invalid===null?null:ratio(invalid,nonempty),status:total===0?'no_events':'measured'};
}
export async function checkPropertyQuality(api,input){
 const a=z.object(qualityShape).strict().parse(input);
 if(a.allowed_values&&a.numeric_bounds)throw new QueryError('INVALID_ARGUMENT','字符串白名单与数值范围不能混用。');
 if(a.allowed_values&&new Set(a.allowed_values).size!==a.allowed_values.length)throw new QueryError('INVALID_ARGUMENT','合法值不允许重复。');
 const metadata=a.numeric_bounds?await numericProperty(api,a.property):null;
 const f=(operator,values=[])=>({property:a.property,operator,values}),present=f('is_not_null');
 const parts=a.numeric_bounds?[[],[f('is_null')],[present],...(a.numeric_bounds.min!==undefined?[[present,f('<',[a.numeric_bounds.min])]]:[]),...(a.numeric_bounds.max!==undefined?[[present,f('>',[a.numeric_bounds.max])]]:[])]:[[],[f('is_null')],[present,f('=',[''])],[present],...(a.allowed_values??[]).map(v=>[present,f('!=',['']),f('=',[v])])];
 const es=parts.map(extra=>({...a.event,indicator:'events',filters:[...a.event.filters,...a.required_when,...extra]}));
 if(a.required_when.length)es.push({...a.event,indicator:'events'});
 const r=await counts(api,{start_date:a.start_date,end_date:a.end_date,filters:a.filters},es),values=[...r.values];
 const scopeTotal=a.required_when.length?values.pop():values[0];let stats;
 if(a.numeric_bounds){
  const [total,missing,presentCount,...outside]=values,invalid=outside.reduce((s,n)=>s+n,0);
  if(missing+presentCount!==total||invalid>presentCount)throw new QueryError('INCONSISTENT_COUNTS','数值缺失、存在与越界计数不守恒，无法计算比例。');
  stats={total_events:total,null_events:missing,empty_string_events:null,missing_events:missing,missing_rate:ratio(missing,total),nonempty_events:presentCount,valid_events:presentCount-invalid,invalid_events:invalid,invalid_rate_among_nonempty:ratio(invalid,presentCount),status:total===0?'no_events':'measured'};
 }else stats=qualityAssessment(values,a.allowed_values);
 if(scopeTotal<stats.total_events)throw new QueryError('INCONSISTENT_COUNTS','满足必填条件的事件数超过总体，请重新核对数据快照。');
 return api.output({data:{...stats,scope_total_events:scopeTotal,required_when:a.required_when,numeric_bounds:a.numeric_bounds??null,metadata,event:{...a.event,indicator:'events'},property:a.property,filters:a.filters,allowed_values:a.allowed_values??null,log_ids:r.log_ids}},{status:'success',resolved_time_range:r.range,query_method:'property_quality_partition_counts',sampling:'unknown',data_freshness:'unknown',warnings:['比例分母是满足事件筛选、整体筛选和 required_when 的事件次数；scope_total_events 是未加必填条件的次数。','数值上下限均含边界，只统计非null数值的越界；数值属性不单独判断空字符串。字符串缺失包含null与空串，不包含空白字符。','未提供合法规则时非法数量为未知；请求刷新缓存并校验分区守恒，不保证上游提供原子快照。']});
}
