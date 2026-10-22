import {z} from 'zod/v4';
import {APP,PROJECT,QueryError} from './core.mjs';
import {configHash} from './config-hash.mjs';
import {eventSchema,expression} from './analysis.mjs';
const kind=z.enum(['virtual_events','virtual_params']);
const name=z.string().min(1).max(120).regex(/^[\w$.-]+$/);
const pick=(v,keys)=>Object.fromEntries(keys.filter(k=>v?.[k]!==undefined).map(k=>[k,v[k]]));
const eventKeys=['name','show_name','description','status','dsl_content'];
const paramKeys=['type','relation_user_profile_properties','relation_event_param_properties','name','show_name','description','property_type','value_type','event_relation_strategy','sql_rule'];
const keys=k=>k==='virtual_events'?eventKeys:paramKeys;
export const readVirtualShape={kind,name:name.optional(),keyword:z.string().max(100).default(''),page:z.number().int().min(1).max(100).default(1),page_size:z.number().int().min(1).max(50).default(10)};
export const changeShape={kind,operation:z.enum(['create','update']),name,show_name:z.string().max(200).optional(),description:z.string().max(2000).optional(),status:z.number().int().min(0).max(2).optional(),events:z.array(eventSchema).min(1).max(20).optional(),property_type:z.union([z.literal(1),z.literal(2)]).optional(),value_type:z.enum(['string','int','float']).optional(),event_relation_strategy:z.enum(['any','all']).optional(),sql_rule:z.string().min(1).max(8000).optional()};
const changeSchema=z.object(changeShape).strict();
export async function virtualList(api,k){
 kind.parse(k);const r=await api.request('POST',`/openapi/v1/metadata/${APP}/list/${k}`,{});
 if(!Array.isArray(r.data))throw new QueryError('UNVERIFIED_CONTRACT','虚拟对象列表契约未知。');
 for(const x of r.data)if(String(x.project_id)!==PROJECT||!(x.relation_app_ids??[]).map(String).includes(APP))throw new QueryError('OUT_OF_SCOPE','虚拟对象范围无法验证。');
 return r;
}
export function virtualView(x,k){return {...pick(x,['id','project_id','relation_app_ids','updated_at','used_times','status',...keys(k)]),...(k==='virtual_events'?{dsl_content:x.dsl_content??x.dsl}:{}),...(k==='virtual_params'?{relation_event_names:x.relation_event_names??[]}: {})};}
export async function readVirtual(api,input){
 const a=z.object(readVirtualShape).strict().parse(input),r=await virtualList(api,a.kind),matches=r.data.filter(x=>a.name?x.name===a.name:JSON.stringify([x.name,x.show_name,x.description]).toLowerCase().includes(a.keyword.toLowerCase()));
 if(a.name&&matches.length!==1)throw new QueryError('NOT_FOUND','未找到唯一的虚拟对象。');
 const items=await Promise.all(matches.slice((a.page-1)*a.page_size,a.page*a.page_size).map(async x=>({...virtualView(x,a.kind),version:await version(x,a.kind)})));
 return api.output({data:{items,total:matches.length,page:a.page,page_size:a.page_size,has_more:a.page*a.page_size<matches.length},log_id:r.log_id},{status:'success',app_ids:[APP],scope_description:'虚拟对象元数据 配置应用；定义由 DataFinder 保存',definition_status:'saved_configuration_not_business_approved'});
}
async function version(x,k){return configHash(x?{...pick(x,keys(k)),id:x.id,updated_at:x.updated_at??null}:null);}
// Deliberately limited expression grammar: no statements, subqueries, network/table functions or identifiers containing private fields.
export function validateExpression(sql,type){
 const functions=new Set('concat toString if ifNull coalesce nullIf notEmpty empty lower upper length substring trim replaceAll replaceOne round floor ceil abs toInt32 toInt64 toFloat64 formatDateTime toHour toDayOfWeek toWeek toMonday date_format date_add JSONExtractString'.toLowerCase().split(' '));
 const literals=new Set(['case','when','then','else','end','and','or','not','in','is','null','true','false']);
 const tokens=sql.match(/'(?:[^'\\]|\\.|'')*'|`[^`]+`|\d+(?:\.\d+)?|[A-Za-z_$][\w$]*|!=|<=|>=|<>|[().,+*/%<>=-]/g)??[];
 if(tokens.join('')!==sql.replace(/\s+(?=(?:[^']*'[^']*')*[^']*$)/g,'')) {
  // Compare by scanning original offsets so whitespace inside literals is retained.
  let rest=sql;for(const t of tokens){rest=rest.trimStart();if(!rest.startsWith(t))throw new QueryError('INVALID_EXPRESSION','表达式仅支持单个标量表达式，不支持注释和SQL语句。');rest=rest.slice(t.length);}if(rest.trim())throw new QueryError('INVALID_EXPRESSION','表达式含未支持语法。');
 }
 let depth=0,refs=0;const references={relation_user_profile_properties:[],relation_event_param_properties:[]};
 for(let i=0;i<tokens.length;i++){
  const t=tokens[i],low=t.toLowerCase();if(t==='(')depth++;if(t===')'&&--depth<0)throw new QueryError('INVALID_EXPRESSION','表达式括号不匹配。');
  if(t.startsWith("'")||/^\d/.test(t)||/^[().,+*/%<>=!-]+$/.test(t))continue;
  if(['event_params','user_profiles'].includes(low)){
   if(type===2&&low==='event_params')throw new QueryError('INVALID_EXPRESSION','虚拟用户属性不能引用事件属性。');
   const field=tokens[i+2]?.replace(/^`|`$/g,'');
   if(tokens[i+1]!=='.'||!field||!/^[$\w]+$/.test(field)||/(^|[_$])(uid|user_id|user_unique_id|device_id|email|phone|ip|token|password|message|chat_content)(_|$)/i.test(field)||field.startsWith('$_vp_'))throw new QueryError('INVALID_EXPRESSION','属性引用无效、敏感或引用了其他虚拟属性。');
   references[low==='user_profiles'?'relation_user_profile_properties':'relation_event_param_properties'].push(field);refs++;i+=2;continue;
  }
  if(literals.has(low))continue;if(functions.has(low)&&tokens[i+1]==='(')continue;
  throw new QueryError('INVALID_EXPRESSION','表达式包含未开放的函数或字段引用。');
 }
 if(depth!==0||!refs)throw new QueryError('INVALID_EXPRESSION','表达式须引用原始属性且括号匹配。');
 return Object.fromEntries(Object.entries(references).map(([k,v])=>[k,[...new Set(v)]]));
}
function store(api){if(!api.env.DB)throw new QueryError('CHANGE_STORE_UNAVAILABLE','云端变更记录库未配置，不能提交写入。');return api.env.DB;}
async function current(api,k,n){const r=await virtualList(api,k);return r.data.find(x=>x.name===n)??null;}
function assertSupportedChange(kind,operation,body){
 if(kind==='virtual_events'&&operation==='update'&&Object.hasOwn(body,'description'))throw new QueryError('UNSUPPORTED_FIELD','火山接口不支持修改虚拟事件的 description（描述）字段；请移除该字段后重新预览。此次未提交任何修改。');
}
export async function previewChange(api,input,owner){
 if(!owner)throw new QueryError('UNAUTHORIZED','需要本人登录。');const a=changeSchema.parse(input);assertSupportedChange(a.kind,a.operation,a);
 const db=store(api),before=await current(api,a.kind,a.name);
 if((a.operation==='create')===!!before)throw new QueryError('CONFLICT',before?'同名对象已存在。':'待修改对象不存在。');
 const body=pick(a,['name','show_name','description']);
 if(a.kind==='virtual_events'){
  if(a.sql_rule!==undefined||a.property_type!==undefined||a.value_type!==undefined||a.event_relation_strategy!==undefined)throw new QueryError('INVALID_CHANGE','虚拟事件不能使用属性字段。');
  if(a.status!==undefined)body.status=a.status;
  if(a.operation==='create'&&(!a.events||a.status===undefined))throw new QueryError('INVALID_CHANGE','创建虚拟事件需 events 和 status。');
  if(a.events){
   if(a.events.some(e=>e.event_name===a.name))throw new QueryError('INVALID_CHANGE','虚拟事件不能引用自身。');
   // Origin-only creation prevents transitive cycles; existing nested definitions can still be read/queried and descriptions updated.
   if(a.events.some(e=>e.event_type!=='origin'))throw new QueryError('INVALID_CHANGE','创建规则只接受原始事件，防止循环虚拟依赖。');
   const r=await api.request('POST',`/openapi/v1/metadata/${APP}/list/events`,{});
   if(!Array.isArray(r.data))throw new QueryError('UNVERIFIED_CONTRACT','事件目录格式未知。');
   body.dsl_content={logic:'or',queries:a.events.map(e=>{const source=r.data.find(x=>x.name===e.event_name);if(!source||source.status===0)throw new QueryError('NOT_FOUND','规则引用的原始事件不存在或已禁用。');return {event_id:source.id,event_name:e.event_name,event_type:'origin',filters:e.filters.length?[{expression:expression(e.filters)}]:[]};})};
  }
 }else{
  if(a.events!==undefined||a.status!==undefined)throw new QueryError('INVALID_CHANGE','虚拟属性不支持事件规则/status修改。');
  Object.assign(body,pick(a,['property_type','value_type','event_relation_strategy','sql_rule']));
  for(const k of ['property_type','value_type','event_relation_strategy','sql_rule'])if(body[k]===undefined&&before?.[k]!==undefined)body[k]=before[k];
  if(!body.property_type||!body.value_type||(body.property_type===1&&!body.event_relation_strategy)||!body.sql_rule)throw new QueryError('INVALID_CHANGE','虚拟属性需要类型、关联策略和sql_rule。');
  if(before&&body.property_type!==before.property_type)throw new QueryError('INVALID_CHANGE','不能改变既有属性的事件/用户类型。');
  Object.assign(body,validateExpression(body.sql_rule,body.property_type));
  body.type=before?.type??0;
  if(body.property_type===2)body.event_relation_strategy='';
 }
 if(a.operation==='update'&&Object.keys(body).every(k=>JSON.stringify(body[k])===JSON.stringify(before[k])))throw new QueryError('NO_CHANGE','没有实际变更。');
 const beforeVersion=await version(before,a.kind),id=crypto.randomUUID(),expires=Date.now()+15*60*1000;
 const plan={kind:a.kind,operation:a.operation,name:a.name,body,before:before?virtualView(before,a.kind):null,before_version:beforeVersion};
 const hash=await configHash(plan);
 await db.prepare('INSERT INTO metadata_changes (id,owner,plan,plan_hash,state,expires_at,created_at) VALUES (?,?,?,?,?,?,?)').bind(id,owner,JSON.stringify(plan),hash,'pending',expires,Date.now()).run();
 return {change_id:id,confirmation:hash,expires_at:new Date(expires).toISOString(),state:'pending',project_id:PROJECT,app_id:APP,before:plan.before,after:{...pick(before,keys(a.kind)),...body},impact:{dependency_scan:'not_complete',dependency_check:{tool:'scan_virtual_dependencies',arguments:{kind:a.kind,name:a.name},required_before_confirming_update:a.operation==='update'},known_usage:before?.used_times??0,warnings:[...(a.kind==='virtual_events'&&a.description!==undefined?['虚拟事件接口不保证回传描述；描述缺失将单列为未核验，不等同保存成功。']:[]),'修改定义会影响引用它的历史查询和报表口径。','虚拟属性表达式变更可能清除上游属性字典。','确认只对本次预览有效；上游不提供原子版本条件，跨客户端并发仍有竞态。']},next_step:'向用户展示完整差异及影响；获得本次明确确认后调用apply_virtual_change。'};
}
export async function getChange(api,id,owner){
 const row=await store(api).prepare('SELECT * FROM metadata_changes WHERE id=? AND owner=?').bind(id,owner).first();
 if(!row)throw new QueryError('NOT_FOUND','没有此用户的变更记录。');return row;
}
export async function applyChange(api,{change_id,confirmation},owner){
 const db=store(api),row=await getChange(api,change_id,owner);
 if(row.state!=='pending')return {change_id,state:row.state,result:row.result?JSON.parse(row.result):null,replayed:true};
 if(row.expires_at<Date.now())throw new QueryError('PREVIEW_EXPIRED','预览已过期，请重新预览。');
 if(confirmation!==row.plan_hash)throw new QueryError('CONFIRMATION_MISMATCH','确认码不匹配预览。');
 const p=JSON.parse(row.plan);kind.parse(p.kind);assertSupportedChange(p.kind,p.operation,p.body);
 const before=await current(api,p.kind,p.name);
 if(await version(before,p.kind)!==p.before_version)throw new QueryError('VERSION_CONFLICT','对象已改变，请重新预览。');
 const claim=await db.prepare("UPDATE metadata_changes SET state='applying' WHERE id=? AND owner=? AND state='pending' AND expires_at>=?").bind(change_id,owner,Date.now()).run();
 if(claim.meta.changes!==1)return {change_id,state:'already_claimed',next_step:'读取变更记录，禁止重复提交。'};
 let result,state,submitted=false;
 try{
  const path=p.kind==='virtual_events'&&before
   ?`/openapi/v1/metadata/v1/${APP}/virtual_events/${before.id}`
   :`/openapi/v1/metadata/${APP}/${p.kind}`;
  const body={...p.body,...(p.kind==='virtual_events'&&before?{id:before.id}:{})};
  const r=await api.request(p.operation==='create'?'POST':'PATCH',path,body,{}, {mutation:true});
  submitted=true;
  const after=await current(api,p.kind,p.name);
  const verification=verifyReadback(p.body,after,p.kind);
  state=verification.state;result={log_id:r.log_id,...verification,after:after?virtualView(after,p.kind):null,rollback:before?{operation:'update',kind:p.kind,name:p.name,previous:pick(before,keys(p.kind)),requires_new_preview:true}:null};
 }catch(e){state=!submitted&&['WRITE_PERMISSION_REQUIRED','UPSTREAM_BUSINESS_ERROR'].includes(e.code)?'rejected':'unknown';result={code:e.code??'INTERNAL_ERROR',upstream_code:e.upstream_code??null,message:state==='rejected'?e.message:'提交或回读失败，执行状态不确定；先读取上游对象核对，禁止自动重发。'};}
 await db.prepare('UPDATE metadata_changes SET state=?,result=? WHERE id=? AND owner=?').bind(state,JSON.stringify(result),change_id,owner).run();
 return {change_id,state,result};
}

export function verifyReadback(body,after,kind){
 const unverified_fields=[],mismatched_fields=[];
 for(const [k,v] of Object.entries(body)){
  if(after&&kind==='virtual_events'&&k==='description'&&after[k]===undefined){unverified_fields.push(k);continue;}
  const actual=after?.[k];
  const equal=k==='event_relation_strategy'&&body.property_type===2?[null,undefined,''].includes(actual):k.startsWith('relation_')?JSON.stringify([...(actual??[])].sort())===JSON.stringify([...v].sort()):JSON.stringify(actual)===JSON.stringify(v);
  if(!after||!equal)mismatched_fields.push(k);
 }
 return {state:mismatched_fields.length?'needs_review':unverified_fields.length?'applied_with_unverified_fields':'applied',readback_verified:!mismatched_fields.length&&!unverified_fields.length,verified_fields:Object.keys(body).filter(k=>!unverified_fields.includes(k)&&!mismatched_fields.includes(k)),unverified_fields,mismatched_fields,warnings:unverified_fields.length?['上游已接受写入，其余提交字段回读一致；描述字段未返回，不能证明描述已保存。']:[]};
}
