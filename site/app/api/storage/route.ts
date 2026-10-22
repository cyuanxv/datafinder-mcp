import {env} from 'cloudflare:workers';
import {allowed} from '../../../lib/datafinder/mcp.mjs';
import {DataFinder,QueryError} from '../../../lib/datafinder/core.mjs';
import {storageOverview} from '../../../lib/datafinder/storage.mjs';
export const dynamic='force-dynamic';
export async function POST(request:Request){
 if(!allowed(request,env))return Response.json({error:'需要本人登录。'},{status:401});
 const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)return Response.json({error:'来源不匹配。'},{status:403});
 try{const raw=await request.text();if(raw.length>24000)return Response.json({error:'请求过大。'},{status:413});return Response.json(await storageOverview(new DataFinder(env),JSON.parse(raw),request.headers.get('oai-authenticated-user-id')),{headers:{'Cache-Control':'no-store'}});}
 catch(e){return Response.json({error:e instanceof QueryError?e.message:'参数无效，请检查配置格式。',code:e instanceof QueryError?e.code:'INVALID_ARGUMENT'},{status:400,headers:{'Cache-Control':'no-store'}});}
}
