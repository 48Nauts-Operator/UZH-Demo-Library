// SBB's public link format, verified against rendered searches in Chrome.
export function sbbSearchUrl({from, to, fromId, toId, day, time, mode = 'departure', reduction = 'half-fare'}) {
  if (!['half-fare', 'none'].includes(reduction)) throw new Error('Unknown fare setting');
  const stop = (name, id) => String(name).replaceAll('~', ' ') + (/^\d+$/.test(String(id || '')) ? '_I' + id : '');
  const params = new URLSearchParams({stops: `${stop(from, fromId)}~${stop(to, toId)}`, day, time: time.replace(':', '_'), moment: mode === 'arrival' ? 'arr' : 'dep'});
  if (reduction === 'none') params.set('reduction', 'none');
  return 'https://www.sbb.ch/en?' + params;
}

export function sbbJourneyUrl(journey, reduction = 'half-fare') {
  const date = new Date(journey.scheduledDeparture || journey.departure);
  const day = new Intl.DateTimeFormat('en-CA', {timeZone: 'Europe/Zurich', year:'numeric', month:'2-digit', day:'2-digit'}).format(date);
  const time = new Intl.DateTimeFormat('de-CH', {timeZone: 'Europe/Zurich', hour:'2-digit', minute:'2-digit', hourCycle:'h23'}).format(date);
  return sbbSearchUrl({...journey, day, time, mode:'departure', reduction});
}
