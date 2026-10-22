import {QueryError} from './core.mjs';
const invalid=message=>{throw new QueryError('UNVERIFIED_CONTRACT',message);};
const count=n=>Number.isSafeInteger(n)&&n>=0;

export function parsePath(r,plan){
 const a=plan.args,mapping=r.events;
 if(!mapping||typeof mapping!=='object'||Array.isArray(mapping))invalid('路径事件映射缺失。');
 const allowed=new Set([...a.events.map(e=>e.event_name),'__OTHER_GROUP__','__LOSS__']),labels={};
 for(const [id,e] of Object.entries(mapping)){
  if(!/^\d+$/.test(id)||!(allowed.has(e?.event_name)||(a.path_include_unselected===true&&typeof e?.event_name==='string'&&/^[\w$.-]{1,120}$/.test(e.event_name)))||e.group_value)invalid('路径事件映射或分组不匹配。');
  labels[id]=e.event_name;
 }
 const seen=new Set();
 const rows=r.data_item_list.map(x=>{
  if(x.event_show_name!==a.events[0].event_name||seen.has(x.event_show_name)||!Array.isArray(x.data)||x.data.length>2000)invalid('路径起点或结果规模未知。');
  seen.add(x.event_show_name);
  const edges=[],keys=new Set(),outgoing=new Map(),incoming=new Map();
  for(const edge of x.data){
   if(!Array.isArray(edge)||edge.length!==4||edge.some(v=>!count(v))||!labels[edge[1]]||!labels[edge[2]])invalid('路径边结构不匹配。');
   const [step,from,to,value]=edge,key=`${step}:${from}:${to}`;
   if(keys.has(key)||labels[from]==='__LOSS__')invalid('路径边重复或从流失继续。');
   keys.add(key);outgoing.set(`${step}:${from}`,(outgoing.get(`${step}:${from}`)??0)+value);incoming.set(`${step+1}:${to}`,(incoming.get(`${step+1}:${to}`)??0)+value);
   edges.push({from_step:step+1,to_step:step+2,from_event:labels[from],to_event:labels[to],flow_count:value});
  }
  // Named node totals independently check the four positional edge columns.
  let conservation='not_returned';
  if(x.node){
   const nodes=new Map();
   for(const [step,items] of Object.entries(x.node)){
    if(!/^\d+$/.test(step)||!Array.isArray(items))invalid('路径节点结构未知。');
    for(const n of items){const key=`${step}:${n.label}`;if(nodes.has(key)||!labels[n.label]||![n.in_data,n.out_data,n.total].every(count))invalid('路径节点计数无效。');nodes.set(key,n);}
   }
   for(const [key,value] of outgoing)if(nodes.get(key)?.out_data!==value)invalid('路径出边不守恒。');
   for(const [key,value] of incoming)if(nodes.get(key)?.in_data!==value)invalid('路径入边不守恒。');
   conservation='verified';
  }
  edges.sort((l,r)=>l.from_step-r.from_step||l.from_event.localeCompare(r.from_event)||l.to_event.localeCompare(r.to_event));
  return {event_name:x.event_show_name,edges,conservation};
 });
 return {validation:'incomplete',semantic_validation:a.path_include_unselected?'include_unselected_pending_console_crosscheck':'console_verified_flow_columns',date_validation:r.date_index_list.length?'unverified_format':'not_returned',rows,event_mapping:labels,returned_dates:r.date_index_list,session_gap:{value:a.window,unit:'minute'},unit:'path_flow_count_not_unique_users',include_unselected:a.path_include_unselected??false,metric_semantics:`边为来源步骤、来源事件、目标事件、路径流量。步骤从1开始；会话可重复，不能把流量当独立用户数或跨步骤求和。${a.path_include_unselected?'请求包含未选中事件，此模式待控制台专项核验。':'未选中事件不计入。'}会话结束显示流失，不等于用户永久流失。`,limitations:['控制台同配置对照及节点守恒验证列含义；上游未回读可验证日期，整体仍为incomplete。'],contract_evidence:'console_crosscheck_2026-10-14'};
}
