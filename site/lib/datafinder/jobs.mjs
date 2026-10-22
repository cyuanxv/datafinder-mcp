import {retryDecision} from './retry-policy.mjs';
import {mergedJob} from './merged-jobs.mjs';
import {z} from 'zod/v4';
import {dependencyTask,dependencyStep} from './dependency-jobs.mjs';
import {database,runBatch,batchShape,record} from './governance.mjs';
import {queryTemplate} from './templates.mjs';
import {QueryError} from './core.mjs';
import {configHash} from './config-hash.mjs';
import {historyShape,historyRows} from './history.mjs';
import {storeOutput,hydrateOutput,readChunk,MAX_JOB_BYTES} from './result-store.mjs';
const byteLength=v=>new TextEncoder().encode(v).byteLength;
const templateRun=z.object({kind:z.literal('template'),key:z.string().min(1).max(80),expected_revision:z.number().int().positive(),start_date:z.string(),end_date:z.string()}).strict();
const checkRun=z.object({kind:z.literal('inspection'),...batchShape}).strict();
export const jobShape={action:z.enum(['submit','read','list','process_next','retry','read_result','read_merged','pause','resume','cancel']),...historyShape,confirmed:z.literal(true).optional(),task_index:z.number().int().min(0).max(19).optional(),result_page:z.number().int().min(1).optional(),job_id:z.string().uuid().optional(),request_key:z.string().min(1).max(100).regex(/^[\w.:-]+$/).optional(),tasks:z.array(z.discriminatedUnion('kind',[templateRun,checkRun,dependencyTask])).min(1).max(20).optional()};
export function publicJob(r,details=false){return {job_id:r.id,...(r.archived!==undefined?{archived:!!r.archived}:{}),state:r.state,completed_tasks:r.cursor,total_tasks:JSON.parse(r.body).length,attempts:r.attempts,created_at:r.created_at,updated_at:r.updated_at,lease_until:r.lease_until||null,request_key:r.request_key,control_request:r.control_request||null,recovery_of:r.recovery_of??null,source_task_indices:r.source_task_indices?JSON.parse(r.source_task_indices):null,failure_codes:JSON.parse(r.results).filter(x=>x.error_code).map(x=>x.error_code),...(r.state==='failed'&&r.attempts>=3?{failure_reason:'LEASE_EXHAUSTED'}:{}),...(details?{results:JSON.parse(r.results),tasks:JSON.parse(r.body)}:{}),execution:'cloud_dispatch_required',note:'排队保存不是执行成功；每次云端调度处理一个子任务。'};}
export async function cloudJobs(api,input,owner,executors={template:queryTemplate,inspection:runBatch,dependency:dependencyStep}){
 const a=z.object(jobShape).strict().parse(input),db=database(api,owner);
 if(a.action==='submit'){
  if(!a.request_key||!a.tasks)throw new QueryError('INVALID_ARGUMENT','提交需要request_key与tasks。');
  const body=JSON.stringify(a.tasks),hash=await configHash(a.tasks);if(byteLength(body)>20000)throw new QueryError('RESULT_TOO_LARGE','请缩小批次。');
  const existing=await db.prepare('SELECT id FROM cloud_jobs WHERE owner=? AND request_key=?').bind(owner,a.request_key).first();if(!existing){const backlog=await db.prepare("SELECT COUNT(*) n FROM cloud_jobs WHERE owner=? AND state IN ('queued','running')").bind(owner).first();if(backlog.n>=100)throw new QueryError('QUEUE_CAPACITY','等待及运行任务已达100，请先处理积压。');}
  await db.prepare("INSERT INTO cloud_jobs (id,owner,request_key,body_hash,body,state,cursor,results,attempts,lease_until,lease_token,created_at,updated_at) VALUES (?,?,?,?,?,'queued',0,'[]',0,0,'',?,?) ON CONFLICT(owner,request_key) DO NOTHING").bind(crypto.randomUUID(),owner,a.request_key,hash,body,Date.now(),Date.now()).run();
  const r=await db.prepare('SELECT * FROM cloud_jobs WHERE owner=? AND request_key=?').bind(owner,a.request_key).first();
  if(r.body_hash!==hash)throw new QueryError('VERSION_CONFLICT','同一request_key已有不同任务，请读取原任务或使用新key。');return publicJob(r,true);
 }
 if(a.action==='list'){const page=await historyRows(db,owner,'jobs',a);return {...page,items:page.items.map(r=>publicJob(r))};}
 if(['read','retry','read_result','read_merged','pause','resume','cancel'].includes(a.action)){
  if(!a.job_id)throw new QueryError('INVALID_ARGUMENT','请指定job_id。');
  const r=await db.prepare('SELECT * FROM cloud_jobs WHERE owner=? AND id=?').bind(owner,a.job_id).first();if(!r)throw new QueryError('NOT_FOUND','任务不存在。');
  if(a.action==='read')return publicJob(r,true);
  if(a.action==='read_merged')return mergedJob(api,owner,r.id,{summary:true});
  if(['pause','resume','cancel'].includes(a.action))return controlJob(api,a,owner,r,db);
  if(a.action==='read_result'){
   if(a.task_index===undefined||a.result_page===undefined)throw new QueryError('INVALID_ARGUMENT','请指定task_index和result_page。');
   const result=JSON.parse(r.results)[a.task_index];if(!result)throw new QueryError('NOT_FOUND','子任务结果不存在。');
   if(!result.output_ref){if(a.result_page!==1)throw new QueryError('INVALID_ARGUMENT','内联结果只有一页。');return {job_id:r.id,task_index:a.task_index,page:1,total_pages:1,has_more:false,next_page:null,result};}
   return {job_id:r.id,task_index:a.task_index,status:result.status,...await readChunk(db,owner,result.output_ref,a.result_page)};
  }
  return retryJob(api,a,owner,r,db);
 }
 // Only read-only DataFinder operations can be queued. Durable lease prevents simultaneous workers.
 const now=Date.now();
 // An expired worker must not advance after a pause request. Keep its checkpoint and attempt budget.
 await db.prepare("UPDATE cloud_jobs SET state=CASE WHEN attempts>=3 THEN 'failed' ELSE 'paused' END,control_request='',lease_token='',lease_until=0,updated_at=? WHERE owner=? AND state='running' AND control_request='pause' AND lease_until<?").bind(now,owner,now).run();
 await db.prepare("UPDATE job_attempts SET finished_at=?,status='lease_expired',error_code='LEASE_EXPIRED' WHERE owner=? AND status='running' AND started_at<?").bind(now,owner,now-180000).run();
 await db.prepare("UPDATE cloud_jobs SET state='failed',updated_at=? WHERE owner=? AND state='running' AND lease_until<? AND attempts>=3").bind(now,owner,now).run();
 const active=await db.prepare("SELECT COUNT(*) n FROM cloud_jobs WHERE owner=? AND state='running' AND lease_until>=?").bind(owner,now).first();if(active.n>=2)return {status:'throttled',reason:'concurrency_limit',limit:2};
 const r=await db.prepare("SELECT * FROM cloud_jobs WHERE owner=? AND ((state='queued' AND lease_until<=?) OR (state='running' AND lease_until<? AND attempts<3)) ORDER BY updated_at,created_at,id LIMIT 1").bind(owner,now,now).first();
 if(!r)return {status:'idle'};
 const token=crypto.randomUUID();
 const claim=await db.prepare("UPDATE cloud_jobs SET state='running',lease_token=?,lease_until=?,attempts=attempts+1,updated_at=? WHERE id=? AND owner=? AND cursor=? AND ((state='queued' AND lease_until<=?) OR (state='running' AND lease_until<? AND attempts<3)) AND (SELECT COUNT(*) FROM cloud_jobs WHERE owner=? AND state='running' AND lease_until>=?)<2").bind(token,now+180000,now,r.id,owner,r.cursor,now,now,owner,now).run();
 if(claim.meta?.changes!==1)return {status:'busy'};
 const tasks=JSON.parse(r.body),t=tasks[r.cursor],results=JSON.parse(r.results);let result,continuing=false;
 await db.prepare("UPDATE job_attempts SET finished_at=?,status='lease_expired',error_code='LEASE_EXPIRED' WHERE owner=? AND job_id=? AND status='running'").bind(now,owner,r.id).run();
 await db.prepare('INSERT INTO job_attempts(id,owner,job_id,task_index,started_at,status) VALUES(?,?,?,?,?,?)').bind(token,owner,r.id,r.cursor,now,'running').run();
 try{const {kind,...args}=t;let output;if(kind==='dependency'){const step=await (executors.dependency??dependencyStep)(api,t,await hydrateOutput(db,owner,results[r.cursor]??{}));output=step.output;continuing=step.continue;}else output=kind==='template'?await executors.template(api,{action:'run',...args},owner):await executors.inspection(api,args,owner);const incomplete=kind==='inspection'?output.status!=='success':kind==='template'&&output.output?.status&&output.output.status!=='success';result={task_index:r.cursor,status:continuing?'running':incomplete?'failed':'completed',...(incomplete?{error_code:kind==='inspection'?'INSPECTION_INCOMPLETE':'QUERY_INCOMPLETE'}:{}),output};}
 catch(e){result={task_index:r.cursor,status:'failed',error_code:e instanceof QueryError?e.code:'EXECUTION_FAILED',...(results[r.cursor]?.output?{output:results[r.cursor].output}:{}),...(results[r.cursor]?.output_ref?{output_ref:results[r.cursor].output_ref}:{}),...(e instanceof QueryError&&e.code==='DEPENDENCY_PAGE_FAILED'&&e.scan_failure?{scan_failure:e.scan_failure}:{})};}
 try{
  if(result.output!==undefined){
   const stored=await storeOutput(db,owner,result.output);const {output,...rest}=result;result={...rest,...stored};
  }
  const size=results.reduce((n,x,i)=>n+(i===r.cursor?0:x.output_ref?.bytes??byteLength(JSON.stringify(x))),0)+(result.output_ref?.bytes??byteLength(JSON.stringify(result)));
  if(size>MAX_JOB_BYTES)throw new QueryError('RESULT_TOO_LARGE','任务累计结果超过8MiB。');
 }catch(e){result={task_index:r.cursor,status:'failed',error_code:e instanceof QueryError?e.code:'RESULT_STORE_FAILED',...(results[r.cursor]?.output_ref?{output_ref:results[r.cursor].output_ref}:{}),...(results[r.cursor]?.output?{output:results[r.cursor].output}:{})};continuing=false;}
 const previousRetry=results[r.cursor]?.transient_attempts??0;const retry=result.status==='failed'?retryDecision(result.error_code,previousRetry,Date.now()):{retry:false,attempts:previousRetry};if(retry.retry){continuing=true;result={...result,status:'retry_wait',transient_attempts:retry.attempts,retry_not_before:retry.not_before};}else if(previousRetry)result.transient_attempts=retry.attempts;
 results[r.cursor]=result;
 const done=!continuing&&r.cursor+1===tasks.length,state=done?(results.every(x=>x.status==='completed')?'completed':'partial'):'queued';
 const saved=await db.prepare("UPDATE cloud_jobs SET state=CASE WHEN control_request='pause' AND ?='queued' THEN 'paused' ELSE ? END,control_request='',cursor=cursor+?,results=?,attempts=0,lease_until=?,lease_token=\'\',updated_at=? WHERE owner=? AND id=? AND lease_token=?").bind(state,state,continuing?0:1,JSON.stringify(results),retry.retry?retry.not_before:0,Date.now(),owner,r.id,token).run();
 if(saved.meta?.changes!==1)throw new QueryError('LEASE_LOST','执行租约已被接管，请回读任务。');
 await db.prepare('UPDATE job_attempts SET finished_at=?,status=?,error_code=? WHERE id=? AND owner=?').bind(Date.now(),retry.retry?'retry_wait':continuing?'checkpoint_saved':results[r.cursor].status,results[r.cursor].error_code??null,token,owner).run();
 return cloudJobs(api,{action:'read',job_id:r.id},owner,executors);
}

