import { d } from 'typegpu';

/* ===================================================================
   App shell for the standalone build.

   The example module (src/example/**) owns all GPU work and binds to a
   fixed set of DOM selectors declared in index.html. This file only
   provides the surrounding UI: a WebGPU gate, the control dock, keyboard
   shortcuts, toasts and first-run hints.

   Note: the renderer sizes the canvas backing store itself (a square, on
   every frame), so the shell must NOT set canvas.width/height — it only
   has to keep the CSS box 1:1, which index.html does.
   =================================================================== */

const app = document.querySelector('#app') as HTMLDivElement;
const statusEl = document.querySelector('.status') as HTMLDivElement;
const chooserEl = document.querySelector('.chooser') as HTMLDivElement;
const controlsHost = document.querySelector('#controls') as HTMLDivElement;
const toastHost = document.querySelector('#toasts') as HTMLDivElement;
const coach = document.querySelector('.coach') as HTMLDivElement;
const shortcutsSheet = document.querySelector('#shortcuts') as HTMLDivElement;
const unsupportedSheet = document.querySelector('#unsupported') as HTMLDivElement;

const COACH_SEEN_KEY = 'li-coach-seen';

/** Controls registered by renderControls, keyed by their label. */
interface Registered {
  reset: () => void;
  select?: (option: string) => void;
  press?: () => void;
  options?: readonly string[];
}
const registry = new Map<string, Registered>();

// ===================================================================
// Boot — gate on WebGPU before importing anything that needs a device
// ===================================================================

void (async () => {
  // Presence of navigator.gpu isn't enough: plenty of machines expose the API
  // but hand back no adapter (blocklisted driver, no discrete GPU, Linux
  // without the right flags). Ask for one before loading anything heavy, so
  // those users get the explainer instead of a raw init error.
  const adapter = await navigator.gpu?.requestAdapter().catch(() => null);
  if (!adapter) {
    statusEl.hidden = true;
    unsupportedSheet.hidden = false;
    return;
  }

  const { controls, onCleanup } = await import('./example/index.ts');
  renderControls(controls as Record<string, unknown>);
  watchLiveState();
  wireChrome();
  window.addEventListener('beforeunload', () => onCleanup());
})();

// ===================================================================
// Control dock
// ===================================================================

/** Which group each known control belongs to. Unknown ones fall back to "More",
 *  so a control added upstream later still renders instead of disappearing. */
const LAYOUT: Record<string, string> = {
  view: 'View',
  camera: 'View',
  intensity: 'Light',
  ambient: 'Light',
  'light color': 'Light',
  relief: 'Surface',
  shadow: 'Surface',
  occlusion: 'Surface',
  'switch model / source': 'Session',
};
const GROUP_ORDER = ['View', 'Light', 'Surface', 'Session', 'More'];

function renderControls(controls: Record<string, unknown>): void {
  const groups = new Map<string, HTMLDivElement>();
  let index = 0;

  const groupFor = (name: string): HTMLDivElement => {
    let group = groups.get(name);
    if (!group) {
      group = document.createElement('div');
      group.className = 'group';
      const label = document.createElement('div');
      label.className = 'group-label';
      label.textContent = name;
      group.append(label);
      groups.set(name, group);
    }
    return group;
  };

  for (const [label, param] of Object.entries(controls)) {
    if (!param) continue;
    const row = buildRow(label, param, index++);
    if (row) groupFor(LAYOUT[label] ?? 'More').append(row);
  }

  for (const name of GROUP_ORDER) {
    const group = groups.get(name);
    if (group) controlsHost.append(group);
  }
  // Any group outside GROUP_ORDER (shouldn't happen, but never drop it).
  for (const [name, group] of groups) {
    if (!GROUP_ORDER.includes(name)) controlsHost.append(group);
  }
}

interface Slider {
  initial: number;
  min?: number;
  max?: number;
  step?: number;
  onSliderChange: (v: number) => void;
}
interface Color {
  initial: d.v3f;
  onColorChange: (v: d.v3f) => void;
}
interface Select {
  initial: string;
  options: readonly string[];
  onSelectChange: (v: string) => void;
}
interface Toggle {
  initial: boolean;
  onToggleChange: (v: boolean) => void;
}
interface TextParam {
  initial: string;
  onTextChange: (v: string) => void;
}

