const PAGE_CLASSES = {
  'page-home': 'home',
  'page-recipe': 'recipe',
  'add-page': 'add',
  'page-planner': 'planner',
  'page-bread-maker': 'bread',
  'admin-page': 'admin',
};

const NAV_ITEMS = [
  { key: 'home', href: 'index.html', label: 'Cookbook', icon: 'book' },
  { key: 'add', href: 'add.html', label: 'Add recipe', icon: 'plus', emphasis: true },
  { key: 'planner', href: 'planner.html', label: 'Meal prep planner', icon: 'calendar' },
  { key: 'bread', href: 'bread-maker.html', label: 'Bread maker', icon: 'bread', iconOnlyWide: true },
];

const ICONS = {
  book: '<path d="M4 5.5c2.7-.8 5.3-.4 8 1.2v12c-2.7-1.6-5.3-2-8-1.2z"/><path d="M20 5.5c-2.7-.8-5.3-.4-8 1.2v12c2.7-1.6 5.3-2 8-1.2z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="14" rx="1.5"/><path d="M8 3.5v4M16 3.5v4M4 10h16M8 14h3M13 14h3"/>',
  bread: '<path d="M5.2 18.5h13.6c.7 0 1.2-.5 1.2-1.2v-6.1c0-3.2-2.6-5.7-5.7-5.7h-4.6C6.6 5.5 4 8 4 11.2v6.1c0 .7.5 1.2 1.2 1.2Z"/><path d="M8 9.5c1.2.7 2.2 1.7 2.8 3M12 8.2c1.2.7 2.2 1.7 2.8 3"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 13.3a7.8 7.8 0 0 0 0-2.6l2-1.5-2-3.4-2.4 1a8 8 0 0 0-2.2-1.3L14.5 3h-5l-.3 2.5A8 8 0 0 0 7 6.8l-2.4-1-2 3.4 2 1.5a7.8 7.8 0 0 0 0 2.6l-2 1.5 2 3.4 2.4-1a8 8 0 0 0 2.2 1.3l.3 2.5h5l.3-2.5a8 8 0 0 0 2.2-1.3l2.4 1 2-3.4z"/>',
};

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

function createNavIcon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('site-nav-icon');
  svg.innerHTML = ICONS[name] || '';
  return svg;
}

function appendNavLabel(target, label, { visuallyHiddenOnCompact = true } = {}) {
  const span = document.createElement('span');
  span.className = 'site-nav-label';
  if (visuallyHiddenOnCompact) span.dataset.compactHidden = 'true';
  span.textContent = label;
  target.appendChild(span);
}

function renderNavigation() {
  const nav = document.querySelector('[data-site-nav], .site-header .nav-links');
  if (!nav) return;

  const page = currentPageKey();
  nav.setAttribute('aria-label', 'Primary');
  nav.dataset.siteManaged = 'true';
  nav.replaceChildren();

  NAV_ITEMS.forEach((item) => {
    const link = document.createElement('a');
    link.href = item.href;
    link.className = 'site-nav-item';
    link.dataset.siteNavKey = item.key;
    link.setAttribute('aria-label', item.label);
    link.title = item.label;

    if (item.emphasis) link.classList.add('site-nav-item--emphasis');
    if (item.iconOnlyWide) link.classList.add('site-nav-item--icon-only-wide');
    if (item.key === page) {
      link.classList.add('is-current');
      link.setAttribute('aria-current', 'page');
    }

    link.appendChild(createNavIcon(item.icon));
    appendNavLabel(link, item.label);
    nav.appendChild(link);
  });

  const admin = document.createElement('details');
  admin.className = 'site-nav-admin';
  if (page === 'admin') admin.classList.add('is-current');

  const summary = document.createElement('summary');
  summary.className = 'site-nav-item site-nav-admin-toggle';
  summary.setAttribute('aria-label', 'Admin');
  summary.title = 'Admin';
  summary.appendChild(createNavIcon('gear'));
  admin.appendChild(summary);

  const menu = document.createElement('div');
  menu.className = 'site-nav-admin-menu';

  const inbox = document.createElement('a');
  inbox.id = 'admin-inbox-link';
  inbox.href = 'admin.html';
  inbox.textContent = 'Recipe inbox';
  if (page === 'admin') inbox.setAttribute('aria-current', 'page');
  menu.appendChild(inbox);

  admin.appendChild(menu);
  nav.appendChild(admin);
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
