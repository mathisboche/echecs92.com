const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { buildEntries, refreshPostalCoordinates } = require('./update-postal-coordinates-fr.js');

const createTempDir = async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'postal-coordinates-fr-'));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
};

const jsonResponse = (status, payload) => ({
  ok: status >= 200 && status < 300,
  status,
  async json() {
    return payload;
  },
});

test('buildEntries deduplicates and sorts postal coordinates', () => {
  const entries = buildEntries([
    {
      nom: 'Beta',
      codesPostaux: ['75002'],
      centre: { coordinates: [2.4, 48.8] },
    },
    {
      nom: 'Alpha',
      codesPostaux: ['75001', '75002'],
      centre: { coordinates: [2.3, 48.9] },
    },
    {
      nom: 'Alpha',
      codesPostaux: ['75001'],
      centre: { coordinates: [2.3, 48.9] },
    },
  ]);

  assert.deepEqual(entries, [
    ['75001', 48.9, 2.3, 'Alpha'],
    ['75002', 48.9, 2.3, 'Alpha'],
    ['75002', 48.8, 2.4, 'Beta'],
  ]);
});

test('refreshPostalCoordinates aggregates departments and writes the snapshot', async (t) => {
  const tempDir = await createTempDir(t);
  const outputPath = path.join(tempDir, 'postal-coordinates-fr.json');
  const requestedUrls = [];

  const fetchImpl = async (url) => {
    requestedUrls.push(url);
    if (url.includes('/departements?')) {
      return jsonResponse(200, [{ code: '92' }, { code: '75' }]);
    }
    if (url.includes('/departements/92/communes')) {
      return jsonResponse(200, [
        {
          nom: 'Nanterre',
          codesPostaux: ['92000'],
          centre: { coordinates: [2.2018, 48.8974] },
        },
      ]);
    }
    if (url.includes('/departements/75/communes')) {
      return jsonResponse(200, [
        {
          nom: 'Paris',
          codesPostaux: ['75001'],
          centre: { coordinates: [2.3417, 48.8602] },
        },
      ]);
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const result = await refreshPostalCoordinates({
    outputPath,
    fetchImpl,
    log: () => {},
    warn: () => {},
    retryDelayMs: 0,
    concurrency: 1,
  });

  assert.equal(result.usedFallback, false);
  assert.deepEqual(result.entries, [
    ['75001', 48.8602, 2.3417, 'Paris'],
    ['92000', 48.8974, 2.2018, 'Nanterre'],
  ]);

  const written = JSON.parse(await fs.readFile(outputPath, 'utf8'));
  assert.deepEqual(written, result.entries);
  assert.deepEqual(requestedUrls, [
    'https://geo.api.gouv.fr/departements?fields=code',
    'https://geo.api.gouv.fr/departements/75/communes?fields=nom%2CcodesPostaux%2Ccentre',
    'https://geo.api.gouv.fr/departements/92/communes?fields=nom%2CcodesPostaux%2Ccentre',
  ]);
});

test('refreshPostalCoordinates keeps the previous snapshot when the API fails', async (t) => {
  const tempDir = await createTempDir(t);
  const outputPath = path.join(tempDir, 'postal-coordinates-fr.json');
  const existingEntries = [['92000', 48.8974, 2.2018, 'Nanterre']];
  const warnings = [];

  await fs.writeFile(outputPath, `${JSON.stringify(existingEntries, null, 2)}\n`);

  const fetchImpl = async (url) => {
    if (url.includes('/departements?')) {
      return jsonResponse(200, [{ code: '92' }]);
    }
    if (url.includes('/departements/92/communes')) {
      return jsonResponse(500, { error: 'upstream failure' });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const result = await refreshPostalCoordinates({
    outputPath,
    fetchImpl,
    log: () => {},
    warn: (message) => warnings.push(message),
    retries: 1,
    retryDelayMs: 0,
    concurrency: 1,
  });

  assert.equal(result.usedFallback, true);
  assert.deepEqual(result.entries, existingEntries);
  assert.match(warnings.join('\n'), /keeping existing postal coordinates snapshot/i);

  const written = JSON.parse(await fs.readFile(outputPath, 'utf8'));
  assert.deepEqual(written, existingEntries);
});
