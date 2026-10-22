import {PUBLIC_BASE_URL} from './scope-config.mjs';
import {mergedJob} from './merged-jobs.mjs';
import {z} from 'zod/v4';
import {hydrateJob} from './result-store.mjs';
import {database,readBatch} from './governance.mjs';
import {cloudJobs} from './jobs.mjs';
import {QueryError} from './core.mjs';
export const exportShape={kind:z.enum(['inspection','job','merged_job']),id:z.string().uuid(),format:z.enum(['csv','excel_xml']).default('csv')};
const xml=s=>String(s).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export function exportRows(value){const rows=[['path','type','value']];function walk(v,p){if(rows.length>12000)throw new QueryError('RESULT_TOO_LARGE','导出超过12000个值，请缩小任务。');if(v&&typeof v==='object'){const entries=Object.entries(v);if(!entries.length)rows.push([p,Array.isArray(v)?'array':'object',JSON.stringify(v)]);for(const [k,x]of entries)walk(x,`${p}/${k.replaceAll('~','~0').replaceAll('/','~1')}`);}else rows.push([p,v===null?'null':typeof v,v===null?'':v]);}walk(value,'');return rows;}
export function encodeExport(rows,format){if(format==='csv')return '\uFEFF'+rows.map(row=>row.map(v=>{let s=String(v);if(typeof v==='string'&&/^[\s]*[=+@-]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}).join(',')).join('\r\n');
 return '<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="DataFinder"><Table>'+rows.map(row=>'<Row>'+row.map(v=>`<Cell><Data ss:Type="${typeof v==='number'?'Number':'String'}">${xml(v)}</Data></Cell>`).join('')+'</Row>').join('')+'</Table></Worksheet></Workbook>';
}
function* walkRows(v,p=''){
 if(v&&typeof v==='object'){const entries=Object.entries(v);if(!entries.length)yield [p,Array.isArray(v)?'array':'object',JSON.stringify(v)];for(const [k,x] of entries)yield* walkRows(x,`${p}/${k.replaceAll('~','~0').replaceAll('/','~1')}`);}else yield [p,v===null?'null':typeof v,v===null?'':v];
}
export function exportStream(value,format){
 const rows=(function*(){yield ['path','type','value'];yield* walkRows(value);})();const encoder=new TextEncoder();let started=false;
 const prefix=format==='csv'?'\uFEFF':'<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="DataFinder"><Table>';
 return new ReadableStream({pull(controller){let text='';if(!started){text=prefix;started=true;}for(let i=0;i<128;i++){const row=rows.next();if(row.done){if(format!=='csv')text+='</Table></Worksheet></Workbook>';if(text)controller.enqueue(encoder.encode(text));controller.close();return;}text+=format==='csv'?encodeExport([row.value],'csv').slice(1)+'\r\n':'<Row>'+row.value.map(v=>`<Cell><Data ss:Type="${typeof v==='number'?'Number':'String'}">${xml(v)}</Data></Cell>`).join('')+'</Row>';}controller.enqueue(encoder.encode(text));},cancel(){rows.return();}});
}
export async function aggregateExport(api,input,owner){
 const a=z.object(exportShape).strict().parse(input);
 const result=a.kind==='merged_job'?await mergedJob(api,owner,a.id):a.kind==='inspection'?await readBatch(api,a.id,owner):await hydrateJob(database(api,owner),owner,await cloudJobs(api,{action:'read',job_id:a.id},owner));
 const value={exported_at:new Date().toISOString(),source_kind:a.kind,source_id:a.id,completeness:'see_source_status_and_validation',note:'原始聚合结果逐路径导出，保留日期、筛选、版本和未知值；不重新计算或跨日相加去重人数。job 导出仅含当前任务；merged_job 按原子任务和规则合并至所选恢复任务，保留来源，不合并后续恢复。',result};
 return {filename:`datafinder-${a.kind}-${a.id}.${a.format==='csv'?'csv':'xml'}`,content_type:a.format==='csv'?'text/csv; charset=utf-8':'application/vnd.ms-excel; charset=utf-8',body:exportStream(value,a.format)};
}
export function exportLink(input){const a=z.object(exportShape).strict().parse(input);return {download_url:`${PUBLIC_BASE_URL}/api/export?${new URLSearchParams(a)}`,requires_owner_login:true,format:a.format,note:a.format==='excel_xml'?'Excel 2003 XML 工作簿，不是xlsx。':'UTF-8 CSV，已防护电子表格公式注入。'};}
