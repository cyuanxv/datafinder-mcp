import test from 'node:test';
import assert from 'node:assert/strict';
import {testDB} from './db-helper.mjs';
import {inspectionSchedules,dispatchFailed} from '../lib/datafinder/schedules.mjs';
import {cloudJobs} from '../lib/datafinder/jobs.mjs';
const rule={key:'demo-rule',revision:1};
function plan(db,key,enabled=true,hour=0){db.sql.prepare('INSERT INTO governance_records(owner,kind,record_key,revision,body,created_at) VALUES(?,?,?,?,?,?)').run('demo-owner','schedule',key,1,JSON.stringify({enabled,hour_shanghai:hour,rules:[rule]}),Date.now());}
test('failed schedule does not block later schedules or processing an existing queue',async(t)=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2020-01-03T00:00:00+08:00')});
 const DB=testDB(),api={env:{DB}};plan(DB,'a-conflict');plan(DB,'b-healthy');plan(DB,'c-disabled',false);plan(DB,'d-not-due',true,9);
 const old=await cloudJobs(api,{action:'submit',request_key:'schedule:a-conflict:1:2020-01-03',tasks:[{kind:'template',key:'not-found-demo',expected_revision:1,start_date:'2020-01-01',end_date:'2020-01-02'}]},'demo-owner');
 DB.sql.prepare('UPDATE cloud_jobs SET created_at=?,updated_at=? WHERE id=?').run(Date.now()-1,Date.now()-1,old.job_id);
 const r=await inspectionSchedules(api,{action:'tick'},'demo-owner');
 assert.equal(r.submitted.length,2);assert.deepEqual(r.submitted[0],{key:'a-conflict',revision:1,status:'failed',code:'VERSION_CONFLICT'});
 assert.equal(r.submitted[1].key,'b-healthy');assert.ok(r.submitted[1].job_id);assert.equal(r.processed.job_id,old.job_id);assert.equal(r.processed.state,'partial');
 const log=DB.sql.prepare('SELECT * FROM dispatch_runs WHERE id=?').get(r.dispatch_run_id);assert.equal(log.status,'task_failed');assert.equal(log.submitted_count,1);
 assert.equal(DB.sql.prepare('SELECT COUNT(*) n FROM cloud_jobs').get().n,2);
 const again=await inspectionSchedules(api,{action:'tick'},'demo-owner');assert.equal(again.submitted[1].job_id,r.submitted[1].job_id);assert.equal(DB.sql.prepare('SELECT COUNT(*) n FROM cloud_jobs').get().n,2);
 const other=await inspectionSchedules(api,{action:'tick'},'another-owner');assert.deepEqual(other.submitted,[]);assert.equal(other.processed.status,'idle');
});
test('dispatch health reports submission failure even when queue is idle',()=>{
 assert.equal(dispatchFailed({submitted:[{status:'failed'}],processed:{status:'idle'}}),true);
 assert.equal(dispatchFailed({submitted:[],mapped:{status:'partial'},processed:{status:'idle'}}),true);
 assert.equal(dispatchFailed({submitted:[],processed:{state:'partial'}}),true);
 assert.equal(dispatchFailed({submitted:[],mapped:{status:'submitted'},processed:{status:'idle'}}),false);
});
