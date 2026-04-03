#!/usr/bin/env node
const fs = require('node:fs/promises');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OUTPUT_PATH = path.join(
  ROOT,
  'wp-content',
  'themes',
  'echecs92-child',
  'assets',
  'data',
  'postal-coordinates-fr.json'
);
const DEPARTMENTS_ENDPOINT = 'https://geo.api.gouv.fr/departements';
const API_FIELDS = 'nom,codesPostaux,centre';
const FETCH_TIMEOUT_MS = 20000;
const FETCH_RETRIES = 3;
const FETCH_RETRY_DELAY_MS = 1000;
const FETCH_CONCURRENCY = 8;
const RETRIABLE_HTTP_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const writeJsonAtomic = async (filePath, payload) => {
  const content = `${JSON.stringify(payload, null, 2)}\n`;
  const targetDir = path.dirname(filePath);
  const tempPath = path.join(
    targetDir,
    `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`
  );

  await fs.mkdir(targetDir, { recursive: true });
  try {
    await fs.writeFile(tempPath, content);
    await fs.rename(tempPath, filePath);
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => {});
  }
};

const fetchJson = async (url, fetchImpl = globalThis.fetch) => {
  if (typeof fetchImpl !== 'function') {
    throw new Error('Global fetch is unavailable.');
  }

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS) : null;
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/json' },
      signal: controller?.signal,
    });
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return await response.json();
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error(`Timeout after ${FETCH_TIMEOUT_MS}ms (${url})`);
      timeoutError.name = 'FetchTimeoutError';
      timeoutError.cause = error;
      throw timeoutError;
    }
    throw error;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

const shouldRetryError = (error) => {
  if (!error) {
    return false;
  }
  if (error.name === 'AbortError' || error.name === 'FetchTimeoutError') {
    return true;
  }
  if (Number.isFinite(error.status)) {
    return RETRIABLE_HTTP_STATUS.has(error.status);
  }
  if (error.message) {
    if (/^HTTP (408|425|429|5\d\d)\b/.test(error.message)) {
      return true;
    }
    if (/timeout/i.test(error.message)) {
      return true;
    }
  }
  return error instanceof TypeError;
};

const formatError = (error) => {
  if (!error) {
    return 'Unknown error';
  }
  if (error.message) {
    return error.message;
  }
  return String(error);
};

const fetchJsonWithRetry = async (url, options = {}) => {
  const {
    fetchImpl = globalThis.fetch,
    label = url,
    warn = console.warn,
    retries = FETCH_RETRIES,
    retryDelayMs = FETCH_RETRY_DELAY_MS,
  } = options;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fetchJson(url, fetchImpl);
    } catch (error) {
      const lastAttempt = attempt >= retries;
      if (lastAttempt || !shouldRetryError(error)) {
        throw error;
      }
      const delayMs = retryDelayMs * (attempt + 1);
      warn(
        `WARN: ${label} failed (${formatError(error)}). Retrying in ${delayMs}ms ` +
          `(attempt ${attempt + 2}/${retries + 1}).`
      );
      await sleep(delayMs);
    }
  }

  throw new Error(`Failed to fetch ${label}`);
};

const normalisePostalCode = (value) => {
  const code = (value || '').toString().replace(/\D/g, '').trim();
  return code.length === 5 ? code : '';
};

