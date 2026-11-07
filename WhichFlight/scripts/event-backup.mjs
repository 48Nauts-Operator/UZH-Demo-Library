import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {homedir} from 'node:os';
import {resolve} from 'node:path';
import {writeEventQR} from './event-qr.mjs';
process.chdir(fileURLToPath(new URL('../',import.meta.url)));
if(existsSync('.env.local'))process.loadEnvFile('.env.local');
const local=`http://127.0.0.1:${process.env.PORT||3361}`;
const folder=resolve('.runtime/event/backup');
const desktop=resolve(homedir(),'Desktop/WhichFlight-Event');
async function healthy(base){try{const r=await fetch(base.replace(/\/$/,'')+'/api/health',{signal:AbortSignal.timeout(5000)});const d=await r.json();return r.ok&&d.ok&&d.faresAvailable&&d.jevAvailable;}catch{return false;}}
if(!await healthy(local))throw new Error('Start WhichFlight first using Start WhichFlight.command.');
let previous='';try{previous=(await readFile(resolve(folder,'event-url.txt'),'utf8')).trim();}catch{}
if(previous&&await healthy(previous)){
  await writeEventQR(previous,desktop);
  console.log(`The public backup is already running: ${previous}\nQR files: ${desktop}`);
}else{
  const binary=process.env.CLOUDFLARED_BIN||resolve('.runtime/cloudflared');
  if(!existsSync(binary))throw new Error('Cloudflared is not installed on this machine. The MacBook event setup includes it.');
  const tunnel=spawn(binary,['tunnel','--url',local,'--no-autoupdate','--protocol','http2'],{stdio:['ignore','pipe','pipe']});
  let buffer='',started=false,awake;
  const stop=()=>{tunnel.kill('SIGTERM');awake?.kill('SIGTERM');};
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,stop);
  tunnel.on('error',error=>{console.error(error.message);process.exitCode=1;});
  tunnel.on('exit',code=>{awake?.kill('SIGTERM');process.exitCode=code||0;});
  async function receive(chunk){
    buffer=(buffer+chunk.toString()).slice(-32000);
    const address=buffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0];
    if(!address||started)return;started=true;
    try{
      let ready=false;
      for(let i=0;i<20&&!ready;i++){ready=await healthy(address);if(!ready)await new Promise(r=>setTimeout(r,1000));}
      if(!ready)throw new Error('The backup URL is not reachable yet. Restart this launcher to retry.');
      await writeEventQR(address,folder);await writeEventQR(address,desktop);
      if(process.platform==='darwin'){awake=spawn('/usr/bin/caffeinate',['-i','-w',String(process.pid)],{stdio:'ignore'});awake.on('error',()=>{});}
      console.log(`Public backup: ${address}\nUpdated QR image and presentation slide: ${desktop}\nKeep this terminal open. Restarting the tunnel changes the link: use the newly generated QR.`);
    }catch(error){console.error(error.message);stop();process.exitCode=1;}
  }
  tunnel.stdout.on('data',receive);tunnel.stderr.on('data',receive);
  console.log('Starting a fresh public backup tunnel …');
}
