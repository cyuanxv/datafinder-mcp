import test from 'node:test';
import assert from 'node:assert/strict';
import {filterSchema,expression,filterLeaves,freePlan,applyModifiers} from '../lib/datafinder/analysis.mjs';
import {advancedPlan} from '../lib/datafinder/advanced.mjs';
import {funnelPlan} from '../lib/datafinder/funnel.mjs';
import {checkedMapping,inspectMapping} from '../lib/datafinder/tracking-mapping.mjs';
import {runDistribution} from '../lib/datafinder/distribution.mjs';
import {compareVersions} from '../lib/datafinder/regression.mjs';
const leaf=(name,value,type='common_param')=>({property:{property_name:name,property_type:type},operator:'=',values:[value]});
const os=leaf('os','ios'),channel=leaf('channel','paid'),country=leaf('country','US');
const tree={logic:'or',conditions:[{logic:'and',conditions:[os,country]},channel]};
const dates={start_date:'2026-10-01',end_date:'2026-10-02'};
function evaluate(e,row){const terms=[...(e.conditions??[]).map(c=>row[c.property_name]===c.property_values[0]),...(e.expressions??[]).map(x=>evaluate(x,row))];return e.logic==='and'?terms.every(Boolean):terms.some(Boolean);}
test('nested OR preserves precedence and AND outer constraints across truth table',()=>{
 const compiled=expression([filterSchema.parse(tree),filterSchema.parse(leaf('version','3'))]);
 for(const os of ['ios','android'])for(const country of ['US','CN'])for(const channel of ['paid','organic'])for(const version of ['2','3'])assert.equal(evaluate(compiled,{os,country,channel,version}),((os==='ios'&&country==='US')||channel==='paid')&&version==='3');
 assert.equal(filterLeaves([tree]).length,3);
 const check=e=>{assert.ok(!(e.conditions&&e.expressions),'native endpoint must never receive mixed child structures');for(const child of e.expressions??[])check(child);};check(compiled);
});
test('empty unknown deep and sensitive branches are rejected',()=>{for(const value of [{logic:'or',conditions:[]},{logic:'xor',conditions:[os]},{logic:'and',conditions:[tree]},{logic:'or',conditions:[leaf('user_id','x')]},{...tree,ignored:true}])assert.equal(filterSchema.safeParse(value).success,false);});
test('legacy filter DSL is byte compatible and source groups stay separate',()=>{
 assert.deepEqual(expression([filterSchema.parse(os)]),{logic:'and',conditions:[{property_name:'os',property_type:'common_param',property_compose_type:'origin',property_operation:'=',property_values:['ios']}]});
 const source={content:{queries:[[{event_name:'e'}]],profile_filters:[{show_label:'a',expression:expression([os])},{show_label:'b',expression:expression([channel])}]}};
 const copy=structuredClone(source),changed=applyModifiers(source,[tree],[]);assert.deepEqual(source,copy);assert.equal(changed.content.profile_filters.length,2);for(let i=0;i<2;i++)assert.deepEqual(changed.content.profile_filters[i].expression.expressions[0],source.content.profile_filters[i].expression);
});
test('event retention funnel and advanced preserve global and per-event groups',()=>{
 const event={event_name:'launch',filters:[tree]};
 const eventPlan=freePlan({...dates,events:[event],filters:[tree]},true);
 const retention=freePlan({...dates,kind:'retention',initial_event:event,return_event:event,filters:[tree]},true);
 const funnel=funnelPlan({...dates,steps:[event,event],filters:[tree]},true);
 const advanced=advancedPlan({...dates,kind:'attribution',events:[event,event],filters:[tree]},true);
 for(const p of [eventPlan,retention,funnel,advanced]){assert.equal(p.dsl.content.profile_filters[0].expression.expressions[0].logic,'or');assert.equal(p.dsl.content.queries[0][0].filters[0].expression.expressions[0].logic,'or');}
});
test('mapping validates every nested property declaration and type',async()=>{
 const definition={name:'test',meaning:'test',implementation_status:'live',effective_from:'2026-10-01',events:[{event_name:'launch',filters:[tree]}],properties:[os,channel,country].map(f=>({property:f.property,value_type:'string'})),sources:[{document:'spec',sheet:'s',range:'A1',sha256:'a'.repeat(64)}]};
 assert.throws(()=>checkedMapping({...definition,properties:definition.properties.slice(1)}),e=>e.code==='INVALID_ARGUMENT');
 const api={async request(_,path){return {data:path.endsWith('/events')?[{name:'launch'}]:[os,channel,country].map(f=>({name:f.property.property_name,type:2,value_type:'string'}))};}};
 await inspectMapping(api,definition);await assert.rejects(inspectMapping(api,{...definition,events:[{event_name:'launch',filters:[{logic:'or',conditions:[leaf('os',1)]}]}]}),e=>e.code==='PROPERTY_TYPE_MISMATCH');
});
test('composition rejects nested event attributes and version guard detects nested version filter before I/O',async()=>{
 let calls=0;const api={request(){calls++;throw Error('unexpected');}};
 await assert.rejects(runDistribution(api,{...dates,kind:'composition',property:{property_name:'country',property_type:'user_profile'},filters:[tree]}),e=>e.code==='INVALID_ARGUMENT');
 await assert.rejects(compareVersions(api,{...dates,version_property:os.property,old_version:'ios',new_version:'android',controls:[tree],events:[{event_name:'launch'}]}),e=>e.code==='INVALID_ARGUMENT');assert.equal(calls,0);
});

