'use client';
import {useState} from 'react';
export default function ConnectionCheck(){
 const [busy,setBusy]=useState(false),[result,setResult]=useState('');
 async function check(){setBusy(true);setResult('正在从云端查询 DataFinder…');try{const r=await fetch('/api/check',{cache:'no-store'});const j=await r.json() as {error?:string;query_success?:boolean;report?:string;subqueries:unknown[];checked_at?:string;note?:string};setResult(j.error??`${j.query_success?'云端查询成功':'子查询未全部成功'} · ${j.report}\n${j.subqueries.length} 个子查询 · ${j.checked_at}\n运行位置：云端 · 不依赖本地电脑\n${j.note}`);}catch{setResult('检查失败，请稍后重试。');}finally{setBusy(false);}}
 return <section style={{marginTop:24}}><button onClick={check} disabled={busy} style={{background:'#315e50',color:'white',border:0,borderRadius:10,padding:'12px 20px',cursor:'pointer'}}>{busy?'正在检查…':'检查云端连接'}</button><p role="status" style={{whiteSpace:'pre-wrap',fontSize:14,lineHeight:1.8}}>{result}</p></section>;
}
