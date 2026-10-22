import {distributionShape,validateDistribution,runDistribution} from './distribution.mjs';
import {funnelShape,funnelPlan,runFunnel} from './funnel.mjs';
import {trackingMapping,mappedQuerySchema} from './tracking-mapping.mjs';
import {filterSchema} from './analysis.mjs';
import {z} from 'zod/v4';
import {database,record,metricSource} from './governance.mjs';
import {QueryError,dateRange} from './core.mjs';
import {analysisShape,freePlan,modifiers,runAnalysis,queryReportAdaptive} from './analysis.mjs';
import {advancedShape,advancedPlan,runAdvanced} from './advanced.mjs';
const key=z.string().min(1).max(80).regex(/^[\w.-]+$/);
const reportConfig=z.object({report_id:z.string(),metric_index:z.number().int().min(0).max(99).optional(),...modifiers,page:z.number().int().min(1).max(1000).default(1),page_size:z.number().int().min(1).max(20).default(5),metric_page:z.number().int().min(1).max(100).default(1),result_limit:z.number().int().min(1).max(1000).default(100)}).strict();
const analysisConfig=z.object(analysisShape).omit({start_date:true,end_date:true}).strict();
const advancedConfig=z.object(advancedShape).omit({start_date:true,end_date:true}).strict();
export const templateSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('report'),config:reportConfig,source_version:z.string().length(64)}).strict(),
 z.object({kind:z.literal('analysis'),config:analysisConfig}).strict(),
 z.object({kind:z.literal('advanced'),config:advancedConfig}).strict(),
 z.object({kind:z.literal('distribution'),config:z.object(distributionShape).omit({start_date:true,end_date:true}).strict()}).strict(),
 z.object({kind:z.literal('funnel'),config:z.object(funnelShape).omit({start_date:true,end_date:true}).strict()}).strict(),
 z.object({kind:z.literal('mapped'),config:z.object({key,revision:z.number().int().positive(),query:z.lazy(()=>mappedQuerySchema.omit({period:true,baseline:true})),extra_filters:z.array(filterSchema).max(10).default([])}).strict()}).strict()
]);
export const templateShape={action:z.enum(['save','read','run','list']),key:key.optional(),name:z.string().trim().min(1).max(100).optional(),expected_revision:z.number().int().min(0).optional(),template:templateSchema.optional(),confirmed:z.literal(true).optional(),start_date:z.string().optional(),end_date:z.string().optional(),page:z.number().int().min(1).max(1000).default(1),keyword:z.string().max(100).default('')};
export async function queryTemplate(api,input,owner,executors={report:queryReportAdaptive,analysis:runAnalysis,advanced:runAdvanced,distribution:runDistribution,funnel:runFunnel}){
 const a=z.object(templateShape).strict().parse(input),db=database(api,owner);
 if(a.action==='list'){
  const r=await db.prepare("SELECT g.* FROM governance_records g WHERE owner=? AND kind='template' AND revision=(SELECT MAX(revision) FROM governance_records v WHERE v.owner=g.owner AND v.kind=g.kind AND v.record_key=g.record_key) AND (instr(lower(record_key),lower(?))>0 OR instr(lower(json_extract(body,'$.name')),lower(?))>0) ORDER BY record_key LIMIT 21 OFFSET ?").bind(owner,a.keyword,a.keyword,(a.page-1)*20).all();
  return {items:r.results.slice(0,20).map(r=>({key:r.record_key,revision:r.revision,value:JSON.parse(r.body)})),has_more:r.results.length>20};
 }
 if(!a.key)throw new QueryError('INVALID_ARGUMENT','请指定模板key。');
 if(a.action==='save'){
  if(!a.confirmed||!a.template||!a.name||a.expected_revision===undefined)throw new QueryError('INVALID_ARGUMENT','保存需要完整模板、名称、版本和确认。');
  if(a.template.kind==='report'&&(await metricSource(api,a.template.config.report_id)).source_version!==a.template.source_version)throw new QueryError('VERSION_CONFLICT','报表口径已变化。');
  if(a.template.kind==='mapped'){const m=await record(api,owner,'tracking_mapping',a.template.config.key,a.template.config.revision);if(m.value.state!=='published')throw new QueryError('MAPPING_NOT_PUBLISHED','模板必须绑定明确的发布版本。');}
  if(a.template.kind==='distribution')validateDistribution({...a.template.config,start_date:'2020-01-01',end_date:'2020-01-01'});
  if(a.template.kind==='funnel')funnelPlan({...a.template.config,start_date:'2020-01-01',end_date:'2020-01-01'},true);
  if(a.template.kind==='advanced')advancedPlan({...a.template.config,start_date:'2020-01-01',end_date:'2020-01-01'},true);
  if(a.template.kind==='analysis'&&!a.template.config.report_id)freePlan({...a.template.config,start_date:'2020-01-01',end_date:'2020-01-01'},true,true);
  const body=JSON.stringify({name:a.name,...a.template});if(body.length>16000)throw new QueryError('RESULT_TOO_LARGE','请缩小模板。');
  const r=await db.prepare("INSERT INTO governance_records(owner,kind,record_key,revision,body,created_at) SELECT ?,'template',?,?,?,? WHERE COALESCE((SELECT MAX(revision) FROM governance_records WHERE owner=? AND kind='template' AND record_key=?),0)=?").bind(owner,a.key,a.expected_revision+1,body,Date.now(),owner,a.key,a.expected_revision).run();
  if(r.meta?.changes!==1)throw new QueryError('VERSION_CONFLICT','模板已更新，请读取最新版本。');
  return {...await record(api,owner,'template',a.key),status:'saved'};
 }
 const r=await record(api,owner,'template',a.key);let source_status='not_applicable';
 if(r.value.kind==='report')source_status=(await metricSource(api,r.value.config.report_id)).source_version===r.value.source_version?'unchanged':'drifted';
 if(a.action==='read')return {...r,source_status};
 if(r.revision!==a.expected_revision||source_status==='drifted')throw new QueryError('VERSION_CONFLICT','模板或来源已变化，请重新读取确认。');
 if(!a.start_date||!a.end_date)throw new QueryError('INVALID_ARGUMENT','执行需明确起止日期。');dateRange(a.start_date,a.end_date);
 const output=r.value.kind==='mapped'?await trackingMapping(api,{action:'run',...r.value.config,query:{...r.value.config.query,period:{start_date:a.start_date,end_date:a.end_date}}},owner):await executors[r.value.kind](api,{...r.value.config,start_date:a.start_date,end_date:a.end_date});
 return {template_key:r.key,template_revision:r.revision,source_status,output};
}
