import test from 'node:test';
import assert from 'node:assert/strict';
import {testDB} from './db-helper.mjs';
import {cloudJobs} from '../lib/datafinder/jobs.mjs';
import {dependencyStep} from '../lib/datafinder/dependency-jobs.mjs';
import {readOperations,nextDue,dependencyJobs} from '../lib/datafinder/operations.mjs';
import {inspectionSchedules} from '../lib/datafinder/schedules.mjs';
import {QueryError} from '../lib/datafinder/core.mjs';
const task={kind:'dependency',asset_kind:'virtual_events',name:'test_event',max_depth:5};
const page=(p,last=false)=>({target:{kind:'virtual_events',name:'test_event',found:true},catalog_version:'c'.repeat(64),metadata_version:'m'.repeat(64),next_page:last?null:p+1,has_more:!last,scanned_dashboard_ids:[String(p)],scanned_report_ids:['shared',String(p)],visible_dashboard_count:2,matches:[{type:'report',id:'shared',dashboard_id:String(p)}],unknown:[],failed:[],omitted:{matches:0,unknown:0},page_complete:true,limitations:['partial']});
test('dependency background checkpoints survive new API instance and deduplicate across pages',async()=>{
 const DB=testDB(),api={env:{DB}},job=await dependencyJobs(api,{action:'submit',request_key:'scan',kind:'virtual_events',name:'test_event'},'u');
 const exec={dependency:async(api,t,prev)=>dependencyStep(api,t,prev,async(a,input)=>{if(input.page===2){assert.equal(input.catalog_version,'c'.repeat(64));assert.equal(input.metadata_version,'m'.repeat(64));}return page(input.page,input.page===2);})};
 const first=await cloudJobs(api,{action:'process_next'},'u',exec);assert.equal(first.state,'queued');assert.equal(first.completed_tasks,0);assert.equal(first.results[0].output.next_page,2);
 const done=await cloudJobs({env:{DB}},{action:'process_next'},'u',exec);assert.equal(done.state,'completed');assert.equal(done.results[0].output.scanned_report_count,3);assert.equal(done.results[0].output.matches.length,1);assert.deepEqual(done.results[0].output.matches[0].dashboard_ids,['1','2']);assert.equal(done.results[0].output.coverage,'partial');assert.equal(done.results[0].output.visible_catalog_finished,true);
 const history=await readOperations(api,{job_id:job.job_id},'u');assert.equal(history.attempts.length,2);assert.deepEqual(new Set(history.attempts.map(x=>x.status)),new Set(['checkpoint_saved','completed']));
 await assert.rejects(readOperations(api,{job_id:job.job_id},'other'),e=>e.code==='NOT_FOUND');
});
test('failed page and changed catalog cannot advance or erase persisted checkpoint',async()=>{
 const api={env:{DB:testDB()}};await cloudJobs(api,{action:'submit',request_key:'scan',tasks:[task]},'u');
 await cloudJobs(api,{action:'process_next'},'u',{dependency:(a,t,p)=>dependencyStep(a,t,p,async()=>page(1))});
 const r=await cloudJobs(api,{action:'process_next'},'u',{dependency:async()=>{throw new QueryError('VERSION_CONFLICT','private raw detail');}});assert.equal(r.state,'partial');assert.equal(r.results[0].error_code,'VERSION_CONFLICT');assert.equal(r.results[0].output.next_page,2);assert.equal(JSON.stringify(r).includes('private raw'),false);
 await assert.rejects(dependencyStep(api,task,null,async()=>({...page(1),failed:[{code:'FAIL'}]})),e=>e.code==='DEPENDENCY_PAGE_FAILED'&&e.scan_failure.page===1&&e.scan_failure.failures[0].code==='FAIL');
});
test('scan repeated same-page interruptions terminate without skipping a page',async()=>{
 let previous;for(let i=0;i<2;i++)previous=(await dependencyStep({},task,previous,async()=>({...page(1),next_page:1}))).output;
 await assert.rejects(dependencyStep({},task,previous,async()=>({...page(1),next_page:1})),e=>e.code==='SCAN_STALLED');
});
test('lost lease cannot commit a scan checkpoint',async()=>{
 const DB=testDB(),api={env:{DB}},j=await cloudJobs(api,{action:'submit',request_key:'scan',tasks:[task]},'u');
 await assert.rejects(cloudJobs(api,{action:'process_next'},'u',{dependency:async()=>{DB.sql.prepare('UPDATE cloud_jobs SET lease_token=? WHERE id=?').run('other-worker',j.job_id);return {continue:true,output:{next_page:2}};}}),e=>e.code==='LEASE_LOST');
 const r=await cloudJobs(api,{action:'read',job_id:j.job_id},'u');assert.equal(r.results.length,0);assert.equal(r.completed_tasks,0);
});
test('dispatch history records idle tick but never claims automatic provenance',async()=>{
 const api={env:{DB:testDB()}};const tick=await inspectionSchedules(api,{action:'tick'},'u');assert.ok(tick.dispatch_run_id);assert.equal(tick.trigger_origin,'unverified');
 const ops=await readOperations(api,{},'u');assert.equal(ops.dispatches.length,1);assert.equal(ops.dispatches[0].status,'completed');assert.equal(ops.diagnostics.automatic_trigger_verified,false);assert.equal(ops.diagnostics.tick_freshness,'recent');
 const other=await readOperations(api,{},'other');assert.equal(other.dispatches.length,0);assert.equal(other.diagnostics.tick_freshness,'never_observed');assert.equal(JSON.stringify(ops).includes('"owner"'),false);
});
test('dispatch errors remain visible without raw error leakage',async()=>{
 const DB=testDB(),api={env:{DB}};for(let i=0;i<101;i++)DB.sql.prepare('INSERT INTO governance_records(owner,kind,record_key,revision,body,created_at) VALUES(?,?,?,?,?,?)').run('u','schedule','s'+i,1,'{}',1);
 await assert.rejects(inspectionSchedules(api,{action:'tick'},'u'),e=>e.code==='RESULT_TOO_LARGE');const ops=DB.sql.prepare('SELECT status,error_code FROM dispatch_runs').get();assert.equal(ops.status,'failed');assert.equal(ops.error_code,'RESULT_TOO_LARGE');
});
test('inspection partial output is not presented as a successful job',async()=>{
 const api={env:{DB:testDB()}};await cloudJobs(api,{action:'submit',request_key:'partial',tasks:[{kind:'inspection',rules:[{key:'r',revision:1}],start_date:'2026-10-10',end_date:'2026-10-10'}]},'u');
 const r=await cloudJobs(api,{action:'process_next'},'u',{inspection:async()=>({status:'partial',items:[{status:'failed'}]})});assert.equal(r.state,'partial');assert.equal(r.results[0].error_code,'INSPECTION_INCOMPLETE');
});
test('next planned execution respects Shanghai day boundary and disabled plans',()=>{
 const now=Date.parse('2026-10-15T00:30:00Z');assert.equal(nextDue({enabled:true,hour_shanghai:9},now),'2026-10-15T01:00:00.000Z');assert.equal(nextDue({enabled:true,hour_shanghai:8},now),'2026-10-16T00:00:00.000Z');assert.equal(nextDue({enabled:false,hour_shanghai:9},now),null);
});

test('failed background page exposes only safe location and preserves checkpoint',async()=>{
 const api={env:{DB:testDB()}};await cloudJobs(api,{action:'submit',request_key:'diagnostic',tasks:[task]},'u');
 await cloudJobs(api,{action:'process_next'},'u',{dependency:(a,t,p)=>dependencyStep(a,t,p,async()=>page(1))});
 const r=await cloudJobs(api,{action:'process_next'},'u',{dependency:(a,t,p)=>dependencyStep(a,t,p,async()=>({...page(2),failed:[{dashboard_id:'123',code:'UNVERIFIED_CONTRACT',secret:'must-not-leak'}]}))});
 assert.equal(r.results[0].scan_failure.page,2);assert.deepEqual(r.results[0].scan_failure.failures,[{dashboard_id:'123',code:'UNVERIFIED_CONTRACT'}]);assert.equal(r.results[0].output.next_page,2);assert.ok(!JSON.stringify(r).includes('must-not-leak'));
});
