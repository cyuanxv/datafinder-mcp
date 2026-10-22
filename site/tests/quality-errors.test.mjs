import test from 'node:test';import assert from 'node:assert/strict';
import {mcpResponse} from '../lib/datafinder/mcp.mjs';
const env={DATAFINDER_OWNER_USER_ID:'owner',DATAFINDER_AK:'test',DATAFINDER_SK:'secret',DATAFINDER_ALLOW_PROJECT_WIDE:'true'};
function request(){const name='analyze_insights';return new Request('https://site/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json','mcp-method':'tools/call','mcp-protocol-version':'2026-07-28','oai-authenticated-user-id':'owner','mcp-name':name},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:{kind:'hourly_pattern',period:{start_date:'2026-10-01',end_date:'2026-10-01'},events:[{event_name:'launch'}]},_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientInfo':{name:'test',version:'1'},'io.modelcontextprotocol/clientCapabilities':{}}}})});}
test('quality refusal keeps identical machine and text error codes without pretending success',async()=>{
 for(const code of ['INCOMPLETE_RESULT','INCONSISTENT_COUNTS']){
  const response=await mcpResponse(request(),env,async(u,o)=>{
   const d=JSON.parse(o.body),hour=d.periods[0].granularity==='hour';
   return Response.json({code:200,data:code==='INCOMPLETE_RESULT'?[]:[{query_id:'a00:p00:c00:q00',result_status:'SUCCESS',is_truncated:false,date_index_list:hour?Array.from({length:24},(_,i)=>'20261001'+String(i).padStart(2,'0')):['2026-10-01 00:00:00-2026-10-01 23:59:59'],data_item_list:[{data:hour?Array(24).fill(1):[25]}]}]});
  });const result=(await response.json()).result;
  assert.equal(result.isError,false);assert.equal(result.structuredContent.status,'incomplete');assert.equal(result.structuredContent.code,code);assert.equal(result.structuredContent.error_code,code);assert.equal(JSON.parse(result.content[0].text).code,code);assert.equal(result.structuredContent.applied,undefined);
 }
});
