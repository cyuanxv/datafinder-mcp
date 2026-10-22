import {database} from './governance.mjs';
const minute=60000;
export async function operationsSummary(api,owner,schedules,now=Date.now()){
 const db=database(api,owner);
 const [counts,oldest,dispatches,lastSuccess]=await Promise.all([
  db.prepare("SELECT state,COUNT(*) jobs,SUM(MAX(0,json_array_length(body)-cursor)) remaining_tasks FROM cloud_jobs WHERE owner=? GROUP BY state").bind(owner).all(),
  db.prepare("SELECT id,created_at,updated_at FROM cloud_jobs WHERE owner=? AND state='queued' ORDER BY updated_at,id LIMIT 6").bind(owner).all(),
  db.prepare('SELECT id,status,started_at,finished_at,error_code FROM dispatch_runs WHERE owner=? ORDER BY started_at DESC,id DESC LIMIT 101').bind(owner).all(),
  db.prepare("SELECT started_at,finished_at FROM dispatch_runs WHERE owner=? AND status='completed' ORDER BY started_at DESC,id DESC LIMIT 1").bind(owner).first()
 ]);
 const totals=Object.fromEntries(counts.results.map(r=>[r.state,{jobs:r.jobs,remaining_tasks:r.remaining_tasks}]));
 let consecutive=0;for(const r of dispatches.results.slice(0,100)){if(['failed','task_failed'].includes(r.status)||(r.status==='running'&&now-r.started_at>180000))consecutive++;else break;}
 const latest=dispatches.results[0],stale=!latest||now-latest.started_at>90*minute,waiting=oldest.results.slice(0,5).map(r=>({job_id:r.id,created_at:r.created_at,last_progress_at:r.updated_at,no_progress_minutes:Math.max(0,Math.floor((now-r.updated_at)/minute))}));
 const needsUpgrade=schedules.filter(s=>s.binding?.upgrade_available).map(s=>({key:s.key,enabled:s.value.enabled,revision:s.revision,rules:s.binding.rules}));
 const alerts=[];
 if(stale)alerts.push({code:latest?'DISPATCH_STALE':'DISPATCH_NEVER_OBSERVED',message:latest?'超过90分钟未收到调度调用。':'尚无调度调用记录。',action:'检查平台任务历史和启用状态；服务记录不能单独证明自动触发。'});
 if(consecutive)alerts.push({code:'CONSECUTIVE_DISPATCH_FAILURES',message:`最近连续${consecutive}${consecutive===100&&dispatches.results.length>100?'次以上':'次'}调度调用失败或任务失败。`,action:'查看最近调度错误和任务详情，再决定恢复。'});
 if(waiting.some(x=>x.no_progress_minutes>90))alerts.push({code:'QUEUE_STALLED',message:'存在超过90分钟没有进展的等待任务。',action:'先检查调度和任务详情，不重复提交。'});
 if(needsUpgrade.some(x=>x.enabled))alerts.push({code:'SCHEDULE_RULE_DRIFT',message:'启用计划仍绑定旧规则版本。',action:'到计划管理预览差异，确认升级；不会自动更换口径。'});
 return {state_totals:totals,waiting_tasks:(totals.queued?.remaining_tasks??0)+(totals.running?.remaining_tasks??0),paused_tasks:totals.paused?.remaining_tasks??0,oldest_waiting:waiting,oldest_waiting_has_more:oldest.results.length>5,consecutive_dispatch_failures:consecutive,consecutive_failure_lower_bound:consecutive===100&&dispatches.results.length>100,last_successful_tick_at:lastSuccess?.finished_at??lastSuccess?.started_at??null,plans_needing_upgrade:needsUpgrade,alerts,automatic_trigger_verified:false,scope:'任务状态统计覆盖本人全部记录；连续失败最多回看100次调度调用；运行中任务包含当前未完成项。',note:'暂停和取消不计入等待积压；不能用剩余子任务数推算精确完成时间。自动调度来源仍需平台历史确认。'};
}
