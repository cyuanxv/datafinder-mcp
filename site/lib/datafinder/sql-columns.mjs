import {sqlTokens} from './sql-references.mjs';
// Preview column labels only. This does not resolve SQL semantics, infer metrics,
// execute SQL, or rewrite any query. Unsupported syntax stays explicitly manual.
export function sqlOutputColumns(sql){
 if(typeof sql!=='string'||sql.length>100000)return [];
 const {tokens,complete}=sqlTokens(sql),kw=(t,w)=>t?.type==='identifier'&&!t.quoted&&t.value.toLowerCase()===w;
 if(!complete||!kw(tokens[0],'select'))return [];
 let depth=0,part=[],parts=[],ended=false;
 for(const t of tokens.slice(1)){
  if(t.type==='symbol'&&['(','['].includes(t.value))depth++;
  if(t.type==='symbol'&&[')',']'].includes(t.value))depth--;
  if(depth<0)return [];
  if(depth===0&&kw(t,'from')){parts.push(part);ended=true;break;}
  if(depth===0&&t.type==='symbol'&&t.value===','){parts.push(part);part=[];}else part.push(t);
 }
 if(!ended||depth!==0)return [];
 const columns=[];
 for(const tokens of parts){let d=0,as=-1;for(let i=0;i<tokens.length;i++){const t=tokens[i];if(t.type==='symbol'&&['(','['].includes(t.value))d++;if(t.type==='symbol'&&[')',']'].includes(t.value))d--;if(d===0&&kw(t,'as'))as=i;}
  const label=as===tokens.length-2&&tokens.at(-1)?.type==='identifier'?tokens.at(-1).value:tokens.length===1&&tokens[0].type==='identifier'?tokens[0].value:null;
  if(label)columns.push({name:label,kind:'sql_output_candidate',interpretation:'输出列候选；可能是维度或指标，需人工确认，不推断业务含义。'});
 }
 return columns;
}
