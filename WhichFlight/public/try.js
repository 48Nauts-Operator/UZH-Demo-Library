const $=id=>document.getElementById(id);
const target=new URL('/',window.location.origin).href;
const source='/api/qr.svg?'+new URLSearchParams({origin:window.location.origin});
$('event-link').href=target;
$('event-link').textContent=target.replace(/^https?:\/\//,'').replace(/\/$/,'');
$('download-qr').href=source;
$('event-qr').addEventListener('load',()=>{$('event-qr').hidden=false;$('qr-status').hidden=true;$('download-qr').hidden=false;});
$('event-qr').addEventListener('error',()=>{$('qr-status').textContent='The QR code could not load. You can still open or copy the link below.';});
$('event-qr').src=source;
$('local-warning').hidden=location.protocol==='https:'&&!['localhost','127.0.0.1','[::1]'].includes(location.hostname);
$('copy-link').addEventListener('click',async()=>{
  try{await navigator.clipboard.writeText(target);$('share-status').textContent='Link copied. Share it with someone in the room.';}
  catch{$('share-status').textContent='Select and copy the website address shown above.';const selection=window.getSelection(),range=document.createRange();range.selectNodeContents($('event-link'));selection.removeAllRanges();selection.addRange(range);}
});
if(document.fullscreenEnabled){
  $('fullscreen').hidden=false;
  $('fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{$('share-status').textContent='Use your browser’s full-screen menu to present this page.';}});
  document.addEventListener('fullscreenchange',()=>{$('fullscreen').textContent=document.fullscreenElement?'Exit full screen ⤡':'Full screen ⤢';});
}
