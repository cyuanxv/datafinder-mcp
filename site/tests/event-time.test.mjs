import test from 'node:test';
import assert from 'node:assert/strict';
import {eventRange,eventDateLabels,matchEventDates} from '../lib/datafinder/event-time.mjs';
import {freePlan,validateAnalysis,runAnalysis} from '../lib/datafinder/analysis.mjs';
const now=Date.parse('2026-10-17T09:30:25+08:00')/1000;
const a={kind:'event',start_date:'2026-10-17',end_date:'2026-10-17',granularity:'hour',include_today:true};
test('today resolves once to now with explicit partial metadata and correct Shanghai boundary',()=>{
 const r=eventRange(a,now);assert.equal(r.end_time,now);assert.equal(r.start_at,'2026-10-17 00:00:00');assert.equal(r.partial_period,true);assert.equal(eventDateLabels(r).length,10);
 assert.throws(()=>eventRange({...a,include_today:false},now));assert.throws(()=>eventRange({...a,end_clock:'09:31'},now));
});
test('window validation rejects invalid dates, future, reversed, invalid clocks and retention',()=>{
 for(const change of [{start_date:'2026-02-30'},{end_date:'2026-10-18'},{start_clock:'10:00'},{start_clock:'24:00'},{kind:'retention'},{start_clock:'08:00',granularity:'day'}])assert.throws(()=>eventRange({...a,...change},now));
});
test('hour dates align bucket boundaries without fabricating missing hours',()=>{
 const r=eventRange({...a,start_date:'2026-10-16',end_date:'2026-10-16',start_clock:'09:15',end_clock:'10:45'},now);
 assert.deepEqual(eventDateLabels(r),['2026-10-16 09:00:00','2026-10-16 10:00:00']);
 assert.equal(matchEventDates(['2026101609','2026101610'],r),true);
 assert.equal(matchEventDates(['2026101609'],r),false);
 assert.equal(matchEventDates(['2026101610','2026101609'],r),false);
});
test('all interval preserves exact requested timestamps',()=>{
 const r=eventRange({...a,start_date:'2026-10-16',end_date:'2026-10-16',start_clock:'09:15',end_clock:'10:45',granularity:'all'},now);
 assert.deepEqual(eventDateLabels(r),['2026-10-16 09:15:00-2026-10-16 10:45:00']);
});
test('shared callers cannot silently adopt hourly or partial-day behavior',()=>{
 const args={events:[{event_name:'app_launch'}],start_date:'2026-10-01',end_date:'2026-10-02',granularity:'hour'};
 assert.throws(()=>freePlan(args,true));const p=freePlan(args,true,true);assert.equal(p.dsl.periods[0].granularity,'hour');
 assert.equal(p.dsl.content.option.refresh_cache,true);
 const labels=eventDateLabels(p.range),result={query_id:'a00:p00:c00:q00',result_status:'SUCCESS',date_index_list:labels,series:[{data:labels.map(()=>1)}]};
 assert.equal(validateAnalysis([result],p.dsl,p.range).status,'verified');
 result.date_index_list=labels.slice(1);assert.equal(validateAnalysis([result],p.dsl,p.range).status,'incomplete');
});
test('saved report rejects intraday parameters before reading metadata',async()=>{
 await assert.rejects(runAnalysis({env:{}},{report_id:'8900000000000000003',start_date:'2026-10-01',end_date:'2026-10-02',granularity:'hour'}),e=>e.code==='UNSUPPORTED_QUERY');
});
