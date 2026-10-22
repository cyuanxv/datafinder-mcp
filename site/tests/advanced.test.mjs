import test from 'node:test';
import assert from 'node:assert/strict';
import {advancedPlan,parseAdvanced,runAdvanced} from '../lib/datafinder/advanced.mjs';
import {listCohorts,queryUsage} from '../lib/datafinder/catalog-extras.mjs';
const common={start_date:'2026-10-10',end_date:'2026-10-10'};
const event={event_name:'launch'};
const revenue={property_name:'amount',property_type:'event_param'};
const base=()=>({query_id:'a00:p00:c00:q00',result_status:'SUCCESS',is_truncated:false,data_item_list:[]});
test('advanced builders preserve scope, dates and model constraints',()=>{for(const kind of ['path','lifecycle','ltv','attribution','topk']){const p=advancedPlan({...common,kind,events:kind==='topk'?[]:kind==='lifecycle'?[event]:[event,{event_name:'pay'}],...(kind==='ltv'?{revenue_property:revenue}:{})},true);assert.deepEqual(p.dsl.resources,[{project_ids:[1000001],subject_ids:[1],app_ids:[]}]);assert.equal(p.dsl.periods[0].timezone,'Asia/Shanghai');assert.equal(p.dsl.content.page.offset,0);}assert.throws(()=>advancedPlan({...common,kind:'lifecycle',events:[event],window:2},true));assert.throws(()=>advancedPlan({...common,kind:'ltv',events:[event,event],revenue_property:{property_name:'email',property_type:'event_param'}},true));assert.throws(()=>advancedPlan({...common,kind:'topk',events:[event]},true));});
test('failed or truncated advanced subqueries never become empty success',()=>{const p=advancedPlan({...common,kind:'path',events:[event,{event_name:'pay'}]},true);for(const r of [{...base(),result_status:'FAIL',error_code:400000,error_message:'secret'},{...base(),is_truncated:true},{...base(),query_id:'wrong'}])assert.throws(()=>parseAdvanced([r],p));});
test('lifecycle preserves missing category, rejects duplicate identity and date mismatch',()=>{const p=advancedPlan({...common,kind:'lifecycle',events:[event]},true),r={...base(),date_index_list:['20261010-20261010'],data_item_list:[{type:'new_user',group_by_key:'__all',event_show_name:'launch',data:[[10],[100]]},{type:'lost_user',group_by_key:'__all',event_show_name:'launch',data:[[],[]]}]};const a=parseAdvanced([r],p);assert.deepEqual(a.rows[1].users,[null]);r.data_item_list.push(r.data_item_list[0]);assert.throws(()=>parseAdvanced([r],p));});
test('LTV uses returned headers and never fills zero-sized cohorts or ongoing values as mature',()=>{const p=advancedPlan({...common,kind:'ltv',events:[event,{event_name:'cohort'}],revenue_property:revenue},true);const r={...base(),date_index_list:['20261010'],header_list:['事件;日期','用户数','LTV0','LTV至今'],data_item_list:[{group_by_key:'__all',event_name:'launch',details:[['20261010',0,0,0]]}]};const a=parseAdvanced([r],p);assert.equal(a.rows[0].values.LTV0.value,null);assert.equal(a.rows[0].values.LTV至今.maturity,'ongoing');r.header_list[2]='unknown';assert.throws(()=>parseAdvanced([r],p));});
test('attribution maps console-verified columns and rejects model drift',()=>{const p=advancedPlan({...common,kind:'attribution',events:[{event_name:'pay'},event]},true);const r={...base(),date_index_list:['2026-10-10 00:00:00-2026-10-10 23:59:59'],data_item_list:[{event_show_name:'launch',attribution_type:'last',group_by_key:'__all',data:[1,1,1,1,1,0]}]};assert.equal(parseAdvanced([r],p).validation,'verified');r.data_item_list[0].attribution_type='first';assert.throws(()=>parseAdvanced([r],p));});
test('cohorts omit personal fields and failed counts; usage missing dates remain unknown',async()=>{const api={output:(r,x)=>({...r,...x}),request:async()=>({data:[{app_id:1000002,cohort_id:'1234567890123456789',cohort_name:'a',cohort_status:2,count:0,creator:'private'}]})};const c=await listCohorts(api,{});assert.equal(c.data.items[0].count,null);assert.equal(JSON.stringify(c).includes('private'),false);api.request=async()=>({data:{1000002:{day_usage_amount:{}}}});const u=await queryUsage(api,common);assert.equal(u.status,'incomplete');assert.equal(u.data.rows[0].events,null);api.request=async()=>({data:{999:{day_usage_amount:{}}}});await assert.rejects(queryUsage(api,common));});
test('TopK refreshes both queries and rejects nonconserving or truncated rankings',async()=>{
 for(const mode of ['valid','mismatch','truncated']){
  let calls=0;
  const api={env:{DATAFINDER_ALLOW_PROJECT_WIDE:'true'},output:(r,x)=>({...r,...x}),request:async(method,path,dsl)=>{
   assert.equal(dsl.content.option.refresh_cache,true);calls++;
   const r={...base(),date_index_list:['2026-10-10 00:00:00-2026-10-10 23:59:59']};
   if(calls===1){r.is_truncated=mode==='truncated';r.data_item_list=[{common_params:{$event_name:'b'},result_type:'events',data:[10]},{common_params:{$event_name:'a'},result_type:'events',data:[10]}];}
   else r.data_item_list=[{data:[mode==='mismatch'?21:20]}];
   return {data:[r]};
  }};
  if(mode==='valid'){const r=await runAdvanced(api,{...common,kind:'topk',limit:1});assert.equal(r.data.items[0].event_name,'a');assert.equal(r.data.total_events,20);assert.equal(calls,2);}
  else await assert.rejects(runAdvanced(api,{...common,kind:'topk'}));
 }
});
test('irrelevant window overrides are rejected before a request',()=>{assert.throws(()=>advancedPlan({...common,kind:'topk',window:2},true));assert.throws(()=>advancedPlan({...common,kind:'ltv',window:2,events:[event,event],revenue_property:revenue},true));});
test('path uses official labels and interval, returns incomplete when result lacks date evidence',()=>{
 const p=advancedPlan({...common,kind:'path',events:[event,{event_name:'pay'}]},true);
 assert.equal(p.dsl.periods[0].interval,'86400');assert.equal(p.dsl.content.queries[0][1].show_label,'B');
 const r={...base(),date_index_list:[],events:{0:{event_name:'launch'},1:{event_name:'pay'},65535:{event_name:'__LOSS__'}},data_item_list:[{event_show_name:'launch',data:[[0,0,1,5],[0,0,65535,2]]}]};
 assert.equal(parseAdvanced([r],p).validation,'incomplete');assert.equal(parseAdvanced([r],p).semantic_validation,'console_verified_flow_columns');r.data_item_list[0].data[0][2]=99;assert.throws(()=>parseAdvanced([r],p));
});

