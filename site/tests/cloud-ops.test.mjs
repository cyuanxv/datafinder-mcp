import test from 'node:test';
import assert from 'node:assert/strict';
import {assessObservation,incidentTimeline,readAnomalies} from '../lib/datafinder/anomalies.mjs';
import {queryTemplate} from '../lib/datafinder/templates.mjs';
import {testDB} from './db-helper.mjs';
const observation=(state,day,i=0,revision=1)=>({run_id:String(i),rule_key:'r',revision,start_date:day,end_date:day,created_at:i,state,body:JSON.stringify({state,reasons:[]})});
test('unknown and no events do not imply business recovery',()=>{assert.equal(assessObservation({kind:'quality',status:'success',data:{status:'no_events'}}).state,'unknown');assert.equal(assessObservation({kind:'health',status:'success',data:{items:[{events:{assessment:'insufficient_baseline'}}]}}).state,'unknown');assert.equal(assessObservation({status:'failed',error_code:'UPSTREAM_ERROR'}).state,'execution_failed');});
test('quality missing and invalid values are flagged independently',()=>{assert.equal(assessObservation({kind:'quality',status:'success',data:{status:'measured',total_events:10,missing_events:0,invalid_events:2}}).state,'business_anomaly');assert.equal(assessObservation({kind:'quality',status:'success',data:{status:'measured',total_events:10,missing_events:0,invalid_events:null}}).state,'normal');});
test('incidents dedup consecutive checks but retain recurrence and recovery',()=>{const rows=['business_anomaly','business_anomaly','unknown','normal','business_anomaly'].map((s,i)=>observation(s,'2026-10-10',i));assert.deepEqual(incidentTimeline(rows).map(x=>x.transition),['opened','recovered','unknown','opened']);});
test('older dates and new definitions cannot falsely recover an incident',()=>{const rows=[observation('business_anomaly','2026-10-11',1),observation('normal','2026-10-10',2),observation('normal','2026-10-12',3,2)];assert.deepEqual(incidentTimeline(rows).map(x=>x.transition),['opened']);});
test('anomaly queries enforce owner boundaries',async()=>{const DB=testDB(),api={env:{DB}};await DB.prepare('INSERT INTO inspection_observations VALUES(?,?,?,?,?,?,?,?,?)').bind('u','r','key',1,'2026-10-10','2026-10-10',1,'execution_failed','{"state":"execution_failed","reasons":[]}').run();assert.equal((await readAnomalies(api,{},'other')).items.length,0);assert.equal((await readAnomalies(api,{},'u')).items.length,1);await assert.rejects(readAnomalies(api,{},''));});
test('templates use CAS versions, explicit dates and strict allowed queries',async()=>{const api={env:{DB:testDB()}},template={kind:'analysis',config:{kind:'event',events:[{event_name:'app_launch_client'}]}};
 const input={action:'save',key:'t',name:'启动',expected_revision:0,confirmed:true,template};
 assert.equal((await queryTemplate(api,input,'u')).revision,1);
 await assert.rejects(queryTemplate(api,input,'u'),e=>e.code==='VERSION_CONFLICT');
 await assert.rejects(queryTemplate(api,{action:'read',key:'t'},'other'));
 await assert.rejects(queryTemplate(api,{action:'run',key:'t',expected_revision:1},'u'));
 const r=await queryTemplate(api,{action:'run',key:'t',expected_revision:1,start_date:'2026-10-10',end_date:'2026-10-10'},'u',{analysis:async(a,c)=>({date:c.start_date})});assert.equal(r.output.date,'2026-10-10');
 await assert.rejects(queryTemplate(api,{...input,template:{kind:'sql',sql:'select 1'}},'u'));
});

