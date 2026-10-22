// Deterministic fictional data. No credentials or external network access.
import {DataFinder} from './lib/core.mjs';
import {runAnalysis} from './lib/analysis.mjs';
import {encodeExport} from './lib/export.mjs';
export const days=Array.from({length:7},(_,i)=>'2020010'+(i+1));
export const fixture=days.flatMap((date,i)=>['Organic','Search','Referral'].flatMap((channel,j)=>['ios','android'].map(platform=>({date,channel,platform,count:(j+1)*80+i*12+(platform==='ios'?30:50)}))));
export async function demoAnalysis(platform='all'){
 if(!['all','ios'].includes(platform))throw Error('Unsupported demo platform');
 let requestDsl;
 const api=new DataFinder({DATAFINDER_AK:'demo-ak',DATAFINDER_SK:'demo-secret'},async(_url,init)=>{
  requestDsl=JSON.parse(init.body);
  const conditions=requestDsl.content.profile_filters.flatMap(f=>f.expression.conditions??[]);
  const os=conditions.find(c=>c.property_name==='os_name')?.property_values?.[0];
  if(conditions.length && os!=='ios')throw Error('Unexpected fixture filter');
  const rows=fixture.filter(r=>!os||r.platform===os);
  return Response.json({code:200,data:[{query_id:'a00:p00:c00:q00',result_status:'SUCCESS',is_truncated:false,date_index_list:days,data_item_list:['Organic','Search','Referral'].map((channel,i)=>({item_key:String(i),group_by_key:channel,event_name:'demo_page_view',data:days.map(date=>rows.filter(r=>r.date===date&&r.channel===channel).reduce((n,r)=>n+r.count,0))}))}]});
 });
 const input={kind:'event',events:[{event_name:'demo_page_view',indicator:'events'}],start_date:'2020-01-01',end_date:'2020-01-07',granularity:'day',group_by:[{property_name:'channel',property_type:'event_param'}],filters:platform==='ios'?[{property:{property_name:'os_name',property_type:'common_param'},operator:'=',values:['ios']}]:[]};
 const output=await runAnalysis(api,input);
 if(output.status!=='success')throw Error('Demo validation failed');
 const rows=output.data.results[0].series.map(s=>({channel:s.group_by_key,values:s.data,total:s.data.reduce((a,b)=>a+b,0)}));
 return {synthetic:true,platform,dates:days,total:rows.reduce((n,r)=>n+r.total,0),rows,input,output,dsl:requestDsl};
}
export function demoCSV(result){return encodeExport([['synthetic_data','date','channel','platform','event_count'],...result.rows.flatMap(r=>result.dates.map((date,i)=>['true',date,r.channel,result.platform,r.values[i]]))],'csv');}
