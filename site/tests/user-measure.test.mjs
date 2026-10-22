import test from 'node:test';import assert from 'node:assert/strict';
import {DataFinder} from '../lib/datafinder/core.mjs';
import {runDistribution} from '../lib/datafinder/distribution.mjs';
import {measureIntervals} from '../lib/datafinder/user-measure.mjs';
const input={kind:'user_cumulative_measure',start_date:'2026-10-01',end_date:'2026-10-02',granularity:'all',event:{event_name:'paid'},property:{property_name:'amount',property_type:'event_param'},boundaries:[0,9.99]};
function mock({missing=0,negative=0,users=4}={}){
 const sent=[];const api=new DataFinder({DATAFINDER_AK:'test',DATAFINDER_SK:'test',DATAFINDER_ALLOW_PROJECT_WIDE:'true'},async(url,o)=>{
  if(url.includes('/metadata/'))return Response.json({code:200,data:[{name:'amount',type:1,value_type:'float'}]});
  const d=JSON.parse(o.body);sent.push(d);const dist=d.content.query_type==='distribution',quality=d.content.queries.length===2;
  const intervals=measureIntervals(input.boundaries);
  return Response.json({code:200,data:d.content.queries.map((q,i)=>({query_id:`a00:p00:c00:q${String(i).padStart(2,'0')}`,result_status:'SUCCESS',is_truncated:false,date_index_list:['2026-10-01 00:00:00-2026-10-02 23:59:59'],...(dist?{distribution_list:intervals}:{}),data_item_list:dist?intervals.map((v,j)=>({origin_event_indicator_params:{distribution:v},data:[[1,2,1][j]]})):[{group_by_key:'__all',data:[quality?[missing,negative][i]:users]}]}))});
 });return {api,sent};
}
test('cumulative measure preserves property SUM, independent UV, decimal boundaries and units',async()=>{
 const {api,sent}=mock(),r=await runDistribution(api,input);assert.equal(r.status,'success');assert.equal(r.data.rows[0].event_users,4);assert.equal(r.data.unit,'source_property_unit');
 assert.equal(sent[1].content.queries[0][0].event_indicator,'measure');assert.equal(sent[1].content.queries[0][0].measure_info.measure_type,'sum');assert.equal(sent[1].content.queries[0][0].measure_info.property_name,'amount');assert.equal(sent[2].content.queries[0][0].event_indicator,'event_users');assert.equal(sent[2].content.queries[0][0].measure_info,undefined);assert.deepEqual(sent[1].resources,sent[2].resources);
});
test('missing and negative values stop before distribution; nonconservation fails closed',async()=>{
 for(const cfg of [{missing:1},{negative:1}]){const {api,sent}=mock(cfg);await assert.rejects(runDistribution(api,input),e=>e.code==='UNVERIFIED_MEASURE');assert.equal(sent.length,1);}
 await assert.rejects(runDistribution(mock({users:5}).api,input),e=>e.code==='INCONSISTENT_COUNTS');
});
test('cumulative measure rejects wrong property scope and malformed bounds',async()=>{
 for(const bounds of [[],[-1],[1,1],[2,1],[Infinity]])assert.throws(()=>measureIntervals(bounds));
 for(const property of [undefined,{...input.property,property_type:'user_profile'},{...input.property,property_compose_type:'virtual'}])await assert.rejects(runDistribution(mock().api,{...input,property}));
});
