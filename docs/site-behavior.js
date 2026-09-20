const PAGE_CLASSES = {
  'page-home': 'home',
  'page-recipe': 'recipe',
  'add-page': 'add',
  'page-planner': 'planner',
  'page-bread-maker': 'bread',
  'admin-page': 'admin',
};

const NAV_ITEMS = [
  { key: 'home', href: 'index.html', label: 'Cookbook', className: 'button secondary' },
  { key: 'bread', href: 'bread-maker.html', label: 'Bread maker', className: 'button secondary' },
  { key: 'planner', href: 'planner.html', label: 'Meal prep planner', className: 'button secondary' },
  { key: 'add', href: 'add.html', label: 'Add recipe', className: 'button' },
];

const pressFeedbackInstalled = new WeakSet();
const viewportSubscribers = new Set();
const scrollSubscribers = new Set();

const coarsePointerQuery = window.matchMedia('(pointer: coarse)');
const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const compactViewportQuery = window.matchMedia('(max-width: 700px)');

let initialized = false;
let userInteracted = false;
let viewportFramePending = false;
let scrollFramePending = false;

const state = {
  page: 'unknown',
  coarsePointer: coarsePointerQuery.matches,
  reducedMotion: reducedMotionQuery.matches,
  compactViewport: compactViewportQuery.matches,
  visualViewportHeight: window.innerHeight,
  visualViewportOffsetTop: 0,
  keyboardInset: 0,
  keyboardOpen: false,
};

function currentPageKey() {
  const explicit = document.body?.dataset?.sitePage;
  if (explicit) return explicit;

  for (const [className, page] of Object.entries(PAGE_CLASSES)) {
    if (document.body?.classList.contains(className)) return page;
  }
  return 'unknown';
}

function renderNavigation() {
  const nav = document.querySelector('[data-site-nav], .site-header .nav-links');
  if (!nav) return;

  const page = currentPageKey();
  nav.setAttribute('aria-label', 'Primary');
  nav.dataset.siteManaged = 'true';
  nav.replaceChildren();

  if (page === 'add') {
    const inbox = document.createElement('a');
    inbox.id = 'admin-inbox-link';
    inbox.href = 'admin.html';
    inbox.className = 'button secondary site-nav-context';
    inbox.textContent = '← Inbox';
    inbox.hidden = true;
    nav.appendChild(inbox);
  }

  NAV_ITEMS
    .filter((item) => item.key !== page)
    .forEach((item) => {
      const link = document.createElement('a');
      link.href = item.href;
      link.textContent = item.label;
      link.className = item.className;
      link.dataset.siteNavKey = item.key;
      nav.appendChild(link);
    });
}

function writeViewportState() {
  state.page = currentPageKey();
  state.coarsePointer = coarsePointerQuery.matches;
  state.reducedMotion = reducedMotionQuery.matches;
  state.compactViewport = compactViewportQuery.matches;

  const root = document.documentElement;
  const visualViewport = window.visualViewport;
  const layoutHeight = Math.max(
    document.documentElement?.clientHeight || 0,
    window.innerHeight || 0
  );
  const visualHeight = visualViewport?.height || window.innerHeight || layoutHeight;
  const offsetTop = visualViewport?.offsetTop || 0;
  const keyboardInset = Math.max(0, layoutHeight - visualHeight - offsetTop);

  state.visualViewportHeight = visualHeight;
  state.visualViewportOffsetTop = offsetTop;
  state.keyboardInset = keyboardInset;
  state.keyboardOpen = state.coarsePointer && keyboardInset > 120;

  root.dataset.sitePointer = state.coarsePointer ? 'coarse' : 'fine';
  root.dataset.siteMotion = state.reducedMotion ? 'reduced' : 'full';
  root.dataset.siteViewport = state.compactViewport ? 'compact' : 'wide';
  root.dataset.siteKeyboard = state.keyboardOpen ? 'open' : 'closed';

  root.style.setProperty('--site-visual-viewport-height', `${visualHeight.toFixed(2)}px`);
  root.style.setProperty('--site-visual-viewport-offset-top', `${offsetTop.toFixed(2)}px`);
  root.style.setProperty('--site-keyboard-inset', `${keyboardInset.toFixed(2)}px`);
}

function viewportSnapshot() {
  return Object.freeze({ ...state });
}

function notifyViewportSubscribers() {
  viewportFramePending = false;
  writeViewportState();
  const snapshot = viewportSnapshot();
  viewportSubscribers.forEach((callback) => {
    try {
      callback(snapshot);
    } catch (error) {
      console.error('CookingDB viewport subscriber failed', error);
    }
  });
}

