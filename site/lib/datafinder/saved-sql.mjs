import {z} from 'zod/v4';
import {APP,PROJECT,QueryError,reportId,parseLossless,assertScope} from './core.mjs';
import {dashboardCatalog} from './dashboard.mjs';
import {configHash} from './config-hash.mjs';
export const savedSqlShape={report_id:z.string(),action:z.enum(['read','execute']).default('read'),count:z.number().int().min(1).max(1000).default(100),expected_version:z.string().optional()};
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
 reportId(id);const boards=await dashboardCatalog(api);
 for(let start=0;start<boards.length;start+=4){
  const rs=await Promise.all(boards.slice(start,start+4).map(async b=>({id:b.id,r:await api.request('GET',`/openapi/v1/${APP}/dashboards/${b.id}/reports`)})));
  for(const {id:bid,r} of rs){const report=r.data?.[bid]?.reports?.find(x=>String(x.report_id)===id);if(!report)continue;
   if(!isSqlReport(report))throw new QueryError('NOT_SQL_REPORT','此报表不是已识别的 SQL 报表类型。');
   if(!Array.isArray(report.dsls)||!report.dsls.length)throw new QueryError('UNVERIFIED_CONTRACT','SQL 报表缺少已保存定义。');
   const definitions=parseSavedSqlDefinitions(report,api.env.DATAFINDER_ALLOW_PROJECT_WIDE==='true');
   return {report_id:id,name:report.report_name,report_type:report.report_type,definitions,version:await configHash(definitions),project_id:PROJECT,dashboard_id:bid};
  }
 }
 throw new QueryError('NOT_FOUND','当前项目可见看板目录未找到此 SQL 报表；请先将已保存 SQL 关联到看板。');
}
const sensitive=/(^|[^\w])(user_id|user_unique_id|device_id|distinct_id|uid|email|phone|mobile|message_content|chat_content)([^\w]|$)/i;
export function sqlResult(data,count){
 if(!Array.isArray(data?.dsls)||!data.dsls.length)throw new QueryError('UNVERIFIED_CONTRACT','SQL 报表未返回可识别的数据容器。');
 const tables=data.dsls.map(d=>{
  const x=d.data;
  if(!x||typeof x!=='object'||x.error_message||x.error_level)throw new QueryError('SQL_EXECUTION_FAILED','SQL返回错误或缺少结果，不作为成功数据。');
  if(!Array.isArray(x.table_head)||!x.table_head.length||!x.table_head.every(h=>typeof h==='string')||!Array.isArray(x.table_body)||!x.table_body.every(row=>Array.isArray(row)&&row.length===x.table_head.length))throw new QueryError('UNVERIFIED_CONTRACT','SQL表格结构不符合已验收契约。');
  if(sensitive.test(JSON.stringify(x)))throw new QueryError('PRIVATE_RESULT','结果包含受限字段，未向客户端输出。');
  return {name:d.dsl_name??null,columns:x.table_head,rows:x.table_body.slice(0,count),returned_rows:x.table_body.length,limit_reached:x.table_body.length>=count};
 });
 return {tables,requested_count:count,result_semantics:'DataFinder原生SQL报表结果；未改写SQL或时间条件。',completeness:'unknown',warnings:['count是输出行数上限，不代表完整数据。','结果可能来自DataFinder缓存；上游未证明重新计算或最新入库水位。']};
}
export async function savedSql(api,input){
 const a=z.object(savedSqlShape).strict().parse(input),def=await savedSqlDefinition(api,a.report_id);
 if(a.action==='read')return api.output({data:def},{status:'success',source_report_id:a.report_id,definition_status:'saved_sql',scope_description:'配置项目可见看板关联的已保存SQL定义'});
 if(!a.expected_version||a.expected_version!==def.version)throw new QueryError('VERSION_CONFLICT','执行前先读取SQL定义，并传回该版本expected_version。');
 if(def.definitions.some(d=>Array.isArray(d.args)&&d.args.length))throw new QueryError('UNSUPPORTED_QUERY','暂不执行含动态参数的SQL；请先保存参数已固定的报表。');
 if(sensitive.test(JSON.stringify(def.definitions)))throw new QueryError('PRIVATE_QUERY','此保存SQL涉及受限用户明细字段，当前插件不执行。');
 const r=await api.report(a.report_id,{count:a.count});
 const returned=r.data?.dsls?.map(d=>typeof d.dsl_content==='string'?parseLossless(d.dsl_content):d.dsl_content);
 if(!returned||await configHash(returned)!==def.version)throw new QueryError('VERSION_CONFLICT','执行返回的SQL定义已变化，请重新读取并确认版本。');
 return api.output({data:{...sqlResult(r.data,a.count),definition_version:def.version},log_id:r.log_id},{status:'success',validation:{status:'verified',contract:'custom_sql_query_table_v3',business_semantics:'not_reviewed',freshness:'unknown'},source_report_id:a.report_id,execution_status:'upstream_response_received',query_method:'saved_sql_report_api',warnings:['已收到上游结果，数值口径、采样、截断和数据新鲜度需核对。']});
}
