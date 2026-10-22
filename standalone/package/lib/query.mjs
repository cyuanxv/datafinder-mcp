import {APP,QueryError,extractDSL,normalizeReport,dateRange,reportId} from './core.mjs';
import {metricDefinition,definitionHash} from './definitions.mjs';
export function reportDatePlan(start,end){
 if(start===undefined&&end===undefined)return null;
 if(start===undefined||end===undefined)throw new QueryError('INVALID_DATE','开始与结束日期必须同时提供。');
 const range=dateRange(start,end);
 return {range,body:{global_filter:{period:{type:'range',range:[range.start_time,range.end_time],granularity:'day',timezone:range.timezone}}}};
}
export function expectedDays(range){const dates=[];for(let n=range.start_time;n<=range.end_time;n+=86400)dates.push(new Date(n*1000+28800000).toISOString().slice(0,10).replaceAll('-',''));return dates;}
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function verifyReportResults(results,reference,range,grouped=false){
 const issues=[],seen=new Set(),expected=new Map(reference.map(r=>[r.query_id,r]));
 if(!results.length)issues.push({code:'EMPTY_RESULT'});
 for(const r of results){
  if(!r.query_id||seen.has(r.query_id))issues.push({code:'DUPLICATE_OR_MISSING_QUERY_ID',query_id:r.query_id??null});
  seen.add(r.query_id);const baseline=expected.get(r.query_id);
  if(!baseline)issues.push({code:'UNEXPECTED_SUBQUERY',query_id:r.query_id});
  if(r.result_status!=='SUCCESS')issues.push({code:'SUBQUERY_NOT_SUCCESS',query_id:r.query_id,status:r.result_status??'unknown'});
  if(r.is_truncated===true)issues.push({code:'RESULT_TRUNCATED',query_id:r.query_id});
  if(range){
   const dates=r.date_index_list,days=expectedDays(range),interval=[`${range.start_date} 00:00:00-${range.end_date} 23:59:59`];
   const original=baseline?.date_index_list;
   const daily=Array.isArray(original)&&original.length>0&&original.every(d=>/^\d{8}$/.test(d));
   const whole=Array.isArray(original)&&original.length===1&&/^\d{4}-\d{2}-\d{2} 00:00:00-/.test(original[0]);
   if(!daily&&!whole)issues.push({code:'UNKNOWN_PERIOD_SHAPE',query_id:r.query_id});
   if(!same(dates,daily?days:whole?interval:null))issues.push({code:'DATE_RANGE_MISMATCH',query_id:r.query_id,expected:daily?days:interval,actual:dates??null});
  }
  const keys=(r.series??[]).map(s=>s.item_key),referenceKeys=(baseline?.series??[]).map(s=>s.item_key);
  if(keys.some(k=>!k)||new Set(keys).size!==keys.length)issues.push({code:'DUPLICATE_OR_MISSING_ITEM_KEY',query_id:r.query_id});
  // A saved report has fixed filters and no custom grouping in this release.
  for(const k of referenceKeys)if(!grouped&&!keys.includes(k))issues.push({code:'MISSING_SERIES',query_id:r.query_id,item_key:k});
  for(const s of r.series??[]){
   if(Array.isArray(s.data)&&s.data.length!==r.date_index_list?.length)issues.push({code:'SERIES_LENGTH_MISMATCH',query_id:r.query_id,item_key:s.item_key});
   if(!Array.isArray(s.data)&&!Array.isArray(s.details))issues.push({code:'MISSING_SERIES_DATA',query_id:r.query_id,item_key:s.item_key});
   if(Array.isArray(s.details)){
    if(!same(s.details.map(row=>row?.[0]),r.date_index_list))issues.push({code:'RETENTION_COHORT_MISMATCH',query_id:r.query_id,item_key:s.item_key});
    if(s.details.some(row=>!Array.isArray(row)||row.length<2||row.length>(r.header_list?.length??0)+2))issues.push({code:'RETENTION_MATRIX_SHAPE',query_id:r.query_id,item_key:s.item_key});
   }
  }
 }
 for(const id of expected.keys())if(!seen.has(id))issues.push({code:'MISSING_SUBQUERY',query_id:id});
 return {status:issues.length?'incomplete':'verified',issues,time_range_verified:!!range&&!issues.some(i=>['DATE_RANGE_MISMATCH','UNKNOWN_PERIOD_SHAPE','MISSING_SUBQUERY','UNEXPECTED_SUBQUERY','SUBQUERY_NOT_SUCCESS','EMPTY_RESULT','DUPLICATE_OR_MISSING_QUERY_ID'].includes(i.code))};
}
export function reportQuality(results,definition,now=Date.now()){
 const observations=results.map(r=>({query_id:r.query_id,result_status:r.result_status??'unknown',is_truncated:typeof r.is_truncated==='boolean'?r.is_truncated:'unknown',result_time:r.result_time??null,sampling_evidence:r.sample??null}));
 const ratios=results.flatMap(r=>(r.sample??[]).map(s=>s.sample_ratio)).filter(x=>typeof x==='number');
 const sampling=ratios.some(x=>x>0&&x<1)?'sampled':ratios.length&&ratios.every(x=>x===1)?'not_sampled':'unknown';
 const truncated=observations.some(o=>o.is_truncated===true)?true:observations.length&&observations.every(o=>o.is_truncated===false)?false:'unknown';
 const times=results.map(r=>r.result_time).filter(x=>Number.isFinite(x)&&x>0);
 const data_freshness={status:'unknown',reason:'result_time 是结果生成时间，不是数据入库完成水位。',oldest_result_at:times.length?new Date(Math.min(...times)).toISOString():null,latest_result_at:times.length?new Date(Math.max(...times)).toISOString():null};
 const today=new Date(now+28800000).toISOString().slice(0,10),retention=[];
 if(definition.query_type==='retention')for(const r of results){
  const windows=(r.header_list??[]).map(label=>({label,day:label==='次日'?2:/^第\d+日$/.test(label)?Number(label.slice(1,-1)):null}));
  retention.push({query_id:r.query_id,windows,window_status:windows.every(w=>w.day!==null)&&windows.length?'recognized':'unknown',cohorts:(r.date_index_list??[]).map(date=>{
   if(!/^\d{8}$/.test(date))return {date,status:'unknown'};
   const iso=`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`,start=Date.parse(`${iso}T00:00:00+08:00`);
   return {date:iso,last_calendar_complete_day:Math.max(0,Math.floor((Date.parse(`${today}T00:00:00+08:00`)-start)/86400000))};}),note:'自然日结束不证明入库完整；上游未返回的窗口与单元格保留未知，不补零。'});
 }
 return {sampling,truncated,data_freshness,source_observations:observations,retention_maturity:retention,quality_status:'requires_business_review'};
}
function protectZeroDenominators(results,definition){
 const notes=[];
 for(const r of results)for(const s of r.series){
  const formula=definition.metrics.find(m=>m.kind==='formula'&&m.formula_interpretation==='simple_ratio'&&m.label===(s.show_label??s.event_label));
  if(!formula)continue;
  const den=r.series.filter(x=>(x.show_label??x.event_label)===formula.denominator.label&&x.filter_label===s.filter_label&&same(x.group_by_key,s.group_by_key));
  if(den.length!==1||!Array.isArray(s.data)||!Array.isArray(den[0].data))continue;
  s.data=s.data.map((v,i)=>{if(den[0].data[i]===0){notes.push({query_id:r.query_id,item_key:s.item_key,date:r.date_index_list?.[i],reason:'zero_denominator',upstream_value:v});return null;}return v;});
  // Native sum/avg are not valid replacements for interval ratios.
  delete s.sum;delete s.avg;
 }
 return notes;
}
export async function querySavedReport(api,id,start,end,page=1,page_size=5,result_limit=100,metric_index){
 if(!Number.isInteger(result_limit)||result_limit<1||result_limit>1000)throw new QueryError('INVALID_LIMIT','result_limit须为1至1000。');
 reportId(id);const plan=reportDatePlan(start,end),wide=api.env.DATAFINDER_ALLOW_PROJECT_WIDE==='true';
 let saved,baselineAvailable=true,reducedLimit=false;
 try{saved=await api.report(id,{count:plan?1:result_limit});}catch(e){
  if(!['RESULT_TOO_LARGE','UPSTREAM_UNAVAILABLE'].includes(e.code))throw e;
  if(!plan){if(result_limit<=20)throw e;saved=await api.report(id,{count:20});reducedLimit=true;}
  else {saved=await requestDated(api,id,plan);baselineAvailable=false;}
 }
 const dsls=saved.data?.dsls;
 if(!Array.isArray(dsls)||!dsls.length)throw new QueryError('UNVERIFIED_CONTRACT','报表缺少可验证范围的 DSL。');
 const configs=dsls.map(d=>extractDSL({dsls:[d]},wide,true));
 if(metric_index!==undefined&&(dsls.length!==1||!['event','retention'].includes(configs[0].content.query_type)))throw new QueryError('UNSUPPORTED_QUERY','单指标选取只支持单份事件或留存报表。');
 if(dsls.length!==1||!['event','retention'].includes(configs[0].content.query_type))return queryNativeReport(api,id,saved,configs,plan,wide,page,page_size);
 const definition=await metricDefinition(saved.data,id,wide),reference=normalizeReport(saved.data,wide);
 let result=saved;
 if(plan&&baselineAvailable)result=await requestDated(api,id,plan);
 const data=normalizeReport(result.data,wide);
 // The POST response must still carry the original saved definition.
 if(await definitionHash(extractDSL(result.data,wide,true))!==definition.definition_version)throw new QueryError('DEFINITION_CHANGED','查询期间保存口径发生变化，拒绝把结果视为同口径；请重新查询。');
 const validation=verifyReportResults(data.results,reference.results,plan?.range,reference.results.some(r=>r.series.some(s=>s.group_by_key?.length))||!!configs[0].content.profile_groups_v2?.length||configs[0].content.queries?.flat().some(q=>q.groups_v2?.length)),zero_denominators=protectZeroDenominators(data.results,definition),q=reportQuality(data.results,definition);
 if(!baselineAvailable){validation.baseline='dated_response_only';validation.issues.push({code:'SAVED_BASELINE_UNAVAILABLE'});validation.status='incomplete';validation.time_range_verified=false;}
 if(result.query_count&&result.query_count<1000){validation.issues.push({code:'UPSTREAM_RESULT_LIMIT_REDUCED',count:result.query_count});validation.status='incomplete';}
 if(reducedLimit){validation.status='incomplete';validation.issues.push({code:'UPSTREAM_RESULT_LIMIT_REDUCED',count:20});}
 const formulaMetrics=definition.metrics.filter(m=>m.kind==='formula');
 let displayed=data.results;
 if(metric_index!==undefined){
  if(!Number.isInteger(metric_index)||metric_index<0||metric_index>=configs[0].content.queries.length)throw new QueryError('INVALID_PAGE','指标序号超出报表范围。');
  displayed=data.results.map(r=>({...r,series:r.series.filter(s=>{
   const match=/:q(\d+):/.exec(s.item_key??'');if(!match)throw new QueryError('UNVERIFIED_CONTRACT','报表返回的指标标识无法准确匹配，不按位置猜测。');
   return Number(match[1])===metric_index;
  })}));
  if(displayed.some(r=>!r.series.length)){validation.status='incomplete';validation.issues.push({code:'SELECTED_METRIC_MISSING',metric_index});}
 }
 const paginated=paginateResults(displayed,page,page_size);
 const output=api.output({data:{...data,results:paginated.results,pagination:{...paginated.pagination,upstream_limit:plan?(result.query_count??1000):reducedLimit?20:result_limit,upstream_has_more:q.truncated===true?'not_available_via_report_offset':'unknown'},metric_definition:definition,...(metric_index!==undefined?{selected_metric_index:metric_index,selection_scope:'原生报表整体计算与校验后，按item_key指标标识选取；保留区间去重与公式口径'}:{}),zero_denominators},log_id:result.log_id},{source_report_id:id,query_method:plan?'report_post_global_filter':'saved_report_get',resolved_time_range:plan?.range??data.results.map(r=>({query_id:r.query_id,dates:r.date_index_list})),time_range_verified:validation.time_range_verified,validation,...q,formula_source:formulaMetrics.length?'native_report_result':'no_saved_formula',saved_configuration_modified:baselineAvailable?false:'not_independently_checked',definition_version:definition.definition_version});
 // Metadata and zero-denominator notes also carry query_id; they are not subqueries.
 output.subquery_status=data.results.map(r=>({query_id:r.query_id,status:r.result_status??'unknown'}));
 output.status=data.results.some(r=>['failed','error','failure'].includes(String(r.result_status).toLowerCase()))?'partial_failure':validation.status==='verified'?'success':'incomplete';
 output.warnings=['需与控制台同口径核对；不跨日累加去重人数、不平均每日比率。','质量依据以上游字段为限；unknown 不代表正常，留存自然日结束不代表入库完成。',...definition.warnings,...(validation.issues.length?['结果校验未通过；不得当作完整日期范围或完整指标输出。']:[]),...(zero_denominators.length?['组合指标存在零分母，对应值已置 null。']:[])];
 if(definition.query_type==='retention'&&validation.issues.some(i=>i.code==='DATE_RANGE_MISMATCH'))output.warnings.push('留存接口未返回全部请求队列日期；近期队列可能尚未成熟，但缺失原因未独立确认，不补零或声称完整。');
 return output;
}

