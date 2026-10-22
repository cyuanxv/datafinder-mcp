import {manageAnomaly} from '../../../lib/datafinder/anomaly-handling.mjs';
import {env} from 'cloudflare:workers';
import {allowed} from '../../../lib/datafinder/mcp.mjs';
import {DataFinder,QueryError} from '../../../lib/datafinder/core.mjs';
import {readAnomalies} from '../../../lib/datafinder/anomalies.mjs';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 if(!allowed(request,env))return Response.json({error:'需要本人登录。'},{status:401});
 try{return Response.json(await readAnomalies(new DataFinder(env),{...Object.fromEntries(new URL(request.url).searchParams),limit:Number(new URL(request.url).searchParams.get('limit')??20)},request.headers.get('oai-authenticated-user-id')),{headers:{'Cache-Control':'no-store'}});}
 catch(e){return Response.json({error:e instanceof QueryError?e.message:'参数无效或记录读取失败。',code:e instanceof QueryError?e.code:'INVALID_ARGUMENT'},{status:400,headers:{'Cache-Control':'no-store'}});}
}

export async function POST(request:Request){
 if(!allowed(request,env))return Response.json({error:'需要本人登录。'},{status:401});
 const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)return Response.json({error:'来源不匹配。'},{status:403});
 try{const raw=await request.text();if(raw.length>12000)return Response.json({error:'请求过大。'},{status:413});return Response.json(await manageAnomaly(new DataFinder(env),JSON.parse(raw),request.headers.get('oai-authenticated-user-id')),{headers:{'Cache-Control':'no-store'}});}
 catch(e){return Response.json({error:e instanceof QueryError?e.message:'参数无效或操作失败。',code:e instanceof QueryError?e.code:'INVALID_ARGUMENT'},{status:400,headers:{'Cache-Control':'no-store'}});}
}
