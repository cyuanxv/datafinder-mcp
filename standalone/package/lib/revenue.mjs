import {QueryError,normalizeResults} from './core.mjs';
import {freePlan,executeAnalysis,validateAnalysis} from './analysis.mjs';
import {numericProperty} from './metadata.mjs';
import {counts} from './health.mjs';

export function revenueFactors(before,after){
  if(![before,after].every(x=>Number.isSafeInteger(x.users)&&x.users>=0&&Number.isFinite(x.amount)&&x.amount>=0))throw new QueryError('INCONSISTENT_COUNTS','金额和人数必须是有效非负聚合。');
  if([before,after].some(x=>x.users===0&&x.amount!==0))throw new QueryError('INCONSISTENT_COUNTS','零支付人数却存在金额，无法拆解。');
  const totalChange=after.amount-before.amount;
  if(!before.users||!after.users)return {total_change:totalChange,payer_contribution:null,amount_per_payer_contribution:null,status:'zero_denominator'};
  const b=before.amount/before.users,c=after.amount/after.users;
  // Symmetric two-order decomposition allocates the interaction equally.
  const payer=(after.users-before.users)*(b+c)/2;
  const perPayer=(c-b)*(before.users+after.users)/2;
  return {total_change:totalChange,payer_contribution:payer,amount_per_payer_contribution:perPayer,residual:totalChange-payer-perPayer,status:'descriptive',method:'symmetric_product_decomposition',causal:false};
}

export async function revenueMetrics(api,a){
  if(a.events.length!==1||a.revenue_property.property_type!=='event_param')throw new QueryError('INVALID_ARGUMENT','金额分析需要一个支付事件和事件数值属性。');
  const metadata=await numericProperty(api,a.revenue_property),event=a.events[0];
  const countResult=await counts(api,{...a.period,filters:a.filters},[
    {...event,indicator:'events'}, {...event,indicator:'event_users'},
    {...event,indicator:'events',filters:[...event.filters,{property:a.revenue_property,operator:'is_null',values:[]}]},
    {...event,indicator:'events',filters:[...event.filters,{property:a.revenue_property,operator:'<',values:[0]}]},
  ]);
  const [events,users,missing,negative]=countResult.values;
  if(users>events||missing>events||negative>events||missing+negative>events)throw new QueryError('INCONSISTENT_COUNTS','支付事件聚合不一致。');
  if(missing||negative)throw new QueryError('UNVERIFIED_REVENUE','存在缺失或负金额；请先确认退款与金额口径，不能直接进行收入拆解。');
  const plan=freePlan({events:[event],...a.period,filters:a.filters,granularity:'all'},api.env.DATAFINDER_ALLOW_PROJECT_WIDE==='true');
  const q=plan.dsl.content.queries[0][0];
  q.event_indicator='measure';q.measure_info={measure_type:'sum',...a.revenue_property};
  plan.dsl.content.option.refresh_cache=true;
  const raw=await executeAnalysis(api,plan.dsl),results=normalizeResults(raw.data);
  if(results.length!==1||validateAnalysis(results,plan.dsl,plan.range).status!=='verified'||results[0].is_truncated!==false||results[0].series.length!==1||results[0].series[0].data?.length!==1)throw new QueryError('INCOMPLETE_RESULT','金额聚合身份、日期或完整性无法核验。');
  const amount=results[0].series[0].data[0];
  if(!Number.isFinite(amount)||amount<0||(!users&&amount!==0))throw new QueryError('UNVERIFIED_REVENUE','金额总和未知或与支付人数矛盾，不补零。');
  return {range:plan.range,events,users,amount,amount_per_payer:users?amount/users:null,amount_per_event:events?amount/events:null,missing_amount_events:missing,negative_amount_events:negative,metadata,log_ids:[...countResult.log_ids,...raw.log_ids],sample_status:users<a.minimum_users?'small_sample':'sufficient_for_descriptive_review'};
}
