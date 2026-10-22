import {archiveExpression} from './archive.mjs';
import {z} from 'zod/v4';
import {QueryError} from './core.mjs';
import {configHash} from './config-hash.mjs';
export const historyShape={archive:z.enum(['active','archived','all']).default('active'),limit:z.number().int().min(1).max(50).default(20),cursor:z.string().max(1500).optional(),status:z.string().max(40).optional(),from:z.iso.datetime({offset:true}).optional(),to:z.iso.datetime({offset:true}).optional()};
const definitions={jobs:{table:'cloud_jobs',time:'created_at',state:'state',statuses:['paused','cancelled','queued','running','partial','failed','completed']},attempts:{table:'job_attempts',time:'started_at',state:'status',statuses:['running','lease_expired','checkpoint_saved','failed','completed']},dispatches:{table:'dispatch_runs',time:'started_at',state:'status',statuses:['running','completed','failed','task_failed']}};
export async function historyRows(db,owner,kind,a){
 const d=definitions[kind];if(!d)throw new QueryError('INVALID_ARGUMENT','无效历史类型。');
 if(a.status&&!d.statuses.includes(a.status))throw new QueryError('INVALID_ARGUMENT','状态不适用于所选历史类型。');
 if(a.from&&a.to&&Date.parse(a.from)>Date.parse(a.to))throw new QueryError('INVALID_ARGUMENT','起始时间不能晚于结束时间。');
 const scope=await configHash({owner,kind,archive:kind==='jobs'?(a.archive??'active'):undefined,status:a.status,from:a.from,to:a.to,job_id:a.job_id});
 let cursor;try{if(a.cursor){cursor=JSON.parse(atob(a.cursor));if(cursor.scope!==scope||!Number.isSafeInteger(cursor.time)||typeof cursor.id!=='string'||cursor.id.length>100)throw Error();}}catch{throw new QueryError('INVALID_ARGUMENT','游标无效或筛选条件已改变，请从第一页读取。');}
 const where=['owner=?'],values=[owner];if(kind==='jobs'&&(a.archive??'active')!=='all'){where.push(archiveExpression+'=?');values.push(a.archive==='archived'?1:0);}if(a.status){where.push(`${d.state}=?`);values.push(a.status);}if(a.job_id){if(kind!=='attempts')throw new QueryError('INVALID_ARGUMENT','job_id仅用于执行尝试历史。');where.push('job_id=?');values.push(a.job_id);}
 if(a.from){where.push(`${d.time}>=?`);values.push(Date.parse(a.from));}if(a.to){where.push(`${d.time}<=?`);values.push(Date.parse(a.to));}
 if(cursor){where.push(`(${d.time}<? OR (${d.time}=? AND id<?))`);values.push(cursor.time,cursor.time,cursor.id);}
 const rows=(await db.prepare(`SELECT *${kind==='jobs'?','+archiveExpression+' AS archived':''} FROM ${d.table} WHERE ${where.join(' AND ')} ORDER BY ${d.time} DESC,id DESC LIMIT ?`).bind(...values,a.limit+1).all()).results;
 const items=rows.slice(0,a.limit),last=items.at(-1),more=rows.length>a.limit;
 return {items,has_more:more,next_cursor:more?btoa(JSON.stringify({scope,time:last[d.time],id:last.id})):null,order:'newest_first',time_field:d.time,filter_status:'stored_status'};
}
