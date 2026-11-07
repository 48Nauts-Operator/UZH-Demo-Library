import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDailyLimit,DailyLimitError} from '../daily-limit.mjs';

async function fixture(run){const dir=await mkdtemp(join(tmpdir(),'uzh-quota-'));try{await run(join(dir,'daily.json'));}finally{await rm(dir,{recursive:true,force:true});}}

test('100 concurrent reservations succeed, request 101 fails, restart preserves count',()=>fixture(async file=>{
  const now=()=>new Date('2026-11-07T12:00:00Z');
  const reserve=createDailyLimit({file,now});
  const results=await Promise.allSettled(Array.from({length:105},()=>reserve()));
  assert.equal(results.filter(x=>x.status==='fulfilled').length,100);
  assert.equal(results.filter(x=>x.status==='rejected'&&x.reason instanceof DailyLimitError).length,5);
  await assert.rejects(createDailyLimit({file,now})(),DailyLimitError);
}));

test('resets at Zurich midnight, not UTC midnight',()=>fixture(async file=>{
  let date=new Date('2026-11-07T22:59:59Z');
  const reserve=createDailyLimit({file,limit:1,now:()=>date});
  assert.equal((await reserve()).day,'2026-11-07');
  await assert.rejects(reserve(),DailyLimitError);
  date=new Date('2026-11-07T23:00:00Z');
  assert.equal((await reserve()).day,'2026-11-08');
}));

test('summer daylight saving uses Zurich local day',()=>fixture(async file=>{
  let date=new Date('2026-07-01T21:59:59Z');
  const reserve=createDailyLimit({file,limit:1,now:()=>date});
  await reserve();date=new Date('2026-07-01T22:00:00Z');
  assert.equal((await reserve()).day,'2026-07-02');
}));

test('rankings have a separate persistent cap',()=>fixture(async file=>{
  const reserve=createDailyLimit({file,limit:1});
  await reserve();await reserve('rankings');
  await assert.rejects(reserve('rankings'),DailyLimitError);
  assert.deepEqual(JSON.parse(await readFile(file)).counts,{searches:1,rankings:1});
}));

test('corrupt ledger fails closed',()=>fixture(async file=>{
  await writeFile(file,'not JSON');
  await assert.rejects(createDailyLimit({file})());
}));

test('invalid limits cannot disable the cap',()=>{
  for(const limit of [0,-1,101,Infinity,NaN,1.5])assert.throws(()=>createDailyLimit({file:'unused',limit}));
});
