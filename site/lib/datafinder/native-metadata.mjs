import {z} from 'zod/v4';
import {APP,QueryError} from './core.mjs';
import {configHash} from './config-hash.mjs';
import {getChange} from './virtual.mjs';
const kind=z.enum(['event','event_property','user_property']);
const name=z.string().min(1).max(120).regex(/^[A-Za-z_$][\w$.-]*$/);
const fields=z.object({show_name:z.string().max(200).optional(),description:z.string().max(2000).optional(),status:z.number().int().min(0).max(2).optional(),value_type:z.enum(['int','float','string','datetime','list','version']).optional()}).strict();
export const nativeMetadataShape={action:z.enum(['read','preview','apply','change']),kind:kind.optional(),name:name.optional(),operation:z.enum(['create','update']).optional(),fields:fields.optional(),change_id:z.string().uuid().optional(),confirmation:z.string().regex(/^[a-f0-9]{64}$/).optional()};
const fail=(code,message)=>{throw new QueryError(code,message);};
const view=x=>x?Object.fromEntries(['id','name','show_name','description','status','value_type','type','updated_at'].filter(k=>x[k]!==undefined).map(k=>[k,x[k]])):null;
async function current(api,k,n){const route={event:'events',event_property:'params',user_property:'user_profiles'}[k];const r=await api.request('POST',`/openapi/v1/metadata/${APP}/list/${route}`,{});if(!Array.isArray(r.data)||r.data.some(x=>typeof x?.name!=='string'))fail('UNVERIFIED_CONTRACT','原始元数据目录结构未核验。');const matches=r.data.filter(x=>x.name===n);if(matches.length>1)fail('AMBIGUOUS_METADATA','同名对象不唯一，拒绝修改。');return view(matches[0]);}
export function nativeRequest(p,before){
 const base=`/openapi/v1/metadata/${APP}`,f=p.fields;
 if(p.kind==='event'){
  if(f.value_type!==undefined)fail('INVALID_ARGUMENT','事件不接受属性类型。');
  // Creation requires event-group semantics which the current public example does not define.
  if(p.operation==='create')fail('UNVERIFIED_CONTRACT','事件创建文档含 event_group_ids，但其必填性与本租户分组契约尚未核验。');
  if(!/^[1-9]\d*$/.test(String(before?.id)))fail('UNVERIFIED_CONTRACT','事件 ID 无法核验。');
  return {method:'PATCH',path:`${base}/events`,body:{id:before.id,...f}};
 }
 if(p.kind==='event_property'){if(p.operation==='create')fail('UNSUPPORTED_OPERATION','官方当前目录未提供原始事件属性创建接口。');return {method:'PATCH',path:`${base}/params`,body:{name:p.name,...f}};}
 const {description,...profileFields}=f;
 return {method:'POST',path:`${base}/profile:batchOperate`,body:{profiles:[{name:p.name,...profileFields,...(description!==undefined?{desc:description}:{})}],operation_type:p.operation==='create'?5:6}};
}
export function metadataReadback(fields,after){const unverified_fields=[],mismatched_fields=[];for(const [k,v] of Object.entries(fields)){if(!after||!Object.hasOwn(after,k))unverified_fields.push(k);else if(after[k]!==v)mismatched_fields.push(k);}return {state:mismatched_fields.length?'needs_review':unverified_fields.length?'applied_with_unverified_fields':'applied',readback_verified:!mismatched_fields.length&&!unverified_fields.length,unverified_fields,mismatched_fields};}
export async function nativeMetadata(api,input,owner){
 const a=z.object(nativeMetadataShape).strict().parse(input);if(!owner)fail('UNAUTHORIZED','需要本人登录。');
 if(a.action==='change'){if(!a.change_id)fail('INVALID_ARGUMENT','需要 change_id。');const row=await getChange(api,a.change_id,owner);if(JSON.parse(row.plan).family!=='native_metadata')fail('INVALID_ARGUMENT','不是原始元数据变更记录。');return {change_id:a.change_id,state:row.state,result:row.result?JSON.parse(row.result):null};}
 if(a.action==='apply')return apply(api,a,owner);
 kind.parse(a.kind);name.parse(a.name);
 const before=await current(api,a.kind,a.name);
 if(a.action==='read')return {kind:a.kind,name:a.name,found:!!before,object:before,version:await configHash(before),app_id:APP};
 if(!a.operation||!a.fields||!Object.keys(a.fields).length)fail('INVALID_ARGUMENT','预览需要 operation 与至少一个明确字段。');
 if((a.operation==='create')===!!before)fail('CONFLICT',before?'对象已存在。':'待修改对象不存在。');
 if(a.operation==='create'&&a.kind==='user_property'&&!a.fields.value_type)fail('INVALID_ARGUMENT','新用户属性需显式 value_type。');
 if(before&&a.fields.value_type!==undefined&&a.fields.value_type!==before.value_type)fail('UNSUPPORTED_TYPE_CHANGE','暂不开放已有属性类型转换，避免改变历史查询口径。');
 if(before&&Object.entries(a.fields).every(([k,v])=>before[k]===v))fail('NO_CHANGE','没有实际变更。');
 const plan={family:'native_metadata',kind:a.kind,name:a.name,operation:a.operation,fields:a.fields,before,before_version:await configHash(before)};
 const request=nativeRequest(plan,before),db=api.env.DB;if(!db)fail('CHANGE_STORE_UNAVAILABLE','缺少云端变更记录库。');
 const id=crypto.randomUUID(),hash=await configHash(plan),expiry=Date.now()+900000;
 await db.prepare('INSERT INTO metadata_changes (id,owner,plan,plan_hash,state,expires_at,created_at) VALUES (?,?,?,?,?,?,?)').bind(id,owner,JSON.stringify(plan),hash,'pending',expiry,Date.now()).run();
 return {state:'pending',change_id:id,confirmation:hash,expires_at:new Date(expiry).toISOString(),app_id:APP,before,after:{...before,name:a.name,...a.fields},request,warning:'修改会影响引用此元数据的查询与控制台展示。上游没有原子版本条件；提交前再次核对，提交后逐字段回读。描述不回传时保持未核验。',next_step:'展示完整差异后明确确认，再使用 apply；不支持删除。'};
}
async function apply(api,a,owner){
 if(!a.change_id||!a.confirmation)fail('INVALID_ARGUMENT','需要 change_id 和 confirmation。');const row=await getChange(api,a.change_id,owner),p=JSON.parse(row.plan);
 if(p.family!=='native_metadata')fail('INVALID_ARGUMENT','不是原始元数据变更。');
 if(row.plan_hash!==a.confirmation)fail('CONFIRMATION_MISMATCH','确认码不匹配。');
 if(row.state!=='pending')return {change_id:a.change_id,state:row.state,replayed:true,result:row.result?JSON.parse(row.result):null};
 if(row.expires_at<Date.now())fail('PREVIEW_EXPIRED','预览已过期。');
 const before=await current(api,p.kind,p.name);if(await configHash(before)!==p.before_version)fail('VERSION_CONFLICT','对象已改变，请重新预览。');
 const req=nativeRequest(p,before),db=api.env.DB,claim=await db.prepare("UPDATE metadata_changes SET state='applying' WHERE id=? AND owner=? AND state='pending' AND expires_at>=?").bind(a.change_id,owner,Date.now()).run();if(claim.meta.changes!==1)return {state:'already_claimed',change_id:a.change_id};
 let result,state,accepted=false;
 try{const r=await api.request(req.method,req.path,req.body,{}, {mutation:true});accepted=true;const after=await current(api,p.kind,p.name);const v=metadataReadback(p.fields,after);state=v.state;result={...v,after,log_id:r.log_id,data_deleted:false};}
 catch(e){state=!accepted&&['WRITE_PERMISSION_REQUIRED','UPSTREAM_BUSINESS_ERROR'].includes(e.code)?'rejected':'unknown';result={code:e.code??'INTERNAL_ERROR',message:state==='rejected'?e.message:'提交或回读不确定，先检查对象，禁止自动重发。'};}
 await db.prepare('UPDATE metadata_changes SET state=?,result=? WHERE id=? AND owner=?').bind(state,JSON.stringify(result),a.change_id,owner).run();return {change_id:a.change_id,state,result};
}
