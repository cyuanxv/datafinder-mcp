import test from 'node:test';
import assert from 'node:assert/strict';
import {allowed} from '../lib/datafinder/mcp.mjs';
import {DataFinder} from '../lib/datafinder/core.mjs';
test('missing owner cannot authorize even an authenticated header',()=>{const r=new Request('https://example.invalid',{headers:{'oai-authenticated-user-id':'owner'}});assert.equal(allowed(r,{}),false);assert.equal(allowed(r,{DATAFINDER_OWNER_USER_ID:'owner'}),true);assert.equal(allowed(r,{DATAFINDER_OWNER_USER_ID:'other'}),false);});
test('unconfigured credentials never reach upstream',async()=>{let calls=0;const a=new DataFinder({},async()=>{calls++;throw Error('unexpected');});await assert.rejects(a.request('GET','/openapi/v1/example'),e=>e.code==='CREDENTIALS_NOT_CONFIGURED');assert.equal(calls,0);});

test('export links use the configured deployment origin',async()=>{const {exportLink}=await import('../lib/datafinder/export.mjs');const {PUBLIC_BASE_URL}=await import('../lib/datafinder/scope-config.mjs');assert.equal(new URL(exportLink({kind:'inspection',id:'00000000-0000-4000-8000-000000000000',format:'csv'}).download_url).origin,PUBLIC_BASE_URL);});
