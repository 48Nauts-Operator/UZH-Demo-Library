import test from 'node:test';
import assert from 'node:assert/strict';
import {selectEventPort} from '../scripts/event-config.mjs';
test('event chooses an unused listener without exposing an existing private app',()=>{
 const config={TCP:{443:{HTTPS:true}},Web:{'laptop.ts.net:443':{Handlers:{'/':{Proxy:'http://127.0.0.1:3037'}}}}};
 assert.deepEqual(selectEventPort(config,'laptop.ts.net','http://127.0.0.1:3361'),{port:8443,alreadyPublic:false});
 assert.throws(()=>selectEventPort(config,'laptop.ts.net','http://127.0.0.1:3361',443));
});
test('event never makes other path handlers on a shared listener public',()=>{
 const config={TCP:{443:{HTTPS:true}},Web:{'laptop.ts.net:443':{Handlers:{'/':{Proxy:'http://127.0.0.1:3361'},'/private':{Proxy:'http://127.0.0.1:9000'}}}}};
 assert.equal(selectEventPort(config,'laptop.ts.net','http://127.0.0.1:3361').port,8443);
});
test('event reuses only the exact app and detects an already public listener',()=>{
 const config={TCP:{443:{HTTPS:true}},Web:{'laptop.ts.net:443':{Handlers:{'/':{Proxy:'http://127.0.0.1:3361'}}}},AllowFunnel:{'laptop.ts.net:443':true}};
 assert.deepEqual(selectEventPort(config,'laptop.ts.net','http://127.0.0.1:3361'),{port:443,alreadyPublic:true});
 assert.throws(()=>selectEventPort({},'laptop.ts.net','http://127.0.0.1:3361',1234));
});