function buildRow(label: string, param: unknown, index: number): HTMLDivElement | undefined {
  const row = document.createElement('div');
  row.className = 'row';
  row.style.setProperty('--i', String(index));

  if (has<{ onButtonClick: () => void }>(param, 'onButtonClick')) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'action';
    button.textContent = titleCase(label);
    button.addEventListener('click', () => param.onButtonClick());
    row.append(button);
    registry.set(label, { reset: () => {}, press: () => param.onButtonClick() });
    return row;
  }

  if (has<Slider>(param, 'onSliderChange')) return buildSlider(row, label, param);
  if (has<Color>(param, 'onColorChange')) return buildColor(row, label, param);
  if (has<Select>(param, 'onSelectChange')) return buildSegmented(row, label, param);
  if (has<Toggle>(param, 'onToggleChange')) return buildToggle(row, label, param);
  if (has<TextParam>(param, 'onTextChange')) return buildText(row, label, param);

  return undefined;
}

function buildSlider(row: HTMLDivElement, label: string, param: Slider): HTMLDivElement {
  const min = param.min ?? 0;
  const max = param.max ?? 1;
  const step = param.step ?? 0.1;
  const decimals = decimalsFor(step);

  const head = document.createElement('div');
  head.className = 'row-head';
  const name = document.createElement('label');
  name.className = 'row-label';
  name.textContent = titleCase(label);
  const readout = document.createElement('span');
  readout.className = 'row-value';
  head.append(name, readout);

  const input = document.createElement('input');
  input.type = 'range';
  input.className = 'slider';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  name.htmlFor = input.id = `ctl-${slug(label)}`;

  const paint = (value: number): void => {
    readout.textContent = value.toFixed(decimals);
    const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
    input.style.setProperty('--fill', `${pct}%`);
  };

  const apply = (value: number, notify: boolean): void => {
    input.value = String(value);
    paint(value);
    if (notify) param.onSliderChange(value);
  };

  input.addEventListener('input', () => {
    const value = Number(input.value);
    paint(value);
    param.onSliderChange(value);
  });

  apply(param.initial, false);
  row.append(head, input);
  registry.set(label, { reset: () => apply(param.initial, true) });
  return row;
}

function buildColor(row: HTMLDivElement, label: string, param: Color): HTMLDivElement {
  const head = document.createElement('div');
  head.className = 'row-head';
  const name = document.createElement('span');
  name.className = 'row-label';
  name.textContent = titleCase(label);
  const readout = document.createElement('span');
  readout.className = 'row-value';
  head.append(name, readout);

  const swatch = document.createElement('div');
  swatch.className = 'swatch';
  const fill = document.createElement('div');
  fill.className = 'swatch-fill';
  const input = document.createElement('input');
  input.type = 'color';
  input.setAttribute('aria-label', titleCase(label));
  swatch.append(fill, input);

  const paint = (hex: string): void => {
    fill.style.background = hex;
    readout.textContent = hex.toUpperCase();
  };

  const apply = (hex: string, notify: boolean): void => {
    input.value = hex;
    paint(hex);
    if (notify) param.onColorChange(hexToRgb(hex));
  };

  input.addEventListener('input', () => {
    paint(input.value);
    param.onColorChange(hexToRgb(input.value));
  });

  const initial = rgbToHex(param.initial);
  apply(initial, false);
  row.append(head, swatch);
  registry.set(label, { reset: () => apply(initial, true) });
  return row;
}

