import {QueryError,normalizeResults} from './core.mjs';
import {freePlan,executeAnalysis} from './analysis.mjs';
import {counts} from './health.mjs';

export function hourKeys(range){return Array.from({length:(range.end_time-range.start_time+1)/3600},(_,i)=>new Date((range.start_time+i*3600+28800)*1000).toISOString().slice(0,13).replace(/[-T:]/g,''));}
export function parseHourly(raw,plan){
 const results=normalizeResults(raw),expected=hourKeys(plan.range),ids=new Set();
 if(results.length!==plan.dsl.content.queries.length)throw new QueryError('INCOMPLETE_RESULT','小时查询子查询数量不匹配。');
 for(const r of results){if(ids.has(r.query_id))throw new QueryError('INCOMPLETE_RESULT','小时查询标识重复。');ids.add(r.query_id);}
 return plan.dsl.content.queries.map((q,i)=>{
  const r=results.find(x=>x.query_id===`a00:p00:c00:q${String(i).padStart(2,'0')}`);
  if(!r||r.result_status!=='SUCCESS'||r.is_truncated!==false||r.series?.length!==1)throw new QueryError('INCOMPLETE_RESULT','小时查询身份或完整性无法验证。');
  const dates=r.date_index_list?.map(d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2} \d{2}:00:00$/.test(d)?d.slice(0,13).replace(/[- :]/g,''):d);
  if(JSON.stringify(dates)!==JSON.stringify(expected))throw new QueryError('UNVERIFIED_HOURLY_DATES','小时日期序列缺失、粒度或时区未核验；不分摊日数据、不补零。');
  const values=r.series[0].data;
  if(!Array.isArray(values)||values.length!==expected.length||values.some(n=>!Number.isSafeInteger(n)||n<0))throw new QueryError('INCOMPLETE_RESULT','小时事件数缺失或无效。');
  return {event_name:q[0].event_name,event_type:q[0].event_type,points:expected.map((date,j)=>({date:date.slice(0,8),hour:Number(date.slice(8)),events:values[j]}))};
 });
}
export async function hourlyPatterns(api,a){
 const plan=freePlan({events:a.events.map(e=>({...e,indicator:'events'})),...a.period,filters:a.filters,granularity:'day'},api.env.DATAFINDER_ALLOW_PROJECT_WIDE==='true');
 if(plan.range.end_time-plan.range.start_time>=7*86400||a.events.length>3)throw new QueryError('INVALID_ARGUMENT','小时规律一次最多7个完整自然日、3个事件，防止上游自动缩短日期。');
 plan.dsl.periods[0].granularity='hour';plan.dsl.content.option.refresh_cache=true;
 const raw=await executeAnalysis(api,plan.dsl),rows=parseHourly(raw.data,plan);
 const total=await counts(api,{...a.period,filters:a.filters},a.events.map(e=>({...e,indicator:'events'})));
 rows.forEach((r,i)=>{if(r.points.reduce((n,p)=>n+p.events,0)!==total.values[i])throw new QueryError('INCONSISTENT_COUNTS','小时事件次数与独立区间总数不守恒。');});
 return {timezone:plan.range.timezone,metric:'event_count',rows:rows.map((r,i)=>({...r,total_events:total.values[i],hour_of_day:Array.from({length:24},(_,hour)=>{const points=r.points.filter(p=>p.hour===hour),sum=points.reduce((n,p)=>n+p.events,0);return {hour,observed_days:points.length,total_events:sum,mean_events:points.length?sum/points.length:null};})})),validation:'complete_hour_sequence_and_interval_event_total',users_additive:false,log_ids:[...raw.log_ids,...total.log_ids]};
}