import {cloudJobs} from '../lib/datafinder/jobs.mjs';
test('cloud queue deduplicates, isolates owners and persists each step',async()=>{
 const api={env:{DB:testDB()}},tasks=[{kind:'template',key:'t',expected_revision:1,start_date:'2026-10-10',end_date:'2026-10-10'},{kind:'template',key:'bad',expected_revision:1,start_date:'2026-10-10',end_date:'2026-10-10'}];
 const r=await cloudJobs(api,{action:'submit',request_key:'q',tasks},'u');assert.equal((await cloudJobs(api,{action:'submit',request_key:'q',tasks},'u')).job_id,r.job_id);
 await assert.rejects(cloudJobs(api,{action:'submit',request_key:'q',tasks:tasks.slice(0,1)},'u'),e=>e.code==='VERSION_CONFLICT');
 await assert.rejects(cloudJobs(api,{action:'read',job_id:r.job_id},'other'));
 const exec={template:async(a,x)=>{if(x.key==='bad')throw Error('secret');return {value:1}}};
 const first=await cloudJobs(api,{action:'process_next'},'u',exec);assert.equal(first.state,'queued');assert.equal(first.completed_tasks,1);
 const final=await cloudJobs(api,{action:'process_next'},'u',exec);assert.equal(final.state,'partial');assert.equal(final.completed_tasks,2);assert.equal(JSON.stringify(final).includes('secret'),false);
 assert.equal((await cloudJobs(api,{action:'process_next'},'u',exec)).status,'idle');
});
test('cloud queue lease protects concurrent workers and permits timeout recovery',async()=>{
 const api={env:{DB:testDB()}},tasks=[{kind:'template',key:'t',expected_revision:1,start_date:'2026-10-10',end_date:'2026-10-10'}];await cloudJobs(api,{action:'submit',request_key:'q',tasks},'u');
 let calls=0;const exec={template:async()=>{calls++;return {ok:true}}};await Promise.all([cloudJobs(api,{action:'process_next'},'u',exec),cloudJobs(api,{action:'process_next'},'u',exec)]);assert.equal(calls,1);
});
import {encodeExport,exportRows} from '../lib/datafinder/export.mjs';
import {partitions} from '../lib/datafinder/distribution.mjs';
import {advancedPlan,parseAdvanced} from '../lib/datafinder/advanced.mjs';
import {inspectionSchedules} from '../lib/datafinder/schedules.mjs';
import {saveRecord} from '../lib/datafinder/governance.mjs';
test('exports preserve null and escape formula injection and XML characters',()=>{const rows=exportRows({unknown:null,zero:0,evil:'=HYPERLINK("x")',xml:'<script>&'});assert.ok(rows.some(r=>r[0]==='/unknown'&&r[1]==='null'));assert.match(encodeExport(rows,'csv'),/'=HYPERLINK/);const xml=encodeExport(rows,'excel_xml');assert.match(xml,/&lt;script&gt;&amp;/);assert.doesNotMatch(xml,/ss:Formula/);});
test('distribution rejects overlapping or duplicate boundaries',()=>{assert.throws(()=>partitions([1,1]));assert.throws(()=>partitions([2,1]));assert.deepEqual(partitions([0,10]),[{lower:null,upper:0},{lower:0,upper:10},{lower:10,upper:null}]);});
test('linear attribution retains fractional conversions and rejects returned model drift',()=>{const p=advancedPlan({kind:'attribution',attribution_model:'linear',start_date:'2026-10-10',end_date:'2026-10-10',events:[{event_name:'target'},{event_name:'source'}]},true);assert.equal(p.dsl.content.option.attribution_type,'linear');const raw=[{query_id:'a00:p00:c00:q00',result_status:'SUCCESS',is_truncated:false,date_index_list:['2026-10-10 00:00:00-2026-10-10 23:59:59'],data_item_list:[{event_show_name:'source',attribution_type:'linear',group_by_key:'__all',data:[10,5,0.5,2.5,1,0.4]}]}];assert.equal(parseAdvanced(raw,p).rows[0].attributed_target_count,2.5);raw[0].data_item_list[0].attribution_type='last';assert.throws(()=>parseAdvanced(raw,p));});
test('schedule saves require rule versions and cannot overwrite stale revisions',async()=>{const api={env:{DB:testDB()}};await saveRecord(api,{kind:'rule',key:'r',confirmed:true,expected_revision:0,rule:{kind:'quality',name:'测试',config:{event:{event_name:'app_launch_client'},property:{property_name:'os_name',property_type:'common_param'}}}},'u');const a={action:'save',key:'s',confirmed:true,expected_revision:0,enabled:false,hour_shanghai:9,rules:[{key:'r',revision:1}]};assert.equal((await inspectionSchedules(api,a,'u')).revision,1);await assert.rejects(inspectionSchedules(api,a,'u'),e=>e.code==='VERSION_CONFLICT');assert.equal((await inspectionSchedules(api,{action:'list'},'other')).items.length,0);assert.equal((await inspectionSchedules(api,{action:'tick'},'u')).processed.status,'idle');});
import {manageCohort} from '../lib/datafinder/cohorts.mjs';
import {DataFinder} from '../lib/datafinder/core.mjs';
test('cohort previews bind owner and version, writes apply once and verify definitions',async()=>{let value=null,writes=0;const api={env:{DB:testDB()},async request(method,path,body,params,options){if(options?.mutation){writes++;value={...body,app_id:1000002,cohort_id:123,cohort_status:0};return {data:{cohort_id:123}};}return {data:value};}};const p=await manageCohort(api,{action:'preview',operation:'create',name:'acceptance',event:{event_name:'app_launch_client'}},'u');assert.equal(writes,0);await assert.rejects(manageCohort(api,{action:'apply',change_id:p.change_id,confirmation:p.confirmation},'other'));const a=await manageCohort(api,{action:'apply',change_id:p.change_id,confirmation:p.confirmation},'u');assert.equal(a.state,'applied');assert.equal(a.result.calculation_status,0);await manageCohort(api,{action:'apply',change_id:p.change_id,confirmation:p.confirmation},'u');assert.equal(writes,1);const update=await manageCohort(api,{action:'preview',operation:'update',cohort_id:'123',name:'new',event:{event_name:'app_launch_client'}},'u');value.description='changed';await assert.rejects(manageCohort(api,{action:'apply',change_id:update.change_id,confirmation:update.confirmation},'u'),e=>e.code==='VERSION_CONFLICT');assert.equal(writes,1);});
test('tag service cannot be used for other paths or writes',async()=>{let requests=0,url='';const api=new DataFinder({DATAFINDER_AK:'test',DATAFINDER_SK:'test'},async(u)=>{requests++;url=u;return Response.json({code:200,data:[]});});await api.request('GET','/openapi/v1/app/1000002/tag',undefined,{}, {service:'datatag'});assert.match(url,/\/datatag\/openapi/);for(const path of ['/openapi/v1/app/1/tag','/openapi/v1/app/1000002/tag/users','/openapi/v1/app/1000002/tag/a/result']){if(path.endsWith('/users'))continue;await assert.rejects(api.request('GET',path,undefined,{}, {service:'datatag'}));}await assert.rejects(api.request('POST','/openapi/v1/app/1000002/tag',{}, {},{service:'datatag'}));assert.equal(requests,1);});


test('unknown observations deduplicate and newer unknown prevents old-date recovery',()=>{
 const rows=[observation('business_anomaly','2026-10-10',1),observation('unknown','2026-10-12',2),observation('unknown','2026-10-12',3),observation('normal','2026-10-11',4),observation('normal','2026-10-13',5)];
 assert.deepEqual(incidentTimeline(rows).map(x=>x.transition),['recovered','unknown','opened']);
 assert.equal(incidentTimeline(rows)[0].end_date,'2026-10-13');
});
test('anomaly readback never exposes owner storage key',async()=>{
 const DB=testDB(),api={env:{DB}};
 await DB.prepare('INSERT INTO inspection_observations VALUES(?,?,?,?,?,?,?,?,?)').bind('private-owner','r','k',1,'2026-10-10','2026-10-10',1,'unknown','{"state":"unknown","reasons":["no_measurement"]}').run();
 assert.equal(JSON.stringify(await readAnomalies(api,{},'private-owner')).includes('private-owner'),false);
});
test('expired queue leases recover once and exhaust retries without duplicate execution',async()=>{
 const DB=testDB(),api={env:{DB}},tasks=[{kind:'template',key:'t',expected_revision:1,start_date:'2026-10-10',end_date:'2026-10-10'}];
 const a=await cloudJobs(api,{action:'submit',request_key:'recover',tasks},'u');
 DB.sql.prepare("UPDATE cloud_jobs SET state='running',lease_until=1,attempts=1 WHERE id=?").run(a.job_id);
 let calls=0;const exec={template:async()=>{calls++;return {ok:true}}};
 assert.equal((await cloudJobs(api,{action:'process_next'},'u',exec)).state,'completed');assert.equal(calls,1);
 const b=await cloudJobs(api,{action:'submit',request_key:'exhaust',tasks},'u');
 DB.sql.prepare("UPDATE cloud_jobs SET state='running',lease_until=1,attempts=3 WHERE id=?").run(b.job_id);
 assert.equal((await cloudJobs(api,{action:'process_next'},'u',exec)).status,'idle');assert.equal(calls,1);
 assert.equal((await cloudJobs(api,{action:'read',job_id:b.job_id},'u')).state,'failed');
});
test('queue response budget counts UTF-8 bytes including non-ASCII output',async()=>{
 const api={env:{DB:testDB()}},tasks=[{kind:'template',key:'t',expected_revision:1,start_date:'2026-10-10',end_date:'2026-10-10'}];
 await cloudJobs(api,{action:'submit',request_key:'size',tasks},'u');
 const r=await cloudJobs(api,{action:'process_next'},'u',{template:async()=>({text:'测'.repeat(25000)})});
 assert.equal(r.state,'completed');assert.ok(r.results[0].output_ref.bytes>60000);assert.equal(r.results[0].output,undefined);
});
