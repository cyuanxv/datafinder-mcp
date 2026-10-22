import {database} from './governance.mjs';
import {hydrateOutput,MAX_JOB_BYTES} from './result-store.mjs';
import {QueryError} from './core.mjs';
// Follow only the selected job's ancestry. Descendants must be selected explicitly.
export async function mergedJob(api,owner,id,{summary=false}={}){
 const db=database(api,owner),chain=[],seen=new Set();let next=id;
 while(next){
  if(seen.has(next)||chain.length>=20)throw new QueryError('RESULT_TOO_LARGE','恢复链超过20层或存在循环，请分别导出。');
  seen.add(next);const row=await db.prepare('SELECT * FROM cloud_jobs WHERE owner=? AND id=?').bind(owner,next).first();
  if(!row)throw new QueryError('NOT_FOUND','任务或原任务不存在。');chain.unshift(row);next=row.recovery_of;
 }
 const root=chain[0],tasks=JSON.parse(root.body),merged=tasks.map((task,i)=>({task_index:i,task,status:'pending',sources:[]}));let mapping=tasks.map((_,i)=>i),bytes=0;
 for(const row of chain){
  const localTasks=JSON.parse(row.body);
  if(row!==root){const indices=JSON.parse(row.source_task_indices);if(!Array.isArray(indices)||indices.length!==localTasks.length||indices.some(i=>!Number.isInteger(i)||mapping[i]===undefined))throw new QueryError('INVALID_RESULT','恢复来源映射无效。');mapping=indices.map(i=>mapping[i]);}
  const results=JSON.parse(row.results);
  for(let i=0;i<localTasks.length;i++){
   const target=merged[mapping[i]],task=localTasks[i],r=results[i];if(!r||['pending','running'].includes(r.status))continue;
   if(task.kind!==target.task.kind||task.start_date!==target.task.start_date||task.end_date!==target.task.end_date||(task.kind==='template'&&(task.key!==target.task.key||task.expected_revision!==target.task.expected_revision))||(task.kind==='dependency'&&(task.name!==target.task.name||task.asset_kind!==target.task.asset_kind||task.max_depth!==target.task.max_depth)))throw new QueryError('VERSION_CONFLICT','恢复任务口径不一致，不能合并。');
   bytes+=r.output_ref?.bytes??new TextEncoder().encode(JSON.stringify(r)).length;
   if(bytes>MAX_JOB_BYTES)throw new QueryError('RESULT_TOO_LARGE','恢复链读取超过8MiB，请分别导出。');
   const output=await hydrateOutput(db,owner,r),source={job_id:row.id,task_index:i,record_updated_at:row.updated_at,status:r.status};target.sources.push(source);
   if(task.kind==='inspection'){
    target.rules??=Object.fromEntries(target.task.rules.map(x=>[x.key,{key:x.key,revision:x.revision,status:'pending'}]));
    for(const item of output?.items??[]){const rule=task.rules.find(x=>x.key===item.key),expected=target.rules[item.key];
     if(!rule||!expected||expected.revision!==rule.revision)throw new QueryError('VERSION_CONFLICT','恢复规则版本不一致。');
     if(expected.status!=='success')target.rules[item.key]={...item,revision:rule.revision,source};
    }
    target.output={status:Object.values(target.rules).every(x=>x.status==='success')?'success':'partial',items:Object.values(target.rules)};
    target.status=target.output.status==='success'?'completed':'failed';
    if(target.status!=='completed')target.error_code=r.error_code??'INSPECTION_INCOMPLETE';else delete target.error_code;
   }else if(target.status!=='completed'){
    target.status=r.status;target.output=output;target.selected_source=source;
    if(r.error_code)target.error_code=r.error_code;else delete target.error_code;
   }
  }
 }
 for(const item of merged)delete item.rules;
 const result={root_job_id:root.id,selected_job_id:id,scope:'selected_job_and_ancestors',state:merged.every(x=>x.status==='completed')?'completed':'incomplete',chain:chain.map(r=>({job_id:r.id,state:r.state,updated_at:r.updated_at})),results:merged,note:'按原子任务和规则合并已成功结果，保留每项来源；不同执行时间不是同一数据快照，不跨日累加或重新计算去重指标。未读取所选任务之后的恢复任务。'};
 if(summary)return {...result,results:merged.map(({output,...r})=>({...r,...(output?.items?{rule_statuses:output.items.map(x=>({key:x.key,revision:x.revision,status:x.status,source:x.source}))}:{}),output_available:output!==undefined,output_preview:output===undefined?null:JSON.stringify(output).slice(0,1600),preview_truncated:output!==undefined&&JSON.stringify(output).length>1600})),note:result.note+' 此处返回合并状态和来源；完整结果使用 merged_job 导出。'};
 return result;
}
