import {QueryError} from './core.mjs';
// Only a verified saved binding is replayed. Never substitute SQL or invent an
// upstream parameter-override protocol. Dates below are expectations, not proof
// of the dates actually read by a cached upstream query.
export function savedSqlParameters(definitions,now=Date.now()){
 const today=new Date(now+8*3600000).toISOString().slice(0,10),tables=[];
 for(const [table_index,d] of definitions.entries()){
  const sql=d.sql??d.content?.sql;
  if(d.args!==undefined&&!Array.isArray(d.args))throw new QueryError('UNSUPPORTED_SQL_PARAMETERS','保存参数不是已识别的数组。');
  const args=d.args??[],placeholders=[...new Set([...String(sql??'').matchAll(/\$\{([^{}]+)\}/g)].map(x=>x[1]))];
  if(args.length>10)throw new QueryError('UNSUPPORTED_SQL_PARAMETERS','保存参数数量超出已验收范围。');
  const seen=new Set(),bindings=[];
  for(const a of args){
   if(!a||typeof a!=='object'||a.arg_type!=='event_date'||a.property_value_type!=='datetime'||a.use_timezone!==true||a.property_operation!==''||typeof a.placeholder!=='string'||!/^event_date:[A-Za-z][\w]{0,60}$/.test(a.placeholder)||seen.has(a.placeholder)||!placeholders.includes(a.placeholder))throw new QueryError('UNSUPPORTED_SQL_PARAMETERS','仅支持已保存且完整绑定的事件日期参数；未知类型或重复、缺失绑定不能执行。');
   seen.add(a.placeholder);
   if(!Array.isArray(a.property_values)||a.property_values.length!==1)throw new QueryError('UNSUPPORTED_SQL_PARAMETERS','事件日期保存值无法确认。');
   const p=a.property_values[0],spans=p?.spans;
   if(p?.type!=='past_range'||p.granularity!=='day'||![0,1].includes(p.week_start??1)||!Array.isArray(spans)||spans.length!==2||!spans.every(s=>s?.type==='past'&&s.past?.unit==='day'&&Number.isSafeInteger(s.past.amount)&&s.past.amount>=1&&s.past.amount<=31)||spans[0].past.amount<spans[1].past.amount)throw new QueryError('UNSUPPORTED_SQL_PARAMETERS','目前仅验收过去1至31个完整自然日的已保存日期参数；当天、反向或未知范围不能执行。');
   const day=n=>new Date(Date.parse(`${today}T00:00:00Z`)-n*86400000).toISOString().slice(0,10);
   bindings.push({placeholder:a.placeholder,type:'saved_event_date',saved_value:structuredClone(p),expected_range:{start_date:day(spans[0].past.amount),end_date:day(spans[1].past.amount),timezone:'Asia/Shanghai'},range_status:'expected_from_saved_binding_not_upstream_verified'});
  }
  if(placeholders.some(p=>!seen.has(p)))throw new QueryError('UNSUPPORTED_SQL_PARAMETERS','SQL存在没有完整保存值的占位符，不能猜测默认参数。');
  tables.push({table_index,bindings});
 }
 const dynamic=tables.some(t=>t.bindings.length);
 return {mode:dynamic?'saved_parameters':'saved_sql_only',...(dynamic?{resolved_on_shanghai_date:today,tables,note:'原样查询已保存参数，不传临时覆盖值，不替换SQL。预计日期按北京时间解释；上游缓存与实际查询日期仍需核对。'}:{})};
}
