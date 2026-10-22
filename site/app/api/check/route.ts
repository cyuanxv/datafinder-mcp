import {env} from 'cloudflare:workers';
import {allowed} from '../../../lib/datafinder/mcp.mjs';
import {DataFinder,normalizeReport,QueryError} from '../../../lib/datafinder/core.mjs';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 if(!allowed(request,env))return Response.json({error:'需要本人登录。'},{status:401});
 const config=env as unknown as Record<string,string>;
 try{
  const api=new DataFinder(config);
  const r=await api.report('8900000000000000007');
  const report=normalizeReport(r.data,config.DATAFINDER_ALLOW_PROJECT_WIDE==='true');
  const statuses=report.results.map((x:Record<string,unknown>)=>({query_id:x.query_id,status:x.result_status}));
  return Response.json({runtime:'cloud',requires_local_computer:false,report:'游戏页面渗透率',subqueries:statuses,query_success:statuses.length>0&&statuses.every((s:{status:unknown})=>s.status==='SUCCESS'),checked_at:new Date().toISOString(),note:'本项验证云端直连 DataFinder；ChatGPT 插件连接与控制台数值一致性分别验收。'},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return Response.json({error:e instanceof QueryError?e.message:'查询失败，请稍后重试。'},{status:502,headers:{'Cache-Control':'no-store'}});}
}
