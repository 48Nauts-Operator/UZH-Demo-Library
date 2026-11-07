import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, cp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('fresh checkout loads local keys and starts with an empty runtime', async()=>{
  const root=fileURLToPath(new URL('../',import.meta.url));
  const workspace=await mkdtemp(join(tmpdir(),'whichride-startup-'));
  const temp=join(workspace,'app');
  await mkdir(temp);
  await cp(join(root,'../shared'),join(workspace,'shared'),{recursive:true});
  let child;
  try{
    for(const file of ['server.mjs','src','public','data'])await cp(join(root,file),join(temp,file),{recursive:true});
    await writeFile(join(temp,'.env.local'),'TYPESAFE_API_KEY=test-only\nPORT=0\n');
    const env={...process.env};for(const key of ['SERP_API_KEY','TYPESAFE_API_KEY','PORT','HOST'])delete env[key];
    // Bind an ephemeral port, discover it through a small preload, and inspect only key presence.
    await writeFile(join(temp,'listen.cjs'),"const http=require('node:http');const old=http.Server.prototype.listen;http.Server.prototype.listen=function(...a){this.once('listening',()=>console.log('TEST_PORT='+this.address().port));return old.apply(this,a)};");
    child=spawn(process.execPath,['--require',join(temp,'listen.cjs'),'server.mjs'],{cwd:temp,env,stdio:['ignore','pipe','pipe']});
    const port=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(new Error('Startup timed out')),10000);child.stdout.on('data',b=>{out+=b;const m=out.match(/TEST_PORT=(\d+)/);if(m){clearTimeout(timer);resolve(m[1]);}});child.on('exit',code=>{clearTimeout(timer);reject(new Error('Server exited '+code));});});
    const base='http://127.0.0.1:'+port;
    assert.deepEqual(await (await fetch(base+'/api/health')).json(),{ok:true,jevAvailable:true});
    assert.equal((await fetch(base+'/')).status,200);
    assert.equal((await fetch(base+'/.env.local')).status,404);
    const bad=await fetch(base+'/api/journeys',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    assert.equal(bad.status,400);
    const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Zurich',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    await writeFile(join(temp,'.runtime/daily-usage.json'),JSON.stringify({day,counts:{searches:100,rankings:100}}));
    const blocked=await fetch(base+'/api/journeys',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({from:'Zürich HB',to:'Bern',date:new Date(Date.now()+86400000).toISOString().slice(0,10),time:'10:00',mode:'departure'})});
    assert.equal(blocked.status,429);
    assert.match((await blocked.json()).error,/Tageskontingent/);

  }finally{
    if(child&&child.exitCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;}
    await rm(workspace,{recursive:true,force:true});
  }
});
