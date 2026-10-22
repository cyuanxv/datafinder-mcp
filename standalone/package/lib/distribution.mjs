import {measureIntervals,userMeasure} from './user-measure.mjs';
import {frequencyIntervals,userFrequency} from './user-frequency.mjs';
import {z} from 'zod/v4';
import {APP,QueryError} from './core.mjs';
import {eventSchema,propertySchema,filterSchema,filterLeaves,freePlan} from './analysis.mjs';
import {numericProperty} from './metadata.mjs';
import {counts} from './health.mjs';
export const distributionShape={kind:z.enum(['numeric_event_distribution','composition','user_frequency','user_cumulative_measure']),start_date:z.string(),end_date:z.string(),event:eventSchema.optional(),property:propertySchema.optional(),granularity:z.enum(['day','all']).optional(),filters:z.array(filterSchema).max(10).default([]),boundaries:z.array(z.number().finite()).min(1).max(9).optional(),interval_closure:z.enum(['left_closed','right_closed']).optional(),limit:z.number().int().min(1).max(200).default(50)};
export function partitions(bounds){if(!bounds||bounds.some((x,i)=>i&&x<=bounds[i-1]))throw new QueryError('INVALID_ARGUMENT','边界必须严格递增。');return Array.from({length:bounds.length+1},(_,i)=>({lower:i?bounds[i-1]:null,upper:i<bounds.length?bounds[i]:null}));}
export function validateDistribution(input){
 const a=z.object(distributionShape).strict().parse(input);
 if(a.interval_closure!==undefined&&a.kind!=='numeric_event_distribution')throw new QueryError('INVALID_ARGUMENT','开闭方式仅适用于单次事件值分布。');
 if(['user_frequency','user_cumulative_measure'].includes(a.kind)){
  if(!a.event||a.event.indicator!=='event_users')throw new QueryError('INVALID_ARGUMENT','用户分布需要事件，统计口径固定去重用户。');
  if(a.kind==='user_frequency'){if(a.property)throw new QueryError('INVALID_ARGUMENT','频次分布不接受数值属性。');frequencyIntervals(a.boundaries);}
  else {if(a.property?.property_type!=='event_param')throw new QueryError('INVALID_ARGUMENT','累计分布需要数值事件属性。');measureIntervals(a.boundaries);}
  return {...a,granularity:a.granularity??'day'};
 }
 if(a.granularity!==undefined)throw new QueryError('INVALID_ARGUMENT','单次事件分布和成分分析不接受粒度参数。');
 if(!a.property)throw new QueryError('INVALID_ARGUMENT','此分析需要属性。');
 if(a.kind==='numeric_event_distribution'){
  if(!a.event||!['event_param','common_param'].includes(a.property.property_type))throw new QueryError('INVALID_ARGUMENT','单次事件分布需要事件及事件/公共数值属性。');
  partitions(a.boundaries);
 }else if(a.event||a.boundaries||!['profile','user_profile'].includes(a.property.property_type)||a.property.property_compose_type!=='origin'||filterLeaves(a.filters).some(f=>!['profile','user_profile'].includes(f.property.property_type)))throw new QueryError('INVALID_ARGUMENT','成分分析仅支持原始用户属性和用户属性筛选。');
 return a;
}
export async function runDistribution(api,input){const a=validateDistribution(input);
 if(a.interval_closure!==undefined&&a.kind!=='numeric_event_distribution')throw new QueryError('INVALID_ARGUMENT','interval_closure仅用于单次事件数值分布；用户频次和累计值分布固定右闭。');
 if(a.kind==='user_frequency')return userFrequency(api,a);
 if(a.kind==='user_cumulative_measure')return userMeasure(api,a);
 if(!a.property)throw new QueryError('INVALID_ARGUMENT','此分析需要property。');
 if(input.granularity!==undefined)throw new QueryError('INVALID_ARGUMENT','granularity仅用于用户频次分布。');
 if(a.kind==='numeric_event_distribution'){
  if(!a.event||!a.boundaries)throw new QueryError('INVALID_ARGUMENT','数值分布需要事件和区间边界。');
  if(!['event_param','common_param'].includes(a.property.property_type))throw new QueryError('INVALID_ARGUMENT','此分布统计事件属性值，不是每用户累计值。');
  const right=a.interval_closure==='right_closed';
  const bins=partitions(a.boundaries),metadata=await numericProperty(api,a.property),f=(operator,values=[])=>({property:a.property,operator,values});
  const queries=[[],[f('is_null')],...bins.map(b=>[f('is_not_null'),...(b.lower!==null?[f(right?'>':'>=',[b.lower])]:[]),...(b.upper!==null?[f(right?'<=':'<',[b.upper])]:[])])].map(extra=>({...a.event,indicator:'events',filters:[...a.event.filters,...extra]}));
  const r=await counts(api,{start_date:a.start_date,end_date:a.end_date,filters:a.filters},queries),[total,missing,...values]=r.values;
  if(missing+values.reduce((s,n)=>s+n,0)!==total)throw new QueryError('INCONSISTENT_COUNTS','区间总和与总事件次数不一致。');
  return api.output({data:{rows:bins.map((b,i)=>({...b,interval:right?'lower_exclusive_upper_inclusive':'lower_inclusive_upper_exclusive',events:values[i],share_of_all_events:total?values[i]/total:null})),total_events:total,null_events:missing,metadata,event:{...a.event,indicator:'events'},property:a.property,filters:a.filters},log_id:r.log_ids?.[0]},{status:'success',validation:'verified_partition_counts',resolved_time_range:r.range,query_method:'numeric_event_distribution',warnings:['按单次事件属性值分桶，统计事件次数；不是每用户频次、累计时长或累计金额的人数分布。',`空值单列，区间${right?'左开右闭':'左闭右开'}；没有数据时比例为null。`]});
 }
 if(a.event||a.boundaries||!['profile','user_profile'].includes(a.property.property_type)||a.property.property_compose_type!=='origin'||filterLeaves(a.filters).some(f=>!['profile','user_profile'].includes(f.property.property_type)))throw new QueryError('INVALID_ARGUMENT','成分分析仅接受原始用户属性分组与用户属性筛选。');
 const meta=await api.request('POST',`/openapi/v1/metadata/${APP}/list/user_profiles`,{});
 if(!Array.isArray(meta.data)||!meta.data.some(x=>x.name===a.property.property_name&&['string','int','float','version'].includes(x.value_type)))throw new QueryError('PROPERTY_TYPE_MISMATCH','成分属性不存在或不是可分组的标量属性。');
 const p=freePlan({events:[{event_name:'any_event'}],start_date:a.start_date,end_date:a.end_date,granularity:'all',filters:a.filters},api.env.DATAFINDER_ALLOW_PROJECT_WIDE==='true');
 p.dsl.content.query_type='composition';p.dsl.content.queries=[[{event_type:'none'}]];p.dsl.content.profile_groups_v2=[a.property];p.dsl.content.page={limit:a.limit,offset:0};p.dsl.content.option.refresh_cache=true;
 const r=await api.request('POST','/openapi/v1/analysis',p.dsl),x=r.data?.[0];
 if(r.data?.length!==1||x.query_id!=='a00:p00:c00:q00'||x.result_status!=='SUCCESS'||x.is_truncated!==false||!Array.isArray(x.data_item_list))throw new QueryError('INCOMPLETE_RESULT','成分分析失败、截断或身份无法核验。');
 const seen=new Set();const rows=x.data_item_list.map(i=>{const v=i.profile_params?.[a.property.property_name];if(v===undefined||!Number.isSafeInteger(i.data)||i.data<0||seen.has(JSON.stringify(v)))throw new QueryError('UNVERIFIED_CONTRACT','成分分组或计数不匹配。');seen.add(JSON.stringify(v));return {value:v,users:i.data};});
 return api.output({data:{rows,property:a.property,filters:a.filters,date_index_list:x.date_index_list??[],returned_user_sum:rows.reduce((s,x)=>s+x.users,0),share:null},log_id:r.log_id},{status:'incomplete',validation:'date_and_population_not_independently_verified',requested_time_range:p.range,query_method:'composition',warnings:['上游返回人数分组，但本批尚未独立核验日期范围和总体分母；不据此计算成分占比或下业务结论。','用户属性口径不同于事件发生时属性；当前结果最多返回指定limit组。']});
}
