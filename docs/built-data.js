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

async function requestBuiltJson(url, resourceLabel, cache, timeoutMs) {
  const controller = new AbortController();
  // Keep the deadline active through response.json(): headers alone do not mean
  // the response body has finished downloading.
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response;
    try {
      response = await fetch(url, {
        cache,
        credentials: 'same-origin',
        signal: controller.signal,
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
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`${resourceLabel} timed out. Please retry.`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchBuiltJson(path, { label = '', timeoutMs = 10000 } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('A positive data request timeout is required.');
  const baseUrl = normalizeBuiltPath(path);
  const url = builtDataUrl(path);
  const resourceLabel = label || baseUrl.replace(BUILT_PREFIX, '');

  try {
    return await requestBuiltJson(url, resourceLabel, 'default', timeoutMs);
  } catch (firstError) {
    try {
      return await requestBuiltJson(url, resourceLabel, 'reload', timeoutMs);
    } catch (retryError) {
      retryError.cause = retryError.cause || firstError;
      throw retryError;
    }
  }
}
