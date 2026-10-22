// Infer state from all owner observations up to the cursor snapshot BEFORE time/state filters.
// Out-of-order business dates cannot alter a more recent incident; unknown never clears known state.
export const timelineSQL=`WITH ordered AS (
 SELECT *,MAX(end_date) OVER (PARTITION BY owner,rule_key,revision ORDER BY created_at,run_id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) prior_date
 FROM inspection_observations WHERE owner=? AND created_at<=?
),accepted AS (SELECT * FROM ordered WHERE prior_date IS NULL OR end_date>=prior_date),
observed AS (
 SELECT *,LAG(state) OVER w observed_state,LAG(body) OVER w observed_body
 FROM accepted WINDOW w AS (PARTITION BY owner,rule_key,revision ORDER BY created_at,run_id)
),known AS (
 SELECT *,LAG(state) OVER w known_state,LAG(body) OVER w known_body
 FROM accepted WHERE state!='unknown' WINDOW w AS (PARTITION BY owner,rule_key,revision ORDER BY created_at,run_id)
),changes AS (
 SELECT o.*,k.known_state previous_state,CASE
 WHEN o.state='unknown' AND (o.observed_state IS NULL OR o.observed_state!='unknown' OR json_extract(o.body,'$.reasons')!=json_extract(o.observed_body,'$.reasons')) THEN 'unknown'
 WHEN o.state='normal' AND k.known_state IS NOT NULL AND k.known_state!='normal' THEN 'recovered'
 WHEN o.state NOT IN ('unknown','normal') AND (k.known_state IS NULL OR k.known_state!=o.state OR json_extract(k.known_body,'$.reasons')!=json_extract(o.body,'$.reasons')) THEN 'opened'
 ELSE NULL END transition
 FROM observed o LEFT JOIN known k ON k.owner=o.owner AND k.rule_key=o.rule_key AND k.run_id=o.run_id
),events AS (SELECT * FROM changes WHERE transition IS NOT NULL),
linked AS (
 SELECT owner,rule_key,run_id,LAG(run_id) OVER (PARTITION BY owner,rule_key,revision ORDER BY created_at,run_id) previous_transition_run_id
 FROM events WHERE transition!='unknown'
),timeline AS (
 SELECT e.owner,e.run_id,e.rule_key,e.revision,e.start_date,e.end_date,e.created_at,e.state,e.body,e.transition,e.previous_state,l.previous_transition_run_id
 FROM events e LEFT JOIN linked l ON l.owner=e.owner AND l.rule_key=e.rule_key AND l.run_id=e.run_id
) `;
