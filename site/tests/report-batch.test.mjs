import {testReportIds} from './fixture-ids.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {DataFinder,REPORTS,DASHBOARD,sign} from '../lib/datafinder/core.mjs';
import {metricDefinition,definitionHash} from '../lib/datafinder/definitions.mjs';
import {dashboardView} from '../lib/datafinder/dashboard.mjs';
import {reportDatePlan,expectedDays,verifyReportResults,reportQuality,querySavedReport} from '../lib/datafinder/query.mjs';
import {mcpResponse} from '../lib/datafinder/mcp.mjs';
const id=testReportIds[0];
const env={DATAFINDER_OWNER_USER_ID:'owner',DATAFINDER_AK:'test-ak',DATAFINDER_SK:'test-secret'};
function fixture(){return {report_name:'不能按名称推断的率',dsls:[{dsl_content:{app_ids:[1000002],periods:[{type:'past_range',granularity:'day',timezone:'Asia/Shanghai'}],content:{query_type:'event',page:{limit:5000},profile_filters:[],queries:[[{show_label:'A',event_name:'visit',event_indicator:'event_users'}],[{show_label:'B',event_name:'start',event_indicator:'event_users'}],[{show_label:'C',formula:'A/B',combination_format:'percent_decimal'}]],option:{analysis_subject:{}}}},data:[{query_id:'daily',result_status:'SUCCESS',date_index_list:['20260930'],data_item_list:[{item_key:'a',show_label:'A',data:[2]},{item_key:'b',show_label:'B',data:[4]},{item_key:'c',show_label:'C',data:[0.5],sum:0.5,avg:0.5}]}]}]};}
const normalized=()=>[{query_id:'daily',result_status:'SUCCESS',date_index_list:['20261001','20261002'],series:[{item_key:'a',data:[1,2]}]}];
const range=reportDatePlan('2026-10-01','2026-10-02').range;
function apiFor(postTransform=x=>x){const calls=[];const api=new DataFinder(env,async(url,init)=>{calls.push({url,init});let data=fixture();if(init.method==='POST'){data.dsls[0].dsl_content.content.page.limit=1000;data.dsls[0].data[0].date_index_list=['20261001','20261002'];for(const s of data.dsls[0].data[0].data_item_list)s.data=[...s.data,...s.data];data=postTransform(data);}return Response.json({code:200,data});});return {api,calls};}

