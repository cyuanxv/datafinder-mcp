import {validateDistribution,runDistribution} from './distribution.mjs';
import {funnelPlan,runFunnel} from './funnel.mjs';
import {evaluatePolicy} from './inspection-policy.mjs';
import {validateRulePolicy} from './governance.mjs';
import {z} from 'zod/v4';
import {APP,QueryError,dateRange} from './core.mjs';
import {propertySchema,eventSchema,freePlan,runAnalysis,queryReportAdaptive,inspectPropertyValues,propertyShape} from './analysis.mjs';
import {advancedPlan,runAdvanced} from './advanced.mjs';
import {ruleSchema,metricSource} from './governance.mjs';
import {templateSchema} from './templates.mjs';
import {checkTrackingHealth,checkPropertyQuality} from './health.mjs';
export const catalogSchema=z.object({kind:z.enum(['events','params','user_profiles','virtual_events','virtual_params']),keyword:z.string().max(100).default(''),page:z.number().int().min(1).max(1000).default(1)}).strict();
export async function editorCatalog(api,input){
 const a=catalogSchema.parse(input),r=await api.request('POST',`/openapi/v1/metadata/${APP}/list/${a.kind}`,{});
 if(!Array.isArray(r.data)||r.data.some(x=>typeof x?.name!=='string'))throw new QueryError('UNVERIFIED_CONTRACT','元数据列表结构无法验证。');
 const event=a.kind.endsWith('events'),virtual=a.kind.startsWith('virtual'),items=[];
 for(const x of r.data){const property_type=a.kind==='user_profiles'?'user_profile':x.type===2||x.property_type===2?'common_param':x.type===1||x.property_type===1?'event_param':null;
 const selector=event?{event_name:x.name,event_type:virtual?'virtual':'origin'}:{property_name:x.name,property_type,property_compose_type:virtual?'virtual':'origin'};
 if(!(event?eventSchema:propertySchema).safeParse(selector).success)continue;
 if(!`${x.name} ${x.show_name??''} ${x.description??''}`.toLowerCase().includes(a.keyword.toLowerCase()))continue;
 items.push({name:x.name,show_name:x.show_name??null,value_type:x.value_type??null,selector});}
 items.sort((a,b)=>a.name.localeCompare(b.name));return {items:items.slice((a.page-1)*25,a.page*25),has_more:a.page*25<items.length,page:a.page,source_complete:'unknown',scope:'配置应用元数据；未返回不代表不存在'};
}
export function parseDraft(kind,payload){
 if(kind==='rule'){const d=ruleSchema.parse(payload);validateRulePolicy(d);if(d.kind==='health'&&d.config.events.some(x=>x.indicator!=='event_users'))throw new QueryError('INVALID_ARGUMENT','健康检查固定统计次数与人数。');return d;}
 const d=templateSchema.parse(payload);const a={...d.config,start_date:'2020-01-01',end_date:'2020-01-01'};
 if(d.kind==='distribution')validateDistribution(a);if(d.kind==='funnel')funnelPlan(a,true);
 if(d.kind==='advanced')advancedPlan(a,true);if(d.kind==='analysis'&&!d.config.report_id)freePlan(a,true,true);return d;
}
export async function validateDraft(api,kind,payload){
 const draft=parseDraft(kind,payload),events=[],properties=[];
 function walk(v){if(!v||typeof v!=='object')return;if(typeof v.event_name==='string')events.push(eventSchema.parse(Object.fromEntries(Object.entries(v).filter(([k])=>k!=='measure'))));if(typeof v.property_name==='string')properties.push(propertySchema.parse(v));for(const x of Object.values(v))walk(x);}
 walk(draft.config);const cache=new Map(),checks=[];
 async function check(category,name,selector){if(!cache.has(category)){const r=await api.request('POST',`/openapi/v1/metadata/${APP}/list/${category}`,{});if(!Array.isArray(r.data))throw new QueryError('UNVERIFIED_CONTRACT','元数据响应无法验证。');cache.set(category,r.data);}
 const matches=cache.get(category).filter(x=>x.name===name),m=matches.length===1?matches[0]:null;
 let status=m?'found':'not_verified';
 if(m&&selector.property_type&&!['profile','user_profile'].includes(selector.property_type)){const t=m.type??m.property_type;if(t!==undefined&&t!==(selector.property_type==='common_param'?2:1))status='type_mismatch';}
 checks.push({category,name,status,value_type:m?.value_type??null});}
 for(const e of new Map(events.map(x=>[x.event_type+':'+x.event_name,x])).values())await check(e.event_type==='virtual'?'virtual_events':'events',e.event_name,e);
 for(const p of new Map(properties.map(x=>[JSON.stringify(x),x])).values())await check(p.property_compose_type==='virtual'?'virtual_params':['profile','user_profile'].includes(p.property_type)?'user_profiles':'params',p.property_name,p);
 function checkValueTypes(v){if(!v||typeof v!=='object')return;
 if(v.property&&Array.isArray(v.values)){const p=v.property,c=checks.find(x=>x.name===p.property_name&&x.category===(p.property_compose_type==='virtual'?'virtual_params':['profile','user_profile'].includes(p.property_type)?'user_profiles':'params'));if(c?.status==='found'&&['int','float'].includes(c.value_type)&&v.values.some(x=>typeof x!=='number'))checks.push({category:'filter',name:p.property_name,status:'type_mismatch',value_type:c.value_type});}
 for(const x of Object.values(v))checkValueTypes(x);}
 checkValueTypes(draft.config);
 if(draft.config.numeric_bounds){const p=draft.config.property,c=checks.find(x=>x.name===p.property_name);if(p.property_compose_type==='virtual'||c?.status==='found'&&!['int','float'].includes(c.value_type))checks.push({category:'numeric_bounds',name:p.property_name,status:'type_mismatch'});}
 if(draft.kind==='report'&&(await metricSource(api,draft.config.report_id)).source_version!==draft.source_version)throw new QueryError('VERSION_CONFLICT','报表来源口径已变化。');
 return {draft,valid:!checks.some(x=>x.status==='type_mismatch'),metadata_verified:checks.every(x=>x.status==='found'),checks,note:'元数据目录完整性未知，未返回不等于不存在；结构检查不证明结果口径正确。'};
}
export async function trialDraft(api,kind,payload,start_date,end_date,executors={health:checkTrackingHealth,quality:checkPropertyQuality,report:queryReportAdaptive,analysis:runAnalysis,advanced:runAdvanced,distribution:runDistribution,funnel:runFunnel}){
 const range=dateRange(start_date,end_date);if(range.end_time-range.start_time>=3*86400)throw new QueryError('INVALID_DATE','草稿试跑最多3个完整自然日。');
 const validation=await validateDraft(api,kind,payload);if(!validation.valid)throw new QueryError('PROPERTY_TYPE_MISMATCH','属性类型不匹配，拒绝试跑。');
 const output=await executors[validation.draft.kind](api,{...validation.draft.config,start_date,end_date});
 return {validation,output,...(validation.draft.policy?{policy_preview:evaluatePolicy({kind:validation.draft.kind,status:output.status,data:output.data},validation.draft.policy,{start_date,end_date},[]),policy_note:'草稿未绑定历史版本，环比及多期连续条件在此试跑中可能证据不足。'}:{}),persisted:false,note:'仅查询草稿；未保存定义、巡检观测或计划。请检查output的完整性与警告。'};
}
export async function editorValues(api,input){return inspectPropertyValues(api,z.object(propertyShape).strict().parse(input));}
export function diffValues(before,after,path=''){
 if(JSON.stringify(before)===JSON.stringify(after))return [];
 if(before&&after&&typeof before==='object'&&typeof after==='object'&&!Array.isArray(before)&&!Array.isArray(after))return [...new Set([...Object.keys(before),...Object.keys(after)])].sort().flatMap(k=>diffValues(before[k],after[k],path+'/'+k));
 return [{path:path||'/',before:before??null,after:after??null,change:before===undefined?'added':after===undefined?'removed':'changed'}];
}
