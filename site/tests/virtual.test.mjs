import {queryReportAdaptive} from '../lib/datafinder/analysis.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {previewChange,applyChange,getChange,readVirtual,validateExpression} from '../lib/datafinder/virtual.mjs';
import {DataFinder} from '../lib/datafinder/core.mjs';
import {savedSql,sqlResult} from '../lib/datafinder/saved-sql.mjs';
function db(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(readFileSync(new URL('../drizzle/0000_careless_tempest.sql',import.meta.url),'utf8'));
 return {sql,prepare(q){
  const stmt=sql.prepare(q);
  return {bind(...args){return {
   async run(){const r=stmt.run(...args);return {meta:{changes:Number(r.changes)}};},
   async first(){return stmt.get(...args)??null;}
  };}};
 }};
}

function mock(){const DB=db(),items=[],calls=[];return {env:{DB},items,calls,output:r=>r,async request(method,path,body,params,opts){calls.push({method,path,body,opts});if(path.endsWith('/list/events'))return {data:[{name:'app_launch',id:42,status:1}]};if(path.includes('/list/'))return {data:structuredClone(items)};if(method==='POST'){items.push({...body,id:7,project_id:1000001,relation_app_ids:[1000002],updated_at:1});return {data:7,log_id:'write'};}Object.assign(items[0],body,{updated_at:2});return {data:true,log_id:'patch'};}};}
const event={kind:'virtual_events',operation:'create',name:'acceptance_event',status:1,events:[{event_name:'app_launch'}]};
const param={kind:'virtual_params',operation:'create',name:'$_vp_acceptance',property_type:2,value_type:'string',event_relation_strategy:'any',sql_rule:"lower(user_profiles.current_language)"};
test('preview persists owner-bound plan, only apply writes and readback verifies',async()=>{const a=mock(),p=await previewChange(a,event,'u');assert.ok(p.confirmation);assert.equal(a.items.length,0);assert.equal(p.after.dsl_content.queries[0].event_id,42);await assert.rejects(applyChange(a,{change_id:p.change_id,confirmation:'bad'},'u'),e=>e.code==='CONFIRMATION_MISMATCH');await assert.rejects(applyChange(a,p,'other'),e=>e.code==='NOT_FOUND');const r=await applyChange(a,p,'u');assert.equal(r.state,'applied');assert.equal(a.items.length,1);assert.equal(a.calls.at(-2).opts.mutation,true);assert.equal((await applyChange(a,p,'u')).replayed,true);assert.equal(a.items.length,1);});
test('stale version and expiry fail before writing',async()=>{const a=mock();await applyChange(a,await previewChange(a,event,'u'),'u');const p=await previewChange(a,{kind:'virtual_events',operation:'update',name:event.name,show_name:'new'},'u');a.items[0].updated_at=55;await assert.rejects(applyChange(a,p,'u'),e=>e.code==='VERSION_CONFLICT');const b=mock(),q=await previewChange(b,event,'u');b.env.DB.sql.prepare('UPDATE metadata_changes SET expires_at=0').run();await assert.rejects(applyChange(b,q,'u'),e=>e.code==='PREVIEW_EXPIRED');assert.equal(b.items.length,0);});
test('atomic claim allows only one of simultaneous confirms to submit',async()=>{const a=mock(),p=await previewChange(a,event,'u');const rs=await Promise.all([applyChange(a,p,'u'),applyChange(a,p,'u')]);assert.equal(a.items.length,1);assert.equal(rs.filter(r=>r.state==='applied').length,1);});
test('uncertain upstream write is recorded and never retried on repeated apply',async()=>{const a=mock(),p=await previewChange(a,event,'u'),request=a.request.bind(a);let writes=0;a.request=async(...args)=>{if(args[4]?.mutation){writes++;throw new Error('network');}return request(...args);};assert.equal((await applyChange(a,p,'u')).state,'unknown');assert.equal((await applyChange(a,p,'u')).state,'unknown');assert.equal(writes,1);});
test('property patch supplies required existing fields, refuses type change',async()=>{const a=mock();await applyChange(a,await previewChange(a,param,'u'),'u');const p=await previewChange(a,{kind:'virtual_params',operation:'update',name:param.name,show_name:'new'},'u');assert.equal(p.after.sql_rule,param.sql_rule);const r=await applyChange(a,p,'u');assert.equal(r.state,'applied');assert.equal(a.calls.at(-2).method,'PATCH');assert.equal(a.calls.at(-2).path,'/openapi/v1/metadata/1000002/virtual_params');await assert.rejects(previewChange(a,{kind:'virtual_params',operation:'update',name:param.name,property_type:1},'u'));});
test('invalid expressions cannot introduce statements, remote tables, private values or virtual recursion',()=>{for(const s of ["user_profiles.email","url('http://x')","user_profiles.x;DROP TABLE t","(select 1)","user_profiles.$_vp_a","user_profiles.x -- comment","sleep(10)","event_params.x"]){assert.throws(()=>validateExpression(s,2));}for(const s of ["concat(user_profiles.device_model, ' ', user_profiles.os_version)","CASE WHEN event_params.drama_id IN (1,2) THEN 1 ELSE 0 END","formatDateTime(event_params.`$event_time`, '%Y-%m-%d')"]){validateExpression(s,1);}});
test('missing DB or owner, duplicate creates and cyclic virtual dependencies rejected',async()=>{await assert.rejects(previewChange({env:{}},event,'u'));await assert.rejects(previewChange(mock(),event,''));const a=mock();await applyChange(a,await previewChange(a,event,'u'),'u');await assert.rejects(previewChange(a,event,'u'));await assert.rejects(previewChange(mock(),{...event,events:[{event_name:'other',event_type:'virtual'}]},'u'));});
test('reads return full definition/version with pagination and reject foreign scope',async()=>{const a=mock();await applyChange(a,await previewChange(a,event,'u'),'u');const r=await readVirtual(a,{kind:'virtual_events',name:event.name});assert.ok(r.data.items[0].version);assert.equal(r.data.items[0].dsl_content.queries[0].event_name,'app_launch');a.items[0].project_id=1;await assert.rejects(readVirtual(a,{kind:'virtual_events'}),e=>e.code==='OUT_OF_SCOPE');});
test('mutation transport signs PATCH and never retries 503',async()=>{let calls=0;const a=new DataFinder({DATAFINDER_AK:'a',DATAFINDER_SK:'b'},async(u,o)=>{calls++;assert.equal(o.method,'PATCH');return new Response('',{status:503});});await assert.rejects(a.request('PATCH','/openapi/v1/metadata/1000002/virtual_params',{name:'x'},{},{mutation:true}));assert.equal(calls,1);await assert.rejects(a.request('PATCH','/openapi/v1/metadata/9/virtual_params',{}, {},{mutation:true}),e=>e.code==='FORBIDDEN');});
const rid='8900000000000000007',bid='8900000000000000002';
function sqlMock(){let executed=0;const definition={resources:[{project_ids:[1000001],app_ids:[]}],content:{query_type:'sql',sql:'select count(*) from events'}};return {definition,env:{DATAFINDER_ALLOW_PROJECT_WIDE:'true'},output:r=>r,get executed(){return executed;},async request(m,p){if(p.endsWith('/dashboards/all'))return {data:[{app_id:1000001,dashboard_id:bid}]};return {data:{[bid]:{reports:[{report_id:rid,report_type:'sql_analysis',dsls:[{dsl_content:definition}]}]}}};},async report(){executed++;return {data:{dsls:[{dsl_content:definition,data:{table_head:['count','missing'],table_body:[[0,null]],error_message:'',error_level:''}}]}};}};}
test('saved SQL read does not execute, execute requires exact definition version',async()=>{const a=sqlMock(),r=await savedSql(a,{report_id:rid});assert.equal(a.executed,0);await assert.rejects(savedSql(a,{report_id:rid,action:'execute'}));const result=await savedSql(a,{report_id:rid,action:'execute',expected_version:r.data.version});assert.equal(a.executed,1);assert.deepEqual(result.data.tables[0].rows,[[0,null]]);a.definition.content.sql+=' limit 1';await assert.rejects(savedSql(a,{report_id:rid,action:'execute',expected_version:r.data.version}));assert.equal(a.executed,1);});
test('saved SQL blocks missing results and restricted detail fields',()=>{assert.throws(()=>sqlResult({dsls:[{}]},100));assert.throws(()=>sqlResult({dsls:[{data:[{user_id:'x'}]}]},100));});
test('explicit write permission rejection is actionable and not retried',async()=>{let calls=0;const api=new DataFinder({DATAFINDER_AK:'a',DATAFINDER_SK:'b'},async()=>{calls++;return Response.json({code:400,message:'has no writeable auth'});});await assert.rejects(api.request('POST','/openapi/v1/metadata/1000002/virtual_params',{}, {},{mutation:true}),e=>e.code==='WRITE_PERMISSION_REQUIRED');assert.equal(calls,1);});

