// Fictional acceptance fixture. Unknown requests fail; no live network fallback.
import {APP,PROJECT} from './lib/core.mjs';
const profile={name:'demo_property',show_name:'Demo property',description:'Fictional original description',value_type:'string',status:1};
export async function fixtureFetch(input,init={}){
 const url=new URL(input),path=url.pathname.replace(/^\/datafinder/,'');let body={};try{body=JSON.parse(init.body??'{}');}catch{}
 const board='8900000000000000006',report='8900000000000000007';
 const sql={version:3,app_ids:[Number(APP)],sql:'with totals as (select 1 as n from events) select day, n as revenue from totals',args:[]};
 if(path===`/openapi/v1/${APP}/dashboards/all`)return Response.json({code:200,data:[{app_id:Number(PROJECT),dashboard_id:board,name:'Fictional SQL board'}]});
 if(path===`/openapi/v1/${APP}/dashboards/${board}/reports`)return Response.json({code:200,data:{[board]:{reports:[{app_id:Number(PROJECT),report_id:report,report_name:'Fictional saved SQL',report_type:'custom_sql_query',dsls:[{app_id:Number(PROJECT),dsl_content:sql}]}]}}});
 if(path===`/openapi/v1/${APP}/reports/${report}`)return Response.json({code:200,data:{dsls:[{dsl_content:sql,data:{table_head:['day','revenue','missing'],table_body:[['2020-01-01',0,null],['2020-01-02',-2.5,null]]}}]}});
 if((init.method??'GET')==='POST'&&path==='/openapi/v1/analysis'){
  const c=body.content,dates=[];
  for(let time=body.periods[0].range[0];time<=body.periods[0].range[1];time+=86400)dates.push(new Date(time*1000+28800000).toISOString().slice(0,10).replaceAll('-',''));
  if(c.query_type!=='event'||!c.queries.every(g=>g.every(q=>q.event_name==='demo_page_view')))throw Error('Unsupported fictional query');
  return Response.json({code:200,data:c.queries.map((g,i)=>({query_id:`a00:p00:c00:q${String(i).padStart(2,'0')}`,result_status:'SUCCESS',is_truncated:false,date_index_list:dates,data_item_list:[{item_key:`a00:p00:c00:q${String(i).padStart(2,'0')}:e00:__all`,group_by_key:'__all',event_name:'demo_page_view',data:dates.map(()=>g[0].event_indicator==='event_users'?40:100)}]}))});
 }
 if(path===`/openapi/v1/metadata/${APP}/list/user_profiles`)return Response.json({code:200,data:[{...profile}]});
 if(path===`/openapi/v1/metadata/${APP}/list/events`)return Response.json({code:200,data:{list:[{name:'demo_page_view',event_name:'demo_page_view',show_name:'Demo page view'}],total:1}});
 if(path===`/openapi/v1/metadata/${APP}/profile:batchOperate`&&init.method==='POST'){if(body.operation_type!==6||body.profiles?.[0]?.name!=='demo_property')throw Error('Unsupported fictional mutation');const {desc,...fields}=body.profiles[0];Object.assign(profile,fields,...(desc!==undefined?[{description:desc}]:[]));return Response.json({code:200,data:{accepted:true}});}
 throw Error('Unknown fictional upstream request');
}