test('signature includes canonical count query and matches independent Python HMAC',async()=>{
 const py=`import hmac,hashlib\np='ak-v1/test-ak/1700000000/300'\nk=hmac.new(b'test-secret',p.encode(),hashlib.sha256).hexdigest()\nc='HTTPMethod:POST\\nCanonicalURI:/datafinder/openapi/v1/1000002/reports/1\\nCanonicalQueryString:count=1000\\nCanonicalBody:{}'\nprint(p+'/'+hmac.new(k.encode(),c.encode(),hashlib.sha256).hexdigest())`;
 assert.equal(await sign('test-ak','test-secret','POST','/datafinder/openapi/v1/1000002/reports/1','{}',1700000000,'count=1000'),execFileSync('python3',['-c',py],{encoding:'utf8'}).trim());
});
test('date plan covers single day and 31 days, rejects incomplete or 32-day ranges',()=>{
 assert.equal(reportDatePlan(),null);assert.throws(()=>reportDatePlan('2026-10-01'),e=>e.code==='INVALID_DATE');
 const p=reportDatePlan('2026-10-01','2026-10-01');assert.deepEqual(p.body.global_filter.period.range,[1790784000,1790870399]);
 assert.equal(expectedDays(reportDatePlan('2026-09-01','2026-10-01').range).length,31);
 assert.throws(()=>reportDatePlan('2026-09-01','2026-10-02'),e=>e.code==='INVALID_DATE');
});
test('saved definition resolves ratio dependencies and explicitly describes UV identity',async()=>{
 const d=await metricDefinition(fixture(),id);const ratio=d.metrics.find(m=>m.kind==='formula');
 assert.equal(ratio.numerator.event_name,'visit');assert.equal(ratio.denominator.event_name,'start');assert.equal(ratio.unit,'ratio');
 assert.match(ratio.denominator.identity_rule,/区间汇总整段去重/);assert.deepEqual(d.event_dependencies,['start','visit']);assert.equal(d.definition_status,'saved_configuration_not_business_approved');
});
test('title containing rate never invents a formula and unsupported expression stays uninterpreted',async()=>{
 const f=fixture();f.dsls[0].dsl_content.content.queries.pop();let d=await metricDefinition(f,id);assert.ok(!d.metrics.some(m=>m.kind==='formula'));assert.ok(d.warnings.some(w=>w.includes('没有保存组合公式')));
 f.dsls[0].dsl_content.content.queries.push([{show_label:'D',formula:'(A+B)/B'}]);d=await metricDefinition(f,id);assert.equal(d.metrics.at(-1).formula_interpretation,'raw_formula_only');assert.equal(d.metrics.at(-1).numerator,null);
});
test('definition hash is key-order independent, excludes pagination, detects metric changes',async()=>{
 const a=fixture().dsls[0].dsl_content,b=structuredClone(a);b.content.page.limit=1000;
 assert.equal(await definitionHash(a),await definitionHash(b));b.content.queries[0][0].event_indicator='events';assert.notEqual(await definitionHash(a),await definitionHash(b));
 const c=Object.fromEntries(Object.entries(a).reverse());assert.equal(await definitionHash(a),await definitionHash(c));
});
test('retention definition distinguishes initial and return event and cohort filtering',async()=>{
 const f=fixture(),c=f.dsls[0].dsl_content.content;c.query_type='retention';c.queries=[[{event_name:'first',event_indicator:'event_users',extra:{query_name:'new'}},{event_name:'return',event_indicator:'event_users'}]];c.profile_filters=[{condition:'and',filters:[]}];c.option={retention_target:'[2,30]',lost:false};
 const d=await metricDefinition(f,id);assert.equal(d.metrics[0].initial_event.event_name,'first');assert.equal(d.metrics[0].return_event.event_name,'return');assert.equal(d.metrics[0].retention_target,'[2,30]');assert.equal(d.cohort_filters.length,1);
});
test('query uses official POST global_filter, signed count, native formula and unchanged saved period',async()=>{
 const {api,calls}=apiFor();const out=await querySavedReport(api,id,'2026-10-01','2026-10-02');
 assert.equal(calls.length,2);assert.equal(calls[1].init.method,'POST');assert.ok(calls[1].url.endsWith('?count=1000'));
 assert.deepEqual(JSON.parse(calls[1].init.body),reportDatePlan('2026-10-01','2026-10-02').body);
 assert.equal(out.status,'success');assert.equal(out.time_range_verified,true);assert.equal(out.formula_source,'native_report_result');assert.deepEqual(out.data.results[0].series[2].data,[0.5,0.5]);assert.equal(out.data.periods[0].type,'past_range');assert.equal(out.resolved_time_range.start_date,'2026-10-01');
 assert.equal(out.data.results[0].series[2].sum,undefined);
});
test('query without explicit dates keeps one saved-report GET and does not claim date override verification',async()=>{
 const {api,calls}=apiFor();const out=await querySavedReport(api,id);assert.equal(calls.length,1);assert.equal(out.query_method,'saved_report_get');assert.equal(out.time_range_verified,false);
});
test('invalid report or dates never reach the upstream',async()=>{
 const {api,calls}=apiFor();await assert.rejects(querySavedReport(api,'9','2026-10-01','2026-10-02'));await assert.rejects(querySavedReport(api,id,'2026-10-01'));assert.equal(calls.length,0);
});
test('upstream ignores global_filter: output is incomplete and dates are not verified',async()=>{
 const {api}=apiFor(d=>{d.dsls[0].data[0].date_index_list=['20260930'];return d;});const out=await querySavedReport(api,id,'2026-10-01','2026-10-02');assert.equal(out.status,'incomplete');assert.equal(out.time_range_verified,false);assert.ok(out.validation.issues.some(i=>i.code==='DATE_RANGE_MISMATCH'));
});
test('upstream changed metric definition is rejected',async()=>{
 const {api}=apiFor(d=>{d.dsls[0].dsl_content.content.queries[0][0].event_name='different';return d;});await assert.rejects(querySavedReport(api,id,'2026-10-01','2026-10-02'),e=>e.code==='DEFINITION_CHANGED');
});
test('zero denominators produce null while true zero numerators remain zero',async()=>{
 const {api}=apiFor(d=>{const s=d.dsls[0].data[0].data_item_list;s[0].data=[2,0];s[1].data=[0,4];s[2].data=[0,0];return d;});const out=await querySavedReport(api,id,'2026-10-01','2026-10-02');assert.deepEqual(out.data.results[0].series[2].data,[null,0]);assert.equal(out.data.zero_denominators.length,1);assert.equal(out.data.zero_denominators[0].upstream_value,0);assert.equal(out.status,'success');assert.equal(out.subquery_status.length,1);
});
test('subqueries match stable IDs independent of order and whole-period UV is not summed',()=>{
 const rows=[...normalized(),{query_id:'all',result_status:'SUCCESS',date_index_list:['2026-10-01 00:00:00-2026-10-02 23:59:59'],series:[{item_key:'a',data:[2]}]}];assert.equal(verifyReportResults(rows.toReversed(),rows,range).status,'verified');
 const broken=structuredClone(rows);broken[1].date_index_list=['2026-10-01 00:00:00-2026-10-03 23:59:59'];assert.equal(verifyReportResults(broken,rows,range).time_range_verified,false);
});
test('missing subquery, duplicate ID, missing series and length mismatch are detected',()=>{
 const r=normalized(),ref=[...r,{...r[0],query_id:'all'}];assert.ok(verifyReportResults(r,ref,range).issues.some(i=>i.code==='MISSING_SUBQUERY'));
 assert.ok(verifyReportResults([...r,...r],r,range).issues.some(i=>i.code==='DUPLICATE_OR_MISSING_QUERY_ID'));
 const noSeries=structuredClone(r);noSeries[0].series=[];assert.ok(verifyReportResults(noSeries,r,range).issues.some(i=>i.code==='MISSING_SERIES'));
 const short=structuredClone(r);short[0].series[0].data=[1];assert.ok(verifyReportResults(short,r,range).issues.some(i=>i.code==='SERIES_LENGTH_MISMATCH'));
});
test('HTTP success cannot hide running or failed subquery',async()=>{
 for(const status of ['RUNNING','FAILED']){const {api}=apiFor(d=>{d.dsls[0].data[0].result_status=status;return d;});const out=await querySavedReport(api,id,'2026-10-01','2026-10-02');assert.equal(out.time_range_verified,false);assert.equal(out.status,status==='FAILED'?'partial_failure':'incomplete');}
});
test('quality uses explicit evidence; zero or absent sampling is unknown and result time is not a watermark',()=>{
 const d={query_type:'event'};assert.equal(reportQuality([{sample:[{sample_ratio:0}]}],d).sampling,'unknown');assert.equal(reportQuality([{sample:[{sample_ratio:0.5}],is_truncated:true,result_time:1790784000000}],d).sampling,'sampled');
 const q=reportQuality([{sample:[{sample_ratio:1}],is_truncated:false,result_time:1790784000000}],d);assert.equal(q.sampling,'not_sampled');assert.equal(q.truncated,false);assert.equal(q.data_freshness.status,'unknown');assert.equal(q.data_freshness.latest_result_at,'2026-09-30T16:00:00.000Z');assert.equal(reportQuality([{}],d).truncated,'unknown');
});
test('retention maturity uses returned headers and never fills missing cells with zero',()=>{
 const r={query_id:'r',date_index_list:['20261011'],header_list:['次日','第3日'],series:[{details:[['20261011',4,[1,0.25]]]}]};const before=structuredClone(r);const q=reportQuality([r],{query_type:'retention'},Date.parse('2026-10-13T05:00:00+08:00'));assert.equal(q.retention_maturity[0].cohorts[0].last_calendar_complete_day,2);assert.deepEqual(q.retention_maturity[0].windows.map(w=>w.day),[2,3]);assert.deepEqual(r,before);
});
test('retention incomplete windows are valid but missing or misordered cohort rows are not',()=>{
 const rows=[{query_id:'r',result_status:'SUCCESS',date_index_list:['20261001','20261002'],header_list:['次日','第3日'],series:[{item_key:'a',data:null,details:[['20261001',4,[1,0.25]],['20261002',2]]}]}];assert.equal(verifyReportResults(rows,rows,range).status,'verified');
 const bad=structuredClone(rows);bad[0].series[0].details.pop();assert.ok(verifyReportResults(bad,rows,range).issues.some(i=>i.code==='RETENTION_COHORT_MISMATCH'));
});
test('explicit truncation is incomplete and malformed calendar dates have a useful error',()=>{
 const rows=normalized();rows[0].is_truncated=true;assert.ok(verifyReportResults(rows,rows,range).issues.some(i=>i.code==='RESULT_TRUNCATED'));
 assert.throws(()=>reportDatePlan('2026-13-01','2026-13-02'),e=>e.code==='INVALID_DATE');
});
test('full output including quality metadata is bounded and redacted',()=>{
 const api=new DataFinder(env);assert.throws(()=>api.output({data:{}},{notes:'x'.repeat(100000)}),e=>e.code==='RESULT_TOO_LARGE');assert.equal(api.output({data:{}},{notes:'test-secret'}).notes,'[REDACTED]');
});
test('dashboard separates associations from page charts without a report allowlist',()=>{
 const ids=testReportIds;const d={[DASHBOARD]:{dashboard_id:DASHBOARD,name:'游戏KPI',page_config:{children:ids.map(componentId=>({componentName:'Report',componentId})),props:{layout:ids.map(i=>({i,x:0,y:1,w:2,h:3}))}}}};
 const a={[DASHBOARD]:{reports:[...ids.map(report_id=>({report_id})),...Array.from({length:13},(_,i)=>({report_id:`private-${i}`,report_name:'secret'}))],total:20,available:20,denied:0}};
 const v=dashboardView(d,a);assert.equal(v.page_report_count,7);assert.equal(v.association.total,20);assert.equal(v.association.page_match_count,7);assert.equal(v.associated_reports.length,20);assert.equal(v.layout.length,7);assert.ok(JSON.stringify(v).includes('private-'));assert.throws(()=>dashboardView({},a));
});
test('MCP exposes dates and returns validated report over modern protocol',async()=>{
 const meta={'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientInfo':{name:'test',version:'1'},'io.modelcontextprotocol/clientCapabilities':{}};
 const request=(method,params)=>new Request('https://site/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json','mcp-method':method,'mcp-protocol-version':'2026-07-28','oai-authenticated-user-id':'owner',...(method==='tools/call'?{'mcp-name':params.name}:{})},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params:{...params,_meta:meta}})});
 const {api}=apiFor();const list=await (await mcpResponse(request('tools/list',{}),env,api.fetcher)).json();const schema=list.result.tools.find(t=>t.name==='query_report').inputSchema;assert.ok(schema.properties.start_date);assert.ok(schema.properties.end_date);
 const result=await (await mcpResponse(request('tools/call',{name:'query_report',arguments:{report_id:id,start_date:'2026-10-01',end_date:'2026-10-02'}}),env,api.fetcher)).json();assert.equal(result.result.isError,undefined);assert.equal(result.result.structuredContent.time_range_verified,true);
});
test('native single metric selection uses explicit item identity before pagination and keeps native formula values',async()=>{
 const {api}=apiFor(d=>{d.dsls[0].data[0].data_item_list.forEach((s,i)=>s.item_key=`a00:p00:c00:q0${i}:f00_0`);d.dsls[0].data[0].data_item_list.reverse();return d;});
 const r=await querySavedReport(api,id,'2026-10-01','2026-10-02',1,1,100,2);
 assert.equal(r.data.selected_metric_index,2);assert.equal(r.data.results[0].series.length,1);assert.equal(r.data.results[0].series[0].show_label,'C');assert.deepEqual(r.data.results[0].series[0].data,[0.5,0.5]);assert.equal(r.saved_configuration_modified,false);
 const bad=apiFor().api;await assert.rejects(querySavedReport(bad,id,'2026-10-01','2026-10-02',1,5,100,0),e=>e.code==='UNVERIFIED_CONTRACT');
 await assert.rejects(querySavedReport(api,id,'2026-10-01','2026-10-02',1,5,100,3),e=>e.code==='INVALID_PAGE');
});
