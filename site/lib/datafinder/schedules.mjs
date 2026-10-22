import {mappedPlans} from './mapped-plans.mjs';
import {scheduleUpgrades,bindingStatus} from './schedule-upgrades.mjs';
import {scheduleBackfill} from './backfill.mjs';
import {z} from 'zod/v4';
import {database,record,batchShape} from './governance.mjs';
import {cloudJobs} from './jobs.mjs';
import {QueryError} from './core.mjs';
export const scheduleShape={action:z.enum(['save','list','tick','preview_backfill','backfill','preview_upgrade','upgrade']),keys:z.array(z.string().min(1).max(60).regex(/^[\w.-]+$/)).min(1).max(10).optional(),upgrades:z.array(z.object({key:z.string().min(1).max(60).regex(/^[\w.-]+$/),preview_hash:z.string().length(64)}).strict()).min(1).max(10).optional(),mode:z.enum(['missed','specified']).default('missed'),start_date:z.string().optional(),end_date:z.string().optional(),dates:z.array(z.string()).min(1).max(31).optional(),preview_hash:z.string().length(64).optional(),key:z.string().min(1).max(60).regex(/^[\w.-]+$/).optional(),expected_revision:z.number().int().min(0).optional(),confirmed:z.literal(true).optional(),enabled:z.boolean().optional(),hour_shanghai:z.number().int().min(0).max(23).optional(),rules:batchShape.rules.optional()};
async function scheduleAction(api,input,owner){
 const a=z.object(scheduleShape).strict().parse(input),db=database(api,owner);
 if(['preview_upgrade','upgrade'].includes(a.action))return scheduleUpgrades(api,a,owner);
 if(['preview_backfill','backfill'].includes(a.action))return scheduleBackfill(api,a,owner);
 if(a.action==='save'){
  if(!a.key||a.expected_revision===undefined||!a.confirmed||a.enabled===undefined||a.hour_shanghai===undefined||!a.rules)throw new QueryError('INVALID_ARGUMENT','保存需key、版本、确认、启用状态、小时和规则版本。');
  if(new Set(a.rules.map(x=>x.key)).size!==a.rules.length)throw new QueryError('INVALID_ARGUMENT','规则不能重复。');
  if(a.enabled)for(const rule of a.rules){const r=await record(api,owner,'rule',rule.key);if(r.revision!==rule.revision)throw new QueryError('VERSION_CONFLICT','规则版本已变化。');}
  const body=JSON.stringify({enabled:a.enabled,hour_shanghai:a.hour_shanghai,rules:a.rules,timezone:'Asia/Shanghai',window:'previous_complete_day'});
  const r=await db.prepare("INSERT INTO governance_records(owner,kind,record_key,revision,body,created_at) SELECT ?,'schedule',?,?,?,? WHERE COALESCE((SELECT MAX(revision) FROM governance_records WHERE owner=? AND kind='schedule' AND record_key=?),0)=?").bind(owner,a.key,a.expected_revision+1,body,Date.now(),owner,a.key,a.expected_revision).run();
  if(r.meta?.changes!==1)throw new QueryError('VERSION_CONFLICT','计划已变化，请读取最新版本。');return record(api,owner,'schedule',a.key);
 }
 const r=await db.prepare("SELECT g.* FROM governance_records g WHERE owner=? AND kind='schedule' AND revision=(SELECT MAX(revision) FROM governance_records v WHERE v.owner=g.owner AND v.kind=g.kind AND v.record_key=g.record_key) ORDER BY record_key LIMIT 101").bind(owner).all();
 if(r.results.length>100)throw new QueryError('RESULT_TOO_LARGE','计划超过100条，请减少计划后再运行。');
 const schedules=r.results.map(x=>({key:x.record_key,revision:x.revision,value:JSON.parse(x.body)}));
 const bindingCache=new Map();
 if(a.action==='list')return {items:await Promise.all(schedules.map(async s=>({...s,binding:await bindingStatus(api,owner,s,bindingCache)}))),dispatch:'requires_linked_cloud_schedule',external_notifications:false};
 const local=new Date(Date.now()+8*3600000),day=local.toISOString().slice(0,10),yesterday=new Date(local.getTime()-86400000).toISOString().slice(0,10),submitted=[];
 for(const s of schedules){if(!s.value.enabled||local.getUTCHours()<s.value.hour_shanghai)continue;
  try{const job=await cloudJobs(api,{action:'submit',request_key:`schedule:${s.key}:${s.revision}:${day}`,tasks:[{kind:'inspection',rules:s.value.rules,start_date:yesterday,end_date:yesterday}]},owner);submitted.push({key:s.key,revision:s.revision,job_id:job.job_id,state:job.state});}
  catch(e){submitted.push({key:s.key,revision:s.revision,status:'failed',code:e instanceof QueryError?e.code:'DISPATCH_FAILED'});}
 }
 let mapped;try{mapped=await mappedPlans(api,{action:'tick'},owner);}catch(e){mapped={status:'partial',submitted:[],code:e instanceof QueryError?e.code:'DISPATCH_FAILED'};}
 const processed=await cloudJobs(api,{action:'process_next'},owner);
 return {business_date:day,submitted,mapped,processed,external_notifications:false,missed_days:'not_backfilled',note:'计划绑定规则版本；规则改变后任务失败并要求更新计划，不自动采用新口径。'};
}

export function dispatchFailed(result){return result.submitted?.some(s=>s.status==='failed')||result.mapped?.status==='partial'||['partial','failed'].includes(result.processed?.state);}

export async function inspectionSchedules(api,input,owner){
 if(input.action!=='tick')return scheduleAction(api,input,owner);
 const db=database(api,owner),id=crypto.randomUUID(),started=Date.now();
 await db.prepare('INSERT INTO dispatch_runs(id,owner,started_at,status) VALUES(?,?,?,?)').bind(id,owner,started,'running').run();
 try{
  const result=await scheduleAction(api,input,owner),p=result.processed;
  const status=dispatchFailed(result)?'task_failed':'completed';
  await db.prepare('UPDATE dispatch_runs SET finished_at=?,status=?,submitted_count=?,processed_job_id=? WHERE id=? AND owner=?').bind(Date.now(),status,result.submitted.filter(s=>s.job_id).length+(result.mapped?.submitted?.filter(x=>x.job_id).length??0),p.job_id??null,id,owner).run();
  return {...result,dispatch_run_id:id,trigger_origin:'unverified',note:result.note+' 触发记录不区分手动与平台自动调用，自动运行须对照平台运行记录。'};
 }catch(e){
  await db.prepare('UPDATE dispatch_runs SET finished_at=?,status=?,error_code=? WHERE id=? AND owner=?').bind(Date.now(),'failed',e instanceof QueryError?e.code:'EXECUTION_FAILED',id,owner).run();throw e;
 }
}
