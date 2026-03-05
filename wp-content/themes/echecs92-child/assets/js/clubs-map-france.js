(function () {
  const GEO_HINTS_VERSION = '20250201';
  const DATA_MANIFEST_URL = '/wp-content/themes/echecs92-child/assets/data/clubs-france.json';
  const DATA_FALLBACK_BASE_PATH = '/wp-content/themes/echecs92-child/assets/data/clubs-france/';
  const FFE_DETAILS_BASE_PATH = '/wp-content/themes/echecs92-child/assets/data/clubs-france/';
  const GEO_HINTS_REMOTE_URL = `/wp-content/themes/echecs92-child/assets/data/clubs-france-hints.json?v=${GEO_HINTS_VERSION}`;
  const POSTAL_COORDINATES_DATA_URL = '/wp-content/themes/echecs92-child/assets/data/postal-coordinates-fr.json';
  const DASH_RX = /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE63\uFF0D]/g;
  const normaliseDashes = (value) => (value == null ? '' : value.toString()).replace(DASH_RX, '-');
  const normalisePathname = (value) => (value || '').replace(/\/+$/u, '') || '/';
  const mapElement = document.getElementById('clubs-map');
  const mapBackLink = document.querySelector('[data-clubs-map-back]');
  if (!mapElement) {
    return;
  }
  const pageShell = document.querySelector('.clubs-page');
  const clubsDepartments = (pageShell?.dataset?.clubsDepartments || mapElement.dataset?.clubsDepartments || '')
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
  const clubsDataUrl = (pageShell?.dataset?.clubsDataUrl || mapElement.dataset?.clubsDataUrl || '').trim();
  const ffeDetailsDepartment = clubsDepartments.length === 1 ? clubsDepartments[0] : '';
  const ffeDetailsUrl =
    clubsDataUrl && ffeDetailsDepartment ? `${FFE_DETAILS_BASE_PATH}${ffeDetailsDepartment}.json` : '';
  const useLegacySlugs = Boolean(clubsDataUrl);
  const hasDepartmentFilter = clubsDepartments.length > 0;
  const CLUBS_NAV_STORAGE_KEY = hasDepartmentFilter ? 'echecs92:clubs:last-listing' : 'echecs92:clubs-fr:last-listing';
  const listPath = normalisePathname(pageShell?.dataset?.clubsListPath || '/clubs');
  const mapPathOverride = (pageShell?.dataset?.clubsMapPath || '').trim();
  const clubsDepartmentSet = hasDepartmentFilter ? new Set(clubsDepartments) : null;
  const shouldIncludeDepartment = (entry) => {
    if (!clubsDepartmentSet) {
      return true;
    }
    const code = entry?.code ? entry.code.toString().toUpperCase() : '';
    return clubsDepartmentSet.has(code);
  };

  let manifestPromise = null;
  let datasetPromise = null;

  const FETCH_TIMEOUT_MS = 8000;
  const fetchJson = (url) => {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId =
      controller && Number.isFinite(FETCH_TIMEOUT_MS) && FETCH_TIMEOUT_MS > 0
        ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
        : null;
    return fetch(url, { headers: { Accept: 'application/json' }, signal: controller?.signal })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.json();
      })
      .finally(() => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      });
  };

  const loadManifest = () => {
    if (!manifestPromise) {
      manifestPromise = fetchJson(DATA_MANIFEST_URL)
        .then((payload) => {
          const basePath = payload?.basePath || DATA_FALLBACK_BASE_PATH;
          const departments = Array.isArray(payload?.departments) ? payload.departments : [];
          return { basePath, departments };
        })
        .catch(() => ({ basePath: DATA_FALLBACK_BASE_PATH, departments: [] }));
    }
    return manifestPromise;
  };

  const buildDeptUrl = (entry, basePath) => {
    if (!entry || !entry.file) {
      return null;
    }
    if (/^https?:/i.test(entry.file)) {
      return entry.file;
    }
    const base = (entry.basePath || basePath || DATA_FALLBACK_BASE_PATH || '').replace(/\/+$/u, '');
    const file = entry.file.replace(/^\/+/u, '');
    return `${base}/${file}`;
  };

  const annotateClub = (club, entry) => ({
    ...club,
    departement: club.departement || entry.code || '',
    departement_nom: club.departement_nom || entry.name || '',
    departement_slug: club.departement_slug || entry.slug || '',
  });

  const fetchDepartmentClubs = async (entry, manifestMeta) => {
    const url = buildDeptUrl(entry, manifestMeta.basePath);
    if (!url) {
      return [];
    }
    try {
      const payload = await fetchJson(url);
      const records = Array.isArray(payload) ? payload : [];
      return records.map((club) => annotateClub(club, entry));
    } catch (error) {
      console.warn(`[clubs-fr-map] Département ${entry.code || '?'} indisponible (${url}).`, error);
      return [];
    }
  };

  const loadLegacyDataset = () => {
    if (!clubsDataUrl) {
      return Promise.resolve(null);
    }
    return fetchJson(clubsDataUrl)
      .then((payload) => (Array.isArray(payload) ? payload : null))
      .catch((error) => {
        console.warn('[clubs-fr-map] Données clubs.json indisponibles, repli vers le manifest.', error);
        return null;
      });
  };

  const loadManifestDataset = () =>
    loadManifest().then(async (manifestMeta) => {
      const departments = manifestMeta.departments || [];
      const filteredDepartments = departments.filter(shouldIncludeDepartment);
      if (!filteredDepartments.length) {
        return [];
      }
      const chunks = await Promise.all(filteredDepartments.map((entry) => fetchDepartmentClubs(entry, manifestMeta)));
      return chunks.flat();
    });

  const loadFranceClubsDataset = () => {
    if (!datasetPromise) {
      if (clubsDataUrl) {
        datasetPromise = loadLegacyDataset().then((data) => {
          if (Array.isArray(data)) {
            return data;
          }
          return loadManifestDataset();
        });
      } else {
        datasetPromise = loadManifestDataset();
      }
    }
    return datasetPromise;
  };

  const loadFfeDetails = () => {
    if (!ffeDetailsUrl) {
      return Promise.resolve([]);
    }
    return fetchJson(ffeDetailsUrl)
      .then((payload) => (Array.isArray(payload) ? payload : []))
      .catch(() => []);
  };

  const statusElement = document.getElementById('clubs-map-status');
  const detailBase = mapElement.dataset.detailBase || '/club/';
  const mapHostPath = (() => {
    try {
      const path = window.location && window.location.pathname ? window.location.pathname : '';
      return normalisePathname(path);
    } catch (error) {
      return '';
    }
  })();
  const mapPath = mapPathOverride ? normalisePathname(mapPathOverride) : mapHostPath || '/carte-des-clubs';
  const getCurrentBackPath = () => {
    try {
      const url = new URL(window.location.href);
      return url.pathname + url.search + url.hash;
    } catch (error) {
      return mapHostPath || listPath;
    }
  };
  const navigationContext = (() => {
    try {
      const storage = window.localStorage;
      if (!storage) {
        return null;
      }
      const raw = storage.getItem(CLUBS_NAV_STORAGE_KEY);
      if (!raw) {
        return null;
      }
      storage.removeItem(CLUBS_NAV_STORAGE_KEY);
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch (error) {
        payload = null;
      }
      if (!payload || typeof payload.ts !== 'number') {
        return null;
      }
      if (Date.now() - payload.ts > 10 * 60 * 1000) {
        return null;
      }
      return payload;
    } catch (error) {
      return null;
    }
  })();

  const rememberNavigation = (context, backPath) => {
    try {
      const storage = window.localStorage;
      if (!storage) {
        return;
      }
      storage.setItem(
        CLUBS_NAV_STORAGE_KEY,
        JSON.stringify({ ts: Date.now(), context, back: backPath || listPath })
      );
    } catch (error) {
      // ignore
    }
  };

  const cameFromClubsPage = () => {
    if (navigationContext && navigationContext.context === 'map:from-list') {
      return true;
    }
    const referrer = document.referrer;
    if (!referrer) {
      return false;
    }
    try {
      const refUrl = new URL(referrer, window.location.origin);
      if (refUrl.origin !== window.location.origin) {
        return false;
      }
      const normalized = normalisePathname(refUrl.pathname);
      return normalized === listPath;
    } catch (error) {
      return false;
    }
  };

  if (mapBackLink) {
    if (cameFromClubsPage()) {
      mapBackLink.removeAttribute('hidden');
    } else {
      mapBackLink.setAttribute('hidden', '');
    }
  }

  let mapInstance = null;
  let markersLayer = null;
  let mapFeatures = [];
  const mapIssues = [];
  let fullBounds = null;
  let hasFittedView = false;
  let pendingMapFocus = null;
  let mapReady = false;

  const isMobileViewport = () => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia('(max-width: 820px)').matches;
  };

  const clampZoom = (value, fallback = 12) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.min(16, Math.max(3, parsed));
  };

  const METRO_BOUNDS = {
    south: 41.0,
    west: -5.5,
    north: 51.5,
    east: 10.5,
  };

  const isMetropolitanCoordinate = (lat, lng) =>
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= METRO_BOUNDS.south &&
    lat <= METRO_BOUNDS.north &&
    lng >= METRO_BOUNDS.west &&
    lng <= METRO_BOUNDS.east;

  const normaliseFocusDetail = (detail) => {
    if (!detail || typeof detail !== 'object') {
      return null;
    }
    if (detail.reset) {
      return { reset: true, animate: detail.animate === true };
    }
    const lat = Number.parseFloat(detail.lat ?? detail.latitude);
    const lng = Number.parseFloat(detail.lng ?? detail.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return null;
    }
    return {
      lat,
      lng,
      zoom: clampZoom(detail.zoom, 12),
      label: detail.label || detail.display || detail.commune || '',
      animate: detail.animate === true,
    };
  };

  const focusMapOnLocation = (detail) => {
    const normalized = normaliseFocusDetail(detail);
    if (!normalized) {
      pendingMapFocus = null;
      return;
    }
    if (!mapInstance || !mapReady) {
      pendingMapFocus = normalized;
      return;
    }
    if (normalized.reset) {
      if (fullBounds && fullBounds.isValid && fullBounds.isValid()) {
        mapInstance.fitBounds(fullBounds, {
          padding: [32, 32],
          maxZoom: 14,
          animate: normalized.animate && !isMobileViewport(),
        });
        hasFittedView = true;
      }
      return;
    }
    const target = [normalized.lat, normalized.lng];
    const zoom = clampZoom(normalized.zoom, mapInstance.getZoom ? mapInstance.getZoom() : 12);
    const animate = normalized.animate && !isMobileViewport();
    const duration = animate ? 0.65 : 0;
    const options = { animate, duration };
    if (animate) {
      try {
        mapInstance.flyTo(target, zoom, options);
      } catch (error) {
        mapInstance.setView(target, zoom, options);
      }
    } else {
      mapInstance.setView(target, zoom, { animate: false });
    }
    hasFittedView = true;
  };

  const flushPendingMapFocus = () => {
    if (!pendingMapFocus) {
      return;
    }
    const detail = pendingMapFocus;
    pendingMapFocus = null;
    focusMapOnLocation(detail);
  };

  window.addEventListener('clubs:focus-location', (event) => {
    focusMapOnLocation(event?.detail || {});
  });

  const updateStatus = (message, tone = 'info') => {
    if (!statusElement) {
      return;
    }
    statusElement.textContent = message || '';
    if (message) {
      statusElement.dataset.tone = tone;
    } else {
      delete statusElement.dataset.tone;
    }
  };

  const normalise = (value) =>
    (value || '')
      .toString()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

  const normaliseCommuneKey = (value) => normalise(value).replace(/[^a-z0-9]/g, '');

  const COORD_PRECISION_ALLOWED = {
    exact: true,
    geocoded: true,
    hint: true,
    postal: true,
    commune: true,
    approx: true,
    department: true,
  };

  const MAP_SUSPECT_DISTANCE_KM = 200;

  const haversineKm = (lat1, lon1, lat2, lon2) => {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  const formatCommune = (value) => {
    if (!value) {
      return '';
    }
    const lower = value
      .toString()
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/\s+-\s+/g, '-');

    let formatted = lower.replace(/(^|[\s\-’'])(\p{L})/gu, (match, boundary, letter) => `${boundary}${letter.toUpperCase()}`);
    formatted = formatted.replace(/\b(De|Du|Des|La|Le|Les|Sur|Sous|Et|Aux|Au)\b/gu, (match) => match.toLowerCase());
    formatted = formatted.replace(/\bD'([A-Z])/g, (match, letter) => `d'${letter}`);
    formatted = formatted.replace(/\bL'([A-Z])/g, (match, letter) => `l'${letter}`);
    return formatted.replace(/\s+/g, ' ').trim();
  };

  const normaliseCommuneForCompare = (value) => {
    const formatted = formatCommune(value || '');
    if (!formatted) {
      return '';
    }
    return normalise(formatted)
      .replace(/['’`]/g, ' ')
      .replace(/[-\s]+/g, ' ')
      .trim();
  };

  const dedupeCommuneLabel = (value) => {
    const raw = (value || '').toString();
    if (!raw.trim()) {
      return '';
    }
	    const withoutPostal = raw.replace(/\b\d{4,5}\b/g, ' ');
	    const segments = withoutPostal
	      .split(/[,;\/]+/g)
	      .map((part) => part.replace(/^[\s\-\u2013\u2014]+|[\s\-\u2013\u2014]+$/g, '').trim())
	      .filter(Boolean);

    const collapseRepeatedPhrase = (formatted) => {
      const key = normaliseCommuneForCompare(formatted);
      if (!key) {
        return formatted;
      }
      const tokens = key.split(' ').filter(Boolean);
      if (tokens.length >= 2 && tokens.length % 2 === 0) {
        const midpoint = tokens.length / 2;
        const first = tokens.slice(0, midpoint).join(' ');
        const second = tokens.slice(midpoint).join(' ');
        if (first && first === second) {
          return formatCommune(first);
        }
      }
      return formatted;
    };

    const seen = new Set();
    const parts = [];
    const pushSegment = (segment) => {
      if (!segment) {
        return;
      }
      const formattedSegment = collapseRepeatedPhrase(formatCommune(segment));
      const key = normaliseCommuneForCompare(formattedSegment);
      if (!key || seen.has(key)) {
        return;
      }
      seen.add(key);
      parts.push(formattedSegment);
    };

    if (segments.length) {
      segments.forEach(pushSegment);
    } else {
      pushSegment(withoutPostal);
    }

    if (!parts.length) {
      return '';
    }
    return parts.length === 1 ? parts[0] : parts.join(', ');
  };

  const slugify = (value) => {
    const base = normalise(value)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return base;
  };

  const getParisArrondissementFromPostal = (postalCode) => {
    const code = (postalCode || '').toString().trim();
    if (!/^75\d{3}$/.test(code)) {
      return null;
    }
    const arr = Number.parseInt(code.slice(3), 10);
    if (!Number.isFinite(arr) || arr < 1 || arr > 20) {
      return null;
    }
    return arr;
  };

  const formatParisArrondissementLabel = (postalCode) => {
    const arr = getParisArrondissementFromPostal(postalCode);
    if (!arr) {
      return '';
    }
    const suffix = arr === 1 ? 'er' : 'e';
    return `Paris ${arr}${suffix}`;
  };

  const isParisPostal = (postalCode) => {
    const code = (postalCode || '').toString().trim();
    if (code === '75116') {
      return true;
    }
    return /^75\d{3}$/.test(code);
  };

  const formatCommuneWithPostal = (commune, postalCode) => {
    const base = formatCommune(commune || '');
    const parisLabel = formatParisArrondissementLabel(postalCode);
    if (parisLabel) {
      const looksNumeric = /^\d/.test(base);
      if (!base || base.toLowerCase().startsWith('paris') || looksNumeric) {
        return parisLabel;
      }
    }
    return base;
  };

  const hashStringToInt = (value) => {
    const str = value || '';
    let hash = 2166136261 >>> 0; // FNV-1a seed
    for (let i = 0; i < str.length; i += 1) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  };

  const toBase36 = (value) => {
    const n = Number.isFinite(value) ? value : Number.parseInt(value, 10);
    if (!Number.isFinite(n)) {
      return '';
    }
    return Math.abs(n >>> 0).toString(36);
  };

  const buildShortSlugBase = (club) => {
    const seedParts = [
      club.id || '',
      club.name || '',
      club.commune || '',
      club.postalCode || '',
      club.departmentCode || club.departmentSlug || club.departmentName || '',
    ];
    const seed = seedParts.filter(Boolean).join('|') || 'club';
    const hash = hashStringToInt(seed);
    const code = toBase36(hash).padStart(6, '0').slice(0, 8);
    return `c${code}`;
  };

  const ensureUniqueSlugs = (clubs) => {
    if (useLegacySlugs) {
      (Array.isArray(clubs) ? clubs : []).forEach((club) => {
        if (!club || typeof club !== 'object') {
          return;
        }
        const base = slugify(club._slugCommune || club.commune || club.name || club.id || 'club');
        club.slug = base;
        club._communeSlug = slugify(club._slugCommune || club.commune || '');
      });
      return;
    }
    const byBase = new Map();
    const stableKey = (club) =>
      `${club.id || ''}|${club.name || ''}|${club.commune || ''}|${club.postalCode || ''}|${
        club.departmentCode || club.departmentSlug || club.departmentName || ''
      }`;

    clubs.forEach((club) => {
      const base = buildShortSlugBase(club) || 'cclub';
      if (!byBase.has(base)) {
        byBase.set(base, []);
      }
      byBase.get(base).push(club);
    });

    byBase.forEach((entries, base) => {
      if (entries.length === 1) {
        entries[0].slug = base;
        return;
      }
      const sorted = entries
        .map((club) => ({ club, key: stableKey(club) }))
        .sort((a, b) => a.key.localeCompare(b.key, 'en', { sensitivity: 'base' }));
      sorted.forEach((entry, idx) => {
        const suffix = idx === 0 ? '' : `-${toBase36(idx + 1)}`;
        entry.club.slug = `${base}${suffix}`;
      });
    });
  };

  const parsePostalCodeFromString = (input) => {
    const str = (input || '').toString();
    const strict = str.match(/\b(\d{5})\b/);
    if (strict) {
      return strict[1];
    }
    const spaced = str.match(/\b(\d{2})\s*(\d{3})\b/);
    if (spaced) {
      return `${spaced[1]}${spaced[2]}`;
    }
    return '';
  };

	  const stripCedexSuffix = (value) => {
	    if (!value) {
	      return '';
	    }
	    return normaliseDashes(value.toString())
	      .replace(/\bcedex\b(?:\s*[-/]?\s*\d{1,3})?/gi, ' ')
	      .replace(/\s+/g, ' ')
	      .trim();
	  };

	  const extractAddressParts = (value) => {
	    const result = {
	      full: value ? normaliseDashes(String(value)).trim() : '',
	      postalCode: '',
	      city: '',
	    };
    if (!result.full) {
      return result;
    }

	    const cleanCity = (raw) =>
	      stripCedexSuffix(
	        (raw || '')
	          .toString()
	          .replace(DASH_RX, '-')
	          .replace(/\b\d{4,5}\b/g, ' ')
	          .replace(/^[,;\s\-\u2013\u2014]+/, '')
	          .replace(/\s+/g, ' ')
	          .trim()
	      );

    const postal = parsePostalCodeFromString(result.full);
    if (postal) {
      result.postalCode = postal;
      const pattern = new RegExp(`\\b${postal.slice(0, 2)}\\s*${postal.slice(2)}\\b`, 'i');
      const match = result.full.match(pattern);
      if (match) {
        const idx = Number.isFinite(match.index) ? match.index : result.full.indexOf(match[0]);
        const after = result.full.slice(idx + match[0].length).trim();
        const before = result.full.slice(0, idx).trim();
        if (after) {
          result.city = cleanCity(after);
        }
        if (!result.city && before) {
          const segments = before.split(/[,;]+/).map((part) => part.trim()).filter(Boolean);
          const tail = segments.length ? segments[segments.length - 1] : before;
          result.city = cleanCity(tail);
        }
      }
    }

    if (!result.city) {
      const parts = result.full
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
      if (parts.length) {
        const last = parts[parts.length - 1];
        const cleaned = cleanCity(last);
        if (cleaned) {
          result.city = cleaned;
        }
      }
    }
    result.city = result.city.replace(/\s+/g, ' ').trim();
    return result;
  };

  const STREET_KEYWORDS =
    /\b(rue|avenue|av\.?|boulevard|bd|bld|place|route|chemin|impasse|all[ée]e|voie|quai|cours|passage|square|sentier|mail|esplanade|terrasse|pont|faubourg|clos|cité|cite|hameau|lotissement|residence|résidence|allee)\b/i;

  const ADDRESS_SPLIT_PATTERN = /[,;/\n]+/;

  const stripAddressNotes = (segment) => {
    if (!segment) {
      return '';
    }
    return segment
      .replace(/\bpendant\s+la\s+semaine\b.*$/gi, '')
      .replace(/\b(?:en\s+semaine|semaine)\b.*$/gi, '')
	      .replace(/\b(?:le|du)?\s*(?:w\.?e\.?|w-?e|week[-\s]?end|weekend)\b.*$/gi, '')
	      .replace(/\(\s*(?:we|w-?e|week[-\s]?end|weekend)[^)]*\)/gi, ' ')
	      .replace(/\s+/g, ' ')
	      .replace(/^[,;\s\-\u2013\u2014]+|[,;\s\-\u2013\u2014]+$/g, '')
	      .trim();
	  };

  const scoreAddressSegment = (segment) => {
    if (!segment) {
      return -Infinity;
    }
    let score = 0;
    if (STREET_KEYWORDS.test(segment)) {
      score += 5;
    }
    if (/\b\d{5}\b/.test(segment)) {
      score += 2;
    }
    if (/\d/.test(segment)) {
      score += 1;
    }
    if (segment.length >= 10) {
      score += 1;
    }
    if (/\b(?:semaine|week[-\s]?end|w-?e|w\.?e\.?)\b/i.test(segment)) {
      score -= 2;
    }
    return score;
  };

  const looksLikePostalOnly = (value) => {
    if (!value || !/\b\d{5}\b/.test(value)) {
      return false;
    }
    if (STREET_KEYWORDS.test(value)) {
      return false;
    }
    const withoutPostal = value.replace(/\b\d{5}\b/g, ' ').replace(/\s+/g, ' ').trim();
    return withoutPostal && withoutPostal.split(' ').length <= 3;
  };

  const simplifyStreetSegment = (value) => {
    if (!value) {
      return '';
    }
    const cleaned = value.replace(/\([^)]*\)/g, ' ');
    const parts = cleaned
      .split(ADDRESS_SPLIT_PATTERN)
      .map((part) => stripAddressNotes(part.trim()))
      .filter(Boolean);
    if (!parts.length) {
      return cleaned.replace(/\s+/g, ' ').trim();
    }
    const tests = [
      (part) => /\b\d+[\p{L}]?\b/iu.test(part) && STREET_KEYWORDS.test(part),
      (part) => STREET_KEYWORDS.test(part),
      (part) => /\b\d+[\p{L}]?\b/iu.test(part) && !looksLikePostalOnly(part),
    ];
    for (const test of tests) {
      const match = parts.find((part) => test(part));
      if (match) {
        return match.replace(/\s+/g, ' ').trim();
      }
    }
    const fallback = parts.find((part) => !looksLikePostalOnly(part)) || parts[0];
    return fallback || '';
  };

  const stripLocalityNoise = (street, postalCode, city) => {
    let result = (street || '').trim();
    if (!result) {
      return '';
    }
    if (postalCode) {
      const postalPattern = new RegExp(`\\b${postalCode}\\b`, 'gi');
      result = result.replace(postalPattern, ' ');
    }
    const formattedCity = formatCommune(city);
    if (formattedCity) {
	      const escapedCity = formattedCity.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
	      const cityPatterns = [
	        new RegExp(`^${escapedCity}\\s*[,:;\\-\\u2013\\u2014]?\\s*`, 'i'),
	        new RegExp(`\\s*[,:;\\-\\u2013\\u2014]?\\s*${escapedCity}$`, 'i'),
	      ];
      cityPatterns.forEach((pattern) => {
        result = result.replace(pattern, ' ');
      });
    }
	    const postal = (postalCode || '').toString();
	    if (/^75\d{3}$/.test(postal)) {
	      const arrondissementOnly = /^(?:[,;\s\-\u2013\u2014]*)\d{1,2}(?:er|e|eme|ème)?(?:\s*arr(?:\.|t|ondissement)?)?(?:[,;\s\-\u2013\u2014]*)$/i;
	      if (arrondissementOnly.test(result)) {
	        result = '';
	      }
	    }
	    result = result.replace(/^[,;\-\u2013\u2014\s]+|[,;\-\u2013\u2014\s]+$/g, '');
	    return result.replace(/\s+/g, ' ').trim();
	  };

  const normalizeCityForPostal = (city, postalCode) => {
    const formatted = formatCommune(city);
    if (!formatted) {
      return '';
    }
    const postal = (postalCode || '').toString();
    const looksParisPostal = /^75\d{3}$/.test(postal);
    if (looksParisPostal && /^Paris\b/i.test(formatted)) {
      const suffix = formatted.replace(/^Paris\b\s*/i, '');
      const arrondissementPattern = /^(?:\d{1,2}(?:er|e|eme|ème)?)(?:\s*arr(?:\.|t|ondissement)?)?$/i;
      if (!suffix || arrondissementPattern.test(suffix)) {
        return 'Paris';
      }
    }
    return formatted;
  };

  const buildStandardAddress = (primaryAddress, secondaryAddress, postalCode, city) => {
    const rawStreet =
      simplifyStreetSegment(primaryAddress) || simplifyStreetSegment(secondaryAddress) || '';
    const formattedCity = normalizeCityForPostal(city, postalCode);
    const street = stripLocalityNoise(rawStreet, postalCode, formattedCity);
    const components = [];
    if (street) {
      components.push(street);
    }
    const localityParts = [];
    if (postalCode) {
      localityParts.push(postalCode);
    }
    if (formattedCity) {
      localityParts.push(formattedCity);
    }
    if (localityParts.length) {
      components.push(localityParts.join(' ').trim());
    }
    return components.join(', ').trim();
  };

  const looksLikeDetailedAddress = (value) => {
    const raw = (value || '').toString().trim();
    if (!raw) {
      return false;
    }
    if (!/\d/.test(raw)) {
      return false;
    }
    return STREET_KEYWORDS.test(raw);
  };

  const normaliseAddressField = (raw) => {
    const base = (raw || '').toString().replace(/\s+/g, ' ').trim();
    if (!base) {
      return { full: '', best: '', streetLike: '' };
    }
    const segments = base
      .split(ADDRESS_SPLIT_PATTERN)
      .map((part) => stripAddressNotes(part))
      .map((part) => part.replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    if (!segments.length) {
      const fallback = stripAddressNotes(base).replace(/\s+/g, ' ').trim();
      return {
        full: fallback,
        best: fallback,
        streetLike: looksLikeDetailedAddress(fallback) ? fallback : '',
      };
    }

    const uniqueSegments = [];
    const seen = new Set();
    segments.forEach((segment) => {
      const key = segment.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        uniqueSegments.push(segment);
      }
    });

    const scored = uniqueSegments
      .map((segment, idx) => ({
        segment,
        score: scoreAddressSegment(segment),
        order: idx,
      }))
      .sort((a, b) => b.score - a.score || a.order - b.order);

    const best = scored[0]?.segment || uniqueSegments[0];
    const streetCandidate =
      scored.find((entry) => looksLikeDetailedAddress(entry.segment) || STREET_KEYWORDS.test(entry.segment))
        ?.segment || '';
    const orderedSegments = [best, ...uniqueSegments.filter((segment) => segment !== best)];
    return { full: orderedSegments.join(', '), best, streetLike: streetCandidate || '' };
  };

	  const deriveCityFromPostal = (address, postalHint = '') => {
	    const raw = normaliseDashes((address || '').toString());
	    if (!raw.trim()) {
	      return '';
	    }
    const postal = parsePostalCodeFromString(raw) || (postalHint || '').toString().replace(/\D/g, '');
    if (!postal) {
      return '';
    }
    const pattern = new RegExp(`\\b${postal.slice(0, 2)}\\s*${postal.slice(2)}\\b`, 'i');
    const match = raw.match(pattern);
    if (!match) {
      return '';
    }
	    const idx = Number.isFinite(match.index) ? match.index : raw.indexOf(match[0]);
	    const after = raw.slice(idx + match[0].length).trim();
	    if (after) {
	      return stripCedexSuffix(after.replace(/^[,;\s\-\u2013\u2014]+/, '').trim());
	    }
    const before = raw.slice(0, idx).trim();
    if (!before) {
      return '';
    }
    const segments = before.split(/[,;]+/).map((part) => part.trim()).filter(Boolean);
    return stripCedexSuffix((segments.length ? segments[segments.length - 1] : before).trim());
  };

  const cleanCommuneCandidate = (value, postalCode) => {
    if (!value) {
      return '';
    }
    const postal = (postalCode || '').toString().replace(/\D/g, '');
	    let cleaned = value
	      .toString()
	      .replace(DASH_RX, '-')
	      .replace(/\b\d{4,5}\b/g, ' ')
	      .replace(/^[,;\s\-\u2013\u2014]+/, ' ')
	      .replace(/\s+/g, ' ')
	      .trim();
    if (postal) {
      const pattern = new RegExp(`\\b${postal.slice(0, 2)}\\s*${postal.slice(2)}\\b`, 'gi');
      cleaned = cleaned.replace(pattern, ' ').trim();
    }
    cleaned = cleaned.replace(/^\d+\s+/, '').replace(/\s+/g, ' ').trim();
    cleaned = stripCedexSuffix(cleaned);
    const looksStreety = STREET_KEYWORDS.test(cleaned) && (/\d/.test(cleaned) || cleaned.split(/\s+/).length >= 3);
    if (looksStreety) {
      return '';
    }
    return formatCommune(cleaned);
  };

  const scoreCommuneCandidate = (value) => {
    if (!value) {
      return -Infinity;
    }
    let score = 0;
    const hasDigits = /\d/.test(value);
    if (!hasDigits) {
      score += 4;
    } else if (!/^paris\s*\d{1,2}/i.test(value)) {
      score -= 2;
    }
    if (looksLikeDetailedAddress(value)) {
      score -= 4;
    }
    if (value.length >= 3) {
      score += 1;
    }
    return score;
  };

  const pickBestCommune = (candidates, postalCode) => {
    const postalCoords = getPostalCoordinates(postalCode) || null;
    const postalLabel = postalCoords ? formatCommuneWithPostal(postalCoords.label || '', postalCode) : '';
    let best = '';
    let bestScore = -Infinity;
    (candidates || []).forEach((raw) => {
      const cleaned = cleanCommuneCandidate(raw, postalCode);
      if (!cleaned) {
        return;
      }
      const score = scoreCommuneCandidate(cleaned);
      if (score > bestScore) {
        bestScore = score;
        best = cleaned;
      }
    });
    return best || postalLabel || '';
  };

  const collectPostalCodes = (club) => {
    const codes = new Set();
    if (club.postalCode) {
      codes.add(club.postalCode);
    }
    [club.address, club.siege, club.addressStandard].forEach((value) => {
      const parsed = parsePostalCodeFromString(value || '');
      if (parsed) {
        codes.add(parsed);
      }
      const matches = (value || '').match(/\b\d{5}\b/g);
      if (matches) {
        matches.forEach((code) => codes.add(code));
      }
    });
    return Array.from(codes);
  };

  const normalisePostalCodeValue = (value) => {
    if (!value) {
      return '';
    }
    const digits = value.toString().replace(/\D/g, '').trim();
    if (digits.length !== 5) {
      return '';
    }
    return digits;
  };

  const extractParisPostal = (value) => {
    if (!value) {
      return null;
    }
    const raw = value.toString();
    const direct = raw.match(/\b75\d{3}\b/);
    if (direct && direct[0]) {
      return direct[0];
    }
    const arr = raw.match(/paris[^0-9]{0,3}(\d{1,2})\s*(?:e|eme|ème|er)?\b/i);
    if (arr && arr[1]) {
      const num = Number.parseInt(arr[1], 10);
      if (Number.isFinite(num) && num >= 1 && num <= 20) {
        return `750${num.toString().padStart(2, '0')}`;
      }
    }
    return null;
  };

  const deriveParisPostalFromClub = (club) => {
    const fields = [
      club.postalCode,
      club.addressStandard,
      club.address,
      club.siege,
      club.commune,
      club.name,
    ];
    for (let i = 0; i < fields.length; i += 1) {
      const code = extractParisPostal(fields[i]);
      if (code) {
        return code;
      }
    }
    return null;
  };

  const POSTAL_COORDINATES_SEED = {
    '92000': { label: 'Nanterre', lat: 48.8927825, lng: 2.2073652 },
    '92100': { label: 'Boulogne-Billancourt', lat: 48.837494, lng: 2.2378546 },
    '92110': { label: 'Clichy', lat: 48.9027893, lng: 2.3093052 },
    '92120': { label: 'Montrouge', lat: 48.8150655, lng: 2.3163712 },
    '92130': { label: 'Issy-les-Moulineaux', lat: 48.8233607, lng: 2.2653052 },
    '92140': { label: 'Clamart', lat: 48.7959696, lng: 2.2549138 },
    '92150': { label: 'Suresnes', lat: 48.8711349, lng: 2.2217833 },
    '92160': { label: 'Antony', lat: 48.750728, lng: 2.2987872 },
    '92170': { label: 'Vanves', lat: 48.8219675, lng: 2.2901321 },
    '92190': { label: 'Meudon', lat: 48.8097395, lng: 2.229958 },
    '92200': { label: 'Neuilly-sur-Seine', lat: 48.8800801, lng: 2.257544 },
    '92210': { label: 'Saint-Cloud', lat: 48.8439913, lng: 2.2117806 },
    '92220': { label: 'Bagneux', lat: 48.7981949, lng: 2.3110192 },
    '92230': { label: 'Gennevilliers', lat: 48.9287242, lng: 2.2963202 },
    '92240': { label: 'Malakoff', lat: 48.8187167, lng: 2.3008083 },
    '92250': { label: 'La Garenne-Colombes', lat: 48.9070703, lng: 2.2445272 },
    '92260': { label: 'Fontenay-aux-Roses', lat: 48.7908946, lng: 2.2867846 },
    '92270': { label: 'Bois-Colombes', lat: 48.9165336, lng: 2.2690732 },
    '92290': { label: 'Châtenay-Malabry', lat: 48.7697842, lng: 2.2650969 },
    '92300': { label: 'Levallois-Perret', lat: 48.8935077, lng: 2.2886109 },
    '92310': { label: 'Sèvres', lat: 48.822245, lng: 2.2117665 },
    '92320': { label: 'Châtillon', lat: 48.8044684, lng: 2.2893633 },
    '92330': { label: 'Sceaux', lat: 48.7784655, lng: 2.2893399 },
    '92340': { label: 'Bourg-la-Reine', lat: 48.7794333, lng: 2.316237 },
    '92350': { label: 'Le Plessis-Robinson', lat: 48.7797706, lng: 2.2581995 },
    '92370': { label: 'Chaville', lat: 48.8090026, lng: 2.1924797 },
    '92380': { label: 'Garches', lat: 48.8469069, lng: 2.1893546 },
    '92400': { label: 'Courbevoie', lat: 48.9010419, lng: 2.266358 },
    '92410': { label: "Ville-d'Avray", lat: 48.8214672, lng: 2.1763211 },
    '92420': { label: 'Vaucresson', lat: 48.8364225, lng: 2.1506469 },
    '92430': { label: 'Marnes-la-Coquette', lat: 48.8287849, lng: 2.1646468 },
    '92500': { label: 'Rueil-Malmaison', lat: 48.8718031, lng: 2.1801931 },
    '92600': { label: 'Asnières-sur-Seine', lat: 48.9137552, lng: 2.288062 },
    '92700': { label: 'Colombes', lat: 48.9223905, lng: 2.2521192 },
    '92800': { label: 'Puteaux', lat: 48.8826865, lng: 2.2410641 },
    '75001': { label: 'Paris 1er', lat: 48.8627, lng: 2.335 },
    '75002': { label: 'Paris 2e', lat: 48.8697, lng: 2.3431 },
    '75003': { label: 'Paris 3e', lat: 48.8638, lng: 2.3616 },
    '75004': { label: 'Paris 4e', lat: 48.8546, lng: 2.3582 },
    '75005': { label: 'Paris 5e', lat: 48.8443, lng: 2.3506 },
    '75006': { label: 'Paris 6e', lat: 48.8493, lng: 2.3331 },
    '75007': { label: 'Paris 7e', lat: 48.8566, lng: 2.3125 },
    '75008': { label: 'Paris 8e', lat: 48.8754, lng: 2.3174 },
    '75009': { label: 'Paris 9e', lat: 48.8829, lng: 2.3499 },
    '75010': { label: 'Paris 10e', lat: 48.875, lng: 2.359 },
    '75011': { label: 'Paris 11e', lat: 48.8599, lng: 2.3775 },
    '75012': { label: 'Paris 12e', lat: 48.8353, lng: 2.3958 },
    '75013': { label: 'Paris 13e', lat: 48.8292, lng: 2.3551 },
    '75014': { label: 'Paris 14e', lat: 48.8323, lng: 2.325 },
    '75015': { label: 'Paris 15e', lat: 48.8419, lng: 2.3034 },
    '75016': { label: 'Paris 16e', lat: 48.8602, lng: 2.27 },
    '75017': { label: 'Paris 17e', lat: 48.8876, lng: 2.3079 },
    '75018': { label: 'Paris 18e', lat: 48.8913, lng: 2.344 },
    '75019': { label: 'Paris 19e', lat: 48.8896, lng: 2.3772 },
    '75020': { label: 'Paris 20e', lat: 48.8674, lng: 2.3984 },
  };

  const postalCoordinatesIndex = new Map();
  const communeCoordinatesByName = new Map();

  const addCommuneCoordinate = (label, postalCode, lat, lng) => {
    const key = normaliseCommuneKey(label);
    if (!key) {
      return;
    }
    if (!communeCoordinatesByName.has(key)) {
      communeCoordinatesByName.set(key, { postalCode: postalCode || '', lat, lng, label });
    }
  };

  const addPostalCoordinateEntry = (postalCode, entry = {}) => {
    const code = (postalCode || entry.postalCode || entry.code || entry.postcode || '').toString().trim();
    if (!code) {
      return;
    }
    const lat = Number.parseFloat(entry.lat ?? entry.latitude ?? (Array.isArray(entry) ? entry[1] : null));
    const lng = Number.parseFloat(entry.lng ?? entry.lon ?? entry.longitude ?? (Array.isArray(entry) ? entry[2] : null));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return;
    }
    const label = (entry.label ?? entry.commune ?? (Array.isArray(entry) ? entry[3] : '') ?? '').toString();
    const record = { postalCode: code, lat, lng, label };
    if (!postalCoordinatesIndex.has(code)) {
      postalCoordinatesIndex.set(code, []);
    }
    postalCoordinatesIndex.get(code).push(record);
    if (label && label !== code) {
      addCommuneCoordinate(label, code, lat, lng);
    }
  };

  const seedPostalCoordinateEntries = (entries) => {
    (entries || []).forEach((entry) => {
      if (!entry) {
        return;
      }
      if (Array.isArray(entry)) {
        const [postalCode, lat, lng, label] = entry;
        addPostalCoordinateEntry(postalCode, { lat, lng, label });
        return;
      }
      addPostalCoordinateEntry(entry.postalCode || entry.code || entry.postcode, entry);
    });
  };

  seedPostalCoordinateEntries(
    Object.entries(POSTAL_COORDINATES_SEED).map(([postalCode, value]) => ({
      postalCode,
      ...value,
    }))
  );

  let postalCoordinatesPromise = null;
  const loadPostalCoordinates = () => {
    if (postalCoordinatesPromise) {
      return postalCoordinatesPromise;
    }
    postalCoordinatesPromise = fetchJson(POSTAL_COORDINATES_DATA_URL)
      .then((payload) => {
        let entries = [];
        if (Array.isArray(payload)) {
          entries = payload;
        } else if (payload && Array.isArray(payload.entries)) {
          entries = payload.entries;
        } else if (payload && typeof payload === 'object') {
          entries = Object.entries(payload).map(([postalCode, value]) => ({ postalCode, ...value }));
        }
        seedPostalCoordinateEntries(entries);
        return postalCoordinatesIndex;
      })
      .catch((error) => {
        console.warn('[clubs-fr-map] Impossible de charger les coordonnées postales.', error);
        return postalCoordinatesIndex;
      });
    return postalCoordinatesPromise;
  };

  const getPostalCoordinateEntries = (postalCode) => {
    const key = (postalCode || '').toString().trim();
    if (!key) {
      return [];
    }
    const entries = postalCoordinatesIndex.get(key);
    return entries ? entries.slice() : [];
  };

  const getPostalCoordinates = (postalCode, preferredCommune = '') => {
    const entries = getPostalCoordinateEntries(postalCode);
    if (!entries.length) {
      return null;
    }
    const targetKey = normaliseCommuneForCompare(preferredCommune);
    const best =
      targetKey &&
      entries.find((entry) => {
        const label = formatCommuneWithPostal(entry?.label || '', postalCode);
        return label && normaliseCommuneForCompare(label) === targetKey;
      });
    const selected = best || entries[0];
    const label = formatCommuneWithPostal(selected.label || '', postalCode) || selected.label;
    return { postalCode: selected.postalCode || postalCode, lat: selected.lat, lng: selected.lng, label };
  };

  const getCommuneCoordinatesByName = (value) => {
    if (!value) {
      return null;
    }
    const key = normaliseCommuneKey(value);
    if (!key) {
      return null;
    }
    const entry = communeCoordinatesByName.get(key);
    if (!entry) {
      return null;
    }
    return { postalCode: entry.postalCode, lat: entry.lat, lng: entry.lng, label: entry.label };
  };

  const getPostalReferenceForClub = (club) => {
    if (!club) {
      return null;
    }
    const candidates = collectPostalCodes(club)
      .map((code) => normalisePostalCodeValue(code))
      .filter(Boolean);
    if (!candidates.length) {
      return null;
    }
    for (let i = 0; i < candidates.length; i += 1) {
      const postal = candidates[i];
      const coords = getPostalCoordinates(postal, club.commune);
      if (coords) {
        return { postal, coords };
      }
    }
    return null;
  };

  const detectSuspectCoordinates = (club, coords) => {
    if (!club || !coords) {
      return null;
    }
    const ref = getPostalReferenceForClub(club);
    if (!ref) {
      return null;
    }
    const distanceKm = haversineKm(coords.lat, coords.lng, ref.coords.lat, ref.coords.lng);
    if (!Number.isFinite(distanceKm) || distanceKm <= MAP_SUSPECT_DISTANCE_KM) {
      return null;
    }
    return {
      club,
      coords,
      distanceKm,
      postalCode: ref.postal,
      referenceLabel: ref.coords.label || '',
    };
  };

  const reportMapIssues = (issues) => {
    if (!issues.length) {
      return;
    }
    issues.forEach((issue) => {
      const label = issue.club?.name || issue.club?.slug || 'club';
      console.warn(
        `[clubs-fr-map] Coordonnées suspectes: ${label} (${issue.postalCode}) à ${issue.distanceKm.toFixed(1)} km.`
      );
    });
  };

  const DEPT_FALLBACK_COORDS = {
    '75': { label: 'Paris', lat: 48.8566, lng: 2.3522 },
    '77': { label: 'Seine-et-Marne', lat: 48.5396, lng: 2.6526 },
    '78': { label: 'Yvelines', lat: 48.8049, lng: 2.1204 },
    '91': { label: 'Essonne', lat: 48.6298, lng: 2.4417 },
    '92': { label: 'Hauts-de-Seine', lat: 48.8927825, lng: 2.2073652 },
    '93': { label: 'Seine-Saint-Denis', lat: 48.9047, lng: 2.4395 },
    '94': { label: 'Val-de-Marne', lat: 48.7904, lng: 2.455 },
    '95': { label: "Val-d'Oise", lat: 49.036, lng: 2.063 },
  };

  const getDeptFallbackCoordinates = (postalCode) => {
    if (!postalCode) {
      return null;
    }
    const str = postalCode.toString().trim();
    if (str.length < 2) {
      return null;
    }
    const dept = str.slice(0, 2);
    const entry = DEPT_FALLBACK_COORDS[dept];
    if (!entry) {
      return null;
    }
    return { lat: entry.lat, lng: entry.lng, label: entry.label, postalCode: str };
  };

  const GEOCODE_STORAGE_KEY = `echecs92:clubs-fr:geocode:${GEO_HINTS_VERSION}`;
  const GEO_WARM_KEY = `echecs92:clubs-fr:geocode-warm:${GEO_HINTS_VERSION}`;
  const GEO_WARM_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours : les adresses changent rarement
  const GEOCODE_ENDPOINT = 'https://nominatim.openstreetmap.org/search';
  const geocodeCache = new Map();
  const GEO_HINTS_STORAGE_KEY = `echecs92:clubs-fr:geo-hints:${GEO_HINTS_VERSION}`;
  const geoHintsCache = new Map();

  const loadGeocodeCache = () => {
    try {
      const raw = window.localStorage.getItem(GEOCODE_STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        Object.entries(parsed).forEach(([key, value]) => geocodeCache.set(key, value));
      }
    } catch {
      // ignore
    }
  };

  const persistGeocodeCache = () => {
    try {
      const obj = {};
      geocodeCache.forEach((value, key) => {
        obj[key] = value;
      });
      window.localStorage.setItem(GEOCODE_STORAGE_KEY, JSON.stringify(obj));
    } catch {
      // ignore
    }
  };

  const loadGeoHintsCache = () => {
    try {
      const raw = window.localStorage.getItem(GEO_HINTS_STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        Object.entries(parsed).forEach(([key, value]) => geoHintsCache.set(key, value));
      }
    } catch {
      // ignore
    }
  };

  const persistGeoHintsCache = () => {
    try {
      const obj = {};
      geoHintsCache.forEach((value, key) => {
        obj[key] = value;
      });
      window.localStorage.setItem(GEO_HINTS_STORAGE_KEY, JSON.stringify(obj));
    } catch {
      // ignore
    }
  };

  const loadGeocodeWarmTs = () => {
    try {
      const raw = window.localStorage.getItem(GEO_WARM_KEY);
      if (!raw) {
        return 0;
      }
      const ts = Number.parseInt(raw, 10);
      return Number.isFinite(ts) ? ts : 0;
    } catch {
      return 0;
    }
  };

  const persistGeocodeWarmTs = () => {
    try {
      window.localStorage.setItem(GEO_WARM_KEY, `${Date.now()}`);
    } catch {
      // ignore
    }
  };

  const GEOCODE_ENABLED = false;

  const geocodePlace = (query, options = {}) => {
    if (!GEOCODE_ENABLED) {
      return Promise.resolve(null);
    }
    const expectedPostal = (options.postalCode || '').toString().trim();
    const allowPostalMismatch = options.allowMismatch === true;
    const normalizedQuery = normalise(query).replace(/\s+/g, ' ').trim();
    const key = `${normalizedQuery}|${expectedPostal}`;
    if (!key) {
      return Promise.resolve(null);
    }
    const cached = geocodeCache.get(key);
    if (cached) {
      if (typeof cached.then === 'function') {
        return cached;
      }
      return Promise.resolve(cached);
    }

    const params = new URLSearchParams({
      format: 'json',
      addressdetails: '1',
      limit: '1',
      countrycodes: 'fr',
      q: expectedPostal ? `${query} ${expectedPostal}` : query,
    });

    const request = fetch(`${GEOCODE_ENDPOINT}?${params.toString()}`, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'echecs92-clubs-map-fr/1.0 (contact@echecs92.com)',
      },
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.json();
      })
      .then((payload) => {
        if (!Array.isArray(payload) || !payload.length) {
          return null;
        }
        const first = payload[0];
        const lat = Number.parseFloat(first.lat);
        const lng = Number.parseFloat(first.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          return null;
        }
        const postalCodeRaw = first?.address?.postcode || '';
        const postalCode = postalCodeRaw.split(';')[0].trim();
        if (!allowPostalMismatch && expectedPostal && postalCode && postalCode !== expectedPostal) {
          return null;
        }
        return {
          lat,
          lng,
          label: formatCommune(first.display_name || ''),
          postalCode: postalCode || expectedPostal,
        };
      })
      .catch(() => null)
      .then((result) => {
        geocodeCache.set(key, result);
        persistGeocodeCache();
        return result;
      });

    geocodeCache.set(key, request);
    return request;
  };

  let staticGeoHintsPromise = null;
  const loadStaticGeoHints = () => {
    if (!staticGeoHintsPromise) {
      staticGeoHintsPromise = fetchJson(GEO_HINTS_REMOTE_URL)
        .then((payload) => {
          const hints = payload && typeof payload === 'object' ? payload.hints || {} : {};
          const map = new Map();
          Object.entries(hints).forEach(([slug, value]) => {
            if (!value || typeof value !== 'object') {
              return;
            }
            const lat = Number.parseFloat(value.lat);
            const lng = Number.parseFloat(value.lng);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
              return;
            }
            const precision =
              value.precision ||
              (typeof value.source === 'string' && value.source.toLowerCase().includes('manual') ? 'exact' : 'geocoded');
            map.set(slug, {
              lat,
              lng,
              postalCode: value.postalCode || '',
              precision,
            });
          });
          return map;
        })
        .catch(() => new Map());
    }
    return staticGeoHintsPromise;
  };

  const geocodeClubIfNeeded = async (club) => {
    if (!club || typeof club !== 'object') {
      return false;
    }
    if (!needsPreciseCoordinates(club)) {
      return false;
    }
    const postalCandidates = collectPostalCodes(club);
    const expectedPostal = postalCandidates[0] || '';
    const queries = [
      club.addressStandard || '',
      club.address || '',
      club.siege || '',
      (club.commune && expectedPostal) ? `${club.commune} ${expectedPostal}` : '',
      club.commune || '',
      expectedPostal,
      club.name || '',
    ]
      .map((q) => (q || '').trim())
      .filter(Boolean);

    const attemptGeocode = async (postalConstraint, allowMismatch) => {
      for (let i = 0; i < queries.length; i += 1) {
        const q = queries[i];
        try {
          const place = await geocodePlace(q, { postalCode: postalConstraint, allowMismatch });
          if (place) {
            club.latitude = place.lat;
            club.longitude = place.lng;
            club._coordPrecision = 'geocoded';
            if (!club.postalCode && place.postalCode) {
              club.postalCode = place.postalCode;
            }
            const signature = buildClubSignature(club);
            if (signature) {
              geoHintsCache.set(signature, {
                lat: club.latitude,
                lng: club.longitude,
                postalCode: club.postalCode || postalConstraint || '',
                precision: 'geocoded',
              });
              persistGeoHintsCache();
            }
            return true;
          }
        } catch {
          // try next query
        }
      }
      return false;
    };

    // First pass: keep postal constraint for precision.
    const strictResult = await attemptGeocode(expectedPostal, false);
    if (strictResult) {
      return true;
    }
    // Second pass: relax postal to match geocoder result if strict search failed.
    const relaxedResult = await attemptGeocode('', true);
    if (relaxedResult) {
      return true;
    }

    return false;
  };

  const buildClubSignature = (club) => {
    const parts = [
      club.id || '',
      club.name || '',
      club.addressStandard || club.address || '',
      club.siege || '',
      club.postalCode || '',
      club.commune || '',
    ]
      .map((part) => (part || '').toString().trim().toLowerCase())
      .filter(Boolean);
    return parts.join('|');
  };

  const applyStaticHints = (clubs, hints) => {
    if (!(hints instanceof Map) || !hints.size) {
      return;
    }
    clubs.forEach((club) => {
      const key = club.slug || club.id || '';
      if (!key || !hints.has(key)) {
        return;
      }
      const hint = hints.get(key);
      if (!hint) {
        return;
      }
      const lat = Number.parseFloat(hint.lat);
      const lng = Number.parseFloat(hint.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return;
      }
      const precision = hint.precision || 'geocoded';
      club.latitude = lat;
      club.longitude = lng;
      club._coordPrecision = precision;
      if (!club.postalCode && hint.postalCode) {
        club.postalCode = hint.postalCode;
      }
      const signature = buildClubSignature(club);
      if (signature) {
        geoHintsCache.set(signature, { lat, lng, postalCode: club.postalCode || '', precision });
      }
    });
  };

  const needsPreciseCoordinates = () => false;

  const geocodeClubsBatch = async (clubs, options = {}) => {
    const items = Array.isArray(clubs) ? clubs : [];
    const limit = Number.isFinite(options.limit) ? options.limit : 120;
    const delayMs = Number.isFinite(options.delayMs) ? options.delayMs : 150;
    const concurrency = Math.max(1, Math.min(8, Number.parseInt(options.concurrency || 4, 10)));
    let processed = 0;
    let index = 0;

    const worker = async () => {
      while (processed < limit && index < items.length) {
        const current = items[index];
        index += 1;
        if (!current) {
          continue;
        }
        const did = await geocodeClubIfNeeded(current);
        if (did) {
          processed += 1;
          if (delayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
          }
        }
      }
    };

    const workers = Array.from({ length: concurrency }, () => worker());
    await Promise.all(workers);
    return processed;
  };

  const lookupLocalCoordinates = (query) => {
    const raw = (query || '').toString().trim();
    if (!raw) {
      return null;
    }

    const postalMatches = raw.match(/\b(\d{5})\b/g);
    if (postalMatches) {
      for (let i = 0; i < postalMatches.length; i += 1) {
        const coords = getPostalCoordinates(postalMatches[i]);
        if (coords) {
          return { latitude: coords.lat, longitude: coords.lng, label: coords.label, postalCode: coords.postalCode };
        }
      }
    }

    const candidates = new Set();
    candidates.add(raw);
    const formatted = formatCommune(raw);
    if (formatted) {
      candidates.add(formatted);
    }
    raw
      .split(/[;,\/\n]/)
      .map((part) => part.trim())
      .filter(Boolean)
      .forEach((part) => {
        candidates.add(part);
        const formattedPart = formatCommune(part);
        if (formattedPart) {
          candidates.add(formattedPart);
        }
      });

    for (const candidate of candidates) {
      const coords = getCommuneCoordinatesByName(candidate);
      if (coords) {
        return { latitude: coords.lat, longitude: coords.lng, label: coords.label, postalCode: coords.postalCode };
      }
    }

    return null;
  };

  const sanitiseFfeRef = (value) => {
    const str = (value || '').toString().trim();
    if (!str) {
      return '';
    }
    const match = str.match(/(\d{2,})$/);
    return match ? match[1] : '';
  };

  const buildFfeLookupKey = (name, postalCode, commune) => {
    const normalizedName = normalise(name || '').replace(/[^a-z0-9]/g, '');
    const normalizedCity = normalise(commune || '').replace(/[^a-z0-9]/g, '');
    const normalizedPostal = (postalCode || '').toString().replace(/\D/g, '').trim();
    if (!normalizedName && !normalizedCity && !normalizedPostal) {
      return '';
    }
    return [normalizedName || 'club', normalizedPostal || '00000', normalizedCity || ''].join('|');
  };

  const buildFfeNamePostalKey = (name, postalCode) => {
    const normalizedName = normalise(name || '').replace(/[^a-z0-9]/g, '');
    const normalizedPostal = (postalCode || '').toString().replace(/\D/g, '').trim();
    if (!normalizedName && !normalizedPostal) {
      return '';
    }
    return [normalizedName || 'club', normalizedPostal || '00000'].join('|');
  };

  const buildFfeDetailsLookup = (entries) => {
    const byRef = new Map();
    const byKey = new Map();
    const byNamePostal = new Map();
    (Array.isArray(entries) ? entries : []).forEach((entry) => {
      if (!entry || typeof entry !== 'object') {
        return;
      }
      const ref = sanitiseFfeRef(entry.ffe_ref || entry.ref || entry.ffeRef || entry.fiche_ffe);
      if (ref && !byRef.has(ref)) {
        byRef.set(ref, entry);
      }
      const name = entry.nom || entry.name || '';
      const address = entry.salle_jeu || entry.salle || entry.adresse || entry.address || '';
      const siege = entry.siege || entry.siege_social || '';
      const parts = extractAddressParts(address || siege);
      const postalCode = entry.code_postal || entry.postal_code || entry.postalCode || parts.postalCode || '';
      const commune = entry.commune || entry.ville || parts.city || '';
      const key = buildFfeLookupKey(name, postalCode, commune);
      if (key && !byKey.has(key)) {
        byKey.set(key, entry);
      }
      const namePostalKey = buildFfeNamePostalKey(name, postalCode);
      if (namePostalKey && !byNamePostal.has(namePostalKey)) {
        byNamePostal.set(namePostalKey, entry);
      }
    });
    return { byRef, byKey, byNamePostal };
  };

  const adaptClubRecord = (raw) => {
    if (!raw || typeof raw !== 'object') {
      return raw;
    }
    if (raw.id && raw.name) {
      return raw;
    }
	    const name = normaliseDashes(raw.nom || raw.name || '');
    const primaryAddressMeta = normaliseAddressField(raw.salle_jeu || raw.salle || raw.adresse || raw.address || '');
    const secondaryAddressMeta = normaliseAddressField(raw.siege || raw.siege_social || raw.address2 || '');
    const primaryAddress = primaryAddressMeta.full;
    const secondaryAddress = secondaryAddressMeta.full;
    const addressParts = extractAddressParts(primaryAddress || secondaryAddress);
    const secondaryParts = extractAddressParts(secondaryAddress);
    const postalCode =
      raw.code_postal ||
      raw.postal_code ||
      raw.postalCode ||
      addressParts.postalCode ||
      secondaryParts.postalCode ||
      '';
    const postalForCommune = postalCode || addressParts.postalCode || secondaryParts.postalCode || '';
    const communeCandidates = [
      raw.commune,
      raw.ville,
      addressParts.city,
      secondaryParts.city,
      deriveCityFromPostal(primaryAddress, postalForCommune),
      deriveCityFromPostal(secondaryAddress, postalForCommune),
    ];
    const baseCommune = dedupeCommuneLabel(pickBestCommune(communeCandidates, postalForCommune));
	    const commune = normaliseDashes(formatCommuneWithPostal(baseCommune, postalForCommune));
    const streetHint = primaryAddressMeta.streetLike || secondaryAddressMeta.streetLike || '';
    const standardAddress = buildStandardAddress(
      streetHint,
      secondaryAddress,
      postalCode,
      commune || baseCommune || addressParts.city || secondaryParts.city || ''
    );
    const slugSource = name || commune || postalForCommune || primaryAddress || secondaryAddress;
    const id = raw.id || slugify(slugSource) || 'club';

    const rawSite = raw.site || raw.website || '';
    let site = rawSite;
    if (site && !/^https?:/i.test(site)) {
      site = `https://${site.replace(/^\/+/g, '')}`;
    }

    const toFloat = (value) => {
      if (value == null || value === '') {
        return null;
      }
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) ? parsed : null;
    };

    const latitude =
      toFloat(raw.latitude ?? raw.lat ?? raw.location?.latitude ?? raw.location?.lat) ?? null;
    const longitude =
      toFloat(raw.longitude ?? raw.lng ?? raw.lon ?? raw.location?.longitude ?? raw.location?.lng) ??
      null;
    const initialFfeRef = sanitiseFfeRef(raw.ffe_ref ?? raw.ffeRef ?? raw.fiche_ffe);

	    return {
	      id,
	      name: name || commune || 'Club sans nom',
	      commune,
	      address: primaryAddress || secondaryAddress || '',
	      siege: secondaryAddress || '',
	      salle: normaliseDashes(raw.salle_jeu || raw.salle || ''),
	      phone: '',
	      fax: '',
	      email: '',
	      site,
	      president: '',
	      presidentEmail: '',
	      contact: '',
	      contactEmail: '',
	      hours: normaliseDashes(raw.horaires || raw.hours || ''),
	      accesPmr: normaliseDashes(raw.acces_pmr || ''),
	      interclubs: normaliseDashes(raw.interclubs || ''),
	      interclubsJeunes: normaliseDashes(raw.interclubs_jeunes || ''),
	      interclubsFeminins: normaliseDashes(raw.interclubs_feminins || ''),
	      labelFederal: normaliseDashes(raw.label_federal || ''),
      ffeRef: initialFfeRef,
      postalCode,
      addressStandard: standardAddress,
      addressDisplay: standardAddress || primaryAddress || secondaryAddress || '',
      latitude,
      longitude,
      slug: '',
      _communeSlug: slugify(commune || baseCommune || ''),
      departmentCode:
        raw.departmentCode ||
        raw.department_code ||
        raw.department ||
        raw.departement ||
        raw.dept ||
        '',
	      departmentName: normaliseDashes(raw.departmentName || raw.department_name || raw.departement_nom || raw.departmentLabel || ''),
	      departmentSlug: normaliseDashes(raw.departmentSlug || raw.department_slug || raw.departement_slug || ''),
	    };
	  };

  const refreshClubDisplay = (club) => {
    if (!club || typeof club !== 'object') {
      return;
    }
    club.addressDisplay = club.addressStandard || club.address || club.siege || '';
  };

  const applyFfeDetails = (clubs, lookup) => {
    if (!Array.isArray(clubs) || !lookup) {
      return;
    }
    const findDetail = (club) => {
      const ref = sanitiseFfeRef(club?.ffeRef || club?.fiche_ffe);
      if (ref && lookup.byRef && lookup.byRef.has(ref)) {
        return lookup.byRef.get(ref);
      }
      const key = buildFfeLookupKey(club?.name || '', club?.postalCode || '', club?.commune || '');
      if (key && lookup.byKey && lookup.byKey.has(key)) {
        return lookup.byKey.get(key);
      }
      const namePostalKey = buildFfeNamePostalKey(club?.name || '', club?.postalCode || '');
      if (namePostalKey && lookup.byNamePostal && lookup.byNamePostal.has(namePostalKey)) {
        return lookup.byNamePostal.get(namePostalKey);
      }
      return null;
    };
    const assignIfPresent = (club, key, value) => {
      if (!club || typeof club !== 'object') {
        return;
      }
      if (value != null && value !== '') {
        club[key] = value;
      }
    };
    clubs.forEach((club) => {
      const detail = findDetail(club);
      if (!detail) {
        return;
      }
      const ffeClub = adaptClubRecord(detail);
      assignIfPresent(club, 'name', ffeClub.name);
      assignIfPresent(club, 'commune', ffeClub.commune);
      assignIfPresent(club, 'address', ffeClub.address);
      assignIfPresent(club, 'salle', ffeClub.salle);
      assignIfPresent(club, 'siege', ffeClub.siege);
      assignIfPresent(club, 'addressStandard', ffeClub.addressStandard);
      assignIfPresent(club, 'site', ffeClub.site);
      assignIfPresent(club, 'hours', ffeClub.hours);
      assignIfPresent(club, 'accesPmr', ffeClub.accesPmr);
      assignIfPresent(club, 'interclubs', ffeClub.interclubs);
      assignIfPresent(club, 'interclubsJeunes', ffeClub.interclubsJeunes);
      assignIfPresent(club, 'interclubsFeminins', ffeClub.interclubsFeminins);
      assignIfPresent(club, 'labelFederal', ffeClub.labelFederal);
      assignIfPresent(club, 'postalCode', ffeClub.postalCode);
      if (ffeClub.ffeRef) {
        club.ffeRef = ffeClub.ffeRef;
      }
      if (ffeClub.fiche_ffe) {
        club.fiche_ffe = ffeClub.fiche_ffe;
      }
    });
  };

  const resolveClubCoordinates = (club) => {
    if (!club) {
      return null;
    }

    const signature = buildClubSignature(club);
    if (signature && geoHintsCache.has(signature)) {
      const hint = geoHintsCache.get(signature);
      const lat = Number.parseFloat(hint.lat);
      const lng = Number.parseFloat(hint.lng);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        club.latitude = lat;
        club.longitude = lng;
        if (hint.postalCode && !club.postalCode) {
          club.postalCode = hint.postalCode;
        }
        club._coordPrecision = hint.precision || 'hint';
      }
    }

    const directLat = Number.parseFloat(club.latitude ?? club.lat);
    const directLng = Number.parseFloat(club.longitude ?? club.lng ?? club.lon);
    if (Number.isFinite(directLat) && Number.isFinite(directLng)) {
      const precision = club._coordPrecision || 'exact';
      return {
        lat: directLat,
        lng: directLng,
        label: club.commune || club.addressStandard || club.address || club.name || '',
        postalCode: club.postalCode || '',
        precision,
      };
    }

    if (club.addressStandard) {
      const addressFallback = lookupLocalCoordinates(club.addressStandard);
      if (addressFallback) {
        return {
          lat: addressFallback.latitude,
          lng: addressFallback.longitude,
          label: addressFallback.label || club.addressStandard,
          postalCode: addressFallback.postalCode || '',
          precision: 'approx',
        };
      }
    }

    if (club.commune) {
      const coords = getCommuneCoordinatesByName(club.commune);
      if (coords) {
        return { lat: coords.lat, lng: coords.lng, label: coords.label, postalCode: coords.postalCode, precision: 'commune' };
      }
    }

    const postalCandidates = collectPostalCodes(club);
    for (let i = 0; i < postalCandidates.length; i += 1) {
      const coords = getPostalCoordinates(postalCandidates[i], club.commune);
      if (coords) {
        return { lat: coords.lat, lng: coords.lng, label: coords.label, postalCode: coords.postalCode, precision: 'postal' };
      }
    }

    const parisPostal = deriveParisPostalFromClub(club);
    if (parisPostal) {
      const coords = getPostalCoordinates(parisPostal, club.commune);
      if (coords) {
        return { lat: coords.lat, lng: coords.lng, label: coords.label, postalCode: coords.postalCode, precision: 'postal' };
      }
    }

    if (club.addressStandard) {
      const addressFallback = lookupLocalCoordinates(club.addressStandard);
      if (addressFallback) {
        return {
          lat: addressFallback.latitude,
          lng: addressFallback.longitude,
          label: addressFallback.label || club.addressStandard,
          postalCode: addressFallback.postalCode || '',
          precision: 'approx',
        };
      }
    }

    if (club.commune) {
      const fallback = lookupLocalCoordinates(club.commune);
      if (fallback) {
        return {
          lat: fallback.latitude,
          lng: fallback.longitude,
          label: fallback.label || club.commune,
          postalCode: fallback.postalCode || '',
          precision: 'commune',
        };
      }
    }

    return null;
  };

  const buildFeaturesFromClubs = (clubs) => {
    const list = [];
    mapIssues.length = 0;
    (Array.isArray(clubs) ? clubs : []).forEach((club) => {
      const coords = resolveClubCoordinates(club);
      const precision = coords?.precision || 'unknown';
      const isParisHint = precision === 'hint' && isParisPostal(club.postalCode);
      if (coords && COORD_PRECISION_ALLOWED[precision] && !isParisHint) {
        list.push({ club, coords });
        const issue = detectSuspectCoordinates(club, coords);
        if (issue) {
          mapIssues.push(issue);
        }
      }
    });
    return list;
  };

  const getClubDetailUrl = (club) => {
    if (!club) {
      return '#';
    }
    const base = detailBase || '';
    const slug = club.slug || club._communeSlug || club.id || slugify(club.name || '');
    if (!base) {
      return `?club=${encodeURIComponent(slug)}`;
    }
    if (base.includes('?')) {
      const url = new URL(base, window.location.origin);
      const firstParam = Array.from(url.searchParams.keys())[0] || 'id';
      url.searchParams.set(firstParam, slug);
      return url.pathname + url.search;
    }
    const normalized = base.endsWith('/') ? base : `${base}/`;
    return `${normalized}${encodeURIComponent(slug)}/`;
  };

  const createPopupContent = (club, coords) => {
    const lines = [`<strong>${club.name}</strong>`];
    if (club.addressDisplay) {
      lines.push(club.addressDisplay);
    } else if (club.commune) {
      lines.push(club.commune);
    }
    const detailUrl = getClubDetailUrl(club);
    lines.push(`<a class="clubs-map__detail-link" href="${detailUrl}">Voir la fiche</a>`);
    return lines.join('<br>');
  };

  const handleMapLinkInteraction = (event) => {
    const target = event.target;
    if (!target || !(target instanceof Element)) {
      return;
    }
    if (!target.classList.contains('clubs-map__detail-link')) {
      return;
    }
    if (event.type === 'auxclick' && event.button !== 1) {
      return;
    }
    const fromListingPage = mapHostPath === listPath;
    const backPath = getCurrentBackPath();
    const fallbackBackPath = fromListingPage ? listPath : mapPath;
    rememberNavigation('detail:map', backPath || fallbackBackPath);
  };

  mapElement.addEventListener('click', handleMapLinkInteraction);
  mapElement.addEventListener('auxclick', handleMapLinkInteraction);

  updateStatus('Chargement de la carte…', 'info');
  const spinnerHost = mapElement.closest('.clubs-map__container') || mapElement;
  const releaseSpinner =
    typeof window !== 'undefined' && window.cdjeSpinner && typeof window.cdjeSpinner.show === 'function'
      ? window.cdjeSpinner.show('Chargement de la carte…', { host: spinnerHost })
      : () => {};

  const waitForLeaflet = () =>
    new Promise((resolve, reject) => {
      if (typeof L !== 'undefined') {
        resolve(true);
        return;
      }
      const started = Date.now();
      const check = setInterval(() => {
        if (typeof L !== 'undefined') {
          clearInterval(check);
          resolve(true);
          return;
        }
        if (Date.now() - started > 8000) {
          clearInterval(check);
          reject(new Error('leaflet-unavailable'));
        }
      }, 80);
    });

  loadGeocodeCache();
  loadGeoHintsCache();

  waitForLeaflet()
    .then(() => Promise.all([loadFranceClubsDataset(), loadStaticGeoHints(), loadPostalCoordinates(), loadFfeDetails()]))
    .then(([payload, staticHints, _postalCoordinates, ffeDetails]) => {
      const data = Array.isArray(payload) ? payload : [];
      if (!data.length) {
        updateStatus('Aucun club à afficher pour le moment.', 'error');
        return;
      }

      const clubs = data.map(adaptClubRecord);
      if (Array.isArray(ffeDetails) && ffeDetails.length) {
        applyFfeDetails(clubs, buildFfeDetailsLookup(ffeDetails));
        clubs.forEach(refreshClubDisplay);
      }
      ensureUniqueSlugs(clubs);
      applyStaticHints(clubs, staticHints);

      mapFeatures = buildFeaturesFromClubs(clubs);

      mapInstance = L.map(mapElement, {
        zoomControl: true,
        scrollWheelZoom: true,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 18,
      }).addTo(mapInstance);

      const shouldCluster = !hasDepartmentFilter;
      markersLayer =
        shouldCluster && typeof L.markerClusterGroup === 'function'
          ? L.markerClusterGroup({
              showCoverageOnHover: false,
              spiderfyOnMaxZoom: true,
              maxClusterRadius: 60,
              chunkedLoading: true,
              disableClusteringAtZoom: 14,
            }).addTo(mapInstance)
          : L.layerGroup().addTo(mapInstance);

      const renderMarkers = (list, { refit = false } = {}) => {
        markersLayer.clearLayers();
        const bounds = L.latLngBounds();
        const metroBounds = L.latLngBounds();
        list.forEach(({ club, coords }) => {
          const marker = L.marker([coords.lat, coords.lng], {
            title: club.name,
          });
          marker.bindPopup(createPopupContent(club, coords), {
            keepInView: true,
          });
          if (typeof markersLayer.addLayer === 'function') {
            markersLayer.addLayer(marker);
          } else {
            marker.addTo(markersLayer);
          }
          bounds.extend([coords.lat, coords.lng]);
          if (isMetropolitanCoordinate(coords.lat, coords.lng)) {
            metroBounds.extend([coords.lat, coords.lng]);
          }
        });
        const preferredBounds = metroBounds.isValid() ? metroBounds : bounds;
        if (bounds.isValid()) {
          fullBounds = preferredBounds;
        }
        if (preferredBounds.isValid() && (refit || !hasFittedView)) {
          if (list.length === 1) {
            mapInstance.setView(preferredBounds.getCenter(), 13);
          } else {
            mapInstance.fitBounds(preferredBounds, { padding: [32, 32], maxZoom: 14 });
          }
          hasFittedView = true;
        }
      };

      if (mapFeatures.length) {
        renderMarkers(mapFeatures, { refit: true });
        const baseStatus = `${mapFeatures.length} club${mapFeatures.length > 1 ? 's' : ''} affiché${
          mapFeatures.length > 1 ? 's' : ''
        } sur la carte.`;
        if (mapIssues.length) {
          updateStatus(
            `${baseStatus} Attention: ${mapIssues.length} club${mapIssues.length > 1 ? 's' : ''} ont des coordonnées suspectes.`,
            'warning'
          );
          reportMapIssues(mapIssues);
        } else {
          updateStatus(baseStatus, 'success');
        }
      } else {
        updateStatus('Aucun club positionné pour le moment.', 'error');
      }

      setTimeout(() => {
        mapInstance.invalidateSize();
        mapReady = true;
        flushPendingMapFocus();
      }, 100);
    })
    .catch((error) => {
      console.error('[clubs-fr-map] Chargement de la carte impossible', error);
      const code = error && typeof error.message === 'string' ? error.message : '';
      if (code === 'leaflet-unavailable') {
        updateStatus('Impossible de charger la carte (Leaflet indisponible). Réessayez dans un instant.', 'error');
      } else {
        updateStatus('Impossible de charger la carte pour le moment. Veuillez réessayer plus tard.', 'error');
      }
    })
    .finally(() => {
      if (typeof releaseSpinner === 'function') {
        releaseSpinner();
      } else if (releaseSpinner && typeof releaseSpinner.hide === 'function') {
        releaseSpinner.hide();
      }
    });
})();