function buildSegmented(row: HTMLDivElement, label: string, param: Select): HTMLDivElement {
  const head = document.createElement('div');
  head.className = 'row-head';
  const name = document.createElement('span');
  name.className = 'row-label';
  name.textContent = titleCase(label);
  head.append(name);

  const group = document.createElement('div');
  group.className = 'segmented';
  group.setAttribute('role', 'tablist');
  group.dataset.init = '';

  const buttons = param.options.map((option) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'tab');
    button.textContent = titleCase(String(option));
    button.dataset.value = String(option);
    button.addEventListener('click', () => choose(String(option), true));
    group.append(button);
    return button;
  });

  /** Slides the pill onto the active button. */
  const movePill = (): void => {
    const active = buttons.find((b) => b.getAttribute('aria-selected') === 'true');
    if (!active) return;
    group.style.setProperty('--x', `${active.offsetLeft - group.clientLeft}px`);
    group.style.setProperty('--w', `${active.offsetWidth}px`);
  };

  const choose = (option: string, notify: boolean): void => {
    for (const button of buttons) {
      button.setAttribute('aria-selected', String(button.dataset.value === option));
    }
    movePill();
    if (notify) param.onSelectChange(option);
  };

  choose(String(param.initial), false);
  row.append(head, group);

  // Measure once the row is really laid out, then re-enable the transition.
  requestAnimationFrame(() => {
    movePill();
    requestAnimationFrame(() => group.removeAttribute('data-init'));
  });
  new ResizeObserver(movePill).observe(group);

  registry.set(label, {
    reset: () => choose(String(param.initial), true),
    select: (option) => choose(option, true),
    options: param.options,
  });
  return row;
}

function buildToggle(row: HTMLDivElement, label: string, param: Toggle): HTMLDivElement {
  const wrap = document.createElement('label');
  wrap.className = 'row-head cache-toggle';
  const name = document.createElement('span');
  name.className = 'row-label';
  name.textContent = titleCase(label);
  const input = document.createElement('input');
  input.type = 'checkbox';

  const apply = (value: boolean, notify: boolean): void => {
    input.checked = value;
    if (notify) param.onToggleChange(value);
  };

  input.addEventListener('change', () => param.onToggleChange(input.checked));
  apply(param.initial, false);
  wrap.append(name, input);
  row.append(wrap);
  registry.set(label, { reset: () => apply(param.initial, true) });
  return row;
}

function buildText(row: HTMLDivElement, label: string, param: TextParam): HTMLDivElement {
  const name = document.createElement('label');
  name.className = 'row-label';
  name.textContent = titleCase(label);
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'action';
  name.htmlFor = input.id = `ctl-${slug(label)}`;

  const apply = (value: string, notify: boolean): void => {
    input.value = value;
    if (notify) param.onTextChange(value);
  };

  input.addEventListener('change', () => param.onTextChange(input.value));
  apply(param.initial, false);
  row.append(name, input);
  registry.set(label, { reset: () => apply(param.initial, true) });
  return row;
}

// ===================================================================
// Chrome: dock, shortcuts, toasts, pointer spotlight
// ===================================================================

function wireChrome(): void {
  const dockButton = document.querySelector('#btn-dock') as HTMLButtonElement;
  const resetButton = document.querySelector('#btn-reset') as HTMLButtonElement;
  const shortcutsButton = document.querySelector('#btn-shortcuts') as HTMLButtonElement;
  const fullscreenButton = document.querySelector('#btn-fullscreen') as HTMLButtonElement;
  const sheetClose = shortcutsSheet.querySelector('.sheet-close') as HTMLButtonElement;

  dockButton.addEventListener('click', toggleDock);
  resetButton.addEventListener('click', resetAll);
  shortcutsButton.addEventListener('click', () => toggleSheet(true));
  sheetClose.addEventListener('click', () => toggleSheet(false));
  shortcutsSheet.addEventListener('click', (event) => {
    if (event.target === shortcutsSheet) toggleSheet(false);
  });
  fullscreenButton.addEventListener('click', toggleFullscreen);

  (coach.querySelector('.coach-dismiss') as HTMLButtonElement).addEventListener('click', () =>
    dismissCoach(),
  );

  document.addEventListener('keydown', onKeyDown);
  trackSpotlight();
}

function toggleDock(): void {
  const collapsed = app.dataset.dock === 'collapsed';
  app.dataset.dock = collapsed ? 'expanded' : 'collapsed';
  const button = document.querySelector('#btn-dock') as HTMLButtonElement;
  button.textContent = collapsed ? 'Hide' : 'Show';
  button.title = collapsed ? 'Hide controls (H)' : 'Show controls (H)';
}

function resetAll(): void {
  for (const entry of registry.values()) {
    if (!entry.press) entry.reset();
  }
  toast('Controls reset');
}

function toggleSheet(open: boolean): void {
  shortcutsSheet.hidden = !open;
}

