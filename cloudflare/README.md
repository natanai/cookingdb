# Cloudflare Worker inbox

This folder contains a copy/pasteable Cloudflare Worker script and schema to host the inbox API used by the site.

## Deploy steps (Dashboard)

1. Create a Worker and open it in the Cloudflare dashboard editor.
2. Add a D1 binding named `DB` that points to your database.
3. Set secrets/environment variables:
   - `ADMIN_TOKEN`
   - `FAMILY_PASSWORD` (the Worker also accepts `RECIPE_PASSWORD` for compatibility)
4. Copy the contents of [`worker.js`](./worker.js) into the Worker editor.
5. Deploy the Worker.
6. Seed the database using the D1 console with [`schema.sql`](./schema.sql) if desired (the Worker also runs the schema on first use).
7. Confirm the Worker is running by visiting `/health`, then exercise the API from the browser console, for example:

```js
// Submit
await fetch('https://<your-worker>/api/add', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Recipe-Password': '<family password>',
  },
  body: JSON.stringify({ title: 'Chocolate Cake', payload: { title: 'Chocolate Cake' } }),
}).then((r) => r.json());

// List
await fetch('https://<your-worker>/api/list', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Recipe-Password': '<family password>',
  },
  body: JSON.stringify({ status: 'pending', include_payload: true }),
}).then((r) => r.json());

// Admin export
await fetch('https://<your-worker>/admin/export', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Admin-Token': '<admin token>',
  },
  body: JSON.stringify({ status: 'all', include_payload: true }),
}).then((r) => r.json());
```

## Updating the Worker

After pulling this branch, copy/paste [`worker.js`](./worker.js) into your Cloudflare Worker and deploy. Ensure the Worker keeps the `DB` binding plus the `ADMIN_TOKEN` and `FAMILY_PASSWORD`/`RECIPE_PASSWORD` secrets.
