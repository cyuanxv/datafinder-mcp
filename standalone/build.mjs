import {mkdir,copyFile,readFile,writeFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const here=path.dirname(fileURLToPath(import.meta.url));
const source=path.resolve(here,'../site/lib/datafinder'),out=path.join(here,'package');
await mkdir(path.join(out,'lib'),{recursive:true});
const copied=new Set();
async function copy(name){
 if(copied.has(name))return;copied.add(name);
 const text=await readFile(path.join(source,name),'utf8');
 await writeFile(path.join(out,'lib',name),text);
 for(const m of text.matchAll(/from\s+['"]\.\/([^'"]+)['"]/g))await copy(m[1]);
}
for(const f of (await readdir(source)).filter(n=>n.endsWith('.mjs')))await copy(f);
await mkdir(path.join(out,'migrations'),{recursive:true});
for(const f of (await readdir(path.join(here,'../site/drizzle'))).filter(n=>n.endsWith('.sql')))await copyFile(path.join(here,'../site/drizzle',f),path.join(out,'migrations',f));
for(const f of ['database.mjs','runtime.mjs','policy.mjs','fixture.mjs'])await copyFile(path.join(here,f),path.join(out,f));
await writeFile(path.join(out,'lib/scope-config.mjs'),`const demo=process.env.DATAFINDER_DEMO==='true';
function id(key,fallback){const v=demo?fallback:process.env[key];if(!/^[1-9][0-9]*$/.test(v??''))throw Error('Missing or invalid '+key);return v;}
export const PROJECT=id('DATAFINDER_PROJECT_ID','1000001');
export const APP=id('DATAFINDER_APP_ID','1000002');
export const SUBJECT=Number(id('DATAFINDER_SUBJECT_ID','1'));
if(!Number.isSafeInteger(SUBJECT))throw Error('Invalid subject');
export const DASHBOARD='8900000000000000006';
export const REPORTS=Object.freeze({});
export const PUBLIC_BASE_URL=process.env.DATAFINDER_LOCAL_BASE_URL??'http://127.0.0.1:4179';
const origin=new URL(PUBLIC_BASE_URL);
if(origin.protocol!=='http:'||origin.hostname!=='127.0.0.1'||!origin.port||origin.pathname!=='/')throw Error('Export origin must be loopback');
`);
const model=(await readFile(path.join(here,'../demo/model.mjs'),'utf8')).replaceAll('../site/lib/datafinder/','./lib/');
await writeFile(path.join(out,'demo-model.mjs'),model);
for(const [from,to] of [['README.en.md','README.en.md'],['TOOLS.md','TOOLS.md'],['server.json','server.json'],['server.mjs','server.mjs'],['package.template.json','package.json'],['README.md','README.md'],['../LICENSE','LICENSE'],['../THIRD-PARTY-NOTICES.md','THIRD-PARTY-NOTICES.md']])await copyFile(path.join(here,from),path.join(out,to));
console.log('Standalone package built; nothing published.');