test('attribution rejects inconsistent rate and preserves missing contacts',()=>{const p=advancedPlan({...common,kind:'attribution',events:[{event_name:'pay'},event]},true),r={...base(),date_index_list:['2026-10-10 00:00:00-2026-10-10 23:59:59'],data_item_list:[{event_show_name:'launch',attribution_type:'last',group_by_key:'__all',data:[100,5,.05,3,1,.27]}]};let a=parseAdvanced([r],p);assert.equal(a.rows[0].effective_trigger_count,5);assert.equal(a.rows[0].correlation,.27);r.data_item_list[0].data[2]=.5;assert.throws(()=>parseAdvanced([r],p));r.data_item_list=[];assert.equal(parseAdvanced([r],p).validation,'incomplete');});

test('path flow uses node conservation and rejects duplicate edges',()=>{const p=advancedPlan({...common,kind:'path',events:[event,{event_name:'pay'}]},true),r={...base(),date_index_list:[],events:{0:{event_name:'launch'},1:{event_name:'pay'},65535:{event_name:'__LOSS__'}},data_item_list:[{event_show_name:'launch',data:[[0,0,1,5],[0,0,65535,2]],node:{0:[{label:0,in_data:0,out_data:7,total:7}],1:[{label:1,in_data:5,out_data:0,total:5},{label:65535,in_data:2,out_data:0,total:2}]}}]};assert.equal(parseAdvanced([r],p).rows[0].conservation,'verified');r.data_item_list[0].node[1][0].in_data=6;assert.throws(()=>parseAdvanced([r],p));r.data_item_list[0].node[1][0].in_data=5;r.data_item_list[0].data.push([0,0,1,5]);assert.throws(()=>parseAdvanced([r],p));});
test('lifecycle display-name matching requires exact live metadata alias',async()=>{for(const good of [true,false]){const api={env:{DATAFINDER_ALLOW_PROJECT_WIDE:'true'},request:async(m,p)=>({data:p.includes('/list/')?[{name:'launch',show_name:good?'应用启动':'其他'}]:[{...base(),date_index_list:['20261010-20261010'],data_item_list:[{type:'new_user',group_by_key:'__all',event_show_name:'应用启动',data:[[10],[100]]}]}]}),output:(r,e)=>({...e,...r})};const run=runAdvanced(api,{...common,kind:'lifecycle',events:[event]});if(good)assert.equal((await run).data.rows[0].availability,'returned');else await assert.rejects(run,e=>e.code==='UNVERIFIED_CONTRACT');}});

