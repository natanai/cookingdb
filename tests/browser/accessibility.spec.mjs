import { test, expect } from '@playwright/test';
import { userClick } from './journey-helpers.mjs';

test('ingredient suggestions support keyboard selection and dismissal', async ({ page }) => {
  await page.goto('/add.html');
  const name = page.getByRole('combobox', {name:'Ingredient name'}).first();
  await name.fill('carrot');
  await expect(page.locator('[role="option"]').first()).toBeVisible();
  await name.press('ArrowDown');
  const active = await name.getAttribute('aria-activedescendant');
  expect(active).toBeTruthy();
  await expect(page.locator(`[id="${active}"]`)).toHaveAttribute('aria-selected','true');
  await name.press('Enter');
  await expect(name).toBeFocused();
  await expect(name).toHaveAttribute('aria-expanded','false');
  await expect(page.locator('.ingredient-id').first()).not.toHaveValue('');
  await name.fill('flour');
  await expect(name).toHaveAttribute('aria-expanded','true');
  await name.press('Escape');
  await expect(name).toHaveAttribute('aria-expanded','false');
  await expect(name).toBeFocused();
});

test('review transfers keyboard focus and returns it to editing', async ({ page }) => {
  await page.goto('/add.html');
  const review = page.getByRole('button',{name:'Review recipe',exact:true});
  await userClick(review,'Review recipe');
  const back = page.getByRole('button',{name:'Back to editing',exact:true});
  await expect(back).toBeFocused();
  await back.press('Enter');
  await expect(page.locator('#review-panel')).toBeHidden();
  await expect(review).toBeFocused();
});

test('compact authoring inputs stay readable and reduced motion applies to review', async ({ page }) => {
  await page.setViewportSize({width:390,height:844});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('/add.html');
  await expect(page.locator('html')).toHaveAttribute('data-site-motion','reduced');
  const tooSmall = await page.locator('input, select, textarea').evaluateAll(elements => elements
    .filter(el=>el.getClientRects().length && !['checkbox','radio','hidden'].includes(el.type))
    .filter(el=>parseFloat(getComputedStyle(el).fontSize)<16)
    .map(el=>el.id||el.className));
  expect(tooSmall).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // Observe scroll behavior without replacing the browser's scrolling operation.
  await page.evaluate(()=>{
    window.reviewScrolls=[];
    const original=Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView=function(options){
      if(this.id==='review-panel') window.reviewScrolls.push(options?.behavior);
      return original.call(this,options);
    };
  });
  await userClick(page.getByRole('button',{name:'Review recipe',exact:true}),'Review recipe');
  expect(await page.evaluate(()=>window.reviewScrolls)).not.toContain('smooth');
});

test('malformed stored draft cannot disable the composer', async ({page})=>{
  await page.addInitScript(()=>localStorage.setItem('cookingdb:add-recipe:draft:v2',JSON.stringify({title:'Recovered title',ingredients:{},steps:null,categories:3})));
  await page.goto('/add.html');
  await expect(page.locator('#title')).toHaveValue('Recovered title');
  await expect(page.locator('.ingredient-row')).toHaveCount(1);
  await userClick(page.locator('#add-ingredient'),'Add ingredient');
  await expect(page.locator('.ingredient-row')).toHaveCount(2);
});

test('unavailable browser storage leaves authoring usable and reports unsaved work', async ({page})=>{
  await page.addInitScript(()=>{
    for(const name of ['localStorage','sessionStorage'])Object.defineProperty(window,name,{get(){throw new DOMException('Disabled','SecurityError');}});
  });
  await page.goto('/add.html');
  await page.locator('#title').fill('Unsaved recipe');
  await userClick(page.locator('#add-ingredient'),'Add ingredient');
  await expect(page.locator('.ingredient-row')).toHaveCount(2);
  await expect(page.locator('#draft-status')).toContainText('Not saved on this device');
  await userClick(page.getByRole('button',{name:'Review recipe',exact:true}),'Review recipe');
  await expect(page.locator('#review-panel')).toBeVisible();
});
