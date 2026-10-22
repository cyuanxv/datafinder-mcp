import {env} from 'cloudflare:workers';
import {allowed} from '../../../lib/datafinder/mcp.mjs';
import {DataFinder} from '../../../lib/datafinder/core.mjs';
import {readOperations} from '../../../lib/datafinder/operations.mjs';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 if(!allowed(request,env))return Response.json({error:'需要本人登录。'},{status:401});
 try{const input=Object.fromEntries(new URL(request.url).searchParams);return Response.json(await readOperations(new DataFinder(env),{...input,limit:input.limit?Number(input.limit):20},request.headers.get('oai-authenticated-user-id')),{headers:{'Cache-Control':'no-store'}});}
 catch{return Response.json({error:'运行记录读取失败，请核对任务ID或稍后重试。'},{status:503,headers:{'Cache-Control':'no-store'}});}
}
