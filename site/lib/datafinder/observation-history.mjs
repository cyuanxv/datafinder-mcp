import {timelineSQL} from './timeline-sql.mjs';
import {configHash} from './config-hash.mjs';
import {QueryError} from './core.mjs';
import {handlingView} from './anomaly-handling.mjs';
// Raw checks have stable identities. They never infer recovery from a truncated timeline.
export async function readObservationHistory(db,owner,a){
 if(a.from&&a.to&&Date.parse(a.from)>Date.parse(a.to))throw new QueryError('INVALID_ARGUMENT','起始时间不能晚于结束时间。');
 const timeline=a.view!=='observations';
 const scope=await configHash({owner,view:a.view,run_id:a.run_id,rule:a.rule_key,state:a.state,handling:a.handling_status,from:a.from,to:a.to});
 let c;try{if(a.cursor){c=JSON.parse(atob(a.cursor));if(c.scope!==scope||!Number.isSafeInteger(c.time)||typeof c.run!=='string'||typeof c.rule!=='string'||!Number.isSafeInteger(c.snapshot))throw Error();}}catch{throw new QueryError('INVALID_ARGUMENT','游标无效或筛选已改变，请重新检索。');}
 const snapshot=c?.snapshot??Date.now(),where=['o.owner=?','o.created_at<=?'],values=[owner,snapshot];
 for(const [field,val] of [['run_id',a.run_id],['rule_key',a.rule_key],['state',a.state]])if(val){where.push(`o.${field}=?`);values.push(val);}
 if(a.from){where.push('o.created_at>=?');values.push(Date.parse(a.from));}if(a.to){where.push('o.created_at<=?');values.push(Date.parse(a.to));}
 const items=[];let has_more=false,last=null,scanned=0;
 let position=c;
 while(items.length<=a.limit&&scanned<2000){
  const tail=position?' AND (o.created_at<? OR (o.created_at=? AND (o.run_id<? OR (o.run_id=? AND o.rule_key<?))))':'';
  const rows=(await db.prepare((timeline?timelineSQL:'')+'SELECT o.* FROM '+(timeline?'timeline':'inspection_observations')+' o WHERE '+where.join(' AND ')+tail+' ORDER BY o.created_at DESC,o.run_id DESC,o.rule_key DESC LIMIT 100').bind(...(timeline?[owner,snapshot]:[]),...values,...(position?[position.time,position.time,position.run,position.run,position.rule]:[])).all()).results;
  if(!rows.length)break;
  const keys=await Promise.all(rows.map(r=>configHash([r.run_id,r.rule_key]))),handling=new Map();
  for(let offset=0;offset<keys.length;offset+=80){const part=keys.slice(offset,offset+80);const found=await db.prepare("SELECT g.* FROM governance_records g WHERE owner=? AND kind='anomaly_handling' AND record_key IN ("+part.map(()=>'?').join(',')+") AND revision=(SELECT MAX(revision) FROM governance_records v WHERE v.owner=g.owner AND v.kind=g.kind AND v.record_key=g.record_key)").bind(owner,...part).all();for(const row of found.results)handling.set(row.record_key,row);}
  for(let index=0;index<rows.length;index++){
   const r=rows[index],h=handlingView(handling.get(keys[index]));
   if(!a.handling_status||h.status===a.handling_status){if(items.length===a.limit){has_more=true;break;}const {owner:ignored,body,...row}=r;items.push({...row,reasons:JSON.parse(body).reasons,transition:timeline?r.transition:'observation',handling:h});}
   last={time:r.created_at,run:r.run_id,rule:r.rule_key};scanned++;
  }
  if(has_more||rows.length<100)break;
  position=last;
  if(scanned>=2000)has_more=true;
 }
 return {items,has_more,next_cursor:has_more&&last?btoa(JSON.stringify({...last,scope,snapshot})):null,history_coverage:'paginated_since_feature_enabled',scanned,view:a.view,derivation_scope:timeline?'all_observations_before_filter':'raw_checks',note:timeline?'全历史状态变化；按规则版本独立追踪，未知不清除异常，旧业务日期补跑不恢复新日期异常。恢复关联上一条非未知状态变化；筛选前已推导状态。':'逐次检查记录；人工状态按读取时最新值筛选，修改状态后请从第一页重新检索。正常检查不等同于恢复事件。',external_notifications:false};
}