test('SQL table contract rejects errors and row mismatch, preserves empty and null',()=>{assert.throws(()=>sqlResult({dsls:[{data:{error_message:'bad',table_head:['n'],table_body:[]}}]},10));assert.throws(()=>sqlResult({dsls:[{data:{table_head:['n'],table_body:[[1,2]]}}]},10));assert.deepEqual(sqlResult({dsls:[{data:{table_head:['n'],table_body:[]}}]},10).tables[0].rows,[]);});
test('SQL execution fails closed if definition changes during report read',async()=>{const a=sqlMock(),r=await savedSql(a,{report_id:rid}),old=a.report;a.report=async()=>{const x=await old();x.data.dsls[0].dsl_content={sql:'changed'};return x;};await assert.rejects(savedSql(a,{report_id:rid,action:'execute',expected_version:r.data.version}),e=>e.code==='VERSION_CONFLICT');});

test('ordinary report tool handles saved SQL and rejects date overrides',async()=>{const a=sqlMock();const r=await queryReportAdaptive(a,{report_id:rid,result_limit:10});assert.deepEqual(r.data.tables[0].rows,[[0,null]]);assert.equal(a.executed,1);await assert.rejects(queryReportAdaptive(a,{report_id:rid,start_date:'2026-10-10',end_date:'2026-10-10'}),e=>e.code==='UNSUPPORTED_QUERY');assert.equal(a.executed,1);});
test('project virtual user property derives unique references and clears event strategy',async()=>{const a=mock(),p=await previewChange(a,{...param,sql_rule:"concat(user_profiles.current_language,user_profiles.`current_language`, 'event_params.fake')"},'u');assert.equal(p.after.type,0);assert.equal(p.after.event_relation_strategy,'');assert.deepEqual(p.after.relation_user_profile_properties,['current_language']);assert.deepEqual(p.after.relation_event_param_properties,[]);});
test('virtual event missing description is explicit partial verification, mismatch still fails',async()=>{const {verifyReadback}=await import('../lib/datafinder/virtual.mjs');const body={name:'e',description:'d',status:1};let r=verifyReadback(body,{name:'e',status:1},'virtual_events');assert.equal(r.state,'applied_with_unverified_fields');assert.equal(r.readback_verified,false);assert.deepEqual(r.unverified_fields,['description']);assert.equal(verifyReadback(body,{name:'wrong',status:1},'virtual_events').state,'needs_review');assert.equal(verifyReadback(body,{...body,description:'wrong'},'virtual_events').state,'needs_review');assert.equal(verifyReadback(body,null,'virtual_events').state,'needs_review');});
test('explicit business rejection differs from successful submit then failed readback',async()=>{for(const submitted of [false,true]){const a=mock(),p=await previewChange(a,event,'u'),request=a.request.bind(a);let wrote=false;a.request=async(...args)=>{if(args[4]?.mutation){if(!submitted)throw Object.assign(Error('safe reason'),{code:'UPSTREAM_BUSINESS_ERROR'});wrote=true;return request(...args);}if(wrote)throw Object.assign(Error('readback failed'),{code:'UPSTREAM_BUSINESS_ERROR'});return request(...args);};assert.equal((await applyChange(a,p,'u')).state,submitted?'unknown':'rejected');}});
test('upstream business diagnostics expose only approved messages, never raw data',async()=>{for(const message of ['type can not be null','SECRET arbitrary error']){const a=new DataFinder({DATAFINDER_AK:'a',DATAFINDER_SK:'b'},async()=>Response.json({code:400,message}));await assert.rejects(a.request('POST','/openapi/v1/metadata/1000002/virtual_params',{}, {},{mutation:true}),e=>e.code==='UPSTREAM_BUSINESS_ERROR'&&e.upstream_code==='400'&&!e.message.includes('SECRET'));}});


