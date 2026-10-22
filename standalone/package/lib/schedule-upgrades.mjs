import {database,record} from './governance.mjs';
import {configHash} from './config-hash.mjs';
import {QueryError} from './core.mjs';
// Full values form the fingerprint; display diffs are bounded and explicitly marked.
function diff(before,after,path='',items=[]){
 if(JSON.stringify(before)===JSON.stringify(after))return items;
 if(before&&after&&typeof before==='object'&&typeof after==='object'&&!Array.isArray(before)&&!Array.isArray(after)){
  for(const k of new Set([...Object.keys(before),...Object.keys(after)]))diff(before[k],after[k],path?`${path}.${k}`:k,items);
 }else{const render=v=>v===undefined?'[未设置]':JSON.stringify(v);const b=render(before),a=render(after);items.push({path,before:b.slice(0,200),after:a.slice(0,200),truncated:b.length>200||a.length>200});}
 return items;
}
export async function bindingStatus(api,owner,schedule,cache=new Map()){
 const rules=[];for(const r of schedule.value.rules){try{if(!cache.has(r.key))cache.set(r.key,record(api,owner,'rule',r.key));const current=await cache.get(r.key);rules.push({key:r.key,bound_revision:r.revision,current_revision:current.revision,enabled:current.value.enabled,changed:r.revision!==current.revision});}catch(e){if(e.code!=='NOT_FOUND')throw e;rules.push({key:r.key,bound_revision:r.revision,current_revision:null,changed:true,missing:true});}}
 return {rules,upgrade_available:rules.some(r=>r.changed),disabled_rules:rules.filter(r=>r.enabled===false).map(r=>r.key)};
}
async function previewOne(api,owner,key){
 const plan=await record(api,owner,'schedule',key),rules=[],fingerprints=[];
 for(const bound of plan.value.rules){const old=await record(api,owner,'rule',bound.key,bound.revision),latest=await record(api,owner,'rule',bound.key);const changes=diff(old.value,latest.value);rules.push({key:bound.key,from_revision:old.revision,to_revision:latest.revision,enabled:latest.value.enabled,changes:changes.slice(0,30),changes_omitted:Math.max(0,changes.length-30)});fingerprints.push({key:bound.key,from:old,to:latest});}
 const hash=await configHash({owner,plan,rules:fingerprints});
 return {key,from_revision:plan.revision,enabled:plan.value.enabled,hour_shanghai:plan.value.hour_shanghai,rules,changed:rules.some(r=>r.from_revision!==r.to_revision),preview_hash:hash};
}
export async function scheduleUpgrades(api,a,owner){
 const db=database(api,owner);
 if(a.action==='preview_upgrade'){
  if(!a.keys?.length||new Set(a.keys).size!==a.keys.length)throw new QueryError('INVALID_ARGUMENT','请选择1至10个不重复的计划。');
  const items=[];for(const key of a.keys){try{items.push({...await previewOne(api,owner,key),status:'ready'});}catch(e){if(!(e instanceof QueryError))throw e;items.push({key,status:'blocked',error_code:e.code});}}
  return {items,note:'升级只绑定最新规则版本，保留计划启停与时间。已入队任务和历史记录不改写；规则停用状态也会保留。启用计划升级后下次调度可能按新版本再次查询昨天。'};
 }
 if(!a.upgrades?.length||!a.confirmed||new Set(a.upgrades.map(x=>x.key)).size!==a.upgrades.length)throw new QueryError('INVALID_ARGUMENT','升级需要逐计划预览指纹、确认且计划不能重复。');
 const items=[];
 for(const selected of a.upgrades){try{
  const current=await record(api,owner,'schedule',selected.key);
  if(current.value.upgrade_preview_hash===selected.preview_hash){items.push({key:selected.key,status:'already_applied',revision:current.revision});continue;}
  const preview=await previewOne(api,owner,selected.key);
  if(preview.preview_hash!==selected.preview_hash)throw new QueryError('VERSION_CONFLICT','计划或规则已变化，请重新预览。');
  if(!preview.changed){items.push({key:selected.key,status:'unchanged',revision:preview.from_revision});continue;}
  const value={enabled:preview.enabled,hour_shanghai:preview.hour_shanghai,timezone:'Asia/Shanghai',window:'previous_complete_day',rules:preview.rules.map(r=>({key:r.key,revision:r.to_revision})),upgrade_preview_hash:selected.preview_hash};
  const guards=preview.rules.map(()=>" AND (SELECT MAX(revision) FROM governance_records WHERE owner=? AND kind='rule' AND record_key=?)=?").join('');
  const result=await db.prepare("INSERT INTO governance_records(owner,kind,record_key,revision,body,created_at) SELECT ?,'schedule',?,?,?,? WHERE (SELECT MAX(revision) FROM governance_records WHERE owner=? AND kind='schedule' AND record_key=?)=?"+guards).bind(owner,selected.key,preview.from_revision+1,JSON.stringify(value),Date.now(),owner,selected.key,preview.from_revision,...preview.rules.flatMap(r=>[owner,r.key,r.to_revision])).run();
  if(result.meta?.changes!==1)throw new QueryError('VERSION_CONFLICT','提交时版本已变化，请重新预览。');
  items.push({key:selected.key,status:'upgraded',revision:preview.from_revision+1});
 }catch(e){items.push({key:selected.key,status:'failed',error_code:e instanceof QueryError?e.code:'STORE_ERROR'});}}
 return {status:items.some(x=>x.status==='failed')?'partial':'completed',items,queued_jobs_modified:false,note:'逐计划独立提交；已成功项保留，可重试同一预览。历史任务仍使用原规则版本。'};
}
