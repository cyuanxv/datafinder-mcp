import {z} from 'zod/v4';
import {scanDependencies} from './dependencies.mjs';
import {QueryError} from './core.mjs';
export const dependencyTask=z.object({kind:z.literal('dependency'),asset_kind:z.enum(['virtual_events','virtual_params']),name:z.string().min(1).max(120).regex(/^[\w$.-]+$/),max_depth:z.number().int().min(1).max(10).default(5)}).strict();
function mergeMatches(xs){const map=new Map();for(const x of xs){const {dashboard_id,dashboard_ids,...rest}=x,key=JSON.stringify(rest),old=map.get(key);map.set(key,{...rest,...((dashboard_id||dashboard_ids||old?.dashboard_ids)?{dashboard_ids:[...new Set([...(old?.dashboard_ids??[]),...(dashboard_ids??[]),...(dashboard_id?[dashboard_id]:[])])]}:{})});}return [...map.values()];}
const unique=xs=>[...new Map(xs.map(x=>[JSON.stringify(x),x])).values()];
export async function dependencyStep(api,task,previous,scan=scanDependencies){
 const page=previous?.next_page??1;
 const result=await scan(api,{kind:task.asset_kind,name:task.name,page,max_pages:1,max_depth:task.max_depth,...(previous?{catalog_version:previous.catalog_version,metadata_version:previous.metadata_version}:{})});
 if(result.failed.length){const error=new QueryError('DEPENDENCY_PAGE_FAILED','依赖扫描本页失败，未跳过；请查看运行记录后重新扫描。');error.scan_failure={page,failures:result.failed.slice(0,10).map(x=>({...(typeof x.dashboard_id==='string'&&/^\d{1,20}$/.test(x.dashboard_id)?{dashboard_id:x.dashboard_id}:{}),...(typeof x.kind==='string'&&['virtual_events','virtual_params'].includes(x.kind)?{kind:x.kind}:{}),code:typeof x.code==='string'&&/^[A-Z][A-Z0-9_]{0,70}$/.test(x.code)?x.code:'SCAN_FAILED'}))};throw error;}
 const boards=unique([...(previous?.scanned_dashboard_ids??[]),...result.scanned_dashboard_ids]),reports=unique([...(previous?.scanned_report_ids??[]),...(result.scanned_report_ids??[])]);
 const matches=mergeMatches([...(previous?.matches??[]),...result.matches]),unknown=unique([...(previous?.unknown??[]),...result.unknown.filter(x=>x.reason!=='scan_deadline')]);
 if(result.omitted.matches||result.omitted.unknown)throw new QueryError('RESULT_TOO_LARGE','本页结果截断，不能作为完整续扫检查点。');
 const stalls=result.has_more&&result.next_page<=page?(previous?.stalls??0)+1:0;
 if(stalls>=3)throw new QueryError('SCAN_STALLED','同一页连续三次未完成，请缩小扫描范围或稍后重新提交。');
 const output={target:result.target,catalog_version:result.catalog_version,metadata_version:result.metadata_version,next_page:result.next_page,pages_processed:(previous?.pages_processed??0)+1,stalls,has_more:result.has_more,scanned_dashboard_ids:boards,verified_empty_dashboard_ids:unique([...(previous?.verified_empty_dashboard_ids??[]),...(result.verified_empty_dashboard_ids??[])]),scanned_report_ids:reports,sql_dependency_checks:unique([...(previous?.sql_dependency_checks??[]),...(result.sql_dependency_checks??[])]),scanned_dashboard_count:boards.length,scanned_report_count:reports.length,visible_dashboard_count:result.visible_dashboard_count,matches,unknown,failed:[],coverage:'partial',visible_catalog_finished:!result.has_more,page_complete:(previous?.page_complete??true)&&result.page_complete,limitations:['后台每次续扫3个看板，跨次保存并去重；未关联或不可见报表仍未覆盖。',...result.limitations.filter(x=>!x.startsWith('批量合并最多'))]};

 return {output,continue:result.has_more};
}
