import test from 'node:test';
import assert from 'node:assert/strict';
import {compareFunnels} from '../lib/datafinder/funnel-comparison.mjs';
const steps = counts => counts.map((users, i) => ({step:i+1,event_name:`event_${i}`,users}));
test('separates falling conversion from growing lost-user volume', () => {
  const result = compareFunnels(steps([100,50,40]), steps([200,80,60]), 50);
  assert.ok(Math.abs(result.transitions[0].percentage_point_change + 10) < 1e-10);
  assert.equal(result.transitions[0].lost_users_change,70);
  assert.deepEqual(result.declining_steps.map(s=>s.to_step),[2,3]);
});
test('zero denominators remain unknown and small cohorts are excluded from ranking', () => {
  const result=compareFunnels(steps([100,10,0]),steps([100,0,0]),50);
  assert.equal(result.transitions[1].percentage_point_change,null);
  assert.equal(result.declining_steps.length,1);
  assert.equal(compareFunnels(steps([10,8]),steps([10,1]),50).declining_steps.length,0);
});
test('rejects different event filters, invalid counts and reordered steps', () => {
  for(const mutate of [s=>s[1].event_name='other',s=>s[1].filters=[{x:1}],s=>s[1].users=101,s=>s[0].users=null,s=>s.reverse()]) {
    const current=steps([100,50]);mutate(current);
    assert.throws(()=>compareFunnels(steps([100,50]),current,10));
  }
});
