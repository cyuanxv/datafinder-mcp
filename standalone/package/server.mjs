#!/usr/bin/env node
import {createServer} from 'node:http';
import {randomBytes,timingSafeEqual,randomUUID} from 'node:crypto';
import {homedir} from 'node:os';
import {resolve,join} from 'node:path';
import {readFileSync,existsSync,writeFileSync,mkdirSync} from 'node:fs';
import {serveStdio} from '@modelcontextprotocol/server/stdio';
process.umask(0o077);
const argv=process.argv.slice(2);
if(argv.some(a=>!['--worker','--once','--help'].includes(a))){process.stderr.write('Unknown argument. Use --help.\n');process.exit(1);}
if(argv.includes('--help')){console.log('datafinder-mcp [--worker [--once]]\n52 tools over stdio. DATAFINDER_DB_PATH chooses an independent SQLite database. Local writes and upstream writes default off. See README.');process.exit(0);}
const worker=argv.includes('--worker');
const filename=resolve(process.env.DATAFINDER_DB_PATH??join(homedir(),'.local/share/datafinder-mcp/workbench.sqlite'));
const owner=process.env.DATAFINDER_LOCAL_OWNER??'local-owner';
if(!/^[a-zA-Z0-9._-]{1,80}$/.test(owner))throw Error('Invalid local owner');
if(process.env.DATAFINDER_DEMO!=='true'&&(!process.env.DATAFINDER_AK||!process.env.DATAFINDER_SK)){
 process.stderr.write('Missing DataFinder credentials; use DATAFINDER_DEMO=true for fictional data.\n');process.exit(1);
}
if(worker&&process.env.DATAFINDER_ALLOW_LOCAL_WRITES!=='true'){
 process.stderr.write('Worker requires DATAFINDER_ALLOW_LOCAL_WRITES=true to persist jobs and results.\n');process.exit(1);
}
let runtime,http,handle,closing=false,active=Promise.resolve();
const token=randomBytes(32).toString('hex');
if(!worker){
 http=createServer(async(req,res)=>{
  const origin=process.env.DATAFINDER_LOCAL_BASE_URL;
  if(!origin||req.headers.host!==new URL(origin).host){res.writeHead(403);res.end('Forbidden');return;}
  let url;try{url=new URL(req.url,origin);}catch{res.writeHead(400);res.end('Invalid URL');return;}
  const access=url.searchParams.get('_access')??req.headers.authorization?.replace(/^Bearer /,'')??'';
  if(typeof access!=='string'||!/^[a-f0-9]{64}$/.test(access)||!timingSafeEqual(Buffer.from(access),Buffer.from(token))){res.writeHead(401,{'Cache-Control':'no-store'});res.end('Local access token required');return;}
  if(req.method!=='GET'||url.pathname!=='/api/export'||req.url.length>2048){res.writeHead(404);res.end('Not found');return;}
  try{const result=await runtime.export(Object.fromEntries(url.searchParams));const response=new Response(result.body);res.writeHead(200,{'Content-Type':result.content_type,'Content-Disposition':`attachment; filename="${result.filename}"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(Buffer.from(await response.arrayBuffer()));}
  catch{res.writeHead(400,{'Cache-Control':'no-store'});res.end('Export unavailable; check the result ID and owner.');}
 });
 const port=Number(process.env.DATAFINDER_EXPORT_PORT??0);if(!Number.isInteger(port)||port<0||port>65535)throw Error('Invalid export port');
 await new Promise((resolve,reject)=>{http.once('error',reject);http.listen(port,'127.0.0.1',resolve);});
 process.env.DATAFINDER_LOCAL_BASE_URL=`http://127.0.0.1:${http.address().port}`;
}
const {createRuntime}=await import('./runtime.mjs');
const {dispatchFailed}=await import('./lib/schedules.mjs');
let fetcher=fetch;
if(process.env.DATAFINDER_DEMO==='true'){
 const {fixtureFetch}=await import('./fixture.mjs');fetcher=fixtureFetch;
}
runtime=createRuntime({filename,owner,env:process.env,fetcher,token,baseURL:process.env.DATAFINDER_LOCAL_BASE_URL});
async function close(){if(closing)return;closing=true;await active.catch(()=>{});await handle?.close();await new Promise(resolve=>http?http.close(resolve):resolve());runtime.close();}
process.once('SIGTERM',()=>close().then(()=>process.exit(0)));process.once('SIGINT',()=>close().then(()=>process.exit(0)));
if(worker){
 const interval=Number(process.env.DATAFINDER_WORKER_INTERVAL_MS??60000);if(!Number.isInteger(interval)||interval<1000)throw Error('Worker interval must be at least 1000 ms');
 async function tick(){const id=randomUUID();runtime.db.raw.prepare('INSERT INTO standalone_workers(id,started,status,owner) VALUES(?,?,?,?)').run(id,Date.now(),'running',runtime.owner);
  try{const result=await runtime.tick();const state=dispatchFailed(result)?'task_failed':'completed';runtime.db.raw.prepare('UPDATE standalone_workers SET finished=?,status=? WHERE id=?').run(Date.now(),state,id);}
  catch(e){runtime.db.raw.prepare('UPDATE standalone_workers SET finished=?,status=?,error_code=? WHERE id=?').run(Date.now(),'failed',e.code??'WORKER_FAILED',id);process.stderr.write('Background tick failed; see local worker history.\n');}
 }
 do{active=tick();await active;if(argv.includes('--once'))break;await new Promise(resolve=>{const stop=()=>{clearTimeout(timer);resolve();};const timer=setTimeout(()=>{process.removeListener('SIGTERM',stop);resolve();},interval);process.once('SIGTERM',stop);});}while(!closing);
 await close();
}else{
 handle=await serveStdio(()=>runtime.server(),{onerror:()=>process.stderr.write('MCP transport error.\n')});
 process.stdin.once('end',()=>close());
}
