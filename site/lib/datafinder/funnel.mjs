import {z} from 'zod/v4';
import {APP,QueryError} from './core.mjs';
import {eventSchema,filterSchema,freePlan,expression} from './analysis.mjs';
export const funnelShape={steps:z.array(eventSchema).min(2).max(8),start_date:z.string(),end_date:z.string(),window_days:z.number().int().min(1).max(7).optional(),window:z.object({value:z.number().int().min(1).max(10080),unit:z.enum(['minute','hour','day'])}).strict().optional(),filters:z.array(filterSchema).max(10).default([])};
export function funnelPlan(input,wide){
 const a=z.object(funnelShape).strict().parse(input);
 if(a.window&&a.window_days!==undefined)throw new QueryError('INVALID_ARGUMENT','window与window_days不能同时提供。');
 const window=a.window??{value:a.window_days??1,unit:'day'},seconds=window.value*{minute:60,hour:3600,day:86400}[window.unit];
 if(seconds>7*86400)throw new QueryError('INVALID_ARGUMENT','漏斗窗口最长7天。');
 if(a.steps.some(s=>s.indicator!=='event_users'))throw new QueryError('INVALID_ARGUMENT','有序漏斗固定使用去重人数。');
 const plan=freePlan({events:[a.steps[0]],start_date:a.start_date,end_date:a.end_date,granularity:'all',filters:a.filters},wide);
 if((plan.range.end_time+1+seconds)*1000>Date.now())throw new QueryError('IMMATURE_FUNNEL','结束日期后的转化窗口尚未完整结束，请提前结束日期或缩短窗口。');
 plan.dsl.content.query_type='funnel';
 plan.dsl.content.queries=[a.steps.map((e,i)=>({event_name:e.event_name,event_type:e.event_type,show_label:String(i+1),groups_v2:[],filters:e.filters.length?[{expression:expression(e.filters)}]:[]}))];
 plan.dsl.content.option={use_sample_data:false,refresh_cache:false,fusion:false,analysis_subject:{},is_parallel:false,statistics_mode:0,add_window_period:true,window_period:window.value,window_period_type:window.unit,window_type:1};
 return {...plan,args:a,window:{...window,seconds,mode:'rolling'}};
}
export function parseFunnel(raw,plan){
 const expectedDate=`${plan.range.start_date} 00:00:00-${plan.range.end_date} 23:59:59`;
 if(!Array.isArray(raw)||raw.length!==1)throw new QueryError('INCOMPLETE_RESULT','漏斗必须返回单个完整聚合子查询。');
 const r=raw[0],item=r.data_item_list?.[0];
 if(r.query_id!=='a00:p00:c00:q00'||r.result_status!=='SUCCESS'||r.is_truncated!==false||JSON.stringify(r.date_index_list)!==JSON.stringify([expectedDate])||r.data_item_list?.length!==1||item.group_by_key!=='__all')throw new QueryError('INCOMPLETE_RESULT','漏斗身份、日期或完整性未通过验证。');
 const summary=item.summary_list,detail=item.detail_list;
 const n=plan.args.steps.length;
 if(!Array.isArray(summary)||summary.length!==n+2||summary[0]!=='__all'||!Array.isArray(detail)||detail.length!==1||JSON.stringify(detail[0])!==JSON.stringify([expectedDate,...summary.slice(1)])||JSON.stringify(r.header_list?.slice(2))!==JSON.stringify(plan.event_labels??plan.args.steps.map(s=>s.event_name)))throw new QueryError('UNVERIFIED_CONTRACT','漏斗步骤或汇总结构无法匹配。');
 const counts=[summary[2],...summary.slice(3).map(v=>Array.isArray(v)?v[0]:null)];
 if(counts.some((v,i)=>!Number.isSafeInteger(v)||v<0||(i>0&&v>counts[i-1])))throw new QueryError('INCONSISTENT_COUNTS','有序人数漏斗计数必须非负且逐步不增加。');
 return plan.args.steps.map((s,i)=>({step:i+1,event_name:s.event_name,event_type:s.event_type,filters:s.filters,users:counts[i],conversion_from_first:counts[0]>0?counts[i]/counts[0]:null,conversion_from_previous:i>0&&counts[i-1]>0?counts[i]/counts[i-1]:null}));
}
export async function runFunnel(api,input,stepFilters=[]){
 const p=funnelPlan(input,api.env.DATAFINDER_ALLOW_PROJECT_WIDE==='true');
 if(stepFilters.length){const extra=expression(z.array(filterSchema).max(6).parse(stepFilters));for(const q of p.dsl.content.queries.flat())q.filters=[{expression:{logic:'and',expressions:[q.filters[0]?.expression??{logic:'and',conditions:[]},extra]}}];}
 const r=await api.request('POST','/openapi/v1/analysis',p.dsl,{}, {maxBytes:8_000_000});
 // The API may return metadata display names instead of event keys. Resolve exact aliases,
 // preserving requested order; never accept a same-length header on position alone.
 const header=r.data?.[0]?.header_list?.slice(2);
 if(Array.isArray(header)&&JSON.stringify(header)!==JSON.stringify(p.args.steps.map(s=>s.event_name))){
  const catalogs={};for(const type of new Set(p.args.steps.map(s=>s.event_type))){const c=await api.request('POST',`/openapi/v1/metadata/${APP}/list/${type==='virtual'?'virtual_events':'events'}`,{});if(!Array.isArray(c.data))throw new QueryError('UNVERIFIED_CONTRACT','漏斗事件别名目录无法核验。');catalogs[type]=c.data;}
  p.event_labels=p.args.steps.map((s,i)=>{if(header[i]===s.event_name)return s.event_name;const matches=catalogs[s.event_type].filter(x=>x.name===s.event_name);if(matches.length!==1||typeof matches[0].show_name!=='string'||header[i]!==matches[0].show_name)throw new QueryError('UNVERIFIED_CONTRACT','漏斗步骤标签与事件元数据不匹配。');return matches[0].show_name;});
 }
 return api.output({data:{steps:parseFunnel(r.data,p),definition:p.dsl.content},log_id:r.log_id},{status:p.args.window?'incomplete':'success',validation:p.args.window?'window_contract_unverified':'legacy_day_window',resolved_time_range:p.range,query_method:'ordered_user_funnel',window_days:p.window.seconds/86400,window:p.window,conversion_observation_end:new Date((p.range.end_time+p.window.seconds)*1000).toISOString(),sampling:'unknown',data_freshness:'unknown',warnings:[...(p.args.window?['自定义窗口参数已送达上游，但不同窗口样例结果相同；窗口是否生效尚待控制台对照。观察截止时间为请求口径，不证明上游按此计算。']:[]),'首步发生在所选日期内，后续步骤须有序且在首步后的指定时长内完成；观察范围会延伸到结束日期之后。','分母为原生有序漏斗人数，不等于独立事件UV；零分母转化率为未知。','窗口是滚动时长，不代表当天截止；仅有序、去重人数漏斗，未独立确认采样与新鲜度。']});
}
