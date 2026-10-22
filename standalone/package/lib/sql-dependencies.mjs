import {sqlTokens} from './sql-references.mjs';
// Deliberately closed grammar for static single-table event counts. Consume the
// entire statement; unsupported syntax must never imply absence of dependencies.
export function resolveStaticSql(raw){
 const unresolved={resolved:false,reason:'sql_semantics_not_resolved'};
 if(typeof raw?.sql!=='string'||raw.sql.length>20000)return unresolved;
 if((raw.args!==undefined&&(!Array.isArray(raw.args)||raw.args.length))||(raw.show_option?.custom_args!==undefined&&(!Array.isArray(raw.show_option.custom_args)||raw.show_option.custom_args.length)))return unresolved;
 const {tokens,complete}=sqlTokens(raw.sql);if(!complete)return unresolved;
 let i=0;const peek=()=>tokens[i],keyword=w=>peek()?.type==='identifier'&&!peek().quoted&&peek().value.toLowerCase()===w;
 const kw=w=>{if(!keyword(w))throw Error();i++;},sym=s=>{if(peek()?.type!=='symbol'||peek().value!==s)throw Error();i++;};
 const native=name=>{if(peek()?.type!=='identifier'||peek().quoted||peek().value!==name)throw Error();i++;};
 const literal=()=>{if(peek()?.type!=='string')throw Error();return tokens[i++].value;};
 try{
  kw('select');kw('count');sym('(');if(peek()?.value==='*')sym('*');else sym('1');sym(')');
  if(keyword('as')){kw('as');if(peek()?.type!=='identifier'||peek().quoted||!/^[A-Za-z_][\w]*$/.test(peek().value)||['select','from','where','and','or','limit','union'].includes(peek().value.toLowerCase()))throw Error();i++;}
  kw('from');native('events');kw('where');
  const events=[],properties=new Set();let dates=0;
  while(true){
   if(keyword('event')){native('event');sym('=');const name=literal();if(!/^[A-Za-z_$][\w$.-]*$/.test(name))throw Error();events.push(name);properties.add('event');}
   else if(keyword('event_date')){native('event_date');const op=peek()?.value;if(!['=','>','<'].includes(op))throw Error();sym(op);if(op!=='='&&peek()?.value==='=')sym('=');const date=literal();if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)throw Error();dates++;properties.add('event_date');}
   else throw Error();
   if(!keyword('and'))break;kw('and');
  }
  if(events.length!==1||dates>2)throw Error();
  if(keyword('limit')){kw('limit');sym('1');}
  if(peek()?.value===';')sym(';');if(i!==tokens.length)throw Error();
  return {resolved:true,resolution:'static_events_count_v1',tables:['events'],event_names:events,property_names:[...properties],limitations:['仅解析静态单表事件计数依赖，不证明查询指标口径或虚拟对象运行时展开。']};
 }catch{return unresolved;}
}
