import {sqlTokens} from './sql-references.mjs';
import {QueryError} from './core.mjs';
const restricted=/^(user_id|user_unique_id|device_id|distinct_id|hash_uid|uid|email|phone|mobile|message_content|chat_content)$/i;
const kw=(t,v)=>t?.type==='identifier'&&!t.quoted&&t.value.toLowerCase()===v;
const deny=()=>{throw new QueryError('PRIVATE_QUERY','此 SQL 可能输出受限用户明细；仅已识别的汇总计算可以执行。');};
// Conservative lexical lineage for explicitly named SELECT outputs. This is not
// a general SQL parser or an authorization to expose pseudonymous identifiers.
// Unknown sensitive syntax is refused; result-wide privacy checks still apply.
export function assertSqlPrivacy(sql){
 if(typeof sql!=='string'||sql.length>100000)return deny();
 const {tokens,complete}=sqlTokens(sql);
 if(!complete||tokens.length>10000)return deny();
 if(!tokens.some(t=>restricted.test(t.value)))return;
 // Column alias lists can rename sensitive CTE/subquery outputs; not resolved here.
 for(let i=0;i<tokens.length-2;i++)if((kw(tokens[i],'with')||tokens[i].value===')'||tokens[i].value===',')&&tokens[i+1]?.type==='identifier'&&tokens[i+2]?.value==='('){let end=i+3;while(end<tokens.length&&tokens[end].value!==')')end++;if(tokens[i].value!==','||kw(tokens[end+1],'as')&&tokens[end+2]?.value==='(')return deny();}
 for(let i=0;i<tokens.length-3;i++)if(tokens[i].value===')'&&kw(tokens[i+1],'as')&&tokens[i+2]?.type==='identifier'&&tokens[i+3]?.value==='(')return deny();
 const lists=[];let nesting=0;
 for(let i=0;i<tokens.length;i++){
  const t=tokens[i];if(t.value==='(')nesting++;if(t.value===')')nesting--;
  if(!kw(t,'select'))continue;
  let depth=0,part=[],parts=[],ended=false;
  for(const x of tokens.slice(i+1)){
   if(x.value==='('||x.value==='[')depth++;
   if(x.value===')'||x.value===']')depth--;
   if(depth<0)break;
   if(depth===0&&kw(x,'from')){parts.push(part);ended=true;break;}
   if(depth===0&&x.value===','){parts.push(part);part=[];}else part.push(x);
  }
  if(!ended)return deny();
  if(kw(parts[0]?.[0],'distinct')||kw(parts[0]?.[0],'all'))parts[0].shift();
  const projections=parts.map(p=>{
   let depth=0,as=-1;
   for(let j=0;j<p.length;j++){if(['(','['].includes(p[j].value))depth++;if([')',']'].includes(p[j].value))depth--;if(!depth&&kw(p[j],'as'))as=j;}
   if(as===p.length-2&&p.at(-1)?.type==='identifier')return {name:p.at(-1).value,expr:p.slice(0,as)};
   if(p.length===1&&p[0].type==='identifier')return {name:p[0].value,expr:p};
   if(p.length===3&&p[0].type==='identifier'&&p[1].value==='.'&&p[2].type==='identifier')return {name:p[2].value,expr:p};
   return deny(); // stars, implicit aliases and unnamed expressions need manual review
  });
  lists.push({depth:nesting,projections});
 }
 if(!lists.length||lists.length>50||lists.filter(l=>l.depth===0).length!==1)return deny();
 const tainted=new Set(tokens.filter(t=>restricted.test(t.value)).map(t=>t.value.toLowerCase()));
 function unsafe(expr){
  // Only numeric count aggregates consume sensitive inputs safely. No MIN,
  // arrays, strings, arbitrary functions or window functions are declassified.
  if(expr[0]?.type==='identifier'&&['count','uniq','uniqexact'].includes(expr[0].value.toLowerCase())&&expr[1]?.value==='('&&expr.at(-1)?.value===')'){
   let depth=0;for(let i=1;i<expr.length;i++){if(expr[i].value==='(')depth++;if(expr[i].value===')')depth--;if(depth===0&&i!==expr.length-1)return true;}
   return depth!==0||expr.some(t=>kw(t,'select'));
  }
  return expr.some(t=>tainted.has(t.value.toLowerCase()));
 }
 // Global alias taint is deliberately conservative across scopes and forward CTEs.
 for(let pass=0;pass<=tokens.length;pass++){let changed=false;for(const l of lists)for(const p of l.projections)if(unsafe(p.expr)&&!tainted.has(p.name.toLowerCase())){tainted.add(p.name.toLowerCase());changed=true;}if(!changed)break;}
 for(const p of lists.find(l=>l.depth===0).projections)if(restricted.test(p.name)||unsafe(p.expr))return deny();
}