const buildEntries = (payload) => {
  const items = Array.isArray(payload) ? payload : [];
  const seen = new Set();
  const entries = [];

  items.forEach((item) => {
    if (!item) {
      return;
    }
    const name = (item.nom || item.name || '').toString().trim();
    const codes = Array.isArray(item.codesPostaux) ? item.codesPostaux : [];
    const coords = Array.isArray(item?.centre?.coordinates) ? item.centre.coordinates : [];
    const lng = Number.parseFloat(coords[0]);
    const lat = Number.parseFloat(coords[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return;
    }
    codes.forEach((rawCode) => {
      const postalCode = normalisePostalCode(rawCode);
      if (!postalCode) {
        return;
      }
      const label = name || postalCode;
      const key = `${postalCode}|${label}|${lat}|${lng}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      entries.push([postalCode, lat, lng, label]);
    });
  });

  entries.sort((a, b) => {
    if (a[0] !== b[0]) {
      return a[0].localeCompare(b[0]);
    }
    if (a[3] !== b[3]) {
      return a[3].localeCompare(b[3], 'fr', { sensitivity: 'base' });
    }
    return a[1] - b[1] || a[2] - b[2];
  });

  return entries;
};

const parseStoredEntries = (payload) => {
  const items = Array.isArray(payload) ? payload : [];
  const entries = [];

  items.forEach((entry) => {
    if (!Array.isArray(entry) || entry.length < 4) {
      return;
    }
    const postalCode = normalisePostalCode(entry[0]);
    const lat = Number.parseFloat(entry[1]);
    const lng = Number.parseFloat(entry[2]);
    const label = (entry[3] || '').toString().trim();
    if (!postalCode || !Number.isFinite(lat) || !Number.isFinite(lng) || !label) {
      return;
    }
    entries.push([postalCode, lat, lng, label]);
  });

  return entries;
};

const loadExistingEntries = async (outputPath, warn = console.warn) => {
  try {
    const raw = await fs.readFile(outputPath, 'utf8');
    const entries = parseStoredEntries(JSON.parse(raw));
    if (!entries.length) {
      warn(`WARN: existing postal coordinates file is empty or invalid: ${outputPath}`);
      return null;
    }
    return entries;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    warn(
      `WARN: unable to read existing postal coordinates file ${outputPath}: ${formatError(error)}`
    );
    return null;
  }
};

const mapConcurrent = async (items, limit, mapper) => {
  const values = Array.isArray(items) ? items : [];
  const concurrency = Math.max(1, Math.min(limit, values.length || 1));
  const results = new Array(values.length);
  let nextIndex = 0;

  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= values.length) {
        return;
      }
      results[index] = await mapper(values[index], index);
    }
  });

  await Promise.all(workers);
  return results;
};

const fetchDepartmentCodes = async (options = {}) => {
  const {
    fetchImpl = globalThis.fetch,
    warn = console.warn,
    retries = FETCH_RETRIES,
    retryDelayMs = FETCH_RETRY_DELAY_MS,
  } = options;
  const payload = await fetchJsonWithRetry(
    `${DEPARTMENTS_ENDPOINT}?${new URLSearchParams({ fields: 'code' }).toString()}`,
    {
      fetchImpl,
      warn,
      label: 'department index',
      retries,
      retryDelayMs,
    }
  );

  const codes = (Array.isArray(payload) ? payload : [])
    .map((item) => (item?.code || '').toString().trim())
    .filter(Boolean);

  if (!codes.length) {
    throw new Error('Aucun departement recupere.');
  }

  return codes.sort((a, b) => a.localeCompare(b, 'fr', { numeric: true, sensitivity: 'base' }));
};

const fetchCommunesByDepartment = async (departmentCode, options = {}) => {
  const {
    fetchImpl = globalThis.fetch,
    warn = console.warn,
    retries = FETCH_RETRIES,
    retryDelayMs = FETCH_RETRY_DELAY_MS,
  } = options;
  const url = `${DEPARTMENTS_ENDPOINT}/${encodeURIComponent(
    departmentCode
  )}/communes?${new URLSearchParams({ fields: API_FIELDS }).toString()}`;
  return fetchJsonWithRetry(url, {
    fetchImpl,
    warn,
    label: `department ${departmentCode}`,
    retries,
    retryDelayMs,
  });
};

const fetchAllCommunes = async (options = {}) => {
  const {
    fetchImpl = globalThis.fetch,
    log = console.log,
    warn = console.warn,
    retries = FETCH_RETRIES,
    retryDelayMs = FETCH_RETRY_DELAY_MS,
    concurrency = FETCH_CONCURRENCY,
  } = options;
  const departmentCodes = await fetchDepartmentCodes({ fetchImpl, warn, retries, retryDelayMs });
  let completed = 0;

  log(`-> refreshing postal coordinates via ${departmentCodes.length} departments`);
  const chunks = await mapConcurrent(
    departmentCodes,
    concurrency,
    async (departmentCode) => {
      const payload = await fetchCommunesByDepartment(departmentCode, {
        fetchImpl,
        warn,
        retries,
        retryDelayMs,
      });
      completed += 1;
      if (completed === departmentCodes.length || completed % 10 === 0) {
        log(`-> ${completed}/${departmentCodes.length} departments fetched`);
      }
      return Array.isArray(payload) ? payload : [];
    }
  );

  return chunks.flat();
};

const refreshPostalCoordinates = async (options = {}) => {
  const {
    outputPath = OUTPUT_PATH,
    fetchImpl = globalThis.fetch,
    log = console.log,
    warn = console.warn,
    retries = FETCH_RETRIES,
    retryDelayMs = FETCH_RETRY_DELAY_MS,
    concurrency = FETCH_CONCURRENCY,
  } = options;
  const existingEntries = await loadExistingEntries(outputPath, warn);

  try {
    const payload = await fetchAllCommunes({
      fetchImpl,
      log,
      warn,
      retries,
      retryDelayMs,
      concurrency,
    });
    const entries = buildEntries(payload);
    if (!entries.length) {
      throw new Error('Aucune coordonnee postale recuperee.');
    }
    await writeJsonAtomic(outputPath, entries);
    log(`-> ${entries.length} postal coordinate entries written to ${outputPath}`);
    return {
      outputPath,
      entries,
      usedFallback: false,
    };
  } catch (error) {
    if (!existingEntries?.length) {
      throw error;
    }
    warn(`WARN: postal coordinates refresh failed: ${formatError(error)}`);
    warn(
      `WARN: keeping existing postal coordinates snapshot (${existingEntries.length} entries) at ${outputPath}`
    );
    return {
      outputPath,
      entries: existingEntries,
      usedFallback: true,
      error,
    };
  }
};

const main = async () => {
  await refreshPostalCoordinates();
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  OUTPUT_PATH,
  buildEntries,
  fetchAllCommunes,
  fetchDepartmentCodes,
  formatError,
  loadExistingEntries,
  normalisePostalCode,
  parseStoredEntries,
  refreshPostalCoordinates,
  shouldRetryError,
};
