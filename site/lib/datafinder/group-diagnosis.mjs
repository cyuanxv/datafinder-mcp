import {QueryError,normalizeResults} from './core.mjs';
import {freePlan,executeAnalysis,validateAnalysis} from './analysis.mjs';
import {counts} from './health.mjs';

function groupIdentity(series,properties){
 return properties.map(property=>{
  const bucket={common_param:'common_params',event_param:'event_params',profile:'profile_params',user_profile:'profile_params'}[property.property_type];
  if(!series[bucket]||!Object.hasOwn(series[bucket],property.property_name))throw new QueryError('UNVERIFIED_GROUP','分组属性身份缺失。');
  const value=series[bucket][property.property_name];
  if(value!==null&&!['string','number','boolean'].includes(typeof value)||typeof value==='number'&&!Number.isFinite(value))throw new QueryError('UNVERIFIED_GROUP','分组值必须是有限标量或显式null。');
  return {property,value};
 });
}
export function groupedMetrics(raw,plan,properties,total){
 const results=normalizeResults(raw);
 if(results.length!==2||validateAnalysis(results,plan.dsl,plan.range).status!=='verified')throw new QueryError('INCOMPLETE_RESULT','分组次数和人数子查询未完整返回。');
 const whole=[`${plan.range.start_date} 00:00:00-${plan.range.end_date} 23:59:59`];
 const maps=[0,1].map(i=>{
  const r=results.find(x=>x.query_id===`a00:p00:c00:q0${i}`);
  if(r.is_truncated!==false||r.series.length>=1000||JSON.stringify(r.date_index_list)!==JSON.stringify(whole))throw new QueryError('INCOMPLETE_RESULT','区间分组截断或返回了日数据，不能累加UV。');
  const map=new Map();
  for(const s of r.series){
   const group=groupIdentity(s,properties),key=JSON.stringify(group),value=s.data?.[0];
   if(map.has(key)||s.data?.length!==1||!Number.isSafeInteger(value)||value<0)throw new QueryError('UNVERIFIED_GROUP','分组重复或计数无效。');
   map.set(key,{group,value});
  }return map;
 });
 if(maps[0].size!==maps[1].size||[...maps[0].keys()].some(k=>!maps[1].has(k)))throw new QueryError('INCOMPLETE_RESULT','人数和次数的分组集合不一致。');
 const rows=[...maps[0]].map(([key,x])=>({key,group:x.group,events:x.value,users:maps[1].get(key).value}));
 if(rows.some(r=>r.users>r.events||r.users>total.users)||rows.reduce((s,r)=>s+r.events,0)!==total.events||rows.reduce((s,r)=>s+r.users,0)<total.users)throw new QueryError('INCONSISTENT_COUNTS','分组计数与独立总体不一致。');
 const sum=rows.reduce((s,r)=>s+r.users,0);
 return {rows,total,group_user_sum:sum,overlap_excess:sum-total.users,overlap:sum>total.users?'overlapping_memberships_observed':'no_overlap_observed_in_counts'};
}
export async function queryGroupedMetrics(api,a){
 const events=[{...a.events[0],indicator:'events'},{...a.events[0],indicator:'event_users'}];
 const plan=freePlan({events,...a.period,filters:a.filters,group_by:a.group_by,granularity:'all',limit:1000},api.env.DATAFINDER_ALLOW_PROJECT_WIDE==='true');
 plan.dsl.content.option.refresh_cache=true;
 const raw=await executeAnalysis(api,plan.dsl),total=await counts(api,{...a.period,filters:a.filters},events);
 return {...groupedMetrics(raw.data,plan,a.group_by,{events:total.values[0],users:total.values[1]}),log_ids:[...raw.log_ids,...total.log_ids]};
}
export function compareGroups(before,after,minimum){
 const b=new Map(before.rows.map(r=>[r.key,r])),c=new Map(after.rows.map(r=>[r.key,r]));
 const rows=[...new Set([...b.keys(),...c.keys()])].map(key=>{
  const x=b.get(key),y=c.get(key),bu=x?.users??0,cu=y?.users??0;
  return {group:(x??y).group,baseline_users:bu,current_users:cu,users_change:cu-bu,relative_users_change:bu?(cu-bu)/bu:null,baseline_events:x?.events??0,current_events:y?.events??0,events_change:(y?.events??0)-(x?.events??0),sample_status:Math.min(bu,cu)<minimum?'small_sample':'sufficient_for_descriptive_review',missing_group_policy:'zero_only_after_complete_event_partitions_and_matching_uv_groups'};
 });
 return {rows,ranked_changes:rows.filter(r=>r.sample_status!=='small_sample').sort((a,b)=>Math.abs(b.users_change)-Math.abs(a.users_change)),baseline_total:before.total,current_total:after.total,baseline_overlap:before.overlap,current_overlap:after.overlap,uv_contribution_additive:false,interpretation:'按各群体人数绝对变化排序，群体可能重叠，不是总体UV的可加总贡献，也不证明统计显著性或因果。'};
}
