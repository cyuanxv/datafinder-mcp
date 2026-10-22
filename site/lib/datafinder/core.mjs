// DataFinder signature contract: official Python SDK d2422dcb, dsl_sign.py.
export class QueryError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const safeLogId = (value, secrets=[]) => typeof value==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) && !secrets.some(secret=>secret&&value.includes(secret)) ? value : '';
import {PROJECT,APP,DASHBOARD,REPORTS} from './scope-config.mjs';
export {PROJECT,APP,DASHBOARD,REPORTS};
const encoder = new TextEncoder();
async function hmac(key, text) {
  const k = await crypto.subtle.importKey('raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', k, encoder.encode(text))), n => n.toString(16).padStart(2,'0')).join('');
}
export async function sign(ak, sk, method, path, body = '', timestamp = Math.floor(Date.now()/1000), query = '') {
  const prefix = `ak-v1/${ak}/${timestamp}/300`;
  const key = await hmac(sk, prefix);
  return `${prefix}/${await hmac(key, `HTTPMethod:${method}\nCanonicalURI:${path}\nCanonicalQueryString:${query}\nCanonicalBody:${body}`)}`;
}
// Preserve every integer outside JS's exact range, including bare JSON report IDs.
export function parseLossless(text) {
  return JSON.parse(text.replace(/"(?:[^"\\]|\\.)*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/g, token => /^-?\d+$/.test(token) && !Number.isSafeInteger(Number(token)) ? `"${token}"` : token));
}
export function reportId(id) {
  if (typeof id !== 'string' || !/^[1-9][0-9]{15,19}$/.test(id)) throw new QueryError('OUT_OF_SCOPE','报表或看板 ID 必须是完整的数字字符串。');
  return id;
}
export function assertScope(value, allowProjectWide=false) {
  if(!value || typeof value!=='object') throw new QueryError('OUT_OF_SCOPE','缺少查询范围。');
  let saw=false;
  function appList(ids,projectBound=false){
    if(!Array.isArray(ids)||(!ids.length&&!(allowProjectWide&&projectBound))||(!(allowProjectWide&&projectBound)&&ids.some(id=>String(id)!==APP)))throw new QueryError('OUT_OF_SCOPE','未授权的应用范围。');
  }
  function walk(v){
    if(!v||typeof v!=='object')return;
    if(Object.hasOwn(v,'resources')){
      if(!Array.isArray(v.resources)||!v.resources.length)throw new QueryError('OUT_OF_SCOPE','resources 无法验证。');
      for(const r of v.resources){
        const projects=r?.project_ids??(r?.project_id!==undefined?[r.project_id]:[]);
        if(!projects.length||projects.some(id=>String(id)!==PROJECT))throw new QueryError('OUT_OF_SCOPE','未授权项目。');
        appList(r.app_ids,true); saw=true;
      }
    }
    for(const [k,x]of Object.entries(v)){
      if(['resources','show_option'].includes(k))continue;
      if(['project_id','projectId'].includes(k)){saw=true;if(String(x)!==PROJECT)throw new QueryError('OUT_OF_SCOPE','未授权项目。');}
      if(k==='project_ids'){saw=true;if(!Array.isArray(x)||!x.length||x.some(i=>String(i)!==PROJECT))throw new QueryError('OUT_OF_SCOPE','未授权项目。');}
      if(['app_id','appId'].includes(k)){saw=true;if(String(x)!==APP)throw new QueryError('OUT_OF_SCOPE','未授权应用。');}
      if(['app_ids','appIds'].includes(k)){saw=true;appList(x,!!v.resources);}
      walk(x);
    }
  }
  walk(value);return saw;
}
export function dateRange(start,end) {
  for(const x of [start,end]) if(typeof x!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(x)||!Number.isFinite(Date.parse(`${x}T00:00:00Z`))||new Date(`${x}T00:00:00Z`).toISOString().slice(0,10)!==x) throw new QueryError('INVALID_DATE','日期必须为有效 YYYY-MM-DD。');
  const from=Date.parse(`${start}T00:00:00+08:00`)/1000, until=Date.parse(`${end}T00:00:00+08:00`)/1000+86400;
  if(until<=from || until-from>31*86400) throw new QueryError('INVALID_DATE','日期范围须为 1 至 31 个自然日。');
  const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
  if(end>=today) throw new QueryError('INVALID_DATE','首版只查询已完成的北京时间自然日。');
  return {start_date:start,end_date:end,start_time:from,end_time:until-1,timezone:'Asia/Shanghai'};
}
export function extractDSL(data,allowProjectWide=false,readAny=false) {
  const list=data?.dsls;
  if(!Array.isArray(list)||list.length!==1)throw new QueryError('UNVERIFIED_CONTRACT','首版仅支持单 DSL 报表。');
  const d=list[0].dsl_content;
  let parsed;try{parsed=typeof d==='string'?parseLossless(d):structuredClone(d);}catch{throw new QueryError('UNVERIFIED_CONTRACT','DSL 不是有效 JSON。');}
  if(!assertScope(parsed,allowProjectWide))throw new QueryError('OUT_OF_SCOPE','缺少明确项目/应用范围。');
  if(!readAny&&!['event','retention'].includes(parsed.content?.query_type))throw new QueryError('UNSUPPORTED_QUERY','仅开放事件和留存聚合查询。');
  const groups=parsed.content?.profile_groups_v2;
  if(!readAny&&Array.isArray(groups)&&groups.length)throw new QueryError('UNSUPPORTED_QUERY','首版不开放可形成用户明细的自定义分组。');
  return parsed;
}
export function replayPlan(dsl,start,end,allowProjectWide=false) {
  const d=structuredClone(dsl),range=dateRange(start,end);
  if(!assertScope(d,allowProjectWide))throw new QueryError('OUT_OF_SCOPE','缺少查询范围。');
  if(!['event','retention'].includes(d.content?.query_type))throw new QueryError('UNSUPPORTED_QUERY','仅支持事件和留存。');
  if(!Array.isArray(d.periods)||!d.periods.length||d.periods.length>3)throw new QueryError('UNVERIFIED_CONTRACT','无法识别 periods。');
  for(const period of d.periods){
    if(!['day','all'].includes(period.granularity)||period.timezone!=='Asia/Shanghai')throw new QueryError('UNVERIFIED_CONTRACT','未支持的粒度或时区。');
    period.type='range';period.range=[range.start_time,range.end_time];delete period.spans;delete period.last;
  }
  return {dsl:d,range};
}
const pick=(v,keys)=>Object.fromEntries(keys.filter(k=>v?.[k]!==undefined).map(k=>[k,v[k]]));
export function normalizeReport(report,allowProjectWide=false){
  const dsl=extractDSL(report,allowProjectWide,true);
  const results=report.dsls[0].data;
  if(!Array.isArray(results)||!results.length)throw new QueryError('EMPTY_RESULT','报表没有可识别的子查询结果。');
  return {report_name:report.report_name,report_type:report.report_type,scope:dsl.resources??{app_ids:dsl.app_ids},periods:dsl.periods,
    definition:pick(dsl.content,['query_type','queries','profile_filters']),
    metrics:dsl.show_option?.eventCompute??[],
    results:normalizeResults(results)};
}
export function normalizeResults(results){
 if(!Array.isArray(results))throw new QueryError('UNVERIFIED_CONTRACT','缺少子查询结果数组。');
 return results.map(r=>({...pick(r,['trace_id','query_id','result_status','execute_time','result_time','date_index_list','header_list','sample','is_truncated','ignore_realtime','realtime_before_today']),
 series:(r.data_item_list??[]).map(i=>pick(i,['item_key','event_show_name','show_name','show_label','data','avg','sum','metric_type','event_name','event_label','filter_label','filter_value','indicator_show_name','is_compute','result_type','details','summary','group_by_key','group_params','event_params','profile_params','common_params','name']))}));
}