async function retryJob(api,a,owner,r,db){
 if(!a.confirmed||!a.request_key)throw new QueryError('INVALID_ARGUMENT','恢复需要confirmed=true和新的request_key；将创建关联任务，保留原记录。');
 if(!['partial','failed'].includes(r.state))throw new QueryError('INVALID_ARGUMENT','仅终止后的失败或部分失败任务可恢复。');
 const existing=await db.prepare('SELECT * FROM cloud_jobs WHERE owner=? AND recovery_of=?').bind(owner,r.id).first();
 if(existing){if(existing.request_key!==a.request_key)throw new QueryError('VERSION_CONFLICT','原任务已有恢复任务，请回读关联任务。');return publicJob(existing,true);}
 const tasks=JSON.parse(r.body),results=JSON.parse(r.results),selected=[],seed=[],indices=[];
 for(let i=0;i<tasks.length;i++){
  if(results[i]?.status==='completed')continue;
  let t=tasks[i];
  if(t.kind==='template'){
   const current=await queryTemplate(api,{action:'read',key:t.key},owner);
   if(current.revision!==t.expected_revision||current.source_status==='drifted')throw new QueryError('VERSION_CONFLICT','模板或来源已变化，不能恢复旧任务。');
  }else if(t.kind==='inspection'){
   for(const rule of t.rules){const current=await record(api,owner,'rule',rule.key);if(current.revision!==rule.revision)throw new QueryError('VERSION_CONFLICT','规则已变化，不能恢复旧任务。');}
   // Successful rules in a partially failed inspection are not queried again.
   const output=await hydrateOutput(db,owner,results[i]??{});
   const succeeded=new Set((output?.items??[]).filter(x=>x.status==='success').map(x=>x.key));
   t={...t,rules:t.rules.filter(x=>!succeeded.has(x.key))};
   if(!t.rules.length)continue;
  }
  indices.push(i);selected.push(t);
  const prior=results[i];seed.push(t.kind==='dependency'&&prior?{task_index:seed.length,status:'running',...(prior.output?{output:prior.output}:{}),...(prior.output_ref?{output_ref:prior.output_ref}:{})}:{task_index:seed.length,status:'pending'});
 }
 if(!selected.length)throw new QueryError('INVALID_ARGUMENT','没有可恢复的失败或未执行子任务。');
 // Dependency execution revalidates stored catalog/metadata fingerprints before it advances the checkpoint.
 const body=JSON.stringify(selected),hash=await configHash(selected),now=Date.now();
 await db.prepare("INSERT INTO cloud_jobs(id,owner,request_key,body_hash,body,state,cursor,results,attempts,lease_until,lease_token,created_at,updated_at,recovery_of,source_task_indices) VALUES(?,?,?,?,?,'queued',0,?,0,0,'',?,?,?,?) ON CONFLICT DO NOTHING").bind(crypto.randomUUID(),owner,a.request_key,hash,body,JSON.stringify(seed),now,now,r.id,JSON.stringify(indices)).run();
 const saved=await db.prepare('SELECT * FROM cloud_jobs WHERE owner=? AND recovery_of=?').bind(owner,r.id).first();
 if(!saved||saved.request_key!==a.request_key)throw new QueryError('VERSION_CONFLICT','恢复任务已存在或request_key已被使用，请回读。');
 return {...publicJob(saved,true),recovery_note:'仅恢复失败或未执行部分；目录/元数据指纹在执行前复核，变化时停止。上游数据可能变化，恢复不是同一时刻的数据快照。'};
}

