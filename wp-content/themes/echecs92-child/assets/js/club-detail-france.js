/**
 * Club detail view renderer.
 * Loads the clubs dataset and displays the selected club based on ?id= query param.
 */
(function () {
  const GEO_HINTS_VERSION = '20250201';
  const DATA_MANIFEST_URL = '/wp-content/themes/echecs92-child/assets/data/clubs-france.json';
  const DATA_FALLBACK_BASE_PATH = '/wp-content/themes/echecs92-child/assets/data/clubs-france/';
  const FFE_MANIFEST_URL = '/wp-content/themes/echecs92-child/assets/data/clubs-france-ffe.json';
  const FFE_FALLBACK_BASE_PATH = '/wp-content/themes/echecs92-child/assets/data/clubs-france-ffe/';
  const FFE_URL_BASE = 'https://www.echecs.asso.fr/FicheClub.aspx?Ref=';
  const FFE_PLAYER_URL_BASE = 'https://www.echecs.asso.fr/FicheJoueur.aspx?Id=';
  const GEO_HINTS_REMOTE_URL = `/wp-content/themes/echecs92-child/assets/data/clubs-france-hints.json?v=${GEO_HINTS_VERSION}`;
  const FFE_LISTS_BASE_PATH = '/wp-content/themes/echecs92-child/assets/data/clubs-france-ffe-details/';
  const CLUBS_NAV_STORAGE_KEY = 'echecs92:clubs-fr:last-listing';
  const CLUBS_NAV_SESSION_KEY = `${CLUBS_NAV_STORAGE_KEY}:session`;
  const DASH_RX = /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE63\uFF0D]/g;
  const normaliseDashes = (value) => (value == null ? '' : value.toString()).replace(DASH_RX, '-');
  const detailContainer = document.getElementById('club-detail');
  const backLink = document.querySelector('[data-club-back]');
  const backLinkMap = document.querySelector('[data-club-back-map]');
  const actionsContainer = document.querySelector('.club-detail__actions');
  let manifestPromise = null;
  let datasetPromise = null;

  const fetchJson = (url) =>
    fetch(url, { headers: { Accept: 'application/json' } }).then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.json();
    });

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

  let ffeManifestPromise = null;
  const loadFfeManifest = () => {
    if (!ffeManifestPromise) {
      ffeManifestPromise = fetchJson(FFE_MANIFEST_URL)
        .then((payload) => {
          const basePath = payload?.basePath || FFE_FALLBACK_BASE_PATH;
          const departments = Array.isArray(payload?.departments) ? payload.departments : [];
          return { basePath, departments };
        })
        .catch(() => ({ basePath: FFE_FALLBACK_BASE_PATH, departments: [] }));
    }
    return ffeManifestPromise;
  };

  const fetchDepartmentFfeRefs = async (entry, manifestMeta) => {
    const url = buildDeptUrl(entry, manifestMeta.basePath);
    if (!url) {
      return [];
    }
    try {
      const payload = await fetchJson(url);
      return Array.isArray(payload) ? payload : [];
    } catch (error) {
      console.warn(`[club-detail-fr] FFE refs indisponibles pour ${entry.code || '?'} (${url}).`, error);
      return [];
    }
  };

  let ffeRefsPromise = null;
  const loadFfeRefs = () => {
    if (!ffeRefsPromise) {
      ffeRefsPromise = loadFfeManifest().then(async (manifestMeta) => {
        const departments = manifestMeta.departments || [];
        if (!departments.length) {
          return [];
        }
        const chunks = await Promise.all(
          departments.map((entry) => fetchDepartmentFfeRefs(entry, manifestMeta))
        );
        return chunks.flat();
      });
    }
    return ffeRefsPromise;
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
      console.warn(`[club-detail-fr] Département ${entry.code || '?'} indisponible (${url}).`, error);
      return [];
    }
  };

  const loadFranceClubsDataset = () => {
    if (!datasetPromise) {
      datasetPromise = loadManifest().then(async (manifestMeta) => {
        const departments = manifestMeta.departments || [];
        if (!departments.length) {
          return [];
        }
        const chunks = await Promise.all(departments.map((entry) => fetchDepartmentClubs(entry, manifestMeta)));
        return chunks.flat();
      });
    }
    return datasetPromise;
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
            map.set(slug, {
              lat,
              lng,
              postalCode: value.postalCode || '',
            });
          });
          return map;
        })
        .catch(() => new Map());
    }
    return staticGeoHintsPromise;
  };

  if (!detailContainer) {
    return;
  }

  const readStoredClubsNavigation = () => {
    const MAX_AGE_MS = 10 * 60 * 1000;
    const now = Date.now();

    const parsePayload = (raw) => {
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch (error) {
        payload = null;
      }
      const timestamp = payload && typeof payload.ts === 'number' ? payload.ts : null;
      if (!timestamp) {
        return null;
      }
      if (now - timestamp > MAX_AGE_MS) {
        return null;
      }
      return payload;
    };

    try {
      const local = window.localStorage;
      const session = window.sessionStorage;

      if (local) {
        const raw = local.getItem(CLUBS_NAV_STORAGE_KEY);
        if (raw) {
          local.removeItem(CLUBS_NAV_STORAGE_KEY);
          const payload = parsePayload(raw);
          if (payload) {
            const refreshed = { ...payload, ts: now };
            if (session) {
              session.setItem(CLUBS_NAV_SESSION_KEY, JSON.stringify(refreshed));
            }
            return refreshed;
          }
        }
      }

      if (session) {
        const raw = session.getItem(CLUBS_NAV_SESSION_KEY);
        if (!raw) {
          return null;
        }
        const payload = parsePayload(raw);
        if (!payload) {
          session.removeItem(CLUBS_NAV_SESSION_KEY);
          return null;
        }
        const refreshed = { ...payload, ts: now };
        session.setItem(CLUBS_NAV_SESSION_KEY, JSON.stringify(refreshed));
        return refreshed;
      }

      return null;
    } catch (error) {
      return null;
    }
  };

  const storedNavigation = readStoredClubsNavigation();

  const getStoredBackPath = (fallback) => {
    if (storedNavigation && storedNavigation.back) {
      try {
        const url = new URL(storedNavigation.back, window.location.origin);
        if (url.origin === window.location.origin) {
          return url.pathname + url.search + url.hash;
        }
      } catch (error) {
        // ignore invalid URLs
      }
    }
    return fallback;
  };

  const deriveBackHrefFromParam = () => {
    try {
      const params = new URLSearchParams(window.location.search || '');
      const from = (params.get('from') || '').trim();
      if (!from || !from.startsWith('/')) {
        return '';
      }
      return from;
    } catch (error) {
      return '';
    }
  };

  const getBackKindForPath = (value) => {
    const path = (value || '').toString().trim();
    if (!path) {
      return '';
    }
    const cleaned = path.split('?')[0].split('#')[0];
    if (/^\/joueur\b/i.test(cleaned)) {
      return 'player';
    }
    if (/^\/joueurs(?:-92)?\b/i.test(cleaned)) {
      return 'players';
    }
    if (/^\/clubs\b/i.test(cleaned)) {
      return 'clubs';
    }
    if (/^\/carte-des-clubs\b/i.test(cleaned)) {
      return 'map';
    }
    return '';
  };

  const getBackLabelForKind = (kind) => {
    if (kind === 'player') {
      return '← Retour à la fiche du joueur';
    }
    if (kind === 'players') {
      return '← Retour à la recherche des joueurs';
    }
    if (kind === 'map') {
      return '← Retour à la carte des clubs';
    }
    return '← Retour à la liste de clubs';
  };

  const cameFromClubsSearch = () => {
    if (storedNavigation && storedNavigation.context === 'detail:list') {
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
      const normalized = refUrl.pathname.replace(/\/+$/u, '') || '/';
      return normalized === '/clubs';
    } catch (error) {
      return false;
    }
  };

  const cameFromClubsMap = () => {
    if (storedNavigation && storedNavigation.context === 'detail:map') {
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
      const normalized = refUrl.pathname.replace(/\/+$/u, '') || '/';
      return normalized === '/carte-des-clubs';
    } catch (error) {
      return false;
    }
  };

  const updateBackLinkVisibility = () => {
    const fromParam = deriveBackHrefFromParam();
    if (fromParam) {
      const kind = getBackKindForPath(fromParam);
      if (backLink) {
        backLink.href = fromParam;
        backLink.textContent = getBackLabelForKind(kind);
        backLink.removeAttribute('hidden');
      }
      if (backLinkMap) {
        backLinkMap.setAttribute('hidden', '');
      }
      if (actionsContainer) {
        const hasListBack = backLink && !backLink.hasAttribute('hidden');
        actionsContainer.classList.toggle('club-detail__actions--solo-share', !hasListBack);
      }
      return;
    }

    const showMapBack = cameFromClubsMap();
    const showListBack = !showMapBack && cameFromClubsSearch();

    if (backLink) {
      if (showListBack) {
        backLink.href = getStoredBackPath('/clubs');
        backLink.textContent = '← Retour à la liste de clubs';
        backLink.removeAttribute('hidden');
      } else {
        backLink.setAttribute('hidden', '');
      }
    }
    if (backLinkMap) {
      if (showMapBack) {
        backLinkMap.href = getStoredBackPath('/carte-des-clubs');
        backLinkMap.textContent = '← Retour à la carte des clubs';
        backLinkMap.removeAttribute('hidden');
      } else {
        backLinkMap.setAttribute('hidden', '');
      }
    }

    if (actionsContainer) {
      const hasListBack = backLink && !backLink.hasAttribute('hidden');
      const hasMapBack = backLinkMap && !backLinkMap.hasAttribute('hidden');
      actionsContainer.classList.toggle('club-detail__actions--solo-share', !(hasListBack || hasMapBack));
    }
  };

  updateBackLinkVisibility();

  const deriveClubSlugFromPath = () => {
    const pathMatch = window.location.pathname.match(/\/club\/([^\/?#]+)/i);
    if (pathMatch && pathMatch[1]) {
      try {
        return decodeURIComponent(pathMatch[1]);
      } catch (err) {
        return pathMatch[1];
      }
    }
    const params = new URLSearchParams(window.location.search || '');
    const fallback = params.get('id') || params.get('club') || '';
    return fallback || '';
  };

  const clubSlug = deriveClubSlugFromPath();
  const getPathSegments = () =>
    (window.location.pathname || '')
      .toString()
      .replace(/\/+$/u, '')
      .split('/')
      .filter(Boolean);
  const pathSegments = getPathSegments();
  const isFfeListsView =
    pathSegments.length >= 3 && (pathSegments[pathSegments.length - 1] || '').toLowerCase() === 'ffe';

  const renderMessage = (message, tone = 'error') => {
    detailContainer.innerHTML = `<p class="clubs-empty" data-tone="${tone}">${message}</p>`;
  };

  const formatPhone = (value) => {
    if (!value) {
      return null;
    }
    const digits = value.replace(/\D/g, '');
    if (digits.length !== 10) {
      return value;
    }
    return digits.replace(/(\d{2})(?=\d)/g, '$1 ').trim();
  };

  const splitLines = (value) => {
    if (!value) {
      return [];
    }
    if (Array.isArray(value)) {
      return value.map((line) => String(line).trim()).filter(Boolean);
    }
    return value
      .toString()
      .split(/\r?\n|;/)
      .map((line) => line.trim())
      .filter(Boolean);
  };

  const normalise = (value) =>
    (value || '')
      .toString()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

  const slugify = (value) => {
    const base = normalise(value)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
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
        entries[0]._communeSlug = slugify(entries[0].commune || '');
        return;
      }
      const sorted = entries
        .map((club) => ({ club, key: stableKey(club) }))
        .sort((a, b) => a.key.localeCompare(b.key, 'en', { sensitivity: 'base' }));
      sorted.forEach((entry, idx) => {
        const suffix = idx === 0 ? '' : `-${toBase36(idx + 1)}`;
        entry.club.slug = `${base}${suffix}`;
        entry.club._communeSlug = slugify(entry.club.commune || '');
      });
    });
  };

  const buildClubLookup = (clubs) => {
    const map = new Map();
    (clubs || []).forEach((club) => {
      if (!club || typeof club !== 'object') {
        return;
      }
      const buildVariantSlug = (overrides) =>
        buildShortSlugBase({
          ...club,
          ...overrides,
        });
      const legacySlugNoDept = buildVariantSlug({
        departmentCode: '',
        departmentSlug: '',
        departmentName: '',
      });
      const legacySlugNoCommune = buildVariantSlug({
        commune: '',
      });
      const legacySlugNoDeptNoCommune = buildVariantSlug({
        departmentCode: '',
        departmentSlug: '',
        departmentName: '',
        commune: '',
      });
      const aliases = new Set([
        club.slug,
        club.id,
        club._communeSlug,
        slugify(club.name || ''),
        slugify(club.commune || ''),
        legacySlugNoDept,
        legacySlugNoCommune,
        legacySlugNoDeptNoCommune,
      ]);
      aliases.forEach((alias) => {
        const key = (alias || '').toString().trim().toLowerCase();
        if (key && !map.has(key)) {
          map.set(key, club);
        }
      });
    });
    return map;
  };

  const normaliseSlugLookupKey = (value) =>
    (value || '')
      .toString()
      .trim()
      .toLowerCase()
      .replace(/^-+|-+$/g, '');

  const buildSlugLookupCandidates = (slug) => {
    const candidates = [];
    const seen = new Set();
    const push = (value) => {
      const key = normaliseSlugLookupKey(value);
      if (!key || seen.has(key)) {
        return;
      }
      seen.add(key);
      candidates.push(key);
    };
    push(slug);
    for (let i = 0; i < candidates.length; i += 1) {
      const key = candidates[i];
      if (key.includes('-hellip-')) {
        push(key.replace(/-hellip-/g, '-'));
      }
      if (key.endsWith('-hellip')) {
        push(key.replace(/-hellip$/g, ''));
      }
      if (key.endsWith('hellip')) {
        push(key.replace(/hellip$/g, ''));
      }
      if (key.endsWith('-')) {
        push(key.slice(0, -1));
      }
      if (key.includes('-')) {
        const withoutLastSegment = key.replace(/-[^-]+$/g, '');
        if (withoutLastSegment.length >= 8) {
          push(withoutLastSegment);
        }
      }
    }
    return candidates.sort((a, b) => b.length - a.length);
  };

  const findClubBySlugPrefix = (candidate, lookup) => {
    if (!candidate || !lookup || candidate.length < 8) {
      return null;
    }
    const matches = new Map();
    lookup.forEach((club, aliasKey) => {
      if (!aliasKey || aliasKey.length < candidate.length) {
        return;
      }
      if (!aliasKey.startsWith(candidate)) {
        return;
      }
      const uniqueKey =
        club && typeof club === 'object' ? club.slug || club.id || aliasKey : aliasKey;
      if (!matches.has(uniqueKey)) {
        matches.set(uniqueKey, club);
      }
    });
    if (matches.size === 1) {
      return matches.values().next().value || null;
    }
    return null;
  };

  const findClubBySlug = (slug, lookup) => {
    const candidates = buildSlugLookupCandidates(slug);
    if (!candidates.length || !lookup) {
      return null;
    }
    for (let i = 0; i < candidates.length; i += 1) {
      const key = candidates[i];
      if (lookup.has(key)) {
        return lookup.get(key);
      }
    }
    for (let i = 0; i < candidates.length; i += 1) {
      const resolved = findClubBySlugPrefix(candidates[i], lookup);
      if (resolved) {
        return resolved;
      }
    }
    return null;
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
      const lat = Number.parseFloat(hint.lat);
      const lng = Number.parseFloat(hint.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return;
      }
      club.latitude = lat;
      club.longitude = lng;
      if (!club.postalCode && hint.postalCode) {
        club.postalCode = hint.postalCode;
      }
    });
  };

  const sanitiseFfeRef = (value) => {
    const str = (value || '').toString().trim();
    if (!str) {
      return '';
    }
    const match = str.match(/(\d{2,})$/);
    return match ? match[1] : '';
  };

  const loadFfeLists = async (ref) => {
    const refId = sanitiseFfeRef(ref);
    if (!refId) {
      return null;
    }
    const url = `${FFE_LISTS_BASE_PATH}${encodeURIComponent(refId)}.json`;
    try {
      return await fetchJson(url);
    } catch (error) {
      return null;
    }
  };

  const buildFfeLookupKey = (name, postalCode, commune) => {
    const normalizedName = normalise(name || '').replace(/[^a-z0-9]/g, '');
    const normalizedCity = normalise(commune || '').replace(/[^a-z0-9]/g, '');
    const normalizedPostal = (postalCode || '').toString().trim();
    if (!normalizedName && !normalizedCity && !normalizedPostal) {
      return '';
    }
    return [normalizedName || 'club', normalizedPostal || '00000', normalizedCity || ''].join('|');
  };

  const buildFfeLookup = (entries) => {
    const bySlug = new Map();
    const byKey = new Map();
    (Array.isArray(entries) ? entries : []).forEach((entry) => {
      const ref = sanitiseFfeRef(entry.ref || entry.ffe_ref || entry.fiche_ffe || entry.ffeRef);
      if (!ref) {
        return;
      }
      const slug = entry.slug || entry.id || '';
      if (slug && !bySlug.has(slug)) {
        bySlug.set(slug, ref);
      }
      const key = buildFfeLookupKey(
        entry.name || '',
        entry.postalCode || entry.postal_code || '',
        entry.commune || entry.city || ''
      );
      if (key && !byKey.has(key)) {
        byKey.set(key, ref);
      }
    });
    return { bySlug, byKey };
  };

  const applyFfeRefs = (clubs, lookup) => {
    if (!Array.isArray(clubs) || !lookup) {
      return;
    }
    const applyRef = (club, refCandidate) => {
      const ref = sanitiseFfeRef(refCandidate);
      if (!ref) {
        return false;
      }
      club.ffeRef = ref;
      club.fiche_ffe = `${FFE_URL_BASE}${encodeURIComponent(ref)}`;
      return true;
    };
    clubs.forEach((club) => {
      if (!club || typeof club !== 'object') {
        return;
      }
      const existingUrl =
        club.fiche_ffe && /^https?:/i.test(club.fiche_ffe) ? club.fiche_ffe : '';
      const slugKey = club.slug || club.id || '';
      if (slugKey && lookup.bySlug && lookup.bySlug.has(slugKey)) {
        if (applyRef(club, lookup.bySlug.get(slugKey))) {
          return;
        }
      }
      const lookupKey = buildFfeLookupKey(club.name, club.postalCode, club.commune);
      if (lookupKey && lookup.byKey && lookup.byKey.has(lookupKey)) {
        if (applyRef(club, lookup.byKey.get(lookupKey))) {
          return;
        }
      }
      if (applyRef(club, club.ffeRef || club.fiche_ffe)) {
        return;
      }
      if (existingUrl) {
        club.fiche_ffe = existingUrl;
      }
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
      const parts = result.full.split(',').map((part) => part.trim()).filter(Boolean);
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

  const VENUE_KEYWORDS =
    /\b(maison|espace|centre|complexe|gymnase|salle|foyer|club|ecole|école|stade|dojo|arena|halle|mairie)\b/i;

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
    if (VENUE_KEYWORDS.test(value)) {
      return false;
    }
    const withoutPostal = value.replace(/\b\d{5}\b/g, ' ').replace(/\s+/g, ' ').trim();
    if (!withoutPostal) {
      return true;
    }
    if (/^[\p{L}\s'’-]+$/u.test(withoutPostal)) {
      return true;
    }
    return withoutPostal.split(' ').length <= 3;
  };

  const stripLeadingCity = (value, cityHint) => {
    const cleaned = (value || '').toString().trim();
    if (!cleaned) {
      return '';
    }
    const city = formatCommune(cityHint || '');
    if (!city) {
      return cleaned;
    }
    const escapedCity = city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^${escapedCity}\\b[\\s,;:\\-]+`, 'i');
    const stripped = cleaned.replace(pattern, '').trim();
    return stripped || cleaned;
  };

  const extractStreetCore = (value) => {
    const cleaned = (value || '').toString().replace(/\s+/g, ' ').trim();
    if (!cleaned) {
      return '';
    }
    const keywordMatch = cleaned.match(STREET_KEYWORDS);
    if (!keywordMatch || keywordMatch.index == null) {
      return cleaned;
    }
    let startIndex = keywordMatch.index;
    const before = cleaned.slice(0, startIndex);
    const numberMatches = Array.from(before.matchAll(/\b\d+[A-Za-z]?\b/g));
    const lastNumber = numberMatches[numberMatches.length - 1];
    if (lastNumber && Number.isFinite(lastNumber.index)) {
      const distance = startIndex - (lastNumber.index + lastNumber[0].length);
      if (distance >= 0 && distance <= 24) {
        startIndex = lastNumber.index;
      }
    }
    return cleaned
      .slice(startIndex)
      .replace(/^[,;\s\-]+/, '')
      .replace(/\b\d{5}\b.*$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const simplifyStreetSegment = (value, cityHint = '') => {
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
        let candidate = match.replace(/\s+/g, ' ').trim();
        if (STREET_KEYWORDS.test(candidate)) {
          candidate = extractStreetCore(candidate);
        }
        candidate = stripLeadingCity(candidate, cityHint)
          .replace(/\b\d{5}\b.*$/g, '')
          .replace(/\s+/g, ' ')
          .replace(/^[,;\s\-]+|[,;\s\-]+$/g, '')
          .trim();
        if (candidate && !looksLikePostalOnly(candidate)) {
          return candidate;
        }
      }
    }
    const fallback = parts.find((part) => !looksLikePostalOnly(part)) || parts[0];
    if (!fallback) {
      return '';
    }
    const cleanedFallback = stripLeadingCity(fallback, cityHint).replace(/\s+/g, ' ').trim();
    if (!cleanedFallback || looksLikePostalOnly(cleanedFallback)) {
      return '';
    }
    return cleanedFallback;
  };

  const buildStandardAddress = (primaryAddress, secondaryAddress, postalCode, city) => {
    const street =
      simplifyStreetSegment(primaryAddress, city) || simplifyStreetSegment(secondaryAddress, city) || '';
    const formattedCity = formatCommune(city);
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
	    const base = normaliseDashes((raw || '').toString()).replace(/\s+/g, ' ').trim();
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
    const raw = (address || '').toString();
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

  const normaliseCommuneKey = (value) => normalise(value).replace(/[^a-z0-9]/g, '');

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

  const POSTAL_COORDINATES = {
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

  const COMMUNE_COORDINATES_BY_NAME = Object.entries(POSTAL_COORDINATES).reduce(
    (acc, [postalCode, info]) => {
      const key = normaliseCommuneKey(info.label);
      if (key && !acc[key]) {
        acc[key] = { postalCode, lat: info.lat, lng: info.lng, label: info.label };
      }
      return acc;
    },
    {}
  );

  const getPostalCoordinates = (postalCode, preferredCommune = '') => {
    if (!postalCode) {
      return null;
    }
    const key = postalCode.toString().trim();
    if (!key) {
      return null;
    }
    const entry = POSTAL_COORDINATES[key];
    if (!entry) {
      return null;
    }
    const label = formatCommuneWithPostal(preferredCommune || entry.label || '', key) || entry.label;
    return { postalCode: key, lat: entry.lat, lng: entry.lng, label };
  };

  const getCommuneCoordinatesByName = (value) => {
    if (!value) {
      return null;
    }
    const key = normaliseCommuneKey(value);
    if (!key) {
      return null;
    }
    const entry = COMMUNE_COORDINATES_BY_NAME[key];
    if (!entry) {
      return null;
    }
    return { postalCode: entry.postalCode, lat: entry.lat, lng: entry.lng, label: entry.label };
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

  const geocodeClubIfNeeded = async (club) => {
    if (!club || typeof club !== 'object') {
      return false;
    }
    const hasCoords =
      Number.isFinite(Number.parseFloat(club.latitude)) &&
      Number.isFinite(Number.parseFloat(club.longitude));
    if (hasCoords) {
      return false;
    }
    const query = club.addressStandard || club.address || club.siege || club.commune || club.name || '';
    if (!query.trim()) {
      return false;
    }
    try {
      const place = await geocodePlace(query);
      if (!place) {
        return false;
      }
      club.latitude = place.lat;
      club.longitude = place.lng;
      if (!club.postalCode && place.postalCode) {
        club.postalCode = place.postalCode;
      }
      return true;
    } catch {
      return false;
    }
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

  const GEOCODE_STORAGE_KEY = `echecs92:club-detail-fr:geocode:${GEO_HINTS_VERSION}`;
  const GEOCODE_ENDPOINT = 'https://nominatim.openstreetmap.org/search';
  const geocodeCache = new Map();

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
      // ignore storage errors
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
      // ignore storage errors
    }
  };

  const geocodePlace = (query) => {
    const key = normalise(query).replace(/\s+/g, ' ').trim();
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
      q: query,
    });

    const request = fetch(`${GEOCODE_ENDPOINT}?${params.toString()}`, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'echecs92-club-detail-fr/1.0 (contact@echecs92.com)',
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
        return {
          lat,
          lng,
          label: formatCommune(first.display_name || ''),
          postalCode,
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

  const resolveClubCoordinates = (club) => {
    if (!club || typeof club !== 'object') {
      return null;
    }

    const lat = Number.parseFloat(club.latitude ?? club.lat);
    const lng = Number.parseFloat(club.longitude ?? club.lng ?? club.lon);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return {
        lat,
        lng,
        label: club.commune || club.name || '',
        postalCode: club.postalCode || '',
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
        };
      }
    }

    if (club.commune) {
      const coords = getCommuneCoordinatesByName(club.commune);
      if (coords) {
        return { lat: coords.lat, lng: coords.lng, label: coords.label, postalCode: coords.postalCode };
      }
    }

    const postalCandidates = collectPostalCodes(club);
    for (let i = 0; i < postalCandidates.length; i += 1) {
      const coords = getPostalCoordinates(postalCandidates[i], club.commune);
      if (coords) {
        return { lat: coords.lat, lng: coords.lng, label: coords.label, postalCode: coords.postalCode };
      }
    }

    for (let i = 0; i < postalCandidates.length; i += 1) {
      const fallback = getDeptFallbackCoordinates(postalCandidates[i]);
      if (fallback) {
        return fallback;
      }
    }

    const parisPostal = deriveParisPostalFromClub(club);
    if (parisPostal) {
      const coords = getPostalCoordinates(parisPostal, club.commune);
      if (coords) {
        return { lat: coords.lat, lng: coords.lng, label: coords.label, postalCode: coords.postalCode };
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
        };
      }
    }

    return null;
  };

  const buildDirectionsUrl = (coords, club) => {
    const addressCandidate = (
      club?.addressStandard ||
      club?.address ||
      club?.siege ||
      coords?.label ||
      club?.commune ||
      ''
    ).trim();
    let destinationValue = '';
    if (addressCandidate) {
      destinationValue = addressCandidate;
    } else {
      const lat = Number.parseFloat(coords?.lat);
      const lng = Number.parseFloat(coords?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return '';
      }
      destinationValue = `${lat},${lng}`;
    }
    const destination = encodeURIComponent(destinationValue);
    const label = encodeURIComponent(club?.name || coords?.label || 'Club');
    const ua = navigator.userAgent || '';
    const platform = navigator.platform || '';
    const isAppleMobile =
      /iP(hone|od|ad)/i.test(ua) ||
      (/Mac/i.test(platform) && 'ontouchend' in window);
    if (isAppleMobile) {
      return `http://maps.apple.com/?daddr=${destination}&q=${label}`;
    }
    return `https://www.google.com/maps/dir/?api=1&destination=${destination}&destination_place_id=&travelmode=driving`;
  };

  const renderClubMap = (club, container, statusElement, directionsButton) => {
    if (!container) {
      return;
    }

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

    const coords = resolveClubCoordinates(club);
    if (!coords) {
      updateStatus('Localisation indisponible pour ce club.', 'error');
      if (directionsButton) {
        directionsButton.hidden = true;
      }
      return;
    }

    const activateDirections = () => {
      if (!directionsButton) {
        return;
      }
      const url = buildDirectionsUrl(coords, club);
      if (!url) {
        directionsButton.hidden = true;
        return;
      }
      const clubLabel = (club?.name || 'ce club').trim();
      directionsButton.href = url;
      directionsButton.setAttribute(
        'aria-label',
        `Ouvrir l'itinéraire vers ${clubLabel} (nouvel onglet)`
      );
      directionsButton.setAttribute('title', `Ouvrir l'itinéraire vers ${clubLabel}`);
      directionsButton.hidden = false;
    };

    const initialiseMap = (attempt = 0) => {
      if (typeof L === 'undefined') {
        if (attempt > 30) {
          updateStatus('Carte indisponible pour le moment.', 'error');
          activateDirections();
          return;
        }
        window.setTimeout(() => initialiseMap(attempt + 1), 150);
        return;
      }
      try {
        const map = L.map(container, {
          zoomControl: true,
          scrollWheelZoom: true,
        });
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          maxZoom: 18,
        }).addTo(map);
        const popupLines = [`<strong>${club.name}</strong>`];
        if (club.addressDisplay) {
          popupLines.push(club.addressDisplay);
        } else if (coords.label) {
          popupLines.push(coords.label);
        }
        const marker = L.marker([coords.lat, coords.lng], {
          title: club.name,
        });
        marker.addTo(map).bindPopup(popupLines.join('<br>'));
        map.setView([coords.lat, coords.lng], 14);
        window.setTimeout(() => {
          map.invalidateSize();
        }, 150);
        updateStatus('Localisation du club affichée.', 'success');
        activateDirections();
      } catch (error) {
        updateStatus('Carte indisponible pour le moment.', 'error');
        activateDirections();
      }
    };

    updateStatus('Chargement de la carte…', 'info');
    initialiseMap();
  };

  const adaptClubRecord = (raw) => {
    if (!raw || typeof raw !== 'object') {
      return raw;
    }
    if (raw.id && raw.name) {
      return raw;
    }
	    const name = normaliseDashes(raw.nom || raw.name || '');
    const primaryAddressMeta = normaliseAddressField(
      raw.salle_jeu || raw.salle || raw.adresse || raw.address || ''
    );
    const secondaryAddressMeta = normaliseAddressField(raw.siege || raw.siege_social || raw.address2 || '');
    const salleMeta = normaliseAddressField(raw.salle_jeu || raw.salle || '');
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
    const commune = formatCommuneWithPostal(baseCommune, postalForCommune);
    const providedStandardAddress = normaliseDashes(
      raw.adresse_standard || raw.address_standard || raw.addressStandard || ''
    ).trim();
    const standardAddress =
      providedStandardAddress ||
      buildStandardAddress(
        primaryAddress,
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

    const toNumber = (value) => {
      if (value == null || value === '') {
        return null;
      }
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : null;
    };

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
	      name: name || normaliseDashes(commune || '') || 'Club sans nom',
	      commune: normaliseDashes(commune || ''),
	      address: primaryAddress || secondaryAddress || '',
	      siege: secondaryAddress || '',
	      salle: salleMeta.full || '',
	      addressStandard: standardAddress,
	      addressDisplay: standardAddress || primaryAddress || secondaryAddress || '',
	      phone: '',
	      fax: '',
	      email: '',
	      site,
	      president: '',
	      presidentEmail: '',
	      contact: '',
	      contactEmail: '',
	      hours: normaliseDashes(raw.horaires || raw.hours || ''),
	      publics: normaliseDashes(raw.publics || ''),
	      tarifs: normaliseDashes(raw.tarifs || ''),
	      notes: normaliseDashes(raw.notes || ''),
	      accesPmr: normaliseDashes(raw.acces_pmr || ''),
	      interclubs: normaliseDashes(raw.interclubs || ''),
	      interclubsJeunes: normaliseDashes(raw.interclubs_jeunes || ''),
	      interclubsFeminins: normaliseDashes(raw.interclubs_feminins || ''),
	      labelFederal: normaliseDashes(raw.label_federal || ''),
      ffeRef: initialFfeRef,
      fiche_ffe: raw.fiche_ffe || '',
      tags: Array.isArray(raw.tags) ? raw.tags : [],
      latitude,
      longitude,
      licenses: {
        A: toNumber(raw.licences_a ?? raw.licenses_a ?? raw.license_a),
        B: toNumber(raw.licences_b ?? raw.licenses_b ?? raw.license_b),
      },
      postalCode,
      slug: '',
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

  const createChip = (text, variant) => {
    const span = document.createElement('span');
    span.className = `club-chip${variant ? ` club-chip--${variant}` : ''}`;
    span.textContent = text;
    return span;
  };

  const createSection = (_title) => {
    const section = document.createElement('section');
    section.className = 'club-section';

    const list = document.createElement('ul');
    list.className = 'club-section__list';
    section.appendChild(list);

    return { section, list };
  };

  const createDisclosure = (title, options = {}) => {
    const details = document.createElement('details');
    details.className = `club-disclosure${options.className ? ` ${options.className}` : ''}`;
    if (options.open) {
      details.open = true;
    }

    const summary = document.createElement('summary');
    summary.textContent = title;
    details.appendChild(summary);

    const content = document.createElement('div');
    content.className = 'club-disclosure__content';
    details.appendChild(content);

    return { details, content, summary };
  };

  let copyFeedbackBubble = null;
  let copyFeedbackHideTimer = null;

  const ensureCopyFeedbackBubble = () => {
    if (copyFeedbackBubble) {
      return copyFeedbackBubble;
    }
    if (typeof document === 'undefined' || !document.body) {
      return null;
    }
    const bubble = document.createElement('div');
    bubble.className = 'club-copy-feedback-bubble';
    bubble.setAttribute('role', 'status');
    bubble.setAttribute('aria-live', 'polite');
    bubble.hidden = true;
    document.body.appendChild(bubble);
    copyFeedbackBubble = bubble;
    return copyFeedbackBubble;
  };

  const hideCopyFeedbackBubble = () => {
    if (!copyFeedbackBubble) {
      return;
    }
    copyFeedbackBubble.classList.remove('is-visible');
    copyFeedbackBubble.hidden = true;
    delete copyFeedbackBubble.dataset.tone;
  };

  const resolveCopyFeedbackPoint = (event, element, fallbackPoint) => {
    const scrollX = window.scrollX || window.pageXOffset || 0;
    const scrollY = window.scrollY || window.pageYOffset || 0;
    const rect = element?.getBoundingClientRect ? element.getBoundingClientRect() : null;
    const anchorY = rect
      ? rect.top + scrollY + rect.height / 2
      : scrollY + (window.innerHeight || document.documentElement?.clientHeight || 0) / 2;

    if (fallbackPoint && Number.isFinite(fallbackPoint.x)) {
      return { x: fallbackPoint.x + scrollX, y: anchorY };
    }

    const eventX = Number(event?.clientX);
    const eventY = Number(event?.clientY);
    if (Number.isFinite(eventX) && Number.isFinite(eventY) && (eventX !== 0 || eventY !== 0)) {
      return { x: eventX + scrollX, y: anchorY };
    }

    if (rect) {
      return {
        x: rect.left + scrollX + rect.width / 2,
        y: anchorY,
      };
    }
    const viewportWidth = window.innerWidth || document.documentElement?.clientWidth || 0;
    return { x: scrollX + viewportWidth / 2, y: anchorY };
  };

  const showCopyFeedbackBubble = (message, tone, point) => {
    const bubble = ensureCopyFeedbackBubble();
    if (!bubble) {
      return;
    }
    if (copyFeedbackHideTimer) {
      clearTimeout(copyFeedbackHideTimer);
      copyFeedbackHideTimer = null;
    }
    bubble.textContent = message || '';
    if (tone) {
      bubble.dataset.tone = tone;
    } else {
      delete bubble.dataset.tone;
    }
    bubble.hidden = false;
    bubble.classList.add('is-visible');
    bubble.style.left = '0px';
    bubble.style.top = '0px';
    bubble.style.setProperty('--club-copy-arrow-offset', '0px');

    const viewportWidth = window.innerWidth || document.documentElement?.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement?.clientHeight || 0;
    const scrollX = window.scrollX || window.pageXOffset || 0;
    const scrollY = window.scrollY || window.pageYOffset || 0;
    const anchorX = Number.isFinite(Number(point?.x)) ? Number(point.x) : scrollX + viewportWidth / 2;
    const anchorY = Number.isFinite(Number(point?.y)) ? Number(point.y) : scrollY + viewportHeight / 2;
    const rect = bubble.getBoundingClientRect();
    const margin = 10;
    const halfWidth = rect.width / 2;
    const minCenterX = scrollX + margin + halfWidth;
    const maxCenterX = Math.max(minCenterX, scrollX + viewportWidth - margin - halfWidth);
    const clampedX = Math.min(maxCenterX, Math.max(minCenterX, anchorX));
    const minAnchorY = scrollY + margin + rect.height + 18;
    const clampedY = Math.max(minAnchorY, anchorY);

    bubble.style.left = `${clampedX}px`;
    bubble.style.top = `${clampedY}px`;

    const maxArrowOffset = Math.max(0, halfWidth - 12);
    const arrowOffset = Math.min(maxArrowOffset, Math.max(-maxArrowOffset, anchorX - clampedX));
    bubble.style.setProperty('--club-copy-arrow-offset', `${arrowOffset.toFixed(2)}px`);

    copyFeedbackHideTimer = window.setTimeout(() => {
      hideCopyFeedbackBubble();
    }, 1300);
  };

  let licenseHoverBubble = null;

  const ensureLicenseHoverBubble = () => {
    if (licenseHoverBubble) {
      return licenseHoverBubble;
    }
    if (typeof document === 'undefined' || !document.body) {
      return null;
    }
    const bubble = document.createElement('div');
    bubble.className = 'club-license-hover-bubble';
    bubble.hidden = true;
    document.body.appendChild(bubble);
    licenseHoverBubble = bubble;
    return bubble;
  };

  const hideLicenseHoverBubble = () => {
    if (!licenseHoverBubble) {
      return;
    }
    licenseHoverBubble.classList.remove('is-visible');
    licenseHoverBubble.hidden = true;
  };

  const positionLicenseHoverBubble = (event) => {
    if (!licenseHoverBubble) {
      return;
    }
    const pointerX = Number(event?.clientX);
    const pointerY = Number(event?.clientY);
    if (!Number.isFinite(pointerX) || !Number.isFinite(pointerY)) {
      return;
    }

    const viewportWidth = window.innerWidth || document.documentElement?.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement?.clientHeight || 0;
    const rect = licenseHoverBubble.getBoundingClientRect();
    const margin = 10;
    const halfWidth = rect.width / 2;
    const minCenterX = margin + halfWidth;
    const maxCenterX = Math.max(minCenterX, viewportWidth - margin - halfWidth);
    const clampedX = Math.min(maxCenterX, Math.max(minCenterX, pointerX));
    const minAnchorY = margin + rect.height + 16;
    const maxAnchorY = Math.max(minAnchorY, viewportHeight - margin);
    const preferredY = pointerY - 14;
    const clampedY = Math.min(maxAnchorY, Math.max(minAnchorY, preferredY));

    licenseHoverBubble.style.left = `${clampedX}px`;
    licenseHoverBubble.style.top = `${clampedY}px`;
  };

  const showLicenseHoverBubble = (text, event) => {
    if (!text) {
      return;
    }
    const bubble = ensureLicenseHoverBubble();
    if (!bubble) {
      return;
    }
    bubble.textContent = text;
    bubble.hidden = false;
    bubble.classList.add('is-visible');
    positionLicenseHoverBubble(event);
  };

  const bindLicenseTooltip = (element, text) => {
    if (!element || !text) {
      return;
    }
    element.addEventListener('pointerenter', (event) => {
      showLicenseHoverBubble(text, event);
    });
    element.addEventListener('pointermove', (event) => {
      positionLicenseHoverBubble(event);
    });
    element.addEventListener('pointerleave', hideLicenseHoverBubble);
    element.addEventListener('pointercancel', hideLicenseHoverBubble);
  };

	  const appendDetail = (list, label, value, options = {}) => {
	    if (value == null || value === '') {
	      return false;
	    }
	    const lines = options.type === 'lines' ? splitLines(value) : null;
	    if (options.type === 'lines' && !lines.length) {
	      return false;
	    }
	    const item = document.createElement('li');
	    item.className = 'club-section__item';
	    if (options.itemClassName) {
	      options.itemClassName
	        .toString()
	        .split(/\s+/)
	        .filter(Boolean)
	        .forEach((className) => item.classList.add(className));
	    }

	    const labelNode = document.createElement('span');
	    labelNode.className = 'club-section__label';
	    if (options.icon) {
	      labelNode.dataset.icon = options.icon;
	    }
	    labelNode.textContent = label;
	    if (options.hideLabel) {
	      labelNode.classList.add('sr-only');
	    }
	    item.appendChild(labelNode);

	    const valueContainer = document.createElement('div');
	    valueContainer.className = 'club-section__value';

	    const applyActionClasses = (node) => {
	      if (!node) {
	        return;
	      }
	      const classNames = [];
	      if (options.button) {
	        classNames.push('btn', 'btn-secondary', 'club-action');
	        if (options.buttonClassName) {
	          classNames.push(options.buttonClassName);
	        }
	      }
	      if (options.className) {
	        classNames.push(options.className);
	      }
	      if (classNames.length) {
	        node.className = classNames.join(' ');
	      }
	    };

	    if (options.type === 'lines') {
	      const linesWrap = document.createElement('div');
	      linesWrap.className = 'club-section__lines';
	      lines.forEach((line) => {
	        const lineNode = document.createElement('div');
	        lineNode.textContent = line;
	        linesWrap.appendChild(lineNode);
	      });
	      valueContainer.appendChild(linesWrap);
	    } else if (options.type === 'link') {
	      const link = document.createElement('a');
	      link.href = value;
	      link.rel = 'noopener';
	      link.target = '_blank';
	      applyActionClasses(link);
	      link.textContent = options.label || value;
	      valueContainer.appendChild(link);
	    } else if (options.type === 'mail') {
	      const link = document.createElement('a');
	      link.href = `mailto:${value}`;
	      applyActionClasses(link);
	      link.textContent = options.label || value;
	      valueContainer.appendChild(link);
	    } else if (options.type === 'phone') {
	      const formatted = formatPhone(value) || value;
	      const cleaned = value.replace(/[^\d+]/g, '');
	      const link = document.createElement('a');
	      link.href = `tel:${cleaned || value}`;
	      applyActionClasses(link);
	      link.textContent = formatted;
	      valueContainer.appendChild(link);
	    } else if (options.type === 'copy') {
	      const button = document.createElement('button');
	      button.type = 'button';
	      button.className = `club-copy${options.className ? ` ${options.className}` : ''}`;
	      button.textContent = value;
	      button.setAttribute('aria-label', options.ariaLabel || `Copier ${label.toLowerCase()}`);
	      button.title = options.title || 'Copier';

	      let resetTimer = null;
	      let lastPointerPoint = null;
	      button.addEventListener('pointerdown', (event) => {
	        const x = Number(event.clientX);
	        const y = Number(event.clientY);
	        if (Number.isFinite(x) && Number.isFinite(y)) {
	          lastPointerPoint = { x, y };
	        }
	      });
	      button.addEventListener('click', async (event) => {
	        const onCopy = options.onCopy;
	        if (typeof onCopy !== 'function') {
	          return;
	        }
	        const feedbackPoint = resolveCopyFeedbackPoint(event, button, lastPointerPoint);
	        lastPointerPoint = null;
	        if (resetTimer) {
	          clearTimeout(resetTimer);
	          resetTimer = null;
	        }
	        button.dataset.copyState = 'copying';
	        try {
	          const ok = await onCopy(value);
	          if (ok) {
	            button.dataset.copyState = 'copied';
	            button.title = 'Copié';
	            showCopyFeedbackBubble('Copié', 'success', feedbackPoint);
	          } else {
	            button.dataset.copyState = 'error';
	            button.title = 'Copie impossible';
	            showCopyFeedbackBubble('Copie impossible', 'error', feedbackPoint);
	          }
	        } catch (error) {
	          button.dataset.copyState = 'error';
	          button.title = 'Copie impossible';
	          showCopyFeedbackBubble('Copie impossible', 'error', feedbackPoint);
	        }
	        resetTimer = window.setTimeout(() => {
	          delete button.dataset.copyState;
	          button.title = options.title || 'Copier';
	        }, 1600);
	      });
	      valueContainer.appendChild(button);
	    } else {
	      valueContainer.textContent = value;
	    }

    item.appendChild(valueContainer);
    list.appendChild(item);
    return true;
  };

  const appendSectionDivider = (list) => {
    if (!list) {
      return false;
    }
    const item = document.createElement('li');
    item.className = 'club-section__item club-section__item--divider';
    item.setAttribute('aria-hidden', 'true');
    list.appendChild(item);
    return true;
  };

  const appendPersonContactDetail = (list, label, personName, personEmail) => {
    const name = (personName || '').toString().trim();
    const email = (personEmail || '').toString().trim();
    if (!name && !email) {
      return false;
    }

    const item = document.createElement('li');
    item.className = 'club-section__item club-section__item--person';

    const labelNode = document.createElement('span');
    labelNode.className = 'club-section__label';
    labelNode.textContent = label;
    item.appendChild(labelNode);

    const valueContainer = document.createElement('div');
    valueContainer.className = 'club-section__value club-section__value--person';

    if (name) {
      if (email) {
        const nameLink = document.createElement('a');
        nameLink.className = 'club-person__name club-person__name-link';
        nameLink.href = `mailto:${email}`;
        nameLink.textContent = name;
        nameLink.title = email;
        nameLink.setAttribute('aria-label', `Envoyer un email à ${name}: ${email}`);
        valueContainer.appendChild(nameLink);
      } else {
        const nameNode = document.createElement('div');
        nameNode.className = 'club-person__name';
        nameNode.textContent = name;
        valueContainer.appendChild(nameNode);
      }
    }

    if (email) {
      const emailLink = document.createElement('a');
      emailLink.className = 'club-person__email-btn';
      emailLink.href = `mailto:${email}`;
      emailLink.title = email;
      emailLink.setAttribute('aria-label', `Envoyer un email à ${name || label}: ${email}`);
      const srText = document.createElement('span');
      srText.className = 'sr-only';
      srText.textContent = 'Envoyer un email';
      emailLink.appendChild(srText);
      valueContainer.appendChild(emailLink);
    }

    item.appendChild(valueContainer);
    list.appendChild(item);
    return true;
  };

  const createLicenseBreakdownItem = (licenses) => {
    const rawA = Number.parseInt(licenses?.A, 10);
    const rawB = Number.parseInt(licenses?.B, 10);
    const licenseA = Number.isFinite(rawA) && rawA > 0 ? rawA : 0;
    const licenseB = Number.isFinite(rawB) && rawB > 0 ? rawB : 0;
    const total = licenseA + licenseB;
    if (!total) {
      return null;
    }

    const item = document.createElement('li');
    item.className = 'club-section__item club-section__item--licenses-breakdown';

    const labelNode = document.createElement('span');
    labelNode.className = 'club-section__label';
    labelNode.textContent = 'Répartition des licenses';
    item.appendChild(labelNode);

    const valueContainer = document.createElement('div');
    valueContainer.className = 'club-section__value';

    if (licenseA > 0 && licenseB > 0) {
      const ratioA = licenseA / total;
      const ratioB = licenseB / total;
      const bar = document.createElement('div');
      bar.className = 'club-license-breakdown__bar';
      bar.setAttribute(
        'aria-label',
        `Répartition des licenses : ${licenseA} en A et ${licenseB} en B`
      );

      const partA = document.createElement('span');
      partA.className = 'club-license-breakdown__part club-license-breakdown__part--a';
      partA.style.width = `${ratioA * 100}%`;
      if (ratioA < 0.22) {
        partA.classList.add('club-license-breakdown__part--tight');
      }
      bindLicenseTooltip(partA, `Licence A : ${licenseA} (${Math.round(ratioA * 100)} %)`);
      const partALabel = document.createElement('span');
      partALabel.className = 'club-license-breakdown__part-value';
      partALabel.textContent = `A ${licenseA}`;
      partA.appendChild(partALabel);

      const partB = document.createElement('span');
      partB.className = 'club-license-breakdown__part club-license-breakdown__part--b';
      partB.style.width = `${ratioB * 100}%`;
      if (ratioB < 0.22) {
        partB.classList.add('club-license-breakdown__part--tight');
      }
      bindLicenseTooltip(partB, `Licence B : ${licenseB} (${Math.round(ratioB * 100)} %)`);
      const partBLabel = document.createElement('span');
      partBLabel.className = 'club-license-breakdown__part-value';
      partBLabel.textContent = `B ${licenseB}`;
      partB.appendChild(partBLabel);

      bar.appendChild(partA);
      bar.appendChild(partB);
      valueContainer.appendChild(bar);
      if (ratioA < 0.22 || ratioB < 0.22) {
        const legend = document.createElement('div');
        legend.className = 'club-license-breakdown__legend';

        const legendA = document.createElement('span');
        legendA.className = 'club-license-breakdown__legend-item club-license-breakdown__legend-item--a';
        legendA.textContent = `A ${licenseA}`;
        legend.appendChild(legendA);

        const legendB = document.createElement('span');
        legendB.className = 'club-license-breakdown__legend-item club-license-breakdown__legend-item--b';
        legendB.textContent = `B ${licenseB}`;
        legend.appendChild(legendB);

        valueContainer.appendChild(legend);
      }
    } else {
      valueContainer.textContent = `${total} licence${total > 1 ? 's' : ''}`;
    }

    item.appendChild(valueContainer);
    return item;
  };

  const createAccessibilityItem = (value) => {
    const raw = (value || '').toString().trim();
    if (!raw) {
      return null;
    }
    const normalized = normalise(raw).replace(/[^a-z0-9]+/g, ' ').trim();
    let tone = 'info';
    let text = `Accessibilité PMR : ${normaliseDashes(raw)}`;
    const hasYes = /\b(oui|yes|accessible|adapte|amenage)\b/.test(normalized);
    const hasNo = /\b(non|inaccessible)\b/.test(normalized);
    if (hasYes && !hasNo) {
      tone = 'yes';
      text = 'Accès PMR indiqué comme adapté';
    } else if (hasNo) {
      tone = 'limited';
      text = 'Accès PMR non indiqué comme adapté';
    }

    const item = document.createElement('li');
    item.className = 'club-section__item club-section__item--accessibility';

    const labelNode = document.createElement('span');
    labelNode.className = 'club-section__label';
    labelNode.textContent = 'Accessibilité';
    item.appendChild(labelNode);

    const valueContainer = document.createElement('div');
    valueContainer.className = 'club-section__value';

    const pill = document.createElement('span');
    pill.className = 'club-accessibility-pill';
    pill.dataset.tone = tone;

    const icon = document.createElement('span');
    icon.className = 'club-accessibility-pill__icon';
    icon.setAttribute('aria-hidden', 'true');
    pill.appendChild(icon);

    const textNode = document.createElement('span');
    textNode.className = 'club-accessibility-pill__text';
    textNode.textContent = text;
    pill.appendChild(textNode);

    valueContainer.appendChild(pill);

    item.appendChild(valueContainer);
    return item;
  };

  const buildPlayerUrl = (playerId) => {
    if (!playerId) {
      return '';
    }
    const params = new URLSearchParams();
    params.set('ffe_player', playerId);
    const from = window.location.pathname + window.location.search + window.location.hash;
    if (from) {
      params.set('from', from);
    }
    return `${window.location.origin}/joueur/?${params.toString()}`;
  };

  const buildOfficialPlayerUrl = (playerId) => {
    if (!playerId) {
      return '';
    }
    return `${FFE_PLAYER_URL_BASE}${encodeURIComponent(playerId)}`;
  };

  const createNameBlock = (row) => {
    const wrap = document.createElement('div');
    wrap.className = 'club-table__name';
    const name = row?.name || '';
    if (row?.playerId) {
      const link = document.createElement('a');
      link.href = buildPlayerUrl(row.playerId);
      link.textContent = name;
      wrap.appendChild(link);
    } else {
      const text = document.createElement('span');
      text.textContent = name;
      wrap.appendChild(text);
    }
    if (row?.email) {
      const emailLink = document.createElement('a');
      emailLink.className = 'club-table__email';
      emailLink.href = `mailto:${row.email}`;
      emailLink.textContent = row.email;
      wrap.appendChild(emailLink);
    }
    return wrap;
  };

  const appendTextCell = (row, value, className) => {
    const cell = document.createElement('td');
    if (className) {
      cell.className = className;
    }
    cell.textContent = value || '';
    row.appendChild(cell);
    return cell;
  };

  const createTableWrap = (table) => {
    const wrap = document.createElement('div');
    wrap.className = 'club-table__wrap';
    wrap.appendChild(table);
    return wrap;
  };

  const FFE_TABLE_PAGE_SIZE = 50;
  const FFE_TABLE_PAGE_STEP = 50;

  const stripFfeHeaderRow = (rows) => {
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) {
      return [];
    }
    const first = list[0] || {};
    const nr = normalise(first.nrFfe || first.nrffe || '').replace(/\s+/g, '');
    const name = normalise(first.name || '');
    // Many FFE exports include a first row that repeats table headers.
    if (nr === 'nrffe' && (name.includes('nom') || name.includes('prenom'))) {
      return list.slice(1);
    }
    return list.slice();
  };

  const parseRatingMeta = (value) => {
    const str = (value == null ? '' : String(value)).trim();
    if (!str) {
      return { score: null, main: '', tag: '' };
    }
    const match = str.match(/(\d{1,4})(?:\s*([a-z]+))?/i);
    if (!match) {
      return { score: null, main: str, tag: '' };
    }
    const score = Number.parseInt(match[1], 10);
    return { score: Number.isFinite(score) ? score : null, main: match[1], tag: (match[2] || '').trim() };
  };

  const renderRatingNode = (value) => {
    const meta = parseRatingMeta(value);
    if (!meta.main && !meta.tag) {
      return document.createTextNode('');
    }
    if (!meta.tag) {
      return document.createTextNode(meta.main);
    }
    const wrap = document.createElement('span');
    wrap.className = 'ffe-rating';

    const main = document.createElement('span');
    main.className = 'ffe-rating__num';
    main.textContent = meta.main;
    wrap.appendChild(main);

    const tag = document.createElement('span');
    tag.className = 'ffe-rating__tag';
    tag.textContent = meta.tag;
    wrap.appendChild(tag);

    return wrap;
  };

  const parseSeasonStart = (value) => {
    const str = (value == null ? '' : String(value)).trim();
    const match = str.match(/(\d{4})/);
    if (!match) {
      return null;
    }
    const year = Number.parseInt(match[1], 10);
    return Number.isFinite(year) ? year : null;
  };

  const compareText = (a, b) => normalise(a).localeCompare(normalise(b));

  const buildQuickFilterHaystack = (row, keys) => {
    const parts = [];
    (Array.isArray(keys) ? keys : []).forEach((key) => {
      if (!key) {
        return;
      }
      const value = row && row[key];
      if (value == null || value === '') {
        return;
      }
      parts.push(String(value));
    });
    return normalise(parts.join(' '));
  };

  const renderMembersTable = (rows) => {
    const allRows = stripFfeHeaderRow(rows);
    const root = document.createElement('div');
    root.className = 'club-table-listing';

    const controls = document.createElement('div');
    controls.className = 'club-table-controls';
    root.appendChild(controls);

    const searchWrap = document.createElement('div');
    searchWrap.className = 'club-table-controls__search';
    controls.appendChild(searchWrap);

    const inputWrap = document.createElement('div');
    inputWrap.className = 'clubs-input-wrap';
    searchWrap.appendChild(inputWrap);

    const filterInput = document.createElement('input');
    filterInput.className = 'clubs-input club-table-controls__input';
    filterInput.type = 'search';
    filterInput.placeholder = 'Filtrer (nom, Nr FFE)…';
    filterInput.setAttribute('aria-label', 'Filtrer la liste');
    inputWrap.appendChild(filterInput);

    const filterClear = document.createElement('button');
    filterClear.type = 'button';
    filterClear.className = 'clubs-input__clear';
    filterClear.setAttribute('aria-label', 'Effacer le filtre');
    filterClear.hidden = true;
    inputWrap.appendChild(filterClear);

    const sortWrap = document.createElement('div');
    sortWrap.className = 'club-table-controls__sort';
    controls.appendChild(sortWrap);

    const sortSelect = document.createElement('select');
    sortSelect.className = 'club-table-controls__select';
    sortSelect.setAttribute('aria-label', 'Trier la liste');
    [
      { value: 'elo_desc', label: 'Elo (fort → faible)' },
      { value: 'name_asc', label: 'Nom (A → Z)' },
      { value: 'name_desc', label: 'Nom (Z → A)' },
      { value: 'rapid_desc', label: 'Rapide (fort → faible)' },
      { value: 'blitz_desc', label: 'Blitz (fort → faible)' },
      { value: 'category_asc', label: 'Catégorie (A → Z)' },
      { value: 'nrffe_asc', label: 'Nr FFE (A → Z)' },
    ].forEach((entry) => {
      const opt = document.createElement('option');
      opt.value = entry.value;
      opt.textContent = entry.label;
      sortSelect.appendChild(opt);
    });
    sortSelect.value = 'elo_desc';
    sortWrap.appendChild(sortSelect);

    const countNode = document.createElement('div');
    countNode.className = 'club-table-controls__count';
    controls.appendChild(countNode);

    const table = document.createElement('table');
    table.className = 'club-table';
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    [
      'Nr FFE',
      'Nom',
      'Aff.',
      'Elo',
      'Rapide',
      'Blitz',
      'Cat.',
      'M.',
      'Club',
    ].forEach((label) => {
      const th = document.createElement('th');
      th.textContent = label;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    table.appendChild(tbody);

    const tableWrap = createTableWrap(table);
    root.appendChild(tableWrap);

    const footer = document.createElement('div');
    footer.className = 'club-table-controls__footer';
    root.appendChild(footer);

    const footerText = document.createElement('div');
    footerText.className = 'club-table-controls__footer-text';
    footer.appendChild(footerText);

    const footerActions = document.createElement('div');
    footerActions.className = 'club-table-controls__footer-actions';
    footer.appendChild(footerActions);

    const moreButton = document.createElement('button');
    moreButton.type = 'button';
    moreButton.className = 'btn btn-secondary club-table-controls__more';
    moreButton.textContent = 'Afficher plus';
    footerActions.appendChild(moreButton);

    const showAllButton = document.createElement('button');
    showAllButton.type = 'button';
    showAllButton.className = 'link-button club-table-controls__showall';
    showAllButton.textContent = 'Tout afficher';
    footerActions.appendChild(showAllButton);

    const state = {
      sort: 'elo_desc',
      visibleCount: Math.min(FFE_TABLE_PAGE_SIZE, allRows.length),
      lastTotal: allRows.length,
    };

    const compareMembers = (a, b, sortMode) => {
      switch (sortMode) {
        case 'name_desc':
          return compareText(b?.name || '', a?.name || '');
        case 'name_asc':
          return compareText(a?.name || '', b?.name || '');
        case 'rapid_desc': {
          const av = parseRatingMeta(a?.rapid).score;
          const bv = parseRatingMeta(b?.rapid).score;
          if (av == null && bv == null) return compareText(a?.name || '', b?.name || '');
          if (av == null) return 1;
          if (bv == null) return -1;
          if (bv !== av) return bv - av;
          return compareText(a?.name || '', b?.name || '');
        }
        case 'blitz_desc': {
          const av = parseRatingMeta(a?.blitz).score;
          const bv = parseRatingMeta(b?.blitz).score;
          if (av == null && bv == null) return compareText(a?.name || '', b?.name || '');
          if (av == null) return 1;
          if (bv == null) return -1;
          if (bv !== av) return bv - av;
          return compareText(a?.name || '', b?.name || '');
        }
        case 'category_asc':
          return compareText(a?.category || '', b?.category || '') || compareText(a?.name || '', b?.name || '');
        case 'nrffe_asc':
          return compareText(a?.nrFfe || '', b?.nrFfe || '') || compareText(a?.name || '', b?.name || '');
        case 'elo_desc':
        default: {
          const av = parseRatingMeta(a?.elo).score;
          const bv = parseRatingMeta(b?.elo).score;
          if (av == null && bv == null) return compareText(a?.name || '', b?.name || '');
          if (av == null) return 1;
          if (bv == null) return -1;
          if (bv !== av) return bv - av;
          return compareText(a?.name || '', b?.name || '');
        }
      }
    };

    const renderRows = (visibleRows) => {
      tbody.innerHTML = '';
      const fragment = document.createDocumentFragment();
      visibleRows.forEach((row) => {
        const tr = document.createElement('tr');
        appendTextCell(tr, row.nrFfe);
        const nameCell = document.createElement('td');
        nameCell.appendChild(createNameBlock(row));
        tr.appendChild(nameCell);
        appendTextCell(tr, row.aff);

        const eloCell = document.createElement('td');
        eloCell.className = 'club-table__rating club-table__rating--elo';
        eloCell.appendChild(renderRatingNode(row.elo));
        tr.appendChild(eloCell);

        const rapidCell = document.createElement('td');
        rapidCell.className = 'club-table__rating';
        rapidCell.appendChild(renderRatingNode(row.rapid));
        tr.appendChild(rapidCell);

        const blitzCell = document.createElement('td');
        blitzCell.className = 'club-table__rating';
        blitzCell.appendChild(renderRatingNode(row.blitz));
        tr.appendChild(blitzCell);

        appendTextCell(tr, row.category);
        appendTextCell(tr, row.gender);
        appendTextCell(tr, row.club);
        fragment.appendChild(tr);
      });
      tbody.appendChild(fragment);
    };

    const applyState = () => {
      const raw = filterInput.value || '';
      const query = normalise(raw).trim();
      state.sort = sortSelect.value || 'elo_desc';

      filterClear.hidden = !raw.trim();

      let filtered = allRows;
      if (query) {
        filtered = allRows.filter((row) => {
          const hay = buildQuickFilterHaystack(row, [
            'nrFfe',
            'name',
            'aff',
            'elo',
            'rapid',
            'blitz',
            'category',
            'club',
          ]);
          return hay.includes(query);
        });
      }

      filtered = filtered.slice().sort((a, b) => compareMembers(a, b, state.sort));
      state.lastTotal = filtered.length;
      if (state.visibleCount > filtered.length) {
        state.visibleCount = filtered.length;
      }
      const visible = filtered.slice(0, state.visibleCount);

      countNode.textContent = `${filtered.length} joueur${filtered.length > 1 ? 's' : ''}`;
      footerText.textContent = filtered.length ? `Affichage ${visible.length} / ${filtered.length}` : 'Aucun résultat';

      moreButton.hidden = visible.length >= filtered.length;
      showAllButton.hidden = filtered.length <= state.visibleCount || filtered.length <= FFE_TABLE_PAGE_SIZE;

      renderRows(visible);
    };

    filterInput.addEventListener('input', () => {
      state.visibleCount = Math.min(FFE_TABLE_PAGE_SIZE, allRows.length);
      applyState();
    });
    filterClear.addEventListener('click', () => {
      filterInput.value = '';
      state.visibleCount = Math.min(FFE_TABLE_PAGE_SIZE, allRows.length);
      applyState();
      filterInput.focus();
    });
    sortSelect.addEventListener('change', () => {
      state.visibleCount = Math.min(state.visibleCount || FFE_TABLE_PAGE_SIZE, state.lastTotal);
      applyState();
    });
    moreButton.addEventListener('click', () => {
      state.visibleCount = Math.min(state.visibleCount + FFE_TABLE_PAGE_STEP, state.lastTotal);
      applyState();
    });
    showAllButton.addEventListener('click', () => {
      state.visibleCount = state.lastTotal;
      applyState();
    });

    applyState();
    return root;
  };

  const renderStaffTable = (rows) => {
    const allRows = stripFfeHeaderRow(rows);
    const root = document.createElement('div');
    root.className = 'club-table-listing';

    const controls = document.createElement('div');
    controls.className = 'club-table-controls';
    root.appendChild(controls);

    const searchWrap = document.createElement('div');
    searchWrap.className = 'club-table-controls__search';
    controls.appendChild(searchWrap);

    const inputWrap = document.createElement('div');
    inputWrap.className = 'clubs-input-wrap';
    searchWrap.appendChild(inputWrap);

    const filterInput = document.createElement('input');
    filterInput.className = 'clubs-input club-table-controls__input';
    filterInput.type = 'search';
    filterInput.placeholder = 'Filtrer (nom, Nr FFE)…';
    filterInput.setAttribute('aria-label', 'Filtrer la liste');
    inputWrap.appendChild(filterInput);

    const filterClear = document.createElement('button');
    filterClear.type = 'button';
    filterClear.className = 'clubs-input__clear';
    filterClear.setAttribute('aria-label', 'Effacer le filtre');
    filterClear.hidden = true;
    inputWrap.appendChild(filterClear);

    const sortWrap = document.createElement('div');
    sortWrap.className = 'club-table-controls__sort';
    controls.appendChild(sortWrap);

    const sortSelect = document.createElement('select');
    sortSelect.className = 'club-table-controls__select';
    sortSelect.setAttribute('aria-label', 'Trier la liste');
    [
      { value: 'name_asc', label: 'Nom (A → Z)' },
      { value: 'name_desc', label: 'Nom (Z → A)' },
      { value: 'role_asc', label: 'Niveau (A → Z)' },
      { value: 'validity_desc', label: 'Validité (récent → ancien)' },
      { value: 'nrffe_asc', label: 'Nr FFE (A → Z)' },
    ].forEach((entry) => {
      const opt = document.createElement('option');
      opt.value = entry.value;
      opt.textContent = entry.label;
      sortSelect.appendChild(opt);
    });
    sortSelect.value = 'name_asc';
    sortWrap.appendChild(sortSelect);

    const countNode = document.createElement('div');
    countNode.className = 'club-table-controls__count';
    controls.appendChild(countNode);

    const table = document.createElement('table');
    table.className = 'club-table';
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    ['Nr FFE', 'Nom', 'Niveau', 'Validité', 'Club'].forEach((label) => {
      const th = document.createElement('th');
      th.textContent = label;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    table.appendChild(tbody);

    const tableWrap = createTableWrap(table);
    root.appendChild(tableWrap);

    const footer = document.createElement('div');
    footer.className = 'club-table-controls__footer';
    root.appendChild(footer);

    const footerText = document.createElement('div');
    footerText.className = 'club-table-controls__footer-text';
    footer.appendChild(footerText);

    const footerActions = document.createElement('div');
    footerActions.className = 'club-table-controls__footer-actions';
    footer.appendChild(footerActions);

    const moreButton = document.createElement('button');
    moreButton.type = 'button';
    moreButton.className = 'btn btn-secondary club-table-controls__more';
    moreButton.textContent = 'Afficher plus';
    footerActions.appendChild(moreButton);

    const showAllButton = document.createElement('button');
    showAllButton.type = 'button';
    showAllButton.className = 'link-button club-table-controls__showall';
    showAllButton.textContent = 'Tout afficher';
    footerActions.appendChild(showAllButton);

    const state = {
      sort: 'name_asc',
      visibleCount: Math.min(FFE_TABLE_PAGE_SIZE, allRows.length),
      lastTotal: allRows.length,
    };

    const compareStaff = (a, b, sortMode) => {
      switch (sortMode) {
        case 'name_desc':
          return compareText(b?.name || '', a?.name || '');
        case 'role_asc':
          return compareText(a?.role || '', b?.role || '') || compareText(a?.name || '', b?.name || '');
        case 'validity_desc': {
          const av = parseSeasonStart(a?.validity);
          const bv = parseSeasonStart(b?.validity);
          if (av == null && bv == null) return compareText(a?.name || '', b?.name || '');
          if (av == null) return 1;
          if (bv == null) return -1;
          if (bv !== av) return bv - av;
          return compareText(a?.name || '', b?.name || '');
        }
        case 'nrffe_asc':
          return compareText(a?.nrFfe || '', b?.nrFfe || '') || compareText(a?.name || '', b?.name || '');
        case 'name_asc':
        default:
          return compareText(a?.name || '', b?.name || '');
      }
    };

    const renderRows = (visibleRows) => {
      tbody.innerHTML = '';
      const fragment = document.createDocumentFragment();
      visibleRows.forEach((row) => {
        const tr = document.createElement('tr');
        appendTextCell(tr, row.nrFfe);
        const nameCell = document.createElement('td');
        nameCell.appendChild(createNameBlock(row));
        tr.appendChild(nameCell);
        appendTextCell(tr, row.role);
        appendTextCell(tr, row.validity);
        appendTextCell(tr, row.club);
        fragment.appendChild(tr);
      });
      tbody.appendChild(fragment);
    };

    const applyState = () => {
      const raw = filterInput.value || '';
      const query = normalise(raw).trim();
      state.sort = sortSelect.value || 'name_asc';

      filterClear.hidden = !raw.trim();

      let filtered = allRows;
      if (query) {
        filtered = allRows.filter((row) => {
          const hay = buildQuickFilterHaystack(row, ['nrFfe', 'name', 'email', 'role', 'validity', 'club']);
          return hay.includes(query);
        });
      }

      filtered = filtered.slice().sort((a, b) => compareStaff(a, b, state.sort));
      state.lastTotal = filtered.length;
      if (state.visibleCount > filtered.length) {
        state.visibleCount = filtered.length;
      }
      const visible = filtered.slice(0, state.visibleCount);

      countNode.textContent = `${filtered.length} personne${filtered.length > 1 ? 's' : ''}`;
      footerText.textContent = filtered.length ? `Affichage ${visible.length} / ${filtered.length}` : 'Aucun résultat';

      moreButton.hidden = visible.length >= filtered.length;
      showAllButton.hidden = filtered.length <= state.visibleCount || filtered.length <= FFE_TABLE_PAGE_SIZE;

      renderRows(visible);
    };

    filterInput.addEventListener('input', () => {
      state.visibleCount = Math.min(FFE_TABLE_PAGE_SIZE, allRows.length);
      applyState();
    });
    filterClear.addEventListener('click', () => {
      filterInput.value = '';
      state.visibleCount = Math.min(FFE_TABLE_PAGE_SIZE, allRows.length);
      applyState();
      filterInput.focus();
    });
    sortSelect.addEventListener('change', () => {
      state.visibleCount = Math.min(state.visibleCount || FFE_TABLE_PAGE_SIZE, state.lastTotal);
      applyState();
    });
    moreButton.addEventListener('click', () => {
      state.visibleCount = Math.min(state.visibleCount + FFE_TABLE_PAGE_STEP, state.lastTotal);
      applyState();
    });
    showAllButton.addEventListener('click', () => {
      state.visibleCount = state.lastTotal;
      applyState();
    });

    applyState();
    return root;
  };

  const buildClubUrl = (club) => {
    const slug = club?.slug || club?.id || clubSlug || '';
    if (!slug) {
      return '';
    }
    return `${window.location.origin}/club/${encodeURIComponent(slug)}/`;
  };

  const buildFfeListsUrl = (club) => {
    const base = buildClubUrl(club);
    return base ? `${base}ffe/` : '';
  };

  const createClubBreadcrumb = (items) => {
    const nav = document.createElement('nav');
    nav.className = 'club-breadcrumb';
    nav.setAttribute('aria-label', "Fil d'Ariane");

    const list = document.createElement('ol');
    list.className = 'club-breadcrumb__list';
    nav.appendChild(list);

    (Array.isArray(items) ? items : []).forEach((item) => {
      if (!item || !item.label) {
        return;
      }
      const row = document.createElement('li');
      row.className = 'club-breadcrumb__item';
      if (item.current) {
        row.classList.add('is-current');
        row.setAttribute('aria-current', 'page');
      }

      if (item.href && !item.current) {
        const link = document.createElement('a');
        link.className = 'club-breadcrumb__link';
        link.href = item.href;
        link.textContent = item.label;
        row.appendChild(link);
      } else {
        const label = document.createElement('span');
        label.className = 'club-breadcrumb__label';
        label.textContent = item.label;
        row.appendChild(label);
      }

      list.appendChild(row);
    });

    return nav;
  };

  const renderFfeListsSection = (club, lists) => {
    const ffeUrl = buildFfeListsUrl(club);
    const getListCount = (list) => stripFfeHeaderRow(Array.isArray(list?.rows) ? list.rows : []).length;
    const getMembersListKey = (payload) => {
      const byEloCount = getListCount(payload?.members_by_elo);
      const membersCount = getListCount(payload?.members);
      const byEloOk = payload?.members_by_elo && !payload.members_by_elo.error && byEloCount > 0;
      const membersOk = payload?.members && !payload.members.error && membersCount > 0;
      if (byEloOk) {
        return 'members_by_elo';
      }
      if (membersOk) {
        return 'members';
      }
      return payload?.members_by_elo ? 'members_by_elo' : 'members';
    };
    const getMembersRows = (payload) => {
      if (!payload || typeof payload !== 'object') {
        return [];
      }
      const key = getMembersListKey(payload);
      return stripFfeHeaderRow(Array.isArray(payload?.[key]?.rows) ? payload[key].rows : []);
    };
    const splitMemberName = (value) => {
      const raw = normaliseDashes(value || '').replace(/\s+/g, ' ').trim();
      if (!raw) {
        return { lastName: '-', firstName: '' };
      }
      const parts = raw.split(' ').filter(Boolean);
      if (parts.length === 1) {
        return { lastName: parts[0], firstName: '' };
      }
      const uppercaseToken = /^[A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þ'`-]*$/u;
      let boundary = 0;
      while (boundary < parts.length && uppercaseToken.test(parts[boundary])) {
        boundary += 1;
      }
      if (boundary <= 0) {
        boundary = 1;
      }
      if (boundary >= parts.length) {
        return {
          lastName: parts.slice(0, parts.length - 1).join(' '),
          firstName: parts[parts.length - 1],
        };
      }
      return {
        lastName: parts.slice(0, boundary).join(' '),
        firstName: parts.slice(boundary).join(' '),
      };
    };
    const sortMembersByElo = (rows) =>
      (Array.isArray(rows) ? rows : [])
        .slice()
        .sort((a, b) => {
          const aScore = parseRatingMeta(a?.elo).score;
          const bScore = parseRatingMeta(b?.elo).score;
          if (aScore == null && bScore == null) {
            return compareText(a?.name || '', b?.name || '');
          }
          if (aScore == null) {
            return 1;
          }
          if (bScore == null) {
            return -1;
          }
          if (bScore !== aScore) {
            return bScore - aScore;
          }
          return compareText(a?.name || '', b?.name || '');
        });

	    if (!isFfeListsView) {
	      if (!ffeUrl || !club?.ffeRef) {
	        return null;
	      }

		      const section = document.createElement('section');
		      section.className = 'club-section club-section--ffe club-ffe-link';

	      const preview = document.createElement('div');
	      preview.className = 'club-ffe-preview';

	      const previewTitle = document.createElement('h3');
	      previewTitle.className = 'club-ffe-preview__title';
	      previewTitle.textContent = 'Top joueurs du club';
	      preview.appendChild(previewTitle);

	      const membersRows = sortMembersByElo(getMembersRows(lists));
	      const topRows = membersRows.slice(0, 3);
	      if (topRows.length) {
	        const table = document.createElement('table');
	        table.className = 'club-ffe-preview__table';
	        table.setAttribute('aria-label', 'Aperçu des meilleurs joueurs du club');

	        const thead = document.createElement('thead');
	        const headRow = document.createElement('tr');
	        ['Nom prénom', 'Elo'].forEach((label) => {
	          const th = document.createElement('th');
	          th.textContent = label;
	          headRow.appendChild(th);
	        });
	        thead.appendChild(headRow);
	        table.appendChild(thead);

	        const tbody = document.createElement('tbody');
	        topRows.forEach((row) => {
	          const tr = document.createElement('tr');
	          const fullName = normaliseDashes((row?.name || '').toString().trim()) || '-';
	          const eloMeta = parseRatingMeta(row?.elo);
	          const eloText = eloMeta.main || (row?.elo ? String(row.elo).trim() : '-');

	          appendTextCell(tr, fullName);
	          const eloCell = appendTextCell(tr, eloText, 'club-ffe-preview__elo');
	          eloCell.setAttribute('aria-label', `Elo ${eloText}`);
	          tbody.appendChild(tr);
	        });

	        const hasMoreRows = membersRows.length > topRows.length;
	        if (hasMoreRows) {
	          const tr = document.createElement('tr');
	          tr.className = 'club-ffe-preview__row club-ffe-preview__row--blurred';
	          appendTextCell(tr, 'Nom prénom');
	          appendTextCell(tr, '0000', 'club-ffe-preview__elo');
	          tbody.appendChild(tr);
	        }

          const moreRow = document.createElement('tr');
          moreRow.className = 'club-ffe-preview__row-more';
          const moreCell = document.createElement('td');
          moreCell.colSpan = 2;
          const moreLink = document.createElement('a');
          moreLink.className = 'club-ffe-preview__more-link';
          moreLink.href = ffeUrl;
          moreLink.textContent = 'Voir les joueurs et encadrants';
          moreCell.appendChild(moreLink);
          moreRow.appendChild(moreCell);
          tbody.appendChild(moreRow);

	        table.appendChild(tbody);
	        preview.appendChild(table);
	      } else {
	        const emptyPreview = document.createElement('p');
	        emptyPreview.className = 'club-tabs__empty club-ffe-preview__empty';
	        emptyPreview.textContent = 'Aperçu des joueurs indisponible pour ce club.';
	        preview.appendChild(emptyPreview);
	      }

	      section.appendChild(preview);
      return section;
    }

    const section = document.createElement('section');
    section.className = 'club-section club-section--ffe club-ffe-lists';
    // Intentionally omit the section heading in the full-screen FFE view to keep the grid compact.

    const createEmptyMessage = (message) => {
      const empty = document.createElement('p');
      empty.className = 'club-tabs__empty';
      empty.textContent = message;
      return empty;
    };

    if (!lists || typeof lists !== 'object') {
      section.appendChild(createEmptyMessage('Données indisponibles pour le moment.'));
      return section;
    }

    const membersKey = getMembersListKey(lists);

    const listDefs = [
      { key: membersKey, label: 'Joueurs', type: 'members' },
      { key: 'arbitrage', label: 'Arbitrage', type: 'staff' },
      { key: 'animation', label: 'Animation', type: 'staff' },
      { key: 'entrainement', label: 'Entraînement', type: 'staff' },
      { key: 'initiation', label: 'Initiation', type: 'staff' },
    ];

    const available = listDefs
      .map((def) => {
        const list = lists[def.key];
        const rows = Array.isArray(list?.rows) ? list.rows : [];
        const count = stripFfeHeaderRow(rows).length;
        return { def, list, rows, count };
      })
      .filter((entry) => entry.list && entry.count > 0);
    if (!available.length) {
      section.appendChild(createEmptyMessage('Aucune donnée disponible pour ce club.'));
      return section;
    }

    const tabs = document.createElement('div');
    tabs.className = 'club-tabs';
    tabs.setAttribute('role', 'tablist');
    section.appendChild(tabs);

    const panelsWrap = document.createElement('div');
    panelsWrap.className = 'club-tabs__panels';
    section.appendChild(panelsWrap);

    const tabButtons = [];
    const tabPanels = [];
    const tabPayloads = [];
    const tabPrefix = slugify(`ffe-${club.slug || club.id || club.name || 'club'}`);
    let activeTabIndex = 0;

    available.forEach((entry, index) => {
      const { def, list, rows, count } = entry;
      const label = `${def.label} (${count})`;

      const tabId = `${tabPrefix}-tab-${def.key}`;
      const panelId = `${tabPrefix}-panel-${def.key}`;

      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'club-tabs__tab';
      tab.setAttribute('role', 'tab');
      tab.setAttribute('id', tabId);
      tab.setAttribute('aria-controls', panelId);
      tab.setAttribute('aria-selected', index === 0 ? 'true' : 'false');
      tab.setAttribute('tabindex', index === 0 ? '0' : '-1');
      tab.textContent = label;
      tabs.appendChild(tab);

      const panel = document.createElement('div');
      panel.className = 'club-tabs__panel';
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('id', panelId);
      panel.setAttribute('aria-labelledby', tabId);
      panel.hidden = index !== 0;

      panelsWrap.appendChild(panel);
      tabButtons.push(tab);
      tabPanels.push(panel);
      tabPayloads.push({ def, list, rows });
    });

    const ensurePanelRendered = (index) => {
      const panel = tabPanels[index];
      const payload = tabPayloads[index];
      if (!panel || !payload || panel.dataset.rendered === 'true') {
        return;
      }
      const { def, list, rows } = payload;
      panel.dataset.rendered = 'true';
      if (list.error) {
        panel.appendChild(createEmptyMessage('Données indisponibles pour le moment.'));
      } else if (!stripFfeHeaderRow(rows).length) {
        panel.appendChild(createEmptyMessage('Aucune donnée disponible pour ce club.'));
      } else if (def.type === 'members') {
        panel.appendChild(renderMembersTable(rows));
      } else {
        panel.appendChild(renderStaffTable(rows));
      }
    };

    const activateTab = (index) => {
      activeTabIndex = index;
      tabButtons.forEach((button, idx) => {
        const isActive = idx === index;
        button.setAttribute('aria-selected', isActive ? 'true' : 'false');
        button.setAttribute('tabindex', isActive ? '0' : '-1');
        tabPanels[idx].hidden = !isActive;
      });
      ensurePanelRendered(index);
    };

    tabButtons.forEach((button, index) => {
      button.addEventListener('click', () => {
        activateTab(index);
      });
      button.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') {
          return;
        }
        event.preventDefault();
        const direction = event.key === 'ArrowRight' ? 1 : -1;
        const nextIndex = (index + direction + tabButtons.length) % tabButtons.length;
        activateTab(nextIndex);
        tabButtons[nextIndex].focus();
      });
    });

    ensurePanelRendered(activeTabIndex);

    return section;
  };

  const renderClub = (club, ffeLists) => {
    detailContainer.innerHTML = '';

    const sheet = document.createElement('div');
    sheet.className = 'club-sheet';

    const header = document.createElement('header');
    header.className = 'club-sheet__header';

    const titleRow = document.createElement('div');
    titleRow.className = 'club-sheet__title-row';

    const title = document.createElement('h1');
    title.className = 'club-sheet__title';
    title.textContent = club.name;
    titleRow.appendChild(title);

    const clubBaseUrl = buildClubUrl(club);
    const ffeListsUrl = buildFfeListsUrl(club);
    const shareUrl = isFfeListsView && ffeListsUrl ? ffeListsUrl : clubBaseUrl;
    const shareBlock = document.createElement('div');
    shareBlock.className = 'club-sheet__share';

    const copyToClipboard = async (value) => {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(value);
        return true;
      }
      try {
        const textarea = document.createElement('textarea');
        textarea.value = value;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'absolute';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        const success = document.execCommand('copy');
        document.body.removeChild(textarea);
        return success;
      } catch (err) {
        return false;
      }
    };

    const shareButton = document.createElement('button');
    shareButton.type = 'button';
    shareButton.className = 'club-share-button';
    shareButton.setAttribute('aria-label', 'Partager ce club');
    shareButton.title = 'Partager';
    shareButton.textContent = 'Partager';
    shareButton.addEventListener('click', async () => {
      try {
        if (navigator.share && typeof navigator.share === 'function') {
          await navigator.share({
            title: club.name,
            text: `Découvrez ${club.name} sur le site du Comité des Échecs des Hauts-de-Seine`,
            url: shareUrl,
          });
          return;
        }
        const ok = await copyToClipboard(shareUrl);
        if (!ok) {
          console.warn('Partage indisponible');
        }
      } catch (error) {
        if (error && error.name === 'AbortError') {
          return;
        }
        const ok = await copyToClipboard(shareUrl);
        if (!ok) {
          console.warn('Partage indisponible');
        }
      }
    });

	    shareBlock.appendChild(shareButton);

      if (isFfeListsView) {
        header.appendChild(
          createClubBreadcrumb([
            { label: 'Recherche clubs', href: getStoredBackPath('/clubs') },
            { label: 'Fiche du club', href: clubBaseUrl },
            { label: 'Liste des joueurs du club', current: true },
          ])
        );
      }
	    header.appendChild(titleRow);

      if (!isFfeListsView) {
        const meta = document.createElement('div');
        meta.className = 'club-sheet__meta';
        const licensesCount = Number.parseInt(club.totalLicenses, 10);
        const safeLicensesCount = Number.isFinite(licensesCount) ? licensesCount : 0;
        meta.appendChild(
          createChip(
            `${safeLicensesCount} licencié${safeLicensesCount > 1 ? 's' : ''}`,
            'licenses'
          )
        );
        const cityLabel = (club.commune || '').trim() || 'Ville non renseignée';
        meta.appendChild(createChip(cityLabel, 'city'));
        if (club.labelFederal) {
          meta.appendChild(createChip(club.labelFederal, 'label'));
        }
        if (meta.childElementCount) {
          header.appendChild(meta);
        }
      }

	    const summaryText = club.publics || club.notes;
	    if (summaryText) {
	      const summary = document.createElement('p');
	      summary.className = 'club-sheet__summary';
      summary.textContent = summaryText;
      header.appendChild(summary);
    }

    if (actionsContainer) {
      const existingShare = actionsContainer.querySelector('.club-sheet__share');
      if (existingShare) {
        existingShare.remove();
      }
      actionsContainer.appendChild(shareBlock);
    } else {
      sheet.appendChild(shareBlock);
    }
    sheet.appendChild(header);

    if (isFfeListsView) {
      document.body?.classList.add('club-ffe-view');
      if (backLink) {
        backLink.setAttribute('hidden', '');
      }
      if (backLinkMap) {
        backLinkMap.setAttribute('hidden', '');
      }
      if (actionsContainer && clubBaseUrl) {
        const existingFfeBack = actionsContainer.querySelector('.club-detail__back--ffe');
        if (existingFfeBack) {
          existingFfeBack.remove();
        }
        const backToClub = document.createElement('a');
        backToClub.className = 'link-button club-detail__back club-detail__back--ffe';
        backToClub.href = clubBaseUrl;
        backToClub.textContent = '← Retour à la fiche du club';
        actionsContainer.prepend(backToClub);
      }

      const ffeSection = renderFfeListsSection(club, ffeLists);
      if (ffeSection) {
        sheet.appendChild(ffeSection);
      }
	      detailContainer.appendChild(sheet);

	      if (club.name) {
	        document.title = `${normaliseDashes(club.name)} - Joueurs & encadrants`;
	      }
	      return;
	    }
    document.body?.classList.remove('club-ffe-view');

		    const sections = [];

		    const essentials = createSection('Infos essentielles');
      essentials.section.classList.add('club-section--contacts');
		    const siteUrl = (() => {
        const raw = (club.site || '').toString().trim();
        if (!raw) return '';
        if (/^https?:\/\//i.test(raw)) return raw;
        if (/^www\./i.test(raw)) return `https://${raw}`;
        if (/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?:\/\S*)?$/i.test(raw)) return `https://${raw}`;
        return raw;
      })();
		    appendDetail(essentials.list, 'Site internet', siteUrl, {
		      type: 'link',
		      label: 'Site web',
        button: true,
        buttonClassName: 'club-action--primary',
        itemClassName: 'club-section__item--action',
        hideLabel: true,
		    });
		    appendDetail(essentials.list, 'Email', club.email, {
        type: 'mail',
        label: 'Email',
        button: true,
        buttonClassName: 'club-action--primary',
        itemClassName: 'club-section__item--action',
        hideLabel: true,
      });
		    appendDetail(essentials.list, 'Téléphone', club.phone, {
        type: 'phone',
        button: true,
        buttonClassName: 'club-action--primary',
        itemClassName: 'club-section__item--action',
        hideLabel: true,
      });
		    appendDetail(essentials.list, 'Adresse', club.addressDisplay || club.address || club.salle || '', {
	        type: 'copy',
	        icon: 'location',
	        onCopy: copyToClipboard,
	        ariaLabel: "Copier l'adresse",
	        title: "Copier l'adresse",
	      });
	    if (essentials.list.childElementCount) {
	      sections.push(essentials.section);
	    }

	    const highlights = createSection('Infos club');
    const hasHours = appendDetail(highlights.list, 'Horaires', club.hours, { type: 'lines' });
    const presidentName = (club.president || '').toString().trim();
    const presidentEmail = (club.presidentEmail || '').toString().trim();
    const referentName = (club.contact || '').toString().trim();
    const referentEmail = (club.contactEmail || '').toString().trim();
    const normalizePersonIdentity = (name, email) => ({
      name: normalise(name || '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim(),
      email: normalise(email || '')
        .replace(/\s+/g, '')
        .trim(),
    });
    const presidentIdentity = normalizePersonIdentity(presidentName, presidentEmail);
    const referentIdentity = normalizePersonIdentity(referentName, referentEmail);
    const isSamePerson =
      (presidentIdentity.name && referentIdentity.name && presidentIdentity.name === referentIdentity.name) ||
      (presidentIdentity.email &&
        referentIdentity.email &&
        presidentIdentity.email === referentIdentity.email);
    const hasPresidentData = Boolean(presidentName || presidentEmail);
    const hasReferentData = Boolean(referentName || referentEmail);
    if (hasHours && (hasPresidentData || hasReferentData)) {
      appendSectionDivider(highlights.list);
    }
    appendPersonContactDetail(
      highlights.list,
      'Président·e',
      presidentName || (isSamePerson ? referentName : ''),
      presidentEmail || (isSamePerson ? referentEmail : '')
    );
    if (!isSamePerson) {
      appendPersonContactDetail(highlights.list, 'Référent·e club', referentName, referentEmail);
    }
    if (highlights.list.childElementCount) {
      sections.push(highlights.section);
    }

    const coords = createSection('Coordonnées');
    const normalizeAddress = (value) =>
      normalise(value || '')
        .replace(/[^a-z0-9]+/g, '')
        .trim();
    const addressKey = normalizeAddress(club.address);
    const siegeKey = normalizeAddress(club.siege);
    const isSameLocation =
      addressKey &&
      siegeKey &&
      (addressKey === siegeKey ||
        addressKey.includes(siegeKey) ||
        siegeKey.includes(addressKey));
    const showSiegeSocial = club.siege && siegeKey && !isSameLocation;
		    appendDetail(coords.list, 'Fax', club.fax);
		    if (coords.list.childElementCount) {
		      sections.push(coords.section);
		    }

	    const activities = createSection('Activités');
	    appendDetail(activities.list, 'Publics accueillis', club.publics);
	    appendDetail(activities.list, 'Tarifs', club.tarifs);
	    appendDetail(activities.list, 'Informations complémentaires', club.notes && club.publics ? club.notes : '');
    if (activities.list.childElementCount) {
      sections.push(activities.section);
    }

	    const ffeSection = renderFfeListsSection(club, ffeLists);
	    if (ffeSection) {
	      sections.push(ffeSection);
	    }

    const competitions = createSection('Compétitions');
    appendDetail(competitions.list, 'Interclubs', club.interclubs);
    appendDetail(competitions.list, 'Interclubs Jeunes', club.interclubsJeunes);
    appendDetail(competitions.list, 'Interclubs Féminins', club.interclubsFeminins);
	    if (competitions.list.childElementCount) {
	      sections.push(competitions.section);
	    }

			    const ffeInfo = createSection('FFE');
			    const licensesItem = createLicenseBreakdownItem(club.licenses);
			    if (licensesItem) {
			      ffeInfo.list.appendChild(licensesItem);
			    }
        if (showSiegeSocial) {
          appendDetail(ffeInfo.list, 'Siège social', club.siege, {
            type: 'copy',
            onCopy: copyToClipboard,
            ariaLabel: "Copier l'adresse du siège social",
            title: "Copier l'adresse du siège social",
          });
        }
        const accessibilityItem = createAccessibilityItem(club.accesPmr);
        if (accessibilityItem) {
          ffeInfo.list.appendChild(accessibilityItem);
        }
		    const ficheFfeUrl =
		      club.fiche_ffe ||
		      (club.ffeRef ? `${FFE_URL_BASE}${encodeURIComponent(club.ffeRef)}` : '');
				    appendDetail(ffeInfo.list, 'Site fédéral', ficheFfeUrl, {
				      type: 'link',
			      label: 'Ouvrir sur echecs.asso.fr',
            className: 'club-ffe-official-link',
			    });

	    sections.forEach((section) => sheet.appendChild(section));

    detailContainer.appendChild(sheet);

    const mapSection = document.createElement('section');
    mapSection.className = 'club-map-section';
    mapSection.setAttribute('aria-label', `Carte de localisation pour ${club.name}`);

	    const mapContainerWrapper = document.createElement('div');
	    mapContainerWrapper.className = 'club-map__container';

    const mapContainer = document.createElement('div');
    mapContainer.className = 'club-map';
    mapContainer.id = 'club-map';
    mapContainerWrapper.appendChild(mapContainer);

    const mapStatus = document.createElement('p');
    mapStatus.id = 'club-map-status';
    mapStatus.className = 'club-map__status';
    mapStatus.setAttribute('role', 'status');
    mapStatus.setAttribute('aria-live', 'polite');
    mapStatus.textContent = 'Chargement de la carte…';
    mapContainerWrapper.appendChild(mapStatus);

    mapSection.appendChild(mapContainerWrapper);

    const directionsButton = document.createElement('a');
    directionsButton.className = 'btn btn-secondary club-map__directions';
    directionsButton.target = '_blank';
    directionsButton.rel = 'noopener';
    directionsButton.textContent = "Calculer l'itinéraire vers ce club";
    directionsButton.setAttribute(
      'aria-label',
      "Calculer l'itinéraire vers ce club (nouvel onglet)"
    );
    directionsButton.hidden = true;
    mapSection.appendChild(directionsButton);

	    detailContainer.appendChild(mapSection);

	    renderClubMap(club, mapContainer, mapStatus, directionsButton);

		    if (ffeInfo.list.childElementCount) {
		      detailContainer.appendChild(ffeInfo.section);
		    }

		    if (club.name) {
		      document.title = `${normaliseDashes(club.name)} - Clubs en France`;
		    }
		  };

  const hydrateClub = (raw) => {
    const club = { ...adaptClubRecord(raw) };
    const licenseA = Number.parseInt(club.licenses?.A, 10);
    const licenseB = Number.parseInt(club.licenses?.B, 10);
    const totalLicenses =
      (Number.isFinite(licenseA) ? licenseA : 0) + (Number.isFinite(licenseB) ? licenseB : 0);
    club.totalLicenses = totalLicenses > 0 ? totalLicenses : null;
    return club;
  };

  const init = () => {
    if (!clubSlug) {
      renderMessage(detailContainer.dataset.emptyMessage || 'Club introuvable.');
      return;
    }
    detailContainer.setAttribute('aria-busy', 'true');
    let placeholderTimer = null;
    let placeholderVisibleSince = 0;
    let placeholderShown = false;
    const PLACEHOLDER_SHOW_DELAY_MS = 220;
    const PLACEHOLDER_MIN_VISIBLE_MS = 320;
    const schedulePlaceholder = () => {
      if (typeof window === 'undefined' || typeof window.setTimeout !== 'function') {
        return;
      }
      if (!detailContainer.querySelector('.club-detail-placeholder')) {
        return;
      }
      placeholderTimer = window.setTimeout(() => {
        placeholderShown = true;
        placeholderVisibleSince = Date.now();
        detailContainer.classList.add('is-loading');
      }, PLACEHOLDER_SHOW_DELAY_MS);
    };
    const settlePlaceholder = async () => {
      if (placeholderTimer) {
        clearTimeout(placeholderTimer);
        placeholderTimer = null;
      }
      if (!placeholderShown) {
        detailContainer.classList.remove('is-loading');
        return;
      }
      const elapsed = Date.now() - placeholderVisibleSince;
      const remaining = Math.max(0, PLACEHOLDER_MIN_VISIBLE_MS - elapsed);
      if (remaining > 0) {
        await new Promise((resolve) => setTimeout(resolve, remaining));
      }
      detailContainer.classList.remove('is-loading');
    };

    schedulePlaceholder();
    Promise.all([loadFranceClubsDataset(), loadStaticGeoHints(), loadFfeRefs()])
      .then(async ([data, staticHints, ffeRefs]) => {
        const ffeLookup = buildFfeLookup(ffeRefs);
        const clubs = (Array.isArray(data) ? data : []).map(hydrateClub);
        ensureUniqueSlugs(clubs);
        applyStaticHints(clubs, staticHints);
        applyFfeRefs(clubs, ffeLookup);
        const lookup = buildClubLookup(clubs);
        const club = findClubBySlug(clubSlug, lookup) || null;
        if (!club) {
          await settlePlaceholder();
          renderMessage(detailContainer.dataset.emptyMessage || 'Club introuvable.');
          return;
        }
        await geocodeClubIfNeeded(club);
        const ffeLists = club.ffeRef ? await loadFfeLists(club.ffeRef) : null;
        await settlePlaceholder();
        renderClub(club, ffeLists);
      })
      .catch(async () => {
        await settlePlaceholder();
        renderMessage('Impossible de charger la fiche du club pour le moment.');
      })
      .finally(() => {
        detailContainer.removeAttribute('aria-busy');
      });
  };

  loadGeocodeCache();
  init();
})();
