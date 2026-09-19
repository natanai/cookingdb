import fs from 'node:fs';

const worker = fs.readFileSync(new URL('../cloudflare/worker.js', import.meta.url), 'utf8');
const api = fs.readFileSync(new URL('../docs/inbox/inbox-api.js', import.meta.url), 'utf8');
const adminHtml = fs.readFileSync(new URL('../docs/admin.html', import.meta.url), 'utf8');
const adminJs = fs.readFileSync(new URL('../docs/admin.js', import.meta.url), 'utf8');
const addHtml = fs.readFileSync(new URL('../docs/add.html', import.meta.url), 'utf8');
const addJs = fs.readFileSync(new URL('../docs/add.js', import.meta.url), 'utf8');

const checks = [
  ['worker admin update route', worker.includes("'POST:/admin/update-pending': adminUpdatePending")],
  ['worker update requires admin token', worker.includes('async function adminUpdatePending') && worker.includes('requireAdminToken(request, env)')],
  ['worker edit conflict protection', worker.includes('expected_updated_at') && worker.includes('changed after you opened it')],
  ['browser admin update client', api.includes("adminUpdatePending") && api.includes("'/admin/update-pending'")],
  ['pending queue container', adminHtml.includes('id="pending-list"') && adminHtml.includes('id="pending-count"')],
  ['pending queue review links', adminJs.includes('adminEdit=') && adminJs.includes('Review / edit')],
  ['pending queue individual deletion', adminJs.includes('adminDeletePendingByIds') && adminJs.includes('Delete')],
  ['pending queue export retained', adminJs.includes('buildRepoImportBundle') && adminHtml.includes('download-btn')],
  ['composer admin review banner', addHtml.includes('id="admin-edit-banner"') && addHtml.includes('id="submit-recipe"')],
  ['composer loads pending admin row', addJs.includes('loadAdminEditRecipe') && addJs.includes('adminExportPending')],
  ['composer saves exact pending row', addJs.includes('adminUpdatePending') && addJs.includes('expectedUpdatedAt: adminEditUpdatedAt')],
  ['composer preserves canonical token identity', addJs.includes('ingredient-token') && addJs.includes('preservedToken')],
  ['composer preserves canonical ingredient ids', addJs.includes('ingredient-id') && addJs.includes('preservedIngredientId')],
  ['pending editor state round trip', addJs.includes('editor_state') && addJs.includes('serializeIngredientEditor()')],
  ['admin edit avoids local draft collision', addJs.includes('restoringDraft || isAdminEditMode')],
];

const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  console.error('Admin inbox review contract failed:');
  failed.forEach(([name]) => console.error(`- ${name}`));
  process.exit(1);
}

console.log(`Admin inbox review contract passed (${checks.length} capabilities checked).`);
