import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {dirname} from 'node:path';

export class DailyLimitError extends Error {
  constructor(){
    super('Das Tageskontingent ist aufgebraucht. Bitte nach Mitternacht (Europe/Zurich) erneut versuchen.');
    this.status=429;
  }
}

// One server process per app. Its private runtime directory must survive restarts.
export function createDailyLimit({file,limit=100,now=()=>new Date()}){
  if(!Number.isInteger(limit)||limit<1||limit>100)throw new Error('DAILY_SEARCH_LIMIT must be an integer from 1 to 100');
  const calendar=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Zurich',year:'numeric',month:'2-digit',day:'2-digit'});
  let queue=Promise.resolve();
  return function reserve(bucket='searches'){
    if(!['searches','rankings'].includes(bucket))throw new Error('Unknown daily quota bucket');
    const operation=queue.then(async()=>{
      const day=calendar.format(now());
      let state={day,counts:{searches:0,rankings:0}};
      try{
        state=JSON.parse(await readFile(file,'utf8'));
        if(!/^\d{4}-\d{2}-\d{2}$/.test(state.day)||!state.counts||
          !['searches','rankings'].every(k=>Number.isSafeInteger(state.counts[k])&&state.counts[k]>=0))throw new Error('Invalid daily usage ledger');
      }catch(error){if(error.code!=='ENOENT')throw error;}
      if(state.day>day)throw new Error('Clock is earlier than the usage ledger');
      if(state.day<day)state={day,counts:{searches:0,rankings:0}};
      if(state.counts[bucket]>=limit)throw new DailyLimitError();
      state.counts[bucket]++;
      await mkdir(dirname(file),{recursive:true,mode:0o700});
      await writeFile(file+'.tmp',JSON.stringify(state)+'\n',{mode:0o600});
      await rename(file+'.tmp',file);
      return {day,used:state.counts[bucket],limit};
    });
    queue=operation.catch(()=>{});
    return operation;
  };
}
