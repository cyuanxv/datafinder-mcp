import {QueryError} from './core.mjs';

// Aggregate step counts support descriptive comparisons, not user-level causality.
export function compareFunnels(before, after, minimumUsers) {
  if (!Number.isSafeInteger(minimumUsers) || minimumUsers < 1 || !Array.isArray(before) || !Array.isArray(after) || before.length < 2 || before.length !== after.length)
    throw new QueryError('INCOMPARABLE_DEFINITION', '漏斗步骤或样本阈值无效。');
  for (const steps of [before, after]) for (const [i, step] of steps.entries()) {
    if (step.step !== i + 1 || !Number.isSafeInteger(step.users) || step.users < 0 || (i && step.users > steps[i - 1].users))
      throw new QueryError('INCONSISTENT_COUNTS', '漏斗人数或步骤顺序无法核验。');
  }
  const identity = s => JSON.stringify([s.step, s.event_name, s.event_type ?? 'origin', s.filters ?? []]);
  if (before.some((s, i) => identity(s) !== identity(after[i])))
    throw new QueryError('INCOMPARABLE_DEFINITION', '两个周期的漏斗事件或步骤筛选不同。');
  const transitions = after.slice(1).map((step, i) => {
    const b = before[i].users, c = after[i].users;
    const br = b ? before[i + 1].users / b : null, cr = c ? step.users / c : null;
    return {
      from_step: i + 1, to_step: i + 2, from_event: after[i].event_name, to_event: step.event_name,
      baseline_eligible_users: b, current_eligible_users: c,
      baseline_converted_users: before[i + 1].users, current_converted_users: step.users,
      baseline_conversion_rate: br, current_conversion_rate: cr,
      percentage_point_change: br === null || cr === null ? null : (cr - br) * 100,
      lost_users_change: (c - step.users) - (b - before[i + 1].users),
      sample_status: Math.min(b, c) < minimumUsers ? 'small_sample' : 'sufficient_for_descriptive_review',
    };
  });
  return {
    transitions,
    declining_steps: transitions.filter(s => s.percentage_point_change !== null && s.percentage_point_change < 0 && s.sample_status !== 'small_sample').sort((a, b) => a.percentage_point_change - b.percentage_point_change),
    interpretation: '同一步骤的条件转化率变化；排序排除小样本和零分母，不代表统计显著或因果，不把各步骤损失变化相加作为独立贡献。',
  };
}
