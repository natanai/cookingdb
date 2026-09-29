import assert from 'node:assert/strict';
import { createSQLiteWorker } from './sqlite-worker.mjs';
const inbox = createSQLiteWorker();
const call = async (route, body, headers = {'X-Admin-Token':inbox.env.ADMIN_TOKEN}) => {
  const response = await inbox.fetch(new Request(`https://test.invalid${route}`, {
    method: 'POST', headers:{'Content-Type':'application/json',...headers}, body:JSON.stringify(body),
  }));
  return {status:response.status, body:await response.json()};
};
try {
  assert.equal((await call('/api/add', {title:'SQL test',payload:{title:'SQL test'}}, {})).status,401);
  assert.equal((await call('/api/add', {title:'SQL test',payload:{title:'SQL test',steps:[{text:'Preserve me'}]}}, {'X-Recipe-Password':inbox.env.FAMILY_PASSWORD})).status,200);
  const original = inbox.items[0];
  assert.equal((await call('/admin/export',{status:'pending',include_payload:true},{})).status,401);
  assert.equal((await call('/admin/update-pending',{id:original.id,expected_updated_at:original.updated_at,payload:{...original.payload,title:'Reviewed'}})).status,200);
  const revised = inbox.items[0];
  assert.notEqual(revised.updated_at,original.updated_at);
  assert.equal((await call('/admin/update-pending',{id:original.id,expected_updated_at:original.updated_at,payload:original.payload})).status,409);
  for (const body of [{}, {items:[]}, {items:[{id:original.id}]}, {all:true}]) {
    assert.equal((await call('/admin/acknowledge-published',body)).status,400);
    assert.equal(inbox.items.length,1);
  }
  assert.equal((await call('/admin/acknowledge-published',{items:[{id:original.id,updated_at:original.updated_at}]})).status,409);
  assert.equal(inbox.items[0].title,'Reviewed');
  assert.equal((await call('/admin/acknowledge-published',{items:[{id:revised.id,updated_at:revised.updated_at}]})).status,200);
  assert.equal(inbox.items.length,0);
  const health = await inbox.fetch(new Request('https://test.invalid/health'));
  assert.deepEqual((await health.json()).capabilities,['acknowledge-published-v1']);
  console.log('Real Worker / SQLite integration passed: auth, submission, edit conflicts, versioned acknowledgement.');
} finally { inbox.close(); }
