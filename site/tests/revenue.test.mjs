import test from 'node:test';
import assert from 'node:assert/strict';
import {DataFinder} from '../lib/datafinder/core.mjs';
import {runInsight} from '../lib/datafinder/insights.mjs';
import {revenueFactors} from '../lib/datafinder/revenue.mjs';
const input={kind:'revenue_quality',period:{start_date:'2026-10-01',end_date:'2026-10-02'},events:[{event_name:'paid'}],revenue_property:{property_type:'event_param',property_name:'amount'}};
function mock({amount=120,missing=0,negative=0,users=10,truncated=false}={}){
 return new DataFinder({DATAFINDER_AK:'test',DATAFINDER_SK:'test',DATAFINDER_ALLOW_PROJECT_WIDE:'true'},async(url,o)=>{
  const d=JSON.parse(o.body);
  if(String(url).includes('/metadata/'))return Response.json({code:200,data:[{name:'amount',value_type:'float',type:1}]});
  const sum=d.content.queries[0][0].event_indicator==='measure';
  if(sum)assert.deepEqual(d.content.queries[0][0].measure_info,{measure_type:'sum',property_type:'event_param',property_name:'amount',property_compose_type:'origin'});
  return Response.json({code:200,data:d.content.queries.map((q,i)=>({query_id:`a00:p00:c00:q${String(i).padStart(2,'0')}`,result_status:'SUCCESS',is_truncated:truncated,date_index_list:['2026-10-01 00:00:00-2026-10-02 23:59:59'],data_item_list:[{data:[sum?amount:[20,users,missing,negative][i]]}]})).reverse()});
 });
}
test('revenue parses independent interval users and numeric sum with unknown business contract',async()=>{
 const r=await runInsight(mock(),input);
 assert.equal(r.data.current.amount,120);assert.equal(r.data.current.amount_per_payer,12);
 assert.equal(r.data.current.events,20);assert.equal(r.data.business_contract.order_deduplication,'unverified');
});
test('missing, negative, null and truncated amount evidence is rejected',async()=>{
 for(const option of [{missing:1},{negative:1},{amount:null},{truncated:true},{users:0}])await assert.rejects(runInsight(mock(option),input));
});
test('symmetric decomposition conserves change including opposing factors',()=>{
 const r=revenueFactors({users:10,amount:100},{users:20,amount:160});
 assert.equal(r.payer_contribution,90);assert.equal(r.amount_per_payer_contribution,-30);assert.equal(r.residual,0);
 assert.equal(revenueFactors({users:0,amount:0},{users:2,amount:12}).payer_contribution,null);
 assert.throws(()=>revenueFactors({users:0,amount:1},{users:2,amount:12}));
});
test('revenue rejects multiple pay events and user properties',async()=>{
 await assert.rejects(runInsight(mock(),{...input,events:[{event_name:'paid'},{event_name:'other'}]}));
 await assert.rejects(runInsight(mock(),{...input,revenue_property:{...input.revenue_property,property_type:'user_profile'}}));
});
