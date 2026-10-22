import {DASHBOARD,PROJECT,APP,QueryError,reportId} from './core.mjs';
// Some empty dashboards return data={} from the association endpoint. Never infer
// emptiness from absence alone: verify the same project's explicit empty detail.
export async function dashboardAssociations(api,id,detail){
 reportId(id);
 const r=await api.request('GET',`/openapi/v1/${APP}/dashboards/${id}/reports`),a=r.data?.[id];
 if(Array.isArray(a?.reports))return a;
 if(!r.data||Array.isArray(r.data)||typeof r.data!=='object'||Object.keys(r.data).length)throw new QueryError('UNVERIFIED_CONTRACT','关联目录结构未知。');
 const d=detail??(await api.request('GET',`/openapi/v1/projects/${PROJECT}/dashboards/${id}`)).data?.[id];
 if(!d||String(d.app_id)!==PROJECT)throw new QueryError('OUT_OF_SCOPE','无法核验空看板的项目范围。');
 if(String(d.dashboard_id)!==id||d.is_dir!==false||d.page_config!==null||!Array.isArray(d.layout)||d.layout.length)throw new QueryError('UNVERIFIED_CONTRACT','关联缺失且详情未确认空看板。');
 return {reports:[],total:0,available:0,denied:0,verified_empty:true,empty_evidence:'matching_project_dashboard_null_page_config_empty_layout'};
}
export function dashboardView(data,related,id=DASHBOARD){
 reportId(id);const raw=data?.[id],a=related?.[id],d=a?.verified_empty&&raw?.page_config===null?{...raw,page_config:{children:[],props:{layout:[]}}}:raw;
 if(!d||String(d.dashboard_id)!==id||!Array.isArray(d.page_config?.children)||!Array.isArray(a?.reports))throw new QueryError('UNVERIFIED_CONTRACT','看板结构或关联列表不符合已验收契约。');
 const nodes=[];function walk(n){if(!n||typeof n!=='object')return;if(n.componentName==='Report')nodes.push(String(n.componentId));for(const c of n.children??[])walk(c);}walk(d.page_config);
 const ids=[...new Set(nodes)],relatedReports=new Map(a.reports.map(r=>[String(r.report_id),r]));
 const entry=id=>({id,name:relatedReports.get(id)?.report_name??id,report_type:relatedReports.get(id)?.report_type??null,association_found:relatedReports.has(id)});
 return {id,name:d.name??id,description:d.description??'',source:'live_dashboard_page_config',reports:ids.map(entry),page_report_node_count:nodes.length,page_report_count:ids.length,associated_reports:[...relatedReports.keys()].map(entry),layout:(d.page_config.props?.layout??[]).filter(x=>ids.includes(String(x.i))).map(({i,x,y,w,h})=>({report_id:String(i),x,y,w,h})),association:{total:a.total??null,available:a.available??null,denied:a.denied??null,received_count:a.reports.length,...(a.verified_empty?{verified_empty:true,empty_evidence:a.empty_evidence}:{}),page_match_count:ids.filter(id=>relatedReports.has(id)).length},warnings:['关联列表条目数与页面 Report 节点数分别统计；不把多余条目解释为隐藏图表。']};
}
export async function dashboardCatalog(api){
 const r=await api.request('GET',`/openapi/v1/${APP}/dashboards/all`);
 if(!Array.isArray(r.data))throw new QueryError('UNVERIFIED_CONTRACT','看板目录不是列表。');
 // This cloud-native endpoint returns project ID in app_id (verified contract).
 return r.data.filter(d=>String(d.app_id)===PROJECT&&!d.is_dir).map(d=>({id:String(d.dashboard_id),name:d.name??String(d.dashboard_id)}));
}
export async function readDashboard(api,id){
 reportId(id);
 const r=await api.request('GET',`/openapi/v1/projects/${PROJECT}/dashboards/${id}`);
 if(String(r.data?.[id]?.app_id)!==PROJECT)throw new QueryError('OUT_OF_SCOPE','看板不属于当前项目。');
 const a=await dashboardAssociations(api,id,r.data?.[id]);
 return api.output({data:dashboardView(r.data,{[id]:a},id),log_id:r.log_id},{source_dashboard_id:id});
}
export async function findCatalog(api,kind,keyword,page,dashboard_id){
 let items=[],failed=[],source='live_dashboard_catalog',complete=true;
 if(kind==='dashboards')items=await dashboardCatalog(api);
 else {
  const dashboards=dashboard_id?[{id:reportId(dashboard_id)}]:await dashboardCatalog(api),reports=new Map();source='live_dashboard_report_associations';
  for(let offset=0;offset<dashboards.length;offset+=4){
   const batch=await Promise.allSettled(dashboards.slice(offset,offset+4).map(async d=>{
    if(dashboard_id){const check=await api.request('GET',`/openapi/v1/projects/${PROJECT}/dashboards/${d.id}`);if(String(check.data?.[d.id]?.app_id)!==PROJECT)throw new QueryError('OUT_OF_SCOPE','看板不属于当前项目。');}
    const a=await dashboardAssociations(api,d.id);
    return {id:d.id,a};
   }));
   for(let j=0;j<batch.length;j++){const r=batch[j];if(r.status==='rejected'){failed.push({dashboard_id:dashboards[offset+j].id,code:r.reason?.code??'UPSTREAM_ERROR'});complete=false;continue;}
    const {id,a}=r.value;if(a.reports.length<(a.available??a.total??a.reports.length))complete=false;
    for(const x of a.reports){const rid=String(x.report_id);const old=reports.get(rid);if(old)old.dashboard_ids.push(id);else reports.set(rid,{id:rid,name:x.report_name??rid,report_type:x.report_type,dashboard_ids:[id]});}
   }
  }
  items=[...reports.values()];
 }
 const filtered=items.filter(i=>(i.id+' '+i.name).toLowerCase().includes(keyword.toLowerCase()));
 return {source,project_id:PROJECT,items:filtered.slice((page-1)*50,page*50),matched_count:filtered.length,received_count:items.length,page,page_size:50,has_more:page*50<filtered.length,complete,failed_dashboards:failed,coverage:kind==='reports'?'账号可见看板的关联报表；未关联看板的报表可直接按 ID 查询':'账号可见项目看板'};
}

// Dashboard associations contain saved definitions without executing their queries.
export async function readReportDefinition(api,id){
 reportId(id);const boards=await dashboardCatalog(api);
 for(let start=0;start<boards.length;start+=4){
  const batch=await Promise.allSettled(boards.slice(start,start+4).map(b=>api.request('GET',`/openapi/v1/${APP}/dashboards/${b.id}/reports`)));
  for(let i=0;i<batch.length;i++){const r=batch[i];if(r.status!=='fulfilled')continue;const report=r.value.data?.[boards[start+i].id]?.reports?.find(r=>String(r.report_id)===id);if(report?.dsls?.length)return {data:report,log_id:r.value.log_id};}
 }
 return api.report(id,{count:1});
}
