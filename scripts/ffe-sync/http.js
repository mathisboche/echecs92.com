const { FETCH_TIMEOUT_MS, HEADERS } = require('./config');
const { sleep } = require('./util');

const normalizeFetchConfig = (options, retries) => {
  let requestOptions = options;
  let attempts = retries;

  if (typeof options === 'number') {
    requestOptions = {};
    attempts = options;
  }

  const {
    timeoutMs = FETCH_TIMEOUT_MS,
    retries: optionRetries,
    retryDelayMs = 500,
    ...fetchOptions
  } = requestOptions || {};

  if (Number.isFinite(optionRetries)) {
    attempts = optionRetries;
  }

  return {
    attempts: Number.isFinite(attempts) ? Math.max(0, Math.floor(attempts)) : 3,
    timeoutMs:
      Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.floor(timeoutMs) : FETCH_TIMEOUT_MS,
    retryDelayMs:
      Number.isFinite(retryDelayMs) && retryDelayMs >= 0 ? Math.floor(retryDelayMs) : 500,
    fetchOptions,
  };
};

const fetchText = async (url, options = {}, retries = 3) => {
  const { attempts, timeoutMs, retryDelayMs, fetchOptions } = normalizeFetchConfig(
    options,
    retries
  );
  for (let attempt = 0; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = { ...HEADERS, ...(fetchOptions.headers || {}) };
      const res = await fetch(url, { ...fetchOptions, headers, signal: controller.signal });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return await res.text();
    } catch (error) {
      const lastAttempt = attempt >= attempts;
      if (lastAttempt) {
        if (error && error.name === 'AbortError') {
          const timeoutError = new Error(`Timeout after ${timeoutMs}ms (${url})`);
          timeoutError.name = 'FetchTimeoutError';
          timeoutError.cause = error;
          throw timeoutError;
        }
        throw error;
      }
      await sleep(retryDelayMs * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`Failed to fetch ${url}`);
};

module.exports = {
  fetchText,
};
