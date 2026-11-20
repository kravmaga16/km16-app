import {chromium, webkit} from 'playwright';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const url=pathToFileURL(resolve('clients.html')).href;
for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]){
  const browser=await engine.launch({headless:true});
  try{
    for(const width of [390,1280]){
      const page=await browser.newPage({viewport:{width,height:844}});
      // Inspect HTML/CSS only: do not run the production authentication module or call Supabase.
      await page.route('**/*',route=>{
        if(route.request().url()===url)return route.continue();
        return route.abort();
      });
      await page.goto(url);
      assert.equal(await page.locator('#login-form').count(),1,name+' login form');
      assert.equal(await page.locator('#login-button').isVisible(),true,name+' login button');
      assert.equal(await page.locator('#email').count(),1,name+' email field');
      assert.equal(await page.locator('#password').count(),1,name+' password field');
      await page.evaluate(()=>{document.querySelector('#login').hidden=true;document.querySelector('#workspace').hidden=false});
      const nav=page.locator('.km16-dashboard-nav');
      assert.deepEqual(await nav.locator('a').evaluateAll(links=>links.map(link=>link.getAttribute('href'))),
        ['#km16-deadlines','#km16-automatic-comms','#km16-member-directory'],name+' dashboard links');
      for(const link of await nav.locator('a').all()){
        const target=await link.getAttribute('href');
        assert.equal(await page.locator(target).count(),1,name+' broken link '+target);
      }
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);
      assert.equal(overflow,false,name+' horizontal overflow at '+width);
      await page.close();
      console.log(name+' '+width+'px: admin HTML/CSS OK');
    }
  }finally{await browser.close()}
}
