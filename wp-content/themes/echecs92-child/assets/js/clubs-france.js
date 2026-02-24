/**
 * Clubs directory interactions for echecs92.fr.
 * Provides fuzzy text search with automatic distance fallback.
 */
(function () {
  const DATA_MANIFEST_URL = '/wp-content/themes/echecs92-child/assets/data/clubs-france.json';
  const DATA_FALLBACK_BASE_PATH = '/wp-content/themes/echecs92-child/assets/data/clubs-france/';
  const FFE_DETAILS_BASE_PATH = '/wp-content/themes/echecs92-child/assets/data/clubs-france/';
  const GEO_HINTS_REMOTE_URL = '/wp-content/themes/echecs92-child/assets/data/clubs-france-hints.json';
  const POSTAL_COORDINATES_DATA_URL = '/wp-content/themes/echecs92-child/assets/data/postal-coordinates-fr.json';
  const DASH_RX = /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE63\uFF0D]/g;
  const normaliseDashes = (value) => (value == null ? '' : value.toString()).replace(DASH_RX, '-');
  const normalisePathname = (value) => (value || '').replace(/\/+$/u, '') || '/';
  const clubsPageShell = typeof document !== 'undefined' ? document.querySelector('.clubs-page') : null;
  const clubsScopeBanner = clubsPageShell ? clubsPageShell.querySelector('.clubs-scope-banner') : null;
  const syncScopeBannerHeight = () => {
    if (!clubsScopeBanner || typeof document === 'undefined') {
      return;
    }
    const rect = clubsScopeBanner.getBoundingClientRect();
    const height = Number.isFinite(rect.height) ? Math.max(0, Math.round(rect.height)) : 0;
    document.documentElement.style.setProperty('--clubs-scope-banner-height', `${height}px`);
  };
  if (clubsScopeBanner) {
    syncScopeBannerHeight();
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(syncScopeBannerHeight);
    }
    if (typeof ResizeObserver === 'function') {
      const scopeBannerObserver = new ResizeObserver(() => {
        syncScopeBannerHeight();
      });
      scopeBannerObserver.observe(clubsScopeBanner);
    } else if (typeof window !== 'undefined') {
      window.addEventListener('resize', syncScopeBannerHeight);
    }
  }
  let scopeBannerSuppressed = false;
  const setScopeBannerSuppressed = (suppressed) => {
    if (!clubsScopeBanner) {
      return;
    }
    const next = Boolean(suppressed);
    if (scopeBannerSuppressed === next) {
      return;
    }
    scopeBannerSuppressed = next;
    if (next) {
      clubsScopeBanner.setAttribute('hidden', '');
    } else {
      clubsScopeBanner.removeAttribute('hidden');
    }
    syncScopeBannerHeight();
  };
  const clubsDepartments = (clubsPageShell?.dataset?.clubsDepartments || '')
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
  const isClubs92Scope = clubsDepartments.length === 1 && clubsDepartments[0] === '92';
  const clubsDataUrl = (clubsPageShell?.dataset?.clubsDataUrl || '').trim();
  const ffeDetailsDepartment = clubsDepartments.length === 1 ? clubsDepartments[0] : '';
  const ffeDetailsUrl =
    clubsDataUrl && ffeDetailsDepartment ? `${FFE_DETAILS_BASE_PATH}${ffeDetailsDepartment}.json` : '';
  const useLegacySlugs = Boolean(clubsDataUrl);
  const hasDepartmentFilter = clubsDepartments.length > 0;
  const clubsScopeKey = hasDepartmentFilter ? clubsDepartments.join('-').toLowerCase() : 'fr';
  const storageKeyBase = hasDepartmentFilter ? `echecs92:clubs-${clubsScopeKey}` : 'echecs92:clubs-fr';
  const CLUBS_NAV_STORAGE_KEY = hasDepartmentFilter ? 'echecs92:clubs:last-listing' : 'echecs92:clubs-fr:last-listing';
  const CLUBS_UI_STATE_KEY = `${storageKeyBase}:ui`;
  const CLUBS_LIST_STATE_KEY = `${storageKeyBase}:list-state`;
  const CLUBS_UI_RESTORE_KEY = `${storageKeyBase}:ui-restore`;
  const CLUBS_LIST_STATE_MAX_AGE = 2 * 60 * 60 * 1000;
  const REOPEN_RESULTS_FLAG_KEY = `${storageKeyBase}:reopen-results`;
  const VISIBLE_RESULTS_DEFAULT = 12;
  const VISIBLE_RESULTS_STEP = VISIBLE_RESULTS_DEFAULT;
  // Kept at 0 to avoid "random" / delayed scroll behaviour after searches.
  // The global spinner already has its own show/min-visible delays.
  const MIN_RESULTS_SCROLL_DELAY_MS = 0;
  const SORT_SCROLL_DELAY_MS = Math.max(180, Math.round(MIN_RESULTS_SCROLL_DELAY_MS / 4));
  const COUNTER_LOADING_TEXT = 'Recherche en cours…';
  const SORT_COUNTER_LOADING_TEXT = 'Tri en cours…';
  const MOBILE_RESULTS_BREAKPOINT = 820;
  const clubsScopeLabel = (clubsPageShell?.dataset?.clubsScopeLabel || '').trim();
  const scopeLabel = clubsScopeLabel || 'en France';
  const listPath = normalisePathname(clubsPageShell?.dataset?.clubsListPath || '/clubs');
  const clubsDepartmentSet = hasDepartmentFilter ? new Set(clubsDepartments) : null;
  const FRANCE_LIST_PATH = '/clubs';
  const scopeName = (() => {
    const raw = (clubsScopeLabel || '').trim();
    if (!raw) {
      return '';
    }
    return raw.replace(/^(dans|en)\s+/i, '').trim();
  })();
  const scopeShortLabel = clubsDepartments.length === 1 ? clubsDepartments[0] : scopeName;
  const IG_CINEMA_ENTRY = (() => {
    if (typeof window === 'undefined') {
      return { enabled: false, query: '', alias: '', cleanPath: '/clubs-92' };
    }
    const runtime =
      window.CDJE92_IG_CINEMA_ENTRY && typeof window.CDJE92_IG_CINEMA_ENTRY === 'object'
        ? window.CDJE92_IG_CINEMA_ENTRY
        : {};
    const enabled = runtime.enabled === true;
    const query = typeof runtime.query === 'string' ? runtime.query.trim() : '';
    const alias = typeof runtime.alias === 'string' ? runtime.alias.trim() : '';
    const cleanPath = typeof runtime.cleanPath === 'string' && runtime.cleanPath.trim() ? runtime.cleanPath.trim() : '/clubs-92';
    return { enabled, query, alias, cleanPath };
  })();
  const CINEMA_AUTOTYPE_QUERY = (IG_CINEMA_ENTRY.query || '').trim() || 'mathisboche';
  const CINEMA_ALLOWED_ALIAS = (IG_CINEMA_ENTRY.alias || '').trim().toLowerCase() || 'mtbh';
  const shouldRunCinemaEntry = isClubs92Scope && IG_CINEMA_ENTRY.enabled;
  const buildScopeGrammar = (label) => {
    const raw = (label || '').trim();
    const fallback = {
      label: 'la France',
      de: 'de la France',
      hors: 'hors de la France',
      dehors: 'en dehors de la France',
    };
    if (!raw) {
      return fallback;
    }
    const cleaned = raw.replace(/^(dans|en)\s+/i, '').trim();
    const base = cleaned || raw;
    const apostropheMatch = base.match(/^l[’']\s*(.+)$/i);
    if (apostropheMatch) {
      const noun = apostropheMatch[1].trim();
      const de = `de l'${noun}`;
      return {
        label: base,
        de,
        hors: `hors ${de}`,
        dehors: `en dehors ${de}`,
      };
    }
    const articleMatch = base.match(/^(les|le|la)\s+(.+)$/i);
    if (articleMatch) {
      const article = articleMatch[1].toLowerCase();
      const noun = articleMatch[2].trim();
      let de = `de ${base}`;
      if (article === 'les') {
        de = `des ${noun}`;
      } else if (article === 'le') {
        de = `du ${noun}`;
      } else if (article === 'la') {
        de = `de la ${noun}`;
      }
      return {
        label: base,
        de,
        hors: `hors ${de}`,
        dehors: `en dehors ${de}`,
      };
    }
    const de = `de ${base}`;
    return {
      label: base,
      de,
      hors: `hors ${de}`,
      dehors: `en dehors ${de}`,
    };
  };
  const shouldIncludeDepartment = (entry) => {
    if (!clubsDepartmentSet) {
      return true;
    }
    const code = entry?.code ? entry.code.toString().toUpperCase() : '';
    return clubsDepartmentSet.has(code);
  };

  const getDepartmentFromPostal = (postalCode) => {
    const digits = (postalCode || '').toString().replace(/\D/g, '').trim();
    if (digits.length < 2) {
      return '';
    }
    if (digits.startsWith('97') || digits.startsWith('98')) {
      return digits.slice(0, 3);
    }
    return digits.slice(0, 2);
  };

  const isPostalOutsideScope = (postalCode) => {
    if (!hasDepartmentFilter || !clubsDepartmentSet) {
      return false;
    }
    const dept = getDepartmentFromPostal(postalCode);
    if (!dept) {
      return false;
    }
    return !clubsDepartmentSet.has(dept);
  };

  const buildFranceSearchUrl = (label) => {
    const params = new URLSearchParams();
    if (label) {
      params.set('loc', label);
    }
    params.set('liste', '1');
    const query = params.toString();
    return query ? `${FRANCE_LIST_PATH}?${query}` : FRANCE_LIST_PATH;
  };

  let scopeModalState = null;
  const ensureScopeModal = () => {
    if (scopeModalState) {
      return scopeModalState;
    }
    if (typeof document === 'undefined' || !document.body) {
      return null;
    }
    const modal = document.createElement('div');
    modal.id = 'clubs-scope-modal';
    modal.className = 'clubs-scope-modal';
    modal.setAttribute('hidden', '');

    const backdrop = document.createElement('div');
    backdrop.className = 'clubs-scope-modal__backdrop';
    backdrop.dataset.scopeAction = 'close';
    modal.appendChild(backdrop);

    const panel = document.createElement('div');
    panel.className = 'clubs-scope-modal__panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'clubs-scope-modal-title');
    modal.appendChild(panel);

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'clubs-scope-modal__close';
    closeButton.setAttribute('aria-label', 'Fermer');
    closeButton.textContent = 'x';
    closeButton.dataset.scopeAction = 'close';
    panel.appendChild(closeButton);

    const title = document.createElement('h2');
    title.id = 'clubs-scope-modal-title';
    title.className = 'clubs-scope-modal__title';
    panel.appendChild(title);

    const text = document.createElement('p');
    text.className = 'clubs-scope-modal__text';
    panel.appendChild(text);

    const actions = document.createElement('div');
    actions.className = 'clubs-scope-modal__actions';
    panel.appendChild(actions);

    const stayButton = document.createElement('button');
    stayButton.type = 'button';
    stayButton.className = 'btn btn-secondary clubs-scope-modal__stay';
    stayButton.dataset.scopeAction = 'stay';
    actions.appendChild(stayButton);

    const goButton = document.createElement('button');
    goButton.type = 'button';
    goButton.className = 'btn clubs-scope-modal__go';
    goButton.dataset.scopeAction = 'go';
    actions.appendChild(goButton);

    document.body.appendChild(modal);

    scopeModalState = {
      modal,
      title,
      text,
      stayButton,
      goButton,
      lastFocus: null,
      resolve: null,
    };

    const handleAction = (action) => {
      if (!scopeModalState || !scopeModalState.resolve) {
        return;
      }
      const resolve = scopeModalState.resolve;
      scopeModalState.resolve = null;
      scopeModalState.modal.setAttribute('hidden', '');
      if (scopeModalState.lastFocus && typeof scopeModalState.lastFocus.focus === 'function') {
        scopeModalState.lastFocus.focus();
      }
      resolve(action === 'go');
    };

    modal.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const action = target.dataset.scopeAction;
      if (!action) {
        return;
      }
      event.preventDefault();
      handleAction(action);
    });

    document.addEventListener('keydown', (event) => {
      if (!scopeModalState || scopeModalState.modal.hasAttribute('hidden')) {
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        handleAction('close');
      }
    });

    return scopeModalState;
  };

  const openScopeModal = (payload = {}) => {
    const modalState = ensureScopeModal();
    if (!modalState) {
      return Promise.resolve(false);
    }
    const label = (payload.label || '').trim();
    const scopeLabelText = scopeName || clubsScopeLabel || scopeLabel || 'la France';
    const grammar = buildScopeGrammar(scopeLabelText);
    const titleLabel = grammar?.hors ? `Recherche ${grammar.hors}` : 'Recherche hors périmètre';
    const detail = label ? `La localisation "${label}"` : 'Cette localisation';
    modalState.title.textContent = titleLabel;
    modalState.text.textContent = `${detail} semble être ${grammar.dehors}. Souhaitez-vous lancer la recherche sur toute la France ?`;
    const stayLabel = scopeShortLabel
      ? (/^\d+$/.test(scopeShortLabel) ? `Rester sur le ${scopeShortLabel}` : `Rester sur ${scopeShortLabel}`)
      : 'Rester ici';
    modalState.stayButton.textContent = stayLabel;
    modalState.goButton.textContent = 'Rechercher partout en France';
    modalState.lastFocus = typeof document !== 'undefined' ? document.activeElement : null;
    modalState.modal.removeAttribute('hidden');
    modalState.goButton.focus();
    return new Promise((resolve) => {
      modalState.resolve = resolve;
    });
  };

  const maybeRedirectToFrance = async (payload = {}) => {
    if (!isPostalOutsideScope(payload.postalCode)) {
      return false;
    }
    const accepted = await openScopeModal({ label: payload.label });
    if (!accepted) {
      return false;
    }
    const redirectLabel = payload.label || payload.postalCode || '';
    const targetUrl = buildFranceSearchUrl(redirectLabel);
    if (typeof window !== 'undefined') {
      window.location.assign(targetUrl);
      return true;
    }
    return false;
  };

  let manifestPromise = null;
  let datasetPromise = null;

  const scheduleAfterMinimumDelay = (startedAt, callback, minDelay = MIN_RESULTS_SCROLL_DELAY_MS) => {
    if (typeof callback !== 'function') {
      return;
    }
    const reference = Number.isFinite(startedAt) ? startedAt : Date.now();
    const minimum = Number.isFinite(minDelay) ? Math.max(0, minDelay) : MIN_RESULTS_SCROLL_DELAY_MS;
    const elapsed = Date.now() - reference;
    const remaining = Math.max(0, minimum - elapsed);
    const timerHost =
      typeof window !== 'undefined' && typeof window.setTimeout === 'function'
        ? window
        : typeof globalThis !== 'undefined' && typeof globalThis.setTimeout === 'function'
        ? globalThis
        : null;
    if (remaining > 0) {
      const setTimer =
        timerHost && typeof timerHost.setTimeout === 'function'
          ? timerHost.setTimeout.bind(timerHost)
          : setTimeout;
      setTimer(callback, remaining);
    } else {
      callback();
    }
  };

  const fetchJson = (url) =>
    fetch(url, { headers: { Accept: 'application/json' } }).then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.json();
    });

  const normaliseDepartments = (payload) => {
    if (!payload || typeof payload !== 'object') {
      return { basePath: DATA_FALLBACK_BASE_PATH, departments: [] };
    }
    const basePath = payload.basePath || DATA_FALLBACK_BASE_PATH;
    const departments = Array.isArray(payload.departments) ? payload.departments : [];
    return { basePath, departments };
  };

  const loadFranceDataManifest = () => {
    if (!manifestPromise) {
      manifestPromise = fetchJson(DATA_MANIFEST_URL)
        .then(normaliseDepartments)
        .catch(() => ({ basePath: DATA_FALLBACK_BASE_PATH, departments: [] }));
    }
    return manifestPromise;
  };

  const buildDepartmentFileUrl = (entry, basePath) => {
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

  const annotateDepartmentClub = (club, entry) => ({
    ...club,
    departement: club.departement || entry.code || '',
    departement_nom: club.departement_nom || entry.name || '',
    departement_slug: club.departement_slug || entry.slug || '',
  });

  const fetchDepartmentClubs = async (entry, manifestMeta) => {
    const url = buildDepartmentFileUrl(entry, manifestMeta.basePath);
    if (!url) {
      return [];
    }
    try {
      const payload = await fetchJson(url);
      const records = Array.isArray(payload) ? payload : [];
      return records.map((club) => annotateDepartmentClub(club, entry));
    } catch (error) {
      console.warn(`[clubs-fr-debug] Impossible de charger le département ${entry.code || '?'} (${url}).`, error);
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
        console.warn('[clubs-fr-debug] Données clubs.json indisponibles, repli vers le manifest.', error);
        return null;
      });
  };

  const loadManifestDataset = () =>
    loadFranceDataManifest().then(async (manifestMeta) => {
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
      club._coordPrecision = hint.precision || 'geocoded';
      if (!club.postalCode && hint.postalCode) {
        club.postalCode = hint.postalCode;
      }
      if (Object.prototype.hasOwnProperty.call(club, '_distanceCoords')) {
        delete club._distanceCoords;
      }
    });
  };

  const LOCAL_POSTAL_COORDINATES = {
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
    '75116': { label: 'Paris 16e', lat: 48.8602, lng: 2.27 },
    '75017': { label: 'Paris 17e', lat: 48.8876, lng: 2.3079 },
    '75018': { label: 'Paris 18e', lat: 48.8913, lng: 2.344 },
    '75019': { label: 'Paris 19e', lat: 48.8896, lng: 2.3772 },
    '75020': { label: 'Paris 20e', lat: 48.8674, lng: 2.3984 },
  };

  const DEPT_FALLBACK_COORDS = {
    '75': { label: 'Paris', lat: 48.8566, lng: 2.3522 },
    '77': { label: 'Seine-et-Marne', lat: 48.5396, lng: 2.6526 }, // Melun
    '78': { label: 'Yvelines', lat: 48.8049, lng: 2.1204 }, // Versailles
    '91': { label: 'Essonne', lat: 48.6298, lng: 2.4417 }, // Évry-Courcouronnes
    '92': { label: 'Hauts-de-Seine', lat: 48.8927825, lng: 2.2073652 }, // Nanterre
    '93': { label: 'Seine-Saint-Denis', lat: 48.9047, lng: 2.4395 }, // Bobigny
    '94': { label: 'Val-de-Marne', lat: 48.7904, lng: 2.455 }, // Créteil
    '95': { label: "Val-d'Oise", lat: 49.036, lng: 2.063 }, // Cergy
  };

  const ensureLocationSuggestionsHost = () => {
    if (!locationSuggestionsHost || !document.body) {
      return null;
    }
    if (locationSuggestionsHost.parentElement !== document.body) {
      document.body.appendChild(locationSuggestionsHost);
    }
    return locationSuggestionsHost;
  };

  const dedupeLocationSuggestions = (entries) => {
    const bestByKey = new Map();
    const hasCoords = (item) => {
      if (!item) {
        return false;
      }
      const lat = Number.parseFloat(item.latitude ?? item.lat);
      const lng = Number.parseFloat(item.longitude ?? item.lng);
      return Number.isFinite(lat) && Number.isFinite(lng);
    };

    (entries || []).forEach((entry) => {
      if (!entry) {
        return;
      }
      const rawPostal = entry.postalCode || entry.postcode || entry.code;
      const postal = canonicalizeParisPostalCode(rawPostal) || normalisePostalCodeValue(rawPostal);
      const city = formatCommuneWithPostal(entry.commune || entry.city || entry.label || entry.display || '', postal);
      const key = `${postal || ''}|${normaliseCommuneForCompare(city || entry.display || '')}`;
      if (!key.trim()) {
        return;
      }
	      const candidate = {
	        ...entry,
	        postalCode: postal || entry.postalCode || entry.code || '',
	        commune: city || entry.commune || '',
	        display: normaliseDashes(entry.display || entry.label || [postal, city].filter(Boolean).join(' - ') || postal || city),
	        search: entry.search || normaliseForSearch(`${city || ''} ${postal || ''}`.trim()),
	        searchAlt:
	          entry.searchAlt ||
          (city || postal ? normaliseForSearch(`${postal || ''} ${city || ''}`.trim()) : ''),
      };
      if (!Number.isFinite(candidate.latitude) && Number.isFinite(candidate.lat)) {
        candidate.latitude = Number(candidate.lat);
      }
      if (!Number.isFinite(candidate.longitude) && Number.isFinite(candidate.lng)) {
        candidate.longitude = Number(candidate.lng);
      }
      const existing = bestByKey.get(key);
      if (!existing) {
        bestByKey.set(key, candidate);
        return;
      }
      if (!existing.hasClub && candidate.hasClub) {
        bestByKey.set(key, candidate);
        return;
      }
      if (!hasCoords(existing) && hasCoords(candidate)) {
        bestByKey.set(key, candidate);
      }
    });

    return Array.from(bestByKey.values());
  };

  const classifyDisplayWeight = (value) => {
    const trimmed = (value || '').toString().trim();
    if (!trimmed) {
      return 3;
    }
    const first = trimmed[0];
    if (/\p{L}/u.test(first)) {
      return 0;
    }
    if (/\d/.test(first)) {
      return 1;
    }
    return 2;
  };

  const compareDisplayStrings = (a, b) => {
    const weightA = classifyDisplayWeight(a);
    const weightB = classifyDisplayWeight(b);
    if (weightA !== weightB) {
      return weightA - weightB;
    }
    return (a || '').localeCompare(b || '', 'fr', { sensitivity: 'base' });
  };

  const compareClubsByName = (clubA, clubB) => compareDisplayStrings(clubA?.name || '', clubB?.name || '');

  const formatLocationLabel = (commune, postalCode, fallback = '') => {
    const city = formatCommuneWithPostal(commune || '', postalCode);
    const postal = normalisePostalCodeValue(postalCode);
    if (city && postal) {
      return `${city} (${postal})`;
    }
    if (city) {
      return city;
    }
  if (postal) {
      return postal;
    }
    return fallback || '';
  };

  const buildTypedLocationSuggestions = (query) => {
    const trimmed = (query || '').trim();
    if (!trimmed) {
      return [];
    }
    const suggestions = [];
    const normalisedQuery = normaliseForSearch(trimmed);
    const numericQuery = trimmed.replace(/\D/g, '');
    const monacoNameMatch = Boolean(
      normalisedQuery &&
        normalisedQuery.length >= 3 &&
        ('monaco'.startsWith(normalisedQuery) || normalisedQuery.includes('monaco'))
    );
    const monacoPostalMatch = Boolean(
      numericQuery &&
        numericQuery.length >= 3 &&
        MONACO_POSTAL_CODE.startsWith(numericQuery)
    );
    if (monacoNameMatch || monacoPostalMatch) {
      suggestions.push({
        display: formatLocationLabel(MONACO_LOCATION_LABEL, MONACO_POSTAL_CODE, MONACO_LOCATION_LABEL),
        postalCode: MONACO_POSTAL_CODE,
        commune: MONACO_LOCATION_LABEL,
        search: normaliseForSearch(`${MONACO_LOCATION_LABEL} ${MONACO_POSTAL_CODE}`),
        searchAlt: normaliseForSearch(`${MONACO_POSTAL_CODE} ${MONACO_LOCATION_LABEL}`),
        kind: 'typed',
        source: 'manual-monaco',
        latitude: MONACO_LOCATION_COORDS.lat,
        longitude: MONACO_LOCATION_COORDS.lng,
      });
    }
    const numericOnly = /^\d+$/.test(trimmed);
    const rawPostal = numericOnly ? trimmed : parsePostalCodeFromString(trimmed);
    const postal = normalisePostalCodeValue(rawPostal);
    if (!postal) {
      return suggestions;
    }
    if (numericOnly && postal.length < 3) {
      // On attend au moins 3 chiffres pour limiter le bruit.
      return suggestions;
    }
    const canonicalPostal = canonicalizeParisPostalCode(postal) || postal;
    const coords =
      canonicalPostal.length === 5
        ? getPostalCoordinateEntries(canonicalPostal)
        : getPostalCoordinateEntriesByPrefix(canonicalPostal);
    const list =
      Array.isArray(coords) && coords.length
        ? coords
        : canonicalPostal.length === 5
        ? getPostalCoordinateEntries(postal)
        : getPostalCoordinateEntriesByPrefix(postal);
    if (!list.length) {
      return suggestions;
    }
    const seen = new Set();
    list.forEach((coord) => {
      const derivedPostal = coord?.postalCode || canonicalPostal;
      const formattedCommune = formatCommuneWithPostal(coord?.label || '', derivedPostal);
      const display = formatLocationLabel(formattedCommune, derivedPostal, '');
      if (!display) {
        return;
      }
      const dedupeKey = `${derivedPostal}|${normaliseCommuneForCompare(formattedCommune || '')}`;
      if (seen.has(dedupeKey)) {
        return;
      }
      seen.add(dedupeKey);
      const suggestion = {
        display,
        postalCode: derivedPostal,
        commune: formattedCommune && formattedCommune.toLowerCase() !== derivedPostal ? formattedCommune : '',
        search: normaliseForSearch(`${formattedCommune || ''} ${derivedPostal || ''}`.trim()),
        searchAlt: normaliseForSearch(`${derivedPostal || ''} ${formattedCommune || ''}`.trim()),
        kind: 'typed',
      };
      if (coord && Number.isFinite(coord.lat) && Number.isFinite(coord.lng)) {
        suggestion.latitude = coord.lat;
        suggestion.longitude = coord.lng;
      }
      suggestions.push(suggestion);
    });
    return dedupeLocationSuggestions(suggestions);
  };

  const stripPostalFromQuery = (raw, postal) => {
    if (!raw) {
      return '';
    }
    let cleaned = raw.toString();
    cleaned = cleaned.replace(/\(\s*\d{4,5}\s*\)/g, ' ');
    if (postal) {
      const code = postal.toString();
      if (code.length >= 4) {
        const pattern = new RegExp(`\\b${code.slice(0, 2)}\\s*${code.slice(2)}\\b`, 'gi');
        cleaned = cleaned.replace(pattern, ' ');
      }
    }
    cleaned = cleaned.replace(/[()]/g, ' ');
    return cleaned.replace(/\s+/g, ' ').trim();
  };

  const extractLocationQueryParts = (rawQuery) => {
    const trimmed = (rawQuery || '').toString().trim();
    if (!trimmed) {
      return {
        raw: '',
        postal: '',
        commune: '',
        communeKey: '',
        displayKey: '',
        numeric: '',
      };
    }
    const numeric = trimmed.replace(/\D/g, '');
    const parsedPostal = parsePostalCodeFromString(trimmed) || normalisePostalCodeValue(numeric);
    const postal = canonicalizeParisPostalCode(parsedPostal) || parsedPostal || '';
    const commune = stripPostalFromQuery(trimmed, postal || parsedPostal);
    const communeKey = commune ? normaliseCommuneForCompare(commune) : '';
    return {
      raw: trimmed,
      postal,
      commune,
      communeKey,
      displayKey: normaliseForSearch(trimmed),
      numeric,
    };
  };

  const buildLocationSuggestionIndex = (clubs) => {
    const seen = new Set();
    const index = [];
    (clubs || []).forEach((club) => {
      const basePostal = normalisePostalCodeValue(club.postalCode || '');
      const postal = canonicalizeParisPostalCode(basePostal) || basePostal;
      const coords = resolveClubDistanceCoordinates(club);
      const commune = formatCommuneWithPostal(
        club.commune || coords?.label || '',
        postal || club.postalCode
      );
      const hasCommune = Boolean(commune);
      if (!postal && !hasCommune) {
        return;
      }
      const key = `${postal}|${normaliseCommuneForCompare(commune)}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      const display = formatLocationLabel(commune, postal);
      const hasReadableLabel = Boolean(hasCommune && /\p{L}/u.test(commune));
      if (!hasReadableLabel && (!display || display === postal)) {
        return;
      }
      const search = normaliseForSearch(`${commune} ${postal}`.trim());
      const searchAlt = normaliseForSearch(`${postal} ${commune}`.trim());
      const entry = { display, postalCode: postal, commune, search, searchAlt, source: 'club', hasClub: true };
      if (coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lng)) {
        entry.latitude = Number(coords.lat);
        entry.longitude = Number(coords.lng);
      }
      index.push(entry);
    });
    setLocationSuggestionIndex(index, { preserveRemote: true });
  };

  const getSuggestionSearchFields = (entry) => {
    const fields = new Set();
    const add = (value) => {
      const v = normaliseForSearch(value || '');
      if (v) {
        fields.add(v);
      }
    };
    if (entry.search) {
      add(entry.search);
    }
    if (entry.searchAlt) {
      add(entry.searchAlt);
    } else {
      add(`${entry.commune || ''} ${entry.postalCode || ''}`);
      add(`${entry.postalCode || ''} ${entry.commune || ''}`);
    }
    if (entry.commune) {
      add(entry.commune);
    }
    if (entry.postalCode) {
      add(entry.postalCode);
    }
    return Array.from(fields);
  };

  const scoreLocationSuggestion = (entry, normalisedQuery, numericQuery) => {
    let score = 0;
    const rawEntryPostal = normalisePostalCodeValue(entry?.postalCode || entry?.code || '');
    const canonicalEntryPostal = canonicalizeParisPostalCode(rawEntryPostal) || rawEntryPostal;
    const postalCandidates = Array.from(new Set([rawEntryPostal, canonicalEntryPostal].filter(Boolean)));
    const numericNoLeadingZero = numericQuery ? numericQuery.replace(/^0+/, '') : '';
    const searchFields = getSuggestionSearchFields(entry);
    const compactQuery = stripSearchDelimiters(normalisedQuery);
    const compactFields = compactQuery ? searchFields.map(stripSearchDelimiters) : [];
    if (numericQuery && postalCandidates.length) {
      for (let i = 0; i < postalCandidates.length; i += 1) {
        const candidate = postalCandidates[i];
        if (!candidate) {
          continue;
        }
        const strippedCandidate = candidate.replace(/^0+/, '');
        const hasDirectMatch = candidate.startsWith(numericQuery);
        const hasStrippedMatch =
          strippedCandidate && numericNoLeadingZero && strippedCandidate.startsWith(numericNoLeadingZero);
        if (hasDirectMatch || hasStrippedMatch) {
          const baseLength = hasDirectMatch ? candidate.length : strippedCandidate.length;
          const matchLength = hasDirectMatch ? numericQuery.length : numericNoLeadingZero.length;
          score += 80 - Math.min(30, (baseLength - matchLength) * 6);
          break;
        }
      }
    }
    if (normalisedQuery) {
      const startsWithMatch =
        searchFields.some((value) => value.startsWith(normalisedQuery)) ||
        (compactQuery && compactFields.some((value) => value.startsWith(compactQuery)));
      const containsMatch =
        searchFields.some((value) => !value.startsWith(normalisedQuery) && value.includes(normalisedQuery)) ||
        (compactQuery && compactFields.some((value) => !value.startsWith(compactQuery) && value.includes(compactQuery)));
      if (startsWithMatch) {
        score += 60;
      } else if (containsMatch) {
        score += 35;
      } else {
        return 0;
      }
    }
    if (!normalisedQuery && !numericQuery) {
      score = 10;
    }
    if (score > 0 && entry.hasClub) {
      score += 25;
    }
    return score - Math.min(6, entry.display.length / 50);
  };

  const getLocationSuggestionsForQuery = (rawQuery) => {
    const normalised = normaliseForSearch(rawQuery);
    const communeQuery = normaliseCommuneForCompare(rawQuery);
    const numericQuery = (rawQuery || '').replace(/\D/g, '');
    const looksLikeParisQuery = communeQuery === 'paris' || communeQuery.startsWith('paris ');
    const parisPostalFromQuery = extractParisPostal(rawQuery);
    const looksLikeParisPostal = numericQuery.startsWith('75');
    const wantsParisSuggestions = looksLikeParisQuery || looksLikeParisPostal || Boolean(parisPostalFromQuery);
    const hasQuery = Boolean(normalised || numericQuery);
    const typedSuggestions = buildTypedLocationSuggestions(rawQuery);
    const typedPostalCodes = new Set(
      (typedSuggestions || [])
        .map((item) => normalisePostalCodeValue(item?.postalCode || item?.code || ''))
        .filter(Boolean)
    );
    const trimmed = (rawQuery || '').trim();
    const numericOnlyInput = /^\d+$/.test(trimmed);
    const normalisedPostalInput = normalisePostalCodeValue(rawQuery);
    const canonicalPostalInput = canonicalizeParisPostalCode(normalisedPostalInput) || normalisedPostalInput;
    const fullPostalInput = numericOnlyInput && canonicalPostalInput && canonicalPostalInput.length === 5;
    const needsExtendedLimit =
      numericOnlyInput &&
      typedSuggestions &&
      typedSuggestions.length > 0 &&
      typedPostalCodes.size === 1 &&
      (normalisedPostalInput
        ? typedPostalCodes.has(normalisedPostalInput) || typedPostalCodes.has(`0${normalisedPostalInput}`)
        : true);
    if (wantsParisSuggestions) {
      const parisSource = dedupeLocationSuggestions([...(locationSuggestionsIndex || []), ...(typedSuggestions || [])]);
      return buildParisArrondissementSuggestions(parisSource, {
        query: rawQuery,
        numericQuery,
        postalHint: parisPostalFromQuery,
      });
    }
    if (fullPostalInput) {
      const postalCandidates = new Set([canonicalPostalInput, normalisedPostalInput].filter(Boolean));
      const postalMatches = [];
      locationSuggestionsIndex.forEach((entry) => {
        const entryPostal = normalisePostalCodeValue(entry?.postalCode || entry?.code || '');
        const canonicalEntry = canonicalizeParisPostalCode(entryPostal) || entryPostal;
        if (canonicalEntry && postalCandidates.has(canonicalEntry)) {
          postalMatches.push(entry);
        }
      });
      (typedSuggestions || []).forEach((entry) => {
        const entryPostal = normalisePostalCodeValue(entry?.postalCode || entry?.code || '');
        const canonicalEntry = canonicalizeParisPostalCode(entryPostal) || entryPostal;
        if (canonicalEntry && postalCandidates.has(canonicalEntry)) {
          postalMatches.push(entry);
        }
      });
      const deduped = dedupeLocationSuggestions(postalMatches);
      if (deduped.length) {
        return deduped;
      }
    }
    const queryTokens = normalised ? normalised.split(' ').filter(Boolean) : [];
    const hasLongQuery = queryTokens.length >= 2 && normalised.length >= 8;
    const longQueryLimit = hasLongQuery ? Math.max(LOCATION_SUGGESTIONS_LIMIT + 8, 20) : LOCATION_SUGGESTIONS_LIMIT;
    let effectiveLimit = needsExtendedLimit
      ? Math.max(longQueryLimit, typedSuggestions.length)
      : longQueryLimit;
    const scored = [];
    if (!hasQuery) {
      return dedupeLocationSuggestions(locationSuggestionsIndex.slice(0, effectiveLimit)).slice(0, effectiveLimit);
    }
    locationSuggestionsIndex.forEach((entry) => {
      const score = scoreLocationSuggestion(entry, normalised, numericQuery);
      if (score <= 0) {
        return;
      }
      scored.push({ entry, score });
    });
    (typedSuggestions || []).forEach((typedSuggestion) => {
      if (!typedSuggestion) {
        return;
      }
      const typedScore = scoreLocationSuggestion(typedSuggestion, normalised, numericQuery);
      const effectiveScore = typedScore > 0 ? typedScore : hasQuery ? 1 : 0;
      if (effectiveScore > 0) {
        scored.push({ entry: typedSuggestion, score: effectiveScore });
      }
    });
    scored.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return compareDisplayStrings(a.entry.display, b.entry.display);
    });
    const ranked = scored.slice(0, effectiveLimit).map((item) => item.entry);
    return dedupeLocationSuggestions(ranked).slice(0, effectiveLimit);
  };

  const resolveSuggestionCoordinates = (suggestion) => {
    if (!suggestion) {
      return null;
    }
    const postalCode = canonicalizeParisPostalCode(suggestion.postalCode || suggestion.postcode || suggestion.code || '');
    const lat = Number.parseFloat(suggestion.latitude ?? suggestion.lat);
    const lng = Number.parseFloat(suggestion.longitude ?? suggestion.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return {
        latitude: lat,
        longitude: lng,
        label: suggestion.display || suggestion.commune || '',
        commune: suggestion.commune || '',
        postalCode: postalCode || suggestion.postalCode || '',
      };
    }
    if (postalCode) {
      const coords =
        getPostalCoordinates(postalCode, suggestion.commune) || getDeptFallbackCoordinates(postalCode);
      if (coords) {
        return {
          latitude: coords.lat,
          longitude: coords.lng,
          label: coords.label || suggestion.commune || '',
          commune: suggestion.commune || '',
          postalCode: coords.postalCode || postalCode,
        };
      }
    }
    if (suggestion.commune) {
      const coords = getCommuneCoordinatesByName(suggestion.commune);
      if (coords) {
        return {
          latitude: coords.lat,
          longitude: coords.lng,
          label: coords.label || suggestion.commune,
          commune: suggestion.commune,
          postalCode: coords.postalCode || suggestion.postalCode || '',
        };
      }
    }
    return null;
  };

  const pickBestSuggestion = (rawQuery) => {
    const matches = getLocationSuggestionsForQuery(rawQuery);
    if (!matches.length) {
      return null;
    }
    const queryParts = extractLocationQueryParts(rawQuery);
    const queryPostal = queryParts.postal;
    const communeKey = queryParts.communeKey;
    const displayKey = queryParts.displayKey;
    let fallback = null;
    let fallbackCoords = null;
    for (let i = 0; i < matches.length; i += 1) {
      const entry = matches[i];
      const coords = resolveSuggestionCoordinates(entry);
      const entryPostal = canonicalizeParisPostalCode(entry?.postalCode || entry?.code || '') ||
        normalisePostalCodeValue(entry?.postalCode || entry?.code || '');
      const entryCommuneKey = entry?.commune ? normaliseCommuneForCompare(entry.commune) : '';
      const entryDisplayKey = entry?.display ? normaliseForSearch(entry.display) : '';
      if (queryPostal && communeKey && entryPostal === queryPostal && entryCommuneKey === communeKey) {
        return { suggestion: entry, coords };
      }
      if (displayKey && entryDisplayKey && entryDisplayKey === displayKey) {
        return { suggestion: entry, coords };
      }
      if (communeKey && entryCommuneKey && entryCommuneKey === communeKey) {
        return { suggestion: entry, coords };
      }
      if (queryPostal && entryPostal === queryPostal) {
        return { suggestion: entry, coords };
      }
      if (!fallback || (!fallbackCoords && coords)) {
        fallback = entry;
        fallbackCoords = coords;
      }
    }
    return { suggestion: fallback, coords: fallbackCoords || resolveSuggestionCoordinates(fallback) };
  };

  const buildRemoteSuggestionCacheKey = (rawQuery) => {
    const normalised = normaliseForSearch(rawQuery);
    const numeric = (rawQuery || '').replace(/\D/g, '');
    if (!normalised && !numeric) {
      return '';
    }
    return `${normalised}|${numeric}`;
  };

  const adaptRemoteLocationRecords = (records) => {
    const items = Array.isArray(records) ? records : [];
    const suggestions = [];
    items.forEach((item) => {
      if (!item) {
        return;
      }
      const rawCodes = Array.isArray(item.codesPostaux) ? item.codesPostaux : [];
      const codes = rawCodes.length ? rawCodes : item.codePostal ? [item.codePostal] : [];
      if (!codes.length) {
        return;
      }
      const city = formatCommune(item.nom || item.name || '');
      const coords = Array.isArray(item?.centre?.coordinates) ? item.centre.coordinates : [];
      const lon = Number.parseFloat(coords[0]);
      const lat = Number.parseFloat(coords[1]);
      const hasCoords = Number.isFinite(lat) && Number.isFinite(lon);
      codes.forEach((code) => {
        const postal = canonicalizeParisPostalCode(code) || normalisePostalCodeValue(code);
        if (!postal && !city) {
          return;
        }
        const commune = formatCommuneWithPostal(city, postal);
        const display = formatLocationLabel(commune || city, postal, city || postal || '');
        const suggestion = {
          display,
          postalCode: postal || '',
          commune,
          search: normaliseForSearch(`${commune || ''} ${postal || ''}`.trim()),
          searchAlt: normaliseForSearch(`${postal || ''} ${commune || ''}`.trim()),
          source: 'remote',
        };
        if (hasCoords) {
          suggestion.latitude = lat;
          suggestion.longitude = lon;
        }
        suggestions.push(suggestion);
      });
    });
    return dedupeLocationSuggestions(suggestions);
  };

  const extractBanLabel = (label, postalCode) => {
    const raw = (label || '').toString().trim();
    if (!raw) {
      return '';
    }
    if (!postalCode) {
      return raw;
    }
    const code = postalCode.toString();
    if (code.length < 4) {
      return raw;
    }
    const pattern = new RegExp(`\\b${code.slice(0, 2)}\\s*${code.slice(2)}\\b`, 'i');
    const match = raw.match(pattern);
    if (!match) {
      return raw;
    }
    const idx = Number.isFinite(match.index) ? match.index : raw.indexOf(match[0]);
    if (idx > 0) {
      return raw.slice(0, idx).trim();
    }
    return raw;
  };

  const adaptBanLocationRecords = (payload) => {
    const features = Array.isArray(payload?.features) ? payload.features : [];
    const suggestions = [];
    features.forEach((feature) => {
      const props = feature?.properties || {};
      const type = (props.type || '').toString();
      if (!LOCATION_REMOTE_ALT_TYPES.has(type)) {
        return;
      }
      const rawLabel = (props.name || props.label || '').toString().trim();
      const city = (props.city || '').toString().trim();
      const postalRaw = (props.postcode || props.postalcode || '').toString().trim();
      const postal = canonicalizeParisPostalCode(postalRaw) || normalisePostalCodeValue(postalRaw);
      const label = extractBanLabel(rawLabel || city, postal);
      const primaryLabel = label || rawLabel || city;
      if (!primaryLabel && !postal) {
        return;
      }
      const communeBase = formatCommune(primaryLabel);
      const display = formatLocationLabel(communeBase || primaryLabel, postal, primaryLabel || postal || '');
      const coords = Array.isArray(feature?.geometry?.coordinates) ? feature.geometry.coordinates : [];
      const lon = Number.parseFloat(coords[0]);
      const lat = Number.parseFloat(coords[1]);
      const searchSource = [primaryLabel, city, postal].filter(Boolean).join(' ');
      const searchAltSource = [postal, primaryLabel, city].filter(Boolean).join(' ');
      const suggestion = {
        display,
        postalCode: postal || '',
        commune: communeBase || primaryLabel || '',
        search: normaliseForSearch(searchSource.trim()),
        searchAlt: normaliseForSearch(searchAltSource.trim()),
        source: 'remote',
      };
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        suggestion.latitude = lat;
        suggestion.longitude = lon;
      }
      suggestions.push(suggestion);
    });
    return dedupeLocationSuggestions(suggestions);
  };

  const getRemoteLocationQueryParts = (rawQuery) => {
    const trimmed = (rawQuery || '').toString().trim();
    if (!trimmed) {
      return { query: '', postal: '', numeric: '' };
    }
    const numeric = trimmed.replace(/\D/g, '');
    const parsedPostal = parsePostalCodeFromString(trimmed) || normalisePostalCodeValue(numeric);
    const postal = canonicalizeParisPostalCode(parsedPostal) || parsedPostal || '';
    return { query: trimmed, postal, numeric };
  };

  const shouldFetchRemoteLocationSuggestions = (rawQuery) => {
    const trimmed = (rawQuery || '').trim();
    if (!trimmed) {
      return false;
    }
    const normalised = normaliseForSearch(trimmed);
    const numeric = trimmed.replace(/\D/g, '');
    if (numeric.length >= 3) {
      return true;
    }
    return Boolean(normalised && normalised.length >= LOCATION_REMOTE_MIN_CHARS);
  };

  const fetchGeoLocationSuggestions = (rawQuery) => {
    const { query, numeric, postal } = getRemoteLocationQueryParts(rawQuery);
    const hasLetters = /[a-z]/i.test(query);
    const isFullPostal = postal && postal.length === 5 && /^\d+$/.test(postal);
    const limit = isFullPostal ? LOCATION_REMOTE_POSTAL_LIMIT : LOCATION_REMOTE_LIMIT;
    const params = new URLSearchParams({
      limit: `${limit}`,
      boost: 'population',
      fields: LOCATION_REMOTE_FIELDS,
    });
    if (query && hasLetters) {
      params.set('nom', query);
    }
    if (numeric.length >= 3) {
      params.set('codePostal', numeric.slice(0, 5));
    }
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), LOCATION_REMOTE_TIMEOUT_MS) : null;
    const url = `${LOCATION_REMOTE_ENDPOINT}?${params.toString()}`;
    return fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller?.signal,
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.json();
      })
      .then((payload) => adaptRemoteLocationRecords(payload))
      .catch((error) => {
        if (controller && controller.signal && controller.signal.aborted) {
          return [];
        }
        console.warn(`[clubs-fr-debug] Impossible de charger les suggestions de localisation pour "${query}".`, error);
        return [];
      })
      .finally(() => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      });
  };

  const fetchBanLocationSuggestions = (rawQuery) => {
    const { query, numeric, postal } = getRemoteLocationQueryParts(rawQuery);
    const isFullPostal = postal && postal.length === 5 && /^\d+$/.test(postal);
    const limit = isFullPostal ? LOCATION_REMOTE_ALT_LIMIT_POSTAL : LOCATION_REMOTE_ALT_LIMIT;
    const baseQuery = query || postal || numeric || '';
    if (!baseQuery) {
      return Promise.resolve([]);
    }
    const types = ['municipality'];
    const requests = types.map((type) => {
      const params = new URLSearchParams({
        q: baseQuery,
        limit: `${limit}`,
        type,
      });
      if (isFullPostal) {
        params.set('postcode', postal);
      }
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timeoutId = controller ? setTimeout(() => controller.abort(), LOCATION_REMOTE_ALT_TIMEOUT_MS) : null;
      const url = `${LOCATION_REMOTE_ALT_ENDPOINT}?${params.toString()}`;
      return fetch(url, {
        headers: { Accept: 'application/json' },
        signal: controller?.signal,
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          return response.json();
        })
        .then((payload) => adaptBanLocationRecords(payload))
        .catch((error) => {
          if (controller && controller.signal && controller.signal.aborted) {
            return [];
          }
          console.warn(`[clubs-fr-debug] Impossible de charger les suggestions BAN pour "${baseQuery}".`, error);
          return [];
        })
        .finally(() => {
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
        });
    });
    return Promise.all(requests).then((chunks) => dedupeLocationSuggestions(chunks.flat()));
  };

  const fetchRemoteLocationSuggestions = (rawQuery) => {
    if (!shouldFetchRemoteLocationSuggestions(rawQuery)) {
      return Promise.resolve([]);
    }
    const cacheKey = buildRemoteSuggestionCacheKey(rawQuery);
    if (cacheKey && remoteLocationSuggestionCache.has(cacheKey)) {
      return remoteLocationSuggestionCache.get(cacheKey);
    }
    const promise = Promise.all([
      fetchGeoLocationSuggestions(rawQuery),
      fetchBanLocationSuggestions(rawQuery),
    ]).then(([geoSuggestions, banSuggestions]) =>
      dedupeLocationSuggestions([...(geoSuggestions || []), ...(banSuggestions || [])])
    );
    if (cacheKey) {
      remoteLocationSuggestionCache.set(cacheKey, promise);
    }
    return promise;
  };

  const positionLocationSuggestions = (anchor) => {
    if (!locationSuggestionsHost || !anchor || typeof anchor.getBoundingClientRect !== 'function') {
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const scrollY = window.scrollY || document.documentElement.scrollTop || 0;
    const scrollX = window.scrollX || document.documentElement.scrollLeft || 0;
    locationSuggestionsHost.style.minWidth = `${rect.width}px`;
    locationSuggestionsHost.style.top = `${rect.bottom + scrollY + 4}px`;
    locationSuggestionsHost.style.left = `${rect.left + scrollX}px`;
  };

  const closeLocationSuggestions = (options = {}) => {
    const preserveRequestId = options.preserveRequestId === true;
    if (!locationSuggestionsHost) {
      return;
    }
    if (locationSuggestionsAnchor && typeof locationSuggestionsAnchor.setAttribute === 'function') {
      locationSuggestionsAnchor.setAttribute('aria-expanded', 'false');
    }
    locationSuggestionsHost.hidden = true;
    locationSuggestionsHost.dataset.open = 'false';
    locationSuggestionsHost.innerHTML = '';
    locationSuggestionsOpen = false;
    locationSuggestionsCurrent = [];
    locationSuggestionsActiveIndex = -1;
    locationSuggestionsAnchor = null;
    if (!preserveRequestId) {
      locationSuggestionsRequestId += 1;
    }
  };

  const highlightLocationSuggestion = (index) => {
    if (!locationSuggestionsOpen || !locationSuggestionsHost) {
      return;
    }
    const items = Array.from(locationSuggestionsHost.querySelectorAll('.clubs-suggestions__item'));
    if (!items.length) {
      return;
    }
    const bounded = ((index % items.length) + items.length) % items.length;
    items.forEach((item, idx) => {
      const isActive = idx === bounded;
      item.classList.toggle('is-active', isActive);
      item.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    locationSuggestionsActiveIndex = bounded;
    const activeNode = items[bounded];
    if (activeNode && typeof activeNode.scrollIntoView === 'function') {
      activeNode.scrollIntoView({ block: 'nearest' });
    }
  };

  const applyLocationSuggestion = (suggestion, options = {}) => {
    if (!suggestion) {
      return;
    }
    const label = formatLocationLabel(suggestion.commune, suggestion.postalCode, suggestion.display);
    if (locationInput) {
      locationInput.value = label;
    }
    syncPrimarySearchValue(label);
    const resolved = resolveSuggestionCoordinates(suggestion);
    locationSuggestionCoords = resolved ? { ...suggestion, ...resolved } : null;
    closeLocationSuggestions();
    const trigger =
      options.triggerButton || (locationSuggestionsAnchor === searchInput ? searchButton : locationApplyButton);
    void handleLocationSubmit({
      triggerButton: trigger,
      fromPrimary: trigger === searchButton,
      prefilledCoords: locationSuggestionCoords,
    });
  };

  const renderLocationSuggestions = (entries, anchor, options = {}) => {
    const host = ensureLocationSuggestionsHost();
    if (!host || !anchor) {
      return;
    }
    const matches = dedupeLocationSuggestions(entries || []);
    locationSuggestionsCurrent = matches;
    if (!matches.length) {
      closeLocationSuggestions({ preserveRequestId: options.preserveRequestIdOnEmpty === true });
      return;
    }
    host.innerHTML = '';
    matches.forEach((suggestion, index) => {
      const label = formatLocationLabel(suggestion.commune, suggestion.postalCode, suggestion.display);
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'clubs-suggestions__item';
      item.setAttribute('role', 'option');
      item.dataset.index = `${index}`;
      const code = document.createElement('span');
      code.className = 'clubs-suggestions__code';
      code.textContent = suggestion.commune || suggestion.postalCode || label;
      item.appendChild(code);
      if (suggestion.commune && suggestion.postalCode) {
        const city = document.createElement('span');
        city.className = 'clubs-suggestions__city';
        city.textContent = `(${suggestion.postalCode})`;
        item.appendChild(city);
      } else if (!suggestion.commune && suggestion.postalCode) {
        // Postal-only: keep single column to avoid duplicate parentheses.
        code.textContent = suggestion.postalCode;
      } else if (label && label !== code.textContent) {
        const city = document.createElement('span');
        city.className = 'clubs-suggestions__city';
        city.textContent = label;
        item.appendChild(city);
      }
      item.addEventListener('click', (event) => {
        event.preventDefault();
        applyLocationSuggestion(suggestion, { triggerButton: options.triggerButton });
      });
      host.appendChild(item);
    });
    locationSuggestionsOpen = true;
    locationSuggestionsAnchor = anchor;
    if (typeof anchor.setAttribute === 'function') {
      anchor.setAttribute('aria-expanded', 'true');
      anchor.setAttribute('aria-controls', locationSuggestionsHost?.id || 'clubs-location-suggestions');
    }
    host.hidden = false;
    host.dataset.open = 'true';
    positionLocationSuggestions(anchor);
    highlightLocationSuggestion(locationSuggestionsCurrent.length ? 0 : -1);
  };

  const openLocationSuggestions = (query, anchor, options = {}) => {
    const host = ensureLocationSuggestionsHost();
    if (!host || !anchor) {
      return;
    }
    const requestId = ++locationSuggestionsRequestId;
    const localMatches = getLocationSuggestionsForQuery(query);
    const initialList = dedupeLocationSuggestions(localMatches);
    renderLocationSuggestions(initialList, anchor, { ...options, preserveRequestIdOnEmpty: true });
    fetchRemoteLocationSuggestions(query)
      .then((remote) => {
        if (requestId !== locationSuggestionsRequestId) {
          return;
        }
        if (remote && remote.length) {
          appendLocationSuggestionsToIndex(remote);
          renderLocationSuggestions(getLocationSuggestionsForQuery(query), anchor, options);
        }
      })
      .catch(() => {});
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
    return { postalCode: str, lat: entry.lat, lng: entry.lng, label: entry.label, precision: 'department' };
  };

  const GEOCODE_ENDPOINT = 'https://nominatim.openstreetmap.org/search';

  const resultsEl = document.getElementById('clubs-results');
  const detailBase = resultsEl?.dataset?.detailBase || '';
  const detailBasePath = (() => {
    if (!detailBase) {
      return null;
    }
    try {
      const url = typeof window !== 'undefined' ? new URL(detailBase, window.location.origin) : null;
      if (url) {
        return normalisePathname(url.pathname);
      }
    } catch (error) {
      // ignore URL parsing issues and fall back to the raw path
    }
    return normalisePathname(detailBase);
  })();
  const resultsShell = document.getElementById('clubs-results-shell');
  const resultsCloseButton = document.getElementById('clubs-results-close');
  const searchBlock = document.querySelector('.clubs-search-block');
  const DEFAULT_RESULTS_SCROLL_MARGIN = 24;
  const SEARCH_SCROLL_OFFSET = 12;
  const parseScrollMargin = (value) => {
    if (value == null || value === '') {
      return null;
    }
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const configuredScrollMargin = parseScrollMargin(resultsEl?.dataset?.scrollMargin);
  const resultsScrollMargin = configuredScrollMargin ?? DEFAULT_RESULTS_SCROLL_MARGIN;
  const mobileViewportQuery =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(max-width: 820px)')
      : null;
  const isMobileViewport = () => {
    if (mobileViewportQuery) {
      return mobileViewportQuery.matches;
    }
    if (typeof window !== 'undefined' && Number.isFinite(window.innerWidth)) {
      return window.innerWidth <= 820;
    }
    return false;
  };
  const isElementVisible = (element) => {
    if (!element || typeof element.getClientRects !== 'function') {
      return false;
    }
    return element.getClientRects().length > 0;
  };
  const isElementInViewport = (element) => {
    if (!element || typeof element.getBoundingClientRect !== 'function' || typeof window === 'undefined') {
      return false;
    }
    const rect = element.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement?.clientHeight || 0;
    return rect.bottom > 0 && rect.top < viewportHeight;
  };

  const getAdminBarHeight = () => {
    if (typeof document === 'undefined') {
      return 0;
    }
    const adminBar = document.getElementById('wpadminbar');
    return adminBar ? adminBar.offsetHeight : 0;
  };

  const getHeaderHeight = () => {
    if (typeof document === 'undefined') {
      return 0;
    }
    const header = document.querySelector('header.wp-block-template-part');
    return header ? header.offsetHeight : 0;
  };

  const getScopeBannerHeight = () => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return 0;
    }
    const raw = window.getComputedStyle(document.documentElement).getPropertyValue('--clubs-scope-banner-height');
    const parsed = Number.parseFloat(raw);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
    return clubsScopeBanner ? clubsScopeBanner.offsetHeight || 0 : 0;
  };

  const LIST_SCROLL_RESTORE_THRESHOLD = 24;
  const listScrollAnchors = { window: 0, shell: 0 };
  const listScrollAnchorsSet = { window: false, shell: false };
  let pendingNavigationState = null;

  const getListScrollTop = (context) => {
    if (context === 'shell') {
      return resultsShell ? resultsShell.scrollTop || 0 : 0;
    }
    if (typeof window === 'undefined') {
      return 0;
    }
    return window.scrollY || document.documentElement?.scrollTop || 0;
  };

  const setListScrollAnchor = (context, value) => {
    const top = Number.isFinite(value) ? value : 0;
    listScrollAnchors[context] = Math.max(0, top);
    listScrollAnchorsSet[context] = true;
  };

  const updateListScrollAnchor = (context, value) => {
    const top = Number.isFinite(value) ? value : getListScrollTop(context);
    setListScrollAnchor(context, top);
  };

  const getListScrollAnchor = (context) => (listScrollAnchorsSet[context] ? listScrollAnchors[context] : 0);

  const getListScrollContext = () => {
    if (resultsShell && typeof isMobileViewport === 'function' && isMobileViewport() && mobileResultsOpen) {
      return 'shell';
    }
    return 'window';
  };

  const getListViewportHeight = (context) => {
    if (context === 'shell') {
      return resultsShell ? resultsShell.clientHeight || 0 : 0;
    }
    if (typeof window === 'undefined') {
      return 0;
    }
    return window.innerHeight || document.documentElement?.clientHeight || 0;
  };

  const getElementBoundsInContext = (element, context) => {
    if (!element || typeof element.getBoundingClientRect !== 'function') {
      return null;
    }
    if (context === 'shell') {
      if (!resultsShell) {
        return null;
      }
      const elementRect = element.getBoundingClientRect();
      const shellRect = resultsShell.getBoundingClientRect();
      const scrollTop = resultsShell.scrollTop || 0;
      return {
        top: elementRect.top - shellRect.top + scrollTop,
        bottom: elementRect.bottom - shellRect.top + scrollTop,
      };
    }
    const elementRect = element.getBoundingClientRect();
    const scrollTop = getListScrollTop('window');
    return {
      top: elementRect.top + scrollTop,
      bottom: elementRect.bottom + scrollTop,
    };
  };

  const isElementVisibleAtAnchor = (element, context) => {
    const bounds = getElementBoundsInContext(element, context);
    const viewportHeight = getListViewportHeight(context);
    if (!bounds || !viewportHeight) {
      return false;
    }
    const anchor = getListScrollAnchor(context);
    const viewportTop = anchor;
    const viewportBottom = anchor + viewportHeight;
    return bounds.bottom > viewportTop && bounds.top < viewportBottom;
  };

  const shouldRestoreListScroll = (context, scrollTop) => {
    const anchor = getListScrollAnchor(context);
    return Math.abs(scrollTop - anchor) > LIST_SCROLL_RESTORE_THRESHOLD;
  };

  const getScrollTargetTop = (target, offset) => {
    if (!target || typeof target.getBoundingClientRect !== 'function' || typeof window === 'undefined') {
      return null;
    }
    const targetTop = target.getBoundingClientRect().top + window.scrollY;
    return Math.max(targetTop - offset, 0);
  };

  const scrollToTarget = (target, options = {}) => {
    if (!target || typeof window === 'undefined' || typeof target.getBoundingClientRect !== 'function') {
      return false;
    }
    const behavior = options.behavior || 'smooth';
    const offset = Number.isFinite(options.offset) ? options.offset : 0;
    const targetTop = target.getBoundingClientRect().top + window.scrollY;
    const top = Math.max(targetTop - offset, 0);
    try {
      window.scrollTo({ top, behavior });
    } catch {
      window.scrollTo(0, top);
    }
    return true;
  };

  const scrollToSearchBlock = (options = {}) => {
    const target = searchBlock || searchInput || resultsShell || resultsEl;
    const behavior = options.behavior || 'smooth';
    const offset = getAdminBarHeight() + getHeaderHeight() + getScopeBannerHeight() + SEARCH_SCROLL_OFFSET;
    const targetTop = getScrollTargetTop(target, offset);
    if (Number.isFinite(targetTop)) {
      updateListScrollAnchor('window', targetTop);
    } else {
      updateListScrollAnchor('window');
    }
    if (scrollToTarget(target, { behavior, offset })) {
      return;
    }
    if (!target || typeof target.scrollIntoView !== 'function') {
      return;
    }
    try {
      target.scrollIntoView({ behavior, block: 'start', inline: 'nearest' });
    } catch {
      target.scrollIntoView({ block: 'start' });
    }
  };

  const searchInput = document.getElementById('clubs-search');
  const searchButton = document.getElementById('clubs-search-submit');
  const resetButton = document.getElementById('clubs-search-clear');
  const locationInput = document.getElementById('clubs-location');
  const locationApplyButton = document.getElementById('clubs-location-apply');
  const locationClearButton = document.getElementById('clubs-location-clear');
  const geolocButton = document.getElementById('clubs-use-geoloc');
  const locationStatus = document.getElementById('clubs-location-status');
  const geolocStatus = document.getElementById('clubs-geoloc-status');
  const locationSuggestionsHost = document.getElementById('clubs-location-suggestions');
  const LOCATION_SUGGESTIONS_LIMIT = 12;
  const LOCATION_REMOTE_ENDPOINT = 'https://geo.api.gouv.fr/communes';
  const LOCATION_REMOTE_LIMIT = Math.max(LOCATION_SUGGESTIONS_LIMIT * 3, 24);
  const LOCATION_REMOTE_POSTAL_LIMIT = Math.max(LOCATION_SUGGESTIONS_LIMIT * 10, 120);
  const LOCATION_REMOTE_FIELDS = 'nom,centre,codesPostaux,code';
  const LOCATION_REMOTE_MIN_CHARS = 2;
  const LOCATION_REMOTE_TIMEOUT_MS = 2400;
  const LOCATION_REMOTE_ALT_ENDPOINT = 'https://api-adresse.data.gouv.fr/search/';
  const LOCATION_REMOTE_ALT_LIMIT = Math.max(LOCATION_SUGGESTIONS_LIMIT * 2, 12);
  const LOCATION_REMOTE_ALT_LIMIT_POSTAL = Math.max(LOCATION_SUGGESTIONS_LIMIT * 16, 200);
  const LOCATION_REMOTE_ALT_TIMEOUT_MS = 2400;
  const LOCATION_REMOTE_ALT_TYPES = new Set(['municipality']);
  const remoteLocationSuggestionCache = new Map();
  let locationSuggestionsIndex = [];
  let locationSuggestionsCurrent = [];
  let locationSuggestionsAnchor = null;
  let locationSuggestionsActiveIndex = -1;
  let locationSuggestionsOpen = false;
  let locationSuggestionsRequestId = 0;
  let locationSuggestionCoords = null;
  const setLocationSuggestionIndex = (entries, options = {}) => {
    const preserveRemote = options.preserveRemote === true;
    const base = Array.isArray(entries) ? entries : [];
    const remote = preserveRemote
      ? (locationSuggestionsIndex || []).filter((item) => item && item.source === 'remote')
      : [];
    const merged = dedupeLocationSuggestions([...base, ...remote]);
    merged.sort((a, b) => compareDisplayStrings(a.display, b.display));
    locationSuggestionsIndex = merged;
  };

  const appendLocationSuggestionsToIndex = (entries) => {
    if (!entries || !entries.length) {
      return;
    }
    setLocationSuggestionIndex([...(locationSuggestionsIndex || []), ...entries]);
  };
  const distanceGroup = document.querySelector('[data-mobile-collapsible]');
  const distanceFields = document.getElementById('clubs-distance-fields');
  const distanceToggle = document.getElementById('clubs-distance-toggle');
  const distanceHeader = document.querySelector('.clubs-distance__intro');

  const LOADING_OVERLAY_ID = 'clubs-loading-overlay';
  const LOADING_OVERLAY_DEFAULT_LABEL = 'Patientez…';
  const LOADING_OVERLAY_FALLBACK_ICON = '/wp-content/themes/echecs92-child/assets/cdje92.svg';
  const LOADING_OVERLAY_MIN_VISIBLE_MS = 480;
  const CINEMA_OVERLAY_ID = 'cdje92-cinema-overlay';
  const CINEMA_PROLOGUE_DURATION_MS = 1400;
  const CINEMA_REVEAL_BASE_DELAY_MS = 380;
  const CINEMA_REVEAL_STEP_MS = 220;
  const CINEMA_QUERY_REVEAL_DELAY_MS = 220;
  const CINEMA_QUERY_FOCUS_DURATION_MS = 2100;
  const CINEMA_QUERY_FOCUS_CLASS = 'cdje92-cinema-query-focus';
  const CINEMA_QUERY_APPEAR_CLASS = 'cdje92-cinema-query-appear';
  let loadingOverlayElement = null;
  let loadingOverlayVisibleSince = 0;
  let loadingOverlayHideTimer = null;
  let loadingOverlayStack = 0;
  let cinemaOverlayElement = null;
  let cinemaFlowConsumed = false;

  const getGlobalSpinner = () => {
    if (typeof window === 'undefined') {
      return null;
    }
    const api = window.cdjeSpinner;
    if (api && typeof api.show === 'function') {
      return api;
    }
    return null;
  };

  const setLoadingPageLock = (active) => {
    if (typeof document === 'undefined') {
      return;
    }
    const method = active ? 'add' : 'remove';
    document.documentElement?.classList[method]('clubs-loading-lock');
    document.body?.classList[method]('clubs-loading-lock');
  };

  const resolveFaviconUrl = () => {
    if (typeof document === 'undefined') {
      return LOADING_OVERLAY_FALLBACK_ICON;
    }
    const selectors = [
      'link[rel="icon"]',
      'link[rel="shortcut icon"]',
      'link[rel*="icon"]',
      'link[rel="apple-touch-icon"]',
    ];
    for (const selector of selectors) {
      const link = document.querySelector(selector);
      if (link && link.href) {
        return link.href;
      }
    }
    return LOADING_OVERLAY_FALLBACK_ICON;
  };

  const ensureLoadingOverlay = () => {
    if (loadingOverlayElement) {
      return loadingOverlayElement;
    }
    if (typeof document === 'undefined' || !document.body) {
      return null;
    }
    const overlay = document.createElement('div');
    overlay.id = LOADING_OVERLAY_ID;
    overlay.className = 'clubs-loading-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = `
      <div class="clubs-loading-overlay__backdrop"></div>
      <div class="clubs-loading-overlay__content" role="status" aria-live="polite">
        <div class="clubs-loading-overlay__spinner">
          <span class="clubs-loading-overlay__ring"></span>
          <img class="clubs-loading-overlay__icon" alt="" loading="lazy" decoding="async" />
        </div>
        <p class="clubs-loading-overlay__label">${LOADING_OVERLAY_DEFAULT_LABEL}</p>
      </div>
    `;
    const icon = overlay.querySelector('.clubs-loading-overlay__icon');
    const faviconUrl = resolveFaviconUrl();
    if (icon && faviconUrl) {
      icon.setAttribute('src', faviconUrl);
    }
    const host = document.body;
    if (!host) {
      return null;
    }
    host.appendChild(overlay);
    loadingOverlayElement = overlay;
    return overlay;
  };

  const setLoadingOverlayLabel = (label) => {
    const overlay = ensureLoadingOverlay();
    if (!overlay) {
      return;
    }
    const labelNode = overlay.querySelector('.clubs-loading-overlay__label');
    if (labelNode) {
      labelNode.textContent = label || LOADING_OVERLAY_DEFAULT_LABEL;
    }
    const icon = overlay.querySelector('.clubs-loading-overlay__icon');
    const faviconUrl = resolveFaviconUrl();
    if (icon && faviconUrl && icon.getAttribute('src') !== faviconUrl) {
      icon.setAttribute('src', faviconUrl);
    }
  };

  const hideLoadingOverlay = () => {
    if (!loadingOverlayElement) {
      return;
    }
    if (loadingOverlayStack > 0) {
      loadingOverlayStack -= 1;
    }
    if (loadingOverlayStack > 0) {
      return;
    }
    const elapsed = Date.now() - loadingOverlayVisibleSince;
    const delay = Math.max(0, LOADING_OVERLAY_MIN_VISIBLE_MS - elapsed);
    if (loadingOverlayHideTimer) {
      clearTimeout(loadingOverlayHideTimer);
    }
    loadingOverlayHideTimer = setTimeout(() => {
      if (!loadingOverlayElement) {
        return;
      }
      loadingOverlayElement.classList.remove('is-visible');
      loadingOverlayElement.setAttribute('aria-hidden', 'true');
      loadingOverlayHideTimer = null;
    }, delay);
  };

  const showLoadingOverlay = (label) => {
    const globalSpinner = getGlobalSpinner();
    if (globalSpinner) {
      // Do not lock scrolling: the "jump to results" relies on scrollTo/scrollIntoView.
      // Locking scroll here makes the behaviour flaky (sometimes no scroll at all).
      return globalSpinner.show(label, { host: document.body, lockScroll: false, pinToViewport: true });
    }
    const overlay = ensureLoadingOverlay();
    if (!overlay) {
      return () => {};
    }
    if (loadingOverlayHideTimer) {
      clearTimeout(loadingOverlayHideTimer);
      loadingOverlayHideTimer = null;
    }
    if (loadingOverlayStack === 0) {
      loadingOverlayVisibleSince = Date.now();
    }
    loadingOverlayStack += 1;
    setLoadingOverlayLabel(label);
    overlay.classList.add('is-visible');
    overlay.setAttribute('aria-hidden', 'false');
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      hideLoadingOverlay();
    };
  };

  let searchClearLockCount = 0;
  let locationClearLockCount = 0;

  const updateClearButtons = () => {
    if (resetButton && searchInput) {
      const hasValue = (searchInput.value || '').trim().length > 0;
      const locked = searchClearLockCount > 0;
      resetButton.hidden = locked || !hasValue;
    }
    if (locationClearButton && locationInput) {
      const hasValue = (locationInput.value || '').trim().length > 0;
      const locked = locationClearLockCount > 0;
      locationClearButton.hidden = locked || !hasValue;
    }
  };

  const lockSearchClear = () => {
    searchClearLockCount += 1;
    updateClearButtons();
  };

  const unlockSearchClear = () => {
    searchClearLockCount = Math.max(0, searchClearLockCount - 1);
    updateClearButtons();
  };

  const lockLocationClear = () => {
    locationClearLockCount += 1;
    updateClearButtons();
  };

  const unlockLocationClear = () => {
    locationClearLockCount = Math.max(0, locationClearLockCount - 1);
    updateClearButtons();
  };

  const syncPrimarySearchValue = (value) => {
    if (!searchInput) {
      return;
    }
    searchInput.value = value != null ? value : '';
    updateClearButtons();
  };

  const dismissMobileSearchKeyboard = () => {
    if (typeof document === 'undefined') {
      return;
    }
    const active = document.activeElement;
    [searchInput, locationInput].forEach((input) => {
      if (input && typeof input.blur === 'function' && active === input) {
        input.blur();
      }
    });
    if (active && active !== document.body && typeof active.blur === 'function') {
      const tag = active.tagName ? active.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea') {
        active.blur();
      }
    }
  };

  const syncLocationSuggestionsPosition = () => {
    if (!locationSuggestionsHost) {
      return;
    }
    if (locationSuggestionsOpen && locationSuggestionsAnchor) {
      positionLocationSuggestions(locationSuggestionsAnchor);
    }
  };

  const selectActiveLocationSuggestion = (triggerButton) => {
    if (!locationSuggestionsCurrent.length) {
      return false;
    }
    const index = locationSuggestionsActiveIndex >= 0 ? locationSuggestionsActiveIndex : 0;
    const suggestion = locationSuggestionsCurrent[index];
    if (!suggestion) {
      return false;
    }
    applyLocationSuggestion(suggestion, { triggerButton });
    return true;
  };

  const handleLocationSuggestionInput = (event) => {
    const target = event?.target;
    if (!target || (target !== searchInput && target !== locationInput)) {
      return;
    }
    locationSuggestionCoords = null;
    openLocationSuggestions(target.value, target, {
      triggerButton: target === searchInput ? searchButton : locationApplyButton,
    });
  };

  const handleLocationSuggestionFocus = (event) => {
    const target = event?.target;
    if (!target || (target !== searchInput && target !== locationInput)) {
      return;
    }
    openLocationSuggestions(target.value, target, {
      triggerButton: target === searchInput ? searchButton : locationApplyButton,
    });
  };

  const handleLocationSuggestionBlur = () => {
    window.setTimeout(() => closeLocationSuggestions(), 120);
  };

  const handleLocationSuggestionKeydown = (event) => {
    const target = event?.target;
    if (!target || (target !== searchInput && target !== locationInput)) {
      return;
    }
    locationSuggestionCoords = null;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!locationSuggestionsOpen) {
        openLocationSuggestions(target.value, target, {
          triggerButton: target === searchInput ? searchButton : locationApplyButton,
        });
      } else {
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        const nextIndex =
          locationSuggestionsActiveIndex >= 0 ? locationSuggestionsActiveIndex + delta : delta > 0 ? 0 : -1;
        highlightLocationSuggestion(nextIndex);
      }
      return;
    }
    if (event.key === 'Enter') {
      if (locationSuggestionsOpen && locationSuggestionsCurrent.length) {
        event.preventDefault();
        selectActiveLocationSuggestion(target === searchInput ? searchButton : locationApplyButton);
        return;
      }
    }
    if (event.key === 'Escape') {
      closeLocationSuggestions();
    }
  };

  const handleDocumentPointerDown = (event) => {
    if (!locationSuggestionsOpen || !locationSuggestionsHost) {
      return;
    }
    const target = event.target;
    if (
      target === locationSuggestionsHost ||
      locationSuggestionsHost.contains(target) ||
      target === searchInput ||
      target === locationInput
    ) {
      return;
    }
    closeLocationSuggestions();
  };
  const moreButton = document.getElementById('clubs-more-button');
  const optionsDetails = document.getElementById('clubs-options');
  const sortButtons = document.querySelectorAll('[data-club-sort]');
  const mapCtaLink = document.querySelector('.clubs-map-box__cta');
  const highlightLocationButton = document.getElementById('clubs-highlight-location');
  const highlightGeolocButton = document.getElementById('clubs-highlight-geoloc');
  const canUseHistory = typeof window !== 'undefined' && window.history && typeof window.history.pushState === 'function';
  const initialHistoryState =
    canUseHistory && typeof window.history.state === 'object' && window.history.state !== null
      ? window.history.state
      : null;
  const initialSearchParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const initialQueryParam = initialSearchParams ? (initialSearchParams.get('q') || '').trim() : '';
  const initialPrefillParam = initialSearchParams ? (initialSearchParams.get('prefill') || '').trim() : '';
  const initialHasIgSignature =
    Boolean(initialSearchParams) &&
    initialSearchParams.get('v') === '1' &&
    initialSearchParams.get('id') === 'anNw' &&
    initialSearchParams.get('ref') === 'pk';
  const initialHasLegacyIgEntry = Boolean(initialSearchParams) && initialSearchParams.get('cdje92_ig_entry') === '1';
  const initialCinemaPrefillValue =
    initialPrefillParam || (initialHasIgSignature || initialHasLegacyIgEntry ? 'mathisboche' : '');
  const initialSortParam = initialSearchParams ? (initialSearchParams.get('tri') || '').trim() : '';
  const initialLocParam = initialSearchParams ? (initialSearchParams.get('loc') || '').trim() : '';
  const initialOpenResults = initialSearchParams ? initialSearchParams.get('liste') === '1' : false;
  const initialFocusParam = initialSearchParams ? (initialSearchParams.get('focus') || '').trim() : '';
  const shouldFocusSearch =
    Boolean(initialSearchParams && initialSearchParams.has('focus') && initialFocusParam !== '0');

  let renderUpdatesDeferred = false;
  let pendingRenderOptions = null;
  let pendingRenderUpdate = false;
  let pendingTotalCounterText = null;
  let totalCounterPlaceholderActive = false;
  let totalCounterPlaceholderText = COUNTER_LOADING_TEXT;
  let mobileResultsOpen = false;
  let pageScrollBeforeResults = 0;
	  let resultsHistoryPushed = false;

	  let scopeTailBanner = null;
	  const ensureScopeTailBanner = () => {
	    if (scopeTailBanner || !clubsScopeBanner) {
	      return scopeTailBanner;
	    }
	    const sourceText = clubsScopeBanner.querySelector('.clubs-scope-banner__text');
	    const sourceLink = clubsScopeBanner.querySelector('.clubs-scope-banner__link');
	    const href =
	      (sourceLink && (sourceLink.getAttribute('href') || sourceLink.href)) || FRANCE_LIST_PATH;

	    const banner = document.createElement('div');
	    banner.className = 'clubs-scope-tail-banner';
	    banner.setAttribute('role', 'listitem');
	    banner.setAttribute('aria-label', 'Changer de périmètre de recherche');

	    const text = document.createElement('span');
	    text.className = 'clubs-scope-tail-banner__text';
	    text.textContent = (sourceText && sourceText.textContent) || 'Clubs partout en France ?';
	    banner.appendChild(text);

	    const link = document.createElement('a');
	    link.className = 'clubs-scope-tail-banner__link';
	    link.href = href;
	    link.textContent = (sourceLink && sourceLink.textContent) || 'Voir';
	    banner.appendChild(link);

	    scopeTailBanner = banner;
	    return scopeTailBanner;
	  };
	  const syncScopeTailBanner = () => {
	    if (!resultsEl || !clubsScopeBanner) {
	      return;
	    }
	    const shouldShow =
	      mobileResultsOpen &&
	      isMobileViewport() &&
	      state.filtered.length > 0 &&
	      state.visibleCount > VISIBLE_RESULTS_DEFAULT;
	    if (!shouldShow) {
	      if (scopeTailBanner && scopeTailBanner.parentElement) {
	        scopeTailBanner.parentElement.removeChild(scopeTailBanner);
	      }
	      return;
	    }
	    const banner = ensureScopeTailBanner();
	    if (!banner) {
	      return;
	    }
	    if (banner.parentElement !== resultsEl) {
	      if (banner.parentElement) {
	        banner.parentElement.removeChild(banner);
	      }
	      resultsEl.appendChild(banner);
	      return;
	    }
	    if (banner !== resultsEl.lastElementChild) {
	      resultsEl.appendChild(banner);
	    }
	  };
	  let suppressFocusAnimation = false;

  const deferResultsRendering = (options = {}) => {
    const placeholder =
      typeof options.placeholder === 'string' && options.placeholder.trim()
        ? options.placeholder.trim()
        : COUNTER_LOADING_TEXT;
    totalCounterPlaceholderText = placeholder;
    renderUpdatesDeferred = true;
    if (totalCounter && !totalCounterPlaceholderActive) {
      totalCounterPlaceholderActive = true;
      totalCounter.classList.add('is-deferred');
    }
    if (totalCounter && totalCounterPlaceholderActive) {
      totalCounter.textContent = totalCounterPlaceholderText;
    }
  };

  const flushDeferredResultsRendering = () => {
    if (!renderUpdatesDeferred && !totalCounterPlaceholderActive) {
      return;
    }
    if (renderUpdatesDeferred) {
      renderUpdatesDeferred = false;
      if (pendingRenderUpdate) {
        const queuedOptions = pendingRenderOptions ? { ...pendingRenderOptions } : {};
        pendingRenderOptions = null;
        pendingRenderUpdate = false;
        renderResults({ ...queuedOptions, force: true });
      }
    }
    if (totalCounter && totalCounterPlaceholderActive) {
      totalCounterPlaceholderActive = false;
      totalCounter.classList.remove('is-deferred');
      const nextText = pendingTotalCounterText;
      pendingTotalCounterText = null;
      totalCounterPlaceholderText = COUNTER_LOADING_TEXT;
      if (nextText != null) {
        totalCounter.textContent = nextText;
      } else {
        updateTotalCounter();
      }
    }
  };

  const expandOptionsPanel = () => {
    if (!optionsDetails) {
      return;
    }
    const isDetailsElement = optionsDetails.tagName && optionsDetails.tagName.toLowerCase() === 'details';
    if (isDetailsElement) {
      optionsDetails.open = true;
      return;
    }
    optionsDetails.classList.add('is-expanded');
  };

  const ensureDistanceSectionOpen = () => {
    if (!distanceGroup) {
      return;
    }
    distanceGroup.dataset.expanded = 'true';
    if (distanceToggle) {
      distanceToggle.setAttribute('aria-expanded', 'true');
    }
    if (distanceFields) {
      distanceFields.hidden = false;
    }
    updateClearButtons();
  };

  const syncDistanceCollapse = () => {
    if (!distanceGroup) {
      return;
    }
    const shouldCollapse = isMobileViewport();
    if (!shouldCollapse) {
      ensureDistanceSectionOpen();
      return;
    }
    const expanded = distanceGroup.dataset.expanded !== 'false';
    distanceGroup.dataset.expanded = expanded ? 'true' : 'false';
    if (distanceToggle) {
      distanceToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    }
    if (distanceFields) {
      distanceFields.hidden = !expanded;
    }
    updateClearButtons();
  };

  const toggleDistanceSection = () => {
    if (!distanceGroup) {
      return;
    }
    const nextExpanded = distanceGroup.dataset.expanded !== 'true';
    distanceGroup.dataset.expanded = nextExpanded ? 'true' : 'false';
    if (distanceToggle) {
      distanceToggle.setAttribute('aria-expanded', nextExpanded ? 'true' : 'false');
    }
    if (distanceFields) {
      distanceFields.hidden = isMobileViewport() ? !nextExpanded : false;
    }
  };

  let totalCounter = null;
  if (resultsEl) {
    totalCounter = document.createElement('p');
    totalCounter.className = 'clubs-total';
    totalCounter.setAttribute('aria-live', 'polite');
    if (Number.isFinite(resultsScrollMargin)) {
      totalCounter.style.setProperty('--clubs-results-scroll-margin', `${resultsScrollMargin}px`);
    }
    resultsEl.before(totalCounter);
  }

  const syncResultsShellToViewport = () => {
    if (!resultsShell) {
      return;
    }
    if (!isMobileViewport() && mobileResultsOpen) {
      mobileResultsOpen = false;
    }
	    if (mobileResultsOpen) {
	      resultsShell.classList.add('is-active');
	      resultsShell.setAttribute('aria-hidden', 'false');
	      if (typeof document !== 'undefined' && document.body) {
	        document.body.classList.add('clubs-results-open');
	      }
	      setScopeBannerSuppressed(isMobileViewport());
	      syncScopeTailBanner();
	    } else {
	      resultsShell.classList.remove('is-active');
	      resultsShell.setAttribute('aria-hidden', 'true');
	      if (typeof document !== 'undefined' && document.body) {
	        document.body.classList.remove('clubs-results-open');
	      }
	      setScopeBannerSuppressed(false);
	      syncScopeTailBanner();
	    }
	  };

  const openResultsShell = (options = {}) => {
    if (!resultsShell) {
      return;
    }
	    if (!isMobileViewport()) {
	      mobileResultsOpen = false;
	      syncResultsShellToViewport();
	      if (canUseHistory && options.skipHistory !== true) {
	        syncUrlState({ openResults: false });
      }
      setScopeBannerSuppressed(false);
	      return;
	    }
	    setScopeBannerSuppressed(true);
	    const skipHistory = options.skipHistory === true;
	    if (typeof window !== 'undefined') {
	      pageScrollBeforeResults = window.scrollY || document.documentElement.scrollTop || 0;
	      try {
        window.scrollTo({ top: 0, behavior: 'auto' });
      } catch {
        window.scrollTo(0, 0);
      }
    }
    mobileResultsOpen = true;
    resultsShell.classList.add('is-active');
    resultsShell.setAttribute('aria-hidden', 'false');
    if (typeof document !== 'undefined' && document.body) {
      document.body.classList.add('clubs-results-open');
    }
    if (canUseHistory && !resultsHistoryPushed && !skipHistory) {
      try {
        const baseState =
          typeof window.history.state === 'object' && window.history.state !== null
            ? window.history.state
            : initialHistoryState && typeof initialHistoryState === 'object'
            ? initialHistoryState
            : {};
        const payload = { ...baseState, clubsResultsOpen: true, clubsContext: 'clubs' };
        const nextUrl = buildUrlWithState(true);
        window.history.pushState(payload, '', nextUrl || window.location.href);
        resultsHistoryPushed = true;
      } catch (error) {
        resultsHistoryPushed = false;
      }
    } else if (canUseHistory) {
      syncUrlState({ openResults: true });
    }
    if (typeof resultsShell.scrollTo === 'function') {
      try {
        resultsShell.scrollTo({ top: 0, behavior: 'auto' });
      } catch {
        resultsShell.scrollTo(0, 0);
      }
	    } else {
	      resultsShell.scrollTop = 0;
	    }
	    updateListScrollAnchor('shell', 0);
	    syncScopeTailBanner();
	  };

  const closeResultsShell = (options = {}) => {
    if (!resultsShell) {
      return;
    }
    const fromPopstate = options.fromPopstate === true;
    const viaUser = options.viaUser === true;
    const smoothToSearch = viaUser && !isMobileViewport();
    if (viaUser && resultsHistoryPushed && canUseHistory) {
      // Laisse le navigateur revenir à l'entrée précédente (sans la liste ouverte).
      window.history.back();
      return;
    }
    mobileResultsOpen = false;
    resultsShell.classList.remove('is-active');
    resultsShell.setAttribute('aria-hidden', 'true');
	    if (typeof document !== 'undefined' && document.body) {
	      document.body.classList.remove('clubs-results-open');
	    }
	    setScopeBannerSuppressed(false);
	    syncScopeTailBanner();
	    if (smoothToSearch) {
	      scrollToSearchBlock({ behavior: 'smooth' });
	    } else if (typeof window !== 'undefined' && Number.isFinite(pageScrollBeforeResults)) {
      try {
        window.scrollTo({ top: pageScrollBeforeResults, behavior: 'smooth' });
      } catch {
        window.scrollTo(0, pageScrollBeforeResults || 0);
      }
    }
    if (canUseHistory && !fromPopstate) {
      syncUrlState({ openResults: false });
    }
    resultsHistoryPushed = false;
  };

  const RESULTS_STICKY_BASE_GAP_PX = 12;
  const getHeaderOffsetPx = () => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return 0;
    }
    const raw = window.getComputedStyle(document.documentElement).getPropertyValue('--cm-header-offset');
    const parsed = Number.parseFloat(raw);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
    return getHeaderHeight();
  };

  const getResultsStickyTopPx = (options = {}) => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return 0;
    }
    const assumeHeaderCollapsed = options.assumeHeaderCollapsed !== false;
    const currentHeaderOffset = getHeaderOffsetPx();
    const header =
      (resultsShell && resultsShell.querySelector('.clubs-results-shell__header')) ||
      (resultsCloseButton ? resultsCloseButton.closest('.clubs-results-shell__header') : null);
    if (header) {
      const raw = window.getComputedStyle(header).top;
      const parsed = Number.parseFloat(raw);
      if (Number.isFinite(parsed)) {
        if (assumeHeaderCollapsed && currentHeaderOffset > 0) {
          return Math.max(0, parsed - currentHeaderOffset);
        }
        return parsed;
      }
    }
    // Fallback: mimic `--clubs-results-sticky-top` calc (without safe-area).
    const stickyTop = getAdminBarHeight() + getHeaderOffsetPx() + getScopeBannerHeight() + RESULTS_STICKY_BASE_GAP_PX;
    if (assumeHeaderCollapsed && currentHeaderOffset > 0) {
      return Math.max(0, stickyTop - currentHeaderOffset);
    }
    return stickyTop;
  };

  const jumpToResults = (options = {}) => {
    if (!resultsEl) {
      return;
    }
    if (resultsShell && isMobileViewport()) {
      openResultsShell();
      return;
    }
    const behavior = options.behavior === 'instant' ? 'auto' : options.behavior || 'smooth';
    const marginOverride = Number.isFinite(options.margin) ? options.margin : null;
    const scrollMargin = Number.isFinite(marginOverride) ? marginOverride : resultsScrollMargin;
    // Use the collapsed-header position to avoid stopping too early when the header retracts during scroll.
    const stickyTop = getResultsStickyTopPx({ assumeHeaderCollapsed: true });
    const extraGap = Number.isFinite(scrollMargin)
      ? Math.max(0, scrollMargin - RESULTS_STICKY_BASE_GAP_PX)
      : 0;
    const offset = stickyTop + extraGap;
    // Avoid sticky elements as anchors: the close button is sticky, which makes its
    // bounding box unreliable when already scrolled inside results.
    const target = resultsShell || totalCounter || resultsEl;
    const targetTop = getScrollTargetTop(target, offset);
    if (Number.isFinite(targetTop)) {
      updateListScrollAnchor('window', targetTop);
    } else {
      updateListScrollAnchor('window');
    }
    const scrollIntoView = () => {
      if (!target || typeof target.scrollIntoView !== 'function') {
        return;
      }
      try {
        target.scrollIntoView({ behavior, block: 'start', inline: 'nearest' });
      } catch {
        target.scrollIntoView({ block: 'start' });
      }
    };
    if (scrollToTarget(target, { behavior, offset })) {
      if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
        const fallbackDelay = behavior === 'auto' ? 0 : 220;
        window.setTimeout(() => {
          if (!isElementInViewport(target)) {
            scrollIntoView();
          }
        }, fallbackDelay);
      } else if (!isElementInViewport(target)) {
        scrollIntoView();
      }
      if (typeof resultsEl.focus === 'function') {
        try {
          resultsEl.focus({ preventScroll: true });
        } catch {
          resultsEl.focus();
        }
      }
      return;
    }
    scrollIntoView();
    if (typeof resultsEl.focus === 'function') {
      try {
        resultsEl.focus({ preventScroll: true });
      } catch {
        resultsEl.focus();
      }
    }
  };

  const getCurrentBackPath = () => {
    try {
      const url = new URL(window.location.href);
      return url.pathname + url.search + url.hash;
    } catch (error) {
      return listPath;
    }
  };

  const cameFromClubsContext = () => {
    if (typeof document === 'undefined' || !document.referrer) {
      return false;
    }
    try {
      const refUrl = new URL(document.referrer, window.location.origin);
      if (refUrl.origin !== window.location.origin) {
        return false;
      }
      const normalized = normalisePathname(refUrl.pathname);
      if (normalized === listPath) {
        return true;
      }
      if (detailBasePath && (normalized === detailBasePath || normalized.startsWith(`${detailBasePath}/`))) {
        return true;
      }
      if (/^\/carte-des-clubs(?:-92)?$/i.test(normalized)) {
        return true;
      }
      return /^\/club(?:\/|$)/i.test(normalized);
    } catch (error) {
      return false;
    }
  };

  const getNavigationType = () => {
    if (typeof window === 'undefined') {
      return 'navigate';
    }
    const performanceApi = window.performance;
    if (!performanceApi) {
      return 'navigate';
    }
    try {
      if (typeof performanceApi.getEntriesByType === 'function') {
        const entries = performanceApi.getEntriesByType('navigation');
        const entry = entries && entries[0];
        if (entry && typeof entry.type === 'string') {
          return entry.type;
        }
      }
    } catch (error) {
      // ignore
    }
    const legacy = performanceApi.navigation;
    if (legacy && typeof legacy.type === 'number') {
      if (legacy.type === 1) {
        return 'reload';
      }
      if (legacy.type === 2) {
        return 'back_forward';
      }
    }
    return 'navigate';
  };

  const shouldRestoreSessionStateOnLoad = () => {
    const navType = getNavigationType();
    if (navType === 'reload' || navType === 'back_forward') {
      return true;
    }
    return cameFromClubsContext();
  };

  const clearSessionRestoreState = () => {
    try {
      window.sessionStorage?.removeItem(CLUBS_UI_RESTORE_KEY);
    } catch (error) {
      // ignore
    }
    try {
      window.sessionStorage?.removeItem(CLUBS_LIST_STATE_KEY);
    } catch (error) {
      // ignore
    }
    try {
      window.localStorage?.removeItem(REOPEN_RESULTS_FLAG_KEY);
    } catch (error) {
      // ignore
    }
  };

  const markShouldReopenResults = () => {
    try {
      const storage = window.localStorage;
      if (!storage) {
        return;
      }
      storage.setItem(REOPEN_RESULTS_FLAG_KEY, '1');
    } catch (error) {
      // ignore
    }
  };

  const consumeReopenResultsFlag = () => {
    try {
      const storage = window.localStorage;
      if (!storage) {
        return false;
      }
      const flag = storage.getItem(REOPEN_RESULTS_FLAG_KEY);
      storage.removeItem(REOPEN_RESULTS_FLAG_KEY);
      return flag === '1';
    } catch (error) {
      return false;
    }
  };

  const UI_RESTORE_MAX_AGE = 10 * 60 * 1000;

  const markShouldRestoreUiState = () => {
    try {
      const storage = window.sessionStorage;
      if (!storage) {
        return;
      }
      storage.setItem(CLUBS_UI_RESTORE_KEY, JSON.stringify({ ts: Date.now() }));
    } catch (error) {
      // ignore
    }
  };

  const consumeRestoreUiState = () => {
    try {
      const storage = window.sessionStorage;
      if (!storage) {
        return false;
      }
      const raw = storage.getItem(CLUBS_UI_RESTORE_KEY);
      storage.removeItem(CLUBS_UI_RESTORE_KEY);
      if (!raw) {
        return false;
      }
      let payload = null;
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = null;
      }
      if (!payload || typeof payload !== 'object') {
        return false;
      }
      if (payload.ts && Date.now() - payload.ts > UI_RESTORE_MAX_AGE) {
        return false;
      }
      return true;
    } catch (error) {
      return false;
    }
  };

  const buildUrlWithState = (openResultsFlag) => {
    if (typeof window === 'undefined') {
      return '';
    }
    const params = new URLSearchParams(window.location.search || '');
    params.delete('q');
    params.delete('loc');
    params.delete('tri');
    params.delete('liste');
    params.delete('focus');
    const queryValue = (state.query || '').trim();
    if (!state.distanceMode && queryValue) {
      params.set('q', queryValue);
    }
    if (state.distanceMode && state.distanceReference) {
      params.set('loc', state.distanceReference);
    }
    if (state.sortMode && state.sortMode !== 'default') {
      params.set('tri', state.sortMode);
    }
    if (openResultsFlag) {
      params.set('liste', '1');
    }
    const queryString = params.toString();
    const hash = window.location.hash || '';
    return queryString ? `${window.location.pathname}?${queryString}${hash}` : `${window.location.pathname}${hash}`;
  };

  const syncUrlState = (options = {}) => {
    if (!canUseHistory) {
      return;
    }
    const openFlag = options.openResults ?? mobileResultsOpen;
    const nextUrl = buildUrlWithState(openFlag);
    const baseState =
      typeof window.history.state === 'object' && window.history.state !== null ? window.history.state : {};
    const payload = { ...baseState, clubsResultsOpen: openFlag, clubsContext: 'clubs' };
    try {
      window.history.replaceState(payload, '', nextUrl);
    } catch (error) {
      // ignore history issues
    }
  };

  const rememberClubsNavigation = (context, backPath) => {
    try {
      const storage = window.localStorage;
      if (!storage) {
        return;
      }
      const payload = {
        ts: Date.now(),
        context: context || 'detail:list',
        back: backPath || getCurrentBackPath(),
      };
      storage.setItem(CLUBS_NAV_STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      // ignore storage failures
    }
  };

  const persistListUiState = () => {
    try {
      const storage = window.localStorage;
      if (!storage) {
        return;
      }
      const payload = {
        ts: Date.now(),
        query: searchInput ? searchInput.value : '',
        location: locationInput ? locationInput.value : '',
        distanceMode: state.distanceMode,
        sortMode: state.sortMode,
      };
      storage.setItem(CLUBS_UI_STATE_KEY, JSON.stringify(payload));
    } catch (error) {
      // ignore storage failures
    }
  };

  const consumeListUiState = () => {
    try {
      const storage = window.localStorage;
      if (!storage) {
        return null;
      }
      const raw = storage.getItem(CLUBS_UI_STATE_KEY);
      if (!raw) {
        return null;
      }
      let payload = null;
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = null;
      }
      if (!payload || typeof payload !== 'object') {
        return null;
      }
      const maxAge = 6 * 60 * 60 * 1000;
      if (payload.ts && Date.now() - payload.ts > maxAge) {
        return null;
      }
      return payload;
    } catch (error) {
      return null;
    }
  };

  const getListPathKey = () => {
    if (typeof window === 'undefined') {
      return '';
    }
    return `${window.location.pathname}${window.location.search || ''}`;
  };

  const getListScrollSnapshot = () => {
    if (typeof window === 'undefined') {
      return { context: 'window', top: 0 };
    }
    const usesShell = Boolean(resultsShell && isMobileViewport() && mobileResultsOpen);
    if (usesShell) {
      return { context: 'shell', top: getListScrollTop('shell') };
    }
    return {
      context: 'window',
      top: getListScrollTop('window'),
    };
  };

  const persistListState = (options = {}) => {
    try {
      if (typeof window === 'undefined') {
        return;
      }
      const storage = window.sessionStorage;
      if (!storage) {
        return;
      }
      const snapshot = getListScrollSnapshot();
      const scrollTop = Number.isFinite(options.scrollTop) ? options.scrollTop : snapshot.top;
      const scrollContext =
        typeof options.scrollContext === 'string' && options.scrollContext
          ? options.scrollContext
          : snapshot.context;
      const visibleCount = Number.isFinite(options.visibleCount) ? options.visibleCount : state.visibleCount;
      const scrollRestorable =
        typeof options.scrollRestorable === 'boolean'
          ? options.scrollRestorable
          : shouldRestoreListScroll(scrollContext, scrollTop);
      const payload = {
        ts: Date.now(),
        path: getListPathKey(),
        scrollTop,
        scrollContext,
        visibleCount,
        scrollRestorable,
      };
      storage.setItem(CLUBS_LIST_STATE_KEY, JSON.stringify(payload));
    } catch (error) {
      // ignore storage failures
    }
  };

  const loadListState = () => {
    try {
      if (typeof window === 'undefined') {
        return null;
      }
      const storage = window.sessionStorage;
      if (!storage) {
        return null;
      }
      const raw = storage.getItem(CLUBS_LIST_STATE_KEY);
      if (!raw) {
        return null;
      }
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch (error) {
        payload = null;
      }
      if (!payload || typeof payload !== 'object') {
        return null;
      }
      if (payload.ts && Date.now() - payload.ts > CLUBS_LIST_STATE_MAX_AGE) {
        return null;
      }
      if (payload.path && payload.path !== getListPathKey()) {
        return null;
      }
      return payload;
    } catch (error) {
      return null;
    }
  };

  const restoreListState = (payload) => {
    if (!payload) {
      return Promise.resolve(false);
    }
    const scrollRestorable =
      payload.scrollRestorable === true ||
      (payload.scrollRestorable == null &&
        Number.isFinite(payload.scrollTop) &&
        Math.abs(payload.scrollTop) > LIST_SCROLL_RESTORE_THRESHOLD);
    const shouldOpenShell =
      payload.scrollContext === 'shell' && resultsShell && typeof isMobileViewport === 'function' && isMobileViewport();
    if (shouldOpenShell && !mobileResultsOpen) {
      openResultsShell({ skipHistory: true });
    }
    if (
      Number.isFinite(payload.visibleCount) &&
      payload.visibleCount > state.visibleCount &&
      state.filtered.length
    ) {
      state.visibleCount = Math.min(payload.visibleCount, state.filtered.length);
      renderResults({ force: true });
    }
    const restoreScroll = () => {
      if (!scrollRestorable) {
        return;
      }
      const scrollTop = Number.isFinite(payload.scrollTop) ? payload.scrollTop : 0;
      if (payload.scrollContext === 'shell' && resultsShell && isMobileViewport()) {
        resultsShell.scrollTop = Math.max(0, scrollTop);
        return;
      }
      if (typeof window !== 'undefined') {
        window.scrollTo(0, Math.max(0, scrollTop));
      }
    };
    if (!scrollRestorable) {
      return Promise.resolve(false);
    }
    return new Promise((resolve) => {
      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            restoreScroll();
            window.requestAnimationFrame(() => resolve(true));
          });
        });
        return;
      }
      setTimeout(() => {
        restoreScroll();
        setTimeout(() => resolve(true), 0);
      }, 0);
    });
  };

  const DEFAULT_SORT_MODE = 'licenses';

  const state = {
    clubs: [],
    filtered: [],
    query: '',
    pendingQuery: searchInput ? searchInput.value.trim() : '',
    visibleCount: VISIBLE_RESULTS_DEFAULT,
    distanceMode: false,
    distanceReference: '',
    distanceReferencePostal: '',
    distanceReferenceCommune: '',
    distanceReferenceType: '',
    sortMode: DEFAULT_SORT_MODE,
    statusMessage: '',
    locationMessage: '',
    restoreMode: false,
  };

  const DEBUG_FLAG_KEY = 'echecs92:clubs-fr:debug';
  const DEBUG_CONSOLE_PREFIX = '[clubs-fr-debug]';
  const DEBUG_PANEL_ID = 'clubs-debug-panel';
  const DEBUG_INDICATOR_ID = 'clubs-debug-indicator';
  const debugState = {
    active: false,
  };

  const loadDebugFlag = () => {
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        return window.sessionStorage.getItem(DEBUG_FLAG_KEY) === '1';
      }
    } catch {
      // ignore storage issues
    }
    return false;
  };

  const persistDebugFlag = (value) => {
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        if (value) {
          window.sessionStorage.setItem(DEBUG_FLAG_KEY, '1');
        } else {
          window.sessionStorage.removeItem(DEBUG_FLAG_KEY);
        }
      }
    } catch {
      // ignore storage issues
    }
  };

  const setDebugMode = (nextActive, options = {}) => {
    const desired = Boolean(nextActive);
    if (debugState.active === desired) {
      return;
    }
    debugState.active = desired;
    persistDebugFlag(desired);
    updateDebugIndicator();
    updateDebugPanel();
    if (typeof document !== 'undefined') {
      if (debugState.active) {
        document.documentElement?.setAttribute('data-clubs-debug', 'active');
      } else {
        document.documentElement?.removeAttribute('data-clubs-debug');
      }
    }
    if (desired && (state.clubs.length || state.filtered.length)) {
      renderResults();
    } else if (!desired && (state.clubs.length || state.filtered.length)) {
      renderResults();
    }
    if (!options.silent) {
      const message = desired ? 'mode debug discret activé.' : 'mode debug discret désactivé.';
      console.info(`${DEBUG_CONSOLE_PREFIX} ${message}`);
    }
  };

  const toggleDebugMode = () => {
    setDebugMode(!debugState.active);
  };

  const isDebugMode = () => debugState.active;

  const describeClubForDebug = (club) => {
    if (!club) {
      return null;
    }
    const lat = Number.parseFloat(club.latitude ?? club.lat);
    const lng = Number.parseFloat(club.longitude ?? club.lng ?? club.lon);
    return {
      id: club.id,
      slug: club.slug,
      name: club.name,
      commune: club.commune,
      latitude: Number.isFinite(lat) ? lat : null,
      longitude: Number.isFinite(lng) ? lng : null,
      source: club.addressStandard || club.address || club.commune || '',
    };
  };

  const findClubByIdentifier = (identifier) => {
    if (!identifier) {
      return null;
    }
    const value = identifier.toString().trim();
    if (!value) {
      return null;
    }
    const lowerValue = value.toLowerCase();
    return (
      state.clubs.find((club) => club.id === value || club.slug === value) ||
      state.clubs.find((club) => club.name && club.name.toLowerCase() === lowerValue) ||
      state.clubs.find((club) => club.slug && club.slug.toLowerCase() === lowerValue)
    );
  };

  const openClubFromDebug = (identifier) => {
    const target = findClubByIdentifier(identifier);
    if (!target) {
      console.warn(`${DEBUG_CONSOLE_PREFIX} Aucun club trouvé pour "${identifier}".`);
      return false;
    }
    openClubDebugView(target);
    return true;
  };

  const debugApi = {
    isActive: () => debugState.active,
    toggle: () => toggleDebugMode(),
    list: () => state.clubs.map((club) => describeClubForDebug(club)),
    open: (identifier) => openClubFromDebug(identifier),
  };

  const registerDebugApi = () => {
    if (typeof window === 'undefined') {
      return;
    }
    if (!window.__e92ClubsFrDebug) {
      Object.defineProperty(window, '__e92ClubsFrDebug', {
        value: debugApi,
        configurable: false,
        enumerable: false,
        writable: false,
      });
    }
  };

  const updateDebugIndicator = () => {
    if (typeof document === 'undefined') {
      return;
    }
    let indicator = document.getElementById(DEBUG_INDICATOR_ID);
    if (!debugState.active) {
      if (indicator) {
        indicator.remove();
      }
      document.documentElement?.removeAttribute('data-clubs-debug');
      return;
    }
    document.documentElement?.setAttribute('data-clubs-debug', 'active');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = DEBUG_INDICATOR_ID;
      indicator.setAttribute('role', 'status');
      indicator.style.position = 'fixed';
      indicator.style.zIndex = '9999';
      indicator.style.top = '12px';
      indicator.style.right = '12px';
      indicator.style.padding = '6px 12px';
      indicator.style.background = 'rgba(220, 53, 69, 0.9)';
      indicator.style.color = '#fff';
      indicator.style.fontSize = '13px';
      indicator.style.fontWeight = '600';
      indicator.style.borderRadius = '999px';
      indicator.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.25)';
      indicator.style.pointerEvents = 'none';
    }
    indicator.textContent = 'Mode debug clubs actif';
    document.body?.appendChild(indicator);
  };


  const updateDebugPanel = () => {
    if (typeof document === 'undefined') {
      return;
    }
    let panel = document.getElementById(DEBUG_PANEL_ID);
    if (!debugState.active) {
      if (panel) {
        panel.remove();
      }
      return;
    }
    if (!panel) {
      panel = document.createElement('aside');
      panel.id = DEBUG_PANEL_ID;
      panel.style.margin = '16px auto';
      panel.style.padding = '12px 16px';
      panel.style.border = '2px dashed #dc3545';
      panel.style.borderRadius = '12px';
      panel.style.maxWidth = '900px';
      panel.style.background = 'rgba(255, 245, 245, 0.92)';
      panel.style.color = '#1f1f1f';
      panel.style.fontSize = '14px';
      panel.style.lineHeight = '1.5';
      panel.style.boxShadow = '0 6px 20px rgba(0, 0, 0, 0.08)';
      panel.style.position = 'relative';
      const anchor = resultsEl?.parentNode;
      if (anchor) {
        anchor.insertBefore(panel, anchor.firstChild);
      } else {
        document.body?.insertBefore(panel, document.body.firstChild || null);
      }
    } else {
      panel.innerHTML = '';
    }
    const title = document.createElement('div');
    title.style.display = 'flex';
    title.style.justifyContent = 'space-between';
    title.style.alignItems = 'center';
    const label = document.createElement('strong');
    label.textContent = 'Mode debug clubs activé';
    title.appendChild(label);
    const exitButton = document.createElement('button');
    exitButton.type = 'button';
    exitButton.textContent = 'Quitter le mode debug';
    exitButton.style.border = '1px solid #dc3545';
    exitButton.style.background = '#fff';
    exitButton.style.color = '#dc3545';
    exitButton.style.borderRadius = '999px';
    exitButton.style.padding = '4px 12px';
    exitButton.style.fontSize = '13px';
    exitButton.style.cursor = 'pointer';
    exitButton.addEventListener('click', () => setDebugMode(false));
    title.appendChild(exitButton);
    panel.appendChild(title);

    const description = document.createElement('p');
    description.textContent =
      'Chaque club affiche maintenant ses coordonnées exactes et un bouton pour ouvrir la carte de contrôle.';
    panel.appendChild(description);

    const instructions = document.createElement('ul');
    instructions.style.paddingLeft = '20px';
    instructions.style.margin = '8px 0 0';
    [
      'Commandes dans la barre de recherche: :debug, :debug+, :debug-, debugfr.',
      'Utilise le bouton "Carte & coords" présent dans chaque bloc club pour vérifier la position.',
      'Boutons de ce panneau pour activer/désactiver le mode sans raccourcis clavier.',
    ].forEach((text) => {
      const item = document.createElement('li');
      item.textContent = text;
      instructions.appendChild(item);
    });
    panel.appendChild(instructions);
  };

  debugState.active = loadDebugFlag();
  if (debugState.active) {
    console.info(`${DEBUG_CONSOLE_PREFIX} mode debug discret actif (session).`);
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        updateDebugIndicator();
        updateDebugPanel();
      });
    } else {
      updateDebugIndicator();
      updateDebugPanel();
    }
  }
  registerDebugApi();

  const parseLicenseValue = (value) => {
    if (value == null || value === '') {
      return 0;
    }
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const getLicenseCount = (club, key) => {
    if (!club) {
      return 0;
    }
    if (key === 'total') {
      if (Number.isFinite(club.totalLicenses)) {
        return club.totalLicenses;
      }
      return getLicenseCount(club, 'A') + getLicenseCount(club, 'B');
    }
    if (!club.licenses) {
      return 0;
    }
    return parseLicenseValue(club.licenses[key]);
  };

  const LICENSE_SORT_CONFIGS = {
    licenses: {
      valueKey: 'total',
      status: 'Clubs triés par nombre de licenciés.',
      counterLabel: 'tri par licenciés',
      metaKey: 'licenses',
      formatBadge: (value) => `${value} lic.`,
    },
    licenseA: {
      valueKey: 'A',
      status: 'Clubs triés par nombre de licences A.',
      counterLabel: 'tri par licences A',
      metaKey: 'licenses_a',
      formatBadge: (value) => `${value} lic. A`,
    },
    licenseB: {
      valueKey: 'B',
      status: 'Clubs triés par nombre de licences B.',
      counterLabel: 'tri par licences B',
      metaKey: 'licenses_b',
      formatBadge: (value) => `${value} lic. B`,
    },
  };

  const getActiveLicenseSort = () => LICENSE_SORT_CONFIGS[state.sortMode] || null;

  let searchRequestId = 0;
  let locationRequestId = 0;
  const geocodeCache = new Map();
  const reverseGeocodeCache = new Map();
  const geocodeStorageKey = `${storageKeyBase}:geocode`;

  const loadGeocodeCache = () => {
    try {
      const raw = window.localStorage.getItem(geocodeStorageKey);
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
      window.localStorage.setItem(geocodeStorageKey, JSON.stringify(obj));
    } catch {
      // ignore
    }
  };

  const initialiseLocationControls = () => {
    [locationInput, locationApplyButton, locationClearButton, geolocButton].forEach((element) => {
      if (element) {
        element.removeAttribute('disabled');
        element.removeAttribute('aria-disabled');
        element.removeAttribute('aria-busy');
        if (element.dataset && element.dataset.label) {
          delete element.dataset.label;
        }
      }
    });
    if (optionsDetails) {
      optionsDetails.removeAttribute('aria-hidden');
    }
    setLocationStatus('', 'info');
  };

  const bindMapCtaNavigation = () => {
    if (!mapCtaLink) {
      return;
    }
    const handleIntent = (event) => {
      if (event.type === 'auxclick' && event.button !== 1) {
        return;
      }
      const isPrimaryClick =
        event.type === 'click' && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
      persistListState();
      persistListUiState();
      if (isPrimaryClick) {
        markShouldRestoreUiState();
        if (mobileResultsOpen) {
          markShouldReopenResults();
        }
      }
      rememberClubsNavigation('map:from-list', listPath);
    };
    mapCtaLink.addEventListener('click', handleIntent);
    mapCtaLink.addEventListener('auxclick', handleIntent);
  };

  const notifyMapFocus = (detail) => {
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') {
      return;
    }
    try {
      window.dispatchEvent(new CustomEvent('clubs:focus-location', { detail }));
    } catch (error) {
      // ignore dispatch errors
    }
  };

  const setSearchStatus = (message, tone = 'info') => {
    state.statusMessage = message || '';
    updateTotalCounter();
  };

  let mapFocusQueue = null;
  const queueMapFocus = (detail, requestId = null) => {
    if (!detail) {
      mapFocusQueue = null;
      return;
    }
    mapFocusQueue = { detail, requestId: Number.isFinite(requestId) ? requestId : null };
  };

  const flushQueuedMapFocus = (requestId = null) => {
    if (!mapFocusQueue) {
      return;
    }
    const hasRequestGuard = mapFocusQueue.requestId != null && requestId != null;
    if (hasRequestGuard && mapFocusQueue.requestId !== requestId) {
      return;
    }
    notifyMapFocus(mapFocusQueue.detail);
    mapFocusQueue = null;
  };

  const shouldAnimateFocus = () => !isMobileViewport() && !state.restoreMode && !suppressFocusAnimation;

  const toggleGeolocErrorLayout = (active) => {
    if (!clubsPageShell) {
      return;
    }
    if (active) {
      clubsPageShell.classList.add('has-geoloc-error');
    } else {
      clubsPageShell.classList.remove('has-geoloc-error');
    }
  };

  const setStatusNode = (node, message, tone) => {
    if (!node) {
      return;
    }
    node.textContent = message || '';
    if (message) {
      node.dataset.tone = tone;
    } else if (node.dataset && node.dataset.tone) {
      delete node.dataset.tone;
    }
  };

  const setLocationStatus = (message, tone = 'info') => {
    state.locationMessage = message || '';
    setStatusNode(locationStatus, message, tone);
    setStatusNode(geolocStatus, message, tone);
    toggleGeolocErrorLayout(Boolean(message && tone === 'error'));
    updateTotalCounter();
  };

  const clearSearchQuery = (options = {}) => {
    const silent = Boolean(options.silent);
    const keepInput = Boolean(options.keepInput);
    state.query = '';
    state.pendingQuery = '';
    if (searchInput && !keepInput) {
      searchInput.value = '';
    }
    updateClearButtons();
    if (!silent) {
      setSearchStatus('Tous les clubs sont affichés.', 'info');
    }
  };

  const LEGACY_EASTER_EGG = (() => {
    if (typeof document === 'undefined') {
      return { trigger: '', alias: '', href: '', text: '', issueUrl: '', issueChallengeUrl: '', consumeUrl: '' };
    }
    const runtime =
      typeof window !== 'undefined' &&
      window.CDJE92_EASTER_EGG &&
      typeof window.CDJE92_EASTER_EGG === 'object'
        ? window.CDJE92_EASTER_EGG
        : {};
    const dataset = document.currentScript && document.currentScript.dataset ? document.currentScript.dataset : {};
    const runtimeTrigger = typeof runtime.trigger === 'string' ? runtime.trigger.trim().toLowerCase() : '';
    const runtimeAlias = typeof runtime.alias === 'string' ? runtime.alias.trim().toLowerCase() : '';
    const runtimeHref = typeof runtime.href === 'string' ? runtime.href.trim() : '';
    const runtimeText = typeof runtime.text === 'string' ? runtime.text.trim() : '';
    const runtimeIssueUrl = typeof runtime.issueUrl === 'string' ? runtime.issueUrl.trim() : '';
    const runtimeIssueChallengeUrl =
      typeof runtime.issueChallengeUrl === 'string' ? runtime.issueChallengeUrl.trim() : '';
    const runtimeConsumeUrl = typeof runtime.consumeUrl === 'string' ? runtime.consumeUrl.trim() : '';
    const trigger = runtimeTrigger || (typeof dataset.easterEggTrigger === 'string' ? dataset.easterEggTrigger.trim().toLowerCase() : '');
    const alias = runtimeAlias || (typeof dataset.easterEggAlias === 'string' ? dataset.easterEggAlias.trim().toLowerCase() : '');
    const href = runtimeHref || (typeof dataset.easterEggHref === 'string' ? dataset.easterEggHref.trim() : '');
    const text = runtimeText || (typeof dataset.easterEggText === 'string' ? dataset.easterEggText.trim() : '');
    const issueUrl = runtimeIssueUrl || '';
    const issueChallengeUrl = runtimeIssueChallengeUrl || '';
    const consumeUrl = runtimeConsumeUrl || '';
    return { trigger, alias, href, text, issueUrl, issueChallengeUrl, consumeUrl };
  })();
  const LEGACY_EASTER_EGG_COMMANDS = new Set(
    [LEGACY_EASTER_EGG.trigger, LEGACY_EASTER_EGG.alias, CINEMA_ALLOWED_ALIAS].filter(
      (value) => typeof value === 'string' && value.trim() !== ''
    )
  );

  const MATHIS_EGG_API = (() => {
    if (LEGACY_EASTER_EGG.issueUrl) {
      return LEGACY_EASTER_EGG.issueUrl;
    }
    const isLocalhost =
      typeof window !== 'undefined' &&
      /^(localhost|127(?:\.\d{1,3}){3})$/i.test(window.location.hostname || '');
    if (!isLocalhost || !LEGACY_EASTER_EGG.href) {
      return '';
    }
    try {
      return new URL('/api/egg/new', LEGACY_EASTER_EGG.href).toString();
    } catch (error) {
      return '';
    }
  })();
  const MATHIS_EGG_CHALLENGE_API = LEGACY_EASTER_EGG.issueChallengeUrl || '';
  const IS_MATHIS_EGG_API_SAME_ORIGIN = (() => {
    if (!MATHIS_EGG_API || typeof window === 'undefined') {
      return false;
    }
    try {
      const target = new URL(MATHIS_EGG_API, window.location.href);
      return target.origin === window.location.origin;
    } catch (error) {
      return false;
    }
  })();

  const MATHIS_TAKEOVER_ID = 'mathis-takeover';
  const MATHIS_LINK_TEXT = LEGACY_EASTER_EGG.text;
  const MATHIS_DIRECT_HREF = (LEGACY_EASTER_EGG.href || '').trim() || 'https://mathisboche.com';
  const MATHIS_SUBTLE_SUFFIX_START_INDEX = (() => {
    const value = (MATHIS_LINK_TEXT || '').toLowerCase();
    const index = value.lastIndexOf('.com');
    return index >= 0 ? index : -1;
  })();
  const MATHIS_REVEAL_DELAY = 650;
  const MATHIS_EGG_MIN_VALIDITY_MS = 2 * 1000;
  const MATHIS_EGG_REFRESH_MARGIN_MS = 15 * 1000;
  const MATHIS_EGG_REFRESH_RETRY_MS = 5 * 1000;
  let mathisSequenceActive = false;
  let mathisEggPending = false;
  let mathisEggCache = null;
  let mathisEggPrefetchPromise = null;
  let mathisEggRefreshTimer = null;
  let mathisCollapsedTargets = [];
  let mathisExitStarted = false;
  let mathisFragmentsPrepared = false;
  let mathisScrollPosition = 0;
  const MATHIS_VIEWPORT_MARGIN_DESKTOP = 520;
  const MATHIS_VIEWPORT_MARGIN_MOBILE = 320;
  const MATHIS_MAX_TARGETS_DESKTOP = 900;
  const MATHIS_MAX_TARGETS_MOBILE = 380;
  const MATHIS_MAX_TARGETS_LOW_POWER = 560;
  const MATHIS_MAX_FRAGMENTS_DESKTOP = 1400;
  const MATHIS_MAX_FRAGMENTS_MOBILE = 760;
  const MATHIS_MAX_FRAGMENTS_LOW_POWER = 460;
  let mathisRectCache = null;

  const resetMathisRectCache = () => {
    mathisRectCache = typeof WeakMap === 'function' ? new WeakMap() : null;
  };

  const clearMathisEggRefreshTimer = () => {
    if (!mathisEggRefreshTimer || typeof window === 'undefined') {
      mathisEggRefreshTimer = null;
      return;
    }
    window.clearTimeout(mathisEggRefreshTimer);
    mathisEggRefreshTimer = null;
  };

  const mathisSha256Hex = async (input) => {
    if (!crypto?.subtle) {
      throw new Error('WebCrypto unavailable');
    }
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    return Array.from(new Uint8Array(hash))
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');
  };

  const mathisHasLeadingZeroBits = (hexDigest, difficultyBits) => {
    if (!/^[a-f0-9]{64}$/.test(hexDigest)) {
      return false;
    }
    if (!Number.isFinite(difficultyBits) || difficultyBits < 0 || difficultyBits > 256) {
      return false;
    }
    const fullNibbles = Math.floor(difficultyBits / 4);
    const remainingBits = difficultyBits % 4;
    if (fullNibbles > 0 && hexDigest.slice(0, fullNibbles) !== '0'.repeat(fullNibbles)) {
      return false;
    }
    if (remainingBits === 0) {
      return true;
    }
    const nibble = Number.parseInt(hexDigest.charAt(fullNibbles) || '0', 16);
    if (!Number.isFinite(nibble)) {
      return false;
    }
    return nibble < 1 << (4 - remainingBits);
  };

  const solveMathisPow = async (challenge, difficulty) => {
    if (!/^[A-Za-z0-9\-_]{16,128}$/.test(challenge)) {
      throw new Error('Invalid challenge');
    }

    const maxAttempts = 2_000_000;
    for (let counter = 0; counter < maxAttempts; counter += 1) {
      const digest = await mathisSha256Hex(`${challenge}:${counter}`);
      if (mathisHasLeadingZeroBits(digest, difficulty)) {
        return { counter, digest };
      }
      if (counter > 0 && counter % 900 === 0) {
        await new Promise((resolve) => {
          window.setTimeout(resolve, 0);
        });
      }
    }

    throw new Error('PoW not solved');
  };

  const requestMathisEggUrl = async () => {
    if (!MATHIS_EGG_API) {
      throw new Error('Missing Mathis egg API URL');
    }
    const requestOptions = {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    };
    if (IS_MATHIS_EGG_API_SAME_ORIGIN) {
      requestOptions.credentials = 'same-origin';
    } else {
      requestOptions.mode = 'cors';
    }
    if (MATHIS_EGG_CHALLENGE_API) {
      const challengeResponse = await fetch(MATHIS_EGG_CHALLENGE_API, requestOptions);
      if (!challengeResponse.ok) {
        throw new Error(`Mathis egg challenge error (${challengeResponse.status})`);
      }
      const challengePayload = await challengeResponse.json().catch(() => null);
      if (
        !challengePayload ||
        typeof challengePayload.challenge !== 'string' ||
        !Number.isFinite(challengePayload.difficulty)
      ) {
        throw new Error('Invalid Mathis egg challenge payload');
      }
      const proof = await solveMathisPow(
        challengePayload.challenge,
        Math.max(0, Number(challengePayload.difficulty))
      );
      requestOptions.body = JSON.stringify({
        challenge: challengePayload.challenge,
        counter: String(proof.counter),
        digest: proof.digest,
      });
    }
    const response = await fetch(MATHIS_EGG_API, requestOptions);
    if (!response.ok) {
      throw new Error(`Mathis egg API error (${response.status})`);
    }
    const payload = await response.json().catch(() => null);
    if (!payload || typeof payload.url !== 'string') {
      throw new Error('Invalid Mathis egg API payload');
    }
    const expiresIn = Number.isFinite(payload.expiresIn) ? payload.expiresIn : 60;
    return {
      url: payload.url,
      expiresAt: Date.now() + Math.max(1, expiresIn) * 1000,
    };
  };

  const getCachedMathisEggUrl = () => {
    if (!mathisEggCache) {
      return '';
    }
    // Avoid opening a token close to expiry (navigation + redirects can take time).
    if (Date.now() > mathisEggCache.expiresAt - MATHIS_EGG_MIN_VALIDITY_MS) {
      mathisEggCache = null;
      clearMathisEggRefreshTimer();
      return '';
    }
    return mathisEggCache.url;
  };

  const scheduleMathisEggRefresh = () => {
    clearMathisEggRefreshTimer();
    if (!mathisSequenceActive || !mathisEggCache || typeof window === 'undefined') {
      return;
    }
    const delay = Math.max(1000, mathisEggCache.expiresAt - Date.now() - MATHIS_EGG_REFRESH_MARGIN_MS);
    mathisEggRefreshTimer = window.setTimeout(() => {
      mathisEggRefreshTimer = null;
      if (!mathisSequenceActive) {
        return;
      }
      prefetchMathisEggUrl({ force: true }).catch(() => {
        if (!mathisSequenceActive || typeof window === 'undefined') {
          return;
        }
        clearMathisEggRefreshTimer();
        mathisEggRefreshTimer = window.setTimeout(function retryRefresh() {
          mathisEggRefreshTimer = null;
          if (!mathisSequenceActive) {
            return;
          }
          prefetchMathisEggUrl({ force: true }).catch(() => {
            if (!mathisSequenceActive || typeof window === 'undefined') {
              return;
            }
            clearMathisEggRefreshTimer();
            mathisEggRefreshTimer = window.setTimeout(retryRefresh, MATHIS_EGG_REFRESH_RETRY_MS);
          });
        }, MATHIS_EGG_REFRESH_RETRY_MS);
      });
    }, delay);
  };

  const prefetchMathisEggUrl = (options = {}) => {
    const force = Boolean(options.force);
    const cached = force ? '' : getCachedMathisEggUrl();
    if (cached) {
      return Promise.resolve(cached);
    }
    if (mathisEggPrefetchPromise) {
      return mathisEggPrefetchPromise;
    }
    mathisEggPrefetchPromise = requestMathisEggUrl()
      .then((payload) => {
        mathisEggCache = payload;
        scheduleMathisEggRefresh();
        return payload.url;
      })
      .finally(() => {
        mathisEggPrefetchPromise = null;
      });
    return mathisEggPrefetchPromise;
  };

  const ensureMathisEggHandler = (anchor) => {
    if (!anchor) {
      return;
    }
    if (anchor.dataset && anchor.dataset.mathisEggBound === '1') {
      return;
    }
    if (anchor.dataset) {
      anchor.dataset.mathisEggBound = '1';
    }
    anchor.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === 'function') {
        event.stopImmediatePropagation();
      }
      if (mathisEggPending) {
        return;
      }
      mathisEggPending = true;

      if (MATHIS_DIRECT_HREF) {
        const popup = window.open(MATHIS_DIRECT_HREF, '_blank', 'noopener');
        if (popup) {
          try {
            popup.opener = null;
          } catch (error) {
            // noop
          }
          const overlay = anchor.closest(`#${MATHIS_TAKEOVER_ID}`);
          if (overlay) {
            resetMathisSourcePage();
          }
        } else {
          setSearchStatus("Autorise les popups pour ouvrir le lien secret.", 'error');
        }
        mathisEggPending = false;
        return;
      }

      const cachedUrl = getCachedMathisEggUrl();
      if (cachedUrl) {
        // Consume the cached token locally (it is one-time on the server anyway).
        mathisEggCache = null;
        clearMathisEggRefreshTimer();
        if (mathisSequenceActive) {
          prefetchMathisEggUrl().catch(() => {
            // On failure, click fallback still forces a fresh token.
          });
        }
        const popup = window.open(cachedUrl, '_blank', 'noopener');
        if (popup) {
          try {
            popup.opener = null;
          } catch (error) {
            // noop
          }
          const overlay = anchor.closest(`#${MATHIS_TAKEOVER_ID}`);
          if (overlay) {
            resetMathisSourcePage();
          }
        } else {
          setSearchStatus("Autorise les popups pour ouvrir le lien secret.", 'error');
        }
        mathisEggPending = false;
        return;
      }

      prefetchMathisEggUrl({ force: true })
        .then((url) => {
          // Token is consumed right away by this navigation.
          mathisEggCache = null;
          clearMathisEggRefreshTimer();
          if (mathisSequenceActive) {
            prefetchMathisEggUrl().catch(() => {
              // keep best effort behavior
            });
          }
          const popup = window.open(url, '_blank', 'noopener');
          if (popup) {
            try {
              popup.opener = null;
            } catch (error) {
              // noop
            }
            const overlay = anchor.closest(`#${MATHIS_TAKEOVER_ID}`);
            if (overlay) {
              resetMathisSourcePage();
            }
          } else {
            setSearchStatus("Autorise les popups pour ouvrir le lien secret.", 'error');
          }
        })
        .catch((error) => {
          setSearchStatus("Impossible d'ouvrir le lien secret pour le moment.", 'error');
        })
        .finally(() => {
          mathisEggPending = false;
        });
    });
  };

  const isMathisMobileSafari = () => {
    if (typeof navigator === 'undefined') {
      return false;
    }
    const ua = navigator.userAgent || '';
    const isIOS = /iP(ad|hone|od)/.test(ua);
    const isSafari = /Safari/i.test(ua) && !/(Chrome|CriOS|FxiOS|EdgiOS|OPiOS)/i.test(ua);
    return isIOS && isSafari;
  };

  const isMathisLowPowerDevice = () => {
    if (typeof navigator === 'undefined') {
      return false;
    }
    const cores = Number.parseInt(String(navigator.hardwareConcurrency || ''), 10);
    const memory = Number.parseFloat(String(navigator.deviceMemory || ''));
    const lowCoreCount = Number.isFinite(cores) && cores > 0 && cores <= 4;
    const lowMemory = Number.isFinite(memory) && memory > 0 && memory <= 4;
    return lowCoreCount || lowMemory;
  };

  const getMathisPerfProfile = () => {
    const constrained = isMobileViewport() || isMathisMobileSafari();
    const lowPower = isMathisLowPowerDevice();
    let viewportMargin = constrained ? MATHIS_VIEWPORT_MARGIN_MOBILE : MATHIS_VIEWPORT_MARGIN_DESKTOP;
    let targetLimit = constrained ? MATHIS_MAX_TARGETS_MOBILE : MATHIS_MAX_TARGETS_DESKTOP;
    let fragmentLimit = constrained ? MATHIS_MAX_FRAGMENTS_MOBILE : MATHIS_MAX_FRAGMENTS_DESKTOP;
    if (lowPower) {
      viewportMargin = Math.min(viewportMargin, constrained ? 260 : 380);
      targetLimit = Math.min(targetLimit, MATHIS_MAX_TARGETS_LOW_POWER);
      fragmentLimit = Math.min(fragmentLimit, MATHIS_MAX_FRAGMENTS_LOW_POWER);
    }
    return {
      viewportMargin,
      targetLimit,
      fragmentLimit,
      enableFragments: !lowPower,
    };
  };

  const isMathisElementNearViewport = (element, viewportMargin) => {
    if (!element || typeof element.getBoundingClientRect !== 'function' || typeof window === 'undefined') {
      return false;
    }
    const cache = mathisRectCache;
    if (cache && cache.has(element)) {
      return cache.get(element);
    }
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const rect = element.getBoundingClientRect();
    const isNear = rect.bottom >= -viewportMargin && rect.top <= viewportHeight + viewportMargin;
    if (cache) {
      cache.set(element, isNear);
    }
    return isNear;
  };

  const lockMathisScroll = () => {
    if (typeof window === 'undefined' || typeof document === 'undefined' || !document.body) {
      return;
    }
    mathisScrollPosition = window.scrollY || document.documentElement.scrollTop || 0;
    document.documentElement.classList.add('mathis-scroll-lock');
    document.body.classList.add('mathis-mode');
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';
    document.body.style.top = `-${mathisScrollPosition}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
  };

  const unlockMathisScroll = () => {
    if (typeof document === 'undefined' || !document.body) {
      return;
    }
    document.documentElement.classList.remove('mathis-scroll-lock');
    document.body.classList.remove('mathis-mode');
    document.body.style.removeProperty('position');
    document.body.style.removeProperty('width');
    document.body.style.removeProperty('top');
    document.body.style.removeProperty('left');
    document.body.style.removeProperty('right');
    if (typeof window !== 'undefined') {
      window.scrollTo(0, mathisScrollPosition || 0);
    }
  };

  const shuffleArray = (input) => {
    const array = input.slice();
    for (let i = array.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  };

  const getMathisElementDepth = (element) => {
    let depth = 0;
    let current = element ? element.parentElement : null;
    while (current && current !== document.body) {
      depth += 1;
      current = current.parentElement;
    }
    return depth;
  };

  const prepareMathisFragments = (overlayElement, options = {}) => {
    if (options.enableFragments === false) {
      return;
    }
    if (mathisFragmentsPrepared || typeof document === 'undefined' || !document.body) {
      return;
    }
    const overlayHost = overlayElement || document.getElementById(MATHIS_TAKEOVER_ID);
    const viewportMargin = Number.isFinite(options.viewportMargin) ? options.viewportMargin : MATHIS_VIEWPORT_MARGIN_DESKTOP;
    const fragmentLimit = Number.isFinite(options.fragmentLimit) ? options.fragmentLimit : MATHIS_MAX_FRAGMENTS_DESKTOP;
    let fragmentCount = 0;
    const isFlexibleContext = (element) => {
      if (!element || typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') {
        return false;
      }
      try {
        const display = window.getComputedStyle(element).display || '';
        return display.includes('flex') || display.includes('grid');
      } catch (error) {
        return false;
      }
    };
    const TEXT_NODE = 3;
    const ELEMENT_NODE = 1;
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const nodesToProcess = [];
    const visitNode = (node) => {
      if (!node || !node.childNodes || (fragmentLimit && fragmentCount >= fragmentLimit)) {
        return;
      }
      Array.from(node.childNodes).forEach((child) => {
        if (!child) {
          return;
        }
        if (child.nodeType === TEXT_NODE) {
          const parentElement = child.parentElement;
          const textValue = child.textContent || '';
          if (
            !parentElement ||
            !textValue.replace(/\u00a0/g, ' ').trim() ||
            parentElement.closest('script, style, noscript, textarea, option, select, optgroup') ||
            parentElement.namespaceURI === SVG_NS
          ) {
            return;
          }
          if (overlayHost && (parentElement === overlayHost || parentElement.closest(`#${MATHIS_TAKEOVER_ID}`))) {
            return;
          }
          if (!isMathisElementNearViewport(parentElement, viewportMargin)) {
            return;
          }
          if (isFlexibleContext(parentElement)) {
            return;
          }
          nodesToProcess.push(child);
        } else if (child.nodeType === ELEMENT_NODE) {
          const tagName = child.tagName ? child.tagName.toUpperCase() : '';
          if (!tagName) {
            return;
          }
          if (
            tagName === 'SCRIPT' ||
            tagName === 'STYLE' ||
            tagName === 'NOSCRIPT' ||
            tagName === 'TEXTAREA' ||
            tagName === 'OPTION' ||
            tagName === 'OPTGROUP' ||
            tagName === 'SELECT'
          ) {
            return;
          }
          if (child.namespaceURI === SVG_NS) {
            return;
          }
          if (overlayHost && (child === overlayHost || child.closest(`#${MATHIS_TAKEOVER_ID}`))) {
            return;
          }
          if (!isMathisElementNearViewport(child, viewportMargin)) {
            return;
          }
          visitNode(child);
        }
      });
    };
    visitNode(document.body);
    nodesToProcess.forEach((textNode) => {
      if (fragmentLimit && fragmentCount >= fragmentLimit) {
        return;
      }
      const parent = textNode.parentElement;
      if (!parent) {
        return;
      }
      const fragment = document.createDocumentFragment();
      const parts = (textNode.textContent || '').split(/(\s+)/);
      parts.forEach((part) => {
        if (!part) {
          return;
        }
        if (/^\s+$/.test(part) || (fragmentLimit && fragmentCount >= fragmentLimit)) {
          fragment.appendChild(document.createTextNode(part));
        } else {
          const span = document.createElement('span');
          span.className = 'mathis-fragment';
          span.textContent = part;
          fragment.appendChild(span);
          fragmentCount += 1;
        }
      });
      parent.replaceChild(fragment, textNode);
    });
    mathisFragmentsPrepared = true;
  };

  const cleanupMathisFragments = () => {
    if (!mathisFragmentsPrepared || typeof document === 'undefined') {
      return;
    }
    const fragments = document.querySelectorAll('.mathis-fragment');
    fragments.forEach((fragment) => {
      if (!fragment || fragment.closest(`#${MATHIS_TAKEOVER_ID}`)) {
        return;
      }
      const parent = fragment.parentNode;
      if (!parent) {
        return;
      }
      const textContent = fragment.textContent || '';
      const textNode = document.createTextNode(textContent);
      parent.replaceChild(textNode, fragment);
      if (typeof parent.normalize === 'function') {
        parent.normalize();
      }
    });
    mathisFragmentsPrepared = false;
  };

  const gatherMathisFallbackContainers = () => {
    if (typeof document === 'undefined') {
      return [];
    }
    const selectors = [
      'body > *:not(script):not(style):not(noscript)',
      '.cm-header',
      '.cm-nav-desktop',
      '.cm-nav-mobile',
      '.clubs-page > *',
      '.clubs-results-wrapper > *',
      '.clubs-list > *',
      '.clubs-options',
      '.clubs-search-block',
      '.club-row',
    ];
    const collection = new Set();
    selectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((node) => {
        if (!node || node.id === MATHIS_TAKEOVER_ID) {
          return;
        }
        if (node.closest(`#${MATHIS_TAKEOVER_ID}`)) {
          return;
        }
        collection.add(node);
      });
    });
    const rawTargets = Array.from(collection).filter((element) => element && element !== document.body && element !== document.documentElement);
    const filteredTargets = rawTargets.filter(
      (element, index, array) => !array.some((other, otherIndex) => otherIndex !== index && other.contains(element))
    );
    return filteredTargets.sort((a, b) => getMathisElementDepth(b) - getMathisElementDepth(a));
  };

  const getMathisRestoreOrder = () => {
    if (!mathisCollapsedTargets.length) {
      return [];
    }
    const buckets = new Map();
    mathisCollapsedTargets.forEach((element) => {
      if (!element) {
        return;
      }
      const depth = getMathisElementDepth(element);
      if (!buckets.has(depth)) {
        buckets.set(depth, []);
      }
      buckets.get(depth).push(element);
    });
    const ordered = [];
    Array.from(buckets.keys())
      .sort((a, b) => a - b)
      .forEach((depth) => {
        const batch = buckets.get(depth);
        if (batch && batch.length) {
          shuffleArray(batch).forEach((element) => ordered.push(element));
        }
      });
    return ordered;
  };

  const restoreMathisTargets = () => {
    if (!mathisCollapsedTargets.length) {
      return;
    }
    mathisCollapsedTargets.forEach((element) => {
      element.classList.remove('mathis-collapse-target', 'is-mathis-collapsing');
      const previousVisibility = element.dataset.mathisPrevVisibility;
      if (typeof previousVisibility !== 'undefined') {
        element.style.visibility = previousVisibility;
        delete element.dataset.mathisPrevVisibility;
      } else if (element.style.visibility === 'hidden') {
        element.style.visibility = '';
      }
      element.removeAttribute('data-mathis-hidden');
      element.style.removeProperty('--mathis-dx');
      element.style.removeProperty('--mathis-dy');
    });
    mathisCollapsedTargets = [];
  };

  const restoreMathisTargetsSequential = () => {
    if (!mathisCollapsedTargets.length) {
      return Promise.resolve();
    }
    const order = getMathisRestoreOrder();
    if (!order.length) {
      mathisCollapsedTargets = [];
      return Promise.resolve();
    }
    const timelineWindow = Math.min(3000, 900 + order.length * 1.6);
    return new Promise((resolve) => {
      let restoredCount = 0;
      order.forEach((element, index) => {
        const progress = order.length > 1 ? index / (order.length - 1) : 0;
        const delay = progress * timelineWindow + Math.random() * 70;
        window.setTimeout(() => {
          const previousVisibility = element.dataset.mathisPrevVisibility;
          if (typeof previousVisibility !== 'undefined') {
            element.style.visibility = previousVisibility;
            delete element.dataset.mathisPrevVisibility;
          } else if (element.style.visibility === 'hidden') {
            element.style.visibility = '';
          }
          element.removeAttribute('data-mathis-hidden');
          element.classList.remove('is-mathis-collapsing');
          element.classList.add('is-mathis-restoring');
          requestAnimationFrame(() => {
            element.classList.remove('is-mathis-restoring');
          });
          window.setTimeout(() => {
            element.classList.remove('mathis-collapse-target');
            element.style.removeProperty('--mathis-dx');
            element.style.removeProperty('--mathis-dy');
            restoredCount += 1;
            if (restoredCount === order.length) {
              mathisCollapsedTargets = [];
              resolve();
            }
          }, 420);
        }, delay);
      });
    });
  };

  const endMathisTakeover = (options = {}) => {
    mathisSequenceActive = false;
    mathisExitStarted = false;
    mathisEggPending = false;
    mathisEggCache = null;
    clearMathisEggRefreshTimer();
    const overlay = document.getElementById(MATHIS_TAKEOVER_ID);
    const syncAfterMathis = () => {
      if (searchInput) {
        searchInput.value = '';
      }
      closeLocationSuggestions({ preserveRequestId: false });
      updateClearButtons();
    };
    const finish = () => {
      overlay?.remove();
      if (!options.skipRestore) {
        restoreMathisTargets();
      }
      cleanupMathisFragments();
      unlockMathisScroll();
      syncAfterMathis();
      if (typeof window !== 'undefined') {
        if (typeof window.requestAnimationFrame === 'function') {
          window.requestAnimationFrame(syncAfterMathis);
        }
        window.setTimeout(syncAfterMathis, 120);
      }
      if (!options.silent) {
        setSearchStatus('Retour à la réalité des clubs français.', 'info');
      }
    };
    if (overlay) {
      if (options.immediate) {
        finish();
        return;
      }
      overlay.classList.add('is-ending');
      window.setTimeout(finish, 600);
    } else {
      finish();
    }
  };

  const resetMathisSourcePage = () => {
    endMathisTakeover({ silent: true, immediate: true });
    if (typeof window === 'undefined') {
      return;
    }
    let targetPath = '/clubs-92';
    if (IG_CINEMA_ENTRY && typeof IG_CINEMA_ENTRY.cleanPath === 'string' && IG_CINEMA_ENTRY.cleanPath.trim()) {
      targetPath = IG_CINEMA_ENTRY.cleanPath.trim();
    }
    if (!targetPath.startsWith('/')) {
      targetPath = `/${targetPath}`;
    }
    try {
      window.location.replace(targetPath);
    } catch (error) {
      window.location.reload();
    }
  };

  const buildMathisTakeoverOverlay = () => {
    if (typeof document === 'undefined') {
      return null;
    }
    const overlay = document.createElement('div');
    overlay.id = MATHIS_TAKEOVER_ID;
    overlay.className = 'mathis-clean';
    overlay.setAttribute('role', 'presentation');
    overlay.setAttribute('tabindex', '-1');
    overlay.innerHTML = `
      <button class="mathis-clean__close" type="button" aria-label="Fermer l'effet visuel">
        <span></span>
        <span></span>
      </button>
      <div class="mathis-clean__link">
        <a class="mathis-clean__anchor" href="#">
          <span class="mathis-clean__letters" aria-hidden="true"></span>
          <span class="mathis-clean__sr">${MATHIS_LINK_TEXT}</span>
        </a>
      </div>
    `;
    return overlay;
  };

  const gatherMathisTargets = (options = {}) => {
    if (typeof document === 'undefined' || !document.body) {
      return [];
    }
    const overlay = document.getElementById(MATHIS_TAKEOVER_ID);
    const viewportMargin = Number.isFinite(options.viewportMargin) ? options.viewportMargin : MATHIS_VIEWPORT_MARGIN_DESKTOP;
    const targetLimit = Number.isFinite(options.targetLimit) ? options.targetLimit : MATHIS_MAX_TARGETS_DESKTOP;
    const targetBudget = targetLimit > 0 ? targetLimit : Number.POSITIVE_INFINITY;
    const blockedTags = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'LINK', 'META', 'HEAD', 'TITLE', 'HTML', 'BODY', 'TEMPLATE']);
    const preferredSelectors = [
      'p',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'li',
      'blockquote',
      'pre',
      'code',
      'figure',
      'figcaption',
      'dt',
      'dd',
      'table',
      'thead',
      'tbody',
      'tfoot',
      'tr',
      'th',
      'td',
      '.club-row',
      '.club-card',
      '.clubs-options *',
      '.clubs-search-block *',
      '.cm-header *',
      '.cm-footer *',
      'a',
      'button',
      'label',
      'input',
      'textarea',
      'select',
      'option',
      'summary',
      'details',
      'img',
      'picture',
      'video',
      'audio',
      'svg',
      'canvas',
      'iframe',
    ]
      .map((selector) => selector.trim())
      .filter(Boolean)
      .join(', ');
    const buckets = new Map();
    const registerElement = (element) => {
      if (!element) {
        return;
      }
      const depth = getMathisElementDepth(element);
      if (!buckets.has(depth)) {
        buckets.set(depth, []);
      }
      buckets.get(depth).push(element);
    };
    const allElements = Array.from(document.body.querySelectorAll('*'));
    allElements.forEach((element) => {
      if (!element) {
        return;
      }
      if (element === overlay || element.closest(`#${MATHIS_TAKEOVER_ID}`)) {
        return;
      }
      const tagName = element.tagName ? element.tagName.toUpperCase() : '';
      if (!tagName || blockedTags.has(tagName)) {
        return;
      }
      const svgAncestor = element.closest('svg');
      if (svgAncestor && svgAncestor !== element) {
        return;
      }
      if (!isMathisElementNearViewport(element, viewportMargin)) {
        return;
      }
      const isLeaf = element.childElementCount === 0;
      const isPreferred = preferredSelectors ? element.matches(preferredSelectors) : false;
      if (isLeaf || isPreferred) {
        registerElement(element);
      }
    });
    const seen = new Set();
    const orderedTargets = [];
    const sortedDepths = Array.from(buckets.keys()).sort((a, b) => b - a);
    sortedDepths.some((depth) => {
      const bucket = shuffleArray(buckets.get(depth));
      for (let index = 0; index < bucket.length; index += 1) {
        const element = bucket[index];
        if (!seen.has(element)) {
          seen.add(element);
          orderedTargets.push(element);
          if (orderedTargets.length >= targetBudget) {
            return true;
          }
        }
      }
      return false;
    });
    if (orderedTargets.length < targetBudget) {
      gatherMathisFallbackContainers().forEach((element) => {
        if (orderedTargets.length >= targetBudget) {
          return;
        }
        if (!seen.has(element) && isMathisElementNearViewport(element, viewportMargin)) {
          seen.add(element);
          orderedTargets.push(element);
        }
      });
    }
    if (orderedTargets.length >= targetBudget) {
      return orderedTargets.slice(0, targetBudget);
    }
    const leftovers = [];
    allElements.forEach((element) => {
      if (!element || seen.has(element)) {
        return;
      }
      if (element === overlay || element.closest(`#${MATHIS_TAKEOVER_ID}`)) {
        return;
      }
      const tagName = element.tagName ? element.tagName.toUpperCase() : '';
      if (!tagName || blockedTags.has(tagName)) {
        return;
      }
      if (!isMathisElementNearViewport(element, viewportMargin)) {
        return;
      }
      leftovers.push({ element, depth: getMathisElementDepth(element) });
    });
    leftovers
      .sort((a, b) => b.depth - a.depth)
      .forEach(({ element }) => {
        if (!seen.has(element)) {
          seen.add(element);
          orderedTargets.push(element);
        }
      });
    if (orderedTargets.length) {
      return orderedTargets.slice(0, targetBudget);
    }
    return Array.from(document.body.children)
      .filter((element) => element.tagName !== 'SCRIPT' && element.tagName !== 'STYLE' && element.id !== MATHIS_TAKEOVER_ID)
      .slice(0, targetBudget);
  };

  const collapseMathisTargets = (targets) => {
    const valid = targets.filter(Boolean);
    if (!valid.length) {
      return Promise.resolve();
    }
    const order = valid.slice();
    mathisCollapsedTargets = order.slice();
    const timelineWindow = Math.min(3600, 1100 + order.length * 1.9);
    return new Promise((resolve) => {
      let completed = 0;
      order.forEach((element, index) => {
        const progress = order.length > 1 ? index / (order.length - 1) : 0;
        const startDelay = progress * timelineWindow + Math.random() * 90;
        window.setTimeout(() => {
          if (!mathisSequenceActive) {
            completed += 1;
            if (completed === order.length) {
              resolve();
            }
            return;
          }
          element.classList.add('mathis-collapse-target');
          const dx = (Math.random() * 40 - 20).toFixed(2);
          const dy = (Math.random() * 50 + 20).toFixed(2);
          element.style.setProperty('--mathis-dx', `${dx}px`);
          element.style.setProperty('--mathis-dy', `${dy}px`);
          requestAnimationFrame(() => {
            element.classList.add('is-mathis-collapsing');
          });
          const hideDelay = 280 + Math.random() * 140;
          window.setTimeout(() => {
            if (!mathisSequenceActive) {
              completed += 1;
              if (completed === order.length) {
                resolve();
              }
              return;
            }
            if (typeof element.dataset.mathisPrevVisibility === 'undefined') {
              element.dataset.mathisPrevVisibility = element.style.visibility || '';
            }
            element.style.visibility = 'hidden';
            element.setAttribute('data-mathis-hidden', 'true');
            completed += 1;
            if (completed === order.length) {
              resolve();
            }
          }, hideDelay);
        }, startDelay);
      });
    });
  };

  const collapseMathisLink = (overlay) => {
    const letters = Array.from(overlay.querySelectorAll('.mathis-clean__letter'));
    if (!letters.length) {
      return Promise.resolve();
    }
    const order = shuffleArray(letters);
    overlay.classList.remove('is-link-ready');
    overlay.classList.add('is-link-exiting');
    return new Promise((resolve) => {
      order.forEach((letter, index) => {
        const delay = index * 110 + Math.random() * 70;
        window.setTimeout(() => {
          letter.classList.remove('is-visible');
          letter.classList.add('is-exiting');
          if (index === order.length - 1) {
            window.setTimeout(resolve, 500);
          }
        }, delay);
      });
    });
  };

  const startMathisReturn = (overlay) => {
    if (!mathisSequenceActive || mathisExitStarted) {
      return;
    }
    mathisExitStarted = true;
    overlay.classList.remove('is-link-phase');
    collapseMathisLink(overlay)
      .then(() => {
        overlay.classList.remove('is-blank');
        overlay.classList.add('is-returning');
        return restoreMathisTargetsSequential();
      })
      .then(() => endMathisTakeover({ silent: true, skipRestore: true }));
  };

  const revealMathisLink = (overlay) => {
    if (!mathisSequenceActive) {
      return;
    }
    const lettersHost = overlay.querySelector('.mathis-clean__letters');
    const anchor = overlay.querySelector('.mathis-clean__anchor');
    if (!lettersHost || !anchor) {
      return;
    }
    // Keep the real one-time URL out of the DOM to avoid accidental navigation (www.mathisboche.com redirects to Google).
    anchor.setAttribute('href', '#');
    ensureMathisEggHandler(anchor);
    lettersHost.innerHTML = '';
    const letters = MATHIS_LINK_TEXT.split('');
    const spans = letters.map((char, index) => {
      const span = document.createElement('span');
      span.className = 'mathis-clean__letter';
      if (MATHIS_SUBTLE_SUFFIX_START_INDEX >= 0 && index >= MATHIS_SUBTLE_SUFFIX_START_INDEX) {
        span.classList.add('mathis-clean__letter--subtle');
      }
      span.textContent = char;
      lettersHost.appendChild(span);
      return span;
    });
    overlay.classList.add('is-link-phase');
    const indexes = shuffleArray(spans.map((_, idx) => idx));
    indexes.forEach((letterIndex, orderIndex) => {
      const delay = MATHIS_REVEAL_DELAY + orderIndex * 140;
      window.setTimeout(() => {
        if (!mathisSequenceActive) {
          return;
        }
        spans[letterIndex].classList.add('is-visible');
        if (orderIndex === indexes.length - 1) {
          window.setTimeout(() => {
            if (!mathisSequenceActive) {
              return;
            }
            overlay.classList.add('is-link-ready');
          }, 400);
        }
      }, delay);
    });
  };

  const startMathisSequence = (overlay) => {
    mathisSequenceActive = true;
    mathisExitStarted = false;
    clearMathisEggRefreshTimer();
    mathisEggCache = null;
    if (MATHIS_EGG_API) {
      prefetchMathisEggUrl({ force: true }).catch(() => {
        // If the prefetch fails we'll fallback to the popup flow on click.
      });
    }
    resetMathisRectCache();
    const mathisPerf = getMathisPerfProfile();
    prepareMathisFragments(overlay, mathisPerf);
    const targets = gatherMathisTargets(mathisPerf);
    collapseMathisTargets(targets).then(() => {
      if (!mathisSequenceActive) {
        return;
      }
      overlay.classList.add('is-blank');
      revealMathisLink(overlay);
    });
  };

  const showLegacySpectacle = () => {
    if (typeof document === 'undefined') {
      return {
        message: 'Impossible d’afficher l’effet spécial sans navigateur.',
        tone: 'error',
      };
    }
    if (document.getElementById(MATHIS_TAKEOVER_ID)) {
      return {
        suppressStatus: true,
      };
    }
    const overlay = buildMathisTakeoverOverlay();
    if (!overlay) {
      return null;
    }
    document.body?.appendChild(overlay);
    lockMathisScroll();
    const closeButton = overlay.querySelector('.mathis-clean__close');
    closeButton?.addEventListener('click', (event) => {
      event.preventDefault();
      startMathisReturn(overlay);
    });
    overlay.focus();
    startMathisSequence(overlay);
    return {
      suppressStatus: true,
    };
  };

  const SECRET_DEBUG_COMMANDS = new Map([
    [':debug', () => toggleDebugMode()],
    [':debug+', () => setDebugMode(true)],
    [':debug-', () => setDebugMode(false)],
    ['debugfr', () => toggleDebugMode()],
    [':sansdebug', () => setDebugMode(false)],
    [':debugmode', () => setDebugMode(true)],
  ]);

  if (isClubs92Scope && LEGACY_EASTER_EGG_COMMANDS.size > 0) {
    LEGACY_EASTER_EGG_COMMANDS.forEach((command) => {
      SECRET_DEBUG_COMMANDS.set(command, () => showLegacySpectacle());
    });
  }
  let legacyRienCodeConsumed = false;

  const consumeLegacyRienCode = (normalizedTrigger) => {
    if (legacyRienCodeConsumed || !LEGACY_EASTER_EGG.trigger || normalizedTrigger !== LEGACY_EASTER_EGG.trigger) {
      return;
    }

    legacyRienCodeConsumed = true;
    SECRET_DEBUG_COMMANDS.delete(LEGACY_EASTER_EGG.trigger);

    const endpoint = LEGACY_EASTER_EGG.consumeUrl || '';
    if (!endpoint) {
      return;
    }
    const payload = JSON.stringify({ code: LEGACY_EASTER_EGG.trigger });

    try {
      if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function' && typeof Blob === 'function') {
        const body = new Blob([payload], { type: 'application/json' });
        if (navigator.sendBeacon(endpoint, body)) {
          return;
        }
      }
    } catch (error) {
      // Ignore and fallback to fetch.
    }

    if (typeof fetch === 'function') {
      fetch(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        cache: 'no-store',
        keepalive: true,
      }).catch(() => {});
    }
  };

  const updateSortButtons = () => {
    sortButtons.forEach((button) => {
      const mode = button.dataset.clubSort || 'default';
      const isActive = mode === state.sortMode;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  };

  const setSearchMeta = (meta) => {
    state.lastSearchMeta = meta;
  };

  const applySortMode = (options = {}) => {
    const actionStartedAt = Number.isFinite(options.startedAt) ? options.startedAt : Date.now();
    const minDelay = Number.isFinite(options.minDelay) ? options.minDelay : MIN_RESULTS_SCROLL_DELAY_MS;
    const shouldDelay = options.delay !== false;
    const shouldScroll = options.forceScroll ? true : !options.skipScroll;
    const isQuiet = options.quiet === true || state.restoreMode;
    const activeLicenseSort = getActiveLicenseSort();
    const finalizeSort = (message, metaKey) => {
      const run = () => {
        setSearchMeta({ sort: metaKey, total: state.filtered.length });
        if (!isQuiet) {
          setSearchStatus(message, 'info');
        }
        if (shouldScroll) {
          jumpToResults(options.scrollOptions || {});
        }
      };
      if (shouldDelay) {
        scheduleAfterMinimumDelay(actionStartedAt, run, minDelay);
      } else {
        run();
      }
    };
    if (activeLicenseSort) {
      const sorted = state.clubs
        .slice()
        .sort((a, b) => {
          const countA = getLicenseCount(a, activeLicenseSort.valueKey);
          const countB = getLicenseCount(b, activeLicenseSort.valueKey);
          if (countB !== countA) {
            return countB - countA;
          }
          return compareClubsByName(a, b);
        });
      state.distanceMode = false;
      state.distanceReference = '';
      state.distanceReferencePostal = '';
      state.distanceReferenceCommune = '';
      state.distanceReferenceType = '';
      state.filtered = sorted;
      state.visibleCount = Math.min(VISIBLE_RESULTS_DEFAULT, state.filtered.length);
      renderResults({ resetVisible: false });
      updateTotalCounter();
      finalizeSort(activeLicenseSort.status, activeLicenseSort.metaKey || state.sortMode);
      return true;
    }
    if (state.sortMode === 'alpha') {
      const sorted = state.clubs
        .slice()
        .sort((a, b) => compareClubsByName(a, b));
      state.distanceMode = false;
      state.distanceReference = '';
      state.distanceReferencePostal = '';
      state.distanceReferenceCommune = '';
      state.distanceReferenceType = '';
      state.filtered = sorted;
      state.visibleCount = Math.min(VISIBLE_RESULTS_DEFAULT, state.filtered.length);
      renderResults({ resetVisible: false });
      updateTotalCounter();
      finalizeSort('Clubs classés par ordre alphabétique.', 'alpha');
      return true;
    }
    return false;
  };

  const setSortMode = (mode, options = {}) => {
    const actionStartedAt = Date.now();
    const normalized = LICENSE_SORT_CONFIGS[mode] ? mode : DEFAULT_SORT_MODE;
    const triggerButton = options.triggerButton || null;
    const busyLabel =
      typeof options.busyLabel === 'string' && options.busyLabel.trim() ? options.busyLabel.trim() : '';
    const sortDelay = Number.isFinite(options.delayMs) ? options.delayMs : SORT_SCROLL_DELAY_MS;
    const releaseTriggerButton = (() => {
      if (!triggerButton) {
        return () => {};
      }
      deferResultsRendering({ placeholder: SORT_COUNTER_LOADING_TEXT });
      const overlayRelease = showLoadingOverlay(busyLabel || 'Mise à jour…');
      const release = beginButtonWait(triggerButton, busyLabel);
      let released = false;
      return (forceImmediate = false) => {
        if (released) {
          return;
        }
        released = true;
        const minDelay = forceImmediate ? 0 : sortDelay;
        scheduleAfterMinimumDelay(actionStartedAt, () => {
          release();
          overlayRelease();
          flushDeferredResultsRendering();
        }, minDelay);
      };
    })();
    const announceSortUpdate = () => {
      setSearchStatus('Mise à jour du tri…', 'info');
    };
    if (state.sortMode === normalized) {
      if (normalized !== 'default') {
        announceSortUpdate();
        applySortMode({ forceScroll: true, startedAt: actionStartedAt, minDelay: sortDelay });
        releaseTriggerButton();
      } else {
        releaseTriggerButton(true);
      }
      return;
    }
    state.sortMode = normalized;
    updateSortButtons();

    if (normalized === 'default') {
      handleLocationClear({ skipSearch: true, silent: true });
      clearSearchQuery({ silent: true });
      state.distanceMode = false;
      state.distanceReference = '';
      state.distanceReferencePostal = '';
      state.distanceReferenceCommune = '';
      state.distanceReferenceType = '';
      state.filtered = state.clubs.slice();
      state.visibleCount = Math.min(VISIBLE_RESULTS_DEFAULT, state.filtered.length);
      void performSearch({ forceJump: true, minDelay: sortDelay, desiredSortMode: 'default' });
      syncUrlState();
      releaseTriggerButton();
      return;
    }

    announceSortUpdate();
    clearSearchQuery({ silent: true });
    handleLocationClear({ skipSearch: true, silent: true });
    state.distanceMode = false;
    state.distanceReference = '';
    state.distanceReferencePostal = '';
    state.distanceReferenceCommune = '';
    state.distanceReferenceType = '';
    applySortMode({ forceScroll: true, startedAt: actionStartedAt, minDelay: sortDelay });
    syncUrlState();
    releaseTriggerButton();
  };

  const applyInitialUrlState = async () => {
    let applied = false;
    if (initialQueryParam) {
      if (searchInput) {
        searchInput.value = initialQueryParam;
      }
      if (locationInput) {
        locationInput.value = initialQueryParam;
      }
      const result = await handleLocationSubmit({ quiet: true, fromPrimary: true, triggerButton: searchButton });
      applied = Boolean(result && result.ok);
    }
    if (initialSortParam) {
      let normalized = DEFAULT_SORT_MODE;
      if (LICENSE_SORT_CONFIGS[initialSortParam]) {
        normalized = initialSortParam;
      }
      if (normalized !== DEFAULT_SORT_MODE) {
        state.sortMode = normalized;
        updateSortButtons();
        if (applied) {
          applySortMode({ skipScroll: true, delay: false, quiet: true, forceScroll: false });
        }
      }
    }
    if (!applied && initialLocParam && locationInput) {
      locationInput.value = initialLocParam;
      if (searchInput) {
        searchInput.value = initialLocParam;
      }
      const result = await handleLocationSubmit({ quiet: true, fromPrimary: true, triggerButton: searchButton });
      applied = Boolean(result && result.ok);
    }
    return applied;
  };

  let focusRetryTimeout = null;
  const requestPrimarySearchFocus = (options = {}) => {
    if (!shouldFocusSearch || !searchInput) {
      return;
    }
    if (!options.force && typeof document !== 'undefined' && document.activeElement === searchInput) {
      return;
    }
    const shouldRetry = options.retry !== false;
    const applyFocus = () => {
      if (!searchInput) {
        return;
      }
      if (typeof searchInput.setAttribute === 'function') {
        searchInput.setAttribute('autofocus', 'autofocus');
      }
      try {
        searchInput.focus({ preventScroll: true });
      } catch (error) {
        searchInput.focus();
      }
      if (typeof searchInput.setSelectionRange === 'function') {
        const cursorIndex = searchInput.value.length;
        searchInput.setSelectionRange(cursorIndex, cursorIndex);
      } else if (typeof searchInput.select === 'function') {
        searchInput.select();
      }
      if (typeof searchInput.click === 'function') {
        searchInput.click();
      }
    };
    applyFocus();
    if (shouldRetry) {
      if (focusRetryTimeout) {
        window.clearTimeout(focusRetryTimeout);
      }
      focusRetryTimeout = window.setTimeout(applyFocus, 250);
    }
  };

  const setupPrimarySearchFallbackFocus = () => {
    if (!shouldFocusSearch || !searchInput || !searchBlock) {
      return;
    }
    let armed = true;
    const cleanup = () => {
      searchBlock.removeEventListener('pointerdown', handleFallback, true);
      searchBlock.removeEventListener('touchstart', handleFallback, true);
      searchBlock.removeEventListener('mousedown', handleFallback, true);
    };
    const handleFallback = () => {
      if (!armed) {
        return;
      }
      armed = false;
      cleanup();
      requestPrimarySearchFocus({ force: true, retry: false });
    };
    searchBlock.addEventListener('pointerdown', handleFallback, { passive: true, capture: true });
    searchBlock.addEventListener('touchstart', handleFallback, { passive: true, capture: true });
    searchBlock.addEventListener('mousedown', handleFallback, { passive: true, capture: true });
  };

  const beginButtonWait = (button, busyLabel, options = {}) => {
    if (!button) {
      return () => {};
    }
    if (button.getAttribute('aria-busy') === 'true') {
      return () => {};
    }
    const lockClear = options.lockClearButtons === true;
    const shouldLockSearch = lockClear && button === searchButton;
    const shouldLockLocation = lockClear && button === locationApplyButton;
    if (shouldLockSearch) {
      lockSearchClear();
    }
    if (shouldLockLocation) {
      lockLocationClear();
    }
    const previousHtml = button.innerHTML;
    const previousMinWidth = button.style.minWidth;
    const hadExplicitMinWidth = typeof previousMinWidth === 'string' && previousMinWidth.length > 0;
    const rect = typeof button.getBoundingClientRect === 'function' ? button.getBoundingClientRect() : null;
    if (rect && Number.isFinite(rect.width) && rect.width > 0) {
      button.style.minWidth = `${rect.width}px`;
    }
    if (busyLabel) {
      button.textContent = busyLabel;
    }
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    return () => {
      if (shouldLockSearch) {
        unlockSearchClear();
      }
      if (shouldLockLocation) {
        unlockLocationClear();
      }
      button.innerHTML = previousHtml;
      if (hadExplicitMinWidth) {
        button.style.minWidth = previousMinWidth;
      } else {
        button.style.removeProperty('min-width');
      }
      button.disabled = false;
      button.removeAttribute('aria-busy');
    };
  };

  const normalise = (value) =>
    (value || '')
      .toString()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

  const normaliseForSearch = (value) =>
    normalise(value)
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  // Compact form used to make searches resilient to missing hyphens/spaces.
  const stripSearchDelimiters = (value) => (value || '').replace(/[-\s]+/g, '');

  const normaliseCommuneKey = (value) => normalise(value).replace(/[^a-z0-9]/g, '');

  const normalisePostalCodeValue = (value) => {
    if (value == null) {
      return '';
    }
    const digits = value.toString().replace(/\D/g, '').trim();
    if (!digits) {
      return '';
    }
    if (digits.length < 2 || digits.length > 5) {
      return '';
    }
    return digits;
  };

  const MONACO_POSTAL_CODE = '98000';
  const MONACO_LOCATION_LABEL = 'Monaco';
  const MONACO_LOCATION_COORDS = { lat: 43.7384, lng: 7.4246 };
  const MONACO_BANNER_URL = 'https://chessmatesinternational.com';
  let monacoBanner = null;

  const ensureMonacoBanner = () => {
    if (monacoBanner || !resultsEl || typeof document === 'undefined') {
      return monacoBanner;
    }
    const banner = document.createElement('div');
    banner.className = 'clubs-monaco-banner';
    banner.setAttribute('role', 'note');
    banner.setAttribute('hidden', '');

    const text = document.createElement('span');
    text.className = 'clubs-monaco-banner__text';
    text.textContent = 'ChessMates International';

    const link = document.createElement('a');
    link.className = 'clubs-monaco-banner__link';
    link.href = MONACO_BANNER_URL;
    link.textContent = 'chessmatesinternational.com';
    link.rel = 'noopener';

    banner.appendChild(text);
    banner.appendChild(link);
    resultsEl.before(banner);
    monacoBanner = banner;
    return monacoBanner;
  };

  const setMonacoBannerVisible = (visible) => {
    const banner = ensureMonacoBanner();
    if (!banner) {
      return;
    }
    if (visible) {
      banner.removeAttribute('hidden');
    } else {
      banner.setAttribute('hidden', '');
    }
  };

  const isMonacoReference = (payload = {}) => {
    const postal = normalisePostalCodeValue(payload.postalCode || '');
    if (postal === MONACO_POSTAL_CODE) {
      return true;
    }
    const label = normalise(payload.label || '');
    const commune = normalise(payload.commune || '');
    return Boolean(label && label.includes('monaco')) || Boolean(commune && commune.includes('monaco'));
  };

  const updateMonacoBanner = () => {
    if (!resultsEl) {
      return;
    }
    const shouldShow =
      state.distanceMode &&
      isMonacoReference({
        postalCode: state.distanceReferencePostal,
        label: state.distanceReference,
        commune: state.distanceReferenceCommune,
      });
    setMonacoBannerVisible(shouldShow);
  };

  const postalCoordinatesIndex = new Map();
  const communeCoordinatesByName = new Map();
  let postalCoordinatesPromise = null;

  const addCommuneCoordinate = (label, postalCode, lat, lng) => {
    const key = normaliseCommuneKey(label || '');
    if (!key || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      return;
    }
    if (!communeCoordinatesByName.has(key)) {
      communeCoordinatesByName.set(key, {
        postalCode,
        lat,
        lng,
        label,
        precision: 'commune',
      });
    }
  };

  const addPostalCoordinateEntry = (postalCode, entry) => {
    const code = normalisePostalCodeValue(postalCode);
    const lat = Number.parseFloat(entry?.lat ?? entry?.latitude ?? entry?.[1]);
    const lng = Number.parseFloat(entry?.lng ?? entry?.longitude ?? entry?.lon ?? entry?.[2]);
    if (!code || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      return;
    }
    const label = (entry?.label || entry?.name || entry?.commune || entry?.[3] || '').toString().trim();
    const record = {
      postalCode: code,
      lat,
      lng,
      label: label || code,
      precision: 'postal',
    };
    const current = postalCoordinatesIndex.get(code) || [];
    const duplicate = current.some(
      (item) =>
        item.label === record.label &&
        Math.abs(item.lat - record.lat) < 1e-6 &&
        Math.abs(item.lng - record.lng) < 1e-6
    );
    if (!duplicate) {
      current.push(record);
      postalCoordinatesIndex.set(code, current);
    }
    if (record.label && record.label !== code) {
      addCommuneCoordinate(record.label, record.postalCode, record.lat, record.lng);
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
      const code = entry.postalCode || entry.code || entry.postcode;
      addPostalCoordinateEntry(code, entry);
    });
  };

  seedPostalCoordinateEntries(
    Object.entries(LOCAL_POSTAL_COORDINATES).map(([postalCode, value]) => ({
      postalCode,
      ...value,
    }))
  );

  const loadPostalCoordinatesIndex = () => {
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
        console.warn('[clubs-fr-debug] Impossible de charger les coordonnées postales.', error);
        return postalCoordinatesIndex;
      });
    return postalCoordinatesPromise;
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
    const postal = selected.postalCode || normalisePostalCodeValue(postalCode);
    return {
      postalCode: postal,
      lat: selected.lat,
      lng: selected.lng,
      label: selected.label,
      precision: 'postal',
    };
  };

  const getPostalCoordinateEntries = (postalCode) => {
    const key = normalisePostalCodeValue(postalCode);
    if (!key) {
      return [];
    }
    const candidates = [key];
    const canonical = canonicalizeParisPostalCode(key);
    if (canonical && canonical !== key) {
      candidates.push(canonical);
    } else if (key === '75016') {
      candidates.push('75116');
    }
    for (let i = 0; i < candidates.length; i += 1) {
      const entries = postalCoordinatesIndex.get(candidates[i]);
      if (entries && entries.length) {
        return entries.slice();
      }
    }
    return [];
  };

  const getPostalCoordinateEntriesByPrefix = (postalPrefix) => {
    const prefix = normalisePostalCodeValue(postalPrefix);
    if (!prefix) {
      return [];
    }
    if (prefix.length === 5) {
      return getPostalCoordinateEntries(prefix);
    }
    const prefixes = new Set([prefix]);
    if (prefix.length <= 4 && prefix[0] !== '0') {
      prefixes.add(`0${prefix}`);
    }
    const matches = [];
    const seen = new Set();
    const prefixList = Array.from(prefixes);
    postalCoordinatesIndex.forEach((entries, code) => {
      const hasPrefix = prefixList.some((candidate) => code && code.startsWith(candidate));
      if (!hasPrefix) {
        return;
      }
      entries.forEach((entry) => {
        const record = { ...entry, postalCode: entry.postalCode || code };
        const key = `${record.postalCode}|${record.label}|${record.lat}|${record.lng}`;
        if (seen.has(key)) {
          return;
        }
        seen.add(key);
        matches.push(record);
      });
    });
    return matches;
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
    if (entry) {
      return {
        postalCode: entry.postalCode,
        lat: entry.lat,
        lng: entry.lng,
        label: entry.label,
        precision: 'commune',
      };
    }
    const parisPostal = extractParisPostal(value);
    if (parisPostal) {
      const coords = getPostalCoordinates(parisPostal, value);
      if (coords) {
        return {
          postalCode: coords.postalCode,
          lat: coords.lat,
          lng: coords.lng,
          label: coords.label,
          precision: coords.precision || 'postal',
        };
      }
    }
    return null;
  };

  const buildAcronym = (value) => {
    if (!value) {
      return '';
    }
    const letters = value
      .toString()
      .split(/[^\p{L}0-9]+/u)
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => part[0])
      .join('');
    if (letters.length < 2) {
      return '';
    }
    return normalise(letters);
  };

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
    const communeSeed = club._slugCommune || club.commune || '';
    const seedParts = [
      club.id || '',
      club.name || '',
      communeSeed,
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
      `${club.id || ''}|${club.name || ''}|${club._slugCommune || club.commune || ''}|${club.postalCode || ''}|${
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
        const club = entries[0];
        club.slug = base;
        club._communeSlug = slugify(club._slugCommune || club.commune || '');
        return;
      }
      const sorted = entries
        .map((club) => ({ club, key: stableKey(club) }))
        .sort((a, b) => a.key.localeCompare(b.key, 'en', { sensitivity: 'base' }));
      sorted.forEach((entry, idx) => {
        const suffix = idx === 0 ? '' : `-${toBase36(idx + 1)}`;
        entry.club.slug = `${base}${suffix}`;
        entry.club._communeSlug = slugify(entry.club._slugCommune || entry.club.commune || '');
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

  const cleanCommuneFragment = (raw) => {
	    const base = stripCedexSuffix(
	      (raw || '')
	        .toString()
	        .replace(DASH_RX, '-')
	        .replace(/\b\d{4,5}\b/g, ' ')
	        .replace(/^[,;\s\-\u2013\u2014]+/, ' ')
	        .replace(/\s+/g, ' ')
	        .trim()
	    );
    if (!base) {
      return '';
    }
    const segments = base
      .split(/[,;/]+/)
      .map((part) => part.trim())
      .filter(Boolean);
    const head = segments.length ? segments[0] : base;
    return stripCedexSuffix(head).replace(/^\d+\s+/, '').trim();
  };

  const extractAddressParts = (value) => {
    const result = {
      full: value ? String(value).trim() : '',
      postalCode: '',
      city: '',
    };
    if (!result.full) {
      return result;
    }

    const cleanCity = (raw) => cleanCommuneFragment(raw);

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

	  const extractAddressPartsForSlug = (value) => {
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

  const buildStandardAddress = (primaryAddress, secondaryAddress, postalCode, city) => {
    const street =
      simplifyStreetSegment(primaryAddress) || simplifyStreetSegment(secondaryAddress) || '';
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

  const stripAddressLocality = (address, commune, postalCode) => {
    const raw = (address || '').toString().trim();
    if (!raw) {
      return '';
    }
    const city = formatCommune(commune || '');
    const canonicalPostal = canonicalizeParisPostalCode(postalCode);
    const postal = canonicalPostal || normalisePostalCodeValue(postalCode);
    const postalTokens = [postal, normalisePostalCodeValue(postalCode)]
      .filter(Boolean)
      .filter((value, index, array) => array.indexOf(value) === index);
    const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [];
    const cleaned = raw.replace(/\s+/g, ' ').trim();
    if (city) {
      const cityPattern = escapeRegex(city);
      postalTokens.forEach((code) => {
        const codePattern = escapeRegex(code);
        patterns.push(new RegExp(`(?:,\\s*)?${codePattern}\\s+${cityPattern}$`, 'i'));
        patterns.push(new RegExp(`(?:,\\s*)?${cityPattern}\\s+${codePattern}$`, 'i'));
        patterns.push(new RegExp(`(?:,\\s*)?${cityPattern}\\s*\\(${codePattern}\\)$`, 'i'));
      });
      patterns.push(new RegExp(`(?:,\\s*)?${cityPattern}$`, 'i'));
    }
    postalTokens.forEach((code) => {
      const codePattern = escapeRegex(code);
      patterns.push(new RegExp(`(?:,\\s*)?${codePattern}$`, 'i'));
    });
    for (const pattern of patterns) {
      if (pattern.test(cleaned)) {
        const stripped = cleaned.replace(pattern, '').replace(/[\s,]+$/g, '').trim();
        return stripped || cleaned;
      }
    }
    return cleaned;
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

  const normaliseReferenceCommune = (value, postalCode = '') => {
    if (!value) {
      return '';
    }
    const postal = normalisePostalCodeValue(postalCode);
    let cleaned = value.replace(/\(\s*\d{4,5}\s*\)/g, ' ');
    if (postal) {
      const postalPattern = new RegExp(`\\b${postal}\\b`, 'gi');
      cleaned = cleaned.replace(postalPattern, ' ');
    }
    cleaned = cleaned.replace(/\b\d{4,5}\b/g, ' ');
    cleaned = stripCedexSuffix(cleaned);
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    return normaliseCommuneForCompare(cleaned);
  };

  const getParisArrondissementFromPostal = (postalCode) => {
    const code = normalisePostalCodeValue(postalCode);
    if (!code || code.length !== 5 || !code.startsWith('75')) {
      return null;
    }
    if (code === '75116') {
      return 16;
    }
    const arr = Number.parseInt(code.slice(3), 10);
    if (!Number.isFinite(arr) || arr < 1 || arr > 20) {
      return null;
    }
    return arr;
  };

  const canonicalizeParisPostalCode = (postalCode) => {
    const arr = getParisArrondissementFromPostal(postalCode);
    if (!arr) {
      return normalisePostalCodeValue(postalCode);
    }
    return `750${arr.toString().padStart(2, '0')}`;
  };

  const formatParisArrondissementLabel = (postalCode) => {
    const arr = getParisArrondissementFromPostal(postalCode);
    if (!arr) {
      return '';
    }
    const suffix = arr === 1 ? 'er' : 'e';
    return `Paris ${arr}${suffix}`;
  };

  const PARIS_ARR_POSTAL_CODES = [
    '75001',
    '75002',
    '75003',
    '75004',
    '75005',
    '75006',
    '75007',
    '75008',
    '75009',
    '75010',
    '75011',
    '75012',
    '75013',
    '75014',
    '75015',
    '75016',
    '75017',
    '75018',
    '75019',
    '75020',
  ];

  const buildParisArrondissementSuggestions = (entries = [], options = {}) => {
    const hasCoords = (item) => {
      if (!item) {
        return false;
      }
      const lat = Number.parseFloat(item.latitude ?? item.lat);
      const lng = Number.parseFloat(item.longitude ?? item.lng);
      return Number.isFinite(lat) && Number.isFinite(lng);
    };
    const bestByPostal = new Map();
    (entries || []).forEach((entry) => {
      if (!entry) {
        return;
      }
      const postal = canonicalizeParisPostalCode(entry.postalCode || entry.code || entry.postcode || '');
      const arr = getParisArrondissementFromPostal(postal);
      if (!postal || !arr) {
        return;
      }
      const label = formatParisArrondissementLabel(postal) || 'Paris';
      const candidate = {
        ...entry,
        postalCode: postal,
        commune: label,
        display: entry.display || label,
        search: entry.search || normaliseForSearch(`${label} ${postal}`.trim()),
        searchAlt: entry.searchAlt || normaliseForSearch(`${postal} ${label}`.trim()),
      };
      const existing = bestByPostal.get(postal);
      if (
        !existing ||
        (!existing.hasClub && candidate.hasClub) ||
        (!hasCoords(existing) && hasCoords(candidate))
      ) {
        bestByPostal.set(postal, candidate);
      }
    });
    const rawParisQuery = (options.query || '').toString();
    const numericParisQuery = (options.numericQuery || '').replace(/\D/g, '');
    const canonicalPostalHint =
      canonicalizeParisPostalCode(options.postalHint || extractParisPostal(rawParisQuery) || '') || '';
    const hintedArr = getParisArrondissementFromPostal(canonicalPostalHint);
    const parisNumberMatch = rawParisQuery.match(/paris[^0-9]{0,3}(\d{1,2})/i);
    const partialDigitsFromText = parisNumberMatch && parisNumberMatch[1] ? parisNumberMatch[1] : '';
    const partialDigitsFromNumeric =
      numericParisQuery.startsWith('75') && numericParisQuery.length > 2 ? numericParisQuery.slice(2, 4) : '';
    const rawPartial = partialDigitsFromText || partialDigitsFromNumeric;
    const cleanedPartialDigits = rawPartial.replace(/\D/g, '').replace(/^0+/, '');
    const parsedPartialDigits = Number.parseInt(cleanedPartialDigits, 10);
    const partialArrDigits =
      cleanedPartialDigits &&
      Number.isFinite(parsedPartialDigits) &&
      parsedPartialDigits >= 1 &&
      parsedPartialDigits <= 20
        ? cleanedPartialDigits
        : '';
    const parisPostalOrder = PARIS_ARR_POSTAL_CODES.slice();
    const suggestions = [];
    parisPostalOrder.forEach((postal) => {
      const existing = bestByPostal.get(postal);
      if (existing) {
        suggestions.push(existing);
        return;
      }
      const coords = getPostalCoordinates(postal) || getDeptFallbackCoordinates(postal);
      const label = formatParisArrondissementLabel(postal) || 'Paris';
      const suggestion = {
        display: label,
        commune: label,
        postalCode: postal,
        search: normaliseForSearch(`${label} ${postal}`.trim()),
        searchAlt: normaliseForSearch(`${postal} ${label}`.trim()),
        source: 'paris-override',
      };
      if (coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lng)) {
        suggestion.latitude = coords.lat;
        suggestion.longitude = coords.lng;
      }
      suggestions.push(suggestion);
    });
    // Prioritize hinted arrondissements while keeping an ascending default order (1 -> 20).
    const scoreParisSuggestion = (entry) => {
      const arr = getParisArrondissementFromPostal(entry.postalCode) || 0;
      const arrStr = arr.toString();
      const arrStrPadded = arr.toString().padStart(2, '0');
      let score = 100 - arr;
      if (hintedArr && arr === hintedArr) {
        score += 200;
      }
      if (partialArrDigits && (arrStr.startsWith(partialArrDigits) || arrStrPadded.startsWith(partialArrDigits))) {
        score += 120 - Math.min(40, partialArrDigits.length * 15);
      }
      return score;
    };
    return suggestions
      .map((entry, index) => ({ entry, index }))
      .sort((a, b) => {
        const scoreA = scoreParisSuggestion(a.entry);
        const scoreB = scoreParisSuggestion(b.entry);
        if (scoreA !== scoreB) {
          return scoreB - scoreA;
        }
        const arrA = getParisArrondissementFromPostal(a.entry.postalCode) || 0;
        const arrB = getParisArrondissementFromPostal(b.entry.postalCode) || 0;
        if (arrA !== arrB) {
          return arrA - arrB;
        }
        return a.index - b.index;
      })
      .map((item) => item.entry);
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

  const LOOKS_LIKE_CITY = /^[\p{L}\s'’-]{3,}$/u;
  const COMMUNE_SCHEDULE_KEYWORDS = /\b(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/i;
  const COMMUNE_VENUE_KEYWORDS = /\b(salle|mairie|gymnase|espace|centre|complexe|maison|mediath[eé]que|biblioth[eé]que)\b/i;

  const deriveReferenceContext = (rawInput, coords = {}, type = '') => {
    const addressParts = extractAddressParts(rawInput || '');
    const postal = coords.postalCode || addressParts.postalCode || '';
    const communeCandidate =
      coords.commune ||
      coords.city ||
      coords.label ||
      addressParts.city ||
      rawInput ||
      '';
    return {
      postalCode: normalisePostalCodeValue(postal),
      commune: normaliseReferenceCommune(communeCandidate, postal),
      type,
    };
  };

  const decorateReferenceLabel = (baseLabel, type) => {
    if (!baseLabel) {
      return baseLabel;
    }
    if (type === 'geoloc') {
      return `${baseLabel} (ma position)`;
    }
    return baseLabel;
  };

  const isClubOnsiteWithReference = (club, referencePostal, referenceCommune) => {
    if (!club) {
      return false;
    }
    const refPostalRaw = normalisePostalCodeValue(referencePostal);
    const clubPostalRaw = normalisePostalCodeValue(club.postalCode);
    const refPostal = canonicalizeParisPostalCode(refPostalRaw) || refPostalRaw;
    const clubPostal = canonicalizeParisPostalCode(clubPostalRaw) || clubPostalRaw;
    const refCommune = normaliseReferenceCommune(referenceCommune, refPostal);
    const clubCommune = normaliseCommuneForCompare(club.commune);

    if (refPostal && clubPostal) {
      if (refPostal === clubPostal) {
        return true;
      }
      // Autorise les communes à codes multiples (ex: Paris 16e avec 75016/75116) quand l'intitulé correspond.
      if (refCommune && clubCommune && refCommune === clubCommune) {
        const sameDepartment = refPostal.slice(0, 2) === clubPostal.slice(0, 2);
        if (sameDepartment) {
          return true;
        }
      }
      return false;
    }

    if (refCommune && clubCommune && clubCommune === refCommune) {
      return true;
    }
    return false;
  };

  const isClubOnsite = (club) => {
    if (!state.distanceMode) {
      return false;
    }
    return isClubOnsiteWithReference(club, state.distanceReferencePostal, state.distanceReferenceCommune);
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

  const looksLikeStreetName = (value) => {
    const raw = (value || '').toString().trim();
    if (!raw) {
      return false;
    }
    const startsWithStreet =
      /^(rue|avenue|av\.?|boulevard|bd|bld|route|chemin|impasse|all[ée]e|voie|quai|cours|passage|square|sentier|mail|esplanade|terrasse|pont|faubourg|clos|cité|cite|hameau|lotissement|residence|résidence|allee)\b/i;
    if (startsWithStreet.test(raw) && /\s+\S+/.test(raw)) {
      return true;
    }
    return looksLikeDetailedAddress(raw);
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

  const COMMUNE_JUNK_PATTERNS = [
    /\bidem\b.*\bsi[eè]ge\b/i,
    /\bidem\b.*\badresse\b/i,
    /\b(?:voir|cf\.?)\s+(?:adresse|siege)/i,
  ];

  const COMMUNE_VENUE_FRAGMENTS =
    /\b(?:salle\s+(?:des|du|de|d')|gymnase|dojo|complexe|espace|stade|palais\s+des\s+sports|mjc|mpt|foyer|piscine|terrain|hotel\s+de\s+ville|h[ôo]tel\s+de\s+ville|mairie|maison\s+(?:des|du|de|d'))\b/i;

  const stripCommuneNoise = (segment) => {
    const trimmed = (segment || '').toString().replace(/\s+/g, ' ').trim();
    if (!trimmed) {
      return '';
    }
    const lower = trimmed.toLowerCase();
    if (COMMUNE_JUNK_PATTERNS.some((pattern) => pattern.test(lower))) {
      return '';
    }
    const hasVenueHint = COMMUNE_VENUE_FRAGMENTS.test(lower);
    if (hasVenueHint && trimmed.split(/\s+/).length >= 3) {
      return '';
    }
    return trimmed;
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
      const cleanedSegment = stripCommuneNoise(segment);
      if (!cleanedSegment) {
        return;
      }
      const formattedSegment = collapseRepeatedPhrase(formatCommune(cleanedSegment));
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
    if (parts.length === 1) {
      return parts[0];
    }
    const scoreFn = typeof scoreCommuneCandidate === 'function' ? scoreCommuneCandidate : null;
    if (scoreFn) {
      const scored = parts
        .map((segment, index) => ({
          segment,
          score: scoreFn(segment),
          order: index,
        }))
        .sort((a, b) => b.score - a.score || a.order - b.order);
      return scored[0]?.segment || parts[0];
    }
    return parts[0];
  };

  const deriveCityFromPostal = (address, postalHint = '') => {
    const raw = (address || '').toString();
    if (!raw.trim()) {
      return '';
    }
    const postal = parsePostalCodeFromString(raw) || normalisePostalCodeValue(postalHint);
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
    const cleanedAfter = cleanCommuneFragment(after);
    if (cleanedAfter) {
      return cleanedAfter;
    }
    const before = raw.slice(0, idx).trim();
    if (!before) {
      return '';
    }
    const segments = before.split(/[,;]+/).map((part) => part.trim()).filter(Boolean);
    const tail = segments.length ? segments[segments.length - 1] : before;
    return cleanCommuneFragment(tail);
  };

	  const deriveCityFromPostalForSlug = (address, postalHint = '') => {
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
	      return after.replace(/^[,;\s\-\u2013\u2014]+/, '').trim();
	    }
    const before = raw.slice(0, idx).trim();
    if (!before) {
      return '';
    }
    const segments = before.split(/[,;]+/).map((part) => part.trim()).filter(Boolean);
    return (segments.length ? segments[segments.length - 1] : before).trim();
  };

  const cleanCommuneCandidate = (value, postalCode) => {
    if (!value) {
      return '';
    }
    const noiseFreeValue = stripCommuneNoise(value);
    if (!noiseFreeValue) {
      return '';
    }
    const postal = normalisePostalCodeValue(postalCode);
	    let cleaned = noiseFreeValue
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
    const deduped = dedupeCommuneLabel(cleaned);
    cleaned = deduped === undefined ? cleaned : deduped;
    if (!cleaned) {
      return '';
    }
    const looksStreety = STREET_KEYWORDS.test(cleaned) && (/\d/.test(cleaned) || cleaned.split(/\s+/).length >= 3);
    if (looksStreety) {
      return '';
    }
    return formatCommune(cleaned);
  };

  const cleanCommuneCandidateForSlug = (value, postalCode) => {
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

  const scoreCommuneCandidate = (value, options = {}) => {
    if (!value) {
      return -Infinity;
    }
    const trimmed = value.toString().trim();
    if (!trimmed) {
      return -Infinity;
    }
    const postalLabel = options.postalLabel || '';
    const postalKey = postalLabel ? normaliseCommuneForCompare(postalLabel) : '';
    const valueKey = normaliseCommuneForCompare(trimmed);
    let score = 0;
    if (postalKey && valueKey && postalKey === valueKey) {
      score += 6;
    }
    const hasDigits = /\d/.test(trimmed);
    if (!hasDigits) {
      score += 4;
    } else if (!/^paris\s*\d{1,2}/i.test(trimmed)) {
      score -= 2;
    }
    if (looksLikeDetailedAddress(trimmed)) {
      score -= 4;
    } else if (looksLikeStreetName(trimmed)) {
      score -= 3;
    }
    if (COMMUNE_SCHEDULE_KEYWORDS.test(trimmed)) {
      score -= 6;
    }
    if (COMMUNE_VENUE_KEYWORDS.test(trimmed)) {
      score -= 2;
    }
    if (/[,;]+/.test(trimmed)) {
      score -= 1;
    }
    if (trimmed.split(/\s+/).length >= 6) {
      score -= 1;
    }
    if (trimmed.length >= 3) {
      score += 1;
    }
    return score;
  };

  const scoreCommuneCandidateForSlug = (value) => {
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
    const postalEntries = getPostalCoordinateEntries(postalCode);
    const postalLabels = postalEntries
      .map((entry) => formatCommuneWithPostal(entry?.label || '', postalCode))
      .filter(Boolean);
    const postalKeys = new Set(postalLabels.map(normaliseCommuneForCompare).filter(Boolean));
    const postalLabel = postalLabels[0] || '';

    let bestPostalMatch = '';
    let bestPostalScore = -Infinity;
    let bestOverall = '';
    let bestOverallScore = -Infinity;
    let bestPostalExtension = '';
    let bestPostalExtensionScore = -Infinity;

    const consider = (raw) => {
      const cleaned = cleanCommuneCandidate(raw, postalCode);
      if (!cleaned) {
        return;
      }
      const score = scoreCommuneCandidate(cleaned, { postalLabel });
      const key = normaliseCommuneForCompare(cleaned);
      if (postalKeys.has(key) && score > bestPostalScore) {
        bestPostalScore = score;
        bestPostalMatch = cleaned;
      }
      const extendsPostal =
        postalKeys.size > 0 &&
        key &&
        Array.from(postalKeys).some((postalKey) => key.startsWith(postalKey) && key.length > postalKey.length);
      if (extendsPostal && score > bestPostalExtensionScore) {
        bestPostalExtensionScore = score;
        bestPostalExtension = cleaned;
      }
      if (score > bestOverallScore) {
        bestOverallScore = score;
        bestOverall = cleaned;
      }
    };

    (candidates || []).forEach(consider);

    if (bestPostalExtension) {
      return bestPostalExtension;
    }
    if (bestPostalMatch) {
      return bestPostalMatch;
    }
    if (bestOverall) {
      return bestOverall;
    }
    return postalLabel || '';
  };

  const pickBestCommuneForSlug = (candidates, postalCode) => {
    let best = '';
    let bestScore = -Infinity;
    (candidates || []).forEach((raw) => {
      const cleaned = cleanCommuneCandidateForSlug(raw, postalCode);
      if (!cleaned) {
        return;
      }
      const score = scoreCommuneCandidateForSlug(cleaned);
      if (score > bestScore) {
        bestScore = score;
        best = cleaned;
      }
    });
    return best || '';
  };

  const formatGeocodeLabel = (place, postalCodeOverride) => {
    if (!place || typeof place !== 'object') {
      return '';
    }
    const { address = {}, display_name: displayName = '' } = place;
    const postalCodeRaw = postalCodeOverride || address.postcode || '';
    const postalCode = postalCodeRaw.split(';')[0].trim();
    const parisArr = formatParisArrondissementLabel(postalCode);
    if (parisArr) {
      return parisArr;
    }
    const localityRaw =
      address.city ||
      address.town ||
      address.village ||
      address.municipality ||
      address.hamlet ||
      address.suburb ||
      '';
    const locality = formatCommune(localityRaw);
    if (locality) {
      return locality;
    }
    if (displayName) {
      const [first] = displayName.split(',');
      return formatCommune(first);
    }
    return '';
  };

  const toDistanceReferenceLabel = (baseLabel, postalCode, options = {}) => {
    const type = options.type || '';
    const label = (baseLabel || '').trim();
    const code = (postalCode || '').trim();
    if (type === 'geoloc') {
      return label || 'votre position';
    }
    if (label && code) {
      return label.includes(code) ? label : `${label} (${code})`;
    }
    return label || code;
  };

  const lookupLocalCoordinates = (query) => {
    const raw = (query || '').toString().trim();
    if (!raw) {
      return null;
    }

    const postalMatches = raw.match(/\b(\d{5})\b/g);
    if (postalMatches) {
      for (let i = 0; i < postalMatches.length; i += 1) {
        const code = postalMatches[i];
        const coords = getPostalCoordinates(code);
        if (coords) {
          return {
            latitude: coords.lat,
            longitude: coords.lng,
            label: coords.label,
            postalCode: coords.postalCode,
            precision: coords.precision || 'postal',
          };
        }
        const deptFallback = getDeptFallbackCoordinates(code);
        if (deptFallback) {
          return {
            latitude: deptFallback.lat,
            longitude: deptFallback.lng,
            label: deptFallback.label,
            postalCode: deptFallback.postalCode || code,
            precision: deptFallback.precision || 'department',
          };
        }
      }
    }

    const parisPostal = extractParisPostal(raw);
    if (parisPostal) {
      const coords = getPostalCoordinates(parisPostal);
      if (coords) {
        return {
          latitude: coords.lat,
          longitude: coords.lng,
          label: coords.label,
          postalCode: coords.postalCode,
          precision: coords.precision || 'postal',
        };
      }
    }

    const numericOnly = raw.replace(/\D/g, '');
    if (!postalMatches && numericOnly && numericOnly.length >= 2 && numericOnly.length <= 3 && numericOnly === raw) {
      const deptFallback = getDeptFallbackCoordinates(numericOnly);
      if (deptFallback) {
        return {
          latitude: deptFallback.lat,
          longitude: deptFallback.lng,
          label: deptFallback.label,
          postalCode: deptFallback.postalCode || numericOnly,
          precision: deptFallback.precision || 'department',
        };
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
        return {
          latitude: coords.lat,
          longitude: coords.lng,
          label: coords.label,
          postalCode: coords.postalCode,
          precision: coords.precision || 'commune',
        };
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

  const stripSelfPositionSuffix = (value) => {
    if (!value) {
      return '';
    }
    return value.replace(/\(.*ma position.*\)/i, '').replace(/\s{2,}/g, ' ').trim();
  };

  const resolveClubDistanceCoordinates = (club) => {
    if (Object.prototype.hasOwnProperty.call(club, '_distanceCoords')) {
      return club._distanceCoords;
    }

    const directLat = Number.parseFloat(club.latitude ?? club.lat);
    const directLng = Number.parseFloat(club.longitude ?? club.lng ?? club.lon);
    if (Number.isFinite(directLat) && Number.isFinite(directLng)) {
      const coords = {
        postalCode: club.postalCode || '',
        lat: directLat,
        lng: directLng,
        label: club.commune || club.address || club.name || '',
        precision: 'exact',
      };
      club._distanceCoords = coords;
      return coords;
    }

    if (club.commune) {
      const coords = getCommuneCoordinatesByName(club.commune);
      if (coords) {
        club._distanceCoords = { ...coords, precision: coords.precision || 'commune' };
        return coords;
      }
    }

    const postalCandidates = collectPostalCodes(club);
    for (let i = 0; i < postalCandidates.length; i += 1) {
      const coords = getPostalCoordinates(postalCandidates[i], club.commune);
      if (coords) {
        club._distanceCoords = { ...coords, precision: coords.precision || 'postal' };
        return coords;
      }
    }

    // Department-level fallback (approximate) when no precise postal match is available.
    for (let i = 0; i < postalCandidates.length; i += 1) {
      const deptCoords = getDeptFallbackCoordinates(postalCandidates[i]);
      if (deptCoords) {
        club._distanceCoords = { ...deptCoords, precision: deptCoords.precision || 'department' };
        return club._distanceCoords;
      }
    }

    const parisPostal = deriveParisPostalFromClub(club);
    if (parisPostal) {
      const coords = getPostalCoordinates(parisPostal, club.commune);
      if (coords) {
        club._distanceCoords = coords;
        return coords;
      }
    }

    if (club.addressStandard) {
      const addressFallback = lookupLocalCoordinates(club.addressStandard);
      if (addressFallback) {
        club._distanceCoords = {
          postalCode: addressFallback.postalCode || '',
          lat: addressFallback.latitude,
          lng: addressFallback.longitude,
          label: addressFallback.label || club.addressStandard,
          precision: addressFallback.precision || 'approx',
        };
        return club._distanceCoords;
      }
    }

    if (club.commune) {
      const fallback = lookupLocalCoordinates(club.commune);
      if (fallback) {
        club._distanceCoords = {
          postalCode: fallback.postalCode || '',
          lat: fallback.latitude,
          lng: fallback.longitude,
          label: fallback.label || club.commune,
          precision: fallback.precision || 'approx',
        };
        return club._distanceCoords;
      }
    }

    club._distanceCoords = null;
    return null;
  };

  function openClubDebugView(club) {
    if (!club) {
      return;
    }
    const coords = resolveClubDistanceCoordinates(club);
    const openExternal = (url) => {
      if (typeof window !== 'undefined' && url) {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    };
    if (coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lng)) {
      const lat = Number.parseFloat(coords.lat);
      const lng = Number.parseFloat(coords.lng);
      const preciseLat = Number.isFinite(lat) ? lat : coords.lat;
      const preciseLng = Number.isFinite(lng) ? lng : coords.lng;
      if (isDebugMode()) {
        console.info(
          `${DEBUG_CONSOLE_PREFIX} ${club.name || club.id}: ${preciseLat}, ${preciseLng} (${coords.label || 'sans libellé'})`
        );
      }
      const url = `https://www.openstreetmap.org/?mlat=${preciseLat}&mlon=${preciseLng}#map=18/${preciseLat}/${preciseLng}`;
      openExternal(url);
      return;
    }
    const fallbackQuery = club.addressStandard || club.address || club.commune || club.name || '';
    if (fallbackQuery) {
      const encoded = encodeURIComponent(fallbackQuery);
      if (isDebugMode()) {
        console.warn(`${DEBUG_CONSOLE_PREFIX} Coordonnées absentes, ouverture de la recherche "${fallbackQuery}".`);
      }
      openExternal(`https://www.google.com/maps/search/?api=1&query=${encoded}`);
    } else if (isDebugMode()) {
      console.warn(`${DEBUG_CONSOLE_PREFIX} Impossible d'ouvrir le club ${club.id || club.name || 'inconnu'}.`);
    }
  }

  const findSecretCommandHandler = (value) => {
    if (!value) {
      return null;
    }
    const addCandidate = (candidate, list) => {
      if (!candidate) {
        return;
      }
      const normalizedCandidate = candidate.replace(/\/+$/, '');
      const key = normalizedCandidate || candidate;
      if (key && !list.includes(key)) {
        list.push(key);
      }
    };
    const normalized = value.toLowerCase();
    const candidates = [];
    addCandidate(normalized, candidates);
    const noProtocol = normalized.replace(/^https?:\/\//, '');
    addCandidate(noProtocol, candidates);
    const noWww = noProtocol.replace(/^www\./, '');
    addCandidate(noWww, candidates);
    const noHash = noWww.split('#')[0];
    addCandidate(noHash, candidates);
    const noQuery = noHash.split('?')[0];
    addCandidate(noQuery, candidates);
    const hostOnly = noQuery.split('/')[0];
    addCandidate(hostOnly, candidates);
    for (const candidate of candidates) {
      const handler = SECRET_DEBUG_COMMANDS.get(candidate);
      if (handler) {
        return handler;
      }
    }
    return null;
  };

  const tryHandleSecretCommand = (rawValue, options = {}) => {
    const raw = rawValue != null ? String(rawValue) : '';
    const trimmed = raw.trim();
    if (!trimmed) {
      return false;
    }
    const normalized = trimmed.toLowerCase();
    const handler = findSecretCommandHandler(trimmed);
    if (!handler) {
      return false;
    }
    if (handler === showLegacySpectacle && LEGACY_EASTER_EGG_COMMANDS.size > 0 && !LEGACY_EASTER_EGG_COMMANDS.has(normalized)) {
      return false;
    }
    consumeLegacyRienCode(normalized);
    const result = handler({ immediate: Boolean(options.immediate), query: trimmed, normalized }) || null;
    if (searchInput) {
      searchInput.value = '';
    }
    updateClearButtons();
    if (typeof setSearchStatus === 'function') {
      if (result && typeof result === 'object') {
        if (result.suppressStatus) {
          setSearchStatus('', 'info');
        } else if (result.message) {
          setSearchStatus(result.message, result.tone || 'info');
        } else {
          const message = isDebugMode()
            ? 'Mode debug activé via commande discrète.'
            : 'Mode debug désactivé.';
          setSearchStatus(message, 'info');
        }
      } else if (typeof result === 'string') {
        setSearchStatus(result, 'info');
      } else {
        const message = isDebugMode()
          ? 'Mode debug activé via commande discrète.'
          : 'Mode debug désactivé.';
        setSearchStatus(message, 'info');
      }
    }
    return true;
  };

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

  const formatDistanceLabel = (distanceKm, options = {}) => {
    const onsite = Boolean(options.onsite);
    if (onsite) {
      return { text: 'sur place', tone: 'onsite' };
    }
    if (!Number.isFinite(distanceKm)) {
      return { text: '', tone: 'default' };
    }
    if (distanceKm < 0.05) {
      const meters = Math.max(10, Math.round(distanceKm * 1000));
      return { text: `${meters} m`, tone: 'default' };
    }
    if (distanceKm < 1) {
      return { text: `${(distanceKm * 1000).toFixed(0)} m`, tone: 'default' };
    }
    if (distanceKm < 10) {
      return { text: `${distanceKm.toFixed(1)} km`, tone: 'default' };
    }
    return { text: `${Math.round(distanceKm)} km`, tone: 'default' };
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
        'User-Agent': 'echecs92-clubs-fr/1.0 (contact@echecs92.com)',
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
        const result = payload[0];
        const latitude = Number.parseFloat(result.lat);
        const longitude = Number.parseFloat(result.lon);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          return null;
        }
        const postalCodeRaw = result?.address?.postcode || '';
        const postalCode = postalCodeRaw.split(';')[0].trim();
        const label = formatGeocodeLabel(result, postalCode);
        return {
          latitude,
          longitude,
          label,
          commune: label || '',
          postalCode,
        };
      })
      .catch(() => null)
      .then((finalResult) => {
        geocodeCache.set(key, finalResult);
        persistGeocodeCache();
        return finalResult;
      });

    geocodeCache.set(key, request);
    return request;
  };

  const parseGeocodeResult = (place) => {
    if (!place) {
      return null;
    }
    const lat = Number.parseFloat(place.latitude ?? place.lat);
    const lng = Number.parseFloat(place.longitude ?? place.lon ?? place.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return null;
    }
    const postalCode = place.postalCode || place.postcode || '';
    const label = place.label || '';
    return { lat, lng, postalCode, label, commune: place.commune || label || '' };
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
      const parsed = parseGeocodeResult(place);
      if (!parsed) {
        return false;
      }
      club.latitude = parsed.lat;
      club.longitude = parsed.lng;
      if (!club.postalCode && parsed.postalCode) {
        club.postalCode = parsed.postalCode;
      }
      if (Object.prototype.hasOwnProperty.call(club, '_distanceCoords')) {
        delete club._distanceCoords;
      }
      return true;
    } catch {
      return false;
    }
  };

  const geocodeClubsBatch = async (clubs, options = {}) => {
    const items = Array.isArray(clubs) ? clubs : [];
    const limit = Number.isFinite(options.limit) ? options.limit : 120;
    const delayMs = Number.isFinite(options.delayMs) ? options.delayMs : 180;
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

  const reverseGeocode = (latitude, longitude) => {
    const lat = Number.parseFloat(latitude);
    const lng = Number.parseFloat(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return Promise.resolve(null);
    }
    const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
    const cached = reverseGeocodeCache.get(key);
    if (cached) {
      if (typeof cached.then === 'function') {
        return cached;
      }
      return Promise.resolve(cached);
    }

    const params = new URLSearchParams({
      format: 'json',
      addressdetails: '1',
      zoom: '13',
      lat: String(lat),
      lon: String(lng),
    });

    const request = fetch(`https://nominatim.openstreetmap.org/reverse?${params.toString()}`, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'echecs92-clubs-fr/1.0 (contact@echecs92.com)',
      },
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.json();
      })
      .then((payload) => {
        if (!payload) {
          return null;
        }
        const postalCodeRaw = payload?.address?.postcode || '';
        const postalCode = postalCodeRaw.split(';')[0].trim();
        const label = formatGeocodeLabel(payload, postalCode) || '';
        return {
          label,
          commune: label || '',
          postalCode,
        };
      })
      .catch(() => null)
      .then((finalResult) => {
        reverseGeocodeCache.set(key, finalResult);
        return finalResult;
      });

    reverseGeocodeCache.set(key, request);
    return request;
  };

  const levenshtein = (a, b) => {
    if (a === b) {
      return 0;
    }
    if (!a.length) {
      return b.length;
    }
    if (!b.length) {
      return a.length;
    }
    const matrix = [];
    for (let i = 0; i <= b.length; i += 1) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j += 1) {
      matrix[0][j] = j;
    }
    for (let i = 1; i <= b.length; i += 1) {
      for (let j = 1; j <= a.length; j += 1) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + 1);
        }
      }
    }
    return matrix[b.length][a.length];
  };

  const scoreClubMatch = (club, terms, fullQuery) => {
    if (!terms.length) {
      return { matched: true, score: 0 };
    }
    const haystack = club._search;
    if (!haystack) {
      return { matched: false, score: 0 };
    }
    let total = 0;
    const tokens = Array.isArray(club._tokens) ? club._tokens : [];

    for (let i = 0; i < terms.length; i += 1) {
      const term = terms[i];
      if (!term) {
        continue;
      }
      if (haystack.includes(term)) {
        total += 4 + Math.min(term.length * 0.2, 2.5);
        continue;
      }
      if (!tokens.length) {
        return { matched: false, score: 0 };
      }
      let bestDistance = Infinity;
      for (let j = 0; j < tokens.length; j += 1) {
        const token = tokens[j];
        if (!token) {
          continue;
        }
        if (token === term) {
          bestDistance = 0;
          break;
        }
        const distance = levenshtein(token, term);
        if (distance < bestDistance) {
          bestDistance = distance;
        }
        if (bestDistance === 0) {
          break;
        }
      }
      if (!Number.isFinite(bestDistance)) {
        return { matched: false, score: 0 };
      }
      const termLength = term.length;
      let threshold = 2;
      if (termLength <= 2) {
        threshold = 0;
      } else if (termLength <= 4) {
        threshold = 1;
      }
      if (bestDistance > threshold) {
        return { matched: false, score: 0 };
      }
      const proximityBoost = Math.max(0, termLength - bestDistance);
      total += 1.5 + proximityBoost * 0.4;
    }

    const fullInName = fullQuery && club._nameSearch && club._nameSearch.includes(fullQuery);
    const startsWithName = fullQuery && club._nameSearch && club._nameSearch.startsWith(fullQuery);
    if (startsWithName) {
      total += 3;
    } else if (fullInName) {
      total += 1.5;
    }

    const addressMatch = fullQuery && club._addressSearch && club._addressSearch.includes(fullQuery);
    if (addressMatch) {
      total += 1;
    }

    return { matched: true, score: total };
  };

  const deriveParisArrPostal = (query) => {
    if (!query) {
      return null;
    }
    const match = query.match(/paris[^0-9]{0,3}(\d{1,2})\s*(?:e|eme|ème|er)?\b/i);
    if (!match || !match[1]) {
      return null;
    }
    const num = Number.parseInt(match[1], 10);
    if (!Number.isFinite(num) || num < 1 || num > 20) {
      return null;
    }
    const postal = `750${num.toString().padStart(2, '0')}`;
    return postal;
  };

  const applySearch = (rawQuery, options = {}) => {
    const displayQuery = typeof options.displayQuery === 'string' ? options.displayQuery : rawQuery;
    const trimmedDisplay = (displayQuery || '').trim();
    const trimmed = (rawQuery || '').trim();
    state.query = trimmedDisplay;
    const normalisedQuery = normaliseForSearch(trimmed);
    const terms = normalisedQuery ? normalisedQuery.split(/\s+/).filter(Boolean) : [];

    state.distanceMode = false;
    state.distanceReference = '';
    state.distanceReferencePostal = '';
    state.distanceReferenceCommune = '';
    state.distanceReferenceType = '';
    state.query = searchInput ? (searchInput.value || '').trim() : '';
    state.clubs.forEach((club) => {
      if (Object.prototype.hasOwnProperty.call(club, 'distanceKm')) {
        delete club.distanceKm;
      }
    });

    if (!terms.length) {
      state.filtered = state.clubs.slice();
    } else {
      const matches = [];
      for (let i = 0; i < state.clubs.length; i += 1) {
        const club = state.clubs[i];
        const { matched, score } = scoreClubMatch(club, terms, normalisedQuery);
        if (matched) {
          matches.push({ club, score });
        }
      }
      matches.sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        return compareClubsByName(a.club, b.club);
      });
      state.filtered = matches.map((entry) => entry.club);
    }

    state.visibleCount = Math.min(VISIBLE_RESULTS_DEFAULT, state.filtered.length);
    renderResults();
    updateTotalCounter();
    updateMonacoBanner();

    return {
      total: state.filtered.length,
      hasQuery: terms.length > 0,
      rawQuery: trimmedDisplay,
    };
  };

  const runDistanceSearch = ({
    latitude,
    longitude,
    label,
    query,
    referencePostalCode,
    referenceCommune,
    referenceType,
  }) => {
    const lat = Number.parseFloat(latitude);
    const lng = Number.parseFloat(longitude);
    const referencePostal = normalisePostalCodeValue(referencePostalCode);
    const referenceCommuneKey = normaliseReferenceCommune(referenceCommune, referencePostal);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      queueMapFocus({ reset: true, source: 'clubs-france', animate: true }, searchRequestId);
      state.filtered = [];
      state.visibleCount = 0;
      state.distanceMode = true;
      state.distanceReference = label || query || '';
      state.distanceReferencePostal = referencePostal;
      state.distanceReferenceCommune = referenceCommuneKey;
      state.distanceReferenceType = referenceType || '';
      renderResults();
      updateTotalCounter();
      updateMonacoBanner();
      return { total: 0, finite: 0, label: state.distanceReference };
    }

    queueMapFocus({
      lat,
      lng,
      label: label || query || '',
      postalCode: referencePostal,
      commune: referenceCommuneKey,
      type: referenceType || 'location',
      source: 'clubs-france',
      animate: shouldAnimateFocus(),
    }, searchRequestId);

    const scored = state.clubs.map((club) => {
      const coords = resolveClubDistanceCoordinates(club);
      const hasCoords = coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lng);
      const usesDeptFallback = coords && coords.precision === 'department';
      let distance = hasCoords ? haversineKm(lat, lng, coords.lat, coords.lng) : Number.POSITIVE_INFINITY;
      if (usesDeptFallback && distance < 1) {
        distance = Number.POSITIVE_INFINITY;
      }
      const onsite = isClubOnsiteWithReference(club, referencePostal, referenceCommuneKey);
      return { club, distance, onsite };
    });

    scored.sort((a, b) => {
      if (a.onsite !== b.onsite) {
        return a.onsite ? -1 : 1;
      }
      if (a.onsite && b.onsite) {
        const totalA = getLicenseCount(a.club, 'total');
        const totalB = getLicenseCount(b.club, 'total');
        if (totalB !== totalA) {
          return totalB - totalA;
        }
        return compareClubsByName(a.club, b.club);
      }
      const aFinite = Number.isFinite(a.distance);
      const bFinite = Number.isFinite(b.distance);
      if (aFinite && bFinite) {
        if (a.distance !== b.distance) {
          return a.distance - b.distance;
        }
        const totalA = getLicenseCount(a.club, 'total');
        const totalB = getLicenseCount(b.club, 'total');
        if (totalB !== totalA) {
          return totalB - totalA;
        }
        return compareClubsByName(a.club, b.club);
      }
      if (aFinite) {
        return -1;
      }
      if (bFinite) {
        return 1;
      }
      return compareClubsByName(a.club, b.club);
    });

    const finiteCount = scored.filter((entry) => Number.isFinite(entry.distance)).length;

    scored.forEach((entry) => {
      if (Number.isFinite(entry.distance)) {
        entry.club.distanceKm = entry.distance;
      } else if (Object.prototype.hasOwnProperty.call(entry.club, 'distanceKm')) {
        delete entry.club.distanceKm;
      }
    });

    state.filtered = scored.map((entry) => entry.club);
    state.distanceMode = true;
    state.distanceReference = label || query || '';
    state.distanceReferencePostal = referencePostal;
    state.distanceReferenceCommune = referenceCommuneKey;
    state.distanceReferenceType = referenceType || '';
    state.query = '';
    state.visibleCount = Math.min(VISIBLE_RESULTS_DEFAULT, state.filtered.length);
    renderResults();
    updateTotalCounter();
    updateMonacoBanner();

    return {
      total: state.filtered.length,
      finite: finiteCount,
      label: state.distanceReference,
      kind: state.distanceReferenceType,
    };
  };

  const performSearch = async (options = {}) => {
    const suppressJump = Boolean(options.suppressJump);
    const forceJump = Boolean(options.forceJump);
    const requestedMinDelay = Number.isFinite(options.minDelay) ? options.minDelay : null;
    const isQuiet = options.quiet === true || state.restoreMode;
    if (!isQuiet && !state.restoreMode) {
      suppressFocusAnimation = false;
    }
    const actionStartedAt = Date.now();
    const raw = searchInput ? searchInput.value : '';
    const trimmed = (raw || '').trim();
    const explicitSortMode =
      typeof options.desiredSortMode === 'string' && options.desiredSortMode.trim()
        ? options.desiredSortMode.trim()
        : null;
    updateClearButtons();
    if (tryHandleSecretCommand(raw)) {
      return;
    }
    const requestId = ++searchRequestId;
    let actionCompleted = false;
    const shouldShowBusy = options.showBusy === true && Boolean(searchButton) && trimmed.length > 0;
    const releaseOverlay = shouldShowBusy ? showLoadingOverlay('Recherche en cours…') : () => {};
    if (shouldShowBusy) {
      deferResultsRendering();
    }
    const releaseSearchFeedback = (() => {
      if (!shouldShowBusy) {
        return () => {};
      }
      const release = beginButtonWait(searchButton, '', { lockClearButtons: true });
      let released = false;
      return () => {
        if (released) {
          return;
        }
        released = true;
        release();
        releaseOverlay();
      };
    })();
    const abortIfStale = () => {
      if (requestId !== searchRequestId) {
        releaseSearchFeedback();
        return true;
      }
      return false;
    };

    const updateStatusIfCurrent = (message, tone = 'info') => {
      if (isQuiet) {
        return;
      }
      if (requestId === searchRequestId) {
        setSearchStatus(message, tone);
      }
    };

    const finalizeSearch = (finalizer, extra = {}) => {
      if (actionCompleted) {
        return;
      }
      actionCompleted = true;
      const mobilePrefersJump = isMobileViewport() && !isQuiet;
      const shouldScroll = extra.skipScroll
        ? mobilePrefersJump
        : forceJump || (!suppressJump && !isQuiet) || mobilePrefersJump;
      const minDelay = Number.isFinite(extra.minDelay)
        ? extra.minDelay
        : isQuiet
        ? 0
        : requestedMinDelay ?? MIN_RESULTS_SCROLL_DELAY_MS;
      const behavior = extra.behavior;
      const margin = extra.margin;
      const run = () => {
      if (requestId === searchRequestId) {
        if (typeof finalizer === 'function') {
          finalizer();
        }
        flushDeferredResultsRendering();
        persistListUiState();
        syncUrlState();
        flushQueuedMapFocus(requestId);
        if (shouldScroll) {
          jumpToResults({ behavior, margin });
        }
      }
      releaseSearchFeedback();
      };
      scheduleAfterMinimumDelay(actionStartedAt, run, minDelay);
    };

    const desiredSortMode = explicitSortMode || (trimmed ? 'default' : DEFAULT_SORT_MODE);
    if (state.sortMode !== desiredSortMode) {
      state.sortMode = desiredSortMode;
      updateSortButtons();
    }

    if (!trimmed) {
      updateStatusIfCurrent('Recherche en cours…', 'info');
      state.query = '';
      state.pendingQuery = '';
      state.clubs.forEach((club) => {
        if (Object.prototype.hasOwnProperty.call(club, 'distanceKm')) {
          delete club.distanceKm;
        }
      });
      if (desiredSortMode === DEFAULT_SORT_MODE && getActiveLicenseSort()) {
        applySortMode({ skipScroll: true, delay: false, quiet: true, forceScroll: false });
      } else {
        applySearch('');
      }
      queueMapFocus({ reset: true, source: 'clubs-france', animate: true }, requestId);
      if (abortIfStale()) {
        return;
      }
      const total = state.filtered.length;
      finalizeSearch(() => {
        if (total > 0) {
          updateStatusIfCurrent('Tous les clubs sont affichés.', 'info');
        } else {
          updateStatusIfCurrent('Aucun club disponible pour le moment.', 'info');
        }
      }, { skipScroll: !forceJump });
      return;
    }

    updateStatusIfCurrent('Recherche en cours…', 'info');

    const picked = pickBestSuggestion(trimmed);
    let suggestion = picked?.suggestion || null;
    let coords = picked?.coords || null;
    if (abortIfStale()) {
      return;
    }

    if ((!suggestion || !coords) && shouldFetchRemoteLocationSuggestions(trimmed)) {
      const remoteSuggestions = await fetchRemoteLocationSuggestions(trimmed).catch(() => []);
      if (abortIfStale()) {
        return;
      }
      if (remoteSuggestions && remoteSuggestions.length) {
        appendLocationSuggestionsToIndex(remoteSuggestions);
        const refreshed = pickBestSuggestion(trimmed);
        suggestion = suggestion || refreshed?.suggestion || null;
        coords = coords || refreshed?.coords || null;
      }
    }

    if (!coords && (suggestion?.postalCode || suggestion?.commune)) {
      const postal = suggestion.postalCode ? canonicalizeParisPostalCode(suggestion.postalCode) || suggestion.postalCode : '';
      const fallbackCoords =
        getPostalCoordinates(postal, suggestion.commune) ||
        getDeptFallbackCoordinates(postal) ||
        (suggestion.commune ? getCommuneCoordinatesByName(suggestion.commune) : null);
      if (fallbackCoords) {
        coords = {
          latitude: fallbackCoords.lat,
          longitude: fallbackCoords.lng,
          label: fallbackCoords.label || suggestion.commune || suggestion.display || trimmed,
          commune: suggestion.commune || fallbackCoords.label || '',
          postalCode: fallbackCoords.postalCode || postal || '',
        };
      }
    }

    if (!suggestion) {
      finalizeSearch(() => {
        updateStatusIfCurrent('Choisissez une suggestion de ville ou code postal.', 'error');
      }, { skipScroll: true });
      return;
    }

    if (!coords) {
      finalizeSearch(() => {
        updateStatusIfCurrent("Coordonnées indisponibles pour cette suggestion.", 'error');
      }, { skipScroll: true });
      return;
    }

    const displayLabel = formatLocationLabel(suggestion.commune, suggestion.postalCode, suggestion.display || trimmed);
    const baseLabel = toDistanceReferenceLabel(displayLabel, coords.postalCode, { type: 'location' });
    const referenceContext = deriveReferenceContext(displayLabel, coords, 'location');
    const decoratedLabel = decorateReferenceLabel(baseLabel, referenceContext.type);

    if (locationInput) {
      locationInput.value = decoratedLabel || displayLabel || trimmed;
    }
    syncPrimarySearchValue(decoratedLabel || displayLabel || trimmed);

    searchRequestId += 1;
    const meta = runDistanceSearch({
      latitude: coords.latitude ?? coords.lat,
      longitude: coords.longitude ?? coords.lng,
      label: decoratedLabel,
      query: trimmed,
      referencePostalCode: referenceContext.postalCode,
      referenceCommune: referenceContext.commune,
      referenceType: referenceContext.type,
    });

    finalizeSearch(() => {
      if (meta.finite > 0) {
        const reference = meta.label || decoratedLabel || displayLabel || trimmed;
        updateStatusIfCurrent(`Clubs triés par distance depuis ${reference}.`, 'info');
      } else {
        updateStatusIfCurrent('Impossible de calculer les distances pour cette localisation.', 'error');
      }
    });
  };


  const resetSearch = () => {
    searchRequestId += 1;
    state.sortMode = DEFAULT_SORT_MODE;
    updateSortButtons();
    handleLocationClear({ skipSearch: true, silent: true });
    clearSearchQuery({ silent: true });
    setLocationStatus('', 'info');
    let total = 0;
    const sorted = applySortMode({ skipScroll: true, delay: false, quiet: true, forceScroll: false });
    if (sorted) {
      total = state.filtered.length;
    } else {
      const meta = applySearch('');
      total = meta.total;
    }
    if (total > 0) {
      setSearchStatus('Recherche réinitialisée. Tous les clubs sont affichés.', 'success');
    } else {
      setSearchStatus('Aucun club disponible pour le moment.', 'info');
    }
    flushDeferredResultsRendering();
    syncUrlState({ openResults: mobileResultsOpen });
  };

  const handleLocationClear = (eventOrOptions) => {
    let options = {};
    let triggeredByEvent = false;
    if (eventOrOptions && typeof eventOrOptions.preventDefault === 'function') {
      eventOrOptions.preventDefault();
      triggeredByEvent = true;
    } else if (eventOrOptions && typeof eventOrOptions === 'object') {
      options = eventOrOptions;
    }
    const silent = Boolean(options.silent);
    const skipSearch = Boolean(options.skipSearch);
    const suppressJump = Boolean(options.suppressJump) || triggeredByEvent;
    locationRequestId += 1;
    state.distanceMode = false;
    state.distanceReference = '';
    state.distanceReferencePostal = '';
    state.distanceReferenceCommune = '';
    state.distanceReferenceType = '';
    state.clubs.forEach((club) => {
      if (Object.prototype.hasOwnProperty.call(club, 'distanceKm')) {
        delete club.distanceKm;
      }
    });
    if (locationInput) {
      locationInput.value = '';
    }
    syncPrimarySearchValue('');
    closeLocationSuggestions();
    queueMapFocus({ reset: true, source: 'clubs-france', animate: true });
    if (skipSearch) {
      flushQueuedMapFocus();
    }
    setLocationStatus(silent ? '' : 'Localisation effacée.', 'info');
    updateClearButtons();
    if (!skipSearch) {
      void performSearch({ suppressJump, desiredSortMode: DEFAULT_SORT_MODE });
    } else {
      syncUrlState();
    }
  };

  const handleLocationSubmit = async (eventOrOptions) => {
    let options = {};
    if (eventOrOptions && typeof eventOrOptions.preventDefault === 'function') {
      eventOrOptions.preventDefault();
    } else if (eventOrOptions && typeof eventOrOptions === 'object') {
      options = eventOrOptions;
    }
    let focusRequestId = null;
    const quiet = options.quiet === true || state.restoreMode;
    if (!quiet && !state.restoreMode) {
      suppressFocusAnimation = false;
    }
    const prefilledCoords = options.prefilledCoords || locationSuggestionCoords;
    const actionButton = options.triggerButton || locationApplyButton;
    if (!locationInput) {
      return { ok: false, reason: 'no-input' };
    }
    let result = { ok: false };
    const raw = locationInput.value.trim();
    const effectiveRaw = stripSelfPositionSuffix(raw);
    dismissMobileSearchKeyboard();
    closeLocationSuggestions();
    if (!raw) {
      handleLocationClear();
      result = { ok: false, cleared: true };
      return result;
    }
    locationSuggestionCoords = null;

    if (!quiet) {
      deferResultsRendering();
    }
    const requestId = ++locationRequestId;
    if (state.sortMode !== 'default') {
      state.sortMode = 'default';
      updateSortButtons();
    }
    clearSearchQuery({ silent: true, keepInput: true });
//    if (!quiet) {
//      setLocationStatus(`Recherche de ${raw}…`, 'info');
//    } else {
//      setLocationStatus('', 'info');
//    }
    const actionStartedAt = Date.now();
    const releaseButton = quiet ? () => {} : beginButtonWait(actionButton, 'Recherche…', { lockClearButtons: true });
    const overlayLabel = raw ? `Recherche autour de ${raw}…` : 'Recherche en cours…';
    const releaseOverlay = quiet ? () => {} : showLoadingOverlay(overlayLabel);
    const releaseLocationUi = (() => {
      let released = false;
      return (options = {}) => {
        if (released) {
          return;
        }
        released = true;
        const runRelease = () => {
          releaseButton();
          releaseOverlay();
        };
        if (options.delay === false) {
          runRelease();
        } else {
          scheduleAfterMinimumDelay(actionStartedAt, runRelease);
        }
      };
    })();
    let locationActionFinalized = false;
    const finalizeLocationSearch = (finalizer, options = {}) => {
      if (locationActionFinalized) {
        return;
      }
      locationActionFinalized = true;
      const shouldScroll = options.scroll === true && !quiet;
      const run = () => {
        if (requestId !== locationRequestId) {
          releaseLocationUi({ delay: false });
          return;
        }
        if (typeof finalizer === 'function') {
          finalizer();
        }
        flushDeferredResultsRendering();
        persistListUiState();
        syncUrlState();
        if (typeof flushQueuedMapFocus === 'function') {
          flushQueuedMapFocus(focusRequestId);
        }
        if (shouldScroll) {
          jumpToResults();
        }
        releaseLocationUi({ delay: false });
      };
      scheduleAfterMinimumDelay(actionStartedAt, run);
    };

    try {
      const prefilledLat = Number.parseFloat(prefilledCoords?.latitude ?? prefilledCoords?.lat);
      const prefilledLng = Number.parseFloat(prefilledCoords?.longitude ?? prefilledCoords?.lng);
      let suggestion = null;
      let coords = null;

      if (Number.isFinite(prefilledLat) && Number.isFinite(prefilledLng)) {
        coords = {
          latitude: prefilledLat,
          longitude: prefilledLng,
          label: prefilledCoords.display || prefilledCoords.commune || prefilledCoords.postalCode || raw,
          postalCode: prefilledCoords.postalCode || '',
          commune: prefilledCoords.commune || '',
          source: 'suggestion',
        };
        suggestion = prefilledCoords;
      } else {
        const picked = pickBestSuggestion(effectiveRaw);
        if (picked) {
          suggestion = picked.suggestion || null;
          coords = picked.coords || null;
        }
        if (!suggestion || !coords) {
          const remoteSuggestions = await fetchRemoteLocationSuggestions(effectiveRaw).catch(() => []);
          if (requestId !== locationRequestId) {
            result = { ok: false, reason: 'stale' };
            return result;
          }
          if (remoteSuggestions && remoteSuggestions.length) {
            appendLocationSuggestionsToIndex(remoteSuggestions);
            const pickedRemote = pickBestSuggestion(effectiveRaw);
            if (pickedRemote) {
              suggestion = suggestion || pickedRemote.suggestion || null;
              coords = coords || pickedRemote.coords || null;
            }
          }
        }
      }

      if (requestId !== locationRequestId) {
        result = { ok: false, reason: 'stale' };
        return result;
      }

      if (!suggestion) {
        finalizeLocationSearch(() => {
          setLocationStatus('Choisissez une suggestion de ville ou code postal.', 'error');
          setSearchStatus('Choisissez une suggestion de ville ou code postal.', 'error');
        });
        result = { ok: false, reason: 'no-suggestion' };
        return result;
      }

      if (!coords) {
        finalizeLocationSearch(() => {
          setLocationStatus('Coordonnées indisponibles pour cette suggestion.', 'error');
          setSearchStatus('Coordonnées indisponibles pour cette suggestion.', 'error');
        });
        result = { ok: false, reason: 'no-coordinates' };
        return result;
      }

      const displayLabel = formatLocationLabel(suggestion.commune, suggestion.postalCode, suggestion.display || raw);
      const referenceType = 'location';
      const baseLabel = toDistanceReferenceLabel(displayLabel, coords.postalCode, { type: referenceType });
      const referenceContext = deriveReferenceContext(displayLabel, coords, referenceType);
      const decoratedLabel = decorateReferenceLabel(baseLabel, referenceContext.type);
      const redirectLabel = displayLabel || suggestion.display || raw;
      const outOfScopePostal =
        referenceContext.postalCode ||
        coords.postalCode ||
        suggestion.postalCode ||
        '';
      if (await maybeRedirectToFrance({ label: redirectLabel, postalCode: outOfScopePostal })) {
        result = { ok: false, redirected: true };
        return result;
      }

      if (locationInput) {
        locationInput.value = decoratedLabel || displayLabel || raw;
      }
      syncPrimarySearchValue(decoratedLabel || displayLabel || raw);

      expandOptionsPanel();
      ensureDistanceSectionOpen();

      searchRequestId += 1;
      const focusRequestId = searchRequestId;
      const meta = runDistanceSearch({
        latitude: coords.latitude ?? coords.lat,
        longitude: coords.longitude ?? coords.lng,
        label: decoratedLabel,
        query: raw,
        referencePostalCode: referenceContext.postalCode,
        referenceCommune: referenceContext.commune,
        referenceType: referenceContext.type,
      });

      const success = meta && meta.total > 0;
      result = { ok: success, meta };
      if (meta.finite > 0) {
        const reference = meta.label || decoratedLabel || raw;
        finalizeLocationSearch(() => {
          setLocationStatus('', 'info');
          setSearchStatus('', 'info');
        }, { scroll: true, focusRequestId });
      } else {
        finalizeLocationSearch(() => {
          setLocationStatus('Impossible de calculer les distances pour cette localisation.', 'error');
        }, { focusRequestId });
      }
    } finally {
      releaseLocationUi();
    }
    return result;
  };

  const handleUseGeolocation = () => {
    if (!navigator.geolocation) {
      expandOptionsPanel();
      ensureDistanceSectionOpen();
      setLocationStatus('Géolocalisation indisponible sur cet appareil.', 'error');
      return;
    }

    if (!state.restoreMode) {
      suppressFocusAnimation = false;
    }

    closeLocationSuggestions();
    const requestId = ++locationRequestId;
    if (state.sortMode !== 'default') {
      state.sortMode = 'default';
      updateSortButtons();
    }
    clearSearchQuery({ silent: true });
    setLocationStatus('', 'info');
    const releaseButton = () => {};
    const releaseOverlay = state.restoreMode ? () => {} : showLoadingOverlay('Recherche de votre position…');
    const releaseGeolocUi = (() => {
      let released = false;
      return () => {
        if (released) {
          return;
        }
        released = true;
        releaseOverlay();
      };
    })();
    let geolocActionFinalized = false;
    const finalizeGeolocSearch = (finalizer, options = {}) => {
      if (geolocActionFinalized) {
        return;
      }
      geolocActionFinalized = true;
      const shouldScroll = options.scroll === true && !state.restoreMode;
      const run = () => {
        if (requestId !== locationRequestId) {
          releaseGeolocUi();
          return;
        }
        if (typeof finalizer === 'function') {
          finalizer();
        }
        flushDeferredResultsRendering();
        persistListUiState();
        syncUrlState();
        flushQueuedMapFocus(options.focusRequestId);
        if (shouldScroll) {
          jumpToResults();
        }
        releaseGeolocUi();
      };
      run();
    };

    const handleGeolocError = (error) => {
      let message = 'Impossible de récupérer votre position.';
      if (error && typeof error.code === 'number') {
        if (error.code === 1) {
          message = 'Accès à la localisation refusé. Autorisez la localisation.';
        } else if (error.code === 2) {
          message = 'Position indisponible pour le moment. Réessayez ou saisissez une ville.';
        } else if (error.code === 3) {
          message = 'La recherche de position a expiré. Réessayez ou saisissez une ville.';
        }
      }
      expandOptionsPanel();
      ensureDistanceSectionOpen();
      finalizeGeolocSearch(() => {
        setLocationStatus(message, 'error');
        setSearchStatus(message, 'error');
      });
      releaseButton();
      releaseGeolocUi();
    };

    try {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          reverseGeocode(latitude, longitude)
            .catch(() => null)
            .then(async (place) => {
              if (requestId !== locationRequestId) {
                releaseButton();
                releaseGeolocUi();
                return;
              }

              const referenceType = 'geoloc';
              const baseLabel = toDistanceReferenceLabel(
                place?.label || 'votre position',
                place?.postalCode,
                { type: referenceType }
              );
              const referenceContext = deriveReferenceContext(place?.label || '', place || {}, referenceType);
              const decoratedLabel = decorateReferenceLabel(baseLabel, referenceContext.type);
              const redirectLabel = place?.label || place?.postalCode || 'votre position';
              const outOfScopePostal = referenceContext.postalCode || place?.postalCode || '';
              if (await maybeRedirectToFrance({ label: redirectLabel, postalCode: outOfScopePostal })) {
                return;
              }

              if (locationInput) {
                locationInput.value = decoratedLabel || place?.label || '';
              }
              syncPrimarySearchValue(decoratedLabel || place?.label || '');

              expandOptionsPanel();
              ensureDistanceSectionOpen();

              searchRequestId += 1;
              const focusRequestId = searchRequestId;
              const meta = runDistanceSearch({
                latitude,
                longitude,
                label: decoratedLabel,
                query: place?.label || 'votre position',
                referencePostalCode: referenceContext.postalCode,
                referenceCommune: referenceContext.commune,
                referenceType: referenceContext.type,
              });

              if (meta.finite > 0) {
                const reference = meta.label || decoratedLabel || 'votre position';
                finalizeGeolocSearch(() => {
                  setLocationStatus('', 'info');
                  setSearchStatus('', 'info');
                }, { scroll: true, focusRequestId });
              } else {
                finalizeGeolocSearch(() => {
                  setLocationStatus('Impossible de calculer les distances pour cette localisation.', 'error');
                }, { focusRequestId });
              }
            })
            .finally(() => {
              releaseButton();
              releaseGeolocUi();
            });
        },
        handleGeolocError,
        {
          enableHighAccuracy: false,
          timeout: 10000,
        }
      );
    } catch (error) {
      handleGeolocError(error);
    }
  };

  const submitPrimaryLocationSearch = () => {
    if (!searchInput) {
      return;
    }
    const raw = searchInput.value.trim();
    if (tryHandleSecretCommand(raw)) {
      return;
    }
    if (!raw) {
      handleLocationClear({ suppressJump: true, silent: true });
      return;
    }
    if (locationInput && locationInput !== searchInput) {
      locationInput.value = raw;
    }
    dismissMobileSearchKeyboard();
    closeLocationSuggestions();
    void handleLocationSubmit({ fromPrimary: true, triggerButton: searchButton });
  };

  const setCinemaDocumentMode = (mode) => {
    if (typeof document === 'undefined') {
      return;
    }
    const root = document.documentElement;
    if (!root) {
      return;
    }
    if (mode === 'prep') {
      root.classList.add('cdje92-cinema-prep');
      root.classList.remove('cdje92-cinema-revealing');
      return;
    }
    if (mode === 'revealing') {
      root.classList.add('cdje92-cinema-revealing');
      root.classList.add('cdje92-cinema-prep');
      return;
    }
    root.classList.remove('cdje92-cinema-revealing');
    root.classList.remove('cdje92-cinema-prep');
  };

  const removeCinemaOverlay = () => {
    if (!cinemaOverlayElement) {
      cinemaOverlayElement = typeof document !== 'undefined' ? document.getElementById(CINEMA_OVERLAY_ID) : null;
    }
    if (cinemaOverlayElement && cinemaOverlayElement.parentNode) {
      cinemaOverlayElement.parentNode.removeChild(cinemaOverlayElement);
    }
    cinemaOverlayElement = null;
  };

  const ensureCinemaOverlay = () => {
    if (typeof document === 'undefined' || !document.body) {
      return null;
    }
    if (!cinemaOverlayElement) {
      cinemaOverlayElement = document.getElementById(CINEMA_OVERLAY_ID);
    }
    if (cinemaOverlayElement) {
      return cinemaOverlayElement;
    }
    const overlay = document.createElement('div');
    overlay.id = CINEMA_OVERLAY_ID;
    overlay.className = 'cdje92-cinema-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML =
      '<span class="cdje92-cinema-overlay__code" data-code="404">' +
      '<span class="cdje92-cinema-overlay__code-char">4</span>' +
      '<span class="cdje92-cinema-overlay__code-char">0</span>' +
      '<span class="cdje92-cinema-overlay__code-char">4</span>' +
      '</span>';
    document.body.appendChild(overlay);
    cinemaOverlayElement = overlay;
    return overlay;
  };

  const markCinemaRevealTargets = () => {
    const targets = [];
    const addTarget = (node) => {
      if (!node || !(node instanceof Element)) {
        return;
      }
      if (targets.includes(node)) {
        return;
      }
      targets.push(node);
    };

    addTarget(document.querySelector('header.wp-block-template-part') || document.querySelector('.wp-site-blocks > header') || document.querySelector('header'));
    if (clubsScopeBanner) {
      addTarget(clubsScopeBanner);
    }
    if (clubsPageShell) {
      addTarget(clubsPageShell.querySelector('h1'));
      addTarget(searchBlock);
      addTarget(clubsPageShell.querySelector('.clubs-map-section'));
      addTarget(resultsShell);
    }
    addTarget(document.querySelector('footer.wp-block-template-part') || document.querySelector('.wp-site-blocks > footer') || document.querySelector('footer'));

    targets.forEach((target, index) => {
      target.setAttribute('data-cdje92-cinema-item', '1');
      target.style.setProperty('--cdje92-cinema-index', String(index));
    });

    return targets;
  };

  const clearCinemaRevealTargets = () => {
    if (typeof document === 'undefined') {
      return;
    }
    const nodes = document.querySelectorAll('[data-cdje92-cinema-item]');
    nodes.forEach((node) => {
      node.classList.remove('is-cdje92-cinema-visible');
      node.removeAttribute('data-cdje92-cinema-item');
      node.style.removeProperty('--cdje92-cinema-index');
    });
  };

  const prepareCinemaEntryStage = () => {
    if (!shouldRunCinemaEntry) {
      return;
    }
    setCinemaDocumentMode('prep');
    if (clubsPageShell) {
      clubsPageShell.classList.add('cdje92-cinema-entry');
    }
    ensureCinemaOverlay();
  };

  const endCinemaEntryStage = () => {
    setCinemaDocumentMode('ready');
    clearCinemaRevealTargets();
    if (clubsPageShell) {
      clubsPageShell.classList.remove('cdje92-cinema-entry');
    }
    removeCinemaOverlay();
  };

  const runCinemaEntryReveal = () =>
    new Promise((resolve) => {
      if (!shouldRunCinemaEntry) {
        resolve(false);
        return;
      }
      const overlay = ensureCinemaOverlay();
      const targets = markCinemaRevealTargets();
      if (overlay) {
        overlay.classList.remove('is-revealing');
        overlay.classList.remove('is-exit');
        overlay.classList.add('is-active');
      }

      window.setTimeout(() => {
        setCinemaDocumentMode('revealing');
        if (overlay) {
          overlay.classList.add('is-revealing');
        }

        const revealCount = targets.length;
        targets.forEach((target, index) => {
          const jitter = Math.max(0, Math.round(Math.random() * 90 - 20));
          const delay = CINEMA_REVEAL_BASE_DELAY_MS + index * CINEMA_REVEAL_STEP_MS + jitter;
          window.setTimeout(() => {
            target.classList.add('is-cdje92-cinema-visible');
          }, delay);
        });

        const revealDoneDelay = CINEMA_REVEAL_BASE_DELAY_MS + Math.max(0, revealCount - 1) * CINEMA_REVEAL_STEP_MS + 760;
        window.setTimeout(() => {
          if (overlay) {
            overlay.classList.add('is-exit');
            window.setTimeout(() => {
              removeCinemaOverlay();
            }, 980);
          }
          setCinemaDocumentMode('ready');
          if (clubsPageShell) {
            clubsPageShell.classList.remove('cdje92-cinema-entry');
          }
          resolve(true);
        }, revealDoneDelay);
      }, CINEMA_PROLOGUE_DURATION_MS);
    });

  const runCinemaQueryReveal = () =>
    new Promise((resolve) => {
      if (!searchInput) {
        resolve(false);
        return;
      }

      const query = (CINEMA_AUTOTYPE_QUERY || '').trim();
      if (!query) {
        resolve(false);
        return;
      }

      searchInput.value = '';
      updateClearButtons();
      closeLocationSuggestions();
      dismissMobileSearchKeyboard();

      searchInput.classList.remove(CINEMA_QUERY_APPEAR_CLASS);
      searchInput.classList.remove(CINEMA_QUERY_FOCUS_CLASS);
      void searchInput.offsetWidth;

      window.setTimeout(() => {
        searchInput.value = query;
        updateClearButtons();
        searchInput.classList.add(CINEMA_QUERY_APPEAR_CLASS);
        searchInput.classList.add(CINEMA_QUERY_FOCUS_CLASS);

        window.setTimeout(() => {
          searchInput.classList.remove(CINEMA_QUERY_APPEAR_CLASS);
          searchInput.classList.remove(CINEMA_QUERY_FOCUS_CLASS);
          resolve(true);
        }, CINEMA_QUERY_FOCUS_DURATION_MS);
      }, CINEMA_QUERY_REVEAL_DELAY_MS);
    });

  const runCinemaEntryFlow = async () => {
    if (!shouldRunCinemaEntry || cinemaFlowConsumed) {
      return;
    }
    cinemaFlowConsumed = true;
    await runCinemaEntryReveal();
    await runCinemaQueryReveal();
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
    const slugAddressParts = extractAddressPartsForSlug(primaryAddress || secondaryAddress);
    const slugSecondaryParts = extractAddressPartsForSlug(secondaryAddress);
    const postalCode =
      raw.code_postal ||
      raw.postal_code ||
      raw.postalCode ||
      addressParts.postalCode ||
      secondaryParts.postalCode ||
      '';
    const slugPostalForCommune = postalCode || slugAddressParts.postalCode || slugSecondaryParts.postalCode || '';
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
    const slugCommuneCandidates = [
      raw.commune,
      raw.ville,
      slugAddressParts.city,
      slugSecondaryParts.city,
      deriveCityFromPostalForSlug(primaryAddress, slugPostalForCommune),
      deriveCityFromPostalForSlug(secondaryAddress, slugPostalForCommune),
    ];
    const slugBaseCommune = dedupeCommuneLabel(pickBestCommuneForSlug(slugCommuneCandidates, slugPostalForCommune));
    const slugCommune = formatCommuneWithPostal(slugBaseCommune, slugPostalForCommune);
    const slugSource = name || commune || postalForCommune || primaryAddress || secondaryAddress;
    const streetHint = primaryAddressMeta.streetLike || secondaryAddressMeta.streetLike || '';
    const standardAddress = buildStandardAddress(
      streetHint,
      secondaryAddress,
      postalCode,
      commune || baseCommune || addressParts.city || secondaryParts.city || ''
    );
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
	      salle: normaliseDashes(raw.salle_jeu || raw.salle || ''),
	      addressStandard: standardAddress,
	      phone: normaliseDashes(raw.telephone || raw.phone || ''),
	      fax: normaliseDashes(raw.fax || ''),
	      email: normaliseDashes(raw.email || ''),
	      site,
	      president: normaliseDashes(raw.president || ''),
	      presidentEmail: normaliseDashes(raw.president_email || raw.presidentEmail || ''),
	      contact: normaliseDashes(raw.contact || ''),
	      contactEmail: normaliseDashes(raw.contact_email || raw.contactEmail || ''),
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
      _slugCommune: slugCommune || '',
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

  const refreshClubIndexes = (club, options = {}) => {
    if (!club || typeof club !== 'object') {
      return;
    }
    const licenseA = Number.parseInt(club.licenses?.A, 10);
    const licenseB = Number.parseInt(club.licenses?.B, 10);
    const totalLicenses =
      (Number.isFinite(licenseA) ? licenseA : 0) + (Number.isFinite(licenseB) ? licenseB : 0);
    club.totalLicenses = totalLicenses > 0 ? totalLicenses : null;
    const tagsText = Array.isArray(club.tags) ? club.tags.filter(Boolean).join(' ') : '';
    const nameAcronym = buildAcronym(club.name || '');
    const slugAlias = slugify(club.slug || '');
    const displayAddress = club.addressStandard || club.address || club.siege || '';
    const trimmedAddress = stripAddressLocality(displayAddress, club.commune, club.postalCode);
    club.addressDisplay = trimmedAddress || displayAddress;
    const searchSource = [club.name, nameAcronym, slugAlias, club.addressDisplay, tagsText]
      .filter(Boolean)
      .join(' ');
    const searchIndex = normaliseForSearch(searchSource);
    club._search = searchIndex;
    club._tokens = searchIndex ? searchIndex.split(/\s+/) : [];
    const nameAliases = [club.name, nameAcronym]
      .concat(Array.isArray(club.tags) ? club.tags : [])
      .filter(Boolean);
    club._nameSearch = normaliseForSearch(nameAliases.filter(Boolean).join(' '));
    club._addressSearch = normaliseForSearch(club.addressDisplay || displayAddress || '');
    const preserveSlug = options.preserveSlug === true;
    if (!preserveSlug || !club._communeSlug) {
      const communeSlugSource = club._slugCommune || club.commune || club.name || club.id;
      club._communeSlug = slugify(communeSlugSource || club.id || club.name || 'club');
    }
  };

  const hydrateClub = (raw) => {
    const club = { ...adaptClubRecord(raw) };
    refreshClubIndexes(club);
    return club;
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
      assignIfPresent(club, 'phone', ffeClub.phone);
      assignIfPresent(club, 'fax', ffeClub.fax);
      assignIfPresent(club, 'email', ffeClub.email);
      assignIfPresent(club, 'site', ffeClub.site);
      assignIfPresent(club, 'president', ffeClub.president);
      assignIfPresent(club, 'presidentEmail', ffeClub.presidentEmail);
      assignIfPresent(club, 'contact', ffeClub.contact);
      assignIfPresent(club, 'contactEmail', ffeClub.contactEmail);
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
      if (ffeClub.licenses) {
        club.licenses = club.licenses || {};
        if (ffeClub.licenses.A != null && ffeClub.licenses.A !== '') {
          club.licenses.A = ffeClub.licenses.A;
        }
        if (ffeClub.licenses.B != null && ffeClub.licenses.B !== '') {
          club.licenses.B = ffeClub.licenses.B;
        }
      }
    });
  };

  const resolveClubSlug = (club) => {
    if (!club) {
      return '';
    }
    if (typeof club === 'string' || typeof club === 'number') {
      return String(club);
    }
    return club.slug || club._communeSlug || club.id || slugify(club.name || '') || '';
  };

  const getClubDetailUrl = (clubId) => {
    const slug = resolveClubSlug(clubId);
    if (!slug) {
      return '#';
    }
    const base = detailBase || '';
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

  const createResultRow = (club) => {
    const article = document.createElement('article');
    article.className = 'club-row';
    article.dataset.clubId = club.id;
    article.setAttribute('role', 'listitem');

    const cardLink = document.createElement('a');
    cardLink.className = 'club-row__card';
    cardLink.href = getClubDetailUrl(club);
    cardLink.setAttribute('aria-label', `Voir la fiche du club ${club.name}`);

    const handleNavigationIntent = (event) => {
      if (event.type === 'auxclick' && event.button !== 1) {
        return;
      }
      const isPrimaryClick =
        event.type === 'click' && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
      if (isPrimaryClick) {
        const scrollContext = getListScrollContext();
        const scrollTop = getListScrollTop(scrollContext);
        const scrollRestorable = !isElementVisibleAtAnchor(cardLink, scrollContext);
        const navigationState = { scrollContext, scrollTop, scrollRestorable };
        pendingNavigationState = navigationState;
        persistListState(navigationState);
      } else {
        persistListState();
      }
      persistListUiState();
      if (isPrimaryClick) {
        markShouldRestoreUiState();
        markShouldReopenResults();
      }
      rememberClubsNavigation('detail:list', getCurrentBackPath());
    };

    const handleDebugDoubleClick = (event) => {
      if (!isDebugMode()) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      openClubDebugView(club);
    };

    cardLink.addEventListener('click', handleNavigationIntent);
    cardLink.addEventListener('auxclick', handleNavigationIntent);
    cardLink.addEventListener('dblclick', handleDebugDoubleClick);

    const header = document.createElement('div');
    header.className = 'club-row__top';

    const heading = document.createElement('div');
    heading.className = 'club-row__heading';
    header.appendChild(heading);

    const title = document.createElement('h2');
    title.className = 'club-row__name';
    title.textContent = club.name;
    heading.appendChild(title);

    if (club.commune) {
      const communeNode = document.createElement('span');
      communeNode.className = 'club-row__commune';
      communeNode.textContent = club.commune;
      heading.appendChild(communeNode);
    }

    const badges = document.createElement('div');
    badges.className = 'club-row__badges';
    let hasBadges = false;

    const appendBadge = (text, tone) => {
      if (!text) {
        return;
      }
      const badgeNode = document.createElement('span');
      badgeNode.className = 'club-row__distance';
      if (tone && tone !== 'default') {
        badgeNode.dataset.tone = tone;
      }
      badgeNode.textContent = text;
      badges.appendChild(badgeNode);
      hasBadges = true;
    };

    const onsite = isClubOnsite(club);
    if (state.distanceMode && (Number.isFinite(club.distanceKm) || onsite)) {
      const distanceInfo = formatDistanceLabel(club.distanceKm, { onsite });
      if (distanceInfo.text) {
        appendBadge(distanceInfo.text, distanceInfo.tone);
      }
    }

    const hasLicenseData =
      Number.isFinite(club.totalLicenses) ||
      Number.isFinite(club.licenses?.A) ||
      Number.isFinite(club.licenses?.B);

    if (hasLicenseData) {
      const licenseSort = getActiveLicenseSort();
      const licenseValueKey = licenseSort ? licenseSort.valueKey : 'total';
      const licenseValue = getLicenseCount(club, licenseValueKey);
      const licenseBadgeText =
        typeof licenseSort?.formatBadge === 'function'
          ? licenseSort.formatBadge(licenseValue, club)
          : Number.isFinite(licenseValue)
          ? `${licenseValue} lic.`
          : '';
      if (licenseBadgeText) {
        appendBadge(licenseBadgeText, 'licenses');
      }
    }

    if (hasBadges) {
      header.appendChild(badges);
    }

    cardLink.appendChild(header);

    const displayAddress = club.addressDisplay || club.address || club.siege || '';

    const footer = document.createElement('div');
    footer.className = 'club-row__footer';

    const cta = document.createElement('span');
    cta.className = 'club-row__cta';
    cta.textContent = 'Voir la fiche du club';
    footer.appendChild(cta);

    cardLink.appendChild(footer);

    if (isDebugMode()) {
      const debugBar = document.createElement('div');
      debugBar.className = 'club-row__debug';
      debugBar.style.marginTop = '8px';
      debugBar.style.padding = '8px';
      debugBar.style.border = '1px dashed #dc3545';
      debugBar.style.borderRadius = '8px';
      debugBar.style.background = 'rgba(220, 53, 69, 0.05)';
      debugBar.style.display = 'flex';
      debugBar.style.flexWrap = 'wrap';
      debugBar.style.gap = '8px';
      debugBar.style.alignItems = 'center';

      const resolved = resolveClubDistanceCoordinates(club);
      const lat = Number.isFinite(resolved?.lat)
        ? resolved.lat
        : Number.isFinite(club.latitude)
        ? club.latitude
        : Number.parseFloat(club.lat);
      const lng = Number.isFinite(resolved?.lng)
        ? resolved.lng
        : Number.isFinite(club.longitude)
        ? club.longitude
        : Number.parseFloat(club.lng ?? club.lon);
      const coordsText =
        Number.isFinite(lat) && Number.isFinite(lng)
          ? `${lat.toFixed(5)}, ${lng.toFixed(5)}`
          : 'Coordonnées indisponibles';

      const coordsLabel = document.createElement('span');
      coordsLabel.textContent = `Coords: ${coordsText}`;
      coordsLabel.style.fontSize = '13px';
      coordsLabel.style.fontWeight = '600';
      debugBar.appendChild(coordsLabel);

      if (displayAddress) {
        const addressLabel = document.createElement('span');
        addressLabel.textContent = `Adresse: ${displayAddress}`;
        addressLabel.style.fontSize = '13px';
        debugBar.appendChild(addressLabel);
      }

      const debugButton = document.createElement('button');
      debugButton.type = 'button';
      debugButton.textContent = 'Carte & coords';
      debugButton.style.border = '1px solid #dc3545';
      debugButton.style.background = '#fff';
      debugButton.style.color = '#dc3545';
      debugButton.style.borderRadius = '999px';
      debugButton.style.padding = '4px 12px';
      debugButton.style.fontSize = '13px';
      debugButton.style.cursor = 'pointer';
      debugButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openClubDebugView(club);
      });
      debugBar.appendChild(debugButton);

      cardLink.appendChild(debugBar);
    }

    article.appendChild(cardLink);

    return article;
  };

  function updateTotalCounter() {
    if (!totalCounter) {
      return;
    }

    totalCounter.removeAttribute('aria-hidden');
    totalCounter.style.display = '';

    if (totalCounterPlaceholderActive && totalCounterPlaceholderText) {
      totalCounter.textContent = totalCounterPlaceholderText;
      return;
    }

    const statusMessages = [];
    if (state.statusMessage) {
      statusMessages.push(state.statusMessage);
    }
    if (state.locationMessage && state.locationMessage !== state.statusMessage) {
      statusMessages.push(state.locationMessage);
    }
    if (statusMessages.length) {
      totalCounter.textContent = statusMessages.join(' · ');
      return;
    }

    const distanceLabel =
      state.distanceMode && state.distanceReference ? `Distances depuis ${state.distanceReference}` : '';

    if (distanceLabel) {
      totalCounter.textContent = distanceLabel;
      return;
    }

    pendingTotalCounterText = null;
    totalCounterPlaceholderActive = false;
    totalCounter.classList.remove('is-deferred');

    const total = state.clubs.length;
    const filtered = state.filtered.length;
    const visible = Math.min(state.visibleCount, filtered);
    const activeLicenseSort = getActiveLicenseSort();

    if (!total) {
      totalCounter.textContent = 'Aucun club disponible pour le moment.';
      return;
    }

    if (!filtered) {
      const parts = ['Aucun club trouvé', `${total} au total`];
      if (distanceLabel) {
        parts.splice(1, 0, distanceLabel);
      }
      if (activeLicenseSort) {
        parts.push(activeLicenseSort.counterLabel);
      } else if (state.sortMode === 'alpha') {
        parts.push('ordre alphabétique');
      }
      const sentence = parts.join(' · ');
      const appendPeriod = !distanceLabel;
      totalCounter.textContent = appendPeriod ? `${sentence}.` : sentence;
      return;
    }

    const parts = [];
    const scopeSuffix = scopeLabel ? ` ${scopeLabel}` : '';
    if (filtered === total && visible >= filtered) {
      parts.push(`${filtered} club${filtered > 1 ? 's' : ''}${scopeSuffix}`);
    } else {
      parts.push(`${filtered} trouvé${filtered > 1 ? 's' : ''} sur ${total}`);
    }
    if (distanceLabel) {
      parts.push(distanceLabel);
    }
    if (activeLicenseSort) {
      parts.push(activeLicenseSort.counterLabel);
    } else if (state.sortMode === 'alpha') {
      parts.push('ordre alphabétique');
    }
    const sentence = parts.join(' · ');
    const appendPeriod = !distanceLabel;
    totalCounter.textContent = appendPeriod ? `${sentence}.` : sentence;
  }

  const renderResults = (options = {}) => {
    const settings = { ...(options || {}) };
    const forceRender = Boolean(settings.force);
    delete settings.force;
    if (renderUpdatesDeferred && !forceRender) {
      pendingRenderOptions = settings;
      pendingRenderUpdate = true;
      return;
    }
    pendingRenderOptions = null;
    pendingRenderUpdate = false;
    if (!resultsEl) {
      return;
    }

    if (!state.filtered.length) {
      const message = state.clubs.length
        ? 'Aucun club ne correspond à votre recherche.'
        : 'Aucune fiche club à afficher.';
      resultsEl.innerHTML = `<p class="clubs-empty">${message}</p>`;
      if (moreButton) {
        moreButton.hidden = true;
      }
      updateTotalCounter();
      return;
    }

    const fragment = document.createDocumentFragment();
    const visible = Math.min(state.visibleCount, state.filtered.length);
    state.filtered.slice(0, visible).forEach((club) => {
      fragment.appendChild(createResultRow(club));
    });

	    resultsEl.innerHTML = '';
	    resultsEl.appendChild(fragment);
	    syncScopeTailBanner();

	    if (moreButton) {
	      if (visible < state.filtered.length) {
	        const remaining = state.filtered.length - visible;
        const batch = Math.min(VISIBLE_RESULTS_STEP, remaining);
        moreButton.hidden = false;
        moreButton.textContent = `Afficher ${batch} autre${batch > 1 ? 's' : ''} club${batch > 1 ? 's' : ''}`;
      } else {
        moreButton.hidden = true;
      }
    }
    updateTotalCounter();
  };

  const showAllResults = () => {
    if (!state.filtered.length) {
      return;
    }
    const remaining = state.filtered.length - state.visibleCount;
    if (remaining <= 0) {
      return;
    }
    const increment = Math.min(VISIBLE_RESULTS_STEP, remaining);
    state.visibleCount += increment;
    renderResults();
    updateTotalCounter();
    persistListState({ visibleCount: state.visibleCount });
    if (state.visibleCount >= state.filtered.length) {
      if (state.query) {
        setSearchStatus('Tous les clubs correspondants sont affichés.', 'info');
      } else {
        setSearchStatus('Tous les clubs sont affichés.', 'info');
      }
    } else {
      setSearchStatus(
        `${increment} club${increment > 1 ? 's' : ''} supplémentaire${increment > 1 ? 's' : ''} affiché${
          increment > 1 ? 's' : ''
        }.`,
        'info'
      );
    }
  };

  const init = () => {
    const shouldRestoreSessionState = !initialCinemaPrefillValue && shouldRestoreSessionStateOnLoad();
    if (!shouldRestoreSessionState) {
      clearSessionRestoreState();
    }
    const savedListState = shouldRestoreSessionState ? loadListState() : null;
    updateListScrollAnchor('window');
    updateClearButtons();
    ensureLocationSuggestionsHost();
    loadGeocodeCache();
    initialiseLocationControls();
    syncDistanceCollapse();
    syncResultsShellToViewport();
    if (shouldRunCinemaEntry) {
      prepareCinemaEntryStage();
    } else {
      requestPrimarySearchFocus({ force: true });
    }
    setupPrimarySearchFallbackFocus();
    if (mobileViewportQuery) {
      const listener = () => {
        syncDistanceCollapse();
        syncResultsShellToViewport();
      };
      if (typeof mobileViewportQuery.addEventListener === 'function') {
        mobileViewportQuery.addEventListener('change', listener);
      } else if (typeof mobileViewportQuery.addListener === 'function') {
        mobileViewportQuery.addListener(listener);
      }
    }
    bindMapCtaNavigation();
    setSearchStatus('Chargement de la liste des clubs…', 'info');

    state.restoreMode = true;
    const releaseInitOverlay = shouldRunCinemaEntry ? () => {} : showLoadingOverlay('Chargement des clubs…');
    Promise.all([loadFranceClubsDataset(), loadStaticGeoHints(), loadPostalCoordinatesIndex(), loadFfeDetails()])
      .then(async ([payload, staticHints, _postalCoordinates, ffeDetails]) => {
        const data = Array.isArray(payload) ? payload : [];
        const clubs = data.map(hydrateClub);
        if (Array.isArray(ffeDetails) && ffeDetails.length) {
          applyFfeDetails(clubs, buildFfeDetailsLookup(ffeDetails));
          clubs.forEach((club) => refreshClubIndexes(club, { preserveSlug: true }));
        }
        state.clubs = clubs.sort((a, b) => compareClubsByName(a, b));
        ensureUniqueSlugs(state.clubs);
        applyStaticHints(state.clubs, staticHints);
        buildLocationSuggestionIndex(state.clubs);

        const rawReopenFlag = consumeReopenResultsFlag();
        const rawRestoreUiRequested = consumeRestoreUiState();
        const reopenResultsRequested = shouldRestoreSessionState ? rawReopenFlag : false;
        const restoreUiRequested = shouldRestoreSessionState ? rawRestoreUiRequested : false;
        const savedUi = restoreUiRequested || reopenResultsRequested ? consumeListUiState() : null;
        const urlRestored = await applyInitialUrlState();
        let restored = urlRestored;
        if (!restored && initialCinemaPrefillValue) {
          if (searchInput) {
            searchInput.value = initialCinemaPrefillValue;
          }
          if (locationInput) {
            locationInput.value = initialCinemaPrefillValue;
          }
          updateClearButtons();
        }
        suppressFocusAnimation = reopenResultsRequested;
        const savedPrimaryValue = savedUi ? savedUi.location || savedUi.query || '' : '';
        const savedSortMode =
          savedUi && savedUi.sortMode && LICENSE_SORT_CONFIGS[savedUi.sortMode]
            ? savedUi.sortMode
            : DEFAULT_SORT_MODE;

        if (!restored && savedUi) {
          if (searchInput) {
            searchInput.value = savedPrimaryValue;
          }
          if (locationInput) {
            locationInput.value = savedPrimaryValue;
          }
          if (savedUi.sortMode) {
            state.sortMode = savedSortMode;
            updateSortButtons();
          }
          if (savedPrimaryValue) {
            try {
              const result = await handleLocationSubmit({ quiet: true, fromPrimary: true, triggerButton: searchButton });
              restored = Boolean(result && result.ok);
            } catch {
              restored = false;
            }
          }
          if (restored && savedSortMode !== DEFAULT_SORT_MODE && !state.distanceMode) {
            state.sortMode = savedSortMode;
            updateSortButtons();
            applySortMode({ skipScroll: true, delay: false, quiet: true });
          }
        } else if (urlRestored && savedUi && !initialSortParam && savedSortMode !== DEFAULT_SORT_MODE) {
          state.sortMode = savedSortMode;
          updateSortButtons();
          applySortMode({ skipScroll: true, delay: false, quiet: true });
        }
        if (!restored) {
          if (getActiveLicenseSort() || state.sortMode === 'alpha') {
            applySortMode({ skipScroll: true, delay: false, quiet: true });
          } else {
            state.filtered = state.clubs.slice();
            state.visibleCount = Math.min(VISIBLE_RESULTS_DEFAULT, state.filtered.length);
            renderResults({ force: true });
            setSearchStatus('', 'info');
          }
        }
        if (state.statusMessage && state.statusMessage.includes('Chargement de la liste des clubs')) {
          setSearchStatus('', 'info');
        } else {
          updateTotalCounter();
        }
        const shouldAutoOpenResults = initialOpenResults || reopenResultsRequested;
        if (shouldAutoOpenResults) {
          if (resultsShell && isMobileViewport()) {
            openResultsShell({ skipHistory: initialOpenResults });
          }
          if (!resultsShell || !isMobileViewport()) {
            if (state.filtered.length) {
              jumpToResults({ behavior: 'instant' });
            }
          }
          syncUrlState({ openResults: mobileResultsOpen && isMobileViewport() });
        } else {
          syncUrlState({ openResults: mobileResultsOpen && isMobileViewport() });
        }
        if (shouldRestoreSessionState) {
          await restoreListState(savedListState);
        }
        state.restoreMode = false;
        updateClearButtons();
        if (shouldRunCinemaEntry) {
          void runCinemaEntryFlow().catch(() => {
            endCinemaEntryStage();
            requestPrimarySearchFocus();
          });
        }
      })
      .catch(() => {
        if (shouldRunCinemaEntry) {
          endCinemaEntryStage();
        }
        if (resultsEl) {
          resultsEl.innerHTML = '<p class="clubs-error">Impossible de charger la liste des clubs pour le moment. Veuillez réessayer plus tard.</p>';
        }
        if (totalCounter) {
          totalCounter.textContent = '';
        }
        setSearchStatus('Erreur lors du chargement de la liste des clubs.', 'error');
        requestPrimarySearchFocus();
      })
      .finally(() => {
        releaseInitOverlay();
        if (!shouldRunCinemaEntry) {
          requestPrimarySearchFocus();
        }
      });

    if (searchButton) {
      searchButton.addEventListener('click', () => {
        if (searchButton.getAttribute('aria-busy') === 'true') {
          return;
        }
        submitPrimaryLocationSearch();
      });
    }
    resetButton?.addEventListener('click', resetSearch);
    if (searchInput) {
      searchInput.addEventListener('input', (event) => {
        updateClearButtons();
        handleLocationSuggestionInput(event);
      });
      searchInput.addEventListener('focus', handleLocationSuggestionFocus);
      searchInput.addEventListener('blur', handleLocationSuggestionBlur);
      searchInput.addEventListener('keydown', (event) => {
        handleLocationSuggestionKeydown(event);
        if (event.defaultPrevented) {
          return;
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          if (searchButton && searchButton.getAttribute('aria-busy') === 'true') {
            return;
          }
          submitPrimaryLocationSearch();
        }
      });
    }
    locationApplyButton?.addEventListener('click', handleLocationSubmit);
    locationClearButton?.addEventListener('click', handleLocationClear);
    if (locationInput) {
      locationInput.addEventListener('input', (event) => {
        updateClearButtons();
        handleLocationSuggestionInput(event);
      });
      locationInput.addEventListener('focus', handleLocationSuggestionFocus);
      locationInput.addEventListener('blur', handleLocationSuggestionBlur);
      locationInput.addEventListener('keydown', (event) => {
        handleLocationSuggestionKeydown(event);
        if (event.defaultPrevented) {
          return;
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          handleLocationSubmit(event);
        }
      });
    }
    window.addEventListener('resize', syncLocationSuggestionsPosition);
    window.addEventListener('scroll', syncLocationSuggestionsPosition, true);
    document.addEventListener('pointerdown', handleDocumentPointerDown);
    geolocButton?.addEventListener('click', handleUseGeolocation);
    highlightLocationButton?.addEventListener('click', () => {
      expandOptionsPanel();
      ensureDistanceSectionOpen();
      if (locationInput) {
        locationInput.focus();
      }
    });
    highlightGeolocButton?.addEventListener('click', () => {
      expandOptionsPanel();
      ensureDistanceSectionOpen();
      if (geolocButton) {
        geolocButton.focus();
        geolocButton.click();
      } else {
        handleUseGeolocation();
      }
    });
    distanceToggle?.addEventListener('click', (event) => {
      event.preventDefault();
      const wasExpanded = distanceGroup?.dataset?.expanded === 'true';
      toggleDistanceSection();
    });
    distanceHeader?.addEventListener('click', (event) => {
      if (event.target && event.target.closest('.clubs-distance__body')) {
        return;
      }
      toggleDistanceSection();
    });
    resultsCloseButton?.addEventListener('click', (event) => {
      event.preventDefault();
      closeResultsShell({ viaUser: true });
    });
    if (resultsShell) {
      resultsShell.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && isMobileViewport()) {
          closeResultsShell();
        }
      });
    }
    moreButton?.addEventListener('click', showAllResults);
    sortButtons.forEach((button) => {
      button.addEventListener('click', () => {
        if (button.getAttribute('aria-busy') === 'true') {
          return;
        }
        setSortMode(button.dataset.clubSort || 'default', {
          triggerButton: button,
          delayMs: SORT_SCROLL_DELAY_MS,
        });
      });
    });
    updateSortButtons();
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => {
        if (pendingNavigationState) {
          persistListState(pendingNavigationState);
          pendingNavigationState = null;
          return;
        }
        persistListState();
      });
    }
    if (canUseHistory) {
      window.addEventListener('popstate', (event) => {
        const state = event?.state;
        const isResultsState = state && state.clubsResultsOpen && state.clubsContext === 'clubs';
        const shouldOpen = Boolean(isResultsState);
        if (shouldOpen && !mobileResultsOpen) {
          openResultsShell({ skipHistory: true });
          resultsHistoryPushed = false;
          return;
        }
        if (!shouldOpen && mobileResultsOpen) {
          closeResultsShell({ fromPopstate: true });
          resultsHistoryPushed = false;
        }
      });
    }
  };

  if (resultsEl) {
    init();
  }
})();
