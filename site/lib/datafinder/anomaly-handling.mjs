import {anomalyDetail} from './anomaly-detail.mjs';
import {z} from 'zod/v4';
import {database} from './governance.mjs';
import {configHash} from './config-hash.mjs';
import {QueryError} from './core.mjs';
export const handlingShape={action:z.enum(['read','update','detail']),history_before_revision:z.number().int().positive().optional(),history_limit:z.number().int().min(1).max(50).default(50),run_id:z.string().uuid(),rule_key:z.string().min(1).max(80),expected_revision:z.number().int().min(0).optional(),status:z.enum(['unread','acknowledged','investigating','resolved']).optional(),note:z.string().trim().max(2000).optional(),job_id:z.string().uuid().nullable().optional(),confirmed:z.literal(true).optional()};
export const handlingKey=(run,rule)=>configHash([run,rule]);
export const defaultHandling={revision:0,status:'unread',note:'',job_id:null,updated_at:null};
export function handlingView(row){return row?{revision:row.revision,...JSON.parse(row.body),updated_at:row.created_at}:{...defaultHandling};}
export async function manageAnomaly(api,input,owner){
 const a=z.object(handlingShape).strict().parse(input),db=database(api,owner);
 const observation=await db.prepare('SELECT * FROM inspection_observations WHERE owner=? AND run_id=? AND rule_key=?').bind(owner,a.run_id,a.rule_key).first();
 if(!observation)throw new QueryError('NOT_FOUND','异常观测记录不存在。');
 if(a.action==='detail')return anomalyDetail(api,owner,a.run_id,a.rule_key);
 const key=await handlingKey(a.run_id,a.rule_key);
 if(a.action==='update'){
  if(a.expected_revision===undefined||!a.status||a.note===undefined||a.job_id===undefined||!a.confirmed)throw new QueryError('INVALID_ARGUMENT','保存需版本、处理状态、备注、关联任务（可为null）及确认。');
  if(a.status==='resolved'&&!a.note)throw new QueryError('INVALID_ARGUMENT','标记已处理需要填写处理说明；不会标记数据已恢复。');
  if(a.job_id){
   const job=await db.prepare('SELECT body FROM cloud_jobs WHERE owner=? AND id=?').bind(owner,a.job_id).first();
   if(!job)throw new QueryError('NOT_FOUND','关联任务不存在。');
   const tasks=JSON.parse(job.body);
   if(!tasks.some(t=>t.kind==='inspection'&&t.rules.some(r=>r.key===a.rule_key&&r.revision===observation.revision)))throw new QueryError('INVALID_ARGUMENT','关联任务必须含同一规则及版本的巡检。');
  }
  const body=JSON.stringify({status:a.status,note:a.note,job_id:a.job_id});
  const result=await db.prepare("INSERT INTO governance_records(owner,kind,record_key,revision,body,created_at) SELECT ?,'anomaly_handling',?,?,?,? WHERE COALESCE((SELECT MAX(revision) FROM governance_records WHERE owner=? AND kind='anomaly_handling' AND record_key=?),0)=?").bind(owner,key,a.expected_revision+1,body,Date.now(),owner,key,a.expected_revision).run();
  if(result.meta?.changes!==1)throw new QueryError('VERSION_CONFLICT','处理记录已变化，请刷新后再保存。');
 }
 const latest=await db.prepare("SELECT revision,body,created_at FROM governance_records WHERE owner=? AND kind='anomaly_handling' AND record_key=? ORDER BY revision DESC LIMIT 1").bind(owner,key).first();
 const before=a.action==='read'?a.history_before_revision:undefined;
 const rows=await db.prepare("SELECT revision,body,created_at FROM governance_records WHERE owner=? AND kind='anomaly_handling' AND record_key=?"+(before?' AND revision<?':'')+" ORDER BY revision DESC LIMIT ?").bind(owner,key,...(before?[before]:[]),a.history_limit+1).all();
 return {run_id:a.run_id,rule_key:a.rule_key,observation_state:observation.state,handling:handlingView(latest),history:rows.results.slice(0,a.history_limit).map(handlingView),history_has_more:rows.results.length>a.history_limit,history_next_revision:rows.results.length>a.history_limit?rows.results[a.history_limit-1].revision:null,data_recovery_changed:false,note:'人工处理仅作用于这条观测；已处理不代表数据恢复。新异常不会继承旧处理状态。'};
}
