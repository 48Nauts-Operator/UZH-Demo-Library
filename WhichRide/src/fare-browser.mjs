import {spawn} from 'node:child_process';
import {readFile,mkdir,open} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {homedir} from 'node:os';

const root=fileURLToPath(new URL('../',import.meta.url));
const profile=root+'.runtime/sbb-browser';
const chrome=process.env.SBB_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const harness=process.env.BROWSER_HARNESS_PATH || homedir()+'/.local/bin/browser-harness';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function endpoint() {
  try {
    const port=Number((await readFile(profile+'/DevToolsActivePort','utf8')).split('\n')[0]);
    if(!Number.isInteger(port) || port<1 || port>65535)return null;
    const url='http://127.0.0.1:'+port;
    const response=await fetch(url+'/json/version',{signal:AbortSignal.timeout(1000)});
    return response.ok?{url,port}:null;
  }catch{return null;}
}
async function browser() {
  const active=await endpoint();if(active)return active;
  await mkdir(profile,{recursive:true,mode:0o700});
  const log=await open(root+'.runtime/sbb-browser.log','a',0o600);
  const child=spawn(chrome,['--user-data-dir='+profile,'--remote-debugging-port=0','--no-first-run','--no-default-browser-check','about:blank'],{detached:true,stdio:['ignore',log.fd,log.fd]});
  let error;child.on('error',e=>{error=e;});child.unref();await log.close();
  for(let i=0;i<30;i++){if(error)throw error;await delay(250);const ready=await endpoint();if(ready)return ready;}
  throw new Error('Price browser unavailable');
}
export async function readSbbFares(query) {
  const {url,port}=await browser();
  const source=await readFile(root+'scripts/read-sbb-fares.py','utf8');
  return new Promise((resolve,reject)=>{
    const env={PATH:process.env.PATH,HOME:homedir(),LANG:process.env.LANG||'en_US.UTF-8',TMPDIR:process.env.TMPDIR,
      BU_NAME:'whichride-fares-'+port,BU_CDP_URL:url,BH_RECORD:'0',WHICHRIDE_FARE_QUERY:JSON.stringify(query)};
    const child=spawn(harness,[],{cwd:root,env,stdio:['pipe','pipe','ignore']});
    let output='',settled=false;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value);};
    const timer=setTimeout(()=>{child.kill('SIGKILL');finish(new Error('Price reader timeout'));},65000);
    child.on('error',finish);
    child.stdout.on('data',chunk=>{output+=chunk;if(output.length>150000){child.kill('SIGKILL');finish(new Error('Price response too large'));}});
    child.on('close',code=>{
      if(code!==0)return finish(new Error('Price reader failed'));
      try {const line=output.split('\n').findLast(s=>s.startsWith('WHICHRIDE_PRICE_RESULT '));finish(null,JSON.parse(line.slice('WHICHRIDE_PRICE_RESULT '.length)));}
      catch(e){finish(e);}
    });
    child.stdin.on('error',()=>{});child.stdin.end(source);
  });
}
