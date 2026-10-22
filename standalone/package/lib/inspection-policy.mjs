import {z} from 'zod/v4';
export const inspectionPolicy=z.object({metric:z.enum(['missing_rate','invalid_rate_among_nonempty','events','users']),event_name:z.string().min(1).optional(),minimum_sample:z.number().int().min(1).max(1000000000).default(100),minimum:z.number().finite().optional(),maximum:z.number().finite().optional(),relative_change:z.number().positive().max(100).optional(),consecutive:z.number().int().min(1).max(10).default(1),recovery_consecutive:z.number().int().min(1).max(10).default(1)}).strict().refine(p=>p.minimum!==undefined||p.maximum!==undefined||p.relative_change!==undefined,'至少配置一个判断条件').refine(p=>p.minimum===undefined||p.maximum===undefined||p.minimum<=p.maximum,'下限不能超过上限');
export function measurement(item,p){
 if(item.status!=='success')return null;
 if(item.kind==='quality'){if(item.data?.status!=='measured')return null;const value=item.data[p.metric],denominator=p.metric==='invalid_rate_among_nonempty'?item.data.nonempty_events:item.data.total_events;return Number.isFinite(value)&&Number.isFinite(denominator)?{value,denominator,unit:'ratio'}:null;}
 const e=item.data?.items?.find(x=>x.event_name===p.event_name);const value=e?.[p.metric]?.current;return Number.isFinite(value)?{value,denominator:value,unit:'count',baseline:e[p.metric].baseline_mean}:null;
}
const day=s=>Date.parse(s+'T00:00:00Z');
export function evaluatePolicy(item,p,range,history){
 const m=measurement(item,p),unknown=reason=>({state:'unknown',reasons:[reason],measurement:m,policy:p,raw_condition:null});
 if(!m||m.denominator<p.minimum_sample)return unknown('insufficient_sample');
 const span=day(range.end_date)-day(range.start_date)+86400000;
 const previous=history.find(x=>day(x.end_date)===day(range.start_date)-86400000&&day(x.end_date)-day(x.start_date)+86400000===span);
 const baseline=previous?.measurement?.value;let change=null;
 if(p.relative_change!==undefined){if(!Number.isFinite(baseline)||baseline===0||previous.measurement.denominator<p.minimum_sample)return unknown('insufficient_previous_period');change=(m.value-baseline)/Math.abs(baseline);}
 const reasons=[];if(p.minimum!==undefined&&m.value<p.minimum)reasons.push('below_minimum');if(p.maximum!==undefined&&m.value>p.maximum)reasons.push('above_maximum');if(p.relative_change!==undefined&&Math.abs(change)>=p.relative_change)reasons.push('relative_change');
 const bad=!!reasons.length,need=bad?p.consecutive:p.recovery_consecutive;let streak=1,end=day(range.start_date)-86400000;
 for(let i=0;i<need-1;i++){const prev=history.find(x=>day(x.end_date)===end&&day(x.end_date)-day(x.start_date)+86400000===span);if(!prev||prev.raw_condition!==bad)break;streak++;end=day(prev.start_date)-86400000;}
 return {state:streak<need?'unknown':bad?'business_anomaly':'normal',reasons:streak<need?['pending_consecutive']:reasons,raw_condition:bad,measurement:m,previous_value:baseline??null,relative_change:change,streak,required_streak:need,policy:p};
}
