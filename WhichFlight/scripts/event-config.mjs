export function selectEventPort(config,hostname,target,requested){
  const ports=requested?[Number(requested)]:[443,8443,10000];
  for(const port of ports){
    if(![443,8443,10000].includes(port))throw new Error('Funnel supports HTTPS ports 443, 8443 and 10000.');
    const web=config.Web?.[`${hostname}:${port}`];
    const handlers=web?.Handlers;
    const exact=handlers&&Object.keys(handlers).length===1&&handlers['/']?.Proxy===target;
    if(exact&&config.TCP?.[port]?.HTTPS)return {port,alreadyPublic:config.AllowFunnel?.[`${hostname}:${port}`]===true};
    if(!config.TCP?.[port]&&!web)return {port,alreadyPublic:false};
  }
  throw new Error('No free Funnel HTTPS port. Existing Tailscale services were not changed.');
}
