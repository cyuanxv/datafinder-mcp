import test from 'node:test';
import assert from 'node:assert/strict';
import {testDB} from './db-helper.mjs';
import {cloudJobs} from '../lib/datafinder/jobs.mjs';
import {readOperations} from '../lib/datafinder/operations.mjs';
import {storeOutput,hydrateOutput,textHash} from '../lib/datafinder/result-store.mjs';
import {aggregateExport} from '../lib/datafinder/export.mjs';
import {queryTemplate} from '../lib/datafinder/templates.mjs';
import {saveRecord} from '../lib/datafinder/governance.mjs';
import {QueryError} from '../lib/datafinder/core.mjs';
const task={kind:'template',key:'t',expected_revision:1,start_date:'2026-10-10',end_date:'2026-10-10'};
async function setup(){const DB=testDB(),api={env:{DB}};await queryTemplate(api,{action:'save',key:'t',name:'test',expected_revision:0,confirmed:true,template:{kind:'analysis',config:{kind:'event',events:[{event_name:'app_launch_client'}]}}},'u');return {DB,api};}
async function submit(api,key='q',tasks=[task]){return cloudJobs(api,{action:'submit',request_key:key,tasks},'u');}
const fail={template:async()=>{throw new QueryError('UPSTREAM_BUSINESS_ERROR','private detail');}};
const ok={template:async()=>({value:1})};
test('history keyset pagination covers tied timestamps without duplicate rows',async()=>{
 const {api,DB}=await setup();for(let i=0;i<7;i++)await submit(api,'q'+i);DB.sql.exec('UPDATE cloud_jobs SET created_at=100');
 let cursor,ids=[];do{const p=await readOperations(api,{view:'jobs',limit:2,...(cursor?{cursor}:{})},'u');ids.push(...p.items.map(x=>x.job_id));cursor=p.next_cursor;}while(cursor);
 assert.equal(ids.length,7);assert.equal(new Set(ids).size,7);
});
test('history filters dates/status and binds cursors to owner and filters',async()=>{
 const {api,DB}=await setup();for(let i=0;i<3;i++)await submit(api,'q'+i);DB.sql.exec('UPDATE cloud_jobs SET created_at=100');
 const input={view:'jobs',status:'queued',from:'1970-01-01T00:00:00Z',to:'1970-01-01T00:00:01Z',limit:1};const p=await readOperations(api,input,'u');assert.ok(p.next_cursor);
 await assert.rejects(readOperations(api,{...input,cursor:p.next_cursor},'other'),e=>e.code==='INVALID_ARGUMENT');
 await assert.rejects(readOperations(api,{...input,status:'completed',cursor:p.next_cursor},'u'),e=>e.code==='INVALID_ARGUMENT');
 await assert.rejects(readOperations(api,{view:'jobs',cursor:'bad'},'u'),e=>e.code==='INVALID_ARGUMENT');
 assert.equal((await readOperations(api,{view:'jobs',status:'completed'},'u')).items.length,0);
 await assert.rejects(readOperations(api,{view:'attempts',status:'queued'},'u'),e=>e.code==='INVALID_ARGUMENT');
 await assert.rejects(readOperations(api,{view:'jobs',from:'2026-10-11T00:00:00Z',to:'2026-10-10T00:00:00Z'},'u'),e=>e.code==='INVALID_ARGUMENT');
});
test('new inserts between history pages do not shift older records',async()=>{
 const {api,DB}=await setup();for(let i=0;i<3;i++)await submit(api,'q'+i);DB.sql.exec('UPDATE cloud_jobs SET created_at=100');
 const first=await cloudJobs(api,{action:'list',limit:1},'u');await submit(api,'new');const next=await cloudJobs(api,{action:'list',limit:5,cursor:first.next_cursor},'u');assert.equal(next.items.length,2);assert.ok(!next.items.some(x=>x.request_key==='new'));
});
test('attempt history paginates by job and never leaks another owner',async()=>{
 const {api}=await setup(),j=await submit(api,'multi',[task,task,task]);for(let i=0;i<3;i++)await cloudJobs(api,{action:'process_next'},'u',ok);
 const a=await readOperations(api,{view:'attempts',job_id:j.job_id,limit:2},'u');assert.equal(a.items.length,2);const b=await readOperations(api,{view:'attempts',job_id:j.job_id,limit:2,cursor:a.next_cursor},'u');assert.equal(b.items.length,1);await assert.rejects(readOperations(api,{view:'attempts',job_id:j.job_id},'other'),e=>e.code==='NOT_FOUND');
});
test('retry preserves original and skips successful subtasks; concurrent submit is idempotent',async()=>{
 const {api}=await setup(),j=await submit(api,'mixed',[task,task]);await cloudJobs(api,{action:'process_next'},'u',ok);await cloudJobs(api,{action:'process_next'},'u',fail);
 const original=await cloudJobs(api,{action:'read',job_id:j.job_id},'u');const args={action:'retry',job_id:j.job_id,request_key:'retry',confirmed:true};
 const rs=await Promise.all([cloudJobs(api,args,'u'),cloudJobs(api,args,'u')]);assert.equal(rs[0].job_id,rs[1].job_id);assert.deepEqual(rs[0].source_task_indices,[1]);assert.equal(rs[0].total_tasks,1);
 assert.deepEqual(await cloudJobs(api,{action:'read',job_id:j.job_id},'u'),original);
 const done=await cloudJobs(api,{action:'process_next'},'u',ok);assert.equal(done.state,'completed');assert.equal(done.recovery_of,j.job_id);
 await assert.rejects(cloudJobs(api,{...args,request_key:'duplicate'},'u'),e=>e.code==='VERSION_CONFLICT');
});
test('retry rejects missing confirmation, foreign owner, active tasks and reused keys',async()=>{
 const {api}=await setup(),j=await submit(api);const args={action:'retry',job_id:j.job_id,request_key:'r',confirmed:true};
 await assert.rejects(cloudJobs(api,args,'u'),e=>e.code==='INVALID_ARGUMENT');await cloudJobs(api,{action:'process_next'},'u',fail);
 await assert.rejects(cloudJobs(api,{action:'retry',job_id:j.job_id,request_key:'r'},'u'),e=>e.code==='INVALID_ARGUMENT');
 await assert.rejects(cloudJobs(api,args,'other'),e=>e.code==='NOT_FOUND');await submit(api,'r');await assert.rejects(cloudJobs(api,args,'u'),e=>e.code==='VERSION_CONFLICT');
});
test('retry refuses template version drift',async()=>{
 const {api,DB}=await setup(),j=await submit(api);await cloudJobs(api,{action:'process_next'},'u',fail);
 DB.sql.exec("INSERT INTO governance_records SELECT owner,kind,record_key,2,body,created_at FROM governance_records");
 await assert.rejects(cloudJobs(api,{action:'retry',job_id:j.job_id,request_key:'r',confirmed:true},'u'),e=>e.code==='VERSION_CONFLICT');
});
test('partial inspection retry only reruns unsuccessful rules and checks all rule versions',async()=>{
 const {api}=await setup();for(const key of ['a','b'])await saveRecord(api,{kind:'rule',key,expected_revision:0,confirmed:true,rule:{kind:'quality',name:key,config:{event:{event_name:'app_launch_client'},property:{property_name:'os_name',property_type:'common_param'}}}},'u');
 const j=await submit(api,'rules',[{kind:'inspection',rules:[{key:'a',revision:1},{key:'b',revision:1}],start_date:'2026-10-10',end_date:'2026-10-10'}]);await cloudJobs(api,{action:'process_next'},'u',{inspection:async()=>({status:'partial',items:[{key:'a',status:'success'},{key:'b',status:'failed'}]})});
 const r=await cloudJobs(api,{action:'retry',job_id:j.job_id,request_key:'rr',confirmed:true},'u');assert.deepEqual(r.tasks[0].rules,[{key:'b',revision:1}]);
});
test('lease-exhausted task recovery includes unexecuted tasks but not successful ones',async()=>{
 const {api,DB}=await setup(),j=await submit(api,'crash',[task,task,task]);await cloudJobs(api,{action:'process_next'},'u',ok);DB.sql.prepare("UPDATE cloud_jobs SET state='failed',attempts=3 WHERE id=?").run(j.job_id);
 const r=await cloudJobs(api,{action:'retry',job_id:j.job_id,request_key:'r',confirmed:true},'u');assert.deepEqual(r.source_task_indices,[1,2]);
});
test('dependency recovery retains checkpoint and execution still rejects version drift',async()=>{
 const {api}=await setup(),j=await submit(api,'scan',[{kind:'dependency',asset_kind:'virtual_events',name:'event',max_depth:5}]);
 const checkpoint={next_page:6,catalog_version:'c'.repeat(64),metadata_version:'m'.repeat(64),matches:['测试'.repeat(30000)]};await cloudJobs(api,{action:'process_next'},'u',{dependency:async()=>({continue:true,output:checkpoint})});await cloudJobs(api,{action:'process_next'},'u',{dependency:async()=>{throw new QueryError('DEPENDENCY_PAGE_FAILED','failed');}});
 const retry=await cloudJobs(api,{action:'retry',job_id:j.job_id,request_key:'r',confirmed:true},'u');assert.ok(retry.results[0].output_ref);
 const failed=await cloudJobs(api,{action:'process_next'},'u',{dependency:async(a,t,prev)=>{assert.deepEqual(prev,checkpoint);throw new QueryError('VERSION_CONFLICT','changed');}});assert.equal(failed.results[0].error_code,'VERSION_CONFLICT');
});
test('large Unicode results persist, reconstruct exactly, and export beyond old row cap',async()=>{
 const {api}=await setup(),j=await submit(api);const output={rows:Array.from({length:15000},(_,i)=>({n:i,value:i===0?null:'中文😀='+i})),evil:'=HYPERLINK("x")'};
 const result=await cloudJobs(api,{action:'process_next'},'u',{template:async()=>output});assert.equal(result.state,'completed');const ref=result.results[0].output_ref;assert.ok(ref.bytes>60000);let text='';for(let page=1;page<=ref.pages;page++){const r=await cloudJobs({env:api.env},{action:'read_result',job_id:j.job_id,task_index:0,result_page:page},'u');text+=r.text;assert.equal(await textHash(r.text),r.page_sha256);}assert.deepEqual(JSON.parse(text),output);assert.equal(await textHash(text),ref.sha256);
 const csv=await aggregateExport(api,{kind:'job',id:j.job_id,format:'csv'},'u');const content=await new Response(csv.body).text();assert.match(content,/14999/);assert.match(content,/'=HYPERLINK/);assert.match(content,/"null"/);assert.ok(content.split('\r\n').length>30000);
 const xml=await aggregateExport(api,{kind:'job',id:j.job_id,format:'excel_xml'},'u');assert.match(await new Response(xml.body).text(),/中文😀=14999/);
 await assert.rejects(cloudJobs(api,{action:'read_result',job_id:j.job_id,task_index:0,result_page:1},'other'),e=>e.code==='NOT_FOUND');await assert.rejects(aggregateExport(api,{kind:'job',id:j.job_id},'other'),e=>e.code==='NOT_FOUND');
});
test('result page bounds and corrupt/missing chunk fail closed',async()=>{
 const {api,DB}=await setup(),j=await submit(api);const r=await cloudJobs(api,{action:'process_next'},'u',{template:async()=>({text:'中'.repeat(30000)})});const ref=r.results[0].output_ref;
 await assert.rejects(cloudJobs(api,{action:'read_result',job_id:j.job_id,task_index:0,result_page:ref.pages+1},'u'),e=>e.code==='INVALID_ARGUMENT');
 DB.sql.prepare('UPDATE result_chunks SET body=? WHERE result_id=? AND page=1').run('tampered',ref.result_id);await assert.rejects(aggregateExport(api,{kind:'job',id:j.job_id},'u'),e=>e.code==='RESULT_CORRUPT');
});
test('over-cap results fail explicitly and keep the earlier dependency checkpoint',async()=>{
 const {api}=await setup();await submit(api,'scan',[{kind:'dependency',asset_kind:'virtual_events',name:'event',max_depth:5}]);await cloudJobs(api,{action:'process_next'},'u',{dependency:async()=>({continue:true,output:{next_page:2}})});
 const r=await cloudJobs(api,{action:'process_next'},'u',{dependency:async()=>({continue:true,output:{text:'x'.repeat(2*1024*1024)}})});assert.equal(r.state,'partial');assert.equal(r.results[0].error_code,'RESULT_TOO_LARGE');assert.equal(r.results[0].output.next_page,2);
});
test('large result from lost lease is never published to the job',async()=>{
 const {api,DB}=await setup(),j=await submit(api);await assert.rejects(cloudJobs(api,{action:'process_next'},'u',{template:async()=>{DB.sql.prepare('UPDATE cloud_jobs SET lease_token=? WHERE id=?').run('replacement',j.job_id);return {text:'大'.repeat(30000)};}}),e=>e.code==='LEASE_LOST');assert.equal((await cloudJobs(api,{action:'read',job_id:j.job_id},'u')).results.length,0);
});

test('job aggregate cap rejects only the overflowing task and retains saved results',async()=>{
 const {api}=await setup();await submit(api,'cap',Array.from({length:5},()=>task));let r;
 for(let i=0;i<5;i++)r=await cloudJobs(api,{action:'process_next'},'u',{template:async()=>({text:'a'.repeat(1800000)})});
 assert.equal(r.state,'partial');assert.equal(r.results[4].error_code,'RESULT_TOO_LARGE');assert.ok(r.results.slice(0,4).every(x=>x.status==='completed'&&x.output_ref.bytes>1000000));
});
test('chunked inspection batch can be read and exported without the legacy size cap',async()=>{
 const {api}=await setup();const id=crypto.randomUUID(),value={run_id:id,items:[{text:'汉'.repeat(40000)}]};const stored=await storeOutput(api.env.DB,'u',value);await api.env.DB.prepare('INSERT INTO governance_runs(id,owner,body,created_at) VALUES(?,?,?,?)').bind(id,'u',JSON.stringify(stored),1).run();
 const {readBatch}=await import('../lib/datafinder/governance.mjs');assert.deepEqual(await readBatch(api,id,'u'),value);const r=await aggregateExport(api,{kind:'inspection',id},'u');assert.ok((await new Response(r.body).text()).includes('汉'.repeat(100)));
});
test('chunk integrity and owner checks also apply to internal checkpoint hydration',async()=>{
 const DB=testDB(),r=await storeOutput(DB,'u',{text:'x'.repeat(50000)});await assert.rejects(hydrateOutput(DB,'other',r),e=>e.code==='RESULT_CORRUPT');DB.sql.prepare('DELETE FROM result_chunks WHERE owner=? AND result_id=? AND page=2').run('u',r.output_ref.result_id);await assert.rejects(hydrateOutput(DB,'u',r),e=>e.code==='RESULT_CORRUPT');
});
test('retry validates report source fingerprint rather than only template revision',async()=>{
 const {api,DB}=await setup(),j=await submit(api);await cloudJobs(api,{action:'process_next'},'u',fail);
 DB.sql.prepare("UPDATE governance_records SET body=? WHERE owner='u' AND kind='template' AND record_key='t'").run(JSON.stringify({kind:'report',name:'r',config:{report_id:'8900000000000000007'},source_version:'0'.repeat(64)}));
 let reads=0;api.request=async()=>{reads++;throw new QueryError('VERSION_CONFLICT','source changed');};
 await assert.rejects(cloudJobs(api,{action:'retry',job_id:j.job_id,request_key:'r',confirmed:true},'u'),e=>e.code==='VERSION_CONFLICT');assert.equal(reads,1);
});
