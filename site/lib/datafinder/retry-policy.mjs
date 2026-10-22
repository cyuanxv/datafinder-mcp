// Only explicit transport availability failures are retryable, never ambiguous business errors.
export const transientCodes=new Set(['UPSTREAM_UNAVAILABLE','UPSTREAM_RETRYABLE','QUERY_DEADLINE']);
export function retryDecision(code,previous,now){const attempts=previous+1;return transientCodes.has(code)&&attempts<3?{retry:true,attempts,not_before:now+Math.min(300000,30000*2**previous)}:{retry:false,attempts,not_before:null};}
