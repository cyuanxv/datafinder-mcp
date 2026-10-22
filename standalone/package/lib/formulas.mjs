import {z} from 'zod/v4';
import {QueryError} from './core.mjs';
export const formulaSchema=z.object({name:z.string().trim().min(1).max(80),description:z.string().max(500).default(''),expression:z.string().min(1).max(200),unit:z.string().max(40).default(''),format:z.enum(['number','percent']).default('number'),precision:z.number().int().min(0).max(8).default(2)}).strict();
const invalid=()=>{throw new QueryError('INVALID_FORMULA','公式仅支持A–E事件指标、有限数值、加减乘除与括号；不得引用不存在的指标。');};
export function parseFormula(expression,eventCount){
 const tokens=expression.match(/[A-E]|(?:\d+(?:\.\d*)?|\.\d+)|[()+*/-]/g)??[];
 if(tokens.join('')!==expression.replace(/\s/g,'')||tokens.length>100||!tokens.length)invalid();
 let i=0;const dependencies=new Set();
 function atom(depth){if(depth>16)invalid();const t=tokens[i++];if(t==='+'||t==='-')return {op:t==='-'?'neg':'pos',value:atom(depth+1)};
 if(t==='('){const n=sum(depth+1);if(tokens[i++]!==')')invalid();return n;}
 if(/^[A-E]$/.test(t??'')){if(t.charCodeAt(0)-65>=eventCount)invalid();dependencies.add(t);return {ref:t};}
 if(t!==undefined&&/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(t)&&Number.isFinite(Number(t)))return {number:Number(t)};invalid();}
 function product(depth){let n=atom(depth);while(['*','/'].includes(tokens[i])){const op=tokens[i++];n={op,left:n,right:atom(depth)};}return n;}
 function sum(depth){let n=product(depth);while(['+','-'].includes(tokens[i])){const op=tokens[i++];n={op,left:n,right:product(depth)};}return n;}
 const tree=sum(0);if(i!==tokens.length||!dependencies.size)invalid();return {tree,dependencies:[...dependencies].sort()};
}
export function evaluateFormula(tree,values){
 if(tree.ref){const n=values[tree.ref];return typeof n==='number'&&Number.isFinite(n)?{value:n}:{value:null,reason:'missing_input'};}
 if(tree.number!==undefined)return {value:tree.number};
 if(tree.op==='neg'||tree.op==='pos'){const n=evaluateFormula(tree.value,values);return n.value===null?n:{value:tree.op==='neg'?-n.value:n.value};}
 const a=evaluateFormula(tree.left,values),b=evaluateFormula(tree.right,values);if(a.value===null||b.value===null)return {value:null,reason:a.reason??b.reason};
 if(tree.op==='/'&&b.value===0)return {value:null,reason:'division_by_zero'};
 const value=tree.op==='+'?a.value+b.value:tree.op==='-'?a.value-b.value:tree.op==='*'?a.value*b.value:a.value/b.value;
 return Number.isFinite(value)?{value}:{value:null,reason:'non_finite'};
}
export function validateFormulas(a){
 if(!a.formulas?.length)return;
 if(a.kind!=='event'||a.report_id||!a.events||a.metric_page!==1||a.metric_page_size<a.events.length)throw new QueryError('INVALID_FORMULA','临时公式仅支持自由事件分析，需在第1指标页同时查询全部依赖事件。');
 if(new Set(a.formulas.map(f=>f.name)).size!==a.formulas.length)throw new QueryError('INVALID_FORMULA','公式名称不能重复。');
 for(const f of a.formulas)parseFormula(f.expression,a.events.length);
}
export function computeFormulas(a,results,verified){
 if(!a.formulas?.length)return undefined;
 if(!verified)return {status:'incomplete',items:[],reason:'source_validation_failed',source:'plugin_arithmetic_on_native_aggregates'};
 const all=new Map(results.map(r=>[r.query_id,r]));
 const items=a.formulas.map(f=>{
  const {tree,dependencies}=parseFormula(f.expression,a.events.length);let dates;const byRef=new Map(),keys=new Set();let invalidSource=false;
  for(const ref of dependencies){const i=ref.charCodeAt(0)-65,r=all.get(`a00:p00:c00:q${String(i).padStart(2,'0')}`),groups=new Map();
   if(!r||dates&&JSON.stringify(dates)!==JSON.stringify(r.date_index_list))invalidSource=true;
   dates??=r?.date_index_list;
   for(const s of r?.series??[]){const key=s.group_by_key;
    if(typeof key!=='string'||groups.has(key)||s.event_name!==a.events[i].event_name||s.result_type!==(a.events[i].measure?'measure':a.events[i].indicator)||!Array.isArray(s.data)||s.data.length!==dates?.length){invalidSource=true;continue;}
    groups.set(key,s.data);keys.add(key);
   }byRef.set(ref,groups);
  }
  if(invalidSource||!dates)return {...f,status:'incomplete',rows:[],reason:'metric_or_group_identity_unverified'};
  const sorted=[...keys].sort(),rows=sorted.slice((a.page-1)*a.page_size,a.page*a.page_size).map(group=>({group,points:dates.map((date,i)=>{
   const inputs=Object.fromEntries(dependencies.map(ref=>[ref,byRef.get(ref).get(group)?.[i]??null])),computed=evaluateFormula(tree,inputs);
   const display=computed.value===null?null:computed.value*(f.format==='percent'?100:1);
   return {date,inputs,...computed,display:display===null||!Number.isFinite(display)?null:display.toFixed(f.precision)+(f.format==='percent'?'%':'')};
  })}));
  return {...f,status:rows.length&&rows.every(r=>r.points.every(p=>p.value!==null))?'computed':'incomplete',dependencies,rows,pagination:{page:a.page,page_size:a.page_size,total_groups:sorted.length,has_more:a.page*a.page_size<sorted.length}};
 });
 return {status:items.every(f=>f.status==='computed')?'computed':'incomplete',items,source:'plugin_arithmetic_on_native_aggregates',warning:'A–E按events顺序绑定，仅对齐同日期同分组；独立事件人数的比值不是漏斗转化率。单位为用户声明，不自动校验量纲；不跨日期或分组合计去重人数。'};
}
