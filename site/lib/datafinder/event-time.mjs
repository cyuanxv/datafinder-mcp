import {QueryError,dateRange} from './core.mjs';
const fail=m=>{throw new QueryError('INVALID_DATE',m);};
export const localTime=t=>new Date((t+28800)*1000).toISOString().slice(0,19).replace('T',' ');
export function eventRange(a,now=Math.floor(Date.now()/1000)){
 const special=a.granularity==='hour'||a.start_clock!==undefined||a.end_clock!==undefined||a.include_today;
 if(!special)return dateRange(a.start_date,a.end_date);
 if(a.kind==='retention')fail('留存仅支持完整历史自然日。');
 for(const d of [a.start_date,a.end_date])if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||!Number.isFinite(Date.parse(d+'T00:00:00Z'))||new Date(d+'T00:00:00Z').toISOString().slice(0,10)!==d)fail('日期无效。');
 const today=localTime(now).slice(0,10);
 if(a.end_date>today||a.start_date>today)fail('不能查询未来日期。');
 if(a.end_date===today&&!a.include_today)fail('查询今天请显式设置include_today=true；结果尚未完整。');
 const clock=(v,fallback)=>{if(v===undefined)return fallback;if(!/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(v))fail('时刻须为HH:mm或HH:mm:ss（北京时间）。');return v.length===5?v+':00':v;};
 const startClock=clock(a.start_clock,'00:00:00'),endClock=clock(a.end_clock,'23:59:59');
 const start=Date.parse(a.start_date+'T'+startClock+'+08:00')/1000;
 const requestedEnd=Date.parse(a.end_date+'T'+endClock+'+08:00')/1000;
 if(a.end_date===today&&a.end_clock!==undefined&&requestedEnd>now)fail('结束时刻不能晚于当前时刻；省略end_clock可查询截至当前。');
 const end=a.end_date===today&&a.end_clock===undefined?now:requestedEnd;
 if(end<start||end-start+1>31*86400)fail('时间范围须为正且不超过31天。');
 if(a.granularity==='hour'&&end-start+1>7*86400)fail('小时查询最多7天。');
 if((a.start_clock!==undefined||a.end_clock!==undefined)&&a.granularity==='day')fail('指定时刻请使用hour或all粒度。');
 return {start_date:a.start_date,end_date:a.end_date,start_time:start,end_time:end,timezone:'Asia/Shanghai',start_at:localTime(start),end_at:localTime(end),as_of:new Date(now*1000).toISOString(),includes_today:a.end_date===today,complete_days_only:startClock==='00:00:00'&&endClock==='23:59:59'&&a.end_date<today,partial_period:a.end_date===today||startClock!=='00:00:00'||endClock!=='23:59:59',granularity:a.granularity};
}
export function eventDateLabels(range){
 const format=t=>localTime(t);
 if(range.granularity==='hour'){const labels=[];for(let t=Math.floor(range.start_time/3600)*3600;t<=range.end_time;t+=3600)labels.push(format(t));return labels;}
 if(range.granularity==='all')return [format(range.start_time)+'-'+format(range.end_time)];
 const labels=[];for(let t=Math.floor((range.start_time+28800)/86400)*86400-28800;t<=range.end_time;t+=86400)labels.push(format(t).slice(0,10).replaceAll('-',''));return labels;
}
export function matchEventDates(actual,range){
 if(!Array.isArray(actual))return false;
 const normalize=x=>range.granularity==='hour'&&typeof x==='string'&&/^\d{10}$/.test(x)?x.slice(0,4)+'-'+x.slice(4,6)+'-'+x.slice(6,8)+' '+x.slice(8)+':00:00':x;
 return JSON.stringify(actual.map(normalize))===JSON.stringify(eventDateLabels(range));
}
