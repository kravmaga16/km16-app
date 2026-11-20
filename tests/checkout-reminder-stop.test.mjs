import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const code=await readFile(new URL('../checkout-reminder-stop.mjs',import.meta.url),'utf8');
const token='a'.repeat(64);
function page(fragment='#'+token,reply=async()=>({ok:true,json:async()=>({ok:true})})){
  const button={disabled:true,hidden:false},status={textContent:''},calls=[],history=[];
  const sandbox={
    document:{getElementById:id=>id==='stop'?button:status},
    location:{hash:fragment,pathname:'/checkout-reminder-stop.html',search:''},
    history:{replaceState:(_state,_title,url)=>history.push(url)},
    AbortController,setTimeout,clearTimeout,
    fetch:async(url,options)=>{calls.push({url,options});return reply();}
  };
  vm.runInNewContext(code,sandbox);
  return {button,status,calls,history};
}

test('opening the link is read-only until the visitor confirms',async()=>{
  const state=page();
  assert.equal(state.calls.length,0);
  assert.equal(state.button.disabled,false);
  assert.deepEqual(state.history,['/checkout-reminder-stop.html']);
  await state.button.onclick();
  assert.equal(state.calls.length,1);
  const {url,options}=state.calls[0];
  assert.equal(url,'https://tlfewpbgbwesdriklxzb.supabase.co/functions/v1/km16-checkout-reminders');
  assert.equal(options.method,'POST');
  assert.equal(options.referrerPolicy,'no-referrer');
  assert.equal(options.credentials,'omit');
  assert.deepEqual(JSON.parse(options.body),{action:'unsubscribe',token});
  assert.equal(state.button.hidden,true);
  assert.match(state.status.textContent,/désactivés/);
});

test('malformed or missing fragments never trigger a request',async()=>{
  for(const fragment of ['', '#', '#'+token.slice(1), '#'+token+'a', '#'+token.replace('a','g'), '#token='+token]){
    const state=page(fragment);
    assert.equal(state.button.hidden,true,fragment);
    assert.equal(state.button.disabled,true,fragment);
    await state.button.onclick();
    assert.equal(state.calls.length,0,fragment);
    assert.match(state.status.textContent,/incomplet ou invalide/);
  }
});

test('uppercase hexadecimal fragments are accepted and normalized',async()=>{
  const state=page('#'+token.toUpperCase());
  await state.button.onclick();
  assert.equal(JSON.parse(state.calls[0].options.body).token,token);
});

test('server or connection failures keep a visible retry without leaking server content',async()=>{
  for(const reply of [
    async()=>{throw Error('private diagnostic '+token);},
    async()=>({ok:false,json:async()=>({error:'private diagnostic '+token})}),
    async()=>({ok:true,json:async()=>({ok:false})}),
    async()=>({ok:true,json:async()=>{throw SyntaxError('bad json');}}),
  ]){
    const state=page('#'+token,reply);
    await state.button.onclick();
    assert.equal(state.button.disabled,false);
    assert.equal(state.button.hidden,false);
    assert.match(state.status.textContent,/Réessayez/);
    assert.equal(state.status.textContent.includes(token),false);
    assert.equal(state.status.textContent.includes('private diagnostic'),false);
    await state.button.onclick();
    assert.equal(state.calls.length,2);
  }
});

test('repeated confirmation cannot submit while a request is already pending',async()=>{
  let finish;
  const state=page('#'+token,()=>new Promise(resolve=>{finish=resolve;}));
  const first=state.button.onclick();
  await state.button.onclick();
  assert.equal(state.calls.length,1);
  finish({ok:true,json:async()=>({ok:true})});
  await first;
  await state.button.onclick();
  assert.equal(state.calls.length,1);
});
