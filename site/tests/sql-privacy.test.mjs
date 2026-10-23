import test from 'node:test';
import assert from 'node:assert/strict';
import {assertSqlPrivacy} from '../lib/datafinder/sql-privacy.mjs';
for(const sql of [
 'WITH base AS (SELECT hash_uid AS uid, event_date AS day FROM events) SELECT day, count(distinct uid) AS users FROM base GROUP BY day',
 'WITH base AS (SELECT hash_uid AS uid, 1 AS n FROM events) SELECT sum(n) AS total FROM base',
 'SELECT count(distinct user_id) AS users FROM events',
 "SELECT day, sum(n) AS total FROM events -- uid is only a comment",
])test('safe summary permits '+sql,()=>assert.doesNotThrow(()=>assertSqlPrivacy(sql)));
for(const sql of [
 'SELECT user_id AS customer FROM events',
 'WITH a AS (SELECT hash_uid AS person FROM events), b AS (SELECT person AS anonymous FROM a) SELECT anonymous AS customer FROM b',
 'WITH a AS (SELECT uid AS person FROM events) SELECT min(person) AS sample FROM a',
 'SELECT groupArray(user_id) AS samples FROM events',
 'SELECT count(uid) OVER (PARTITION BY uid) AS n FROM events',
 'WITH a AS (SELECT uid AS person FROM events) SELECT * FROM a',
 'WITH a(person) AS (SELECT uid FROM events) SELECT person FROM a',
 'WITH b AS (SELECT uid FROM events), a(person) AS (SELECT uid FROM b) SELECT person FROM a',
 'SELECT person FROM (SELECT uid FROM events) a(person)',
 'SELECT person FROM (SELECT uid FROM events) AS a(person)',
 'WITH a AS (SELECT uid AS person FROM events) SELECT person customer FROM a',
 'SELECT count(uid) AS users FROM events UNION SELECT uid AS users FROM events',
 'SELECT count(uid)+min(uid) AS result FROM events',
])test('restricted/unknown syntax refuses '+sql,()=>assert.throws(()=>assertSqlPrivacy(sql),e=>e.code==='PRIVATE_QUERY'));
