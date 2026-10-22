import test from 'node:test';
import assert from 'node:assert/strict';
import {queryWorkflow} from '../lib/datafinder/query-workflow.mjs';
const definition={template:{kind:'analysis',config:{events:[{event_name:'start'}],granularity:'all',filters:[]}},start_date:'2020-01-01',end_date:'2020-01-01'};
const deps={validate:async()=>({valid:true}),trial:async()=>({persisted:false,output:{status:'success'}})};
test('preview and follow-up inherit exact time, events and granularity; execution bound to preview',async()=>{
 const p=await queryWorkflow({}, {definition},'u',deps);
 const next=await queryWorkflow({},{definition:p.definition,changes:{config:{limit:20}}},'u',deps);
 assert.equal(next.definition.start_date,definition.start_date);assert.equal(next.definition.template.config.granularity,'all');assert.equal(next.definition.template.config.limit,20);
 assert(next.changes.some(c=>c.path==='/template/config/limit'));
 await assert.rejects(queryWorkflow({},{definition:next.definition,execute:true,preview_hash:p.preview_hash},'u',deps),e=>e.code==='PREVIEW_CHANGED');
 const out=await queryWorkflow({},{definition:next.definition,execute:true,preview_hash:next.preview_hash},'u',deps);assert.equal(out.persisted,false);assert.equal(out.upstream_modified,false);
});
const metric={key:'m',revision:2,execution_guidance:{may_use_source:true},value:{name:'M',default_report_id:'12',sources:[{report_id:'12',source_version:'a'.repeat(64)}],recommendation:'ready'},source_checks:[{report_id:'12',source_type:'report',date_capability:{accepts_requested_dates:true}}]};
const bound={template:{kind:'report',config:{report_id:'12'},source_version:'a'.repeat(64)},start_date:'2020-01-01',end_date:'2020-01-01',dictionary:{key:'m',revision:2}};
test('dictionary binding rejects changed revisions, source mismatch, paused and SQL before execution',async()=>{
 for(const m of [{...metric,revision:3},{...metric,execution_guidance:{may_use_source:false}},{...metric,value:{...metric.value,default_report_id:'13'}},{...metric,source_checks:[{report_id:'12',source_type:'saved_sql'}]}]){
  await assert.rejects(queryWorkflow({},{definition:bound},'u',{...deps,dictionary:async()=>m,trial:()=>assert.fail()}));
 }
 const out=await queryWorkflow({},{definition:bound},'u',{...deps,dictionary:async(_,a,o)=>{assert.equal(o,'u');return metric;}});assert.equal(out.dictionary.revision,2);assert.match(out.scope,/不自动裁剪/);
});
test('unrecognized follow-up parameters and invalid definitions are rejected',async()=>{
 await assert.rejects(queryWorkflow({},{definition,changes:{subject:12}},'u',deps));
 await assert.rejects(queryWorkflow({},{definition,changes:{config:{bogus:true}}},'u',deps));
 await assert.rejects(queryWorkflow({},{definition,changes:{}},'u',deps));
});
import {testDB} from './db-helper.mjs';
import {queryTemplate} from '../lib/datafinder/templates.mjs';
import {localTime} from '../lib/datafinder/event-time.mjs';
test('workflow supports week range and freezes intraday cutoff across preview and run',async()=>{
 const week=await queryWorkflow({},{definition:{...definition,end_date:'2020-01-07'}},'u',deps);assert.equal(week.definition.end_date,'2020-01-07');
 const today=localTime(Date.now()/1000).slice(0,10);
 const d={...definition,start_date:today,end_date:today,template:{kind:'analysis',config:{events:[{event_name:'start'}],granularity:'hour',include_today:true}}};
 const p=await queryWorkflow({},{definition:d},'u',deps);assert.match(p.definition.template.config.end_clock,/^\d{2}:\d{2}:\d{2}$/);
 const r=await queryWorkflow({},{definition:p.definition,execute:true,preview_hash:p.preview_hash},'u',deps);assert.equal(r.definition.template.config.end_clock,p.definition.template.config.end_clock);
 await assert.rejects(queryWorkflow({},{definition:{...d,start_date:'2020-01-01'}},'u',deps),e=>e.code==='INVALID_DATE');
});
test('query context saves immutable owner-isolated versions, requires preview and prevents lost updates',async()=>{
 const DB=testDB(),api={env:{DB}},p=await queryWorkflow(api,{definition},'u',deps);
 const save={operation:'save',definition:p.definition,session_key:'work',expected_revision:0,confirmed:true,preview_hash:p.preview_hash};
 const r=await queryWorkflow(api,save,'u',deps);assert.equal(r.revision,1);assert.equal(r.readback_verified,true);
 const read=await queryWorkflow(api,{operation:'read',session_key:'work'},'u',deps);assert.deepEqual(read.value.definition,p.definition);
 await assert.rejects(queryWorkflow(api,{operation:'read',session_key:'work'},'other',deps),e=>e.code==='NOT_FOUND');
 await assert.rejects(queryWorkflow(api,save,'u',deps),e=>e.code==='VERSION_CONFLICT');
 await assert.rejects(queryWorkflow(api,{...save,expected_revision:1,definition:{...p.definition,end_date:'2020-01-02'}},'u',deps),e=>e.code==='PREVIEW_CHANGED');
 const next=await queryWorkflow(api,{definition:read.value.definition,changes:{config:{limit:30}}},'u',deps);
 await queryWorkflow(api,{...save,expected_revision:1,definition:next.definition,preview_hash:next.preview_hash},'u',deps);
 assert.equal(DB.sql.prepare("SELECT count(*) n FROM governance_records WHERE kind='query_workflow'").get().n,2);
});
test('formula templates search by name and reuse pinned revision; followups detach without altering stored formula',async()=>{
 const api={env:{DB:testDB()}},template={kind:'analysis',config:{events:[{event_name:'start',indicator:'events'},{event_name:'start'}],formulas:[{name:'平均次数',expression:'A/B'}]}};
 await queryTemplate(api,{action:'save',key:'avg',name:'平均使用次数',expected_revision:0,confirmed:true,template},'u');
 const found=await queryWorkflow(api,{operation:'templates',keyword:'平均'},'u',deps);assert.equal(found.items.length,1);
 assert.equal((await queryWorkflow(api,{operation:'templates',keyword:'不存在'},'u',deps)).items.length,0);
 assert.equal((await queryWorkflow(api,{operation:'templates'},'other',deps)).items.length,0);
 const p=await queryWorkflow(api,{definition:{template_ref:{key:'avg',revision:1},start_date:'2020-01-01',end_date:'2020-01-07'}},'u',deps);
 assert.equal(p.definition.template.config.formulas[0].expression,'A/B');
 const next=await queryWorkflow(api,{definition:p.definition,changes:{config:{limit:20}}},'u',deps);assert.equal(next.definition.template_ref,undefined);
 const read=await queryTemplate(api,{action:'read',key:'avg'},'u');assert.notEqual(read.value.config.limit,20);
 await queryTemplate(api,{action:'save',key:'avg',name:'平均使用次数',expected_revision:1,confirmed:true,template},'u');
 await assert.rejects(queryWorkflow(api,{definition:p.definition},'u',deps),e=>e.code==='VERSION_CONFLICT');
});
test('dictionary exact selector is inherited and conflicting selection is rejected',async()=>{
 const m={...metric,value:{...metric.value,sources:[{...metric.value.sources[0],metric_index:2}]}};
 const p=await queryWorkflow({},{definition:bound},'u',{...deps,dictionary:async()=>m});assert.equal(p.definition.template.config.metric_index,2);assert.match(p.scope,/第3个指标/);
 await assert.rejects(queryWorkflow({},{definition:{...bound,template:{...bound.template,config:{report_id:'12',metric_index:1}}}},'u',{...deps,dictionary:async()=>m}),e=>e.code==='METRIC_SOURCE_MISMATCH');
});
test('query records search and history are owner scoped, paginated, and preserve prior revisions',async()=>{
 const api={env:{DB:testDB()}},p=await queryWorkflow(api,{definition},'u',deps);
 const save={operation:'save',definition:p.definition,confirmed:true,preview_hash:p.preview_hash};
 for(let i=0;i<22;i++)await queryWorkflow(api,{...save,session_key:'item'+String(i).padStart(2,'0'),expected_revision:0},'u',deps);
 await queryWorkflow(api,{...save,session_key:'item00',expected_revision:1},'u',deps);
 await queryWorkflow(api,{...save,session_key:'private',expected_revision:0},'other',deps);
 const list=await queryWorkflow(api,{operation:'records'},'u',deps);
 assert.equal(list.items.length,20);assert.equal(list.has_more,true);assert.equal(list.items[0].revision,2);assert.equal(list.items[0].value,undefined);
 const page=await queryWorkflow(api,{operation:'records',page:2},'u',deps);assert.equal(page.items.length,2);assert.equal(page.has_more,false);
 assert.equal((await queryWorkflow(api,{operation:'records',keyword:'item00'},'u',deps)).items.length,1);
 assert.equal((await queryWorkflow(api,{operation:'records',keyword:'%'},'u',deps)).items.length,0);
 assert.equal((await queryWorkflow(api,{operation:'records'},'other',deps)).items.length,1);
 const history=await queryWorkflow(api,{operation:'history',session_key:'item00'},'u',deps);assert.deepEqual(history.items.map(r=>r.revision),[2,1]);
 assert.equal((await queryWorkflow(api,{operation:'history',session_key:'item00'},'other',deps)).items.length,0);
 const old=await queryWorkflow(api,{operation:'read',session_key:'item00',revision:1},'u',deps);assert.equal(old.revision,1);
 await assert.rejects(queryWorkflow(api,{...save,session_key:'item00',expected_revision:old.revision},'u',deps),e=>e.code==='VERSION_CONFLICT');
 await assert.rejects(queryWorkflow(api,{operation:'records',definition,execute:true},'u',deps));
 await assert.rejects(queryWorkflow(api,{operation:'history'},'u',deps));
 await assert.rejects(queryWorkflow(api,{operation:'read',session_key:'item00',revision:99},'u',deps),e=>e.code==='NOT_FOUND');
});
test('follow-up filters preserve event conditions, formulas and dates',async()=>{
 const f={property:{property_name:'os_name',property_type:'common_param'},operator:'=',values:['android']};
 const d={...definition,template:{kind:'analysis',config:{events:[{event_name:'start',filters:[f]}],formulas:[{name:'次数',expression:'A'}]}}};
 const p=await queryWorkflow({},{definition:d},'u',deps),next=await queryWorkflow({},{definition:p.definition,changes:{config:{filters:[f]}}},'u',deps);
 assert.deepEqual(next.definition.template.config.events,p.definition.template.config.events);assert.deepEqual(next.definition.template.config.formulas,p.definition.template.config.formulas);assert.equal(next.definition.start_date,p.definition.start_date);assert.notEqual(next.preview_hash,p.preview_hash);
 const clear=await queryWorkflow({},{definition:next.definition,changes:{config:{filters:[]}}},'u',deps);assert.deepEqual(clear.definition.template.config.filters,[]);assert.deepEqual(clear.definition.template.config.events,p.definition.template.config.events);
});
