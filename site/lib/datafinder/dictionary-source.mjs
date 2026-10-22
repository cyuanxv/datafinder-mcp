import {PROJECT,APP,QueryError,extractDSL,reportId} from './core.mjs';
import {isSqlReport,parseSavedSqlDefinitions} from './saved-sql.mjs';
import {configHash} from './config-hash.mjs';
import {dashboardCatalog,dashboardAssociations} from './dashboard.mjs';

// Definition-only lookup. Never execute a report as a fallback for dictionary metadata.
export async function dictionaryCatalog(api,ids){
 const boards=await dashboardCatalog(api),selected=ids?boards.filter(b=>ids.includes(b.id)):boards;
 if(ids&&selected.length!==new Set(ids).size)throw new QueryError('OUT_OF_SCOPE','看板不在当前项目可见目录内。');
 const reports=new Map(),failed=[];
 for(let i=0;i<selected.length;i+=4){
  if(api.deadline!==undefined&&api.deadline-Date.now()<5000){failed.push(...selected.slice(i).map(b=>({dashboard_id:b.id,code:'DEADLINE'})));break;}
  const batch=await Promise.allSettled(selected.slice(i,i+4).map(async b=>({b,a:await dashboardAssociations(api,b.id)})));
  batch.forEach((x,j)=>{if(x.status==='rejected'){failed.push({dashboard_id:selected[i+j].id,code:x.reason?.code??'UPSTREAM_ERROR'});return;}
   const {b,a}=x.value;if(a.reports.length<(a.available??a.total??a.reports.length))failed.push({dashboard_id:b.id,code:'PARTIAL_CATALOG'});
   for(const r of a.reports){const id=String(r.report_id);reportId(id);const old=reports.get(id);if(old)old.dashboards.push(b);else reports.set(id,{report:r,dashboards:[b]});}
  });
 }
 return {entries:[...reports.values()],complete:!failed.length,failed_dashboards:failed};
}
export async function sourceFromReport(report,wide=false,dashboards=[]){
 const id=reportId(String(report.report_id));
 if(!Array.isArray(report.dsls)||!report.dsls.length)throw new QueryError('UNVERIFIED_CONTRACT','报表缺少定义。');
 const sql=isSqlReport(report),definitions=sql?parseSavedSqlDefinitions(report,wide):report.dsls.map(d=>extractDSL({...report,dsls:[d]},wide,true));
 // Preserve legacy ordinary-report fingerprints for existing records.
 const source_version=await configHash(sql?definitions:definitions.map(d=>({version:d.version,resources:d.resources,app_ids:d.app_ids,periods:d.periods,content:d.content})));
 const parameterized=sql&&definitions.some(d=>Array.isArray(d.args)&&d.args.length);
 return {report_id:id,name:report.report_name??id,report_type:report.report_type??'unknown',source_type:sql?'saved_sql':'report',project_id:PROJECT,metadata_app_id:APP,dashboards,source_version,definitions,metric_choices:!sql&&definitions.length===1?definitions[0].content.queries.map((q,i)=>({metric_index:i,display_number:i+1,labels:q.map(x=>x.show_label??null),events:q.map(x=>x.event_name??null),formulas:q.filter(x=>x.formula).map(x=>x.formula)})):[],
 date_capability:sql?{mode:parameterized?'parameters_unsupported':'saved_sql_only',accepts_requested_dates:false,explanation:'按已保存 SQL 原文执行；可能含固定日期或动态表达式，不接收查询方日期，也不自动改写。'}:{mode:definitions.every(d=>['event','retention'].includes(d.content?.query_type))?'report_date_override':'saved_configuration',accepts_requested_dates:definitions.length===1&&definitions.every(d=>['event','retention'].includes(d.content?.query_type)),explanation:'事件/留存的日期改写需通过现有查询工具验证；其他类型保留已保存配置。'},
 business_semantics:'not_reviewed',verified_at:new Date().toISOString(),source_link:dashboards.length?`https://console.volcengine.com/datafinder/project/${PROJECT}/dashboard/${dashboards[0].id}`:null};
}
export async function metricSource(api,id){
 reportId(id);const catalog=api._dictionaryCatalog??await dictionaryCatalog(api);api._dictionaryCatalog=catalog;const entry=catalog.entries.find(e=>String(e.report.report_id)===id);
 if(!entry)throw new QueryError(catalog.complete?'NOT_FOUND':'INCOMPLETE_CATALOG','可见看板关联中未找到此报表；不通过执行报表猜测定义。');
 return {...await sourceFromReport(entry.report,api.env.DATAFINDER_ALLOW_PROJECT_WIDE==='true',entry.dashboards),catalog_complete:catalog.complete};
}
