import QRCode from 'qrcode';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function writeEventQR(address,directory){
  const url=new URL(address);
  if(url.protocol!=='https:'||url.username||url.password)throw new Error('The QR code needs a public HTTPS URL without credentials.');
  const output=resolve(directory);
  await mkdir(output,{recursive:true});
  const options={errorCorrectionLevel:'M',margin:4,width:1400,color:{dark:'#10264fff',light:'#ffffffff'}};
  await QRCode.toFile(resolve(output,'whichflight-qr.png'),url.href,options);
  await writeFile(resolve(output,'whichflight-qr.svg'),await QRCode.toString(url.href,{...options,type:'svg'}));
  const image=await QRCode.toDataURL(url.href,options);
  await writeFile(resolve(output,'whichflight-qr.html'),`<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WhichFlight · Jetzt selbst ausprobieren</title><style>*{box-sizing:border-box}body{margin:0;background:#f6f5f1;color:#172d64;font-family:Arial,sans-serif;min-height:100vh;display:grid;place-items:center}main{width:min(1400px,94vw);display:grid;grid-template-columns:1fr 1fr;gap:5vw;align-items:center;padding:4vw}.brand{font-size:clamp(18px,2.4vw,36px);margin-bottom:8vh}h1{font-size:clamp(38px,5.5vw,82px);line-height:1.02;letter-spacing:-.04em;margin:0 0 30px}h1 em{font-family:Georgia,serif;color:#2453df;font-weight:normal}p{font-size:clamp(16px,1.8vw,27px);line-height:1.5}figure{margin:0;text-align:center}img{display:block;width:100%;border-radius:18px}a{display:block;color:inherit;overflow-wrap:anywhere;font-size:clamp(12px,1.1vw,18px);margin-top:20px}small{display:block;margin-top:18px;color:#70766b;font-size:14px}@media(max-width:600px){main{grid-template-columns:1fr;text-align:center;gap:18px}.brand{margin-bottom:25px}h1{font-size:42px}figure{max-width:330px;margin:auto}}</style><main><section><div class="brand">↗ <strong>Which</strong>Flight</div><h1>Dein nächster Flug.<br><em>Deine Bedingungen.</em></h1><p>Kamera öffnen. QR-Code scannen.<br>Deine eigene Reise ausprobieren.</p><small>Keine App. Keine Anmeldung.<br>WLAN oder mobile Daten genügen.</small></section><figure><img src="${image}" alt="QR-Code zu WhichFlight"><a href="${escape(url.href)}">${escape(url.href)}</a></figure></main></html>`);
  await writeFile(resolve(output,'event-url.txt'),url.href+'\n');
  return output;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  if(!process.argv[2]){console.error('Usage: npm run event:qr -- https://your-laptop.your-tailnet.ts.net [output-directory]');process.exitCode=1;}
  else console.log(await writeEventQR(process.argv[2],process.argv[3]||'.runtime/event'));
}
