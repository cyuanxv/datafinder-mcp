import {env} from 'cloudflare:workers';
import {allowed} from '../../../lib/datafinder/mcp.mjs';
import {DataFinder,QueryError} from '../../../lib/datafinder/core.mjs';
import {aggregateExport} from '../../../lib/datafinder/export.mjs';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 if(!allowed(request,env))return Response.json({error:'需要本人登录。'},{status:401});
 try{const result=await aggregateExport(new DataFinder(env),Object.fromEntries(new URL(request.url).searchParams),request.headers.get('oai-authenticated-user-id'));return new Response(result.body,{headers:{'Content-Type':result.content_type,'Content-Disposition':`attachment; filename="${result.filename}"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});}
 catch(e){return Response.json({error:e instanceof QueryError?e.message:'导出失败，请检查参数。'},{status:400,headers:{'Cache-Control':'no-store'}});}
}