test('event update uses vendor v1 route and verifies changed display name',async()=>{
 const a=mock();await applyChange(a,await previewChange(a,event,'u'),'u');
 const p=await previewChange(a,{kind:'virtual_events',operation:'update',name:event.name,show_name:'Changed'},'u');
 const r=await applyChange(a,p,'u');assert.equal(r.state,'applied');assert.equal(r.result.readback_verified,true);
 const call=a.calls.find(c=>c.method==='PATCH');assert.equal(call.path,'/openapi/v1/metadata/v1/1000002/virtual_events/7');assert.equal(call.body.id,7);
 assert.equal(a.items[0].show_name,'Changed');
});
test('event mutation transport allows only scoped v1 PATCH and rejects obsolete/sample routes',async()=>{
 let calls=0;const api=new DataFinder({DATAFINDER_AK:'a',DATAFINDER_SK:'b'},async(u,o)=>{calls++;assert.equal(new URL(u).pathname,'/datafinder/openapi/v1/metadata/v1/1000002/virtual_events/28838');assert.equal(o.method,'PATCH');return Response.json({code:200,data:true});});
 await api.request('PATCH','/openapi/v1/metadata/v1/1000002/virtual_events/28838',{}, {},{mutation:true});
 for(const [method,path] of [['PATCH','/openapi/v1/metadata/1000002/virtual_events/28838'],['PATCH','/openapi/v1/metadata/v1/20000827/virtual_events/234913'],['POST','/openapi/v1/metadata/v1/1000002/virtual_events/28838'],['PATCH','/openapi/v1/metadata/1000002/virtual_events']])await assert.rejects(api.request(method,path,{}, {},{mutation:true}),e=>e.code==='FORBIDDEN');
 assert.equal(calls,1);
});


