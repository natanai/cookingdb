import { consolidateCSS } from '../../scripts/consolidate-css.mjs';
import { PNG } from 'pngjs';
import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { openDetails, userClick } from './journey-helpers.mjs';
const beforeCSS=fs.readFileSync(new URL('../baselines/styles-before-consolidation.css',import.meta.url),'utf8');
const afterCSS=fs.readFileSync(new URL('../../docs/styles.css',import.meta.url),'utf8');
const pages=['index.html','recipe.html?id=apple-cider-brisket','add.html','planner.html','bread-maker.html','admin.html'];
async function replaceCSS(page,css){
  await page.evaluate(css=>{
    document.querySelectorAll('link[rel="stylesheet"]').forEach(el=>el.disabled=true);
    let style=document.getElementById('comparison-style');
    if(!style){style=document.createElement('style');style.id='comparison-style';document.head.append(style);}
    style.textContent=css;
  },css);
  await page.waitForLoadState('networkidle');
  await page.evaluate(()=>document.fonts.ready);
}
async function snapshot(page){
  return page.locator('body *').evaluateAll(elements=>elements.filter(el=>el.getClientRects().length).map(el=>{
    const s=getComputedStyle(el),r=el.getBoundingClientRect();
    return [el.tagName,el.id,el.className,...['display','position','fontSize','fontFamily','lineHeight','fontWeight','color','backgroundColor','border','padding','margin','gap','gridTemplateColumns','overflow','borderRadius','boxShadow'].map(p=>s[p]),...[r.x,r.y,r.width,r.height].map(n=>Math.round(n*100)/100)];
  }));
}
for(const url of pages){
  test(`CSS consolidation preserves ${url} and its expanded controls`,async({page},testInfo)=>{
    await page.goto(`/${url}`);
    const unsupported=await page.evaluate(pairs=>pairs.filter(([property,value])=>!CSS.supports(property,value)),consolidateCSS(beforeCSS).replacements);
    expect(unsupported).toEqual([]);
    await page.waitForLoadState('networkidle');
    if(url==='add.html'){
      await userClick(page.getByRole('button',{name:'Ingredient options',exact:true}).first(),'Ingredient options');
      await openDetails(page,'Recipe details');
      await openDetails(page,'More recipe options');
    }
    await replaceCSS(page,beforeCSS);
    const screenshot=await page.screenshot({path:testInfo.outputPath('before-css.png'),animations:'disabled',caret:'hide'});
    const before=await snapshot(page);
    await replaceCSS(page,afterCSS);
    const afterScreenshot=await page.screenshot({path:testInfo.outputPath('after-css.png'),animations:'disabled',caret:'hide'});
    expect(await snapshot(page)).toEqual(before);
    await testInfo.attach('before-css', {body:screenshot,contentType:'image/png'});
    await testInfo.attach('after-css', {body:afterScreenshot,contentType:'image/png'});
    const a=PNG.sync.read(screenshot), b=PNG.sync.read(afterScreenshot);
    expect([a.width,a.height]).toEqual([b.width,b.height]);
    // Allow only one 8-bit level of raster rounding; geometry/styles stay exact.
    const changed=a.data.reduce((count,value,index)=>count+(Math.abs(value-b.data[index])>1?1:0),0);
    expect(changed).toBe(0);
  });
}
