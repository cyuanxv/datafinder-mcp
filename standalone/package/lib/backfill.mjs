import {database,record} from './governance.mjs';
import {cloudJobs} from './jobs.mjs';
import {configHash} from './config-hash.mjs';
import {QueryError} from './core.mjs';
const DAY=86400000;
function dateValue(v){const n=Date.parse(`${v}T00:00:00+08:00`);if(!/^\d{4}-\d{2}-\d{2}$/.test(v??'')||!Number.isFinite(n)||new Date(n+8*3600000).toISOString().slice(0,10)!==v)throw new QueryError('INVALID_ARGUMENT','需要有效的 YYYY-MM-DD 日期。');return n;}
export async function scheduleBackfill(api,a,owner){
 if(!a.key||!a.start_date||!a.end_date)throw new QueryError('INVALID_ARGUMENT','请指定计划 key、start_date 和 end_date。');
 const start=dateValue(a.start_date),end=dateValue(a.end_date),now=Date.now();
 if(start>end||end-start>30*DAY||end+DAY>now)throw new QueryError('INVALID_ARGUMENT','最多检查31个已结束的自然日，不允许未来日期。');
 const db=database(api,owner),history=(await db.prepare("SELECT * FROM governance_records WHERE owner=? AND kind='schedule' AND record_key=? ORDER BY revision LIMIT 1001").bind(owner,a.key).all()).results;
 if(!history.length)throw new QueryError('NOT_FOUND','计划不存在。');if(history.length>1000)throw new QueryError('RESULT_TOO_LARGE','计划历史超过1000版，需缩小历史。');
 const items=[];
 const latest=history.at(-1);
 for(let time=start;time<=end;time+=DAY){
  const business_date=new Date(time+8*3600000).toISOString().slice(0,10),dispatch_date=new Date(time+DAY+8*3600000).toISOString().slice(0,10);
  // A revision is expected only if its due time fell inside its actual lifetime.
  let expected=history.flatMap((r,i)=>{const value=JSON.parse(r.body),due=time+DAY+value.hour_shanghai*3600000;return value.enabled&&r.created_at<=due&&due<(history[i+1]?.created_at??Infinity)&&due<=now?[{r,value,due}]:[];});
  if(a.mode==='specified')expected=[{r:latest,value:JSON.parse(latest.body),due:null}];
  if(!expected.length){items.push({business_date,status:'not_expected',note:'该日期没有已到期且当时启用的计划版本。'});continue;}
  for(const {r,value,due} of expected){
   const request_key=a.mode==='specified'?`backfill:${a.key}:${r.revision}:${business_date}`:`schedule:${a.key}:${r.revision}:${dispatch_date}`,job=await db.prepare('SELECT id,state FROM cloud_jobs WHERE owner=? AND request_key=?').bind(owner,request_key).first();
   items.push({business_date,revision:r.revision,due_at:due===null?null:new Date(due).toISOString(),request_key,rules:value.rules,status:job?job.state:a.mode==='specified'?'available':'missing',job_id:job?.id??null});
  }
 }
 const preview_hash=await configHash({owner,mode:a.mode,key:a.key,start_date:a.start_date,end_date:a.end_date,history:history.map(r=>({revision:r.revision,body:r.body,created_at:r.created_at})),expected:items.map(({status,job_id,...x})=>x)});
 const base={mode:a.mode,key:a.key,start_date:a.start_date,end_date:a.end_date,preview_hash,items,timezone:'Asia/Shanghai',note:a.mode==='specified'?'按当前保存的计划及规则版本查询所选日期，允许停用计划和创建前日期；这是主动补查，不声称当时漏跑，也不会改变未来定时计划。': 'missing 表示没有找到该计划版本该日的入队记录，不代表业务数据缺失；失败任务应恢复，已取消任务不会自动补跑。只检查计划实际启用期间，不补计划创建前日期。'};
 if(a.action==='preview_backfill')return base;
 if(!a.confirmed||a.preview_hash!==preview_hash)throw new QueryError('VERSION_CONFLICT','请先预览并确认；计划或到期范围变化后需重新预览。');
 const selected=a.dates?.length?a.dates:null;if(!selected||new Set(selected).size!==selected.length||selected.some(d=>!items.some(x=>x.business_date===d&&x.request_key)))throw new QueryError('INVALID_ARGUMENT','dates 必须为预览中有到期计划的日期，且不能重复。');
 const candidates=items.filter(x=>selected.includes(x.business_date)&&x.request_key);
 if(candidates.length>31)throw new QueryError('RESULT_TOO_LARGE','所选日期包含超过31次计划，请分批补跑。');
 // Check every rule before creating any job, never silently adopt a newer rule revision.
 for(const x of candidates.filter(x=>['missing','available'].includes(x.status)))for(const rule of x.rules){const current=await record(api,owner,'rule',rule.key);if(current.revision!==rule.revision)throw new QueryError('VERSION_CONFLICT','绑定规则版本已变化，请核对计划后重新预览。');}
 const submitted=[];
 for(const x of candidates){
  if(!['missing','available'].includes(x.status)){submitted.push({...x,outcome:'existing_not_reexecuted'});continue;}
  try{const job=await cloudJobs(api,{action:'submit',request_key:x.request_key,tasks:[{kind:'inspection',rules:x.rules,start_date:x.business_date,end_date:x.business_date}]},owner);submitted.push({...x,job_id:job.job_id,status:job.state,outcome:'queued_or_existing'});}
  catch(e){submitted.push({...x,outcome:'submission_failed',error_code:e instanceof QueryError?e.code:'EXECUTION_FAILED'});}
 }
 return {...base,submitted,status:submitted.some(x=>x.outcome==='submission_failed')?'partial':'submitted',note:base.note+' 补跑逐日幂等入队，非跨日事务；入队不代表执行成功。相同预览可重试，已经存在的任务不重跑。'};
}
