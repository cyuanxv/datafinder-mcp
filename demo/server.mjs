import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {demoAnalysis,demoCSV} from './model.mjs';
const port=Number(process.env.DEMO_PORT||4178);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid demo port');
const assets={'/':['./index.html','text/html; charset=utf-8'],'/app.js':['./app.js','text/javascript; charset=utf-8'],'/style.css':['./style.css','text/css; charset=utf-8']};
http.createServer(async(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'");
 try{
  if(req.headers.host!=='127.0.0.1:'+port){res.writeHead(403);res.end('Use loopback URL');return;}
  if(req.method!=='GET'){res.writeHead(405);res.end();return;}
  const url=new URL(req.url,'http://127.0.0.1:'+port);
  if(url.pathname==='/api/demo'||url.pathname==='/api/export'){
   const result=await demoAnalysis(url.searchParams.get('platform')||'all');
   if(url.pathname==='/api/export'){res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="synthetic-datafinder-demo.csv"');res.end(demoCSV(result));}
   else{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));}return;
  }
  const asset=assets[url.pathname];if(!asset){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',asset[1]);res.end(await readFile(new URL(asset[0],import.meta.url)));
 }catch{res.writeHead(400);res.end('Invalid demo request');}
}).listen(port,'127.0.0.1',()=>console.log('Synthetic demo: http://127.0.0.1:'+port+' — no live API, no credentials'));
