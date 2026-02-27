(() => {
  const DRAFT_KEY = 'cdje92_contact_form_draft_v1';

  const getStorage = () => {
    try {
      return window.sessionStorage;
    } catch (_err) {
      return null;
    }
  };

  const storage = getStorage();

  const readDraft = () => {
    if (!storage) {
      return null;
    }
    try {
      const raw = storage.getItem(DRAFT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_err) {
      return null;
    }
  };

  const writeDraft = (draft) => {
    if (!storage) {
      return;
    }
    try {
      storage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch (_err) {
      // Ignore quota / blocked storage.
    }
  };

  const clearDraft = () => {
    if (!storage) {
      return;
    }
    try {
      storage.removeItem(DRAFT_KEY);
    } catch (_err) {
      // Ignore blocked storage.
    }
  };

  // If we landed on the success state, we can safely drop the stored draft.
  try {
    const params = new URLSearchParams(window.location ? window.location.search : '');
    const status = (params.get('contact_status') || '').toLowerCase();
    if (status === 'success') {
      clearDraft();
    }
  } catch (_err) {
    // noop
  }

  const form = document.getElementById('cdje92-contact-form');
  if (!form) {
    return;
  }

  const FALLBACK_EMAIL = 'contact@echecs92.com';

  const captchaField = form.querySelector('[data-recaptcha-field]');
  const captchaEl = captchaField ? captchaField.querySelector('.g-recaptcha') : null;
  const siteKey = captchaEl && captchaEl.dataset ? (captchaEl.dataset.sitekey || '').trim() : '';
  const messageEl = captchaField ? captchaField.querySelector('[data-recaptcha-message]') : null;
  const submitButton = form.querySelector('.contact-form__submit');
  const wrapper = form.closest('.cdje92-contact-form-wrapper') || form.parentElement;
  const emailInput = form.querySelector('#cdje92-contact-email');
  const clubInput = form.querySelector('#cdje92-contact-club');
  const messageInput = form.querySelector('#cdje92-contact-message');

  // Persist user inputs across refresh (session scope).
  let saveDraftTimer = null;

  const getValue = (el) => (el && typeof el.value === 'string' ? el.value : '');

  const captureDraft = () => ({
    email: getValue(emailInput),
    club: getValue(clubInput),
    message: getValue(messageInput),
  });

  const isEmptyDraft = (draft) => {
    if (!draft || typeof draft !== 'object') {
      return true;
    }
    const email = typeof draft.email === 'string' ? draft.email.trim() : '';
    const club = typeof draft.club === 'string' ? draft.club.trim() : '';
    const message = typeof draft.message === 'string' ? draft.message.trim() : '';
    return email === '' && club === '' && message === '';
  };

  const saveDraftNow = () => {
    const draft = captureDraft();
    if (isEmptyDraft(draft)) {
      clearDraft();
      return;
    }
    writeDraft(draft);
  };

  const scheduleDraftSave = () => {
    if (!storage) {
      return;
    }
    if (saveDraftTimer) {
      window.clearTimeout(saveDraftTimer);
    }
    saveDraftTimer = window.setTimeout(() => {
      saveDraftTimer = null;
      saveDraftNow();
    }, 200);
  };

  const restoreDraft = () => {
    const draft = readDraft();
    if (!draft || typeof draft !== 'object') {
      return;
    }

    const restoreIfEmpty = (el, value) => {
      if (!el || typeof value !== 'string') {
        return;
      }
      if (el.value && el.value.trim() !== '') {
        return;
      }
      const next = value.trim();
      if (next === '') {
        return;
      }
      el.value = value;
    };

    restoreIfEmpty(emailInput, draft.email);
    restoreIfEmpty(clubInput, draft.club);
    restoreIfEmpty(messageInput, draft.message);
  };

  restoreDraft();

  if (emailInput) {
    emailInput.addEventListener('input', scheduleDraftSave);
  }
  if (clubInput) {
    clubInput.addEventListener('input', scheduleDraftSave);
  }
  if (messageInput) {
    messageInput.addEventListener('input', scheduleDraftSave);
  }
  window.addEventListener('pagehide', saveDraftNow);

  const ensureNoticeEl = () => {
    if (!wrapper) {
      return null;
    }
    let notice = wrapper.querySelector('.contact-form__notice');
    if (!notice) {
      notice = document.createElement('div');
      notice.className = 'contact-form__notice contact-form__notice--error';
      wrapper.insertBefore(notice, wrapper.firstChild);
    }
    return notice;
  };

  const setNotice = (text) => {
    const notice = ensureNoticeEl();
    if (!notice) {
      return;
    }
    notice.classList.remove('contact-form__notice--success');
    notice.classList.add('contact-form__notice--error');
    notice.textContent = text || '';
  };

  const ensureMessageEl = () => {
    if (messageEl) {
      return messageEl;
    }
    const hint = document.createElement('p');
    hint.className = 'contact-form__hint contact-form__captcha-message';
    hint.setAttribute('data-recaptcha-message', '');
    if (submitButton && submitButton.parentNode) {
      submitButton.parentNode.insertBefore(hint, submitButton.nextSibling);
    } else {
      form.appendChild(hint);
    }
    return hint;
  };

  const setMessageWithEmailFallback = (prefixText, email = FALLBACK_EMAIL, suffixText = '') => {
    const hint = ensureMessageEl();
    while (hint.firstChild) {
      hint.removeChild(hint.firstChild);
    }

    hint.appendChild(document.createTextNode(prefixText || ''));

    const address = (email || '').trim();
    if (address) {
      const link = document.createElement('a');
      link.href = `mailto:${address}`;
      link.textContent = address;
      hint.appendChild(link);
    }

    if (suffixText) {
      hint.appendChild(document.createTextNode(suffixText));
    }
  };

  if (!captchaField || !captchaEl || !siteKey) {
    setMessageWithEmailFallback(
      "Le formulaire de contact est temporairement indisponible. Merci de réessayer plus tard ou d'envoyer un e-mail à ",
      FALLBACK_EMAIL,
      '.'
    );
    if (submitButton) {
      submitButton.disabled = true;
    }
    return;
  }

  let widgetId = null;
  let scriptPromise = null;
  let pendingSubmit = false;

  const setMessage = (text) => {
    const hint = ensureMessageEl();
    hint.textContent = text || '';
  };

  const showCaptcha = () => {
    if (captchaField.hasAttribute('hidden')) {
      captchaField.removeAttribute('hidden');
    }
    captchaField.setAttribute('aria-hidden', 'false');
  };

  const loadRecaptchaScript = () => {
    if (window.grecaptcha && typeof window.grecaptcha.render === 'function') {
      return Promise.resolve();
    }
    if (scriptPromise) {
      return scriptPromise;
    }

    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://www.google.com/recaptcha/api.js?hl=fr&render=explicit';
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('recaptcha_load_failed'));
      document.head.appendChild(script);
    });

    return scriptPromise;
  };

  const renderRecaptcha = () => {
    if (widgetId !== null) {
      return;
    }

    const doRender = () => {
      if (widgetId !== null) {
        return;
      }
      if (!window.grecaptcha || typeof window.grecaptcha.render !== 'function') {
        return;
      }

      widgetId = window.grecaptcha.render(captchaEl, {
        sitekey: siteKey,
        callback: () => {
          setMessage('');
          if (pendingSubmit) {
            pendingSubmit = false;
            form.submit();
          }
        },
        'expired-callback': () => {
          pendingSubmit = false;
        },
      });
    };

    if (window.grecaptcha && typeof window.grecaptcha.ready === 'function') {
      window.grecaptcha.ready(() => {
        requestAnimationFrame(doRender);
      });
      return;
    }

    requestAnimationFrame(doRender);
  };

  form.addEventListener('submit', (event) => {
    const emailMissing = emailInput && emailInput.validity && emailInput.validity.valueMissing;
    const messageMissing = messageInput && messageInput.validity && messageInput.validity.valueMissing;
    const emailInvalid = emailInput && emailInput.validity && emailInput.validity.typeMismatch;

    if (emailMissing || messageMissing) {
      event.preventDefault();
      setNotice('Merci de renseigner les champs obligatoires.');
      if (form.reportValidity) {
        form.reportValidity();
      }
      return;
    }

    if (emailInvalid) {
      event.preventDefault();
      setNotice("L'adresse e-mail semble invalide.");
      if (form.reportValidity) {
        form.reportValidity();
      }
      return;
    }

    if (!window.grecaptcha || widgetId === null) {
      event.preventDefault();
      pendingSubmit = true;
      showCaptcha();
      setMessage("Merci de confirmer que vous n'êtes pas un robot pour envoyer.");
      loadRecaptchaScript()
        .then(() => {
          renderRecaptcha();
        })
        .catch(() => {
          pendingSubmit = false;
          setMessageWithEmailFallback(
            "Le formulaire de contact est temporairement indisponible. Merci de réessayer plus tard ou d'envoyer un e-mail à ",
            FALLBACK_EMAIL,
            '.'
          );
        });
      return;
    }

    const response = window.grecaptcha.getResponse(widgetId);
    if (!response) {
      event.preventDefault();
      pendingSubmit = true;
      showCaptcha();
      setMessage("Merci de confirmer que vous n'êtes pas un robot pour envoyer.");
    }
  });
})();
