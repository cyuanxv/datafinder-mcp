import {createHash,randomUUID} from 'node:crypto';
import {QueryError} from './lib/core.mjs';
export const readActions={
 mapping_import:['preview'],business_contracts:['read','list','check','assess_experiment'],analysis_workbench:['read','list','export'],mapped_analysis_plans:['read','list','preview_upgrade'],tracking_mapping:['list','read','history','validate','run'],native_metadata:['read','change'],analysis_session:['read','run'],manage_workspace:['list','read','trend','audit','result','trend_export','audit_export','compare','retry_preview','diagnostics','integrity','preview'],manage_definitions:['workflow','list','read','history','report_source','catalog','values','validate','trial','compare'],dependency_scan_jobs:['read','list'],manage_cohort:['read','change_status'],inspection_schedules:['list','preview_backfill','preview_upgrade'],cloud_query_jobs:['list','read','read_result','read_merged'],query_templates:['read','run','list'],manage_anomaly_record:['read','detail'],manage_job_archive:['preview','history'],metric_dictionary:['list','read','history','source','catalog','preview_import']
};
export function mutates(name,args,write){
 if(!write)return false;
 const confirmed=v=>v&&typeof v==='object'&&(v.confirmed===true||Object.values(v).some(confirmed));
 if(confirmed(args))return true;
 if(['metric_dictionary','analysis_session','tracking_mapping','business_contracts'].includes(name)&&['save','revise'].includes(args.action)&&!args.confirmed)return false;
 if(name==='analysis_workbench'&&!args.confirmed&&!args.key&&['diagnose','bundle','compare','capture'].includes(args.action))return false;
 return !(readActions[name]??[]).includes(args.action);
}
function canonical(v){if(Array.isArray(v))return v.map(canonical);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]));return v;}
export function createPolicy(db,owner,writable,context,upstreamWritable=false){
 return async(name,wrapped,fn,write)=>{
  const {installation_confirmation,installation_confirmed,...args}=wrapped;
  const mutate=mutates(name,args,write);
  if(mutate){
   const hash=createHash('sha256').update(JSON.stringify(canonical({name,args}))).digest('hex');
   if(!installation_confirmed){
    const token=randomUUID();db.raw.prepare('INSERT INTO standalone_confirmations(token,owner,hash,expires) VALUES(?,?,?,?)').run(token,owner,hash,Date.now()+15*60000);
    return {status:'installation_preview',tool:name,arguments:args,installation_confirmation:token,expires_in_seconds:900,read_only:!writable,note:'Show these exact arguments to the user. If approved and local writes are enabled, resend with installation_confirmed=true and this token. Existing tool-specific previews and confirmations still apply.'};
   }
   if(!writable)throw new QueryError('READ_ONLY','独立版默认只读。需要在启动配置中显式启用本地修改；预览不代表已保存。');
   if(!upstreamWritable&&(name==='apply_virtual_change'||(['native_metadata','manage_cohort'].includes(name)&&args.action==='apply')))throw new QueryError('UPSTREAM_READ_ONLY','上游修改默认禁用，需单独启用；本次未提交。');
   const r=db.raw.prepare('UPDATE standalone_confirmations SET consumed=1 WHERE token=? AND owner=? AND hash=? AND expires>? AND consumed=0').run(installation_confirmation??'',owner,hash,Date.now());
   if(Number(r.changes)!==1)throw new QueryError('CONFIRMATION_INVALID','确认已失效、已使用或内容已变更，请重新预览。');
  }
  return context.run({...context.getStore(),canWrite:mutate},()=>fn(args));
 };
}
