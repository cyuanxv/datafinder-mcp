import test from 'node:test';
import assert from 'node:assert/strict';
import {freePlan,runAnalysis} from '../lib/datafinder/analysis.mjs';
const property={property_name:'amount',property_type:'event_param'};
const input={events:[{event_name:'pay',measure:{operator:'sum',property}}],start_date:'2020-01-01',end_date:'2020-01-01',granularity:'all'};
test('numeric aggregation emits measure_info without changing event count queries',()=>{
 const q=freePlan(input,true).dsl.content.queries[0][0];assert.equal(q.event_indicator,'measure');assert.equal(q.measure_info.measure_type,'sum');assert.equal(q.measure_info.property_name,'amount');
 assert.equal(freePlan({...input,events:[{event_name:'pay'}]},true).dsl.content.queries[0][0].event_indicator,'event_users');
 assert.throws(()=>freePlan({...input,events:[{event_name:'pay',indicator:'events',measure:input.events[0].measure}]},true));
 assert.throws(()=>freePlan({...input,events:[{event_name:'pay',measure:{operator:'avg',property}}]},true));
});
test('non-numeric property is blocked before query execution',async()=>{
 const calls=[];const api={env:{},request:async(method,path)=>{calls.push(path);return {data:[{name:'amount',type:1,value_type:'string'}]};}};
 await assert.rejects(runAnalysis(api,input),e=>e.code==='PROPERTY_TYPE_MISMATCH');assert.equal(calls.length,1);assert.match(calls[0],/metadata/);
});
