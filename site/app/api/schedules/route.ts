import {env} from 'cloudflare:workers';
import {allowed} from '../../../lib/datafinder/mcp.mjs';
import {DataFinder,QueryError} from '../../../lib/datafinder/core.mjs';
import {inspectionSchedules} from '../../../lib/datafinder/schedules.mjs';
import {readRecords} from '../../../lib/datafinder/governance.mjs';
export async function GET(request:Request){
 if(!allowed(request,env))return Response.json({error:'需要本人登录。'},{status:401});
 try{const api=new DataFinder(env),owner=request.headers.get('oai-authenticated-user-id'),params=new URL(request.url).searchParams;
 const result=params.get('rules')==='true'?await readRecords(api,{kind:'rule',page:Number(params.get('page')??1)},owner):await inspectionSchedules(api,{action:'list'},owner);
 return Response.json(result,{headers:{'Cache-Control':'no-store'}});
 }catch{return Response.json({error:'读取失败。'},{status:400});}
}
export async function POST(request:Request){
 if(!allowed(request,env))return Response.json({error:'需要本人登录。'},{status:401});
 const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)return Response.json({error:'来源不匹配。'},{status:403});
 try{const raw=await request.text();if(raw.length>10000)return Response.json({error:'请求过大。'},{status:413});const input=JSON.parse(raw);
 if(!['save','preview_backfill','backfill','preview_upgrade','upgrade'].includes(input.action))return Response.json({error:'不支持此计划操作。'},{status:400});
 return Response.json(await inspectionSchedules(new DataFinder(env),input,request.headers.get('oai-authenticated-user-id')),{headers:{'Cache-Control':'no-store'}});
 }catch(e){return Response.json({error:e instanceof QueryError?e.message:'参数无效或操作失败。',code:e instanceof QueryError?e.code:'INVALID_ARGUMENT'},{status:400,headers:{'Cache-Control':'no-store'}});}
}
