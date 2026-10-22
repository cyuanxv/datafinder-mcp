import {z} from 'zod/v4';
import {APP,QueryError,sanitize} from './core.mjs';
import {database} from './governance.mjs';
import {eventSchema,expression} from './analysis.mjs';
import {configHash} from './config-hash.mjs';
import {getChange} from './virtual.mjs';
const id=z.string().regex(/^[1-9]\d{0,18}$/);
export const cohortShape={action:z.enum(['read','preview','apply','change_status']),cohort_id:id.optional(),operation:z.enum(['create','update','refresh']).optional(),name:z.string().trim().min(1).max(100).optional(),description:z.string().max(1000).default(''),event:eventSchema.optional(),lookback_days:z.number().int().min(1).max(31).default(7),minimum_events:z.number().int().min(1).max(1000000).default(1),refresh_rule:z.union([z.literal(1),z.literal(2)]).default(1),change_id:z.string().uuid().optional(),confirmation:z.string().length(64).optional()};
function view(x){return {cohort_id:String(x.cohort_id),app_id:String(x.app_id),cohort_name:x.cohort_name,cohort_type:x.cohort_type,description:x.description??'',refresh_rule:x.refresh_rule,dsl_content:x.cohort_type===4?x.dsl_content:null};}
async function current(api,cohort_id){id.parse(cohort_id);const r=await api.request('GET',`/openapi/v1/${APP}/cohorts/${cohort_id}`);if(!r.data||String(r.data.app_id)!==APP||String(r.data.cohort_id)!==cohort_id)throw new QueryError('OUT_OF_SCOPE','分群范围或身份不一致。');return r.data;}
export function cohortBody(a){if(!a.name||!a.event)throw new QueryError('INVALID_ARGUMENT','规则分群需要名称和事件。');if(a.event.indicator!=='event_users')throw new QueryError('INVALID_ARGUMENT','分群固定按事件次数判断。');return {cohort_name:a.name,cohort_type:4,description:a.description,refresh_rule:a.refresh_rule,dsl_content:{version:3,app_ids:[Number(APP)],periods:[],content:{query_type:'$cohort',profile_filters:[],profile_groups:[],queries:[[{show_label:'event--A--A',event_name:a.event.event_name,event_type:a.event.event_type,next_query_label:null,sequence_first:true,logic:true,event_indicator:'events',condition:{property_operation:'>',property_values:[a.minimum_events-1],period:{granularity:'day',last:{amount:a.lookback_days,unit:'day'},type:'last',timezone:'Asia/Shanghai'}},filters:[{expression:expression(a.event.filters)}]}]]}}};}
export async function manageCohort(api,input,owner){const a=z.object(cohortShape).strict().parse(input),db=database(api,owner);
 if(a.action==='read'){if(!a.cohort_id)throw new QueryError('INVALID_ARGUMENT','需要cohort_id。');const x=await current(api,a.cohort_id);return {definition:sanitize(view(x)),version:await configHash(view(x)),calculation_status:x.cohort_status,count:x.cohort_status===1&&Number.isSafeInteger(x.count)&&x.count>=0?x.count:null,scope:'配置应用',members_included:false};}
 if(a.action==='preview'){
  if(!a.operation||(a.operation!=='create'&&!a.cohort_id)||(a.operation==='create'&&a.cohort_id))throw new QueryError('INVALID_ARGUMENT','操作与分群ID不匹配。');
  const before=a.cohort_id?await current(api,a.cohort_id):null;
  if(before?.cohort_type!==undefined&&before.cohort_type!==4)throw new QueryError('UNSUPPORTED_QUERY','仅支持规则分群，不能修改或刷新上传成员文件。');
  const body=a.operation==='refresh'?null:cohortBody(a),plan={kind:'cohort',operation:a.operation,cohort_id:a.cohort_id??null,before:before?view(before):null,before_version:await configHash(before?view(before):null),body};
  const change_id=crypto.randomUUID(),confirmation=await configHash(plan),expires=Date.now()+900000;
  await db.prepare('INSERT INTO metadata_changes (id,owner,plan,plan_hash,state,expires_at,created_at) VALUES (?,?,?,?,?,?,?)').bind(change_id,owner,JSON.stringify(plan),confirmation,'pending',expires,Date.now()).run();
  return {change_id,confirmation,expires_at:new Date(expires).toISOString(),before:plan.before,after:body,operation:a.operation,scope:'配置应用',warnings:['更新会替换完整分群规则，可能改变引用分群的分析结果。','刷新占用上游查询资源；计算完成与提交成功分别验收。','上游不提供原子版本条件，存在跨客户端并发竞态。'],next_step:'展示完整差异，获得本次明确确认后apply。'};
 }
 if(!a.change_id)throw new QueryError('INVALID_ARGUMENT','需要change_id。');const row=await getChange(api,a.change_id,owner),p=JSON.parse(row.plan);if(p.kind!=='cohort')throw new QueryError('INVALID_ARGUMENT','不是分群变更。');
 if(a.action==='change_status'||row.state!=='pending')return {change_id:a.change_id,state:row.state,result:row.result?JSON.parse(row.result):null};
 if(row.expires_at<Date.now())throw new QueryError('PREVIEW_EXPIRED','请重新预览。');if(a.confirmation!==row.plan_hash)throw new QueryError('CONFIRMATION_MISMATCH','确认码不匹配。');
 if(p.cohort_id&&await configHash(view(await current(api,p.cohort_id)))!==p.before_version)throw new QueryError('VERSION_CONFLICT','分群已修改，请重新预览。');
 const claim=await db.prepare("UPDATE metadata_changes SET state='applying' WHERE id=? AND owner=? AND state='pending' AND expires_at>=?").bind(a.change_id,owner,Date.now()).run();if(claim.meta?.changes!==1)return {change_id:a.change_id,state:'already_claimed'};
 let state='unknown',result,accepted=false;
 try{const path=`/openapi/v1/${APP}/cohorts${p.cohort_id?'/'+p.cohort_id:''}${p.operation==='refresh'?'/refresh':''}`;const r=await api.request(p.operation==='create'?'POST':p.operation==='update'?'PATCH':'GET',path,p.body??undefined,{}, {mutation:true});
  accepted=true;const target=p.cohort_id??String(r.data?.cohort_id??'');id.parse(target);const after=await current(api,target);
  const verified=p.operation==='refresh'?(r.data?.status===1&&after.cohort_status===1&&r.data.refresh_timestamp>=Math.floor(row.created_at/1000)):Object.entries(p.body).every(([k,v])=>JSON.stringify(after[k])===JSON.stringify(v));state=verified?'applied':'needs_review';result={cohort_id:target,readback_verified:verified,calculation_status:after.cohort_status,count:after.cohort_status===1&&Number.isSafeInteger(after.count)?after.count:null};
 }catch(e){if(!accepted&&['UPSTREAM_BUSINESS_ERROR','WRITE_PERMISSION_REQUIRED','FORBIDDEN','CREDENTIALS_NOT_CONFIGURED'].includes(e.code))state='rejected';result={upstream_code:e.upstream_code??null,error_code:e instanceof QueryError?e.code:'WRITE_OR_READBACK_FAILED',retry:false,next_step:'先查分群目录和变更记录；结果未知不得重发创建。'};}
 await db.prepare('UPDATE metadata_changes SET state=?,result=? WHERE id=? AND owner=?').bind(state,JSON.stringify(result),a.change_id,owner).run();return {change_id:a.change_id,state,result};
}
