import { STORAGE_KEYS, readStoredText, writeStoredText, removeStoredValue } from '../browser-storage.js';
export function readDraft() {
  let draft;
  try { draft = JSON.parse(readStoredText(STORAGE_KEYS.draft) || 'null'); }
  catch { return null; }
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return null;
  const records = value => Array.isArray(value) ? value.filter(item=>item && typeof item==='object' && !Array.isArray(item)) : [];
  return {...draft,
    categories:Array.isArray(draft.categories) ? draft.categories.filter(item=>typeof item==='string') : [],
    ingredients:records(draft.ingredients), steps:records(draft.steps),
  };
}
export function writeDraft(draft) { return writeStoredText(STORAGE_KEYS.draft, JSON.stringify(draft)); }
export function removeDraft() { return removeStoredValue(STORAGE_KEYS.draft); }
