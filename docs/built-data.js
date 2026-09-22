const BUILT_PREFIX = './built/';

function normalizeBuiltPath(path) {
  const value = String(path || '').trim();
  if (!value) throw new Error('Built data path is required.');
  if (value.startsWith(BUILT_PREFIX)) return value;
  return `${BUILT_PREFIX}${value.replace(/^\.\//, '')}`;
}

export async function fetchBuiltJson(path, { label = '' } = {}) {
  const url = normalizeBuiltPath(path);
  const resourceLabel = label || url.replace(BUILT_PREFIX, '');

  let response;
  try {
    response = await fetch(url, {
      cache: 'no-store',
      credentials: 'same-origin',
    });
  } catch (error) {
    throw new Error(`${resourceLabel} could not be reached.`, { cause: error });
  }

  if (!response.ok) {
    throw new Error(`${resourceLabel} request failed: ${response.status}`);
  }

  try {
    return await response.json();
  } catch (error) {
    throw new Error(`${resourceLabel} returned invalid data.`, { cause: error });
  }
}
