import {exportHistory,compareViews,jobDiagnostics} from './workspace-diagnostics.mjs';
import {resultView} from './result-view.mjs';
import {z} from 'zod/v4';
import {database,record,readBatch} from './governance.mjs';
import {manageDefinitions} from './management.mjs';
import {diffValues} from './editor.mjs';
import {configHash} from './config-hash.mjs';
import {QueryError} from './core.mjs';
const key=z.string().min(1).max(80).regex(/^[\w.-]+$/);
export const workspaceShape={action:z.enum(['search','export','preview','apply','trend','audit','result','trend_export','audit_export','compare','retry_preview','diagnostics','integrity']),job_id:z.string().uuid().optional(),compare_job_id:z.string().uuid().optional(),compare_task_index:z.number().int().min(0).max(19).optional(),task_index:z.number().int().min(0).max(19).optional(),kind:z.enum(['rule','template','schedule','anomaly_handling','job_archive']).optional(),key:key.optional(),revision:z.number().int().positive().optional(),keyword:z.string().max(100).default(''),enabled:z.boolean().optional(),cursor:z.string().max(2000).optional(),limit:z.number().int().min(1).max(20).default(10),from:z.iso.datetime({offset:true}).optional(),to:z.iso.datetime({offset:true}).optional(),items:z.array(z.object({kind:z.enum(['rule','template']),key,expected_revision:z.number().int().min(0),value:z.record(z.string(),z.unknown())}).strict()).min(1).max(10).optional(),preview_hash:z.string().optional(),confirmed:z.literal(true).optional()};
const invalid=m=>{throw new QueryError('INVALID_ARGUMENT',m);};
export async function manageWorkspace(api,input,owner){
 const a=z.object(workspaceShape).strict().parse(input),db=database(api,owner);
 if(a.from&&a.to&&Date.parse(a.from)>Date.parse(a.to))invalid('开始时间不能晚于结束时间。');
 if(['trend_export','audit_export'].includes(a.action)){const {action,...rest}=a;return exportHistory(action,await manageWorkspace(api,{...rest,action:action==='trend_export'?'trend':'audit'},owner));}
 if(['diagnostics','integrity'].includes(a.action)){if(!a.job_id)invalid('需要任务ID。');return jobDiagnostics(api,a,owner);}
 if(a.action==='compare'){if(!a.job_id||!a.compare_job_id)invalid('需要两个任务ID。');const left=await resultView(api,a,owner),right=await resultView(api,{job_id:a.compare_job_id,task_index:a.compare_task_index??0},owner);return {...compareViews(left,right),left:{job_id:a.job_id,task_index:a.task_index??0,task:left.task},right:{job_id:a.compare_job_id,task_index:a.compare_task_index??0,task:right.task}};}
 if(a.action==='retry_preview'){
  if(!a.items)invalid('需要原始目标列表。');const retry=[],skipped=[];
  for(const item of a.items){let current;try{current=await record(api,owner,item.kind,item.key);}catch(e){if(e.code!=='NOT_FOUND')throw e;}
   if(current&&await configHash(current.value)===await configHash(item.value)){skipped.push({kind:item.kind,key:item.key,revision:current.revision,reason:'already_matches'});continue;}
   retry.push({...item,expected_revision:current?.revision??0});
  }
  if(!retry.length)return {entries:[],skipped,data_deleted:false,note:'所有目标已匹配，无需重试。'};
  return {...await manageWorkspace(api,{action:'preview',items:retry},owner),skipped,note:'已重新读取最新版本；逐项检查差异后用返回entries和preview_hash确认提交。不会自动覆盖或重试已经匹配的配置。'};
 }
 if(a.action==='result'){if(!a.job_id)invalid('需要任务ID。');return resultView(api,a,owner);}
 if(['preview','apply'].includes(a.action)){
  if(!a.items)invalid('需要完整目标配置列表。');
  if(new Set(a.items.map(x=>x.kind+':'+x.key)).size!==a.items.length)invalid('目标不能重复。');
  const entries=[];
  for(const item of a.items){let old;try{old=await record(api,owner,item.kind,item.key);}catch(e){if(e.code!=='NOT_FOUND')throw e;}
   if((old?.revision??0)!==item.expected_revision)throw new QueryError('VERSION_CONFLICT','目标版本变化，请重新预览。');
   const {name,...template}=item.value;if(item.kind==='template'&&(typeof name!=='string'||!name.trim()||name.length>100))invalid('模板名称必填且最多100字。');const validation=await manageDefinitions(api,{action:'validate',kind:item.kind,payload:item.kind==='template'?template:item.value},owner);if(item.kind==='template')validation.draft={name,...validation.draft};if(!validation.valid)invalid('草稿校验不通过。');
   entries.push({...item,value:validation.draft,differences:diffValues(old?.value??{},validation.draft),metadata_verified:validation.metadata_verified});
  }
  const hash=await configHash({owner,entries});
  if(a.action==='preview')return {entries,preview_hash:hash,data_deleted:false,note:'逐项提交，可能部分成功。规则启停不修改绑定计划；新版本需另行升级计划。'};
  if(!a.confirmed||a.preview_hash!==hash)throw new QueryError('VERSION_CONFLICT','需确认匹配的完整预览。');
  const results=[];
  for(const e of entries){try{const {name,...template}=e.value;const payload=e.kind==='rule'?{key:e.key,rule:e.value,expected_revision:e.expected_revision,confirmed:true}:{key:e.key,name,template,expected_revision:e.expected_revision,confirmed:true};const saved=await manageDefinitions(api,{action:'save',kind:e.kind,payload},owner);results.push({key:e.key,kind:e.kind,status:'saved',revision:saved.revision});}catch(error){results.push({key:e.key,kind:e.kind,status:'failed',error_code:error.code??'SAVE_FAILED'});}}
  return {results,data_deleted:false};
 }
 const scope=await configHash({owner,action:a.action,kind:a.kind,key:a.key,revision:a.revision,keyword:a.keyword,enabled:a.enabled,from:a.from,to:a.to});let c;
 try{if(a.cursor){c=JSON.parse(atob(a.cursor));if(c.scope!==scope||!Number.isSafeInteger(c.snapshot)||!Array.isArray(c.position))throw Error();}}catch{invalid('游标或筛选不匹配。');}
 const snapshot=c?.snapshot??Date.now();
 if(a.action==='trend'){
  if(!a.key||!a.revision)invalid('数值趋势必须指定规则和版本。');
  const where=['owner=?','rule_key=?','revision=?','created_at<=?'],args=[owner,a.key,a.revision,snapshot];
  if(a.from){where.push('created_at>=?');args.push(Date.parse(a.from));}if(a.to){where.push('created_at<=?');args.push(Date.parse(a.to));}
  if(c){where.push('(created_at<? OR (created_at=? AND run_id<?))');args.push(c.position[0],c.position[0],c.position[1]);}
  const rows=(await db.prepare('SELECT * FROM inspection_observations WHERE '+where.join(' AND ')+' ORDER BY created_at DESC,run_id DESC LIMIT ?').bind(...args,a.limit+1).all()).results;
  const items=[];for(const row of rows.slice(0,a.limit)){const b=await readBatch(api,row.run_id,owner),result=b.items.find(x=>x.key===a.key&&x.revision===a.revision);items.push({run_id:row.run_id,start_date:row.start_date,end_date:row.end_date,created_at:row.created_at,state:row.state,assessment:JSON.parse(row.body),result:result??null});}
  const last=rows[Math.min(a.limit,rows.length)-1];return {items,has_more:rows.length>a.limit,next_cursor:rows.length>a.limit?btoa(JSON.stringify({scope,snapshot,position:[last.created_at,last.run_id]})):null,note:'按观测时间分页；保留重复补查、同版本与原始分母，不合并区间人数；数据缺失不补零。'};
 }
 const audit=a.action==='audit';if(!audit&&!['rule','template'].includes(a.kind))invalid('请选择规则或模板。');
 const where=['g.owner=?','g.created_at<=?'],args=[owner,snapshot];
 if(a.kind){where.push('g.kind=?');args.push(a.kind);}else where.push("g.kind IN ('rule','template','schedule','anomaly_handling','job_archive')");
 if(a.key){where.push('g.record_key=?');args.push(a.key);}if(a.from){where.push('g.created_at>=?');args.push(Date.parse(a.from));}if(a.to){where.push('g.created_at<=?');args.push(Date.parse(a.to));}
 if(!audit)where.push('g.revision=(SELECT MAX(v.revision) FROM governance_records v WHERE v.owner=g.owner AND v.kind=g.kind AND v.record_key=g.record_key AND v.created_at<=?)'),args.push(snapshot);
 if(a.keyword){where.push("(instr(lower(g.record_key),lower(?))>0 OR instr(lower(COALESCE(json_extract(g.body,'$.name'),'')),lower(?))>0)");args.push(a.keyword,a.keyword);}
 if(a.enabled!==undefined){where.push("json_extract(g.body,'$.enabled')=?");args.push(a.enabled?1:0);}
 if(c){where.push('(g.created_at,g.kind,g.record_key,g.revision)<(?,?,?,?)');args.push(...c.position);}
 const rows=(await db.prepare('SELECT g.* FROM governance_records g WHERE '+where.join(' AND ')+' ORDER BY g.created_at DESC,g.kind DESC,g.record_key DESC,g.revision DESC LIMIT ?').bind(...args,a.limit+1).all()).results;
 const items=[];for(const r of rows.slice(0,a.limit)){const v=JSON.parse(r.body);const entry={kind:r.kind,key:r.record_key,revision:r.revision,created_at:r.created_at,value:v};if(audit){const prev=await db.prepare('SELECT body FROM governance_records WHERE owner=? AND kind=? AND record_key=? AND revision=?').bind(owner,r.kind,r.record_key,r.revision-1).first();entry.differences=diffValues(prev?JSON.parse(prev.body):{},v);}items.push(entry);}
 const last=rows[Math.min(a.limit,rows.length)-1];return {format:'datafinder-config-v1',items,has_more:rows.length>a.limit,next_cursor:rows.length>a.limit?btoa(JSON.stringify({scope,snapshot,position:[last.created_at,last.kind,last.record_key,last.revision]})):null,data_deleted:false,note:audit?'本人保存的配置版本历史；不冒称其他控制台操作审计。':'当前筛选分页；导出只含本页，可继续游标读取。'};
}