test('lifecycle loss starts at second date and first date remains unknown',()=>{
 const p=advancedPlan({kind:'lifecycle',start_date:'2026-10-08',end_date:'2026-10-10',events:[event]},true);
 const r={...base(),date_index_list:['20261008-20261008','20261009-20261009','20261010-20261010'],data_item_list:[{type:'lost_user',group_by_key:'__all',event_show_name:'launch',data:[[7,8],[10,11]]}]};
 const x=parseAdvanced([r],p);assert.equal(x.validation,'incomplete');assert.deepEqual(x.rows[0].dates,r.date_index_list);assert.deepEqual(x.rows[0].users,[null,7,8]);assert.deepEqual(x.rows[0].percent,[null,10,11]);assert.equal(x.rows[0].unavailable_periods[0].date,r.date_index_list[0]);
 for(const data of [[[7],[10]],[[7,8],[10]],[[7,8],[10,101]],[[7,-8],[10,11]]]){r.data_item_list[0].data=data;assert.throws(()=>parseAdvanced([r],p));}
});
test('lost mode validates actual dates starting at second requested day',()=>{
 const p=advancedPlan({kind:'lifecycle',lifecycle_type:'lost',start_date:'2026-10-08',end_date:'2026-10-10',events:[event]},true);
 const r={...base(),date_index_list:['20261009-20261009','20261010-20261010'],data_item_list:['new_user','reflow_user','retention_user'].map(type=>({type,group_by_key:'__all',event_show_name:'launch',data:[[7,8],[10,11]]}))};
 assert.equal(parseAdvanced([r],p).validation,'verified');r.date_index_list=['20261008-20261008','20261009-20261009'];assert.throws(()=>parseAdvanced([r],p));
});
test('lifecycle first unknown does not mask real zero or missing categories',()=>{const p=advancedPlan({kind:'lifecycle',start_date:'2026-10-08',end_date:'2026-10-10',events:[event]},true);const r={...base(),date_index_list:['20261008-20261008','20261009-20261009','20261010-20261010'],data_item_list:['new_user','reflow_user','retention_user','lost_user'].map(type=>({type,group_by_key:'__all',event_show_name:'launch',data:type==='lost_user'?[[0,8],[0,11]]:[[0,0,0],[0,0,0]]}))};const out=parseAdvanced([r],p);assert.equal(out.validation,'verified');assert.deepEqual(out.rows[3].users,[null,0,8]);r.data_item_list[3].data=[[],[]];assert.equal(parseAdvanced([r],p).validation,'incomplete');});
