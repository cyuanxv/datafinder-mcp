import test from 'node:test';import assert from 'node:assert/strict';
import {frequencyIntervals,parseFrequency} from '../lib/datafinder/user-frequency.mjs';
import {freePlan} from '../lib/datafinder/analysis.mjs';
import {runDistribution} from '../lib/datafinder/distribution.mjs';
import {DataFinder} from '../lib/datafinder/core.mjs';
const base={kind:'user_frequency',start_date:'2026-10-01',end_date:'2026-10-02',event:{event_name:'sent'},boundaries:[20]};
const plan=freePlan({events:[{event_name:'sent'}],start_date:base.start_date,end_date:base.end_date,granularity:'day'},true),intervals=frequencyIntervals([20]);
const result=()=>[{query_id:'a00:p00:c00:q00',result_status:'SUCCESS',is_truncated:false,date_index_list:['20261001','20261002'],distribution_list:intervals,data_item_list:[{origin_event_indicator_params:{distribution:intervals[1]},data:[13,19]},{origin_event_indicator_params:{distribution:intervals[0]},data:[27,35]}]}];
const total=()=>[{...result()[0],data_item_list:[{group_by_key:'__all',data:[40,54]}]}];
test('observed native daily frequency counts conserve independently queried UV',()=>{
 const rows=parseFrequency(result(),plan,intervals,total());assert.equal(rows[0].bins[0].users,27);assert.equal(rows[1].event_users,54);assert.equal(rows[1].bins[1].share,19/54);
});
test('rejects missing bins, duplicate identities, bad counts and nonconservation',()=>{
 for(const mutate of [x=>x[0].data_item_list.pop(),x=>x[0].data_item_list.push(x[0].data_item_list[0]),x=>x[0].data_item_list[0].data[0]=null,x=>x[0].data_item_list[0].data[0]++,x=>x[0].is_truncated=true,x=>x[0].distribution_list=['x','y']]){const r=result();mutate(r);assert.throws(()=>parseFrequency(r,plan,intervals,total()));}
});
test('daily UV cannot masquerade as whole-interval frequency distribution',()=>{
 const p=structuredClone(plan);p.dsl.periods[0].granularity='all';assert.throws(()=>parseFrequency(result(),p,intervals,total()));
});
test('frequency boundaries require positive distinct integers',()=>{for(const bounds of [[],[0],[2,1],[1,1],[1.5]])assert.throws(()=>frequencyIntervals(bounds));});
test('executes native distribution followed by independent UV using same filters and scope',async()=>{
 const sent=[];const api=new DataFinder({DATAFINDER_AK:'test',DATAFINDER_SK:'test',DATAFINDER_ALLOW_PROJECT_WIDE:'true'},async(u,o)=>{const d=JSON.parse(o.body);sent.push(d);return Response.json({code:200,data:d.content.query_type==='distribution'?result():total()});});
 const r=await runDistribution(api,{...base,filters:[{property:{property_name:'os_name',property_type:'common_param'},operator:'=',values:['Android']}]});
 assert.equal(r.status,'success');assert.deepEqual(sent[0].content.profile_filters,sent[1].content.profile_filters);assert.deepEqual(sent[0].resources,sent[1].resources);assert.equal(sent[1].content.queries[0][0].event_indicator,'event_users');assert.equal(r.data.zero_frequency_population_included,false);
});
