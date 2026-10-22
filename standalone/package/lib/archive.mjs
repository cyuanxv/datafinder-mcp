import {z} from 'zod/v4';
import {database} from './governance.mjs';
import {configHash} from './config-hash.mjs';
import {QueryError} from './core.mjs';
export const archiveShape={action:z.enum(['preview','apply','history']),operation:z.enum(['archive','restore']).default('archive'),job_ids:z.array(z.string().uuid()).min(1).max(20),before_revision:z.number().int().positive().optional(),limit:z.number().int().min(1).max(50).default(20),preview_hash:z.string().length(64).optional(),confirmed:z.literal(true).optional()};
export async function manageArchive(api,input,owner){
 const a=z.object(archiveShape).strict().parse(input),db=database(api,owner);
 if(new Set(a.job_ids).size!==a.job_ids.length)throw new QueryError('INVALID_ARGUMENT','任务ID不能重复。');
 if(a.action==='history'){
  if(a.job_ids.length!==1)throw new QueryError('INVALID_ARGUMENT','历史查询一次指定一个任务。');
  const found=await db.prepare('SELECT id FROM cloud_jobs WHERE owner=? AND id=?').bind(owner,a.job_ids[0]).first();if(!found)throw new QueryError('NOT_FOUND','任务不存在。');
  const rows=await db.prepare("SELECT revision,body,created_at FROM governance_records WHERE owner=? AND kind='job_archive' AND record_key=? AND revision<? ORDER BY revision DESC LIMIT ?").bind(owner,a.job_ids[0],a.before_revision??2147483647,a.limit+1).all();
  const items=rows.results.slice(0,a.limit).map(r=>({revision:r.revision,created_at:r.created_at,...JSON.parse(r.body)}));return {job_id:a.job_ids[0],items,has_more:rows.results.length>a.limit,next_revision:rows.results.length>a.limit?items.at(-1).revision:null,data_deleted:false};
 }
 const items=[];
 for(const id of [...a.job_ids].sort()){
  const job=await db.prepare('SELECT id,state,updated_at,recovery_of FROM cloud_jobs WHERE owner=? AND id=?').bind(owner,id).first();
  if(!job)throw new QueryError('NOT_FOUND','任务不存在。');
  const saved=await db.prepare("SELECT revision,body FROM governance_records WHERE owner=? AND kind='job_archive' AND record_key=? ORDER BY revision DESC LIMIT 1").bind(owner,id).first();
  const archived=saved?JSON.parse(saved.body).archived:false,revision=saved?.revision??0;
  const eligible=a.operation==='restore'||['completed','partial','failed','cancelled'].includes(job.state);
  items.push({...job,archived,revision,eligible,will_change:archived!==(a.operation==='archive'),note:eligible?'只更改默认列表展示，结果、恢复链、去重标识和下载不变。':'任务尚未结束，不能归档。'});
 }
 const hash=await configHash({owner,operation:a.operation,items}),base={operation:a.operation,items,preview_hash:hash,data_deleted:false,results_preserved:true};
 if(a.action==='preview')return {...base,applied:false};
 if(!a.confirmed||a.preview_hash!==hash)throw new QueryError('VERSION_CONFLICT','任务或归档状态已变化，请重新预览确认。');
 if(items.some(x=>!x.eligible))throw new QueryError('INVALID_ARGUMENT','存在未结束任务，未执行归档。');
 const results=[];
 for(const item of items){
  if(!item.will_change){results.push({job_id:item.id,status:'unchanged',revision:item.revision});continue;}
  const body=JSON.stringify({archived:a.operation==='archive',operation:a.operation});
  const r=await db.prepare("INSERT INTO governance_records(owner,kind,record_key,revision,body,created_at) SELECT ?,'job_archive',?,?,?,? WHERE COALESCE((SELECT MAX(revision) FROM governance_records WHERE owner=? AND kind='job_archive' AND record_key=?),0)=? AND EXISTS(SELECT 1 FROM cloud_jobs WHERE owner=? AND id=? AND state=? AND updated_at=?)").bind(owner,item.id,item.revision+1,body,Date.now(),owner,item.id,item.revision,owner,item.id,item.state,item.updated_at).run();
  results.push({job_id:item.id,status:r.meta?.changes===1?'applied':'conflict',revision:r.meta?.changes===1?item.revision+1:item.revision});
 }
 return {...base,applied:results.every(r=>r.status!=='conflict'),status:results.some(r=>r.status==='conflict')?'partial':'completed',results};
}
export const archiveExpression="COALESCE((SELECT json_extract(g.body,'$.archived') FROM governance_records g WHERE g.owner=cloud_jobs.owner AND g.kind='job_archive' AND g.record_key=cloud_jobs.id ORDER BY g.revision DESC LIMIT 1),0)";
