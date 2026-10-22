#!/usr/bin/env node
// Read-only release preflight. There is deliberately no publish/login/token command here.
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
const here=dirname(fileURLToPath(import.meta.url));
const args=process.argv.slice(2);
if(args.some(a=>!['--check-account','--help'].includes(a)))throw Error('Unknown option');
if(args.includes('--help')){console.log('node standalone/preflight.mjs [--check-account]\nLocal metadata and publication target checks. Optional account check only calls npm whoami. Never publishes or logs in.');process.exit(0);}
const json=async p=>JSON.parse(await readFile(join(here,p),'utf8'));
const pkg=await json('package.template.json'),built=await json('package/package.json'),registry=await json('server.json');
const checks={
 name_matches:pkg.name===built.name&&pkg.name===registry.packages?.[0]?.identifier,
 version_matches:pkg.version===built.version&&pkg.version===registry.version&&pkg.version===registry.packages?.[0]?.version,
 registry_namespace_matches:pkg.mcpName===registry.name,
 public_target:pkg.private!==true&&built.private!==true&&pkg.publishConfig?.registry==='https://registry.npmjs.org'&&pkg.publishConfig?.access==='public',
 node24_required:pkg.engines.node==='>=24',
 no_private_remote:!registry.remotes,
 secret_fields_marked:registry.packages[0].environmentVariables.filter(v=>['DATAFINDER_AK','DATAFINDER_SK'].includes(v.name)).length===2&&registry.packages[0].environmentVariables.filter(v=>['DATAFINDER_AK','DATAFINDER_SK'].includes(v.name)).every(v=>v.isSecret===true),
 no_publish_hooks:![pkg,built].some(p=>Object.keys(p.scripts??{}).some(k=>['prepublish','prepublishOnly','publish','postpublish','prepare'].includes(k)))
};
const result={package:pkg.name,version:pkg.version,checks,status:Object.values(checks).every(Boolean)?'pass':'fail',published:false};
if(args.includes('--check-account')){
 const p=spawnSync('npm',['whoami','--registry=https://registry.npmjs.org','--json','--fetch-retries=0','--fetch-timeout=20000'],{cwd:here,encoding:'utf8',timeout:30000,maxBuffer:200000});
 let username;try{const j=JSON.parse(p.stdout);if(typeof j==='string')username=j;}catch{}
 result.account=p.status===0&&username?{authenticated:true,username,personal_scope_matches:pkg.name.startsWith('@'+username+'/'),scope_write_rights:pkg.name.startsWith('@'+username+'/')?'personal_namespace_identity_confirmed_publish_2fa_or_token_constraints_not_proven':'requires_separate_scope_membership_check'}:{authenticated:false,error_code:['ENEEDAUTH','E401','E403','ENOTFOUND','ETIMEDOUT'].find(code=>((p.stdout??'')+(p.stderr??'')).includes(code))??'CHECK_FAILED'};
}
result.publication_readiness=result.account?.authenticated===false?'account_not_verified':result.account?.personal_scope_matches?'namespace_identity_confirmed_publish_constraints_pending':'account_or_scope_not_checked';
console.log(JSON.stringify(result,null,2));
if(result.status!=='pass')process.exitCode=1;
