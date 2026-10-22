import {AsyncLocalStorage} from 'node:async_hooks';
import {z} from 'zod/v4';
import {DataFinder,QueryError} from './lib/core.mjs';
import {createDataFinderServer} from './lib/mcp.mjs';
import {aggregateExport} from './lib/export.mjs';
import {inspectionSchedules} from './lib/schedules.mjs';
import {openDatabase} from './database.mjs';
import {createPolicy} from './policy.mjs';
export function createRuntime({filename,owner,env,fetcher=fetch,token,baseURL}){
 const context=new AsyncLocalStorage();
 const writable=env.DATAFINDER_ALLOW_LOCAL_WRITES==='true';
 const db=openDatabase(filename,()=>context.getStore()?.canWrite===true);
 const demo=env.DATAFINDER_DEMO==='true';
 const settings={...env,...(demo?{DATAFINDER_AK:'fictional-ak',DATAFINDER_SK:'fictional-sk'}:{}),DATAFINDER_OWNER_USER_ID:owner,DB:db};
 class LocalFinder extends DataFinder{
  output(result,extra={}){return {...super.output(result,extra),synthetic:demo};}
  async request(method,path,body,params,options){
   if(options?.mutation&&(settings.DATAFINDER_ALLOW_UPSTREAM_WRITES!=='true'||!context.getStore()?.canWrite))throw new QueryError('UPSTREAM_READ_ONLY','DataFinder 上游修改默认禁用，需要单独启用并确认；不会修改上游报表。');
   return super.request(method,path,body,params,options);
  }
 }
 const fresh=()=>new LocalFinder(settings,fetcher);
 const proxy=new Proxy({}, {get(_target,key){const api=context.getStore()?.api;if(key==='env')return settings;if(!api)throw Error('Missing request context');const value=api[key];return typeof value==='function'?value.bind(api):value;}});
 const policy=createPolicy(db,owner,writable,context,env.DATAFINDER_ALLOW_UPSTREAM_WRITES==='true');
 function links(value){if(!value||typeof value!=='object')return value;for(const [key,v]of Object.entries(value)){if(key==='execution'&&v==='cloud_dispatch_required'){value[key]='standalone_worker_required';}else if(key==='dispatch'&&v==='requires_linked_cloud_schedule'){value[key]='requires_standalone_worker';}else if(key==='download_url'&&typeof v==='string'){const url=new URL(v);if(url.origin===baseURL&&url.pathname==='/api/export'){url.searchParams.set('_access',token);value[key]=url.href;value.requires_owner_login=false;value.requires_local_access_token=true;}}else if(v&&typeof v==='object')links(v);}return value;}
 return {db,owner,writable,
  server(){return createDataFinderServer(new Request('http://localhost/stdio',{headers:{'oai-authenticated-user-id':owner}}),settings,fetcher,{
   api:proxy,name:'datafinder-mcp',version:'0.2.0',runtime:'standalone',readOnly:!writable,
   confirmationShape:{installation_confirmation:z.string().uuid().optional(),installation_confirmed:z.literal(true).optional()},
   describe:(_name,description,write)=>description+(write?' 独立安装版：修改先返回installation_preview；展示后用installation_confirmed和installation_confirmation确认。原有业务确认仍需提供。':''),
   invoke:async(name,args,fn,write)=>context.run({api:fresh(),canWrite:false},async()=>{const result=links(await policy(name,args,fn,write));if(result&&typeof result==='object'){Object.assign(result,{installation_mode:demo?'demo':'live',synthetic:demo});if(name==='get_connection_status')Object.assign(result,{storage:'sqlite',local_writes_enabled:writable,upstream_writes_enabled:env.DATAFINDER_ALLOW_UPSTREAM_WRITES==='true',background_worker:'separate_process_required'});if(name==='read_operations')result.local_worker_history=db.raw.prepare('SELECT id,started,finished,status,error_code FROM standalone_workers WHERE owner=? ORDER BY started DESC LIMIT 20').all(owner).map(r=>({...r}));}return result;})
  });},
  async export(input){delete input._access;return context.run({api:fresh(),canWrite:false},()=>aggregateExport(proxy,input,owner));},
  async tick(){if(!writable)throw new QueryError('READ_ONLY','后台任务需要显式启用本地修改以保存任务与结果。');return context.run({api:fresh(),canWrite:true},()=>inspectionSchedules(proxy,{action:'tick'},owner));},
  close(){db.close();}
 };
}
