import {QueryError} from './lib/core.mjs';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,chmodSync,existsSync,lstatSync,readFileSync,readdirSync} from 'node:fs';
import {dirname,resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
export function openDatabase(filename,canWrite=()=>true){
 const file=resolve(filename);const dir=dirname(file);
 if(existsSync(dir)&&lstatSync(dir).isSymbolicLink())throw Error('Database directory must not be a symlink');
 mkdirSync(dir,{recursive:true,mode:0o700});
 if(existsSync(file)&&lstatSync(file).isSymbolicLink())throw Error('Database file must not be a symlink');
 const db=new DatabaseSync(file);chmodSync(file,0o600);
 db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=10000; PRAGMA foreign_keys=ON;');
 db.exec('CREATE TABLE IF NOT EXISTS standalone_migrations(name TEXT PRIMARY KEY,sha256 TEXT NOT NULL); CREATE TABLE IF NOT EXISTS standalone_confirmations(token TEXT PRIMARY KEY,owner TEXT NOT NULL,hash TEXT NOT NULL,expires INTEGER NOT NULL,consumed INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS standalone_workers(id TEXT PRIMARY KEY,started INTEGER NOT NULL,finished INTEGER,status TEXT NOT NULL,error_code TEXT);');
 const migrationDir=new URL('./migrations/',import.meta.url);
 for(const name of readdirSync(migrationDir).filter(n=>n.endsWith('.sql')).sort()){
  const sql=readFileSync(new URL(name,migrationDir),'utf8'),hash=createHash('sha256').update(sql).digest('hex');
  db.exec('BEGIN IMMEDIATE');
  const old=db.prepare('SELECT sha256 FROM standalone_migrations WHERE name=?').get(name);
  if(old){db.exec('COMMIT');if(old.sha256!==hash)throw Error('Migration checksum mismatch');continue;}
  try{db.exec(sql);db.prepare('INSERT INTO standalone_migrations VALUES(?,?)').run(name,hash);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
 }
 db.exec('BEGIN IMMEDIATE');try{if(!db.prepare('PRAGMA table_info(standalone_workers)').all().some(r=>r.name==='owner'))db.exec("ALTER TABLE standalone_workers ADD COLUMN owner TEXT NOT NULL DEFAULT 'legacy'");db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
 const normalize=values=>values.map(v=>v===undefined?null:typeof v==='boolean'?Number(v):v);
 function statement(sql,params=[]){
  const read=/^\s*(SELECT|WITH)\b/i.test(sql)&&!(/\b(INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE)\b/i.test(sql));
  function allowed(){if(!read&&!canWrite())throw new QueryError('READ_ONLY','Storage mutation requires preview and confirmation');}
  function runSync(){allowed();const result=db.prepare(sql).run(...params);return {success:true,meta:{changes:Number(result.changes),last_row_id:Number(result.lastInsertRowid)}};}
  return {_runSync:runSync,bind(...args){return statement(sql,normalize(args));},async first(column){allowed();const row=db.prepare(sql).get(...params);return row?(column?row[column]:{...row}):null;},async all(){allowed();return {success:true,results:db.prepare(sql).all(...params).map(r=>({...r}))};},async run(){return runSync();}};
 }
 return {prepare:statement,async batch(statements){if(!canWrite())throw Error('Storage mutation requires confirmation');db.exec('BEGIN IMMEDIATE');try{const result=[];for(const s of statements)result.push(s._runSync());db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}},raw:db,close(){db.close();},filename:file};
}
