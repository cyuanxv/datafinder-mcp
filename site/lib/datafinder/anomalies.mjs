import {handlingKey,handlingView} from './anomaly-handling.mjs';
import {QueryError} from './core.mjs';
import {readObservationHistory} from './observation-history.mjs';
import {z} from 'zod/v4';
import {database} from './governance.mjs';

export const anomalyShape={run_id:z.string().uuid().optional(),view:z.enum(['transitions','observations']).default('transitions'),cursor:z.string().max(1500).optional(),state:z.enum(['business_anomaly','execution_failed','unknown','normal']).optional(),handling_status:z.enum(['unread','acknowledged','investigating','resolved']).optional(),from:z.iso.datetime({offset:true}).optional(),to:z.iso.datetime({offset:true}).optional(),rule_key:z.string().max(80).optional(),limit:z.number().int().min(1).max(200).default(50)};
// Missing evidence never clears an incident. Rule revisions form independent timelines.
export function assessObservation(item){
 if(item.status==='failed')return {state:'execution_failed',reasons:[item.error_code??'CHECK_FAILED']};
 if(item.status!=='success')return {state:'unknown',reasons:[item.reason??item.status]};
 if(item.policy_evaluation)return item.policy_evaluation;
 const d=item.data;
 if(item.kind==='health'){
  const assessments=d?.items?.flatMap(x=>[x.events?.assessment,x.users?.assessment]);
  if(!assessments?.length)return {state:'unknown',reasons:['missing_assessment']};
  const reasons=[...new Set(assessments.filter(x=>['possible_event_loss','volume_anomaly'].includes(x)))];
  if(reasons.length)return {state:'business_anomaly',reasons};
  return assessments.every(x=>x==='within_threshold')?{state:'normal',reasons:[]}:{state:'unknown',reasons:['insufficient_baseline']};
 }
 if(item.kind==='quality'){
  if(d?.status!=='measured'||!(d.total_events>0))return {state:'unknown',reasons:['no_measurement']};
  if(!Number.isSafeInteger(d.missing_events)||d.missing_events<0)return {state:'unknown',reasons:['invalid_measurement']};
  const reasons=[];
  if(d.missing_events>0)reasons.push('missing_property_values');
  if(d.invalid_events>0)reasons.push('invalid_property_values');
  return {state:reasons.length?'business_anomaly':'normal',reasons};
 }
 return {state:'unknown',reasons:['unsupported_rule']};
}
export function observationStatements(db,owner,batch){return batch.items.map(item=>{
 const assessment=assessObservation(item);
 return db.prepare('INSERT INTO inspection_observations (owner,run_id,rule_key,revision,start_date,end_date,created_at,state,body) VALUES (?,?,?,?,?,?,?,?,?)').bind(owner,batch.run_id,item.key,item.revision,batch.start_date,batch.end_date,batch.created_at,assessment.state,JSON.stringify(assessment));
});}
export function incidentTimeline(rows){
 const last=new Map(),observed=new Map(),items=[];
 for(const row of [...rows].sort((a,b)=>a.created_at-b.created_at||a.run_id.localeCompare(b.run_id))){
  const identity=`${row.rule_key}:${row.revision}`;
  const previous=last.get(identity),a=JSON.parse(row.body);
  // Rechecking an older date cannot recover a more recent business incident.
  if(previous&&row.end_date<previous.end_date)continue;
  const priorObservation=observed.get(identity);
  if(priorObservation&&row.end_date<priorObservation.end_date)continue;
  observed.set(identity,row);
  if(row.state==='unknown'){if(!priorObservation||priorObservation.state!=='unknown'||JSON.stringify(JSON.parse(priorObservation.body).reasons)!==JSON.stringify(a.reasons))items.push({...row,reasons:a.reasons,transition:'unknown',body:undefined});continue;}
  if(row.state==='normal'){
   if(previous&&previous.state!=='normal')items.push({...row,reasons:[],transition:'recovered',previous_state:previous.state,body:undefined});
  }else if(!previous||previous.state!==row.state||JSON.stringify(JSON.parse(previous.body).reasons)!==JSON.stringify(a.reasons)){items.push({...row,reasons:a.reasons,transition:'opened',body:undefined});}
  last.set(identity,row);
 }
 return items.reverse();
}
export async function readAnomalies(api,input,owner){
 const a=z.object(anomalyShape).strict().parse(input);
 return readObservationHistory(database(api,owner),owner,a);
}
