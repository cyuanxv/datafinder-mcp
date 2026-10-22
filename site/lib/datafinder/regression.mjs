import {z} from 'zod/v4';
import {QueryError} from './core.mjs';
import {eventSchema,filterSchema,filterLeaves,propertySchema} from './analysis.mjs';
import {counts,checkPropertyQuality,qualityShape} from './health.mjs';
import {runFunnel} from './funnel.mjs';
export const regressionShape={start_date:z.string(),end_date:z.string(),version_property:propertySchema,old_version:z.string().min(1).max(100),new_version:z.string().min(1).max(100),controls:z.array(filterSchema).max(5).default([]),events:z.array(eventSchema).min(1).max(3),funnel_steps:z.array(eventSchema).min(2).max(8).optional(),window_days:z.number().int().min(1).max(7).default(1),quality:z.object({event:eventSchema,property:propertySchema,allowed_values:qualityShape.allowed_values,numeric_bounds:qualityShape.numeric_bounds,required_when:qualityShape.required_when}).strict().optional(),minimum_events:z.number().int().min(1).max(100000).default(100),minimum_users:z.number().int().min(1).max(100000).default(100)};
export function compareMetric(oldValue,newValue,eligible=true){return {old:oldValue,new:newValue,absolute_change:oldValue===null||newValue===null?null:newValue-oldValue,relative_change:oldValue===null||newValue===null||oldValue===0?null:(newValue-oldValue)/oldValue,assessment:eligible?'descriptive_comparison':'insufficient_sample'};}
export async function compareVersions(api,input){
 const a=z.object(regressionShape).strict().parse(input);
 if(a.old_version===a.new_version)throw new QueryError('INVALID_ARGUMENT','新旧版本必须不同。');
 if(a.version_property.property_type!=='common_param'||a.version_property.property_compose_type!=='origin')throw new QueryError('INVALID_ARGUMENT','版本必须使用事件发生时的原始公共属性，不能用用户最新属性代替历史版本。');
 const sameVersion=f=>f.property.property_name===a.version_property.property_name;
 if(filterLeaves([...a.controls,...a.events.flatMap(e=>e.filters),...(a.funnel_steps??[]).flatMap(e=>e.filters),...(a.quality?.event.filters??[]),...(a.quality?.required_when??[])]).some(sameVersion))throw new QueryError('INVALID_ARGUMENT','版本条件由对比工具统一添加，不能在其他筛选中重复限制。');
 const sides=[];
 for(const version of [a.old_version,a.new_version]){
  const filters=[...a.controls,{property:a.version_property,operator:'=',values:[version]}];
  const metrics=await counts(api,{start_date:a.start_date,end_date:a.end_date,filters},a.events.flatMap(e=>[{...e,indicator:'events'},{...e,indicator:'event_users'}]));
  const funnel=a.funnel_steps?await runFunnel(api,{start_date:a.start_date,end_date:a.end_date,steps:a.funnel_steps,window_days:a.window_days,filters},filters):null;
  const quality=a.quality?await checkPropertyQuality(api,{...a.quality,start_date:a.start_date,end_date:a.end_date,filters}):null;
  if(metrics.values.some((v,i)=>i%2===1&&v>metrics.values[i-1]))throw new QueryError('INCONSISTENT_COUNTS','区间人数超过事件次数，无法确认版本计数。');
  sides.push({version,metrics:metrics.values,funnel:funnel?.data.steps??null,quality:quality?.data??null,query_refs:[funnel?.query_ref,quality?.query_ref].filter(Boolean)});
 }
 const [old,newer]=sides,events=a.events.map((e,i)=>{const enough=Math.min(old.metrics[i*2+1],newer.metrics[i*2+1])>=a.minimum_users;return {event:e,users:compareMetric(old.metrics[i*2+1],newer.metrics[i*2+1],enough),events:compareMetric(old.metrics[i*2],newer.metrics[i*2],enough),events_per_user:compareMetric(old.metrics[i*2+1]?old.metrics[i*2]/old.metrics[i*2+1]:null,newer.metrics[i*2+1]?newer.metrics[i*2]/newer.metrics[i*2+1]:null,enough)};});
 const funnel=old.funnel?.map((s,i)=>({step:i+1,event_name:s.event_name,users:compareMetric(s.users,newer.funnel[i].users,Math.min(old.funnel[0].users,newer.funnel[0].users)>=a.minimum_users),conversion_from_first:compareMetric(s.conversion_from_first,newer.funnel[i].conversion_from_first,Math.min(old.funnel[0].users,newer.funnel[0].users)>=a.minimum_users)}))??null;
 const quality=old.quality?{old:old.quality,new:newer.quality,missing_rate:compareMetric(old.quality.missing_rate,newer.quality.missing_rate,Math.min(old.quality.total_events,newer.quality.total_events)>=a.minimum_events),sample_basis:'eligible_event_count'}:null;
 return api.output({data:{events,funnel,quality,cohorts:{old_version:a.old_version,new_version:a.new_version,version_property:a.version_property,controls:a.controls,minimum_users:a.minimum_users,minimum_events:a.minimum_events},query_refs:sides.flatMap(s=>s.query_refs)}},{status:'success',query_method:'version_regression_descriptive',resolved_time_range:{start_date:a.start_date,end_date:a.end_date,timezone:'Asia/Shanghai'},sampling:'unknown',data_freshness:'unknown',warnings:['同日期、同显式控制条件比较；未提供的渠道/平台条件未被控制，也未按流量结构重加权。','用户可能跨版本出现，两个版本不是互斥随机实验，差异不构成版本因果结论。','漏斗所有步骤均应用版本和控制条件，跨版本升级后的步骤不会计入同版本转化。','数量受版本流量规模影响；比率变化 absolute_change 使用0至1单位，不是百分数。质量样本门槛使用事件数。',...(a.controls.length?[]:['本次没有显式控制条件，流量混杂未排除。'])]});
}
