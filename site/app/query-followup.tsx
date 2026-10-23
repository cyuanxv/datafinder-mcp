'use client';
import {useState} from 'react';
import {Filters} from './visual-config';
export default function QueryFollowup({definition,onPreview}:{definition:any;onPreview:(changes:object)=>void}){
 const config=definition.template?.config??{};
 const [dates,D]=useState(false),[start,S]=useState(definition.start_date),[end,E]=useState(definition.end_date);
 const [filter,F]=useState(false),[filters,FS]=useState<unknown[]>(config.filters??[]),[count,C]=useState(false),[limit,L]=useState(definition.saved_sql?.count??config.limit??100);
 function preview(){const changes:any={};if(dates){changes.start_date=start;changes.end_date=end;}if(filter||count)changes.config={...(filter?{filters}:{}),...(count?{limit:Number(limit)}:{})};onPreview(changes);}
 if(definition.saved_sql)return <fieldset><legend>接着调整 SQL 查询</legend><p>沿用指标、表、列、来源版本和已保存日期；不会修改上游报表。</p><label>追问返回条数<input type="number" min="1" max="1000" value={limit} onChange={e=>L(e.target.value)}/></label><button type="button" onClick={()=>onPreview({saved_sql:{count:Number(limit)}})}>预览 SQL 条数调整</button></fieldset>;
 return <fieldset><legend>接着调整这次查询</legend><p>只改勾选的项目，其余日期、事件、公式与口径沿用上一次预览。这里不会修改已保存模板；先预览改动，再执行。</p>
 <label><input type="checkbox" checked={dates} onChange={e=>D(e.target.checked)}/>调整查询日期</label>{dates&&<div><label>追问开始日期<input type="date" value={start} onInput={e=>S(e.currentTarget.value)}/></label><label>追问结束日期<input type="date" value={end} onInput={e=>E(e.currentTarget.value)}/></label><p>小时及时段设置会继续保留；若需改动，请使用下方高级字段。</p></div>}
 <label><input type="checkbox" checked={filter} onChange={e=>F(e.target.checked)}/>调整筛选条件</label>{filter&&<><p>从现有条件继续修改；清空全部条件会扩大查询范围，请检查预览。事件自身的筛选仍保留。</p><Filters title="追问筛选" value={filters} onChange={FS}/></>}
 <label><input type="checkbox" checked={count} onChange={e=>C(e.target.checked)}/>调整返回条数</label>{count&&<label>追问返回条数<input type="number" min="1" value={limit} onChange={e=>L(e.target.value)}/></label>}
 <button type="button" disabled={!dates&&!filter&&!count} onClick={preview}>预览这些调整</button></fieldset>;
}