test('event update description is rejected before upstream or draft writes, including empty/mixed input',async()=>{
 for(const description of ['new','']){
  const a=mock();await assert.rejects(previewChange(a,{kind:'virtual_events',operation:'update',name:event.name,show_name:'Changed',description},'u'),e=>e.code==='UNSUPPORTED_FIELD'&&e.message.includes('不支持修改虚拟事件'));
  assert.equal(a.calls.length,0);assert.equal(a.env.DB.sql.prepare('SELECT count(*) AS n FROM metadata_changes').get().n,0);
 }
});
test('legacy pending event description drafts cannot be applied or silently strip the field',async()=>{
 const a=mock();await applyChange(a,await previewChange(a,event,'u'),'u');
 const p=await previewChange(a,{kind:'virtual_events',operation:'update',name:event.name,show_name:'Changed'},'u');
 const row=await getChange(a,p.change_id,'u'),plan=JSON.parse(row.plan);plan.body.description='legacy';
 a.env.DB.sql.prepare('UPDATE metadata_changes SET plan=? WHERE id=?').run(JSON.stringify(plan),p.change_id);
 const calls=a.calls.length;await assert.rejects(applyChange(a,p,'u'),e=>e.code==='UNSUPPORTED_FIELD');assert.equal(a.calls.length,calls);assert.equal((await getChange(a,p.change_id,'u')).state,'pending');
});
test('event creation and virtual property updates retain their description contract',async()=>{
 const a=mock();const p=await previewChange(a,{...event,description:'create only'},'u');assert.equal(p.after.description,'create only');
 const b=mock();await applyChange(b,await previewChange(b,param,'u'),'u');
 const q=await previewChange(b,{kind:'virtual_params',operation:'update',name:param.name,description:'property description'},'u');assert.equal((await applyChange(b,q,'u')).state,'applied');assert.equal(b.items[0].description,'property description');
});
