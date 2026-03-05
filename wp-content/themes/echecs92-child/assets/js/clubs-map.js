(function () {
  const DATA_URL = '/wp-content/themes/echecs92-child/assets/data/clubs.json';
  const FFE_DETAILS_URL = '/wp-content/themes/echecs92-child/assets/data/clubs-france/92.json';
  const CLUBS_NAV_STORAGE_KEY = 'echecs92:clubs:last-listing';
  const DASH_RX = /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE63\uFF0D]/g;
  const normaliseDashes = (value) => (value == null ? '' : value.toString()).replace(DASH_RX, '-');
  const mapElement = document.getElementById('clubs-map');
  const mapBackLink = document.querySelector('[data-clubs-map-back]');
  if (!mapElement || typeof L === 'undefined') {
    return;
  }

  const statusElement = document.getElementById('clubs-map-status');
  const detailBase = mapElement.dataset.detailBase || '/club-92/';
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
        JSON.stringify({ ts: Date.now(), context, back: backPath || '/clubs-92' })
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
      const normalized = refUrl.pathname.replace(/\/+$/u, '') || '/';
      return normalized === '/clubs-92';
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
	    const commune = normaliseDashes(formatCommune(communeRaw));
    const postalCode = raw.code_postal || raw.postal_code || addressParts.postalCode || secondaryParts.postalCode || '';
    const slugSource = commune || name || postalCode || primaryAddress || secondaryAddress;
    const standardAddress = buildStandardAddress(
      primaryAddress,
      secondaryAddress,
      postalCode,
      commune || addressParts.city || secondaryParts.city || ''
    );
    const id = raw.id || slugify(name || slugSource || `club-${Date.now()}`);

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
      slug: slugify(slugSource || id || name || 'club'),
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

    const directLat = Number.parseFloat(club.latitude ?? club.lat);
    const directLng = Number.parseFloat(club.longitude ?? club.lng ?? club.lon);
    if (Number.isFinite(directLat) && Number.isFinite(directLng)) {
      return {
        lat: directLat,
        lng: directLng,
        label: club.commune || club.addressStandard || club.address || club.name || '',
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
      const coords = getPostalCoordinates(postalCandidates[i]);
      if (coords) {
        return { lat: coords.lat, lng: coords.lng, label: coords.label, postalCode: coords.postalCode };
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
        };
      }
    }

    return null;
  };

  const getClubDetailUrl = (club) => {
    if (!club) {
      return '#';
    }
    const base = detailBase || '';
    const slug = club.slug || club.id || slugify(club.name || '');
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

  const createPopupContent = (club) => {
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
    rememberNavigation('detail:map', '/carte-des-clubs-92');
  };

  mapElement.addEventListener('click', handleMapLinkInteraction);
  mapElement.addEventListener('auxclick', handleMapLinkInteraction);

  const fetchJson = (url) =>
    fetch(url, { headers: { Accept: 'application/json' } }).then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.json();
    });

  updateStatus('Chargement de la carte…', 'info');
  const spinnerHost = mapElement.closest('.clubs-map__container') || mapElement;
  const releaseSpinner =
    typeof window !== 'undefined' && window.cdjeSpinner && typeof window.cdjeSpinner.show === 'function'
      ? window.cdjeSpinner.show('Chargement de la carte…', { host: spinnerHost })
      : () => {};

  Promise.all([fetchJson(DATA_URL), fetchJson(FFE_DETAILS_URL).catch(() => [])])
    .then(([payload, ffeDetails]) => {
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
      const features = [];

      clubs.forEach((club) => {
        const coords = resolveClubCoordinates(club);
        if (!coords) {
          return;
        }
        features.push({
          club,
          coords,
        });
      });

      if (!features.length) {
        updateStatus('Impossible de positionner les clubs sur la carte.', 'error');
        return;
      }

      const map = L.map(mapElement, {
        zoomControl: true,
        scrollWheelZoom: true,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 18,
      }).addTo(map);

      const bounds = L.latLngBounds();

      features.forEach(({ club, coords }) => {
        const marker = L.marker([coords.lat, coords.lng], {
          title: club.name,
        });
        marker.bindPopup(createPopupContent(club), {
          keepInView: true,
        });
        marker.addTo(map);
        bounds.extend([coords.lat, coords.lng]);
      });

      const total = features.length;
      if (total === 1) {
        map.setView(bounds.getCenter(), 13);
      } else {
        map.fitBounds(bounds, { padding: [32, 32], maxZoom: 14 });
      }

      setTimeout(() => {
        map.invalidateSize();
      }, 100);

      updateStatus(`${total} club${total > 1 ? 's' : ''} affiché${total > 1 ? 's' : ''} sur la carte.`, 'success');
    })
    .catch(() => {
      updateStatus('Impossible de charger la carte pour le moment. Veuillez réessayer plus tard.', 'error');
    })
    .finally(() => {
      releaseSpinner();
    });
})();
