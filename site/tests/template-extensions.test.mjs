import test from 'node:test';
import assert from 'node:assert/strict';
import {testDB} from './db-helper.mjs';
import {queryTemplate} from '../lib/datafinder/templates.mjs';
import {parseDraft,trialDraft} from '../lib/datafinder/editor.mjs';
import {validateDistribution} from '../lib/datafinder/distribution.mjs';
const event={event_name:'start'},property={property_name:'amount',property_type:'event_param'};
const save=(api,key,template)=>queryTemplate(api,{action:'save',key,name:key,template,expected_revision:0,confirmed:true},'owner');
test('distribution and funnel templates retain exact semantics, version checks and owner isolation',async()=>{
 const api={env:{DB:testDB()}};
 for(const [key,template] of [['dist',{kind:'distribution',config:{kind:'numeric_event_distribution',event,property,boundaries:[-1,0,2.5],interval_closure:'right_closed'}}],['funnel',{kind:'funnel',config:{steps:[event,{event_name:'pay'}],window:{value:10,unit:'minute'}}}]]){
  const saved=await save(api,key,template);assert.equal(saved.revision,1);
  let received;const result=await queryTemplate(api,{action:'run',key,expected_revision:1,start_date:'2020-01-01',end_date:'2020-01-01'},'owner',{[template.kind]:async(_,a)=>(received=a,{status:'incomplete',validation:'unverified'})});
  assert.equal(result.output.status,'incomplete');assert.deepEqual(received.window,template.config.window);assert.equal(received.interval_closure,template.config.interval_closure);assert.equal(received.start_date,'2020-01-01');
  await assert.rejects(save(api,key,template),e=>e.code==='VERSION_CONFLICT');
  await assert.rejects(queryTemplate(api,{action:'read',key},'other'));
 }
});
test('invalid distribution and funnel combinations are rejected before save or metadata I/O',async()=>{
 const api={env:{DB:testDB()},request:()=>assert.fail('must reject before I/O')};
 const bad=[{kind:'distribution',config:{kind:'numeric_event_distribution',event,property,boundaries:[1,1]}},{kind:'distribution',config:{kind:'composition',event,property}},{kind:'distribution',config:{kind:'user_frequency',event,boundaries:[1.2]}},{kind:'distribution',config:{kind:'user_cumulative_measure',event,property,boundaries:[-1]}},{kind:'distribution',config:{kind:'numeric_event_distribution',event,property,boundaries:[1],granularity:'day'}},{kind:'funnel',config:{steps:[event,{event_name:'pay'}],window_days:1,window:{value:1,unit:'day'}}},{kind:'funnel',config:{steps:[event,{event_name:'pay'}],window:{value:169,unit:'hour'}}}];
 for(const template of bad){assert.throws(()=>parseDraft('template',template));await assert.rejects(save(api,'bad',template));}
 assert.equal((await queryTemplate(api,{action:'list'},'owner')).items.length,0);
});
test('distribution defaults remain compatible and numeric templates omit unsupported granularity',()=>{
 const a=validateDistribution({kind:'user_frequency',event,boundaries:[1,2],start_date:'2020-01-01',end_date:'2020-01-01'});assert.equal(a.granularity,'day');
 const d=parseDraft('template',{kind:'distribution',config:{kind:'numeric_event_distribution',event,property,boundaries:[0]}});assert.equal(d.config.granularity,undefined);assert.equal(d.config.interval_closure,undefined);
});
test('new template trial dispatch preserves incomplete quality and never persists',async()=>{
 const api={env:{DB:testDB()},request:async()=>({data:[{name:'start'},{name:'pay'}]})};
 const out=await trialDraft(api,'template',{kind:'funnel',config:{steps:[event,{event_name:'pay'}],window:{value:1,unit:'hour'}}},'2020-01-01','2020-01-01',{funnel:async()=>({status:'incomplete',validation:'window_contract_unverified'})});
 assert.equal(out.persisted,false);assert.equal(out.output.status,'incomplete');assert.equal((await queryTemplate(api,{action:'list'},'owner')).items.length,0);
});
