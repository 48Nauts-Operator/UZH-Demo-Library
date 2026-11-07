import {execFileSync,spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {readFile,appendFile,chmod,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {credentials} from '../src/services.mjs';
import {selectEventPort} from './event-config.mjs';
import {writeEventQR} from './event-qr.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
process.chdir(root);
if(Number(process.versions.node.split('.')[0])<22)throw new Error('Please install Node.js 22 or newer.');
if(existsSync('.env.local'))process.loadEnvFile('.env.local');
const tailscale=process.env.TAILSCALE_BIN||(existsSync('/Applications/Tailscale.app/Contents/MacOS/Tailscale')?'/Applications/Tailscale.app/Contents/MacOS/Tailscale':'tailscale');
const run=args=>execFileSync(tailscale,args,{encoding:'utf8',timeout:20000,stdio:['ignore','pipe','pipe']});
let child,awake,ownedFunnel=false,funnelPort,stopping=false;
async function cleanup(){
  if(stopping)return;stopping=true;
  if(ownedFunnel)try{run(['funnel',`--https=${funnelPort}`,'off']);}catch{console.error(`To stop public access: "${tailscale}" funnel --https=${funnelPort} off`);}
  child?.kill('SIGTERM');awake?.kill('SIGTERM');
}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{cleanup().then(()=>process.exit(0));});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function health(base){try{const r=await fetch(base+'/api/health',{signal:AbortSignal.timeout(4000)});if(!r.ok)return null;return await r.json();}catch{return null;}}
async function secret(label){
  if(!process.stdin.isTTY)throw new Error(`Set ${label} in a private .env.local file before running the event launcher.`);
  process.stdout.write(`${label} (hidden; paste then Return): `);
  process.stdin.setRawMode(true);process.stdin.resume();process.stdin.setEncoding('utf8');
  return new Promise((resolve,reject)=>{
    let value='';
    const done=()=>{process.stdin.off('data',onData);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');};
    function onData(data){for(const c of data){if(c==='\u0003'){done();reject(new Error('Setup cancelled.'));return;}if(c==='\r'||c==='\n'){done();resolve(value.trim());return;}if(c==='\u007f'||c==='\b')value=value.slice(0,-1);else if(c>=' ')value+=c;}}
    process.stdin.on('data',onData);
  });
}
try{
  const status=JSON.parse(run(['status','--json']));
  if(status.BackendState!=='Running'||!status.Self?.DNSName)throw new Error('Open Tailscale and connect this laptop first.');
  const hostname=status.Self.DNSName.replace(/\.$/,'');
  const port=Number(process.env.PORT||3361);
  if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('PORT must be between 1024 and 65535.');
  const local=`http://127.0.0.1:${port}`;
  const config=JSON.parse(run(['serve','status','--json']));
  const selected=selectEventPort(config,hostname,local,process.env.EVENT_HTTPS_PORT);
  funnelPort=selected.port;
  let ready=await health(local);
  if(ready&&(!Object.hasOwn(ready,'faresAvailable')||!Object.hasOwn(ready,'jevAvailable')))throw new Error(`Port ${port} belongs to another app. Set a different PORT in .env.local.`);
  if(!ready){
    const keys=await credentials();
    for(const [name,present] of [['SERP_API_KEY',keys.serpKey],['TYPESAFE_API_KEY',keys.jevKey]]){
      if(present)continue;
      const value=await secret(name);
      if(!/^[A-Za-z0-9_.\-]+$/.test(value))throw new Error(`${name} is missing or contains unexpected characters.`);
      await appendFile('.env.local',`\n${name}=${value}\n`,{mode:0o600});await chmod('.env.local',0o600);process.env[name]=value;
    }
    child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,HOST:'127.0.0.1',PORT:String(port)},stdio:['ignore','inherit','inherit']});
    child.on('error',()=>{console.error('Could not start WhichFlight.');cleanup().then(()=>process.exit(1));});
    for(let i=0;i<40&&!ready;i++){await delay(250);if(child.exitCode!==null)throw new Error('WhichFlight stopped during startup.');ready=await health(local);}
  }
  if(!ready?.faresAvailable||!ready?.jevAvailable)throw new Error('WhichFlight needs both API credentials. Stop any existing server, configure .env.local, then retry.');
  let ledger={fares:0,jev:0};
  try{ledger=JSON.parse(await readFile('.runtime/usage.json','utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  console.log(`Local app ready: ${local}`);
  console.log(`Remaining app allowance: ${Math.max(0,Number(process.env.FLIGHT_TOTAL_CALL_LIMIT||100)-ledger.fares)} flight-provider requests; ${Math.max(0,Number(process.env.JEV_TOTAL_CALL_LIMIT||100)-ledger.jev)} Jev requests.`);
  console.log('Return-trip searches may use four provider requests. Provider account quota also applies.');
  await mkdir('.runtime/event',{recursive:true});
  await writeFile('.runtime/event/tailscale-before.json',JSON.stringify(config,null,2),{mode:0o600});
  if(!selected.alreadyPublic){
    console.log(`Publishing only WhichFlight on HTTPS port ${funnelPort} using Tailscale Funnel …`);
    // Do not reset Tailscale or change any occupied listener used by another service.
    const p=spawn(tailscale,['funnel','--bg',`--https=${funnelPort}`,local],{stdio:'inherit'});
    const code=await new Promise((resolve,reject)=>{p.on('error',reject);p.on('exit',resolve);});
    if(code!==0)throw new Error('Funnel did not start. Complete any Tailscale setup shown above, then retry.');
    ownedFunnel=true;
  }
  const updated=JSON.parse(run(['serve','status','--json']));
  if(!updated.AllowFunnel?.[`${hostname}:${funnelPort}`])throw new Error('Tailscale has not enabled public Funnel access.');
  const publicUrl=`https://${hostname}${funnelPort===443?'':':'+funnelPort}/`;
  let publicReady=null;
  for(let i=0;i<10&&!publicReady;i++){publicReady=await health(publicUrl.replace(/\/$/,''));if(!publicReady)await delay(1000);}
  if(!publicReady?.faresAvailable||!publicReady?.jevAvailable)throw new Error('The HTTPS app could not be verified yet. Retry once Tailscale DNS and the certificate are ready.');
  const output=await writeEventQR(publicUrl,resolve(root,'.runtime/event'));
  if(process.platform==='darwin'){awake=spawn('/usr/bin/caffeinate',['-i','-w',String(process.pid)],{stdio:'ignore'});awake.on('error',()=>console.error('Keep the laptop awake manually.'));}
  console.log(`\nPUBLIC LINK: ${publicUrl}\nQR image: ${output}/whichflight-qr.png\nPresentation slide: ${output}/whichflight-qr.html\n\nCheck the link on a phone with Wi-Fi and Tailscale switched off.\nKeep this terminal open, laptop connected to power, and lid open. Ctrl+C stops this event launcher.`);
  if(selected.alreadyPublic)console.log('The pre-existing Funnel configuration will remain when this launcher stops.');
  if(child)child.on('exit',()=>{if(!stopping){console.error('WhichFlight stopped; closing the event.');cleanup().then(()=>process.exit(1));}});
  setInterval(()=>{},60000);
}catch(error){
  console.error(error.stderr?.toString()||error.message);
  await cleanup();process.exitCode=1;
}
