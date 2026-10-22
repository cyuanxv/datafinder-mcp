// Only check whether a draft is safe to edit; the query schema remains authoritative.
export function readFilterDraft(text){
 try{
  const value=JSON.parse(text);
  const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
  const row=x=>object(x)&&(x.logic?['and','or'].includes(x.logic)&&Array.isArray(x.conditions)&&x.conditions.every(row):object(x.property)&&typeof x.operator==='string'&&(x.values===undefined||Array.isArray(x.values)));
  if(!Array.isArray(value)||!value.every(row))return {valid:false};
  return {valid:true,value};
 }catch{return {valid:false};}
}
