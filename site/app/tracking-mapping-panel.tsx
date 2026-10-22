'use client';
import {useState} from 'react';
import {trackingCandidates} from '../lib/datafinder/tracking-candidates.mjs';
const style={width:'100%',padding:8,border:'1px solid #bdcbc4',borderRadius:6};
export default function TrackingMappingPanel(){
 const [key,setKey]=useState(''),[revision,setRevision]=useState(0),[sourceRevision,setSourceRevision]=useState(''),[body,setBody]=useState('{}'),[result,setResult]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[pending,setPending]=useState<any>(null),[validation,setValidation]=useState<any>(null),[page,setPage]=useState(1);
 function invalidate(){setPending(null);setValidation(null);}
 async function call(input:any){setBusy(true);setError('');try{const response=await fetch('/api/insights',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'mapping',input})});const data:any=await response.json();if(!response.ok)throw Error(`${data.code}：${data.error}`);setResult(data);return data;}catch(e){setError(e instanceof Error?e.message:String(e));return null;}finally{setBusy(false);}}
 async function preview(){invalidate();try{const input={action:'save',key,expected_revision:revision,definition:JSON.parse(body)};if(await call(input))setPending(input);}catch{setError('映射配置不是有效 JSON。');}}
 async function read(){invalidate();const r=await call({action:'read',key,...(sourceRevision?{revision:Number(sourceRevision)}:{})});if(r){setBody(JSON.stringify(r.value.definition,null,2));if(!sourceRevision)setRevision(r.revision);}}
 return <details id="tracking-mappings" style={{background:'white',padding:16,borderRadius:10,marginBottom:20}}><summary>云端埋点映射与版本管理</summary><p>文档先保存为草稿，校验线上字段后再发布。新查询按日期选择已发布映射；旧版本保留。候选不代表已上线，生效日期需要核实。这里不会修改 DataFinder 埋点。</p>
 <fieldset disabled={busy} style={{border:0,padding:0}}><label>从文档候选载入<select aria-label="文档候选" style={style} defaultValue="" onChange={e=>{const c=trackingCandidates.find((x:any)=>x.key===e.target.value);if(c){setKey(c.key);setRevision(0);setSourceRevision('');setBody(JSON.stringify(c.definition,null,2));invalidate();setResult(null);}}}><option value="">选择候选（只载入，不保存）</option>{trackingCandidates.map((c:any)=><option key={c.key} value={c.key}>{c.definition.name}</option>)}</select></label>
 <label>映射标识<input aria-label="映射标识" value={key} onChange={e=>{setKey(e.target.value);setRevision(0);invalidate();}} style={style}/></label>
 <label>当前最新版本（新建填 0；修改前读取最新版本）<input aria-label="映射当前版本" type="number" min="0" value={revision} onChange={e=>{setRevision(Number(e.target.value));invalidate();}} style={style}/></label>
 <label>要读取或校验的历史版本（留空为最新）<input aria-label="映射历史版本" value={sourceRevision} onChange={e=>{setSourceRevision(e.target.value);invalidate();}} style={style}/></label>
 <label>映射配置<textarea aria-label="埋点映射配置" rows={14} value={body} onChange={e=>{setBody(e.target.value);invalidate();}} style={style}/></label>
 <p>sources 记录文档、工作表、单元格和文件指纹；events 和 filters 是执行口径。properties 声明预期字段类型。implementation_status 为 planned 的候选不能发布；平台与版本限制写入筛选，不根据备注猜测。</p>
 <div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button disabled={busy} onClick={read}>读取映射</button><button disabled={busy} onClick={preview}>预览映射草稿</button><button disabled={busy} onClick={async()=>{invalidate();const v=await call({action:'validate',key,...(sourceRevision?{revision:Number(sourceRevision)}:{})});if(v)setValidation({key,revision:v.record.revision,expected_revision:revision,validation_hash:v.validation_hash});}}>校验已保存映射</button><button disabled={busy} onClick={()=>call({action:'list',page})}>列出映射</button><button disabled={busy} onClick={()=>call({action:'history',key,page})}>查询映射历史</button></div>
 <label>目录／历史页码<input aria-label="映射页码" type="number" min="1" value={page} onChange={e=>setPage(Number(e.target.value))}/></label>
 {pending&&<aside><p>请核对下方差异。确认只新增草稿版本，不改变已发布口径。</p><button disabled={busy} onClick={async()=>{const r=await call({...pending,confirmed:true});if(r){setRevision(r.revision);setSourceRevision('');invalidate();}}}>确认保存映射草稿</button><button onClick={invalidate}>取消保存</button></aside>}
 {validation&&<aside><p>元数据检查通过不代表业务含义已经核验。确认此版本的上线状态、生效日期、筛选和币种后发布；新版本按生效日期适用，不会删除旧版。</p><button disabled={busy} onClick={async()=>{const r=await call({action:'publish',...validation,confirmed:true});if(r){setRevision(r.revision);setSourceRevision('');invalidate();}}}>确认发布映射版本</button><button onClick={invalidate}>取消发布</button></aside>}
 {error&&<p role="alert" style={{color:'#a52a2a'}}>{error}</p>}{result&&<pre aria-label="映射操作结果" style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:500,overflow:'auto'}}>{JSON.stringify(result,null,2)}</pre>}
 </fieldset></details>;
}
