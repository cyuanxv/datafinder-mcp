import {QueryError} from './core.mjs';
import {freePlan,executeAnalysis} from './analysis.mjs';
import {numericProperty} from './metadata.mjs';
import {counts} from './health.mjs';
import {parseFrequency} from './user-frequency.mjs';

export function measureIntervals(boundaries){
 if(!boundaries?.length||boundaries.some((n,i)=>!Number.isFinite(n)||n<0||(i>0&&n<=boundaries[i-1])))throw new QueryError('INVALID_ARGUMENT','累计数值边界必须是严格递增的非负数，单位与源属性一致。');
 return [...boundaries.map((n,i)=>`(${i?boundaries[i-1]:'-INF'},${n}]`),`(${boundaries.at(-1)},INF)`];
}
export async function userMeasure(api,a){
 if(!a.event||a.event.indicator!=='event_users'||a.property?.property_type!=='event_param')throw new QueryError('INVALID_ARGUMENT','累计数值分布需要一个事件和原始数值事件属性，不能自选事件指标。');
 const intervals=measureIntervals(a.boundaries),metadata=await numericProperty(api,a.property);
 const quality=await counts(api,{start_date:a.start_date,end_date:a.end_date,filters:a.filters},[
  {...a.event,indicator:'events',filters:[...a.event.filters,{property:a.property,operator:'is_null',values:[]}]},
  {...a.event,indicator:'events',filters:[...a.event.filters,{property:a.property,operator:'<',values:[0]}]},
 ]);
 if(quality.values.some(n=>n>0))throw new QueryError('UNVERIFIED_MEASURE','存在缺失或负数事件属性，无法确认累计值总体；请先核对或明确筛选条件，未自动排除。');
 const plan=freePlan({events:[a.event],start_date:a.start_date,end_date:a.end_date,filters:a.filters,granularity:a.granularity,limit:100},api.env.DATAFINDER_ALLOW_PROJECT_WIDE==='true');
 plan.dsl.content.query_type='distribution';
 const q=plan.dsl.content.queries[0][0];q.event_indicator='measure';q.measure_info={measure_type:'sum',...a.property};
 plan.dsl.content.option={use_sample_data:false,refresh_cache:true,fusion:false,analysis_subject:{},distribution_interval:intervals};
 const raw=await executeAnalysis(api,plan.dsl);
 const totalPlan=structuredClone(plan.dsl);totalPlan.content.query_type='event';totalPlan.content.queries[0][0].event_indicator='event_users';delete totalPlan.content.queries[0][0].measure_info;delete totalPlan.content.option.distribution_interval;
 const totals=await executeAnalysis(api,totalPlan),rows=parseFrequency(raw.data,plan,intervals,totals.data);
 return api.output({data:{rows,event:a.event,property:a.property,aggregation:'sum_per_user',unit:'source_property_unit',filters:a.filters,granularity:a.granularity,metadata,missing_value_events:quality.values[0],negative_value_events:quality.values[1],population:'users_who_triggered_the_event',non_event_users_included:false},log_id:raw.log_ids?.[0]},{status:'success',resolved_time_range:plan.range,query_method:'user_cumulative_measure_distribution',validation:'date_bin_identity_and_independent_user_total_verified',warnings:['先按每位用户在统计周期内累计属性值，再统计各区间用户数；区间左开右闭，尾区间为大于上界。','金额、时长等单位沿用源属性，不自动换算、扣退款或按订单去重；不据此称为净收入。','仅含触发事件用户；日人数不能相加作为区间去重人数。桶总人数守恒不等于已逐用户或控制台核验累计语义。']});
}
