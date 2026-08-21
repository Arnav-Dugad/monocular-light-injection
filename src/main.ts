import { d } from 'typegpu';

// Sizes the example's canvas in device pixels, tracking its CSS box.
const stage = document.querySelector('#stage') as HTMLDivElement;
const canvas = document.querySelector('canvas') as HTMLCanvasElement;

new ResizeObserver(([entry]) => {
  if (!entry) return;
  const dpr = window.devicePixelRatio || 1;
  const box = entry.contentBoxSize?.[0] ?? { inlineSize: entry.contentRect.width, blockSize: entry.contentRect.height };
  canvas.width = Math.max(1, Math.round(box.inlineSize * dpr));
  canvas.height = Math.max(1, Math.round(box.blockSize * dpr));
}).observe(stage);

void (async () => {
  const { controls, onCleanup } = await import('./example/index.ts');
  renderControls(controls);
  window.addEventListener('beforeunload', () => onCleanup());
})();

// Minimal vanilla-JS renderer for the `defineControls` panel description
// used by TypeGPU examples (see src/common/defineControls.ts).
function renderControls(controls: Record<string, unknown>): void {
  const host = document.querySelector('#controls') as HTMLDivElement;

  for (const [label, param] of Object.entries(controls)) {
    if (!param) continue;
    const row = document.createElement('div');
    row.className = 'control';

    if (isOfType<{ onButtonClick: () => void }>(param, 'onButtonClick')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('click', () => param.onButtonClick());
      row.append(button);
    } else if (isOfType<{ initial: boolean; onToggleChange: (v: boolean) => void }>(param, 'onToggleChange')) {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = param.initial;
      input.addEventListener('change', () => param.onToggleChange(input.checked));
      row.append(labelFor(label, input), input);
    } else if (
      isOfType<{ initial: number; min?: number; max?: number; step?: number; onSliderChange: (v: number) => void }>(
        param,
        'onSliderChange',
      )
    ) {
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(param.min ?? 0);
      input.max = String(param.max ?? 1);
      input.step = String(param.step ?? 0.1);
      input.value = String(param.initial);
      input.addEventListener('input', () => param.onSliderChange(Number(input.value)));
      row.append(labelFor(label, input), input);
    } else if (
      isOfType<{ initial: d.v3f; onColorChange: (v: d.v3f) => void }>(param, 'onColorChange')
    ) {
      const input = document.createElement('input');
      input.type = 'color';
      input.value = rgbToHex(param.initial);
      input.addEventListener('input', () => param.onColorChange(hexToRgb(input.value)));
      row.append(labelFor(label, input), input);
    } else if (
      isOfType<{ initial: string; options: readonly string[]; onSelectChange: (v: string) => void }>(
        param,
        'onSelectChange',
      )
    ) {
      const select = document.createElement('select');
      for (const option of param.options) {
        const optionEl = document.createElement('option');
        optionEl.value = String(option);
        optionEl.textContent = String(option);
        optionEl.selected = option === param.initial;
        select.append(optionEl);
      }
      select.addEventListener('change', () => param.onSelectChange(select.value));
      row.append(labelFor(label, select), select);
    } else if (
      isOfType<{ initial: string; onTextChange: (v: string) => void }>(param, 'onTextChange')
    ) {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = param.initial;
      input.addEventListener('change', () => param.onTextChange(input.value));
      row.append(labelFor(label, input), input);
    } else {
      continue;
    }

    host.append(row);
  }
}

function isOfType<T>(value: unknown, key: keyof T): value is T {
  return typeof value === 'object' && value !== null && key in value;
}

function labelFor(text: string, input: HTMLElement): HTMLLabelElement {
  const id = `control-${text.replace(/\s+/g, '-')}`;
  input.id = id;
  const label = document.createElement('label');
  label.htmlFor = id;
  label.textContent = text;
  return label;
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
