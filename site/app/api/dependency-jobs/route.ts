import {env} from 'cloudflare:workers';
import {allowed} from '../../../lib/datafinder/mcp.mjs';
import {DataFinder,QueryError} from '../../../lib/datafinder/core.mjs';
import {dependencyJobs} from '../../../lib/datafinder/operations.mjs';
export async function POST(request:Request){
 if(!allowed(request,env))return Response.json({error:'需要本人登录。'},{status:401});
 const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)return Response.json({error:'来源不匹配。'},{status:403});
 try{const raw=await request.text();if(raw.length>2000)return Response.json({error:'请求过大。'},{status:413});const input=JSON.parse(raw);if(input.action!=='submit')return Response.json({error:'仅支持提交扫描。'},{status:400});return Response.json(await dependencyJobs(new DataFinder(env),input,request.headers.get('oai-authenticated-user-id')),{headers:{'Cache-Control':'no-store'}});}
 catch(e){return Response.json({error:e instanceof QueryError?e.message:'参数无效或提交失败，请重试。'},{status:400,headers:{'Cache-Control':'no-store'}});}
}
