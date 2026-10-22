import test from 'node:test';import assert from 'node:assert/strict';
import {freePlan} from '../lib/datafinder/analysis.mjs';
import {groupedMetrics,compareGroups} from '../lib/datafinder/group-diagnosis.mjs';
import {runInsight} from '../lib/datafinder/insights.mjs';
import {DataFinder} from '../lib/datafinder/core.mjs';
const properties=[{property_type:'common_param',property_name:'os_name'}];
const plan=freePlan({events:[{event_name:'launch',indicator:'events'},{event_name:'launch',indicator:'event_users'}],start_date:'2026-10-01',end_date:'2026-10-02',granularity:'all',group_by:properties},true);
const raw=()=>[0,1].map(i=>({query_id:`a00:p00:c00:q0${i}`,result_status:'SUCCESS',is_truncated:false,date_index_list:['2026-10-01 00:00:00-2026-10-02 23:59:59'],data_item_list:[{common_params:{os_name:'Android'},data:[i?60:100]},{common_params:{os_name:'iOS'},data:[i?60:100]}]})).reverse();
test('overlapping users remain non-additive while event totals conserve',()=>{
 const r=groupedMetrics(raw(),plan,properties,{events:200,users:100});assert.equal(r.overlap_excess,20);assert.equal(r.overlap,'overlapping_memberships_observed');
 const compared=compareGroups(r,r,50);assert.equal(compared.uv_contribution_additive,false);assert.equal(compared.ranked_changes.length,2);
});
test('rejects truncated, missing group identity, missing UV group and count disagreement',()=>{
 for(const mutate of [r=>r[0].is_truncated=true,r=>delete r[0].data_item_list[0].common_params.os_name,r=>r[0].data_item_list.pop(),r=>r[1].data_item_list[0].data[0]++,r=>r[0].data_item_list[0].data[0]=101,r=>r[0].date_index_list=['20261001','20261002']]){const r=raw();mutate(r);assert.throws(()=>groupedMetrics(r,plan,properties,{events:200,users:100}));}
});
test('small and newly observed groups stay visible but out of ranked changes',()=>{
 const r=groupedMetrics(raw(),plan,properties,{events:200,users:100}),after=structuredClone(r);after.rows.pop();
 const x=compareGroups(r,after,50);assert.equal(x.rows.length,2);assert.equal(x.ranked_changes.length,1);assert.equal(x.rows[1].current_users,0);assert.equal(x.rows[1].sample_status,'small_sample');
});
test('full insight executes both periods with independent ungrouped totals',async()=>{
 let calls=0;const api=new DataFinder({DATAFINDER_AK:'t',DATAFINDER_SK:'t',DATAFINDER_ALLOW_PROJECT_WIDE:'true'},async(u,o)=>{
  calls++;const d=JSON.parse(o.body);assert.equal(d.content.option.refresh_cache,true);const grouped=d.content.queries[0][0].groups_v2.length>0;
  const [start,end]=d.periods[0].range,iso=t=>new Date((t+8*3600)*1000).toISOString().slice(0,10),date=`${iso(start)} 00:00:00-${iso(end)} 23:59:59`;
  const result=raw().map(r=>({...r,date_index_list:[date],data_item_list:grouped?r.data_item_list:[{group_by_key:'__all',data:[r.query_id.endsWith('0')?200:100]}]}));
  return Response.json({code:200,data:result});
 });
 const r=await runInsight(api,{kind:'group_diagnosis',period:{start_date:'2026-10-03',end_date:'2026-10-04'},baseline:{start_date:'2026-10-01',end_date:'2026-10-02'},events:[{event_name:'launch'}],group_by:properties,minimum_users:50});
 assert.equal(calls,4);assert.equal(r.data.current_total.users,100);assert.equal(r.data.current_overlap,'overlapping_memberships_observed');assert.equal(r.data.ranked_changes.length,2);
});
