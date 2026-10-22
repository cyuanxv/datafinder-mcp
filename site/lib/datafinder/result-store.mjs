import {QueryError} from './core.mjs';
const bytes=s=>new TextEncoder().encode(s).byteLength;
export const MAX_RESULT_BYTES=2*1024*1024, MAX_JOB_BYTES=8*1024*1024;
export async function textHash(s){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
export async function storeOutput(db,owner,output){
 const text=JSON.stringify(output),size=bytes(text);
 if(size>MAX_RESULT_BYTES)throw new QueryError('RESULT_TOO_LARGE','单个结果超过2MiB，请按上游支持的分页缩小查询。');
 if(size<=2000)return {output};
 const id=crypto.randomUUID(),parts=[];let part='',length=0;
 for(const c of text){const n=bytes(c);if(length+n>24000){parts.push(part);part='';length=0;}part+=c;length+=n;}if(part)parts.push(part);
 const hashes=await Promise.all(parts.map(textHash));
 // Immutable chunks precede the pointer. A lost lease can leave unreachable chunks, never a partial published result.
 for(let i=0;i<parts.length;i+=20)await db.batch(parts.slice(i,i+20).map((body,j)=>db.prepare('INSERT INTO result_chunks(owner,result_id,page,body,sha256) VALUES(?,?,?,?,?)').bind(owner,id,i+j+1,body,hashes[i+j])));
 return {output_ref:{result_id:id,pages:parts.length,bytes:size,sha256:await textHash(text),encoding:'json_utf8_fragments',note:'按页序连接text后解析JSON；分块不是业务行分页。'}};
}
export async function readChunk(db,owner,ref,page){
 if(!Number.isInteger(page)||page<1||page>ref.pages)throw new QueryError('INVALID_ARGUMENT','结果页超出范围。');
 const r=await db.prepare('SELECT body,sha256 FROM result_chunks WHERE owner=? AND result_id=? AND page=?').bind(owner,ref.result_id,page).first();
 if(!r||await textHash(r.body)!==r.sha256)throw new QueryError('RESULT_CORRUPT','结果分块缺失或校验失败。');
 return {page,total_pages:ref.pages,text:r.body,page_sha256:r.sha256,sha256:ref.sha256,has_more:page<ref.pages,next_page:page<ref.pages?page+1:null,encoding:ref.encoding};
}
export async function hydrateOutput(db,owner,result){
 if(!result.output_ref)return result.output;
 const ref=result.output_ref,parts=[];for(let p=1;p<=ref.pages;p++)parts.push((await readChunk(db,owner,ref,p)).text);
 const text=parts.join('');if(bytes(text)!==ref.bytes||await textHash(text)!==ref.sha256)throw new QueryError('RESULT_CORRUPT','结果整体校验失败。');return JSON.parse(text);
}
export async function hydrateJob(db,owner,job){return {...job,results:await Promise.all(job.results.map(async r=>({...r,output:await hydrateOutput(db,owner,r)})))};}
