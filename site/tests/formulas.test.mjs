import test from 'node:test';import assert from 'node:assert/strict';
import {parseFormula,evaluateFormula,computeFormulas} from '../lib/datafinder/formulas.mjs';
import {analysisSchema,freePlan,runAnalysis} from '../lib/datafinder/analysis.mjs';
import {DataFinder} from '../lib/datafinder/core.mjs';
const args=()=>analysisSchema.parse({events:[{event_name:'start',indicator:'event_users'},{event_name:'pay',indicator:'event_users'}],start_date:'2020-01-01',end_date:'2020-01-02',formulas:[{name:'ratio',expression:'B/A',format:'percent'}]});
const row=(i,groups)=>({query_id:`a00:p00:c00:q0${i}`,date_index_list:['20200101','20200102'],result_status:'SUCCESS',is_truncated:false,series:groups.map(([key,data])=>({group_by_key:key,event_name:i?'pay':'start',result_type:'event_users',data}))});
test('arithmetic parser honors precedence, parentheses, unary signs and rejects injection and invalid dependencies',()=>{
 assert.equal(evaluateFormula(parseFormula('-(A + .5) * 2 + B / 4',2).tree,{A:1.5,B:8}).value,-2);
 for(const f of ['A;process.exit()','Math.max(A,B)','A**2','A B','A/','(A','F','C','1','A'.repeat(101)])assert.throws(()=>parseFormula(f,2));
 assert.equal(evaluateFormula(parseFormula('A/0',1).tree,{A:1}).reason,'division_by_zero');
 assert.equal(evaluateFormula(parseFormula('A+B',2).tree,{A:0,B:null}).value,null);
});
test('formulas align query IDs and group identities rather than array position, keep zero and missing distinct',()=>{
 const a=args(),r=computeFormulas(a,[row(1,[['y',[2,4]],['x',[0,1]]]),row(0,[['x',[4,0]],['y',[4,8]],['z',[3,3]]])],true);
 const f=r.items[0];assert.equal(f.rows[0].points[0].value,0);assert.equal(f.rows[0].points[0].display,'0.00%');assert.equal(f.rows[0].points[1].reason,'division_by_zero');assert.equal(f.rows[1].points[1].value,.5);assert.equal(f.rows[2].points[0].value,null);assert.equal(r.status,'incomplete');
});
test('formulas refuse unverified source, duplicate groups, wrong metric identity and mismatched dates',()=>{
 const a=args(),valid=[row(0,[['x',[2,4]]]),row(1,[['x',[1,2]]])];assert.equal(computeFormulas(a,valid,false).items.length,0);
 for(const mutate of [r=>r[1].series.push(r[1].series[0]),r=>r[1].series[0].event_name='other',r=>r[1].date_index_list.reverse()]){const r=structuredClone(valid);mutate(r);assert.equal(computeFormulas(a,r,true).items[0].reason,'metric_or_group_identity_unverified');}
});
test('formula input constraints reject retention, reports, incomplete metric pages and duplicate names before I/O',()=>{
 const a=args();for(const p of [{kind:'retention'},{report_id:'1'},{metric_page:2},{metric_page_size:1},{formulas:[a.formulas[0],a.formulas[0]]}])assert.throws(()=>freePlan({...a,...p},true));
});
test('formula execution returns derived values and propagates division by zero as incomplete without changing upstream DSL',async()=>{
 const api=new DataFinder({DATAFINDER_AK:'test',DATAFINDER_SK:'secret',DATAFINDER_ALLOW_PROJECT_WIDE:'true'},async(_,options)=>{const d=JSON.parse(options.body);assert.ok(!JSON.stringify(d).includes('formulas'));return Response.json({code:200,data:[row(0,[['__all',[4,0]]]),row(1,[['__all',[2,1]]])].map(({series,...r})=>({...r,data_item_list:series}))});});
 const r=await runAnalysis(api,args());assert.equal(r.data.computed_formulas.items[0].rows[0].points[0].value,.5);assert.equal(r.status,'incomplete');assert.equal(r.saved_configuration_modified,false);
});
