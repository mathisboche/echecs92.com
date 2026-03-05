/**
 * Clubs directory interactions for echecs92.fr.
 * Provides fuzzy text search with automatic distance fallback.
 */
(function () {
  const DATA_URL = '/wp-content/themes/echecs92-child/assets/data/clubs.json';
  const FFE_DETAILS_URL = '/wp-content/themes/echecs92-child/assets/data/clubs-france/92.json';
  const CLUBS_NAV_STORAGE_KEY = 'echecs92:clubs:last-listing';
  const CLUBS_LIST_STATE_KEY = 'echecs92:clubs-92:list-state';
  const CLUBS_LIST_STATE_MAX_AGE = 2 * 60 * 60 * 1000;
  const VISIBLE_RESULTS_DEFAULT = 12;
  const VISIBLE_RESULTS_STEP = VISIBLE_RESULTS_DEFAULT;
  const DASH_RX = /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE63\uFF0D]/g;
  const normaliseDashes = (value) => (value == null ? '' : value.toString()).replace(DASH_RX, '-');
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
  };

  const GEOCODE_ENDPOINT = 'https://nominatim.openstreetmap.org/search';

  const resultsEl = document.getElementById('clubs-results');
  const detailBase = resultsEl?.dataset?.detailBase || '';
  const DEFAULT_RESULTS_SCROLL_MARGIN = 24;
  const parseScrollMargin = (value) => {
    if (value == null || value === '') {
      return null;
    }
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const configuredScrollMargin = parseScrollMargin(resultsEl?.dataset?.scrollMargin);
  const resultsScrollMargin = configuredScrollMargin ?? DEFAULT_RESULTS_SCROLL_MARGIN;

  const searchInput = document.getElementById('clubs-search');
  const searchButton = document.getElementById('clubs-search-btn');
  const resetButton = document.getElementById('clubs-reset-btn');
  const searchStatus = document.getElementById('clubs-search-status');
  const locationInput = document.getElementById('clubs-location');
  const locationApplyButton = document.getElementById('clubs-location-apply');
  const locationClearButton = document.getElementById('clubs-location-clear');
  const geolocButton = document.getElementById('clubs-use-geoloc');
  const locationStatus = document.getElementById('clubs-location-status');
  const moreButton = document.getElementById('clubs-more-button');
  const optionsDetails = document.getElementById('clubs-options');
  const sortButtons = document.querySelectorAll('[data-club-sort]');
  const mapCtaLink = document.querySelector('.clubs-map-box__cta');
  const highlightLocationButton = document.getElementById('clubs-highlight-location');
  const highlightGeolocButton = document.getElementById('clubs-highlight-geoloc');

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

  const jumpToResults = (options = {}) => {
    if (!resultsEl) {
      return;
    }
    const target = totalCounter || resultsEl;
    const behavior = options.behavior === 'instant' ? 'auto' : options.behavior || 'smooth';
    const marginOverride = Number.isFinite(options.margin) ? options.margin : null;
    if (marginOverride != null && totalCounter) {
      totalCounter.style.setProperty('--clubs-results-scroll-margin', `${marginOverride}px`);
    }
    try {
      target.scrollIntoView({ behavior, block: 'start', inline: 'nearest' });
    } catch {
      target.scrollIntoView({ block: 'start' });
    }
    if (typeof resultsEl.focus === 'function') {
      try {
        resultsEl.focus({ preventScroll: true });
      } catch {
        resultsEl.focus();
      }
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
        back: backPath || '/clubs-92',
      };
      storage.setItem(CLUBS_NAV_STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      // ignore storage failures
    }
  };

  const normalisePath = (value) => {
    const trimmed = (value || '').toString().replace(/\/+$/u, '');
    return trimmed || '/';
  };

  const getCurrentPath = () => {
    if (typeof window === 'undefined') {
      return '';
    }
    return normalisePath(window.location.pathname);
  };

  const getScrollY = () => {
    if (typeof window === 'undefined') {
      return 0;
    }
    return window.scrollY || document.documentElement?.scrollTop || 0;
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
      const scrollY = Number.isFinite(options.scrollY) ? options.scrollY : getScrollY();
      const visibleCount = Number.isFinite(options.visibleCount) ? options.visibleCount : state.visibleCount;
      const payload = {
        ts: Date.now(),
        path: getCurrentPath(),
        scrollY,
        visibleCount,
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
      if (payload.path && normalisePath(payload.path) !== getCurrentPath()) {
        return null;
      }
      return payload;
    } catch (error) {
      return null;
    }
  };

  const restoreListState = (payload) => {
    if (!payload) {
      return;
    }
    const shouldRestoreVisible = state.sortMode === 'default' && !state.distanceMode;
    if (
      shouldRestoreVisible &&
      Number.isFinite(payload.visibleCount) &&
      payload.visibleCount > state.visibleCount &&
      state.filtered.length
    ) {
      state.visibleCount = Math.min(payload.visibleCount, state.filtered.length);
      renderResults();
      updateTotalCounter();
    }
    if (Number.isFinite(payload.scrollY) && typeof window !== 'undefined') {
      const restoreScroll = () => {
        window.scrollTo(0, payload.scrollY);
      };
      if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(restoreScroll);
        });
      } else {
        setTimeout(restoreScroll, 0);
      }
    }
  };

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
    sortMode: 'default',
  };

  const DEBUG_FLAG_KEY = 'echecs92:clubs:debug';
  const DEBUG_CONSOLE_PREFIX = '[clubs-debug]';
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
    if (!window.__e92ClubsDebug) {
      Object.defineProperty(window, '__e92ClubsDebug', {
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
      'Commandes dans la barre de recherche: :debug, :debug+, :debug-, debug92.',
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
    if (locationStatus) {
      setLocationStatus('Indiquez une ville, un code postal ou utilisez Autour de moi.', 'info');
    }
  };

  const bindMapCtaNavigation = () => {
    if (!mapCtaLink) {
      return;
    }
    const handleIntent = (event) => {
      if (event.type === 'auxclick' && event.button !== 1) {
        return;
      }
      persistListState();
      rememberClubsNavigation('map:from-list', '/clubs-92');
    };
    mapCtaLink.addEventListener('click', handleIntent);
    mapCtaLink.addEventListener('auxclick', handleIntent);
  };

  const setSearchStatus = (message, tone = 'info') => {
    if (!searchStatus) {
      return;
    }
    searchStatus.textContent = message || '';
    if (message) {
      searchStatus.dataset.tone = tone;
    } else {
      delete searchStatus.dataset.tone;
    }
  };

  const setLocationStatus = (message, tone = 'info') => {
    if (!locationStatus) {
      return;
    }
    locationStatus.textContent = message || '';
    if (message) {
      locationStatus.dataset.tone = tone;
    } else {
      delete locationStatus.dataset.tone;
    }
  };

  const clearSearchQuery = (options = {}) => {
    const silent = Boolean(options.silent);
    state.query = '';
    state.pendingQuery = '';
    if (searchInput) {
      searchInput.value = '';
    }
    if (!silent) {
      setSearchStatus('Tous les clubs sont affichés.', 'info');
    }
  };

  const LEGACY_EASTER_EGG = (() => {
    if (typeof document === 'undefined') {
      return { trigger: '', href: '', text: '', consumeUrl: '' };
    }
    const runtime =
      typeof window !== 'undefined' &&
      window.CDJE92_EASTER_EGG &&
      typeof window.CDJE92_EASTER_EGG === 'object'
        ? window.CDJE92_EASTER_EGG
        : {};
    const dataset = document.currentScript && document.currentScript.dataset ? document.currentScript.dataset : {};
    const runtimeTrigger = typeof runtime.trigger === 'string' ? runtime.trigger.trim().toLowerCase() : '';
    const runtimeHref = typeof runtime.href === 'string' ? runtime.href.trim() : '';
    const runtimeText = typeof runtime.text === 'string' ? runtime.text.trim() : '';
    const runtimeConsumeUrl = typeof runtime.consumeUrl === 'string' ? runtime.consumeUrl.trim() : '';
    const trigger = runtimeTrigger || (typeof dataset.easterEggTrigger === 'string' ? dataset.easterEggTrigger.trim().toLowerCase() : '');
    const href = runtimeHref || (typeof dataset.easterEggHref === 'string' ? dataset.easterEggHref.trim() : '');
    const text = runtimeText || (typeof dataset.easterEggText === 'string' ? dataset.easterEggText.trim() : '');
    const consumeUrl = runtimeConsumeUrl || '/wp-json/cdje92/v1/rien-code/consume';
    return { trigger, href, text, consumeUrl };
  })();

  const MATHIS_TAKEOVER_ID = 'mathis-takeover';
  const MATHIS_LINK_TEXT = LEGACY_EASTER_EGG.text;
  const MATHIS_REVEAL_DELAY = 650;
  let mathisSequenceActive = false;
  let mathisCollapsedTargets = [];
  let mathisExitStarted = false;
  let mathisScrollPosition = 0;
  let mathisFragmentsPrepared = false;
  const MATHIS_VIEWPORT_MARGIN_DESKTOP = 520;
  const MATHIS_VIEWPORT_MARGIN_MOBILE = 320;
  const MATHIS_MAX_TARGETS_DESKTOP = 1200;
  const MATHIS_MAX_TARGETS_MOBILE = 520;
  const MATHIS_MAX_FRAGMENTS_DESKTOP = 2000;
  const MATHIS_MAX_FRAGMENTS_MOBILE = 1100;
  let mathisRectCache = null;

  const resetMathisRectCache = () => {
    mathisRectCache = typeof WeakMap === 'function' ? new WeakMap() : null;
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

  const getMathisPerfProfile = () => {
    const constrained = isMobileViewport() || isMathisMobileSafari();
    return {
      viewportMargin: constrained ? MATHIS_VIEWPORT_MARGIN_MOBILE : MATHIS_VIEWPORT_MARGIN_DESKTOP,
      targetLimit: constrained ? MATHIS_MAX_TARGETS_MOBILE : MATHIS_MAX_TARGETS_DESKTOP,
      fragmentLimit: constrained ? MATHIS_MAX_FRAGMENTS_MOBILE : MATHIS_MAX_FRAGMENTS_DESKTOP,
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
    if (mathisFragmentsPrepared || typeof document === 'undefined' || !document.body) {
      return;
    }
    const overlayHost = overlayElement || document.getElementById(MATHIS_TAKEOVER_ID);
    const viewportMargin = Number.isFinite(options.viewportMargin) ? options.viewportMargin : MATHIS_VIEWPORT_MARGIN_DESKTOP;
    const fragmentLimit = Number.isFinite(options.fragmentLimit) ? options.fragmentLimit : MATHIS_MAX_FRAGMENTS_DESKTOP;
    let fragmentCount = 0;
    // Avoid fragmenting text inside flex/grid containers (would stretch items when spaced out)
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
    const timelineWindow = Math.min(3600, 1200 + order.length * 1.9);
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
    const overlay = document.getElementById(MATHIS_TAKEOVER_ID);
    const finish = () => {
      overlay?.remove();
      if (!options.skipRestore) {
        restoreMathisTargets();
      }
      cleanupMathisFragments();
      unlockMathisScroll();
      if (!options.silent) {
        setSearchStatus('Retour à la réalité des clubs du 92.', 'info');
      }
    };
    if (overlay) {
      overlay.classList.add('is-ending');
      window.setTimeout(finish, 600);
    } else {
      finish();
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
        <a class="mathis-clean__anchor" rel="noopener noreferrer" target="_blank">
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
    const timelineWindow = Math.min(4200, 1400 + order.length * 2.2);
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
    anchor.setAttribute('href', LEGACY_EASTER_EGG.href || '#');
    lettersHost.innerHTML = '';
    const letters = MATHIS_LINK_TEXT.split('');
    const spans = letters.map((char) => {
      const span = document.createElement('span');
      span.className = 'mathis-clean__letter';
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
    ['debug92', () => toggleDebugMode()],
    [':sansdebug', () => setDebugMode(false)],
    [':debugmode', () => setDebugMode(true)],
  ]);

  if (LEGACY_EASTER_EGG.trigger) {
    SECRET_DEBUG_COMMANDS.set(LEGACY_EASTER_EGG.trigger, () => showLegacySpectacle());
  }
  let legacyRienCodeConsumed = false;

  const consumeLegacyRienCode = (normalizedTrigger) => {
    if (legacyRienCodeConsumed || !LEGACY_EASTER_EGG.trigger || normalizedTrigger !== LEGACY_EASTER_EGG.trigger) {
      return;
    }

    legacyRienCodeConsumed = true;
    SECRET_DEBUG_COMMANDS.delete(LEGACY_EASTER_EGG.trigger);

    const endpoint = LEGACY_EASTER_EGG.consumeUrl || '/wp-json/cdje92/v1/rien-code/consume';
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

  const applySortMode = () => {
    const activeLicenseSort = getActiveLicenseSort();
    if (activeLicenseSort) {
      const sorted = state.clubs
        .slice()
        .sort((a, b) => {
          const countA = getLicenseCount(a, activeLicenseSort.valueKey);
          const countB = getLicenseCount(b, activeLicenseSort.valueKey);
          if (countB !== countA) {
            return countB - countA;
          }
          return a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });
        });
      state.distanceMode = false;
      state.distanceReference = '';
      state.distanceReferencePostal = '';
      state.distanceReferenceCommune = '';
      state.distanceReferenceType = '';
      state.filtered = sorted;
      state.visibleCount = state.filtered.length;
      renderResults({ resetVisible: false });
      updateTotalCounter();
      setSearchMeta({ sort: activeLicenseSort.metaKey || state.sortMode, total: state.filtered.length });
      setSearchStatus(activeLicenseSort.status, 'info');
      return true;
    }
    if (state.sortMode === 'alpha') {
      const sorted = state.clubs
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
      state.distanceMode = false;
      state.distanceReference = '';
      state.distanceReferencePostal = '';
      state.distanceReferenceCommune = '';
      state.distanceReferenceType = '';
      state.filtered = sorted;
      state.visibleCount = state.filtered.length;
      renderResults({ resetVisible: false });
      updateTotalCounter();
      setSearchMeta({ sort: 'alpha', total: state.filtered.length });
      setSearchStatus('Clubs classés par ordre alphabétique.', 'info');
      return true;
    }
    return false;
  };

  const setSortMode = (mode) => {
    const normalized = LICENSE_SORT_CONFIGS[mode] ? mode : mode === 'alpha' ? 'alpha' : 'default';
    if (state.sortMode === normalized) {
      if (normalized !== 'default') {
        applySortMode();
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
      void performSearch();
      return;
    }

    clearSearchQuery({ silent: true });
    handleLocationClear({ skipSearch: true, silent: true });
    state.distanceMode = false;
    state.distanceReference = '';
    state.distanceReferencePostal = '';
    state.distanceReferenceCommune = '';
    state.distanceReferenceType = '';
    applySortMode();
  };

  const beginButtonWait = (button, busyLabel) => {
    if (!button) {
      return () => {};
    }
    const originalText = button.dataset.label || button.textContent || '';
    button.dataset.label = originalText;
    if (busyLabel) {
      button.textContent = busyLabel;
    }
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    return () => {
      if (button.dataset.label !== undefined) {
        button.textContent = button.dataset.label;
        delete button.dataset.label;
      } else {
        button.textContent = originalText;
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

  const normaliseCommuneKey = (value) => normalise(value).replace(/[^a-z0-9]/g, '');

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

  const getPostalCoordinates = (postalCode) => {
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
    return { postalCode: key, lat: entry.lat, lng: entry.lng, label: entry.label };
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

  const slugify = (value) => {
    const base = normalise(value)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (base) {
      return base;
    }
    return `club-${Math.random().toString(36).slice(2, 10)}`;
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
    const postalMatch = result.full.match(/\b(\d{5})\b/);
    if (postalMatch) {
	      result.postalCode = postalMatch[1];
	      const after = result.full.slice(postalMatch.index + postalMatch[0].length).trim();
	      if (after) {
	        result.city = after.replace(/^[,;\-\u2013\u2014]+/, '').trim();
	      }
	    }
    if (!result.city) {
      const parts = result.full
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
      if (parts.length) {
        const last = parts[parts.length - 1];
        const cleaned = last.replace(/\b\d{5}\b/g, '').trim();
        if (cleaned) {
          result.city = cleaned;
        }
      }
    }
    result.city = result.city.replace(/\s+/g, ' ').trim();
    return result;
  };

  const STREET_KEYWORDS =
    /\b(rue|avenue|av\.?|boulevard|bd|place|route|chemin|impasse|all[ée]e|voie|quai|cours|passage|square|sentier|mail|esplanade|terrasse|pont|faubourg|clos|cité|cite|hameau|lotissement|residence|résidence|allee)\b/i;

  const simplifyStreetSegment = (value) => {
    if (!value) {
      return '';
    }
    const cleaned = value.replace(/\([^)]*\)/g, ' ');
    const parts = cleaned
      .split(/[,;/]+/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (!parts.length) {
      return cleaned.replace(/\s+/g, ' ').trim();
    }
    const tests = [
      (part) => /\b\d+[\p{L}]?\b/iu.test(part) && STREET_KEYWORDS.test(part),
      (part) => STREET_KEYWORDS.test(part),
      (part) => /\b\d+[\p{L}]?\b/iu.test(part),
    ];
    for (const test of tests) {
      const match = parts.find((part) => test(part));
      if (match) {
        return match.replace(/\s+/g, ' ').trim();
      }
    }
    return parts[0];
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

  const normaliseCommuneForCompare = (value) => {
    const formatted = formatCommune(value || '');
    return formatted ? formatted.toLowerCase() : '';
  };

  const deriveReferenceContext = (rawInput, coords = {}, type = '') => {
    const addressParts = extractAddressParts(rawInput || '');
    const postal = coords.postalCode || addressParts.postalCode || '';
    const communeCandidate =
      coords.label ||
      addressParts.city ||
      rawInput ||
      '';
    return {
      postalCode: normalisePostalCodeValue(postal),
      commune: normaliseCommuneForCompare(communeCandidate),
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
    if (type === 'address') {
      return `${baseLabel} (loc. précise)`;
    }
    if (type === 'location') {
      return `${baseLabel} (localisation)`;
    }
    if (type === 'postal') {
      return `${baseLabel} (code postal)`;
    }
    return baseLabel;
  };

  const isClubOnsite = (club) => {
    if (!state.distanceMode) {
      return false;
    }
    const refPostal = state.distanceReferencePostal;
    const refCommune = state.distanceReferenceCommune;
    const clubPostal = normalisePostalCodeValue(club.postalCode);
    const clubCommune = normaliseCommuneForCompare(club.commune);
    if (refPostal && clubPostal && clubPostal === refPostal) {
      return true;
    }
    if (refCommune && clubCommune && clubCommune === refCommune) {
      return true;
    }
    return false;
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
    const pushPart = (part) => {
      if (!part) {
        return;
      }
      const formatted = collapseRepeatedPhrase(formatCommune(part));
      const key = normaliseCommuneForCompare(formatted);
      if (!key || seen.has(key)) {
        return;
      }
      seen.add(key);
      parts.push(formatted);
    };

    if (segments.length) {
      segments.forEach(pushPart);
    } else {
      pushPart(withoutPostal);
    }

    if (!parts.length) {
      return '';
    }
    return parts.length === 1 ? parts[0] : parts.join(', ');
  };

  const formatGeocodeLabel = (place) => {
    if (!place || typeof place !== 'object') {
      return '';
    }
    const { address = {}, display_name: displayName = '' } = place;
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

  const toDistanceReferenceLabel = (baseLabel, postalCode) => {
    const label = (baseLabel || '').trim();
    const code = (postalCode || '').trim();
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
      const matches = (value || '').match(/\b\d{5}\b/g);
      if (matches) {
        matches.forEach((code) => codes.add(code));
      }
    });
    return Array.from(codes);
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
      };
      club._distanceCoords = coords;
      return coords;
    }

    if (club.commune) {
      const coords = getCommuneCoordinatesByName(club.commune);
      if (coords) {
        club._distanceCoords = coords;
        return coords;
      }
    }

    const postalCandidates = collectPostalCodes(club);
    for (let i = 0; i < postalCandidates.length; i += 1) {
      const coords = getPostalCoordinates(postalCandidates[i]);
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
    if (handler === showLegacySpectacle && LEGACY_EASTER_EGG.trigger && normalized !== LEGACY_EASTER_EGG.trigger) {
      return false;
    }
    consumeLegacyRienCode(normalized);
    const result = handler({ immediate: Boolean(options.immediate), query: trimmed }) || null;
    if (searchInput) {
      searchInput.value = '';
    }
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
      return { text: 'sur place', tone: 'onsite' };
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
        'User-Agent': 'echecs92-clubs/1.0 (contact@echecs92.com)',
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
        const label = formatGeocodeLabel(result);
        const postalCodeRaw = result?.address?.postcode || '';
        const postalCode = postalCodeRaw.split(';')[0].trim();
        return {
          latitude,
          longitude,
          label,
          postalCode,
        };
      })
      .catch(() => null)
      .then((finalResult) => {
        geocodeCache.set(key, finalResult);
        return finalResult;
      });

    geocodeCache.set(key, request);
    return request;
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
        'User-Agent': 'echecs92-clubs/1.0 (contact@echecs92.com)',
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
        const label = formatGeocodeLabel(payload) || '';
        const postalCodeRaw = payload?.address?.postcode || '';
        const postalCode = postalCodeRaw.split(';')[0].trim();
        return {
          label,
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

  const applySearch = (rawQuery) => {
    const trimmed = (rawQuery || '').trim();
    state.query = trimmed;
    const normalisedQuery = normaliseForSearch(trimmed);
    const terms = normalisedQuery ? normalisedQuery.split(/\s+/).filter(Boolean) : [];

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
        return a.club.name.localeCompare(b.club.name, 'fr', { sensitivity: 'base' });
      });
      state.filtered = matches.map((entry) => entry.club);
    }

    state.visibleCount = Math.min(VISIBLE_RESULTS_DEFAULT, state.filtered.length);
    renderResults();
    updateTotalCounter();

    return {
      total: state.filtered.length,
      hasQuery: terms.length > 0,
      rawQuery: trimmed,
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
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      state.filtered = [];
      state.visibleCount = 0;
      state.distanceMode = true;
      state.distanceReference = label || query || '';
      state.distanceReferencePostal = normalisePostalCodeValue(referencePostalCode);
      state.distanceReferenceCommune = normaliseCommuneForCompare(referenceCommune);
      state.distanceReferenceType = referenceType || '';
      renderResults();
      updateTotalCounter();
      return { total: 0, finite: 0, label: state.distanceReference };
    }

    const scored = state.clubs.map((club) => {
      const coords = resolveClubDistanceCoordinates(club);
      if (!coords) {
        return { club, distance: Number.POSITIVE_INFINITY };
      }
      const distance = haversineKm(lat, lng, coords.lat, coords.lng);
      return { club, distance };
    });

    scored.sort((a, b) => {
      const aFinite = Number.isFinite(a.distance);
      const bFinite = Number.isFinite(b.distance);
      if (aFinite && bFinite) {
        if (a.distance !== b.distance) {
          return a.distance - b.distance;
        }
        return a.club.name.localeCompare(b.club.name, 'fr', { sensitivity: 'base' });
      }
      if (aFinite) {
        return -1;
      }
      if (bFinite) {
        return 1;
      }
      return a.club.name.localeCompare(b.club.name, 'fr', { sensitivity: 'base' });
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
    state.distanceReferencePostal = normalisePostalCodeValue(referencePostalCode);
    state.distanceReferenceCommune = normaliseCommuneForCompare(referenceCommune);
    state.distanceReferenceType = referenceType || '';
    state.query = query || '';
    state.visibleCount = Math.min(VISIBLE_RESULTS_DEFAULT, state.filtered.length);
    renderResults();
    updateTotalCounter();

    return {
      total: state.filtered.length,
      finite: finiteCount,
      label: state.distanceReference,
      kind: state.distanceReferenceType,
    };
  };

  const performSearch = async (options = {}) => {
    const suppressJump = Boolean(options.suppressJump);
    const raw = searchInput ? searchInput.value : '';
    if (tryHandleSecretCommand(raw)) {
      return;
    }
    const trimmed = (raw || '').trim();
    const requestId = ++searchRequestId;
    let didJumpToResults = false;

    const ensureResultsVisible = () => {
      if (suppressJump || didJumpToResults || requestId !== searchRequestId) {
        return;
      }
      jumpToResults();
      didJumpToResults = true;
    };

    const updateStatusIfCurrent = (message, tone = 'info') => {
      if (requestId === searchRequestId) {
        setSearchStatus(message, tone);
      }
    };

    if (state.sortMode !== 'default') {
      state.sortMode = 'default';
      updateSortButtons();
    }

    if (!trimmed) {
      const meta = applySearch('');
      if (requestId !== searchRequestId) {
        return;
      }
      ensureResultsVisible();
      if (meta.total > 0) {
        updateStatusIfCurrent('Tous les clubs sont affichés.', 'info');
      } else {
        updateStatusIfCurrent('Aucun club disponible pour le moment.', 'info');
      }
      return;
    }

    updateStatusIfCurrent('Recherche en cours…', 'info');

    const postalMatch = trimmed.match(/\b(\d{5})\b/);
    if (postalMatch) {
      const postalCode = postalMatch[1];
      let coords = getPostalCoordinates(postalCode) || lookupLocalCoordinates(postalCode);
      if (!coords) {
        updateStatusIfCurrent(`Recherche des clubs proches de ${postalCode}…`, 'info');
        try {
          const geocoded = await geocodePlace(postalCode);
          if (requestId !== searchRequestId) {
            return;
          }
          if (geocoded) {
            coords = geocoded;
          }
        } catch {
          // ignore, handled below
        }
      }
      if (coords) {
        if (requestId !== searchRequestId) {
          return;
        }
        const referenceLabel = toDistanceReferenceLabel(
          coords.label || formatCommune(trimmed) || trimmed,
          coords.postalCode || postalCode
        );
        const referenceContext = deriveReferenceContext(trimmed, coords, 'postal');
        const decoratedLabel = decorateReferenceLabel(referenceLabel, referenceContext.type);
        const meta = runDistanceSearch({
          latitude: coords.latitude ?? coords.lat,
          longitude: coords.longitude ?? coords.lng,
          label: decoratedLabel,
          query: trimmed,
          referencePostalCode: referenceContext.postalCode,
          referenceCommune: referenceContext.commune,
          referenceType: referenceContext.type,
        });
        if (requestId !== searchRequestId) {
          return;
        }
        if (meta.finite > 0) {
          updateStatusIfCurrent(
            `Clubs triés par distance depuis ${meta.label || decoratedLabel || trimmed}.`,
            'info'
          );
        } else {
          updateStatusIfCurrent('Impossible de calculer les distances pour cette localisation.', 'error');
        }
        ensureResultsVisible();
        return;
      }
      updateStatusIfCurrent(`Localisation "${postalCode}" introuvable.`, 'error');
      ensureResultsVisible();
      return;
    }

    const meta = applySearch(trimmed);
    if (requestId !== searchRequestId) {
      return;
    }

    if (!meta.hasQuery) {
      if (state.distanceMode) {
        handleLocationClear();
      }
      updateStatusIfCurrent('Tous les clubs sont affichés.', 'info');
      ensureResultsVisible();
      return;
    }

    if (meta.total > 0) {
      const label =
        meta.total === 1
          ? `1 club correspond à "${meta.rawQuery}".`
          : `${meta.total} clubs correspondent à "${meta.rawQuery}".`;
      if (state.distanceMode) {
        handleLocationClear();
      }
      updateStatusIfCurrent(label, 'info');
      ensureResultsVisible();
      return;
    }

    let location = lookupLocalCoordinates(trimmed);

    if (!location) {
      updateStatusIfCurrent(`Recherche de la localisation "${trimmed}"…`, 'info');
      try {
        location = await geocodePlace(trimmed);
      } catch {
        location = null;
      }
      if (requestId !== searchRequestId) {
        return;
      }
    }

    if (location) {
      if (requestId !== searchRequestId) {
        return;
      }

      const referenceLabel = toDistanceReferenceLabel(
        location.label || formatCommune(trimmed) || trimmed,
        location.postalCode
      );
      const referenceContext = deriveReferenceContext(trimmed, location, 'location');
      const decoratedLabel = decorateReferenceLabel(referenceLabel, referenceContext.type);
      const distanceMeta = runDistanceSearch({
        latitude: location.latitude,
        longitude: location.longitude,
        label: decoratedLabel,
        query: trimmed,
        referencePostalCode: referenceContext.postalCode,
        referenceCommune: referenceContext.commune,
        referenceType: referenceContext.type,
      });
      if (requestId !== searchRequestId) {
        return;
      }
      if (distanceMeta.finite > 0) {
        const reference = distanceMeta.label || decoratedLabel || trimmed;
        updateStatusIfCurrent(
          `Aucun club nommé "${trimmed}". Classement par distance depuis ${reference}.`,
          'info'
        );
      } else {
        updateStatusIfCurrent('Impossible de calculer les distances pour cette localisation.', 'error');
      }
      ensureResultsVisible();
      return;
    }

    updateStatusIfCurrent(`Aucun club ne correspond à "${meta.rawQuery}".`, 'error');
    ensureResultsVisible();
  };

  const resetSearch = () => {
    searchRequestId += 1;
    state.sortMode = 'default';
    updateSortButtons();
    handleLocationClear({ skipSearch: true, silent: true });
    clearSearchQuery({ silent: true });
    setLocationStatus('', 'info');
    const meta = applySearch('');
    if (meta.total > 0) {
      setSearchStatus('Recherche réinitialisée. Tous les clubs sont affichés.', 'success');
    } else {
      setSearchStatus('Aucun club disponible pour le moment.', 'info');
    }
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
    setLocationStatus(silent ? '' : 'Localisation effacée.', 'info');
    if (!skipSearch) {
      void performSearch({ suppressJump });
    }
  };

const handleLocationSubmit = async (event) => {
    if (event && typeof event.preventDefault === 'function') {
      event.preventDefault();
    }
    if (!locationInput) {
      return;
    }
    const raw = locationInput.value.trim();
    if (!raw) {
      handleLocationClear();
      return;
    }

    const requestId = ++locationRequestId;
    if (state.sortMode !== 'default') {
      state.sortMode = 'default';
      updateSortButtons();
    }
    clearSearchQuery({ silent: true });
    setLocationStatus(`Recherche de ${raw}…`, 'info');
    const releaseButton = beginButtonWait(locationApplyButton, 'Recherche…');

    try {
      const looksLikeAddress = looksLikeDetailedAddress(raw);
      let coords = null;
      if (looksLikeAddress) {
        try {
          coords = await geocodePlace(raw);
        } catch {
          coords = null;
        }
      }
      if (!coords) {
        coords = lookupLocalCoordinates(raw);
      }
      if (!coords && !looksLikeAddress) {
        try {
          coords = await geocodePlace(raw);
        } catch {
          coords = null;
        }
      }

      if (requestId !== locationRequestId) {
        return;
      }

      if (!coords) {
        setLocationStatus('Localisation introuvable. Essayez un autre nom de ville ou code postal.', 'error');
        return;
      }

      const baseLabel = toDistanceReferenceLabel(
        coords.label || formatCommune(raw) || raw,
        coords.postalCode
      );
      const referenceType = looksLikeAddress ? 'address' : 'location';
      const referenceContext = deriveReferenceContext(raw, coords, referenceType);
      const decoratedLabel = decorateReferenceLabel(baseLabel, referenceContext.type);

      if (locationInput) {
        locationInput.value = decoratedLabel || raw;
      }

      if (optionsDetails && !optionsDetails.open) {
        optionsDetails.open = true;
      }

      searchRequestId += 1;
      const meta = runDistanceSearch({
        latitude: coords.latitude ?? coords.lat,
        longitude: coords.longitude ?? coords.lng,
        label: decoratedLabel,
        query: raw,
        referencePostalCode: referenceContext.postalCode,
        referenceCommune: referenceContext.commune,
        referenceType: referenceContext.type,
      });

      if (meta.finite > 0) {
        const reference = meta.label || decoratedLabel || raw;
        setLocationStatus(`Distances calculées depuis ${reference}.`, 'success');
        setSearchStatus(`Clubs triés par distance depuis ${reference}.`, 'info');
      } else {
        setLocationStatus('Impossible de calculer les distances pour cette localisation.', 'error');
      }
      jumpToResults();
    } finally {
      releaseButton();
    }
  };

  const handleUseGeolocation = () => {
    if (!navigator.geolocation) {
      setLocationStatus('Géolocalisation indisponible sur cet appareil.', 'error');
      return;
    }

    const requestId = ++locationRequestId;
    if (state.sortMode !== 'default') {
      state.sortMode = 'default';
      updateSortButtons();
    }
    clearSearchQuery({ silent: true });
    setLocationStatus('Recherche de votre position…', 'info');
    const releaseButton = beginButtonWait(geolocButton, 'Recherche…');

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        reverseGeocode(latitude, longitude)
          .catch(() => null)
          .then((place) => {
            if (requestId !== locationRequestId) {
              return;
            }

            const baseLabel = toDistanceReferenceLabel(
              place?.label || 'votre position',
              place?.postalCode
            );
            const referenceContext = deriveReferenceContext(place?.label || '', place || {}, 'geoloc');
            const decoratedLabel = decorateReferenceLabel(baseLabel, referenceContext.type);

            if (locationInput) {
              locationInput.value = decoratedLabel || place?.label || '';
            }

            if (optionsDetails && !optionsDetails.open) {
              optionsDetails.open = true;
            }

            searchRequestId += 1;
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
              setLocationStatus(`Distances calculées depuis ${reference}.`, 'success');
              setSearchStatus(`Clubs triés par distance depuis ${reference}.`, 'info');
            } else {
              setLocationStatus('Impossible de calculer les distances pour cette localisation.', 'error');
            }
            jumpToResults();
          })
          .finally(() => {
            releaseButton();
          });
      },
      () => {
        if (requestId === locationRequestId) {
          setLocationStatus('Impossible de récupérer votre position.', 'error');
        }
        releaseButton();
      },
      {
        enableHighAccuracy: false,
        timeout: 10000,
      }
    );
  };

  const adaptClubRecord = (raw) => {
    if (!raw || typeof raw !== 'object') {
      return raw;
    }
    if (raw.id && raw.name) {
      return raw;
    }

	    const name = normaliseDashes(raw.nom || raw.name || '');
	    const primaryAddress = normaliseDashes(raw.salle_jeu || raw.salle || raw.adresse || raw.address || '');
	    const addressParts = extractAddressParts(primaryAddress);
	    const secondaryAddress = normaliseDashes(raw.siege || raw.siege_social || raw.address2 || '');
	    const secondaryParts = extractAddressParts(secondaryAddress);
	    const communeRaw = normaliseDashes(raw.commune || raw.ville || addressParts.city || secondaryParts.city || '');
	    const commune = normaliseDashes(dedupeCommuneLabel(communeRaw));
	    const postalCode = raw.code_postal || raw.postal_code || addressParts.postalCode || secondaryParts.postalCode || '';
	    const slugSource = name || commune || postalCode || primaryAddress || secondaryAddress;
	    const standardAddress = buildStandardAddress(
	      primaryAddress,
	      secondaryAddress,
      postalCode,
      commune || addressParts.city || secondaryParts.city || ''
    );
    const id = raw.id || slugify(slugSource || `club-${Date.now()}`);

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
	      name: name || commune || 'Club sans nom',
	      commune,
	      address: primaryAddress || secondaryAddress || '',
	      siege: secondaryAddress || '',
	      salle: normaliseDashes(raw.salle_jeu || raw.salle || ''),
	      addressStandard: standardAddress,
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
    const displayAddress = club.addressStandard || club.address || club.siege || '';
    club.addressDisplay = displayAddress;
    const searchSource = [club.name, displayAddress, tagsText].filter(Boolean).join(' ');
    const searchIndex = normaliseForSearch(searchSource);
    club._search = searchIndex;
    club._tokens = searchIndex ? searchIndex.split(/\s+/) : [];
    const nameAliases = [club.name].concat(Array.isArray(club.tags) ? club.tags : []);
    club._nameSearch = normaliseForSearch(nameAliases.filter(Boolean).join(' '));
    club._addressSearch = normaliseForSearch(displayAddress || '');
    const preserveSlug = options.preserveSlug === true;
    if (!preserveSlug || !club.slug) {
      const communeSlugSource = club.commune || club.name || club.id;
      club.slug = club.slug || slugify(communeSlugSource || club.id || club.name || 'club');
      club._communeSlug = club.slug;
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
      persistListState();
      rememberClubsNavigation('detail:list', '/clubs-92');
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

    const onsite = isClubOnsite(club);
    if (state.distanceMode && (Number.isFinite(club.distanceKm) || onsite)) {
      const distanceInfo = formatDistanceLabel(club.distanceKm, { onsite });
      if (distanceInfo.text) {
        const distanceNode = document.createElement('span');
        distanceNode.className = 'club-row__distance';
        if (distanceInfo.tone && distanceInfo.tone !== 'default') {
          distanceNode.dataset.tone = distanceInfo.tone;
        }
        distanceNode.textContent = distanceInfo.text;
        header.appendChild(distanceNode);
      }
    } else {
      const licenseSort = getActiveLicenseSort();
      if (licenseSort) {
        const count = getLicenseCount(club, licenseSort.valueKey);
        const badgeText = typeof licenseSort.formatBadge === 'function' ? licenseSort.formatBadge(count, club) : `${count} lic.`;
        if (badgeText) {
          const licenseNode = document.createElement('span');
          licenseNode.className = 'club-row__distance';
          licenseNode.dataset.tone = 'licenses';
          licenseNode.textContent = badgeText;
          header.appendChild(licenseNode);
        }
      }
    }

    cardLink.appendChild(header);

    const displayAddress = club.addressDisplay || club.address || club.siege || '';
    if (displayAddress) {
      const address = document.createElement('p');
      address.className = 'club-row__address';
      address.textContent = displayAddress;
      cardLink.appendChild(address);
    }

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

      const lat = Number.isFinite(club.latitude) ? club.latitude : Number.parseFloat(club.lat);
      const lng =
        Number.isFinite(club.longitude) ? club.longitude : Number.parseFloat(club.lng ?? club.lon);
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

  const updateTotalCounter = () => {
    if (!totalCounter) {
      return;
    }

    const total = state.clubs.length;
    const filtered = state.filtered.length;
    const visible = Math.min(state.visibleCount, filtered);
    const activeLicenseSort = getActiveLicenseSort();

    if (!total) {
      totalCounter.textContent = 'Aucun club disponible pour le moment.';
      return;
    }

    if (!filtered) {
      const parts = [`Aucun club trouvé`, `${total} au total`];
      if (state.distanceMode && state.distanceReference) {
        parts.splice(1, 0, `Distances depuis ${state.distanceReference}`);
      }
      if (activeLicenseSort) {
        parts.push(activeLicenseSort.counterLabel);
      } else if (state.sortMode === 'alpha') {
        parts.push('ordre alphabétique');
      }
      totalCounter.textContent = `${parts.join(' · ')}.`;
      return;
    }

    const parts = [];
    if (filtered === total && visible >= filtered) {
      parts.push(`${total} club${total > 1 ? 's' : ''} dans les Hauts-de-Seine`);
    } else {
      parts.push(`${filtered} trouvé${filtered > 1 ? 's' : ''} sur ${total}`);
    }
    if (state.distanceMode && state.distanceReference) {
      parts.push(`Distances depuis ${state.distanceReference}`);
    }
    if (activeLicenseSort) {
      parts.push(activeLicenseSort.counterLabel);
    } else if (state.sortMode === 'alpha') {
      parts.push('ordre alphabétique');
    }
    totalCounter.textContent = `${parts.join(' · ')}.`;
  };

  const renderResults = () => {
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
      return;
    }

    const fragment = document.createDocumentFragment();
    const visible = Math.min(state.visibleCount, state.filtered.length);
    state.filtered.slice(0, visible).forEach((club) => {
      fragment.appendChild(createResultRow(club));
    });

    resultsEl.innerHTML = '';
    resultsEl.appendChild(fragment);

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

  const fetchJson = (url) =>
    fetch(url, { headers: { Accept: 'application/json' } }).then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.json();
    });

  const init = () => {
    const savedListState = loadListState();
    initialiseLocationControls();
    bindMapCtaNavigation();
    setSearchStatus('Chargement de la liste des clubs…', 'info');

    const releaseSpinner =
      typeof window !== 'undefined' && window.cdjeSpinner && typeof window.cdjeSpinner.show === 'function'
        ? window.cdjeSpinner.show('Chargement des clubs…')
        : () => {};

    Promise.all([fetchJson(DATA_URL), fetchJson(FFE_DETAILS_URL).catch(() => [])])
      .then(([payload, ffeDetails]) => {
        const data = Array.isArray(payload) ? payload : [];
        const clubs = data.map(hydrateClub);
        if (Array.isArray(ffeDetails) && ffeDetails.length) {
          applyFfeDetails(clubs, buildFfeDetailsLookup(ffeDetails));
          clubs.forEach((club) => refreshClubIndexes(club, { preserveSlug: true }));
        }
        state.clubs = clubs.sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));

        if (getActiveLicenseSort() || state.sortMode === 'alpha') {
          applySortMode();
        } else {
          const meta = applySearch('');
          if (meta.total > 0) {
            setSearchStatus('Tous les clubs sont affichés.', 'info');
          } else {
            setSearchStatus('Aucun club disponible pour le moment.', 'info');
          }
        }
        restoreListState(savedListState);
      })
      .catch(() => {
        if (resultsEl) {
          resultsEl.innerHTML = '<p class="clubs-error">Impossible de charger la liste des clubs pour le moment. Veuillez réessayer plus tard.</p>';
        }
        if (totalCounter) {
          totalCounter.textContent = '';
        }
        setSearchStatus('Erreur lors du chargement de la liste des clubs.', 'error');
      })
      .finally(() => {
        releaseSpinner();
      });

    searchButton?.addEventListener('click', performSearch);
    resetButton?.addEventListener('click', resetSearch);
    if (searchInput) {
      searchInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          if (tryHandleSecretCommand(searchInput.value)) {
            return;
          }
          performSearch();
        }
      });
    }
    locationApplyButton?.addEventListener('click', handleLocationSubmit);
    locationClearButton?.addEventListener('click', handleLocationClear);
    locationInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        handleLocationSubmit(event);
      }
    });
    geolocButton?.addEventListener('click', handleUseGeolocation);
    highlightLocationButton?.addEventListener('click', () => {
      if (optionsDetails && !optionsDetails.open) {
        optionsDetails.open = true;
      }
      if (locationInput) {
        locationInput.focus();
      }
    });
    highlightGeolocButton?.addEventListener('click', () => {
      if (optionsDetails && !optionsDetails.open) {
        optionsDetails.open = true;
      }
      if (geolocButton) {
        geolocButton.focus();
        geolocButton.click();
      } else {
        handleUseGeolocation();
      }
    });
    moreButton?.addEventListener('click', showAllResults);
    sortButtons.forEach((button) => {
      button.addEventListener('click', () => {
        setSortMode(button.dataset.clubSort || 'default');
      });
    });
    updateSortButtons();
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => {
        persistListState();
      });
    }
  };

  if (resultsEl) {
    init();
  }
})();
