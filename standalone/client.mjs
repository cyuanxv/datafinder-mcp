import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
export async function connect(entry,env){
 const child=spawn(process.execPath,[entry],{env:{PATH:process.env.PATH,...env},stdio:['pipe','pipe','pipe']});let id=0,stderr='';const pending=new Map();
 child.stderr.on('data',b=>stderr+=b);const rl=createInterface({input:child.stdout});
 rl.on('line',line=>{let message;try{message=JSON.parse(line);}catch{throw Error('Invalid stdio output');}const p=pending.get(message.id);if(p){pending.delete(message.id);clearTimeout(p.timer);message.error?p.reject(Error(JSON.stringify(message.error))):p.resolve(message.result);}});
 const exit=new Promise(resolve=>child.once('exit',(code,signal)=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Server exited: '+stderr));}pending.clear();resolve({code,signal});}));
 function request(method,params={}){return new Promise((resolve,reject)=>{const key=++id,timer=setTimeout(()=>{pending.delete(key);reject(Error('Request timed out: '+method+' '+stderr));},120000);pending.set(key,{resolve,reject,timer});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:key,method,params})+'\n');});}
 const init=await request('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'independent-acceptance',version:'2'}});child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
 return {init,child,request,call:async(name,args={})=>{const r=await request('tools/call',{name,arguments:args});return r;},async close(){child.stdin.end();const timer=setTimeout(()=>child.kill(),3000);await exit;clearTimeout(timer);},async errorLog(){return stderr;}};
}
