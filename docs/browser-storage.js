// Existing keys are retained so upgrades preserve drafts, settings, and journals.
export const STORAGE_KEYS = Object.freeze({
  draft: 'cookingdb:add-recipe:draft:v2',
  nutrition: 'cookingdb-nutrition-settings',
  bread: 'cookingdb-bread-maker-recipes',
  haptics: 'cookingdb-ruffle-haptics',
  refine: 'refineOpen',
  family: 'cookingdb-family-password',
  admin: 'cookingdb-admin-password',
});
export function readStoredText(key, area = 'local') {
  try { return globalThis[`${area}Storage`].getItem(key); }
  catch { return null; }
}
export function writeStoredText(key, value, area = 'local') {
  try { globalThis[`${area}Storage`].setItem(key, value); return true; }
  catch { return false; }
}
export function removeStoredValue(key, area = 'local') {
  try { globalThis[`${area}Storage`].removeItem(key); return true; }
  catch { return false; }
}
