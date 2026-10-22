import {operationsSummary} from './operations-summary.mjs';
import {z} from 'zod/v4';
import {database} from './governance.mjs';
import {historyShape,historyRows} from './history.mjs';
import {cloudJobs,publicJob} from './jobs.mjs';
import {inspectionSchedules} from './schedules.mjs';
import {QueryError} from './core.mjs';
export const operationsShape={...historyShape,view:z.enum(['overview','jobs','attempts','dispatches']).default('overview'),job_id:z.string().uuid().optional()};
export const dependencyJobShape={action:z.enum(['submit','read','list']),request_key:z.string().min(1).max(100).regex(/^[\w.:-]+$/).optional(),kind:z.enum(['virtual_events','virtual_params']).optional(),name:z.string().min(1).max(120).regex(/^[\w$.-]+$/).optional(),max_depth:z.number().int().min(1).max(10).default(5),job_id:z.string().uuid().optional()};
export async function dependencyJobs(api,input,owner){
 const a=z.object(dependencyJobShape).strict().parse(input);
 if(a.action==='submit'){
  if(!a.kind||!a.name||!a.request_key)throw new QueryError('INVALID_ARGUMENT','提交需要对象类型、名称和request_key。');
  return cloudJobs(api,{action:'submit',request_key:a.request_key,tasks:[{kind:'dependency',asset_kind:a.kind,name:a.name,max_depth:a.max_depth}]},owner);
 }
 const result=await cloudJobs(api,{action:a.action,job_id:a.job_id},owner);
 if(a.action==='read'&&!result.tasks.every(x=>x.kind==='dependency'))throw new QueryError('INVALID_ARGUMENT','这不是依赖扫描任务。');
 if(a.action==='list')return {...result,note:'列表为本人全部云端任务；按job_id读取依赖扫描详情。'};
 return result;
}
export function nextDue(schedule,now=Date.now()){
 if(!schedule.enabled)return null;
 const local=new Date(now+8*3600000),day=local.toISOString().slice(0,10),due=Date.parse(`${day}T${String(schedule.hour_shanghai).padStart(2,'0')}:00:00+08:00`);
 return new Date(due>now?due:due+86400000).toISOString();
}
const hints={VERSION_CONFLICT:'绑定的规则或目录已变化；核对最新版本，更新计划或重新提交扫描。',DEPENDENCY_PAGE_FAILED:'扫描某页失败，已有进度保留；确认上游恢复后可创建恢复任务。',SCAN_STALLED:'同页连续未完成；检查上游响应速度。',LEASE_EXHAUSTED:'执行中断已达到三次；检查运行记录后重新提交。',LEASE_EXPIRED:'执行超时或中断；队列会在下次调度时尝试接续。',RESULT_TOO_LARGE:'结果超出存储上限，请缩小范围。',EXECUTION_FAILED:'执行失败；请携带任务ID排查。',UPSTREAM_BUSINESS_ERROR:'上游拒绝请求，请核对接口与权限。'};
function safeCode(code){return typeof code==='string'&&/^[A-Z][A-Z0-9_]{0,70}$/.test(code)?code:'EXECUTION_FAILED';}
function attemptView(r,now){const error=r.error_code?safeCode(r.error_code):r.status==='running'&&now-r.started_at>180000?'LEASE_EXPIRED':null;return {job_id:r.job_id,task_index:r.task_index,stored_status:r.status,started_at:r.started_at,finished_at:r.finished_at,status:error==='LEASE_EXPIRED'?'lease_expired':r.status,duration_ms:(r.finished_at??now)-r.started_at,error_code:error,troubleshooting:error?(hints[error]??'请携带任务ID及错误码排查。'):null};}
function dispatchView(r,now){return {run_id:r.id,started_at:r.started_at,finished_at:r.finished_at,duration_ms:(r.finished_at??now)-r.started_at,status:r.status==='running'&&now-r.started_at>180000?'interrupted':r.status,stored_status:r.status,submitted_count:r.submitted_count,processed_job_id:r.processed_job_id,error_code:r.error_code?safeCode(r.error_code):null,trigger_origin:'unverified'};}
export async function readOperations(api,input,owner){
 const a=z.object(operationsShape).strict().parse(input),db=database(api,owner),now=Date.now();
 if(a.view!=='overview'){
  if(a.job_id)await cloudJobs(api,{action:'read',job_id:a.job_id},owner);
  const page=await historyRows(db,owner,a.view,a);
  return {...page,items:page.items.map(r=>a.view==='jobs'?publicJob(r):a.view==='attempts'?attemptView(r,now):dispatchView(r,now)),history_scope:'cursor_pagination',timezone:'Asia/Shanghai'};
 }
 if(a.cursor||a.status||a.from||a.to)throw new QueryError('INVALID_ARGUMENT','历史筛选请指定view为jobs、attempts或dispatches。');
 if(a.job_id){const job=await cloudJobs(api,{action:'read',job_id:a.job_id},owner);const rows=await db.prepare('SELECT * FROM job_attempts WHERE owner=? AND job_id=? ORDER BY started_at DESC,id DESC LIMIT ?').bind(owner,a.job_id,a.limit+1).all();return {job,attempts:rows.results.slice(0,a.limit).map(x=>attemptView(x,now)),has_more:rows.results.length>a.limit};}
 const [jobs,schedules,dispatch,attempts,counts,last]=await Promise.all([
  cloudJobs(api,{action:'list'},owner),inspectionSchedules(api,{action:'list'},owner),
  db.prepare('SELECT * FROM dispatch_runs WHERE owner=? ORDER BY started_at DESC,id DESC LIMIT ?').bind(owner,a.limit+1).all(),
  db.prepare('SELECT * FROM job_attempts WHERE owner=? ORDER BY started_at DESC,id DESC LIMIT ?').bind(owner,a.limit+1).all(),
  db.prepare("SELECT SUM(CASE WHEN state='queued' THEN 1 ELSE 0 END) queued,SUM(CASE WHEN state='running' THEN 1 ELSE 0 END) running,SUM(CASE WHEN state='running' AND lease_until<? THEN 1 ELSE 0 END) expired,SUM(CASE WHEN state IN ('partial','failed') THEN 1 ELSE 0 END) failed,MIN(CASE WHEN state='queued' THEN created_at END) oldest_queued_at FROM cloud_jobs WHERE owner=?").bind(now,owner).first(),
  db.prepare('SELECT started_at FROM dispatch_runs WHERE owner=? ORDER BY started_at DESC LIMIT 1').bind(owner).first()
 ]);
 const dispatches=dispatch.results.slice(0,a.limit).map(r=>({run_id:r.id,started_at:r.started_at,finished_at:r.finished_at,duration_ms:(r.finished_at??now)-r.started_at,status:r.status==='running'&&now-r.started_at>180000?'interrupted':r.status,submitted_count:r.submitted_count,processed_job_id:r.processed_job_id,error_code:r.error_code?safeCode(r.error_code):null,trigger_origin:'unverified'}));
 return {summary:await operationsSummary(api,owner,schedules.items,now),collected_at:new Date(now).toISOString(),timezone:'Asia/Shanghai',jobs:jobs.items,jobs_has_more:jobs.has_more,schedules:schedules.items.map(s=>({...s,next_due_at:nextDue(s.value,now),next_due_note:'每日计划的下一次名义时间；不是平台触发成功承诺。'})),dispatches,attempts:attempts.results.slice(0,a.limit).map(x=>attemptView(x,now)),dispatch_has_more:dispatch.results.length>a.limit,attempts_has_more:attempts.results.length>a.limit,history_scope:'recent_records_only',diagnostics:{queued:counts.queued??0,running:counts.running??0,expired_leases:counts.expired??0,failed_or_partial:counts.failed??0,oldest_queued_at:counts.oldest_queued_at,last_tick_at:last?.started_at??null,tick_freshness:!last?'never_observed':now-last.started_at>90*60000?'stale':'recent',expected_dispatch_interval_minutes:60,automatic_trigger_verified:false,note:'本页记录服务收到的调用；手动tick也会记录，需与平台运行历史对照才能验收自动触发。'},external_notifications:false};
}
