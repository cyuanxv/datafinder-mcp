import test from 'node:test';
import assert from 'node:assert/strict';
import {testDB} from './db-helper.mjs';
import {manageAnomaly} from '../lib/datafinder/anomaly-handling.mjs';
import {readAnomalies,observationStatements} from '../lib/datafinder/anomalies.mjs';
import {inspectionSchedules} from '../lib/datafinder/schedules.mjs';
import {saveRecord,record} from '../lib/datafinder/governance.mjs';
import {cloudJobs} from '../lib/datafinder/jobs.mjs';
import {readOperations} from '../lib/datafinder/operations.mjs';
import {operationsSummary} from '../lib/datafinder/operations-summary.mjs';
const rule={kind:'quality',name:'测试质量',config:{event:{event_name:'launch'},property:{property_name:'os_name',property_type:'common_param'}}};
async function setup(){const DB=testDB(),api={env:{DB}};await saveRecord(api,{kind:'rule',key:'q',expected_revision:0,confirmed:true,rule},'u');return {DB,api};}
async function observe(DB,{owner='u',run=crypto.randomUUID(),state='failed',time=1}={}){await DB.batch(observationStatements(DB,owner,{run_id:run,start_date:'2026-10-10',end_date:'2026-10-10',created_at:time,items:[{key:'q',revision:1,kind:'quality',status:state,...(state==='success'?{data:{status:'measured',total_events:1,missing_events:0,invalid_events:0}}:{error_code:'UPSTREAM_BUSINESS_ERROR'})}]}));return run;}
const update=(run,extra={})=>({action:'update',run_id:run,rule_key:'q',expected_revision:0,status:'investigating',note:'正在排查',job_id:null,confirmed:true,...extra});
const task={kind:'inspection',rules:[{key:'q',revision:1}],start_date:'2026-10-10',end_date:'2026-10-10'};
async function plan(api,key='daily',enabled=false){return inspectionSchedules(api,{action:'save',key,expected_revision:0,confirmed:true,enabled,hour_shanghai:9,rules:task.rules},'u');}
const revise=(api,extra={})=>saveRecord(api,{kind:'rule',key:'q',expected_revision:1,confirmed:true,rule:{...rule,name:'新名称',...extra}},'u');
const preview=(api,keys=['daily'])=>inspectionSchedules(api,{action:'preview_upgrade',keys},'u');
const upgrade=(api,p,owner='u')=>inspectionSchedules(api,{action:'upgrade',upgrades:p.items.filter(x=>x.changed).map(x=>({key:x.key,preview_hash:x.preview_hash})),confirmed:true},owner);
test('handling lifecycle preserves immutable observation, history, reopened status and unknown evidence',async()=>{
 const {DB,api}=await setup(),run=await observe(DB);const before=DB.sql.prepare('SELECT * FROM inspection_observations').all();
 for(const [i,status] of ['acknowledged','investigating','resolved','investigating'].entries()){const r=await manageAnomaly(api,update(run,{expected_revision:i,status}),'u');assert.equal(r.handling.revision,i+1);assert.equal(r.history.length,i+1);assert.equal(r.data_recovery_changed,false);}
 assert.deepEqual(DB.sql.prepare('SELECT * FROM inspection_observations').all(),before);assert.equal((await readAnomalies(api,{},'u')).items[0].handling.status,'investigating');
 const newer=await observe(DB,{state:'unknown',time:2});const list=await readAnomalies(api,{},'u');assert.equal(list.items[0].run_id,newer);assert.equal(list.items[0].handling.status,'unread');assert.equal(list.items[0].transition,'unknown');
});
test('handling conflict, missing confirmation, resolution note and ownership guards reject writes',async()=>{
 const {DB,api}=await setup(),run=await observe(DB);
 await assert.rejects(manageAnomaly(api,update(run,{status:'resolved',note:' '}),'u'),e=>e.code==='INVALID_ARGUMENT');
 await assert.rejects(manageAnomaly(api,update(run,{confirmed:undefined}),'u'),e=>e.code==='INVALID_ARGUMENT');
 await assert.rejects(manageAnomaly(api,update(run),'other'),e=>e.code==='NOT_FOUND');
 await manageAnomaly(api,update(run),'u');await assert.rejects(manageAnomaly(api,update(run),'u'),e=>e.code==='VERSION_CONFLICT');assert.equal(DB.sql.prepare("SELECT COUNT(*) n FROM governance_records WHERE kind='anomaly_handling'").get().n,1);
});
test('linked task must belong to owner and contain the same rule version',async()=>{
 const {DB,api}=await setup(),run=await observe(DB),job=await cloudJobs(api,{action:'submit',request_key:'linked',tasks:[task]},'u');
 const other=await cloudJobs(api,{action:'submit',request_key:'linked',tasks:[task]},'other');await assert.rejects(manageAnomaly(api,update(run,{job_id:other.job_id}),'u'),e=>e.code==='NOT_FOUND');
 const unrelated=await cloudJobs(api,{action:'submit',request_key:'wrong',tasks:[{...task,rules:[{key:'q',revision:2}]}]},'u');await assert.rejects(manageAnomaly(api,update(run,{job_id:unrelated.job_id}),'u'),e=>e.code==='INVALID_ARGUMENT');
 assert.equal((await manageAnomaly(api,update(run,{job_id:job.job_id}),'u')).handling.job_id,job.job_id);
});
test('handling read history bounded and never leaks internal ownership',async()=>{
 const {DB,api}=await setup(),run=await observe(DB);for(let i=0;i<52;i++)await manageAnomaly(api,update(run,{expected_revision:i}),'u');const r=await manageAnomaly(api,{action:'read',run_id:run,rule_key:'q'},'u');assert.equal(r.history.length,50);assert.equal(r.history_has_more,true);assert.ok(!JSON.stringify(r).includes('"owner"'));
});
test('upgrade previews exact old/new rule revisions and preserves schedule and original jobs',async()=>{
 const {api,DB}=await setup();await plan(api);const j=await cloudJobs(api,{action:'submit',request_key:'old',tasks:[task]},'u');const original=DB.sql.prepare('SELECT * FROM cloud_jobs WHERE id=?').get(j.job_id);await revise(api);const p=await preview(api);assert.equal(p.items[0].rules[0].changes[0].path,'name');
 const r=await upgrade(api,p);assert.equal(r.items[0].status,'upgraded');const s=await record(api,'u','schedule','daily');assert.equal(s.value.enabled,false);assert.equal(s.value.hour_shanghai,9);assert.equal(s.value.rules[0].revision,2);assert.deepEqual(DB.sql.prepare('SELECT * FROM cloud_jobs WHERE id=?').get(j.job_id),original);
 assert.equal((await upgrade(api,p)).items[0].status,'already_applied');assert.equal((await record(api,'u','schedule','daily')).revision,2);
});
test('upgrade list flags drift and disabled latest rule is explicit in preview',async()=>{
 const {api}=await setup();await plan(api);await revise(api,{enabled:false});const list=await inspectionSchedules(api,{action:'list'},'u');assert.equal(list.items[0].binding.upgrade_available,true);assert.deepEqual(list.items[0].binding.disabled_rules,['q']);const p=await preview(api);assert.equal(p.items[0].rules[0].enabled,false);await upgrade(api,p);assert.equal((await inspectionSchedules(api,{action:'list'},'u')).items[0].binding.upgrade_available,false);
});
test('upgrade rejects rule/plan drift, cross-owner hash and absent confirmation',async()=>{
 const {api}=await setup();await plan(api);await revise(api);const p=await preview(api);
 assert.equal((await upgrade(api,p,'other')).items[0].error_code,'NOT_FOUND');await assert.rejects(inspectionSchedules(api,{action:'upgrade',upgrades:[{key:'daily',preview_hash:p.items[0].preview_hash}]},'u'),e=>e.code==='INVALID_ARGUMENT');
 await saveRecord(api,{kind:'rule',key:'q',expected_revision:2,confirmed:true,rule},'u');assert.equal((await upgrade(api,p)).items[0].error_code,'VERSION_CONFLICT');assert.equal((await record(api,'u','schedule','daily')).revision,1);
});
test('batch upgrade keeps valid plan when another conflicts and retries successful plan idempotently',async()=>{
 const {api}=await setup();await plan(api,'a');await plan(api,'b');await revise(api);const p=await preview(api,['a','b']);await inspectionSchedules(api,{action:'save',key:'b',expected_revision:1,confirmed:true,enabled:false,hour_shanghai:10,rules:task.rules},'u');
 const r=await upgrade(api,p);assert.equal(r.status,'partial');assert.deepEqual(r.items.map(x=>x.status),['upgraded','failed']);assert.equal((await upgrade(api,p)).items[0].status,'already_applied');assert.equal((await record(api,'u','schedule','b')).value.rules[0].revision,1);
});
test('upgrade SQL guard catches rule mutation between preview and insert',async()=>{
 const {api,DB}=await setup();await plan(api);await revise(api);const p=await preview(api),prepare=DB.prepare;
 DB.prepare=q=>{if(q.includes("INSERT INTO governance_records(owner,kind,record_key,revision,body,created_at) SELECT ?,'schedule'")){DB.sql.exec("INSERT INTO governance_records SELECT owner,kind,record_key,3,body,created_at FROM governance_records WHERE kind='rule' AND revision=2");}return prepare(q);};
 assert.equal((await upgrade(api,p)).items[0].error_code,'VERSION_CONFLICT');assert.equal((await record(api,'u','schedule','daily')).revision,1);
});
test('upgrade bounds and no-op plans do not mutate',async()=>{
 const {api}=await setup();await plan(api);assert.equal((await preview(api)).items[0].changed,false);await assert.rejects(preview(api,['daily','daily']));await assert.rejects(preview(api,Array(11).fill('daily')));assert.equal((await preview(api,['missing'])).items[0].status,'blocked');
});
test('overview separates queued, running, paused and cancelled; detects stalled queue without claiming automatic origin',async()=>{
 const {api,DB}=await setup(),now=Date.now();for(const [i,state] of ['queued','running','paused','cancelled'].entries()){const j=await cloudJobs(api,{action:'submit',request_key:'j'+i,tasks:[task,task]},'u');DB.sql.prepare('UPDATE cloud_jobs SET state=?,updated_at=?,cursor=1 WHERE id=?').run(state,now-100*60000,j.job_id);}
 const r=await operationsSummary(api,'u',[],now);assert.equal(r.waiting_tasks,2);assert.equal(r.paused_tasks,1);assert.equal(r.oldest_waiting.length,1);assert.ok(r.alerts.some(x=>x.code==='QUEUE_STALLED'));assert.equal(r.automatic_trigger_verified,false);const other=await operationsSummary(api,'other',[],now);assert.equal(other.waiting_tasks,0);assert.equal(other.oldest_waiting.length,0);
});
test('failure streak resets at successful call and is bounded; recent manual tick does not prove automatic',async()=>{
 const {api,DB}=await setup(),now=Date.now();for(const [i,status] of ['failed','completed','task_failed','failed'].entries())DB.sql.prepare('INSERT INTO dispatch_runs(id,owner,started_at,status,finished_at) VALUES(?,?,?,?,?)').run('r'+i,'u',now-10000+i,status,now-9000+i);
 const r=await operationsSummary(api,'u',[],now);assert.equal(r.consecutive_dispatch_failures,2);assert.equal(r.last_successful_tick_at,now-8999);assert.ok(!r.alerts.some(x=>x.code==='DISPATCH_STALE'));assert.equal(r.automatic_trigger_verified,false);
 for(let i=0;i<101;i++)DB.sql.prepare('INSERT INTO dispatch_runs(id,owner,started_at,status) VALUES(?,?,?,?)').run('f'+i,'u',now+i,'failed');const b=await operationsSummary(api,'u',[],now+200);assert.equal(b.consecutive_dispatch_failures,100);assert.equal(b.consecutive_failure_lower_bound,true);
});
test('full overview exposes version drift and all-time totals without raw ownership',async()=>{
 const {api}=await setup();await plan(api,'daily',true);await revise(api);const r=await readOperations(api,{},'u');assert.ok(r.summary.alerts.some(x=>x.code==='SCHEDULE_RULE_DRIFT'));assert.equal(r.summary.plans_needing_upgrade.length,1);assert.ok(!JSON.stringify(r).includes('"owner"'));
});
