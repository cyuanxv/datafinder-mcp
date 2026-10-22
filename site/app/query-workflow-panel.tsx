'use client';
import {useState} from 'react';
import QueryFollowup from './query-followup';
export default function QueryWorkflowPanel({template,start,end}:{template:()=>object;start:string;end:string}){
 const [session,SS]=useState(''),[sessionRev,SR]=useState(0),[keyword,KW]=useState(''),[matches,MM]=useState<any[]>([]),[ref,RF]=useState<any>(null),[metricIndex,MI]=useState('');
 const [key,K]=useState(''),[rev,R]=useState(1),[patch,P]=useState('{}'),[preview,S]=useState<any>(null),[result,O]=useState(''),[busy,B]=useState(false);
 const [records,RECORDS]=useState<any>(null),[history,HISTORY]=useState<any>(null);
 async function act(mode:string,extra:any={}){B(true);O('');try{
  const current:any=mode==='preview'&&!ref?template():null;if(current?.kind==='report'&&metricIndex!=='')current.config={...current.config,metric_index:Number(metricIndex)-1};
  const definition=mode==='preview'?{...(ref?{template_ref:ref}:{template:current}),start_date:start,end_date:end,...(key?{dictionary:{key,revision:rev}}:{})}:preview?.definition;
  const payload=mode==='records'?{operation:'records',keyword:session,page:extra.page??1}:mode==='history'?{operation:'history',session_key:session,page:extra.page??1}:mode==='search'?{operation:'templates',keyword}:mode==='load'?{operation:'read',session_key:extra.key??session,...(extra.revision?{revision:extra.revision}:{})}:mode==='save'?{operation:'save',definition,session_key:session,expected_revision:sessionRev,confirmed:true,preview_hash:preview.preview_hash}:mode==='run'?{definition,execute:true,preview_hash:preview.preview_hash}:mode==='revise'?{definition,changes:extra.changes??JSON.parse(patch)}:{definition};
  const r=await fetch('/api/management',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'workflow',kind:'template',payload})}),d=await r.json() as any;
  if(!r.ok)throw Error(d.error);if(mode==='records')RECORDS(d);else if(mode==='history')HISTORY(d);else if(mode==='search')MM(d.items);else if(mode==='load'){SS(d.key);HISTORY(null);SR(d.revision);S({definition:d.value.definition});}else if(mode==='save')SR(d.revision);else if(mode!=='run')S(d);O(JSON.stringify(d,null,2));
 }catch(e){O(e instanceof Error?e.message:'操作失败');}finally{B(false);}}
 return <section className="query-controls"><h3>统一查询预览与追问</h3><p>先从当前模板和日期生成固定预览；执行使用下方预览，不读取随后修改的编辑区。字典绑定仅支持默认来源报表，执行前重新核验版本。支持各分析已有日期范围；自由事件可查今天和小时。查询记录只保存到插件，不修改火山报表。</p>
 <fieldset disabled={busy}>
 <label>查找已保存的公式或模板<input value={keyword} onChange={e=>KW(e.target.value)}/></label><button type="button" onClick={()=>act('search')}>查找模板</button>
 {matches.map(m=><button type="button" key={m.key} onClick={()=>{RF({key:m.key,revision:m.revision});S(null);}}>{m.value.name}（{m.key}，版本{m.revision}）</button>)}
 {ref&&<p>已选择 {ref.key} 版本 {ref.revision} <button type="button" onClick={()=>{RF(null);S(null);}}>改用编辑区配置</button></p>}
 <label>报表内指标序号（可选，从1开始；先查看报表来源候选）<input type="number" min="1" max="100" value={metricIndex} onChange={e=>MI(e.target.value)}/></label>
 <label>查询记录名称<input value={session} onChange={e=>{SS(e.target.value);SR(0);HISTORY(null);RECORDS(null);}}/></label><button type="button" disabled={!session} onClick={()=>act('load')}>读取查询记录</button>
 <button type="button" onClick={()=>act('records')}>查找查询记录</button><button type="button" disabled={!session} onClick={()=>act('history')}>查看查询历史版本</button>
 {records&&<div><p>查询记录第{records.page}页{!records.items.length?'：没有匹配记录':''}</p>{records.items.map((r:any)=><p key={r.key}>{r.key} · 版本{r.revision} <button type="button" onClick={()=>act('load',{key:r.key})}>读取 {r.key}</button></p>)}{records.page>1&&<button type="button" onClick={()=>act('records',{page:records.page-1})}>上一页记录</button>}{records.has_more&&<button type="button" onClick={()=>act('records',{page:records.page+1})}>下一页记录</button>}</div>}
 {history&&<div><p>{history.session_key} 的历史配置（读取后须重新校验；不会覆盖最新版本）</p>{history.items.map((r:any)=><button type="button" key={r.revision} onClick={()=>act('load',{key:history.session_key,revision:r.revision})}>读取历史版本 {r.revision}</button>)}{history.page>1&&<button type="button" onClick={()=>act('history',{page:history.page-1})}>上一页版本</button>}{history.has_more&&<button type="button" onClick={()=>act('history',{page:history.page+1})}>下一页版本</button>}</div>}
 <label>绑定指标标识（可选）<input value={key} onChange={e=>K(e.target.value)}/></label><label>指标版本<input type="number" min={1} value={rev} onChange={e=>R(Number(e.target.value))}/></label>
 <button type="button" onClick={()=>act('preview')}>生成完整查询预览</button>
 {preview&&<><QueryFollowup key={JSON.stringify(preview.definition)} definition={preview.definition} onPreview={changes=>act('revise',{changes})}/>{preview.changes?.length>0&&<div><h4>本次改动</h4><pre style={{whiteSpace:'pre-wrap'}}>{JSON.stringify(preview.changes,null,2)}</pre></div>}<button type="button" onClick={()=>act('repreview')}>重新校验当前查询</button><label>追问字段变更 JSON<textarea value={patch} onChange={e=>P(e.target.value)}/></label><p>例如只改日期：{"{ \"start_date\": \"2026-10-16\", \"end_date\": \"2026-10-16\" }"}；config内按字段改动，数组整体替换，未指定字段继承。</p><button type="button" onClick={()=>act('revise')}>预览追问改动</button><button type="button" disabled={!preview.preview_hash} onClick={()=>act('run')}>执行固定预览（只读）</button><button type="button" disabled={!session||!preview.preview_hash} onClick={()=>act('save')}>保存当前查询记录（版本{sessionRev+1}）</button><pre style={{whiteSpace:'pre-wrap'}}>{JSON.stringify(preview.definition,null,2)}</pre></>}
 </fieldset><pre role="status" style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{result}</pre></section>;
}
