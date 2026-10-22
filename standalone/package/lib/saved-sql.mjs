import {z} from 'zod/v4';
import {APP,PROJECT,QueryError,reportId,parseLossless,assertScope} from './core.mjs';
import {dashboardCatalog} from './dashboard.mjs';
import {configHash} from './config-hash.mjs';
import {sqlOutputColumns} from './sql-columns.mjs';
const selectionSchema=z.object({table_index:z.number().int().min(0).max(99),columns:z.array(z.string().min(1).max(200).refine(v=>v.trim().length>0)).min(1).max(20).refine(v=>new Set(v).size===v.length,'列名不能重复')}).strict();
export const savedSqlShape={report_id:z.string(),action:z.enum(['read','preview','execute']).default('read'),count:z.number().int().min(1).max(1000).default(100),expected_version:z.string().optional(),selection:selectionSchema.optional(),preview_hash:z.string().length(64).optional()};
export const isSqlReport=r=>/^(sql|sql_analysis|sql_query|custom_sql|custom_sql_query|custom_sql_analysis|sql_custom_query|sql_custom_analysis)$/.test(r?.report_type??'');
export function parseSavedSqlDefinitions(report,wide=false){
 if(!isSqlReport(report)||!Array.isArray(report.dsls)||!report.dsls.length)throw new QueryError('UNVERIFIED_CONTRACT','SQL 报表缺少定义或类型未知。');
 return report.dsls.map(d=>{const v=typeof d.dsl_content==='string'?parseLossless(d.dsl_content):d.dsl_content;if(!v||typeof v!=='object')throw new QueryError('UNVERIFIED_CONTRACT','SQL 定义契约未知。');if(report.report_type==='custom_sql_query'){
    if(String(report.app_id)!==PROJECT||String(d.app_id)!==PROJECT||typeof v.sql!=='string'||v.version!==3)throw new QueryError('OUT_OF_SCOPE','SQL所属项目或定义版本无法验证。');
    assertScope({resources:[{project_ids:[PROJECT],app_ids:v.app_ids}]},wide);
   }else if(!assertScope(v,wide))throw new QueryError('OUT_OF_SCOPE','SQL缺少明确范围。');return v;});
}
// Membership is checked without executing the report. Do not use report() as a definition fallback.
export async function savedSqlDefinition(api,id){
 reportId(id);const boards=await dashboardCatalog(api);let incomplete=false;
 for(let start=0;start<boards.length;start+=4){
  if(api.deadline!==undefined&&api.deadline-Date.now()<5000){incomplete=true;break;}
  const rs=await Promise.allSettled(boards.slice(start,start+4).map(async b=>({id:b.id,r:await api.request('GET',`/openapi/v1/${APP}/dashboards/${b.id}/reports`)})));
  for(const entry of rs){if(entry.status==='rejected'){incomplete=true;continue;}const {id:bid,r}=entry.value,association=r.data?.[bid];
   if(!Array.isArray(association?.reports)){incomplete=true;continue;}
   if(association.reports.length<(association.available??association.total??association.reports.length))incomplete=true;
   const report=association.reports.find(x=>String(x.report_id)===id);if(!report)continue;
   if(!isSqlReport(report))throw new QueryError('NOT_SQL_REPORT','此报表不是已识别的 SQL 报表类型。');
   if(!Array.isArray(report.dsls)||!report.dsls.length)throw new QueryError('UNVERIFIED_CONTRACT','SQL 报表缺少已保存定义。');
   const definitions=parseSavedSqlDefinitions(report,api.env.DATAFINDER_ALLOW_PROJECT_WIDE==='true');
   return {report_id:id,name:report.report_name,report_type:report.report_type,definitions,version:await configHash(definitions),project_id:PROJECT,dashboard_id:bid};
  }
 }
 throw new QueryError(incomplete?'INCOMPLETE_CATALOG':'NOT_FOUND',incomplete?'部分看板目录读取不完整，暂时不能确定此SQL报表是否存在。':'当前项目可见看板目录未找到此 SQL 报表；请先将已保存 SQL 关联到看板。');
}
const sensitive=/(^|[^\w])(user_id|user_unique_id|device_id|distinct_id|uid|email|phone|mobile|message_content|chat_content)([^\w]|$)/i;
export function sqlResult(data,count,selection){
 if(selection)selection=selectionSchema.parse(selection);
 if(!Array.isArray(data?.dsls)||!data.dsls.length)throw new QueryError('UNVERIFIED_CONTRACT','SQL 报表未返回可识别的数据容器。');
 const tables=data.dsls.map(d=>{
  const x=d.data;
  if(!x||typeof x!=='object'||x.error_message||x.error_level)throw new QueryError('SQL_EXECUTION_FAILED','SQL返回错误或缺少结果，不作为成功数据。');
  if(!Array.isArray(x.table_head)||!x.table_head.length||!x.table_head.every(h=>typeof h==='string')||!Array.isArray(x.table_body)||!x.table_body.every(row=>Array.isArray(row)&&row.length===x.table_head.length))throw new QueryError('UNVERIFIED_CONTRACT','SQL表格结构不符合已验收契约。');
  if(sensitive.test(JSON.stringify(x)))throw new QueryError('PRIVATE_RESULT','结果包含受限字段，未向客户端输出。');
  return {name:d.dsl_name??null,columns:x.table_head,rows:x.table_body.slice(0,count),returned_rows:x.table_body.length,limit_reached:x.table_body.length>=count};
 });
 let selected=tables;
 if(selection){
  const table=tables[selection.table_index];if(!table)throw new QueryError('SQL_SELECTION_INVALID','所选SQL结果表不存在，请重新读取定义。');
  const indices=selection.columns.map(name=>{const matches=table.columns.flatMap((c,i)=>c===name?[i]:[]);if(matches.length!==1)throw new QueryError('SQL_SELECTION_INVALID','所选列不存在或列名重复，不能猜测对应指标。');return matches[0];});
  selected=[{...table,table_index:selection.table_index,columns:selection.columns,rows:table.rows.map(row=>indices.map(i=>row[i])),source_columns:table.columns}];
 }
 return {tables:selected,selection:selection??null,requested_count:count,result_semantics:'DataFinder原生SQL报表结果；未改写SQL或时间条件。列选择只裁剪已返回的列，不推断指标含义、不汇总、不筛选行。',completeness:'unknown',warnings:['count是输出行数上限，不代表完整数据。','结果可能来自DataFinder缓存；上游未证明重新计算或最新入库水位。']};
}
export async function savedSql(api,input){
 const a=z.object(savedSqlShape).strict().parse(input),def=await savedSqlDefinition(api,a.report_id);
 const column_candidates=def.definitions.map((d,table_index)=>({table_index,display_number:table_index+1,columns:sqlOutputColumns(d.sql??d.content?.sql).map(c=>c.name),interpretation:'仅列名候选；可能含维度。未识别的列可按结果表头手动填写，不推断业务含义。'}));
 if(a.action==='read'){
  if(a.selection||a.preview_hash)throw new QueryError('INVALID_ARGUMENT','读取定义不接受选列或执行预览凭据。');
  return api.output({data:{...def,column_candidates}},{status:'success',source_report_id:a.report_id,definition_status:'saved_sql',scope_description:'当前项目可见看板关联的已保存SQL定义'});
 }
 if(!a.expected_version||a.expected_version!==def.version)throw new QueryError('VERSION_CONFLICT','执行前先读取SQL定义，并传回该版本expected_version。');
 if(def.definitions.some(d=>Array.isArray(d.args)&&d.args.length))throw new QueryError('UNSUPPORTED_QUERY','暂不执行含动态参数的SQL；请先保存参数已固定的报表。');
 if(sensitive.test(JSON.stringify(def.definitions)))throw new QueryError('PRIVATE_QUERY','此保存SQL涉及受限用户明细字段，当前插件不执行。');
 if(a.selection&&a.selection.table_index>=def.definitions.length)throw new QueryError('SQL_SELECTION_INVALID','所选SQL定义序号不存在。');
 const preview={report_id:a.report_id,expected_version:def.version,count:a.count,selection:a.selection??null,date_mode:'saved_sql_only',note:'使用已保存SQL原日期；选列不改变行、日期或计算方式。未知列名与重复表头在结果返回后拒绝，不静默替换。'};
 const preview_hash=await configHash(preview);
 if(a.action==='preview')return api.output({data:{...preview,column_candidates,preview_hash},persisted:false,upstream_modified:false},{status:'preview',source_report_id:a.report_id});
 if((a.selection||a.preview_hash)&&a.preview_hash!==preview_hash)throw new QueryError('PREVIEW_CHANGED','选列、行数或来源版本已变化，请重新预览。');
 const r=await api.report(a.report_id,{count:a.count});
 const returned=r.data?.dsls?.map(d=>typeof d.dsl_content==='string'?parseLossless(d.dsl_content):d.dsl_content);
 if(!returned||await configHash(returned)!==def.version)throw new QueryError('VERSION_CONFLICT','执行返回的SQL定义已变化，请重新读取并确认版本。');
 return api.output({data:{...sqlResult(r.data,a.count,a.selection),definition_version:def.version,preview_hash},log_id:r.log_id},{status:'success',validation:{status:'verified',contract:'custom_sql_query_table_v3',business_semantics:'not_reviewed',freshness:'unknown'},source_report_id:a.report_id,execution_status:'upstream_response_received',query_method:'saved_sql_report_api',warnings:['已收到上游结果，数值口径、采样、截断和数据新鲜度需核对。']});
}
