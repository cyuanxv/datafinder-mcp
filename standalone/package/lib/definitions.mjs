import {extractDSL,REPORTS,reportId,QueryError} from './core.mjs';

const pick=(v,keys)=>Object.fromEntries(keys.filter(k=>v?.[k]!==undefined).map(k=>[k,v[k]]));
const indicators={event_users:{unit:'人',identity_rule:'按 DataFinder 当前统计主体去重；日趋势逐日去重，区间汇总整段去重'},events:{unit:'次',identity_rule:'事件触发次数'},events_per_user:{unit:'次/人',identity_rule:'事件次数 / 事件去重人数'}};
function eventDefinition(q,label){
 const known=indicators[q.event_indicator];
 return {label:q.show_label||label,name:q.show_name||q.event_name||'未命名指标',event_name:q.event_name??null,event_type:q.event_type??null,indicator:q.event_indicator??null,indicator_name:q.indicator_show_name||null,unit:known?.unit??'unknown',identity_rule:known?.identity_rule??'unknown',measure_info:q.measure_info??{},filters:q.filters??[],groups:q.groups_v2??[],condition:q.condition??null};
}
// Fingerprint only definition fields, never response data or account identities.
function canonical(v){if(Array.isArray(v))return v.map(canonical);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]));return v;}
export async function definitionHash(dsl){
 const config=pick(dsl,['version','resources','app_ids','periods','content']);
 // Report count controls response pagination, not the metric definition.
 config.content={...config.content};delete config.content.page;
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(canonical(config))));
 return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
}
export async function metricDefinition(report,id,wide=false){
 reportId(id);const dsl=extractDSL(report,wide,true),content=dsl.content,queries=content.queries??[];
 if(!['event','retention'].includes(content.query_type)||!Array.isArray(queries)||!queries.length||queries.some(q=>!Array.isArray(q)||!q.length))return {report_id:id,report_name:report.report_name,query_type:content.query_type,definition_status:'saved_configuration_not_business_approved',definition_version:await definitionHash(dsl),scope:dsl.resources??{app_ids:dsl.app_ids},periods:dsl.periods,metrics:[],content,warnings:['此类指标返回原生配置，不套用事件或留存公式解释。']};
 const metrics=[];const warnings=['名称仅为已保存标签；业务含义仍需按事件、筛选与公式核对。'];
 if(content.query_type==='retention'){
  for(const group of queries){
   if(group.length!==2)throw new QueryError('UNVERIFIED_CONTRACT','暂不解释非双事件留存定义。');
   const first=eventDefinition(group[0],null),back=eventDefinition(group[1],null);
   metrics.push({kind:'retention',label:first.label,name:group[0].extra?.query_name||first.name,initial_event:first,return_event:back,numerator:'起始队列中在相应留存窗口满足回访事件的去重人数',denominator:'满足起始事件及队列筛选的去重人数',unit:'ratio',ratio_scale:'0_to_1',retention_target:content.option?.retention_target??null,lost:content.option?.lost??null,identity_rule:'沿用 DataFinder 留存统计主体与窗口配置；不跨队列直接平均比率'});
  }
 }else{
  for(const group of queries){for(const q of group){
   if(q.formula){const match=/^\s*([A-Za-z]+)\s*\/\s*([A-Za-z]+)\s*$/.exec(q.formula);
    const resolve=label=>{const found=queries.flat().filter(x=>!x.formula&&x.show_label===label);return found.length===1?eventDefinition(found[0],label):null;};
    const numerator=match?resolve(match[1]):null,denominator=match?resolve(match[2]):null;
    metrics.push({kind:'formula',label:q.show_label??null,name:q.show_name||q.show_label||'未命名组合指标',formula:q.formula,unit:q.combination_format==='percent_decimal'?'ratio':'unknown',display_format:q.combination_format??'unknown',numerator,denominator,formula_interpretation:numerator&&denominator?'simple_ratio':'raw_formula_only',calculation_source:'DataFinder 报表接口；不自行执行任意表达式'});
   }else metrics.push({kind:'event',...eventDefinition(q,null)});
  }}
  if(!metrics.some(m=>m.kind==='formula'))warnings.push('报表没有保存组合公式；即使标题含“率”，也不自动生成分子/分母。');
 }
 const dependencies=new Set();function walk(v){if(!v||typeof v!=='object')return;if(typeof v.event_name==='string')dependencies.add(v.event_name);for(const x of Object.values(v))walk(x);}walk(content);
 return {report_id:id,report_name:report.report_name||id,query_type:content.query_type,definition_status:'saved_configuration_not_business_approved',definition_version:await definitionHash(dsl),scope:dsl.resources??{app_ids:dsl.app_ids},statistics_subject:content.option?.analysis_subject??{},subject_description:'沿用已保存统计主体；空配置代表平台默认，身份合并规则未独立核验',periods:dsl.periods,metrics,cohort_filters:content.profile_filters??[],groups:content.profile_groups_v2??[],event_dependencies:[...dependencies].sort(),warnings,content:pick(content,['query_type','queries','profile_filters','profile_groups_v2','option']),summary_rules:['区间 UV 读取区间结果，不累加每日 UV。','区间比率读取原生公式结果，不平均每日比率。','留存空值、未成熟窗口与零分母均不得补零。']};
}
