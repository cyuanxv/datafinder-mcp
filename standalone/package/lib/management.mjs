import {z} from 'zod/v4';
import {queryWorkflow} from './query-workflow.mjs';
import {database,readRecords,saveRecord,record,metricSource} from './governance.mjs';
import {editorCatalog,editorValues,validateDraft,trialDraft,diffValues} from './editor.mjs';
import {queryTemplate} from './templates.mjs';
export const managementSchema=z.object({action:z.enum(['workflow','list','read','history','save','report_source','catalog','values','validate','trial','compare','copy','restore']),kind:z.enum(['rule','template']),target_key:z.string().min(1).max(80).optional(),name:z.string().min(1).max(100).optional(),expected_revision:z.number().int().min(0).optional(),confirmed:z.literal(true).optional(),start_date:z.string().optional(),end_date:z.string().optional(),report_id:z.string().optional(),key:z.string().min(1).max(80).optional(),page:z.number().int().min(1).max(1000).default(1),revision:z.number().int().positive().optional(),payload:z.record(z.string(),z.unknown()).optional()}).strict();
export async function manageDefinitions(api,input,owner){
 const a=managementSchema.parse(input),db=database(api,owner);
 if(['validate','trial'].includes(a.action)&&a.kind==='template'&&a.payload?.workflow){const wrapped=z.object({workflow:z.record(z.string(),z.unknown())}).strict().parse(a.payload);return queryWorkflow(api,{...wrapped.workflow,execute:a.action==='trial'},owner);}
 if(a.action==='workflow')return queryWorkflow(api,a.payload,owner);
 if(a.action==='catalog')return editorCatalog(api,a.payload);
 if(a.action==='values')return editorValues(api,a.payload);
 if(a.action==='validate')return validateDraft(api,a.kind,a.payload);
 if(a.action==='trial')return trialDraft(api,a.kind,a.payload,a.start_date,a.end_date);
 if(['compare','copy','restore'].includes(a.action)){
  const current=await record(api,owner,a.kind,a.key),source=await record(api,owner,a.kind,a.key,a.revision);
  if(a.action==='compare')return {key:a.key,current_revision:current.revision,source_revision:source.revision,differences:diffValues(current.value,source.value)};
  if(a.expected_revision===undefined||!a.confirmed)throw new Error('确认及目标版本必填');
  const target=a.action==='copy'?z.string().min(1).parse(a.target_key):a.key;
  if(a.action==='copy'&&(target===a.key||a.expected_revision!==0))throw new Error('复制须使用新标识和版本0');
  const value={...source.value,name:a.name??source.value.name};
  if(a.kind==='rule')return saveRecord(api,{kind:'rule',key:target,expected_revision:a.expected_revision,confirmed:true,rule:value},owner);
  const {name,...template}=value;return queryTemplate(api,{action:'save',key:target,name,template,expected_revision:a.expected_revision,confirmed:true},owner);
 }
 if(a.action==='report_source')return metricSource(api,z.string().min(1).parse(a.report_id));
 if(a.action==='save')return a.kind==='rule'?saveRecord(api,{...a.payload,kind:'rule'},owner):queryTemplate(api,{...a.payload,action:'save'},owner);
 if(a.action==='list')return a.kind==='rule'?readRecords(api,{kind:'rule',page:a.page},owner):queryTemplate(api,{action:'list',page:a.page},owner);
 z.string().min(1).parse(a.key);
 if(a.action==='history'){
  const r=await db.prepare('SELECT revision,created_at FROM governance_records WHERE owner=? AND kind=? AND record_key=? ORDER BY revision DESC LIMIT 21 OFFSET ?').bind(owner,a.kind,a.key,(a.page-1)*20).all();return {items:r.results.slice(0,20),has_more:r.results.length>20};
 }
 if(a.kind==='template'&&!a.revision)return queryTemplate(api,{action:'read',key:a.key},owner);
 return record(api,owner,a.kind,a.key,a.revision);
}
