import {env} from 'cloudflare:workers';
import {allowed} from '../../../lib/datafinder/mcp.mjs';
import {DataFinder,QueryError} from '../../../lib/datafinder/core.mjs';
import {metricDictionary} from '../../../lib/datafinder/dictionary.mjs';
export const dynamic='force-dynamic';
export async function POST(request:Request){
 if(!allowed(request,env))return Response.json({error:'需要本人登录。'},{status:401});
 const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)return Response.json({error:'来源不匹配。'},{status:403});
 try{const raw=await request.text();if(raw.length>32000)return Response.json({error:'请求过大，请拆分批次。'},{status:413});const result=await metricDictionary(new DataFinder(env),JSON.parse(raw),request.headers.get('oai-authenticated-user-id'));return Response.json(result,{headers:{'Cache-Control':'no-store'}});}
 catch(e){return Response.json({error:e instanceof QueryError?e.message:'参数无效，请检查必填字段。',code:e instanceof QueryError?e.code:'INVALID_ARGUMENT'},{status:400,headers:{'Cache-Control':'no-store'}});}
}