async function controlJob(api,a,owner,r,db){
 if(!a.confirmed)throw new QueryError('INVALID_ARGUMENT','任务控制需要 confirmed=true。');
 let query;
 if(a.action==='pause')query="UPDATE cloud_jobs SET state=CASE WHEN state='queued' THEN 'paused' ELSE state END,control_request=CASE WHEN state='running' THEN 'pause' ELSE '' END,updated_at=? WHERE owner=? AND id=? AND state IN ('queued','running','paused')";
 if(a.action==='resume')query="UPDATE cloud_jobs SET state='queued',control_request='',updated_at=? WHERE owner=? AND id=? AND state='paused' AND attempts<3";
 if(a.action==='cancel')query="UPDATE cloud_jobs SET state='cancelled',control_request='',updated_at=? WHERE owner=? AND id=? AND state IN ('queued','paused','cancelled')";
 const changed=await db.prepare(query).bind(Date.now(),owner,r.id).run();
 if(changed.meta?.changes!==1)throw new QueryError('INVALID_ARGUMENT',a.action==='cancel'?'只能取消等待或已暂停的任务；运行中请先暂停并等当前查询结束。':'任务状态不允许此操作；终态不能恢复执行，达到重试上限请排查。');
 return cloudJobs(api,{action:'read',job_id:r.id},owner);
}
