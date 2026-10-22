import {z} from 'zod/v4';
import {database} from './governance.mjs';
import {QueryError} from './core.mjs';
export const storageShape={action:z.enum(['usage','preview_archive']).default('usage'),before:z.iso.datetime({offset:true}).optional(),job_ids:z.array(z.string().uuid()).min(1).max(20).optional()};
const tables={cloud_jobs:['body','results'],governance_records:['body'],governance_runs:['body'],inspection_observations:['body'],result_chunks:['body'],metadata_changes:['plan','result']};
export async function storageOverview(api,input,owner){
 const a=z.object(storageShape).strict().parse(input),db=database(api,owner),usage=[];
 for(const [table,fields] of Object.entries(tables)){
  const row=await db.prepare(`SELECT COUNT(*) AS rows,COALESCE(SUM(${fields.map(f=>`COALESCE(length(CAST(${f} AS BLOB)),0)`).join('+')}),0) AS payload_bytes FROM ${table} WHERE owner=?`).bind(owner).first();usage.push({table,...row});
 }
 const output={usage,total_payload_bytes:usage.reduce((s,r)=>s+r.payload_bytes,0),measurement:'本人记录所列 JSON/结果字段的 UTF-8 字节；不含索引、其他列、平台空间与费用。',deletion_enabled:false,archive_applied:false};
 if(a.action==='usage')return output;
 if(!a.before)throw new QueryError('INVALID_ARGUMENT','预览必须指定归档截止时间。');
 const rows=(await db.prepare('SELECT id,state,created_at,recovery_of,length(CAST(body AS BLOB))+length(CAST(results AS BLOB)) AS payload_bytes FROM cloud_jobs WHERE owner=?'+(a.job_ids?' AND id IN ('+a.job_ids.map(()=>'?').join(',')+')':' AND created_at<?')+' ORDER BY created_at,id LIMIT 101').bind(owner,...(a.job_ids??[Date.parse(a.before)])).all()).results;
 if(a.job_ids&&rows.length!==a.job_ids.length)throw new QueryError('NOT_FOUND','部分任务不存在或不属于本人。');
 const items=[];
 for(const row of rows.slice(0,100)){
  const children=await db.prepare('SELECT COUNT(*) AS n FROM cloud_jobs WHERE owner=? AND recovery_of=?').bind(owner,row.id).first();
  const reasons=[];
  if(!['completed','partial','failed','cancelled'].includes(row.state))reasons.push('任务尚未结束');
  if(row.created_at>=Date.parse(a.before))reasons.push('晚于归档截止时间');
  if(row.recovery_of||children.n)reasons.push('属于恢复任务链，合并查看与导出仍依赖它');
  // No row/chunk is removed. Even a display-only archive would need all references preserved.
  items.push({...row,preview_status:reasons.length?'retain':'candidate_for_display_archive',retain_reasons:reasons,required_preservation:['任务定义与结果','结果分块及校验值','巡检批次与异常处理引用','调度去重标识']});
 }
 return {...output,items,has_more:rows.length>100,preview_coverage:rows.length>100?'first_100_jobs':'selected_jobs_complete',candidate_count:items.filter(r=>r.preview_status==='candidate_for_display_archive').length,reclaimable_bytes:0,note:'仅预览日后从默认列表归档的候选项；不会归档、隐藏或删除任何记录。所有引用和结果必须保留，不承诺释放空间。超过100项可按任务ID分批预览。'};
}
