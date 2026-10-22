import {env} from 'cloudflare:workers';
import {allowed} from '../../../lib/datafinder/mcp.mjs';
import {DataFinder,QueryError} from '../../../lib/datafinder/core.mjs';
import {cloudJobs} from '../../../lib/datafinder/jobs.mjs';
export async function POST(request:Request){
 if(!allowed(request,env))return Response.json({error:'需要本人登录。'},{status:401});
 const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)return Response.json({error:'来源不匹配。'},{status:403});
 try{const raw=await request.text();if(raw.length>24000)return Response.json({error:'请求过大。'},{status:413});const input=JSON.parse(raw);if(!['submit','retry','pause','resume','cancel','read_merged'].includes(input.action))return Response.json({error:'不支持此任务操作。'},{status:400});return Response.json(await cloudJobs(new DataFinder(env),input,request.headers.get('oai-authenticated-user-id')),{headers:{'Cache-Control':'no-store'}});}
 catch(e){return Response.json({error:e instanceof QueryError?e.message:'参数无效或恢复失败。',code:e instanceof QueryError?e.code:'INVALID_ARGUMENT'},{status:400,headers:{'Cache-Control':'no-store'}});}
}
