import {database} from './governance.mjs';
import {hydrateOutput,MAX_JOB_BYTES,MAX_RESULT_BYTES} from './result-store.mjs';
import {QueryError} from './core.mjs';
import {configHash} from './config-hash.mjs';
const fail=m=>{throw new QueryError('INVALID_ARGUMENT',m);};
export function csvDocument(headers,rows){
 const cell=v=>{let s=v==null?'':typeof v==='object'?JSON.stringify(v):String(v);if(typeof v!=='number'&&/^[\s]*[=+@-]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
 return '\ufeff'+[headers,...rows].map(r=>r.map(cell).join(',')).join('\r\n');
}
export function exportHistory(action,page){
 const trend=action==='trend_export';
 const headers=trend?['run_id','start_date','end_date','observed_at','state','value','denominator','previous_value','relative_change','evidence_json']:['kind','key','revision','created_at','differences_json','value_json'];
 const rows=page.items.map(x=>trend?[x.run_id,x.start_date,x.end_date,new Date(x.created_at).toISOString(),x.state,x.assessment?.measurement?.value,x.assessment?.measurement?.denominator,x.assessment?.previous_value,x.assessment?.relative_change,{assessment:x.assessment,result:x.result}]:[x.kind,x.key,x.revision,new Date(x.created_at).toISOString(),x.differences,x.value]);
 return {csv:csvDocument(headers,rows),row_count:rows.length,next_cursor:page.next_cursor,has_more:page.has_more,scope:'current_page',note:'只导出本页，继续相同筛选游标取后续页。空字段为未知，证据JSON保留null；公式前缀已转义。'};
}
export function compareViews(left,right){
 const a=left.task,b=right.task;
 // Identity includes the immutable template revision. Exact-date matching avoids positional cohort inference.
 if(!a||!b||a.kind!=='template'||b.kind!=='template'||a.key!==b.key||a.expected_revision!==b.expected_revision||a.start_date!==b.start_date||a.end_date!==b.end_date)return {comparable:false,reasons:['需要同一模板、同一版本、相同日期范围；不同口径不计算差异。'],rows:[]};
 const flatten=view=>{const map=new Map();for(const s of view.series)for(const p of s.points){const id=JSON.stringify([s.id,s.group,p.label]);if(map.has(id))fail('序列存在重复分组，不能对齐。');map.set(id,{series:s.label,label:p.label,value:p.value,truncated:s.truncated});}return map;};
 const l=flatten(left),r=flatten(right),rows=[];
 for(const id of new Set([...l.keys(),...r.keys()])){const x=l.get(id),y=r.get(id),numeric=Number.isFinite(x?.value)&&Number.isFinite(y?.value);rows.push({series:(x??y).series,label:(x??y).label,left:x?.value??null,right:y?.value??null,difference:numeric?y.value-x.value:null,relative_change:numeric&&x.value!==0?(y.value-x.value)/Math.abs(x.value):null,status:!x||!y?'unmatched':numeric?'matched':'unknown'});}
 return {comparable:true,rows,quality_status:[left.quality_status,right.quality_status],warnings:[...left.warnings,...right.warnings],note:'右值减左值，仅比较已保存数值；不代表上游完整、统计显著或业务原因。缺失不补零，零基线无增幅。'};
}
export async function jobDiagnostics(api,a,owner){
 const db=database(api,owner),job=await db.prepare('SELECT * FROM cloud_jobs WHERE owner=? AND id=?').bind(owner,a.job_id).first();if(!job)throw new QueryError('NOT_FOUND','任务不存在。');
 if(a.action==='integrity'){
  const results=JSON.parse(job.results),checks=[];let budget=0;
  for(let i=0;i<results.length;i++){const r=results[i],ref=r.output_ref;let size=ref?.bytes??new TextEncoder().encode(JSON.stringify(r.output??null)).length;
   if(ref&&(!Number.isInteger(ref.pages)||ref.pages<1||ref.pages>128||!Number.isInteger(size)||size<0||size>MAX_RESULT_BYTES)){checks.push({task_index:i,status:'invalid_reference'});continue;}
   if(budget+size>MAX_JOB_BYTES){checks.push({task_index:i,status:'budget_exceeded'});continue;}budget+=size;
   if(!ref&&!Object.hasOwn(r,'output')){checks.push({task_index:i,status:'no_output',task_status:r.status});continue;}
   try{await hydrateOutput(db,owner,r);checks.push({task_index:i,status:ref?'verified':'inline_readable',bytes:size,pages:ref?.pages??0});}catch(e){if(e.code!=='RESULT_CORRUPT'&&!(e instanceof SyntaxError))throw e;checks.push({task_index:i,status:'corrupt',code:e.code??'INVALID_JSON'});}
  }
  return {job_id:job.id,checks,task_count:JSON.parse(job.body).length,result_count:results.length,scope:'referenced_results_of_this_job',complete:results.length===JSON.parse(job.body).length&&checks.every(x=>['verified','inline_readable','no_output'].includes(x.status)),data_deleted:false,note:'只检查本任务已发布的结果引用；内联结果无历史摘要，只验证可读。未扫描孤立分块，不代表业务数值正确。'};
 }
 const scope=await configHash({owner,job_id:a.job_id,action:a.action});let c;
 try{if(a.cursor){c=JSON.parse(atob(a.cursor));if(c.scope!==scope||!Number.isSafeInteger(c.snapshot)||!Array.isArray(c.position)||c.position.length!==2)throw Error();}}catch{fail('诊断游标不匹配。');}
 const snapshot=c?.snapshot??Date.now(),args=[owner,job.id,snapshot],where=['owner=?','job_id=?','started_at<=?'];if(c){where.push('(started_at,id)<(?,?)');args.push(...c.position);}
 const rows=(await db.prepare('SELECT id,task_index,started_at,finished_at,status,error_code FROM job_attempts WHERE '+where.join(' AND ')+' ORDER BY started_at DESC,id DESC LIMIT ?').bind(...args,a.limit+1).all()).results,last=rows[Math.min(rows.length,a.limit)-1];
 return {job_id:job.id,state:job.state,cursor:job.cursor,retry_not_before:job.state==='queued'&&job.lease_until>Date.now()?job.lease_until:null,results:JSON.parse(job.results).map((r,i)=>({task_index:i,status:r.status,error_code:r.error_code??null,transient_attempts:r.transient_attempts??0,retry_not_before:r.retry_not_before??null})),attempts:rows.slice(0,a.limit),has_more:rows.length>a.limit,next_cursor:rows.length>a.limit?btoa(JSON.stringify({scope,snapshot,position:[last.started_at,last.id]})):null,note:'等待时间是最早可领取时间，不是承诺执行时间；仅展示已有尝试，不触发重试。'};
}
