'use client';
import {useState} from 'react';
export default function EventTimePanel(){
 const today=new Date(Date.now()+28800000).toISOString().slice(0,10);
 const [start,setStart]=useState(today),[end,setEnd]=useState(today),[from,setFrom]=useState(''),[until,setUntil]=useState(''),[grain,setGrain]=useState('hour'),[event,setEvent]=useState('app_launch'),[indicator,setIndicator]=useState('event_users'),[result,setResult]=useState<any>(null),[busy,setBusy]=useState(false);
 async function run(e:React.FormEvent<HTMLFormElement>){e.preventDefault();const form=new FormData(e.currentTarget);const start=String(form.get("start")),end=String(form.get("end")),from=String(form.get("from")),until=String(form.get("until")),grain=String(form.get("grain")),event=String(form.get("event")),indicator=String(form.get("indicator"));setResult(null);setBusy(true);try{const response=await fetch('/api/insights',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'event_time',input:{kind:'event',start_date:start,end_date:end,granularity:grain,include_today:end===today,...(from?{start_clock:from}:{}),...(until?{end_clock:until}:{}),events:[{event_name:event,indicator}]}})});setResult(await response.json());}catch{setResult({error:'请求失败，请稍后重试。'});}finally{setBusy(false);}}
 return <section id="event-time" style={{padding:20,border:'1px solid #bdcbc4',borderRadius:12,margin:'20px 0'}}>
 <h2>小时与当天事件查询</h2><p>北京时间；开始与结束时刻均包含在范围内。今天省略结束时刻表示截至查询时刻，数据可能延迟或回补；小时人数不可累加。</p>
 <form onSubmit={run}><div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
 <label>开始日期<input type="date" name="start" value={start} onChange={e=>setStart(e.target.value)}/></label>
 <label>结束日期<input type="date" name="end" value={end} max={today} onChange={e=>setEnd(e.target.value)}/></label>
 <label>开始时刻（可选）<input type="time" step="1" name="from" value={from} onChange={e=>setFrom(e.target.value)}/></label>
 <label>结束时刻（可选）<input type="time" step="1" name="until" value={until} onChange={e=>setUntil(e.target.value)}/></label>
 <label>粒度<select name="grain" value={grain} onChange={e=>setGrain(e.target.value)}><option value="hour">按小时</option><option value="all">区间汇总</option><option value="day">按天</option></select></label>
 <label>事件名称<input name="event" value={event} onChange={e=>setEvent(e.target.value)}/></label>
 <label>指标<select name="indicator" value={indicator} onChange={e=>setIndicator(e.target.value)}><option value="event_users">去重人数</option><option value="events">事件次数</option><option value="events_per_user">人均次数</option></select></label>
 </div><button disabled={busy} type="submit">{busy?'查询中…':'查询事件数据'}</button></form>
 {result&&<pre style={{whiteSpace:'pre-wrap',maxHeight:480,overflow:'auto'}}>{JSON.stringify(result,null,2)}</pre>}
 </section>;
}
