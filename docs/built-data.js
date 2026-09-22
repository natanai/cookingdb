import { BUILT_DATA_VERSION } from './built/version.js';

const BUILT_PREFIX = './built/';

function normalizeBuiltPath(path) {
  const value = String(path || '').trim();
  if (!value) throw new Error('Built data path is required.');
  if (value.startsWith(BUILT_PREFIX)) return value;
  return `${BUILT_PREFIX}${value.replace(/^\.\//, '')}`;
}

export function builtDataUrl(path) {
  const url = normalizeBuiltPath(path);
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}v=${encodeURIComponent(BUILT_DATA_VERSION)}`;
}

async function requestBuiltJson(url, resourceLabel, cache) {
  let response;
  try {
    response = await fetch(url, {
      cache,
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

export async function fetchBuiltJson(path, { label = '' } = {}) {
  const baseUrl = normalizeBuiltPath(path);
  const url = builtDataUrl(path);
  const resourceLabel = label || baseUrl.replace(BUILT_PREFIX, '');

  try {
    return await requestBuiltJson(url, resourceLabel, 'default');
  } catch (firstError) {
    try {
      return await requestBuiltJson(url, resourceLabel, 'reload');
    } catch (retryError) {
      retryError.cause = retryError.cause || firstError;
      throw retryError;
    }
  }
}
