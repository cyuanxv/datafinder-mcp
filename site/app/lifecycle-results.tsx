const names:Record<string,string>={new_user:'新用户',reflow_user:'回流用户',retention_user:'留存用户',lost_user:'流失用户'};
export default function LifecycleResults({data}:{data:any}) {
 const groups=(data?.rows??[]).filter((r:any)=>r.output?.query_method==='advanced_lifecycle');
 if(!groups.length)return null;
 return <section aria-label="生命周期日期明细"><h3>生命周期日期明细</h3><p>流失数据从第二个周期开始。首个周期无法判断，显示“—”，不算作 0。</p>{groups.map((g:any,i:number)=><div key={i} style={{overflowX:'auto'}}><h4>{g.segment.name}</h4><table style={{width:"100%",borderSpacing:"12px 6px",textAlign:"left",whiteSpace:"nowrap"}}><thead><tr><th>类别</th><th>日期（上海时区）</th><th>人数</th><th>占比</th></tr></thead><tbody>{g.output.data.rows.map((r:any)=>Array.isArray(r.dates)?r.dates.map((date:string,j:number)=><tr key={`${r.category}-${date}`}><td>{names[r.category]??r.category}</td><td>{date.replace(/(\d{4})(\d{2})(\d{2})/g,'$1-$2-$3').replace(/^(.*)-\1$/,'$1')}</td><td>{r.users?.[j]??'—（无法判断）'}</td><td>{r.percent?.[j]==null?'—':`${r.percent[j]}%`}</td></tr>):<tr key={r.category}><td>{names[r.category]??r.category}</td><td colSpan={3}>上游未返回可对应日期的数据</td></tr>)}</tbody></table></div>)}</section>;
}
