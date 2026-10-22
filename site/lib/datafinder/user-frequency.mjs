import {QueryError,normalizeResults} from './core.mjs';
import {freePlan,executeAnalysis,validateAnalysis} from './analysis.mjs';

export function frequencyIntervals(boundaries){
 if(!boundaries?.length||boundaries.some((n,i)=>!Number.isSafeInteger(n)||n<1||(i>0&&n<=boundaries[i-1])))throw new QueryError('INVALID_ARGUMENT','频次边界必须是严格递增的正整数。');
 return [...boundaries.map((n,i)=>`(${i?boundaries[i-1]:'-INF'},${n}]`),`(${boundaries.at(-1)},INF)`];
}
export function parseFrequency(raw,plan,intervals,totals){
 const rows=normalizeResults(raw),totalRows=normalizeResults(totals);
 for(const result of [rows,totalRows])if(result.length!==1||validateAnalysis(result,plan.dsl,plan.range).status!=='verified'||result[0].is_truncated!==false)throw new QueryError('INCOMPLETE_RESULT','频次分布或独立人数的身份、日期、完整性未通过验证。');
 const r=raw[0],t=totals[0];
 // Never accept a day series for an interval request, or silently sum daily UV.
 const days=Array.from({length:(plan.range.end_time-plan.range.start_time+1)/86400},(_,i)=>new Date((plan.range.start_time+86400*i+8*3600)*1000).toISOString().slice(0,10).replaceAll('-',''));
 const dates=plan.dsl.periods[0].granularity==='day'?days:[`${plan.range.start_date} 00:00:00-${plan.range.end_date} 23:59:59`];
 if(JSON.stringify(r.date_index_list)!==JSON.stringify(dates)||JSON.stringify(t.date_index_list)!==JSON.stringify(dates)||JSON.stringify(r.distribution_list)!==JSON.stringify(intervals)||t.data_item_list?.length!==1||t.data_item_list[0].group_by_key!=='__all')throw new QueryError('UNVERIFIED_CONTRACT','频次分布日期粒度、区间或总人数身份不匹配。');
 const map=new Map();
 for(const s of r.data_item_list??[]){
  const key=s.origin_event_indicator_params?.distribution;
  if(!intervals.includes(key)||map.has(key)||!Array.isArray(s.data)||s.data.length!==dates.length||s.data.some(n=>!Number.isSafeInteger(n)||n<0))throw new QueryError('UNVERIFIED_CONTRACT','频次区间重复、身份缺失或人数无效。');
  map.set(key,s.data);
 }
 if(map.size!==intervals.length)throw new QueryError('INCOMPLETE_RESULT','频次分桶缺失，不能补零。');
 const total=t.data_item_list[0].data;
 if(!Array.isArray(total)||total.length!==dates.length||total.some(n=>!Number.isSafeInteger(n)||n<0))throw new QueryError('INCOMPLETE_RESULT','独立去重人数缺失或无效。');
 return dates.map((date,i)=>{
  if(intervals.reduce((sum,key)=>sum+map.get(key)[i],0)!==total[i])throw new QueryError('INCONSISTENT_COUNTS','分桶人数之和与相同条件的独立去重人数不一致。');
  return {date,event_users:total[i],bins:intervals.map(interval=>({interval,users:map.get(interval)[i],share:total[i]?map.get(interval)[i]/total[i]:null}))};
 });
}
export async function userFrequency(api,a){
 if(!a.event||a.property||a.event.indicator!=='event_users')throw new QueryError('INVALID_ARGUMENT','用户频次分布需要一个事件，不能传属性或自选事件指标。');
 const intervals=frequencyIntervals(a.boundaries),plan=freePlan({events:[{...a.event,indicator:'events'}],start_date:a.start_date,end_date:a.end_date,filters:a.filters,granularity:a.granularity,limit:100},api.env.DATAFINDER_ALLOW_PROJECT_WIDE==='true');
 plan.dsl.content.query_type='distribution';
 plan.dsl.content.option={use_sample_data:false,refresh_cache:true,fusion:false,analysis_subject:{},distribution_interval:intervals};
 const distribution=await executeAnalysis(api,plan.dsl);
 const totalPlan=structuredClone(plan.dsl);totalPlan.content.query_type='event';totalPlan.content.queries[0][0].event_indicator='event_users';delete totalPlan.content.option.distribution_interval;
 const totals=await executeAnalysis(api,totalPlan);
 const rows=parseFrequency(distribution.data,plan,intervals,totals.data);
 return api.output({data:{rows,event:a.event,filters:a.filters,granularity:a.granularity,population:'users_who_triggered_the_event',zero_frequency_population_included:false},log_id:distribution.log_ids?.[0]},{status:'success',resolved_time_range:plan.range,query_method:'user_event_frequency',validation:'date_bin_identity_and_independent_user_total_verified',warnings:['按每个统计周期内用户触发该事件的累计次数分桶，区间右闭左开。','分母仅为触发过事件的用户；不包含零次用户。日粒度不能累加为区间去重人数。','总人数守恒不代表已逐用户验证分桶或采样；没有读取用户明细。']});
}