function toggleFullscreen(): void {
  if (document.fullscreenElement) {
    void document.exitFullscreen().catch(() => undefined);
  } else {
    void document.documentElement.requestFullscreen().catch(() => toast('Fullscreen unavailable'));
  }
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const target = event.target as HTMLElement | null;
  if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

  if (event.key === 'Escape') {
    if (!shortcutsSheet.hidden) toggleSheet(false);
    return;
  }
  if (event.key === '?') {
    event.preventDefault();
    toggleSheet(shortcutsSheet.hidden);
    return;
  }

  const view = registry.get('view');
  if (view?.options && /^[1-9]$/.test(event.key)) {
    const option = view.options[Number(event.key) - 1];
    if (option !== undefined) {
      view.select?.(String(option));
      toast(`${titleCase(String(option))} view`);
    }
    return;
  }

  switch (event.key.toLowerCase()) {
    case 'h':
      toggleDock();
      break;
    case 'r':
      resetAll();
      break;
    case 'f':
      toggleFullscreen();
      break;
    case 's':
      registry.get('switch model / source')?.press?.();
      break;
  }
}

/** Feeds pointer position into --mx/--my so chips light up under the cursor. */
function trackSpotlight(): void {
  let queued = false;
  let latest: PointerEvent | undefined;

  document.addEventListener(
    'pointermove',
    (event) => {
      latest = event;
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        if (!latest) return;
        const target = (latest.target as HTMLElement | null)?.closest(
          '.chooser-row button',
        ) as HTMLElement | null;
        if (!target) return;
        const rect = target.getBoundingClientRect();
        target.style.setProperty('--mx', `${latest.clientX - rect.left}px`);
        target.style.setProperty('--my', `${latest.clientY - rect.top}px`);
      });
    },
    { passive: true },
  );
}

let toastTimer: number | undefined;
function toast(message: string): void {
  toastHost.replaceChildren();
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  toastHost.append(el);

  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    el.classList.add('leaving');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, 1600);
}

// ===================================================================
// Live state — drives the aurora dim and the first-run coach marks
// ===================================================================

/** "Live" means frames are on screen: neither the status nor the chooser is up. */
function watchLiveState(): void {
  let wasLive = false;

  const sync = (): void => {
    const live = statusEl.hidden && chooserEl.hidden;
    if (live === wasLive) return;
    wasLive = live;
    document.body.toggleAttribute('data-live', live);
    if (live) maybeShowCoach();
    else hideCoach();
  };

  const observer = new MutationObserver(sync);
  observer.observe(statusEl, { attributes: true, attributeFilter: ['hidden'] });
  observer.observe(chooserEl, { attributes: true, attributeFilter: ['hidden'] });
  sync();
}

let coachTimer: number | undefined;

function maybeShowCoach(): void {
  if (readFlag(COACH_SEEN_KEY)) return;
  coach.hidden = false;
  coach.classList.remove('leaving');
  window.clearTimeout(coachTimer);
  coachTimer = window.setTimeout(() => dismissCoach(), 9000);
}

function dismissCoach(): void {
  writeFlag(COACH_SEEN_KEY);
  hideCoach();
}

function hideCoach(): void {
  window.clearTimeout(coachTimer);
  if (coach.hidden) return;
  coach.classList.add('leaving');
  coach.addEventListener(
    'animationend',
    () => {
      coach.hidden = true;
      coach.classList.remove('leaving');
    },
    { once: true },
  );
}

// ===================================================================
// Helpers
// ===================================================================

function has<T>(value: unknown, key: keyof T): value is T {
  return typeof value === 'object' && value !== null && key in value;
}

function titleCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function slug(text: string): string {
  return text.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
}

function decimalsFor(step: number): number {
  const text = String(step);
  const dot = text.indexOf('.');
  return dot === -1 ? 0 : Math.min(3, text.length - dot - 1);
}

function rgbToHex(v: d.v3f): string {
  const channel = (c: number) =>
    Math.round(Math.min(1, Math.max(0, c)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(v.x)}${channel(v.y)}${channel(v.z)}`;
}

function hexToRgb(hex: string): d.v3f {
  const value = Number.parseInt(hex.slice(1), 16);
  return d.vec3f(((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255);
}

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

function writeFlag(key: string): void {
  try {
    localStorage.setItem(key, '1');
  } catch {
    // private-mode storage denial is fine to ignore
  }
}
