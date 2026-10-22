import test from 'node:test';import assert from 'node:assert/strict';
import {DataFinder} from '../lib/datafinder/core.mjs';
import {readTags} from '../lib/datafinder/catalog-extras.mjs';
const env={DATAFINDER_AK:'test',DATAFINDER_SK:'secret'};
const path='/openApi/v2/cdpMeta/labelSystem/label/list';
test('documented V2 fallback uses fixed host, tenant and strips values/files/SQL',async()=>{
 const calls=[];const api=new DataFinder(env,async(url,options)=>{calls.push({url,options});return Response.json(url.includes('/profile_platform/')?{code:0,data:[{projectId:1000001,id:1,name:'tier',descr:'test',dataTypeName:'string',users:['private'],sql:'private',downloadUrl:'private'}]}:{code:403,message:'disabled'});});
 const r=await readTags(api,{});assert.equal(r.status,'success');assert.equal(calls.length,2);assert.equal(calls[1].options.headers['X-Tenant'],'1000001');assert.equal(calls[1].url,'https://analytics.volcengineapi.com/profile_platform'+path);assert.equal(calls[1].options.redirect,'manual');assert.ok(!JSON.stringify(r).includes('private'));assert.equal(r.creation_verified,false);
});
test('all route failures are incomplete evidence, not an empty directory',async()=>{
 const api=new DataFinder(env,async()=>Response.json({code:403,message:'no permission'}));const r=await readTags(api,{});assert.equal(r.status,'incomplete');assert.equal(r.data.items,null);assert.equal(r.data.attempts.length,3);assert.ok(r.data.attempts.every(x=>x.upstream_code==='403'));
});
test('V2 transport cannot mutate, supply arbitrary tenant params or list other resources',async()=>{
 let calls=0;const api=new DataFinder(env,async()=>{calls++;return Response.json({code:0,data:[]});});
 for(const [method,p,body,params] of [['POST',path,{},{}],['GET',path+'/users',undefined,{}],['GET',path,undefined,{tenant:1}],['GET',path,{},{}]])await assert.rejects(api.request(method,p,body,params,{service:'tag_v2_finder'}),e=>e.code==='FORBIDDEN');
 assert.equal(calls,0);
});
test('cross-project V2 response fails closed instead of trying another route',async()=>{
 let calls=0;const api=new DataFinder(env,async()=>{calls++;return Response.json(calls===1?{code:403}:{code:0,data:[{projectId:1,id:1,name:'wrong'}]});});await assert.rejects(readTags(api,{}),e=>e.code==='OUT_OF_SCOPE');assert.equal(calls,2);
});

test('HTTP failures retain numeric status but never upstream bodies or credentials',async()=>{
 const api=new DataFinder(env,async(url)=>url.includes('/datatag/')?Response.json({code:500}):new Response('private upstream body secret',{status:url.includes('/profile_platform/')?404:403}));
 const r=await readTags(api,{});assert.deepEqual(r.data.attempts.map(x=>x.http_status),[200,404,403]);assert.equal(r.data.attempts[0].upstream_code,'500');assert.ok(!JSON.stringify(r).includes('private upstream body'));assert.ok(!JSON.stringify(r).includes('secret'));
});

test('tag failures preserve validated header log IDs for vendor investigation',async()=>{
 let n=0;const api=new DataFinder(env,async()=>{n++;return n===1?Response.json({code:500},{headers:{'x-tt-logid':'20261019ABC'}}):new Response('private',{status:404,headers:{'x-tt-logid':'20261019DEF'}});});
 const r=await readTags(api,{});assert.deepEqual(r.log_ids,['20261019ABC','20261019DEF']);assert.deepEqual(r.data.attempts.map(x=>x.log_id),['20261019ABC','20261019DEF','20261019DEF']);assert.equal(r.data.attempts[0].http_status,200);
});
test('header log IDs are available on success and reject arbitrary text or secrets',async()=>{
 for(const [header,expected] of [['20261019ABC','20261019ABC'],['invalid value',''],['secret','']]){const api=new DataFinder(env,async()=>Response.json({code:200,data:[]},{headers:{'x-tt-logid':header}}));assert.equal((await api.request('POST','/openapi/v1/metadata/1000002/list/user_profiles',{})).log_id,expected);}
});
