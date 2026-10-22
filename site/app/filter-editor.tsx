'use client';
import {Filters} from './visual-config';
import {readFilterDraft} from '../lib/datafinder/filter-draft.mjs';

export default function FilterEditor({title,value,onChange}:{title:string;value:string;onChange:(value:string)=>void}){
 const parsed=readFilterDraft(value);
 return <div className="query-controls">
 <p>选择属性、比较方式和数值即可；支持“全部满足”和“任一满足”。只修改当前查询，不保存或修改上游报表。</p>
 {parsed.valid?<Filters title={title.replace(/条件$/, '')} value={parsed.value} onChange={v=>onChange(JSON.stringify(v,null,2))}/>:<p role="alert">筛选格式暂时无法显示为表单，请在下方高级配置中修正。原内容已保留，不会自动清空。</p>}
 <details open={!parsed.valid}><summary>{title}高级配置（可选）</summary><label>{title}<textarea aria-label={title} rows={3} value={value} onChange={e=>onChange(e.target.value)}/></label></details>
 </div>;
}