function scheduleViewportUpdate() {
  if (viewportFramePending) return;
  viewportFramePending = true;
  window.requestAnimationFrame(notifyViewportSubscribers);
}

function notifyScrollSubscribers() {
  scrollFramePending = false;
  const payload = Object.freeze({
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    viewport: viewportSnapshot(),
  });
  scrollSubscribers.forEach((callback) => {
    try {
      callback(payload);
    } catch (error) {
      console.error('CookingDB scroll subscriber failed', error);
    }
  });
}

function scheduleScrollUpdate() {
  if (scrollFramePending) return;
  scrollFramePending = true;
  window.requestAnimationFrame(notifyScrollSubscribers);
}

function observeMediaQuery(query) {
  const onChange = () => scheduleViewportUpdate();
  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', onChange);
  } else {
    query.addListener?.(onChange);
  }
}

function installEnvironmentListeners() {
  window.addEventListener('resize', scheduleViewportUpdate, { passive: true });
  window.addEventListener('orientationchange', scheduleViewportUpdate, { passive: true });
  window.addEventListener('scroll', scheduleScrollUpdate, { passive: true });

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', scheduleViewportUpdate, { passive: true });
    window.visualViewport.addEventListener('scroll', scheduleViewportUpdate, { passive: true });
  }

  observeMediaQuery(coarsePointerQuery);
  observeMediaQuery(reducedMotionQuery);
  observeMediaQuery(compactViewportQuery);
}

function installInteractionTracking() {
  const markInteracted = () => {
    userInteracted = true;
  };

  window.addEventListener('pointerdown', markInteracted, { once: true, passive: true });
  window.addEventListener('keydown', markInteracted, { once: true });
}

function installFocusTracking() {
  document.addEventListener('focusin', (event) => {
    if (!event.target?.matches?.('input, select, textarea, [contenteditable="true"]')) return;
    document.documentElement.dataset.siteFormFocus = 'true';
    scheduleViewportUpdate();
  });

  document.addEventListener('focusout', () => {
    window.setTimeout(() => {
      const active = document.activeElement;
      const stillEditing = active?.matches?.('input, select, textarea, [contenteditable="true"]');
      document.documentElement.dataset.siteFormFocus = stillEditing ? 'true' : 'false';
      scheduleViewportUpdate();
    }, 0);
  });
}

function init() {
  if (initialized) return;
  initialized = true;

  renderNavigation();
  writeViewportState();
  installEnvironmentListeners();
  installInteractionTracking();
  installFocusTracking();
}

export const siteBehavior = {
  get state() {
    return viewportSnapshot();
  },

  get hasUserInteracted() {
    return userInteracted;
  },

  isCompactViewport() {
    return state.compactViewport;
  },

  onViewportChange(callback, { immediate = true } = {}) {
    viewportSubscribers.add(callback);
    if (immediate) callback(viewportSnapshot());
    return () => viewportSubscribers.delete(callback);
  },

  onScrollFrame(callback) {
    scrollSubscribers.add(callback);
    return () => scrollSubscribers.delete(callback);
  },

  installPressFeedback(element, { pressedClass = 'is-pressed', dragThreshold = 10 } = {}) {
    if (!element || pressFeedbackInstalled.has(element)) return;
    pressFeedbackInstalled.add(element);

    let startX = 0;
    let startY = 0;
    let canceled = false;

    element.addEventListener('pointerdown', (event) => {
      if (element.classList.contains('disabled-link')) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;

      canceled = false;
      startX = event.clientX;
      startY = event.clientY;
      element.classList.add(pressedClass);

      try {
        element.setPointerCapture?.(event.pointerId);
      } catch (_) {}
    });

    element.addEventListener('pointermove', (event) => {
      if (!element.classList.contains(pressedClass)) return;
      const distance = Math.hypot(event.clientX - startX, event.clientY - startY);
      if (distance <= dragThreshold) return;
      canceled = true;
      element.classList.remove(pressedClass);
    });

    const clear = () => element.classList.remove(pressedClass);
    element.addEventListener('pointerup', clear);
    element.addEventListener('pointercancel', () => {
      canceled = true;
      clear();
    });
    element.addEventListener('lostpointercapture', clear);

    element.addEventListener('click', (event) => {
      if (!canceled) return;
      event.preventDefault();
      event.stopPropagation();
    });
  },
};

init();
