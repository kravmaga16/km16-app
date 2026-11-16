import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';

const source=readFileSync('scripts/phase14-review-ui.mjs','utf8')
 .replace('export function createReviewControl','function createReviewControl');
for(const [browserName,engine] of [['Chromium',chromium],['WebKit',webkit]]){
 const browser=await engine.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.goto('about:blank');
  await page.addScriptTag({content:source+'\nwindow.createReviewControl=createReviewControl;'});
  const result=await page.evaluate(async()=>{
   const key={season:'2026/2027',environment:'test',externalId:'fictional-1'};
   const calls=[];
   const render=(config)=>{document.body.replaceChildren();const node=window.createReviewControl(document,config);document.body.append(node);return node;};
   const untrusted=render({key:null,record:null,onSave:()=>{},onHistory:()=>{}});
   if(untrusted.querySelector('button'))throw Error('Unverified key allowed edits');
   const root=render({
    key,record:{state:'a_verifier',version:0},
    onSave:async(k,state,version)=>{calls.push({k,state,version});return {state,version:1};},
    onHistory:async()=>[{new_state:'controle',changed_at:'2026-11-16'}]
   });
   const select=root.querySelector('select');
   const [save,history]=root.querySelectorAll('button');
   if(!save.disabled)throw Error('Save enabled before change');
   select.value='controle';select.dispatchEvent(new Event('change',{bubbles:true}));
   if(save.disabled)throw Error('Save did not enable');
   save.click();
   await new Promise(resolve=>setTimeout(resolve,0));
   if(!root.querySelector('[role=status]').textContent.includes('Enregistré'))throw Error('No saved confirmation');
   if(calls.length!==1||calls[0].version!==0||calls[0].state!=='controle')throw Error('Incorrect save args');
   history.click();await new Promise(resolve=>setTimeout(resolve,0));
   if(!root.querySelector('ul li')?.textContent.includes('Contrôlé'))throw Error('History not rendered');
   const failed=render({
    key,record:{state:'a_verifier',version:0},
    onSave:async()=>{throw Error('Conflit de version');},
    onHistory:async()=>[]
   });
   const select2=failed.querySelector('select'),save2=failed.querySelector('button');
   select2.value='en_cours';select2.dispatchEvent(new Event('change',{bubbles:true}));save2.click();
   await new Promise(resolve=>setTimeout(resolve,0));
   if(!failed.querySelector('[role=status]').textContent.includes('Conflit'))throw Error('Save error hidden');
   if(failed.querySelector('[role=status]').textContent.includes('Enregistré'))throw Error('False save confirmation');
   return {calls:calls.length,historyItems:root.querySelectorAll('ul li').length};
  });
  assert.equal(result.calls,1);
  assert.equal(result.historyItems,1);
  console.log(browserName+' phase 14 UI smoke tests passed');
  await page.close();
 }finally{await browser.close();}
}
