import {runAnalysis} from '../../../lib/datafinder/analysis.mjs';
import {mappingImport} from '../../../lib/datafinder/mapping-import.mjs';
import {businessContracts} from '../../../lib/datafinder/business-contracts.mjs';
import {analysisWorkbench} from '../../../lib/datafinder/analysis-workbench.mjs';
import {mappedPlans} from '../../../lib/datafinder/mapped-plans.mjs';
import {queryTemplate} from '../../../lib/datafinder/templates.mjs';
import {trackingMapping} from '../../../lib/datafinder/tracking-mapping.mjs';
import {runDistribution} from '../../../lib/datafinder/distribution.mjs';
import {nativeMetadata} from '../../../lib/datafinder/native-metadata.mjs';
import {env} from 'cloudflare:workers';
import {allowed} from '../../../lib/datafinder/mcp.mjs';
import {DataFinder,QueryError} from '../../../lib/datafinder/core.mjs';
import {runInsight} from '../../../lib/datafinder/insights.mjs';
import {analysisSession} from '../../../lib/datafinder/analysis-session.mjs';
import {assessExperiment} from '../../../lib/datafinder/experiment.mjs';
export const dynamic='force-dynamic';
export async function POST(request:Request){
 if(!allowed(request,env))return Response.json({error:'需要本人登录。'},{status:401});
 const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)return Response.json({error:'来源不匹配。'},{status:403});
 try{const raw=await request.text();if(raw.length>24000)return Response.json({error:'请求过大。'},{status:413});const {operation,input}=JSON.parse(raw);const api=new DataFinder(env);let result;if(operation==='event_time')result=await runAnalysis(api,input);else if(operation==='mapping_import')result=await mappingImport(api,input,request.headers.get('oai-authenticated-user-id'));else if(operation==='business_contract')result=await businessContracts(api,input,request.headers.get('oai-authenticated-user-id'));else if(operation==='workbench')result=await analysisWorkbench(api,input,request.headers.get('oai-authenticated-user-id'));else if(operation==='mapped_plan')result=await mappedPlans(api,input,request.headers.get('oai-authenticated-user-id'));else if(operation==='template')result=await queryTemplate(api,input,request.headers.get('oai-authenticated-user-id'));else if(operation==='mapping')result=await trackingMapping(api,input,request.headers.get('oai-authenticated-user-id'));else if(operation==='metadata')result=await nativeMetadata(api,input,request.headers.get('oai-authenticated-user-id'));else if(operation==='session')result=await analysisSession(api,input,request.headers.get('oai-authenticated-user-id'));else if(operation==='experiment')result=assessExperiment(input);else if(operation==='distribution')result=await runDistribution(api,input);else if(operation==='query')result=await runInsight(api,input);else throw new QueryError('INVALID_ARGUMENT','未知操作。');return Response.json(result,{headers:{'Cache-Control':'no-store'}});}
 catch(e){return Response.json({error:e instanceof QueryError?e.message:'参数无效，请检查完整配置。',code:e instanceof QueryError?e.code:'INVALID_ARGUMENT'},{status:400,headers:{'Cache-Control':'no-store'}});}
}