async function queryNativeReport(api,id,saved,configs,plan,wide,page,page_size){
 const response=plan?await requestDated(api,id,plan):saved;
 const returned=response.data?.dsls;
 if(!Array.isArray(returned)||returned.length!==configs.length)throw new QueryError('UNVERIFIED_CONTRACT','报表 DSL 数量发生变化。');
 const data=[];
 for(let i=0;i<returned.length;i++){
  const d=extractDSL({dsls:[returned[i]]},wide,true);
  if(await definitionHash(d)!==await definitionHash(configs[i]))throw new QueryError('DEFINITION_CHANGED','查询期间报表配置发生变化。');
  const nativeResults=returned[i].data;
  const p=Array.isArray(nativeResults)?paginateResults(nativeResults,page,page_size,true):null;
  data.push({query_type:d.content.query_type,periods:d.periods,scope:d.resources??{app_ids:d.app_ids},definition:d.content,results:p?.results??nativeResults,pagination:p?.pagination??{status:'unknown'}});
 }
 return api.output({data:{report_id:id,report_name:response.data.report_name,report_type:response.data.report_type,dsls:data},log_id:response.log_id},{query_method:plan?'report_post_global_filter':'saved_report_get',resolved_time_range:plan?.range??null,time_range_verified:false,validation:{status:'native_result_unverified',issues:[]},warnings:['返回此类报表的原生结果，不套用事件/留存结构；尚未独立校验其数值和日期边界。'],source_report_id:id});
}

