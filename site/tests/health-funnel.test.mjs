import test from 'node:test';import assert from 'node:assert/strict';
import {DataFinder} from '../lib/datafinder/core.mjs';
import {freePlan} from '../lib/datafinder/analysis.mjs';
import {scalarCounts,healthAssessment,qualityAssessment,checkTrackingHealth,checkPropertyQuality} from '../lib/datafinder/health.mjs';
import {funnelPlan,parseFunnel,runFunnel} from '../lib/datafinder/funnel.mjs';
const dates={start_date:'2026-10-01',end_date:'2026-10-01'},event={event_name:'launch'},property={property_name:'os_name',property_type:'common_param'};
const env={DATAFINDER_ALLOW_PROJECT_WIDE:'true',DATAFINDER_AK:'test',DATAFINDER_SK:'test'};
const p=freePlan({...dates,events:[event,event],granularity:'all'},true);
const raws=values=>values.map((n,i)=>({query_id:`a00:p00:c00:q0${i}`,result_status:'SUCCESS',is_truncated:false,date_index_list:['2026-10-01 00:00:00-2026-10-01 23:59:59'],data_item_list:[{data:[n]}]}));
test('scalar counts use identity and preserve zero',()=>assert.deepEqual(scalarCounts(raws([0,100]).reverse(),p),[0,100]));
test('counts reject unknown, missing, duplicate, extra, fraction, truncation and wrong date',()=>{for(const rows of [raws([null,1]),raws([1.5,1]),raws([1]),raws([1,2,3]),[raws([1])[0],raws([1])[0]],raws([1,2]).map(r=>({...r,is_truncated:true})),raws([1,2]).map(r=>({...r,date_index_list:['wrong']}))])assert.throws(()=>scalarCounts(rows,p));});
test('health separates inadequate baseline, loss, anomaly and normal',()=>{assert.equal(healthAssessment(0,[0,0],100,.5).assessment,'insufficient_baseline');assert.equal(healthAssessment(0,[100,200],100,.5).assessment,'possible_event_loss');assert.equal(healthAssessment(200,[100,100],100,.5).assessment,'volume_anomaly');assert.equal(healthAssessment(100,[100,100],100,.5).assessment,'within_threshold');});
test('quality checks partitions; absent rule and zero denominator stay null',()=>{assert.equal(qualityAssessment([0,0,0,0]).missing_rate,null);assert.equal(qualityAssessment([10,1,2,9]).invalid_events,null);const r=qualityAssessment([100,10,5,90,40,30],['a','b']);assert.equal(r.missing_events,15);assert.equal(r.invalid_events,15);assert.equal(r.invalid_rate_among_nonempty,15/85);assert.throws(()=>qualityAssessment([10,1,0,10],[]));assert.throws(()=>qualityAssessment([10,0,0,10,11],['a']));});
test('health rejects overlapping dates and private filters before API',async()=>{let calls=0;const api=new DataFinder(env,()=>{calls++;throw Error();});for(const input of [{...dates,end_date:'2026-10-08',events:[event]},{...dates,events:[event],filters:[{property:{...property,property_name:'user_id'},operator:'=',values:['1']}]},{...dates,events:[{...event,indicator:'events'}]}])await assert.rejects(checkTrackingHealth(api,input));assert.equal(calls,0);});
test('quality queries disjoint precise counts and rejects duplicate rules',async()=>{let d;const api=new DataFinder(env,async(u,o)=>{d=JSON.parse(o.body);return Response.json({code:200,data:raws([100,10,5,90,70])});});const r=await checkPropertyQuality(api,{...dates,event,property,allowed_values:['ios']});assert.equal(r.data.invalid_events,15);assert.equal(d.content.queries[4][0].filters[0].expression.conditions.length,3);assert.ok(d.content.queries.every(q=>q[0].event_indicator==='events'));await assert.rejects(checkPropertyQuality(api,{...dates,event,property,allowed_values:['ios','ios']}));});
const fp=()=>funnelPlan({...dates,steps:[event,{event_name:'play'},{event_name:'pay'}]},true);
const fr=()=>[{query_id:'a00:p00:c00:q00',result_status:'SUCCESS',is_truncated:false,date_index_list:['2026-10-01 00:00:00-2026-10-01 23:59:59'],header_list:['分组','总转化率','launch','play','pay'],data_item_list:[{group_by_key:'__all',summary_list:['__all',.2,100,[50,.5],[20,.2]],detail_list:[['2026-10-01 00:00:00-2026-10-01 23:59:59',.2,100,[50,.5],[20,.2]]]}]}];
test('funnel is ordered UV with day window and distinguishes rates',()=>{const plan=fp(),r=parseFunnel(fr(),plan);assert.equal(plan.dsl.content.option.statistics_mode,0);assert.equal(plan.dsl.content.option.is_parallel,false);assert.equal(Object.hasOwn(plan.dsl.content.option,'window_type'),false);assert.equal(Object.hasOwn(plan.dsl.content.option,'add_window_period'),false);assert.equal(r[2].conversion_from_previous,.4);assert.equal(r[2].conversion_from_first,.2);});
test('funnel rejects wrong date/header/group, inconsistent detail and truncation',()=>{for(const mutate of [r=>r[0].date_index_list=['wrong'],r=>r[0].header_list[2]='other',r=>r[0].data_item_list[0].group_by_key='other',r=>r[0].data_item_list[0].summary_list[3]=[200,2],r=>r[0].is_truncated=true,r=>r[0].result_status='ERROR']){const r=fr();mutate(r);assert.throws(()=>parseFunnel(r,fp()));}});
test('immature window and count indicators rejected; zero rates stay null',()=>{const yesterday=new Date(Date.now()+8*3600000-86400000).toISOString().slice(0,10);assert.throws(()=>funnelPlan({start_date:yesterday,end_date:yesterday,steps:[event,event]},true),e=>e.code==='IMMATURE_FUNNEL');assert.throws(()=>funnelPlan({...dates,steps:[{...event,indicator:'events'},event]},true));const r=fr();r[0].data_item_list[0].summary_list=['__all',null,0,[0,null],[0,null]];r[0].data_item_list[0].detail_list=[[r[0].date_index_list[0],null,0,[0,null],[0,null]]];assert.equal(parseFunnel(r,fp())[1].conversion_from_previous,null);});
test('funnel API outputs validated aggregate fields',async()=>{const api=new DataFinder(env,async()=>Response.json({code:200,data:fr()}));const r=await runFunnel(api,{...dates,steps:[event,{event_name:'play'},{event_name:'pay'}]});assert.equal(r.status,'success');assert.equal(r.data.steps.length,3);assert.equal(r.sampling,'unknown');});
test('minute hour and day windows preserve duration and legacy defaults',()=>{
 const base={...dates,steps:[event,event]};
 assert.deepEqual(funnelPlan(base,true).dsl,funnelPlan({...base,window_days:1},true).dsl);
 for(const [value,unit,seconds] of [[10,'minute',600],[2,'hour',7200],[7,'day',604800]]){
  const p=funnelPlan({...base,window:{value,unit}},true);
  assert.equal(p.window.seconds,seconds);assert.equal(p.dsl.content.option.window_period,value);assert.equal(p.dsl.content.option.window_period_type,unit);
 }
 for(const window of [{value:0,unit:'minute'},{value:1.5,unit:'hour'},{value:169,unit:'hour'},{value:10081,unit:'minute'},{value:1,unit:'today'}])assert.throws(()=>funnelPlan({...base,window},true));
 assert.throws(()=>funnelPlan({...base,window_days:1,window:{value:1,unit:'hour'}},true),e=>e.code==='INVALID_ARGUMENT');
});
test('window maturity uses exact duration and output observation end matches it',async()=>{
 const base={...dates,steps:[event,{event_name:'play'},{event_name:'pay'}],window:{value:10,unit:'minute'}};
 const boundary=Date.parse('2026-10-02T00:10:00+08:00'),original=Date.now;
 try {Date.now=()=>boundary-1;assert.throws(()=>funnelPlan(base,true),e=>e.code==='IMMATURE_FUNNEL');Date.now=()=>boundary;assert.equal(funnelPlan(base,true).window.seconds,600);} finally {Date.now=original;}
 const api=new DataFinder(env,async()=>Response.json({code:200,data:fr()}));
 const result=await runFunnel(api,base);
 assert.equal(result.status,'success');assert.equal(result.validation,'verified_rolling_window');assert.equal(result.window.unit,'minute');assert.equal(result.window.seconds,600);
 assert.equal(result.conversion_observation_end,'2026-10-01T16:09:59.000Z');
});
test('funnel display headers resolve exact metadata aliases, never arbitrary names',async()=>{for(const good of [true,false]){const raw=fr();raw[0].header_list[2]='应用启动';const api=new DataFinder(env,async(u)=>Response.json({code:200,data:String(u).includes('/list/events')?[{name:event.event_name,show_name:good?'应用启动':'其他'}]:raw}));const run=runFunnel(api,{...dates,steps:[event,{event_name:'play'},{event_name:'pay'}]});if(good)assert.equal((await run).data.steps[0].users,100);else await assert.rejects(run,e=>e.code==='UNVERIFIED_CONTRACT');}});