export function normalizeMetadata(items,keyword,page){
 if(!Array.isArray(items))throw new QueryError('UNVERIFIED_CONTRACT','元数据响应不是已验收的列表。');
 const filtered=items.filter(i=>(String(i.name??'')+String(i.show_name??'')+String(i.description??'')).toLowerCase().includes(keyword.toLowerCase()));
 return {items:filtered.slice((page-1)*50,page*50).map(i=>pick(i,['id','name','show_name','description','value_type','status','project_id','relation_app_ids'])),matched_count:filtered.length,received_count:items.length,page,page_size:50,has_more:page*50<filtered.length,source_complete:'unknown',pagination:'local_over_received_snapshot'};
}
const forbiddenKey = /^(authorization|cookie|access.?key|secret.?key|ak|sk|token|password|uid|user_id|device_id|phone|mobile|email|chat_content|message_content)$/i;
export function sanitize(value, secrets=[]) {
  if(Array.isArray(value)) return value.map(v=>sanitize(v,secrets));
  if(value && typeof value==='object') return Object.fromEntries(Object.entries(value).filter(([k])=>!forbiddenKey.test(k)).map(([k,v])=>[k,sanitize(v,secrets)]));
  if(typeof value==='string') {
    let s=value.replace(/https?:\/\/[^\s"<>]+/g,'[URL omitted]');
    for(const secret of secrets) if(secret) s=s.split(secret).join('[REDACTED]');
    return s;
  }
  return value;
}
export function quality(data) {
  const subqueries=[];
  function walk(v,path) {
    if(!v||typeof v!=='object') return;
    if(!Array.isArray(v)&&(['query_id','item_key'].some(k=>k in v)||'code' in v||'status' in v||'result_status' in v)) {
      const code=v.code, status=v.result_status??v.status;
      const failed=(code!=null && ![0,200,'0','200'].includes(code)) || (status!==undefined && ['failed','error','failure'].includes(String(status).toLowerCase()));
      subqueries.push({path,query_id:v.query_id??null,item_key:v.item_key??null,period:v.period??null,code:code??null,status:failed?'failed':code!=null||['success','succeeded'].includes(String(status).toLowerCase())?'success':'unknown'});
    }
    for(const [k,x] of Object.entries(v)) walk(x,`${path}.${k}`);
  }
  walk(data,'data');
  return {subquery_status:subqueries, status:subqueries.some(q=>q.status==='failed')?'partial_failure':subqueries.some(q=>q.query_id)&&subqueries.filter(q=>q.query_id).every(q=>q.status==='success')?'success':'unverified',quality_status:'unverified',warnings:['需与控制台同口径核对；不跨日累加去重人数、不平均每日比率。','未自动确认采样、截断、数据新鲜度与留存成熟度。'], sampling:'unknown',truncated:'unknown',data_freshness:'unknown'};
}
export class DataFinder {
  constructor(env, fetcher=fetch) { this.deadline=Date.now()+110000;this.requestStats={attempts:0,retries:0};this.env=env;this.fetcher=(input,init)=>fetcher(input,init); }
  async request(method,path,body,params={},options={}) {
    const limit=options.maxBytes??2_000_000;
    for(let attempt=0;attempt<2;attempt++){
      try{return await this.requestOnce(method,path,body,params,{...options,maxBytes:limit});}
      catch(e){if(options.mutation||attempt||!['UPSTREAM_UNAVAILABLE','UPSTREAM_RETRYABLE'].includes(e.code)||this.deadline-Date.now()<10000)throw e;this.requestStats.retries++;await new Promise(r=>setTimeout(r,250));}
    }
    throw new QueryError('UPSTREAM_UNAVAILABLE','重试预算耗尽。');
  }
  async requestOnce(method,path,body,params={},options={}) {
    const {DATAFINDER_AK:ak,DATAFINDER_SK:sk}=this.env;
    if(!ak||!sk) throw new QueryError('CREDENTIALS_NOT_CONFIGURED','云端尚未配置 DataFinder AK/SK。');
    const tagV2=['tag_v2_profile','tag_v2_finder'].includes(options.service);
    const tagV2Read=tagV2&&method==='GET'&&path==='/openApi/v2/cdpMeta/labelSystem/label/list'&&body===undefined&&Object.keys(params).length===0&&!options.mutation;
    if(tagV2&&!tagV2Read)throw new QueryError('FORBIDDEN','标签V2仅开放本项目目录只读路径。');
    if((!['GET','POST'].includes(method)&&!(method==='PATCH'&&options.mutation))||(!path.startsWith('/openapi/')&&!tagV2Read)) throw new QueryError('FORBIDDEN','不支持的查询。');
    if(options.mutation&&!((method==='PATCH'&&[`/openapi/v1/metadata/${APP}/events`,`/openapi/v1/metadata/${APP}/params`].includes(path))||(method==='POST'&&path===`/openapi/v1/metadata/${APP}/profile:batchOperate`&&[5,6].includes(body?.operation_type)))&&!(method==='PATCH'&&new RegExp("^/openapi/v1/metadata/v1/" + APP + "/virtual_events/[1-9]\\d*$").test(path))&&!((method==='POST'&&path===`/openapi/v1/metadata/${APP}/virtual_events`)||(['POST','PATCH'].includes(method)&&path===`/openapi/v1/metadata/${APP}/virtual_params`))&&!((method==='POST'&&path===`/openapi/v1/${APP}/cohorts`)||(method==='PATCH'&&new RegExp("^/openapi/v1/" + APP + "/cohorts/\\d+$").test(path))||(method==='GET'&&new RegExp("^/openapi/v1/" + APP + "/cohorts/\\d+/refresh$").test(path))))throw new QueryError('FORBIDDEN','写入路径未授权。');
    const query=new URLSearchParams(Object.entries(params).sort()).toString();
    if(options.service&&options.service!=='datatag'&&!tagV2)throw new QueryError('FORBIDDEN','服务未授权。');
    if(options.service==='datatag'&&(method!=='GET'||!new RegExp("^/openapi/v1/app/" + APP + "/tag(?:/[\\w$.-]+)?$").test(path)))throw new QueryError('FORBIDDEN','标签只开放目录和基本信息。');
    const uri=(tagV2?(options.service==='tag_v2_profile'?'/profile_platform':'/finder'):options.service==='datatag'?'/datatag':'/datafinder')+path, payload=body===undefined?'':JSON.stringify(body);
    const remaining=this.deadline-Date.now();if(remaining<=0)throw new QueryError('QUERY_DEADLINE','查询已达到110秒预算，请明确较短日期后重试。');
    const limit=options.maxBytes??2_000_000;this.requestStats.attempts++;let response;
    try { response=await this.fetcher('https://analytics.volcengineapi.com'+uri+(query?'?'+query:''),{method,headers:{'Content-Type':'application/json',...(tagV2?{'X-Tenant':PROJECT}:{}),'Authorization':await sign(ak,sk,method,uri,payload,Math.floor(Date.now()/1000),query)},body:method==='GET'?undefined:payload,redirect:'manual',signal:AbortSignal.timeout(Math.max(1,Math.min(options.timeoutMs??45000,remaining)))}); }
    catch (e) {const detail=sanitize(String(e?.message??'connection failed'),[ak,sk]).slice(0,180);throw new QueryError('UPSTREAM_UNAVAILABLE',`DataFinder 连接失败：${detail}`);}
    const headerLogId=safeLogId(response.headers.get('x-tt-logid'),[ak,sk]);
    if([429,502,503,504].includes(response.status))throw new QueryError('UPSTREAM_RETRYABLE',`DataFinder HTTP ${response.status}，短暂不可用；已限制重试次数。`);
    if(!response.ok){const error=new QueryError('UPSTREAM_HTTP_ERROR',`DataFinder HTTP ${response.status}；未输出上游错误正文。`);error.http_status=response.status;error.log_id=headerLogId;throw error;}
    if(Number(response.headers.get('content-length'))>limit) throw new QueryError('RESULT_TOO_LARGE','上游结果超过安全响应容量，请指定较短日期或较少分组。');
    const reader=response.body.getReader();let chunks=[],bytes=0;
    try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>limit){await reader.cancel();throw new QueryError('RESULT_TOO_LARGE','上游结果超过安全响应容量，请指定较短日期或较少分组。');}chunks.push(value);}}catch(e){await reader.cancel().catch(()=>{});if(e instanceof QueryError)throw e;throw new QueryError('UPSTREAM_UNAVAILABLE','DataFinder 响应读取超时或中断。');}
    const b=new Uint8Array(bytes);let offset=0;for(const c of chunks){b.set(c,offset);offset+=c.byteLength;}
    let json;try{json=parseLossless(new TextDecoder().decode(b));}catch{throw new QueryError('INVALID_UPSTREAM_RESPONSE','DataFinder 返回了非 JSON 响应。');}
    if(options.mutation&&String(json.message??'').includes('has no writeable auth'))throw new QueryError('WRITE_PERMISSION_REQUIRED','当前DataFinder凭证没有元数据写权限；需应用管理员开通后重新预览。');
    if(![0,200,'0','200'].includes(json.code)){
      const known={'type can not be null':'缺少项目级虚拟属性 type 字段。','参数非法:关联属性不能为空':'虚拟属性缺少引用属性关联列表。','虚拟用户属性的事件关联策略应该为空':'虚拟用户属性的事件关联策略必须为空。'};
      const error=new QueryError('UPSTREAM_BUSINESS_ERROR',known[String(json.message)]??'DataFinder 业务状态异常；请核对账号授权和接口能力。');
      error.log_id=headerLogId||safeLogId(json.log_id??json.logid,[ak,sk]);error.http_status=response.status;
      error.upstream_code=/^\d{1,10}$/.test(String(json.code))?String(json.code):null;throw error;
    }
    return {data:json.data,log_id:safeLogId(json.log_id??json.logid,[ak,sk])||headerLogId};
  }
  async report(id,params={}) {return this.request('GET',`/openapi/v1/${APP}/reports/${reportId(id)}`,undefined,params,{maxBytes:8_000_000});}
  output(result,extra={}) {
    const data=sanitize(result.data,[this.env.DATAFINDER_AK,this.env.DATAFINDER_SK]);
    if(JSON.stringify(data).length>100000) throw new QueryError('RESULT_TOO_LARGE','结果超过工具输出限制，请缩小查询范围。');
    const output={request_stats:{...this.requestStats},query_ref:crypto.randomUUID(),project_id:PROJECT,app_ids:this.env.DATAFINDER_ALLOW_PROJECT_WIDE==='true'?[]:[APP],scope_description:this.env.DATAFINDER_ALLOW_PROJECT_WIDE==='true'?'当前配置项目下账号有权限的全部报表，只读查询':'仅配置应用的报表',collected_at:new Date().toISOString(),timezone:'Asia/Shanghai',log_ids:result.log_id?[result.log_id]:[],...quality(data),...sanitize(extra,[this.env.DATAFINDER_AK,this.env.DATAFINDER_SK]),data};
    if(JSON.stringify(output).length>100000)throw new QueryError('RESULT_TOO_LARGE','完整输出超过工具限制，请缩小查询范围。');
    return output;
  }
}
