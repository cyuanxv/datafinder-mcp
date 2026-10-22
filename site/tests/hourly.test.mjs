import test from 'node:test';import assert from 'node:assert/strict';
import {DataFinder} from '../lib/datafinder/core.mjs';
import {runInsight} from '../lib/datafinder/insights.mjs';
import {hourKeys,parseHourly} from '../lib/datafinder/hourly.mjs';
import {freePlan} from '../lib/datafinder/analysis.mjs';
const period={start_date:'2026-10-01',end_date:'2026-10-02'},events=[{event_name:'open'}];
const plan=freePlan({...period,events},true),dates=hourKeys(plan.range);
function raw(){return [{query_id:'a00:p00:c00:q00',result_status:'SUCCESS',is_truncated:false,date_index_list:dates,data_item_list:[{data:dates.map((_,i)=>i%24)}]}];}
test('hourly sequence preserves midnight and computes 48 observed hours',()=>{const r=parseHourly(raw(),plan);assert.equal(r[0].points.length,48);assert.deepEqual(r[0].points[24],{date:'20261002',hour:0,events:0});});
test('hour parser rejects missing, shifted, repeated, daily and truncated observations',()=>{
 for(const mutate of [r=>r[0].date_index_list.pop(),r=>r[0].date_index_list[0]='2026100101',r=>r[0].date_index_list=['20261001','20261002'],r=>r[0].is_truncated=true,r=>r[0].data_item_list[0].data[0]=null,r=>r.push(r[0])]){const r=structuredClone(raw());mutate(r);assert.throws(()=>parseHourly(r,plan));}
});
function mock(total=552){return new DataFinder({DATAFINDER_AK:'test',DATAFINDER_SK:'test',DATAFINDER_ALLOW_PROJECT_WIDE:'true'},async(u,o)=>{const d=JSON.parse(o.body);if(d.periods[0].granularity!=='day')assert.equal(d.content.option.refresh_cache,true);return Response.json({code:200,data:d.periods[0].granularity==='hour'?raw():[{...raw()[0],date_index_list:['2026-10-01 00:00:00-2026-10-02 23:59:59'],data_item_list:[{data:[total]}]}]});});}
test('hourly results conserve independent total and average by observed day count',async()=>{const r=await runInsight(mock(),{kind:'hourly_pattern',period,events});assert.equal(r.data.rows[0].total_events,552);assert.deepEqual(r.data.rows[0].hour_of_day[23],{hour:23,observed_days:2,total_events:46,mean_events:23});await assert.rejects(runInsight(mock(553),{kind:'hourly_pattern',period,events}),e=>e.code==='INCONSISTENT_COUNTS');});
test('hourly rejects oversized periods before any upstream call',async()=>{let called=0;const api=new DataFinder({},()=>{called++;});await assert.rejects(runInsight(api,{kind:'hourly_pattern',period:{start_date:'2026-10-01',end_date:'2026-10-08'},events}));assert.equal(called,0);});
test('daily time patterns reject interval subtotal instead of computing an invalid weekday',async()=>{await assert.rejects(runInsight(mock(),{kind:'time_pattern',period,events}),e=>e.code==='INCOMPLETE_RESULT');});
