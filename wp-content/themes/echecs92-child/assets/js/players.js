/**
 * Players directory interactions for echecs92.fr.
 * Provides a top players spotlight + local search over a generated index.
 */
(function () {
  const DEFAULT_INDEX_URL = '/wp-content/themes/echecs92-child/assets/data/ffe-players/search-index.json';
  const DEFAULT_TOP_URL = '/wp-content/themes/echecs92-child/assets/data/ffe-players/top-elo.json';
  const DEFAULT_DETAIL_BASE = '/joueur/';
  const DASH_RX = /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE63\uFF0D]/g;

  const normaliseDashes = (value) => (value == null ? '' : String(value)).replace(DASH_RX, '-');

  const normalise = (value) =>
    normaliseDashes(value || '')
      .toString()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const parseEloValue = (value) => {
    const str = value == null ? '' : String(value);
    const match = str.match(/(\d{1,4})/);
    if (!match) {
      return 0;
    }
    const n = Number.parseInt(match[1], 10);
    return Number.isFinite(n) ? n : 0;
  };

  const fetchJson = (url) =>
    fetch(url, { headers: { Accept: 'application/json' } }).then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.json();
    });

  const wait = (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, Math.max(0, ms || 0));
    });

  const fetchJsonWithRetry = async (url, options = {}) => {
    const attempts = Number.isFinite(options.attempts) ? Math.max(1, Math.floor(options.attempts)) : 1;
    const baseDelayMs = Number.isFinite(options.baseDelayMs)
      ? Math.max(0, Math.floor(options.baseDelayMs))
      : 0;
    let lastError = null;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await fetchJson(url);
      } catch (error) {
        lastError = error;
        if (attempt >= attempts) {
          break;
        }
        if (baseDelayMs > 0) {
          await wait(baseDelayMs * attempt);
        }
      }
    }

    throw lastError || new Error('Unable to fetch JSON');
  };

  const buildStagingDataUrl = (url) => {
    const raw = (url || '').toString().trim();
    if (!raw) {
      return '';
    }
    const stagingUrl = raw.replace('/assets/data/', '/assets/data.__staging/');
    return stagingUrl !== raw ? stagingUrl : '';
  };

  const fetchJsonWithStagingFallback = async (url, options = {}) => {
    try {
      return await fetchJsonWithRetry(url, options);
    } catch (liveError) {
      const stagingUrl = buildStagingDataUrl(url);
      if (!stagingUrl) {
        throw liveError;
      }
      try {
        return await fetchJsonWithRetry(stagingUrl, options);
      } catch (_stagingError) {
        throw liveError;
      }
    }
  };

  const shell = typeof document !== 'undefined' ? document.querySelector('.players-page') : null;
  if (!shell) {
    return;
  }

  const indexUrl = (shell.dataset.playerIndexUrl || DEFAULT_INDEX_URL).trim() || DEFAULT_INDEX_URL;
  const topUrl = (shell.dataset.playerTopUrl || DEFAULT_TOP_URL).trim() || DEFAULT_TOP_URL;
  const detailBase = (shell.dataset.playerDetailBase || DEFAULT_DETAIL_BASE).trim() || DEFAULT_DETAIL_BASE;
  const isScope92 = shell.classList.contains('players-page--92');

  const spotlightSection = shell.querySelector('.players-spotlight');
  const topHost = document.getElementById('players-top');
  const topStatus = document.getElementById('players-top-status');

  const input = document.getElementById('players-search');
  const searchForm = document.getElementById('players-search-form');
  const clearButton = document.getElementById('players-search-clear');
  const submitButton = document.getElementById('players-search-submit');
  const statusNode = document.getElementById('players-search-status');
  const resultsHost = document.getElementById('players-results');
  const moreButton = document.getElementById('players-more-button');

  if (!input || !statusNode || !resultsHost) {
    return;
  }

  const VISIBLE_DEFAULT = 20;
  const VISIBLE_STEP = 20;
  const MIN_QUERY_LEN = 2;
  const MIN_NO_RESULT_MODAL_DELAY_MS = 520;

  const indexState = {
    loaded: false,
    loading: null,
    rows: [],
  };

  const searchCache = {
    mode: '',
    query: '',
    matches: [],
  };

  let currentMatches = [];
  let visibleCount = VISIBLE_DEFAULT;
  let activeSearchToken = 0;
  let indexPrefetchStarted = false;

  const getDetailBasePath = () => {
    const raw = detailBase || DEFAULT_DETAIL_BASE;
    if (raw.includes('?')) {
      return raw.split('?')[0];
    }
    return raw.endsWith('/') ? raw : `${raw}/`;
  };

  const buildPlayerUrl = (playerId) => {
    const id = (playerId || '').toString().trim();
    if (!id) {
      return '';
    }
    const basePath = getDetailBasePath();
    const params = new URLSearchParams();
    params.set('ffe_player', id);
    const from = window.location.pathname + window.location.search + window.location.hash;
    if (from) {
      params.set('from', from);
    }
    return `${basePath}?${params.toString()}`;
  };

  const setStatus = (message, tone) => {
    const text = (message || '').toString();
    statusNode.textContent = text;
    statusNode.hidden = !text;
    if (tone) {
      statusNode.dataset.tone = tone;
    } else {
      delete statusNode.dataset.tone;
    }
  };

  const setTopStatus = (message) => {
    if (!topStatus) {
      return;
    }
    const text = (message || '').toString();
    topStatus.textContent = text;
    topStatus.hidden = !text;
  };

  const LEGACY_EASTER_EGG = (() => {
    if (typeof document === 'undefined') {
      return { trigger: '', href: '', text: '', issueUrl: '', issueChallengeUrl: '', consumeUrl: '' };
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
    const runtimeIssueUrl = typeof runtime.issueUrl === 'string' ? runtime.issueUrl.trim() : '';
    const runtimeIssueChallengeUrl =
      typeof runtime.issueChallengeUrl === 'string' ? runtime.issueChallengeUrl.trim() : '';
    const runtimeConsumeUrl = typeof runtime.consumeUrl === 'string' ? runtime.consumeUrl.trim() : '';
    const trigger = runtimeTrigger || (typeof dataset.easterEggTrigger === 'string' ? dataset.easterEggTrigger.trim().toLowerCase() : '');
    const href = runtimeHref || (typeof dataset.easterEggHref === 'string' ? dataset.easterEggHref.trim() : '');
    const text = runtimeText || (typeof dataset.easterEggText === 'string' ? dataset.easterEggText.trim() : '');
    const issueUrl = runtimeIssueUrl || '';
    const issueChallengeUrl = runtimeIssueChallengeUrl || '';
    const consumeUrl = runtimeConsumeUrl || '/wp-json/cdje92/v1/rien-code/consume';
    return { trigger, href, text, issueUrl, issueChallengeUrl, consumeUrl };
  })();

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

  const MATHIS_TAKEOVER_ID = 'mathis-takeover';
  const MATHIS_LINK_TEXT = LEGACY_EASTER_EGG.text;
  const MATHIS_DIRECT_HREF = (LEGACY_EASTER_EGG.href || '').trim() || 'https://mathisboche.com';
  const MATHIS_SUBTLE_SUFFIX_START_INDEX = (() => {
    const value = (MATHIS_LINK_TEXT || '').toLowerCase();
    const index = value.lastIndexOf('.com');
    return index >= 0 ? index : -1;
  })();
  const MATHIS_REVEAL_DELAY = 650;
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
  let mathisScrollPosition = 0;
  let mathisFragmentsPrepared = false;
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
        }
        mathisEggPending = false;
        return;
      }

      const cachedUrl = getCachedMathisEggUrl();
      if (cachedUrl) {
        mathisEggCache = null;
        clearMathisEggRefreshTimer();
        if (mathisSequenceActive) {
          prefetchMathisEggUrl().catch(() => {
            // keep best effort behavior
          });
        }
        const popup = window.open(cachedUrl, '_blank', 'noopener');
        if (popup) {
          try {
            popup.opener = null;
          } catch (error) {
            // noop
          }
        }
        mathisEggPending = false;
        return;
      }

      prefetchMathisEggUrl({ force: true })
        .then((url) => {
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
          }
        })
        .catch(() => {
          setStatus("Impossible d'ouvrir le lien secret pour le moment.", 'error');
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
      if (input) {
        input.value = '';
      }
      toggleClearButton();
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
        setStatus('Retour a la recherche de joueurs.', 'info');
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
        // fallback keeps click-based forced fetch
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
        message: "Impossible d'afficher l'effet special sans navigateur.",
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

  const SECRET_COMMANDS = new Map();
  if (LEGACY_EASTER_EGG.trigger) {
    SECRET_COMMANDS.set(LEGACY_EASTER_EGG.trigger, () => showLegacySpectacle());
  }
  let legacyRienCodeConsumed = false;

  const consumeLegacyRienCode = (normalizedTrigger) => {
    if (legacyRienCodeConsumed || !LEGACY_EASTER_EGG.trigger || normalizedTrigger !== LEGACY_EASTER_EGG.trigger) {
      return;
    }

    legacyRienCodeConsumed = true;
    SECRET_COMMANDS.delete(LEGACY_EASTER_EGG.trigger);

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
      const handler = SECRET_COMMANDS.get(candidate);
      if (handler) {
        return handler;
      }
    }
    return null;
  };

  const tryHandleSecretCommand = (rawValue) => {
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
    const result = handler({ query: trimmed, normalized }) || null;
    if (input) {
      input.value = '';
    }
    toggleClearButton();
    if (result && typeof result === 'object') {
      if (result.suppressStatus) {
        setStatus('', 'info');
      } else if (result.message) {
        setStatus(result.message, result.tone || 'info');
      }
    } else if (typeof result === 'string') {
      setStatus(result, 'info');
    }
    return true;
  };

  const syncSearchQueryInUrl = (query) => {
    if (typeof window === 'undefined' || !window.history || typeof window.history.replaceState !== 'function') {
      return;
    }
    try {
      const url = new URL(window.location.href);
      const raw = (query || '').toString().trim();
      if (raw) {
        url.searchParams.set('q', raw);
      } else {
        url.searchParams.delete('q');
      }
      url.searchParams.delete('focus');
      const next = `${url.pathname}${url.search}${url.hash}`;
      const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (next !== current) {
        window.history.replaceState(window.history.state, '', next);
      }
    } catch (error) {
      // ignore url sync failures
    }
  };

  const buildFrancePlayersSearchUrl = (query) => {
    const params = new URLSearchParams();
    const raw = (query || '').toString().trim();
    if (raw) {
      params.set('q', raw);
    }
    params.set('focus', '1');
    const search = params.toString();
    return search ? `/joueurs?${search}` : '/joueurs';
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
    modal.id = 'players-scope-modal';
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
    panel.setAttribute('aria-labelledby', 'players-scope-modal-title');
    modal.appendChild(panel);

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'clubs-scope-modal__close';
    closeButton.setAttribute('aria-label', 'Fermer');
    closeButton.textContent = 'x';
    closeButton.dataset.scopeAction = 'close';
    panel.appendChild(closeButton);

    const title = document.createElement('h2');
    title.id = 'players-scope-modal-title';
    title.className = 'clubs-scope-modal__title';
    panel.appendChild(title);

    const text = document.createElement('p');
    text.className = 'clubs-scope-modal__text';
    panel.appendChild(text);

    const actions = document.createElement('div');
    actions.className = 'clubs-scope-modal__actions';
    panel.appendChild(actions);

    const ignoreButton = document.createElement('button');
    ignoreButton.type = 'button';
    ignoreButton.className = 'btn btn-secondary clubs-scope-modal__stay';
    ignoreButton.dataset.scopeAction = 'close';
    actions.appendChild(ignoreButton);

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
      ignoreButton,
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

  const openScopeModal = (query) => {
    const modalState = ensureScopeModal();
    if (!modalState) {
      return Promise.resolve(false);
    }
    const raw = (query || '').toString().trim();
    modalState.title.textContent = 'Recherche hors du 92';
    modalState.text.textContent = raw
      ? `Aucun joueur n'a été trouvé dans le 92 pour "${raw}". Voulez-vous lancer la recherche sur toute la France ?`
      : "Aucun joueur n'a été trouvé dans le 92. Voulez-vous lancer la recherche sur toute la France ?";
    modalState.ignoreButton.textContent = 'Ignorer';
    modalState.goButton.textContent = 'Rechercher partout en France';
    modalState.lastFocus = typeof document !== 'undefined' ? document.activeElement : null;
    modalState.modal.removeAttribute('hidden');
    modalState.goButton.focus();
    return new Promise((resolve) => {
      modalState.resolve = resolve;
    });
  };

  const setResultsLoading = (label) => {
    // Loading feedback is handled by the global logo spinner overlay.
    void label;
  };

  const clearResultsLoading = () => {
    if (!resultsHost) {
      return;
    }
    resultsHost.classList.remove('is-loading');
    delete resultsHost.dataset.loadingLabel;
  };

  const clearResults = () => {
    resultsHost.innerHTML = '';
    currentMatches = [];
    visibleCount = VISIBLE_DEFAULT;
    if (moreButton) {
      moreButton.hidden = true;
    }
  };

  const resetSearchCache = () => {
    searchCache.mode = '';
    searchCache.query = '';
    searchCache.matches = [];
  };

  const toggleClearButton = () => {
    if (!clearButton) {
      return;
    }
    const hasValue = Boolean((input.value || '').trim());
    clearButton.hidden = !hasValue;
  };

  const createResultRow = (row) => {
    const wrap = document.createElement('div');
    wrap.className = 'player-row';
    wrap.setAttribute('role', 'listitem');

    const link = document.createElement('a');
    link.className = 'player-row__card';
    link.href = buildPlayerUrl(row.id);
    link.rel = 'noopener';
    wrap.appendChild(link);

    const top = document.createElement('div');
    top.className = 'player-row__top';
    link.appendChild(top);

    const heading = document.createElement('div');
    heading.className = 'player-row__heading';
    top.appendChild(heading);

    const name = document.createElement('p');
    name.className = 'player-row__name';
    name.textContent = normaliseDashes(row.name || '') || `Joueur ${row.id}`;
    heading.appendChild(name);

    if (row.club) {
      const club = document.createElement('p');
      club.className = 'player-row__club';
      club.textContent = normaliseDashes(row.club || '');
      heading.appendChild(club);
    }

    const badgeWrap = document.createElement('div');
    badgeWrap.className = 'player-row__badges';
    top.appendChild(badgeWrap);

    const badge = document.createElement('span');
    badge.className = 'player-row__badge';
    if (row.elo) {
      badge.dataset.tone = 'elo';
      badge.textContent = `Elo ${row.elo}`;
    } else {
      badge.dataset.tone = 'muted';
      badge.textContent = 'Elo -';
    }
    badgeWrap.appendChild(badge);

    const footer = document.createElement('div');
    footer.className = 'player-row__footer';
    link.appendChild(footer);

    const cta = document.createElement('span');
    cta.className = 'player-row__cta';
    cta.textContent = 'Voir la fiche';
    footer.appendChild(cta);

    return wrap;
  };

  const renderResults = () => {
    resultsHost.innerHTML = '';
    const fragment = document.createDocumentFragment();
    currentMatches.slice(0, visibleCount).forEach((row) => {
      fragment.appendChild(createResultRow(row));
    });
    resultsHost.appendChild(fragment);
    if (moreButton) {
      moreButton.hidden = currentMatches.length <= visibleCount;
    }
  };

  const getSpinnerApi = () => {
    if (typeof window === 'undefined') {
      return null;
    }
    const spinner = window.cdjeSpinner;
    if (!spinner || typeof spinner.show !== 'function') {
      return null;
    }
    return spinner;
  };

  const showLoadingOverlay = (label) => {
    const spinner = getSpinnerApi();
    if (!spinner) {
      return () => {};
    }
    try {
      return spinner.show(label || 'Recherche en cours…', {
        host: shell,
        lockScroll: false,
        pinToViewport: true,
      });
    } catch (error) {
      return () => {};
    }
  };

  const waitForMinimumSearchTime = (startedAt, minimum = MIN_NO_RESULT_MODAL_DELAY_MS) => {
    const start = Number.isFinite(startedAt) ? startedAt : Date.now();
    const minDelay = Number.isFinite(minimum) ? Math.max(0, minimum) : MIN_NO_RESULT_MODAL_DELAY_MS;
    const elapsed = Date.now() - start;
    const remaining = Math.max(0, minDelay - elapsed);
    if (remaining <= 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      setTimeout(resolve, remaining);
    });
  };

  const ensureIndexLoaded = () => {
    if (indexState.loaded) {
      return Promise.resolve(indexState.rows);
    }
    if (indexState.loading) {
      return indexState.loading;
    }

    const loading = fetchJsonWithStagingFallback(indexUrl, { attempts: 4, baseDelayMs: 300 })
      .then((payload) => {
        const columns = Array.isArray(payload?.columns) ? payload.columns : null;
        const rows = Array.isArray(payload?.rows) ? payload.rows : [];
        const colIndex = (name, fallback) => {
          if (!columns) {
            return fallback;
          }
          const idx = columns.indexOf(name);
          return idx === -1 ? fallback : idx;
        };

        const ID = colIndex('id', 0);
        const NAME = colIndex('name', 1);
        const CLUB = colIndex('club', 2);
        const ELO = colIndex('elo', 3);

        const mapped = [];
        for (const entry of rows) {
          if (!Array.isArray(entry)) {
            continue;
          }
          const id = (entry[ID] || '').toString().trim();
          if (!id) {
            continue;
          }
          const name = (entry[NAME] || '').toString().trim();
          const club = (entry[CLUB] || '').toString().trim();
          const elo = (entry[ELO] || '').toString().trim();

          const nameKey = normalise(name);
          const clubKey = normalise(club);
          const searchKey = `${nameKey} ${clubKey} ${id}`;

          mapped.push({
            id,
            name,
            club,
            elo,
            eloValue: parseEloValue(elo),
            nameKey,
            clubKey,
            searchKey,
          });
        }
        indexState.rows = mapped;
        indexState.loaded = true;
        return mapped;
      })
      .catch((error) => {
        indexState.loaded = false;
        indexState.rows = [];
        throw error;
      })
      .finally(() => {
        indexState.loading = null;
      });

    indexState.loading = loading;
    return loading;
  };

  const scoreMatch = (row, qNorm, qDigits) => {
    let score = 0;
    if (qDigits) {
      if (row.id === qDigits) {
        score += 100;
      } else if (row.id.startsWith(qDigits)) {
        score += 80;
      } else if (row.id.includes(qDigits)) {
        score += 50;
      }
    }
    if (qNorm) {
      if (row.nameKey === qNorm) {
        score += 90;
      } else if (row.nameKey.startsWith(qNorm)) {
        score += 70;
      } else if (row.nameKey.includes(qNorm)) {
        score += 50;
      } else if (row.clubKey.includes(qNorm)) {
        score += 20;
      } else if (row.searchKey.includes(qNorm)) {
        score += 10;
      }
    }
    score += Math.min(9, Math.floor((row.eloValue || 0) / 300));
    return score;
  };

  const resolveSourceRows = (rows, mode, queryValue) => {
    if (!Array.isArray(rows) || !rows.length) {
      return [];
    }
    if (!Array.isArray(searchCache.matches) || !searchCache.matches.length) {
      return rows;
    }
    if (!searchCache.mode || !searchCache.query) {
      return rows;
    }
    if (searchCache.mode !== mode) {
      return rows;
    }
    if (!queryValue || queryValue.length < searchCache.query.length) {
      return rows;
    }
    if (!queryValue.startsWith(searchCache.query)) {
      return rows;
    }
    return searchCache.matches;
  };

  const runSearch = (query) => {
    const searchStartedAt = Date.now();
    const token = (activeSearchToken += 1);
    const raw = (query || '').toString().trim();
    toggleClearButton();

    if (tryHandleSecretCommand(raw)) {
      syncSearchQueryInUrl('');
      clearResultsLoading();
      clearResults();
      resetSearchCache();
      if (spotlightSection) {
        spotlightSection.hidden = false;
      }
      return;
    }

    if (!raw) {
      syncSearchQueryInUrl('');
      setStatus('');
      clearResultsLoading();
      clearResults();
      resetSearchCache();
      if (spotlightSection) {
        spotlightSection.hidden = false;
      }
      return;
    }

    if (raw.length < MIN_QUERY_LEN) {
      syncSearchQueryInUrl('');
      setStatus(`Tapez au moins ${MIN_QUERY_LEN} caracteres.`, 'info');
      clearResultsLoading();
      clearResults();
      resetSearchCache();
      if (spotlightSection) {
        spotlightSection.hidden = false;
      }
      return;
    }

    syncSearchQueryInUrl(raw);

    if (spotlightSection) {
      spotlightSection.hidden = true;
    }

    setStatus('Recherche en cours...', 'info');
    setResultsLoading(indexState.loaded ? 'Recherche en cours...' : "Chargement de l'index...");
    clearResults();
    const releaseOverlay = showLoadingOverlay(indexState.loaded ? 'Recherche en cours…' : "Chargement de l'index…");
    let overlayReleased = false;
    const releaseBusy = () => {
      if (overlayReleased) {
        return;
      }
      overlayReleased = true;
      if (typeof releaseOverlay === 'function') {
        releaseOverlay();
      }
    };

    const qDigits = raw.replace(/\D/g, '');
    const isPureDigits = qDigits && qDigits === raw.replace(/\s+/g, '');
    const qNorm = isPureDigits ? '' : normalise(raw);
    const mode = isPureDigits ? 'digits' : 'text';
    const queryValue = isPureDigits ? qDigits : qNorm;

    ensureIndexLoaded()
      .then((rows) => {
        if (token !== activeSearchToken) {
          releaseBusy();
          return;
        }

        const sourceRows = resolveSourceRows(rows, mode, queryValue);
        const matches = [];
        const q = queryValue;
        const qTerms = !isPureDigits ? q.split(' ').filter(Boolean) : [];
        for (const row of sourceRows) {
          if (!row) {
            continue;
          }
          if (isPureDigits) {
            if (row.id.includes(qDigits)) {
              matches.push(row);
            }
            continue;
          }
          if (!q) {
            continue;
          }
          if (qTerms.length <= 1) {
            if (row.searchKey.includes(q)) {
              matches.push(row);
            }
            continue;
          }
          let allTermsFound = true;
          for (const term of qTerms) {
            if (!row.searchKey.includes(term)) {
              allTermsFound = false;
              break;
            }
          }
          if (allTermsFound) {
            matches.push(row);
          }
        }

        const ranked = matches.map((row) => ({
          row,
          score: scoreMatch(row, qNorm, isPureDigits ? qDigits : ''),
        }));

        ranked.sort((a, b) => {
          if (b.score !== a.score) {
            return b.score - a.score;
          }
          if ((b.row.eloValue || 0) !== (a.row.eloValue || 0)) {
            return (b.row.eloValue || 0) - (a.row.eloValue || 0);
          }
          return (a.row.name || '').localeCompare(b.row.name || '', 'fr', { sensitivity: 'base' });
        });

        const sortedMatches = ranked.map((entry) => entry.row);
        searchCache.mode = mode;
        searchCache.query = queryValue;
        searchCache.matches = sortedMatches;

        clearResultsLoading();
        currentMatches = sortedMatches;
        visibleCount = VISIBLE_DEFAULT;

        if (!sortedMatches.length) {
          if (!isScope92) {
            clearResults();
            const searchToken = token;
            waitForMinimumSearchTime(searchStartedAt)
              .then(() => {
                if (searchToken !== activeSearchToken) {
                  releaseBusy();
                  return;
                }
                releaseBusy();
                setStatus('Aucun joueur trouve.', 'error');
              })
              .catch(() => {
                releaseBusy();
              });
            return;
          }
          setStatus('Aucun joueur trouve dans le 92.', 'info');
          clearResults();
          const searchToken = token;
          waitForMinimumSearchTime(searchStartedAt)
            .then(() => {
              if (searchToken !== activeSearchToken) {
                releaseBusy();
                return false;
              }
              releaseBusy();
              return openScopeModal(raw);
            })
            .then((accepted) => {
              if (!accepted || searchToken !== activeSearchToken) {
                return;
              }
              if (typeof window !== 'undefined') {
                window.location.assign(buildFrancePlayersSearchUrl(raw));
              }
            })
            .catch(() => {
              releaseBusy();
            });
          return;
        }

        releaseBusy();
        const total = sortedMatches.length;
        setStatus(total === 1 ? '1 joueur trouve.' : `${total} joueurs trouves.`, 'success');
        renderResults();
      })
      .catch(() => {
        releaseBusy();
        if (token !== activeSearchToken) {
          return;
        }
        clearResultsLoading();
        setStatus("Impossible de charger l'index des joueurs pour le moment.", 'error');
        clearResults();
        resetSearchCache();
      });
  };

  const initEvents = () => {
    toggleClearButton();

    input.addEventListener('input', () => {
      toggleClearButton();
      activeSearchToken += 1;
      clearResultsLoading();
      setStatus('');
      clearResults();
      if (spotlightSection) {
        spotlightSection.hidden = false;
      }
    });

    input.addEventListener('focus', () => {
      if (indexPrefetchStarted) {
        return;
      }
      indexPrefetchStarted = true;
      ensureIndexLoaded().catch(() => {
        // ignore prefetch failures; search will show a proper error.
      });
    });

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        if ((input.value || '').trim()) {
          input.value = '';
          toggleClearButton();
          runSearch('');
        }
      }
    });

    if (searchForm) {
      searchForm.addEventListener('submit', (event) => {
        event.preventDefault();
        runSearch(input.value || '');
      });
    } else if (submitButton) {
      submitButton.addEventListener('click', () => runSearch(input.value || ''));
    }

    if (clearButton) {
      clearButton.addEventListener('click', () => {
        input.value = '';
        input.focus();
        toggleClearButton();
        runSearch('');
      });
    }

    if (moreButton) {
      moreButton.addEventListener('click', () => {
        visibleCount = Math.min(currentMatches.length, visibleCount + VISIBLE_STEP);
        renderResults();
      });
    }
  };

  const renderTop = (payload) => {
    if (!topHost) {
      return;
    }
    topHost.innerHTML = '';

    const columns = Array.isArray(payload?.columns) ? payload.columns : null;
    const rows = Array.isArray(payload?.rows) ? payload.rows : [];
    const colIndex = (name, fallback) => {
      if (!columns) {
        return fallback;
      }
      const idx = columns.indexOf(name);
      return idx === -1 ? fallback : idx;
    };

    const ID = colIndex('id', 0);
    const NAME = colIndex('name', 1);
    const CLUB = colIndex('club', 2);
    const ELO = colIndex('elo', 3);

    rows.slice(0, 10).forEach((entry, idx) => {
      if (!Array.isArray(entry)) {
        return;
      }
      const id = (entry[ID] || '').toString().trim();
      if (!id) {
        return;
      }
      const name = (entry[NAME] || '').toString().trim();
      const club = (entry[CLUB] || '').toString().trim();
      const elo = (entry[ELO] || '').toString().trim();

      const card = document.createElement('a');
      card.className = 'player-top-card';
      card.href = buildPlayerUrl(id);
      card.setAttribute('role', 'listitem');

      const rank = document.createElement('div');
      rank.className = 'player-top-card__rank';
      rank.textContent = `#${idx + 1}`;
      card.appendChild(rank);

      const body = document.createElement('div');
      body.className = 'player-top-card__body';
      card.appendChild(body);

      const title = document.createElement('div');
      title.className = 'player-top-card__name';
      title.textContent = normaliseDashes(name) || `Joueur ${id}`;
      body.appendChild(title);

      if (club) {
        const meta = document.createElement('div');
        meta.className = 'player-top-card__club';
        meta.textContent = normaliseDashes(club);
        body.appendChild(meta);
      }

      const rating = document.createElement('div');
      rating.className = 'player-top-card__rating';
      rating.textContent = elo ? normaliseDashes(elo) : '-';
      card.appendChild(rating);

      topHost.appendChild(card);
    });
  };

  const initTop = () => {
    if (!topHost || !topStatus) {
      return;
    }
    setTopStatus('Chargement du classement...');
    fetchJsonWithStagingFallback(topUrl, { attempts: 3, baseDelayMs: 300 })
      .then((payload) => {
        renderTop(payload);
        setTopStatus('');
      })
      .catch(() => {
        setTopStatus('Classement indisponible pour le moment.');
      });
  };

  initTop();
  initEvents();

  let shouldFocus = false;
  let queryFromUrl = '';
  try {
    const params = new URLSearchParams(window.location.search || '');
    shouldFocus = params.get('focus') === '1';
    queryFromUrl = (params.get('q') || '').trim();
  } catch (error) {
    // ignore
  }

  if (queryFromUrl) {
    input.value = queryFromUrl;
    toggleClearButton();
    runSearch(queryFromUrl);
  }

  if (shouldFocus) {
    input.focus();
  }
})();
