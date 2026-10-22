import {database,readBatch} from './governance.mjs';
import {QueryError} from './core.mjs';
export async function anomalyDetail(api,owner,run_id,rule_key){
 const db=database(api,owner),row=await db.prepare('SELECT * FROM inspection_observations WHERE owner=? AND run_id=? AND rule_key=?').bind(owner,run_id,rule_key).first();if(!row)throw new QueryError('NOT_FOUND','观测不存在。');
 const batch=await readBatch(api,run_id,owner),item=batch.items.find(x=>x.key===rule_key&&x.revision===row.revision);
 if(!item)throw new QueryError('UNVERIFIED_CONTRACT','批次缺少对应规则结果。');
 const rows=await db.prepare('SELECT run_id,rule_key,revision,start_date,end_date,created_at,state,body FROM inspection_observations WHERE owner=? AND rule_key=? AND revision=? AND (created_at<? OR (created_at=? AND run_id<=?)) ORDER BY created_at DESC,run_id DESC LIMIT 21').bind(owner,rule_key,row.revision,row.created_at,row.created_at,run_id).all();
 const timeline=rows.results.slice(0,20).reverse().map(r=>({...r,reasons:JSON.parse(r.body).reasons,body:undefined}));
 const previous=rows.results[1];let previous_result=null;if(previous){const b=await readBatch(api,previous.run_id,owner);previous_result=b.items.find(x=>x.key===rule_key&&x.revision===row.revision)??null;}
 return {previous_result,observation:{...row,reasons:JSON.parse(row.body).reasons,body:undefined},result:item,timeline,has_older:rows.results.length>20,trend_scope:'同规则版本、截至所选记录最近20次观测；按观测时间，不跨版本拼接数值',note:'状态时间线不是数值曲线。原始数值与基线见所选检查结果；未知不补零，人工处理不代表恢复。'};
}
