// Lexical references, not a SQL resolver: comments and ordinary strings never count as identifiers.
export function sqlTokens(sql){
 const tokens=[];let i=0;
 while(i<sql.length){const c=sql[i];if(/\s/.test(c)){i++;continue;}
  if(sql.startsWith('--',i)){const end=sql.indexOf('\n',i+2);i=end<0?sql.length:end;continue;}
  if(sql.startsWith('/*',i)){const end=sql.indexOf('*/',i+2);if(end<0)return {tokens,complete:false};i=end+2;continue;}
  if(['\'', '"','`'].includes(c)){const quote=c;let value='',closed=false;i++;while(i<sql.length){if(sql[i]===quote){if(sql[i+1]===quote){value+=quote;i+=2;continue;}i++;closed=true;break;}if(sql[i]==='\\'){value+=sql[i+1]??'';i+=2;}else value+=sql[i++];}if(!closed)return {tokens,complete:false};tokens.push({type:quote==="'"?'string':'identifier',value,quoted:true});continue;}
  const m=/^[A-Za-z_$][\w$]*/.exec(sql.slice(i));if(m){tokens.push({type:'identifier',value:m[0]});i+=m[0].length;}else{tokens.push({type:'symbol',value:c});i++;}
 }return {tokens,complete:true};
}
export function sqlReference(sql,name,kind){const {tokens,complete}=sqlTokens(sql);let found=false;
 if(kind!=='virtual_events')found=tokens.some(t=>t.type==='identifier'&&t.value===name);
 if(kind!=='virtual_params')for(let i=0;i<tokens.length-2;i++){if(['event','event_name'].includes(tokens[i].value.toLowerCase())&&tokens[i+1].value==='='&&tokens[i+2].type==='string'&&tokens[i+2].value===name)found=true;}
 return {candidate:found,complete,resolution:'lexical_candidate_not_resolved'};
}