export function paginateResults(results,page=1,page_size=5,native=false){
 if(!Number.isInteger(page)||page<1||!Number.isInteger(page_size)||page_size<1||page_size>20)throw new QueryError('INVALID_PAGE','page须为正整数，page_size须为1至20。');
 const start=(page-1)*page_size,metadata=[];
 const output=results.map(r=>{
  const key=native?'data_item_list':'series',series=r[key];if(!Array.isArray(series))return r;
  const retention=series.length>0&&series.every(s=>Array.isArray(s.details));
  if(retention){const total=r.date_index_list?.length??0;metadata.push({query_id:r.query_id,unit:'cohort_rows',total,has_more:start+page_size<total});return {...r,date_index_list:r.date_index_list?.slice(start,start+page_size),[key]:series.map(s=>({...s,details:s.details.slice(start,start+page_size)}))};}
  metadata.push({query_id:r.query_id,unit:'series',total:series.length,has_more:start+page_size<series.length});return {...r,[key]:series.slice(start,start+page_size)};
 });
 return {results:output,pagination:{page,page_size,has_more:metadata.some(m=>m.has_more),subqueries:metadata,note:'校验针对上游完整响应；本页仅显示部分系列/留存队列，按has_more继续翻页。'}};
}

async function requestDated(api,id,plan){
 for(const count of [1000,100,20]){try{const r=await api.request('POST',`/openapi/v1/${APP}/reports/${id}`,plan.body,{count},{maxBytes:8_000_000});return {...r,query_count:count};}catch(e){if(e.code!=='RESULT_TOO_LARGE'||count===20)throw e;}}
}