import {parseAdvanced} from '../lib/datafinder/advanced.mjs';
test('path inclusion is opt-in, rejects irrelevant kinds, and remains semantically unverified',()=>{
 const input={...dates,kind:'path',events:[{event_name:'launch'},{event_name:'pay'}]};
 assert.equal(advancedPlan(input,true).dsl.content.option.hide_unselected,true);
 const p=advancedPlan({...input,path_include_unselected:true},true);assert.equal(p.dsl.content.option.hide_unselected,false);
 const r={query_id:'a00:p00:c00:q00',result_status:'SUCCESS',is_truncated:false,date_index_list:[],events:{0:{event_name:'launch'},1:{event_name:'other'}},data_item_list:[{event_show_name:'launch',data:[[0,0,1,2]]}]};
 assert.throws(()=>parseAdvanced([r],advancedPlan(input,true)));const out=parseAdvanced([r],p);assert.equal(out.validation,'incomplete');assert.equal(out.include_unselected,true);assert.match(out.semantic_validation,/pending/);
 assert.throws(()=>advancedPlan({...input,kind:'attribution',path_include_unselected:false},true));
});
test('numeric distribution places exact bounds on the requested side and keeps legacy default',async()=>{
 for(const closure of [undefined,'left_closed','right_closed']){
 const values=[null,-1,0,1,10,11];
 const api={env:{DATAFINDER_ALLOW_PROJECT_WIDE:'true'},output:(r,o)=>({...r,...o}),async request(_,path,dsl){
  if(path.includes('/list/'))return {data:[{name:'amount',type:1,value_type:'float'}]};
  const data=dsl.content.queries.map((qs,i)=>{const cs=qs[0].filters[0]?.expression.conditions??[];const n=values.filter(v=>cs.every(c=>{const x=c.property_values[0];switch(c.property_operation){case 'is_null':return v===null;case 'is_not_null':return v!==null;case '>':return v>x;case '>=':return v>=x;case '<':return v<x;case '<=':return v<=x;default:throw Error('unexpected');}})).length;
  return {query_id:'a00:p00:c00:q'+String(i).padStart(2,'0'),result_status:'SUCCESS',is_truncated:false,date_index_list:['2026-10-01 00:00:00-2026-10-02 23:59:59'],data_item_list:[{data:[n]}]};});return {data};}};
 const result=await runDistribution(api,{...dates,kind:'numeric_event_distribution',event:{event_name:'pay'},property:{property_name:'amount',property_type:'event_param'},boundaries:[0,10],...(closure?{interval_closure:closure}:{})});
 assert.deepEqual(result.data.rows.map(x=>x.events),closure==='right_closed'?[2,2,1]:[1,2,2]);assert.equal(result.data.null_events,1);assert.equal(result.data.total_events,6);
 }
 await assert.rejects(runDistribution({}, {...dates,kind:'composition',interval_closure:'right_closed'}),e=>e.code==='INVALID_ARGUMENT');
});
