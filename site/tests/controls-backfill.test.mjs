import test from 'node:test';
import assert from 'node:assert/strict';
import {testDB} from './db-helper.mjs';
import {cloudJobs} from '../lib/datafinder/jobs.mjs';
import {inspectionSchedules} from '../lib/datafinder/schedules.mjs';
import {saveRecord} from '../lib/datafinder/governance.mjs';
import {mergedJob} from '../lib/datafinder/merged-jobs.mjs';
import {aggregateExport} from '../lib/datafinder/export.mjs';
import {QueryError} from '../lib/datafinder/core.mjs';
const task={kind:'inspection',rules:[{key:'a',revision:1},{key:'b',revision:1}],start_date:'2026-10-10',end_date:'2026-10-10'};
async function setup(){const DB=testDB(),api={env:{DB}};for(const key of ['a','b'])await saveRecord(api,{kind:'rule',key,expected_revision:0,confirmed:true,rule:{kind:'quality',name:key,config:{event:{event_name:'app_launch_client'},property:{property_name:'os_name',property_type:'common_param'}}}},'u');return {DB,api};}
const submit=(api,key='j',tasks=[task,task])=>cloudJobs(api,{action:'submit',request_key:key,tasks},'u');
const control=(api,id,action)=>cloudJobs(api,{action,job_id:id,confirmed:true},'u');
const ok={inspection:async()=>({status:'success',items:[{key:'a',status:'success',value:0},{key:'b',status:'success',value:null}]})};
const fail={inspection:async()=>{throw new QueryError('UPSTREAM_BUSINESS_ERROR','no');}};
async function schedule(api,DB,{revision=0,enabled=true,hour=9,time='2026-10-09T00:00:00+08:00'}={}){const r=await inspectionSchedules(api,{action:'save',key:'daily',expected_revision:revision,confirmed:true,enabled,hour_shanghai:hour,rules:task.rules},'u');DB.sql.prepare("UPDATE governance_records SET created_at=? WHERE kind='schedule' AND revision=?").run(Date.parse(time),r.revision);return r;}
const preview=api=>inspectionSchedules(api,{action:'preview_backfill',key:'daily',start_date:'2026-10-07',end_date:'2026-10-12'},'u');
test('paused queue is not claimed; resume continues and cancelled queue never executes',async()=>{
 const {api}=await setup(),j=await submit(api);assert.equal((await control(api,j.job_id,'pause')).state,'paused');assert.equal((await cloudJobs(api,{action:'process_next'},'u',ok)).status,'idle');
 assert.equal((await control(api,j.job_id,'resume')).state,'queued');await cloudJobs(api,{action:'process_next'},'u',ok);const c=await control(api,j.job_id,'cancel');assert.equal(c.state,'cancelled');assert.equal(c.results.length,1);assert.equal((await cloudJobs(api,{action:'process_next'},'u',ok)).status,'idle');await assert.rejects(control(api,j.job_id,'resume'),e=>e.code==='INVALID_ARGUMENT');
});
test('pause while executing preserves result and stops next task without losing lease',async()=>{
 const {api}=await setup(),j=await submit(api);const done=await cloudJobs(api,{action:'process_next'},'u',{inspection:async()=>{const r=await control(api,j.job_id,'pause');assert.equal(r.state,'running');assert.equal(r.control_request,'pause');await assert.rejects(control(api,j.job_id,'cancel'),e=>e.code==='INVALID_ARGUMENT');return ok.inspection();}});assert.equal(done.state,'paused');assert.equal(done.completed_tasks,1);assert.equal(done.results[0].status,'completed');assert.equal(done.control_request,null);
 await control(api,j.job_id,'resume');assert.equal((await cloudJobs(api,{action:'process_next'},'u',ok)).state,'completed');
});
test('pause on final task still completes; terminal controls and foreign owners reject',async()=>{
 const {api}=await setup(),j=await submit(api,'one',[task]);const done=await cloudJobs(api,{action:'process_next'},'u',{inspection:async()=>{await control(api,j.job_id,'pause');return ok.inspection();}});assert.equal(done.state,'completed');await assert.rejects(control(api,j.job_id,'pause'));await assert.rejects(cloudJobs(api,{action:'pause',job_id:j.job_id,confirmed:true},'other'),e=>e.code==='NOT_FOUND');await assert.rejects(cloudJobs(api,{action:'pause',job_id:j.job_id},'u'),e=>e.code==='INVALID_ARGUMENT');
});
test('expired paused worker cannot publish stale output or escape attempt ceiling',async()=>{
 const {api,DB}=await setup(),j=await submit(api);DB.sql.prepare("UPDATE cloud_jobs SET state='running',control_request='pause',lease_until=1,attempts=3,lease_token='stale' WHERE id=?").run(j.job_id);
 assert.equal((await cloudJobs(api,{action:'process_next'},'u',ok)).status,'idle');const read=await cloudJobs(api,{action:'read',job_id:j.job_id},'u');assert.equal(read.state,'failed');assert.equal(read.failure_reason,'LEASE_EXHAUSTED');
});
test('miss detection follows enabled revision lifetime and excludes pre-creation dates',async()=>{
 const {api,DB}=await setup();await schedule(api,DB);await schedule(api,DB,{revision:1,enabled:false,time:'2026-10-11T08:00:00+08:00'});const p=await preview(api);
 assert.equal(p.items.find(x=>x.business_date==='2026-10-07').status,'not_expected');assert.equal(p.items.find(x=>x.business_date==='2026-10-08').status,'missing');assert.equal(p.items.find(x=>x.business_date==='2026-10-10').status,'not_expected');assert.equal(p.items.find(x=>x.business_date==='2026-10-12').status,'not_expected');
});
test('backfill selected dates uses historical rules and natural-day scope, duplicate confirms never reexecute',async()=>{
 const {api,DB}=await setup();await schedule(api,DB);const p=await preview(api),input={action:'backfill',key:'daily',start_date:p.start_date,end_date:p.end_date,dates:['2026-10-09','2026-10-10'],preview_hash:p.preview_hash,confirmed:true};
 const r=await inspectionSchedules(api,input,'u');assert.equal(r.submitted.length,2);const r2=await inspectionSchedules(api,input,'u');assert.deepEqual(r2.submitted.map(x=>x.job_id),r.submitted.map(x=>x.job_id));assert.ok(r2.submitted.every(x=>x.outcome==='existing_not_reexecuted'));
 const j=await cloudJobs(api,{action:'read',job_id:r.submitted[0].job_id},'u');assert.equal(j.tasks[0].start_date,'2026-10-09');assert.equal(j.tasks[0].end_date,'2026-10-09');assert.equal(j.request_key,'schedule:daily:1:2026-10-10');
});
test('backfill rejects changed plan, stale rule, outside range, wrong owner and missing confirmation',async()=>{
 const {api,DB}=await setup();await schedule(api,DB);const p=await preview(api),input={action:'backfill',key:'daily',start_date:p.start_date,end_date:p.end_date,dates:['2026-10-09'],preview_hash:p.preview_hash,confirmed:true};
 await assert.rejects(inspectionSchedules(api,{...input,confirmed:undefined},'u'));await assert.rejects(inspectionSchedules(api,{...input,dates:['2026-10-01']},'u'));await assert.rejects(inspectionSchedules(api,input,'other'),e=>e.code==='NOT_FOUND');
 DB.sql.exec("INSERT INTO governance_records SELECT owner,kind,record_key,2,body,created_at FROM governance_records WHERE kind='rule' AND record_key='a'");await assert.rejects(inspectionSchedules(api,input,'u'),e=>e.code==='VERSION_CONFLICT');assert.equal(DB.sql.prepare('SELECT COUNT(*) n FROM cloud_jobs').get().n,0);
 await schedule(api,DB,{revision:1,enabled:false,time:'2026-10-13T00:00:00+08:00'});await assert.rejects(inspectionSchedules(api,input,'u'),e=>e.code==='VERSION_CONFLICT');
});
test('backfill validates calendar dates and bounded range',async()=>{
 const {api}=await setup();for(const [start_date,end_date] of [['2026-02-30','2026-03-01'],['2026-01-01','2026-02-10'],['2099-01-01','2099-01-02'],['2026-10-10','2026-10-09']])await assert.rejects(inspectionSchedules(api,{action:'preview_backfill',key:'daily',start_date,end_date},'u'),e=>e.code==='INVALID_ARGUMENT');
});
test('existing failed and cancelled schedule jobs remain visible and are never backfilled again',async()=>{
 const {api,DB}=await setup();await schedule(api,DB);const p=await preview(api),input={action:'backfill',key:'daily',start_date:p.start_date,end_date:p.end_date,dates:['2026-10-09'],preview_hash:p.preview_hash,confirmed:true};const r=await inspectionSchedules(api,input,'u');await control(api,r.submitted[0].job_id,'cancel');const again=await inspectionSchedules(api,input,'u');assert.equal(again.submitted[0].status,'cancelled');assert.equal(DB.sql.prepare('SELECT COUNT(*) n FROM cloud_jobs').get().n,1);
});
test('merged inspection retains successful original rule, uses recovery only for failed rule and exports provenance',async()=>{
 const {api}=await setup(),j=await submit(api,'partial',[task]);await cloudJobs(api,{action:'process_next'},'u',{inspection:async()=>({status:'partial',items:[{key:'a',status:'success',value:0},{key:'b',status:'failed'}]})});
 const before=await cloudJobs(api,{action:'read',job_id:j.job_id},'u');const r=await cloudJobs(api,{action:'retry',job_id:j.job_id,request_key:'retry',confirmed:true},'u');await cloudJobs(api,{action:'process_next'},'u',{inspection:async()=>({status:'success',items:[{key:'b',status:'success',value:null}]})});
 const merged=await mergedJob(api,'u',r.job_id);assert.equal(merged.state,'completed');const items=merged.results[0].output.items;assert.equal(items[0].value,0);assert.equal(items[0].source.job_id,j.job_id);assert.equal(items[1].value,null);assert.equal(items[1].source.job_id,r.job_id);assert.deepEqual(await cloudJobs(api,{action:'read',job_id:j.job_id},'u'),before);
 const exp=await aggregateExport(api,{kind:'merged_job',id:r.job_id,format:'csv'},'u'),text=await new Response(exp.body).text();assert.ok(text.includes(j.job_id));assert.ok(text.includes(r.job_id));assert.ok(text.includes('null'));await assert.rejects(mergedJob(api,'other',r.job_id),e=>e.code==='NOT_FOUND');
});
test('nested recovery follows source indices, retains missing rules and exposes unfinished work',async()=>{
 const {api}=await setup(),j=await submit(api);await cloudJobs(api,{action:'process_next'},'u',ok);await cloudJobs(api,{action:'process_next'},'u',fail);
 const r=await cloudJobs(api,{action:'retry',job_id:j.job_id,request_key:'r1',confirmed:true},'u');await cloudJobs(api,{action:'process_next'},'u',fail);const r2=await cloudJobs(api,{action:'retry',job_id:r.job_id,request_key:'r2',confirmed:true},'u');
 assert.equal((await mergedJob(api,'u',r2.job_id)).state,'incomplete');await cloudJobs(api,{action:'process_next'},'u',ok);const m=await mergedJob(api,'u',r2.job_id);assert.equal(m.state,'completed');assert.equal(m.results[0].sources.length,1);assert.equal(m.results[1].sources.length,3);assert.equal(m.results[1].output.items[0].source.job_id,r2.job_id);assert.equal((await mergedJob(api,'u',r.job_id)).state,'incomplete');
});
test('pause survives lease expiry and a stale worker cannot overwrite the resumed queue',async()=>{
 const {api,DB}=await setup(),j=await submit(api);let unblock,started;
 const gate=new Promise(r=>{started=r;}),run=cloudJobs(api,{action:'process_next'},'u',{inspection:async()=>{started();await new Promise(r=>{unblock=r;});return ok.inspection();}});
 await gate;await control(api,j.job_id,'pause');DB.sql.prepare('UPDATE cloud_jobs SET lease_until=1 WHERE id=?').run(j.job_id);
 assert.equal((await cloudJobs(api,{action:'process_next'},'u',ok)).status,'idle');await control(api,j.job_id,'resume');unblock();await assert.rejects(run,e=>e.code==='LEASE_LOST');const r=await cloudJobs(api,{action:'read',job_id:j.job_id},'u');assert.equal(r.state,'queued');assert.equal(r.completed_tasks,0);
});
test('paused and cancelled states work in history filters',async()=>{
 const {api}=await setup(),j=await submit(api);await control(api,j.job_id,'pause');assert.equal((await cloudJobs(api,{action:'list',status:'paused'},'u')).items.length,1);await control(api,j.job_id,'cancel');assert.equal((await cloudJobs(api,{action:'list',status:'cancelled'},'u')).items.length,1);
});
test('disabled stale plans can be stopped but cannot be reenabled until rules are rebound',async()=>{
 const {api,DB}=await setup();await schedule(api,DB);DB.sql.exec("INSERT INTO governance_records SELECT owner,kind,record_key,2,body,created_at FROM governance_records WHERE kind='rule' AND record_key='a'");await schedule(api,DB,{revision:1,enabled:false});await assert.rejects(schedule(api,DB,{revision:2,enabled:true}),e=>e.code==='VERSION_CONFLICT');
});
test('missing rule payload never yields successful merged inspection',async()=>{
 const {api}=await setup(),j=await submit(api,'missing',[task]);await cloudJobs(api,{action:'process_next'},'u',{inspection:async()=>({status:'success',items:[{key:'a',status:'success'}]})});const m=await mergedJob(api,'u',j.job_id);assert.equal(m.state,'incomplete');assert.equal(m.results[0].output.items[1].status,'pending');
});
test('specified-date backfill explicitly uses current saved revision, even before plan creation; separate from missed detection',async()=>{
 const {api,DB}=await setup();await schedule(api,DB,{enabled:false,time:'2026-10-12T00:00:00+08:00'});
 const input={action:'preview_backfill',mode:'specified',key:'daily',start_date:'2026-10-10',end_date:'2026-10-10'},p=await inspectionSchedules(api,input,'u');assert.equal(p.items[0].status,'available');
 assert.equal((await inspectionSchedules(api,{...input,mode:'missed'},'u')).items[0].status,'not_expected');
 await assert.rejects(inspectionSchedules(api,{...input,action:'backfill',mode:'missed',dates:['2026-10-10'],preview_hash:p.preview_hash,confirmed:true},'u'),e=>e.code==='VERSION_CONFLICT');
 const a={...input,action:'backfill',dates:['2026-10-10'],preview_hash:p.preview_hash,confirmed:true},r=await inspectionSchedules(api,a,'u'),again=await inspectionSchedules(api,a,'u');assert.equal(r.submitted[0].request_key,'backfill:daily:1:2026-10-10');assert.equal(r.submitted[0].job_id,again.submitted[0].job_id);
});
