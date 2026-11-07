import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {isIP} from 'node:net';
import {fileURLToPath} from 'node:url';
process.chdir(fileURLToPath(new URL('../',import.meta.url)));
try{
  const address=process.argv[2]||(await readFile('.runtime/event/event-url.txt','utf8')).trim();
  const url=new URL(address);
  if(url.protocol!=='https:'||!url.hostname.endsWith('.ts.net')||url.username||url.password)throw new Error('Use the Tailscale HTTPS event URL.');
  // Query public DNS explicitly: MagicDNS on a connected device is not proof of public access.
  const dns=new URL('https://dns.google/resolve');dns.searchParams.set('name',url.hostname);dns.searchParams.set('type','A');
  const response=await fetch(dns,{signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error('The public DNS check is unavailable.');
  const answer=await response.json();
  const ip=answer.Answer?.find(a=>a.type===1&&isIP(a.data)===4)?.data;
  if(!ip)throw new Error('Public DNS has not published this Funnel yet. First activation can take up to 10 minutes. Retry in a minute.');
  const [a,b]=ip.split('.').map(Number);
  if(a===0||a===10||a===127||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||a>=224)throw new Error('DNS did not return a public relay address.');
  const output=execFileSync('/usr/bin/curl',['--silent','--show-error','--fail','--noproxy','*','--max-time','20','--resolve',`${url.hostname}:${url.port||443}:${ip}`,new URL('/api/health',url).href],{encoding:'utf8',timeout:25000});
  const health=JSON.parse(output);
  if(!health.ok||!health.faresAvailable||!health.jevAvailable)throw new Error('The public app is reachable, but an API credential is missing.');
  console.log(`Public Funnel verified via ${ip}: ${url.href}\nHTTPS certificate valid; flight and Jev credentials configured. No paid search was performed.`);
}catch(error){console.error(error.message);process.exitCode=1;}
