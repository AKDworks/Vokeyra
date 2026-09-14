import { onAppLanguageChange, tr } from './i18n';
import { setIcon } from './icons';

export interface SelectOption { value: string; label: string }

function renderLabel(host: HTMLElement, label: string): void {
  const translated = tr(label);
  const parts = translated.split(' × ');
  if (parts.length !== 2) { host.textContent = translated; return; }
  const cross = document.createElement('span');
  cross.className = 'dimension-cross';
  cross.setAttribute('aria-hidden', 'true');
  setIcon(cross, 'close');
  host.replaceChildren(document.createTextNode(`${parts[0]} `), cross, document.createTextNode(` ${parts[1]}`));
}

/** Select-only combobox: the trigger keeps focus while the list is open. */
export class CustomSelect {
  private static measure = document.createElement('canvas').getContext('2d')!;
  private selected = 0;
  private active = 0;
  private open = false;
  private search = '';
  private searchedAt = 0;
  private items: HTMLElement[] = [];

  constructor(
    private trigger: HTMLButtonElement,
    private list: HTMLElement,
    private options: SelectOption[],
    private onChange: (value: string) => void,
  ) {
    this.setOptions(options);
    trigger.addEventListener('click', () => this.open ? this.close() : this.show());
    trigger.addEventListener('keydown', event => this.keydown(event));
    trigger.addEventListener('blur', () => this.close());
    document.addEventListener('pointerdown', event => {
      if (!trigger.parentElement!.contains(event.target as Node)) this.close();
    });
    document.querySelector('main')?.addEventListener('scroll', () => this.close());
    window.addEventListener('blur', () => this.close());
    onAppLanguageChange(() => {
      this.items.forEach((item, index) => renderLabel(item, this.options[index]!.label));
      renderLabel(this.trigger.querySelector<HTMLElement>('[data-value]')!, this.options[this.selected]!.label);
      this.resize();
    });
    void document.fonts.ready.then(() => this.resize());
  }

  setOptions(options: SelectOption[]): void {
    this.close();
    this.options = options;
    this.list.replaceChildren();
    this.items = options.map((option, index) => {
      const item = document.createElement('div');
      item.id = `${this.list.id}-${index}`;
      item.setAttribute('role', 'option');
      renderLabel(item, option.label);
      item.addEventListener('pointermove', () => this.highlight(index));
      item.addEventListener('pointerdown', event => event.preventDefault());
      item.addEventListener('click', () => this.choose(index));
      this.list.append(item);
      return item;
    });
    this.setValue(options[0]!.value);
  }

  setValue(value: string): void {
    const index = this.options.findIndex(option => option.value === value);
    if (index < 0) return;
    this.selected = index;
    renderLabel(this.trigger.querySelector<HTMLElement>('[data-value]')!, this.options[index]!.label);
    this.resize();
    this.items.forEach((item, i) => item.setAttribute('aria-selected', String(i === index)));
    if (this.open) this.highlight(index);
  }

  setDisabled(disabled: boolean): void {
    this.trigger.disabled = disabled;
    if (disabled) this.close();
  }

  private resize(): void {
    const style = getComputedStyle(this.trigger);
    CustomSelect.measure.font = style.font;
    const text = tr(this.options[this.selected]!.label);
    const crossAllowance = text.includes(' × ') ? 10 : 0;
    const width = CustomSelect.measure.measureText(text).width + crossAllowance
      + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
      + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth) + parseFloat(style.columnGap)
      + parseFloat(getComputedStyle(this.trigger.querySelector(':scope > svg')!).width) + 2;
    const container = this.trigger.parentElement!;
    const max = parseFloat(getComputedStyle(container).getPropertyValue('--select-max-width')) || 224;
    container.style.width = `${Math.min(max, Math.ceil(width))}px`;
  }

  close(): void {
    this.open = false;
    this.list.hidden = true;
    this.trigger.setAttribute('aria-expanded', 'false');
    this.trigger.removeAttribute('aria-activedescendant');
    this.search = '';
  }

  private show(index = this.selected): void {
    if (this.trigger.disabled) return;
    this.open = true;
    this.list.hidden = false;
    const bounds = this.trigger.getBoundingClientRect();
    const viewport = document.querySelector('main')!.getBoundingClientRect();
    const below = viewport.bottom - bounds.bottom - 8;
    const above = bounds.top - viewport.top - 8;
    const upwards = below < Math.min(280, this.list.scrollHeight + 2) && above > below;
    this.list.classList.toggle('above', upwards);
    this.list.style.maxHeight = `${Math.max(40, Math.min(280, upwards ? above : below))}px`;
    this.trigger.setAttribute('aria-expanded', 'true');
    this.highlight(index);
  }

  private highlight(index: number): void {
    this.active = index;
    this.items.forEach((item, i) => item.classList.toggle('active', i === index));
    if (this.open) {
      const item = this.items[index]!;
      this.trigger.setAttribute('aria-activedescendant', item.id);
      // Scroll only the list, never the surrounding settings page.
      if (item.offsetTop < this.list.scrollTop) this.list.scrollTop = item.offsetTop;
      else if (item.offsetTop + item.offsetHeight > this.list.scrollTop + this.list.clientHeight) {
        this.list.scrollTop = item.offsetTop + item.offsetHeight - this.list.clientHeight;
      }
    }
  }

  private choose(index: number): void {
    const changed = index !== this.selected;
    const value = this.options[index]!.value;
    this.setValue(value);
    this.close();
    if (changed) this.onChange(value);
  }

  private keydown(event: KeyboardEvent): void {
    if (event.key === 'Tab') { this.close(); return; }
    if (event.key === 'Escape') { if (this.open) event.preventDefault(); this.close(); return; }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) {
      event.preventDefault();
      if (event.key === 'Enter' || event.key === ' ') {
        if (this.open) this.choose(this.active); else this.show();
      } else if (event.key === 'Home') this.show(0);
      else if (event.key === 'End') this.show(this.options.length - 1);
      else if (!this.open) this.show();
      else this.highlight(Math.max(0, Math.min(this.options.length - 1, this.active + (event.key === 'ArrowDown' ? 1 : -1))));
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      const now = Date.now();
      this.search = (now - this.searchedAt > 700 ? '' : this.search) + event.key.toLocaleLowerCase();
      this.searchedAt = now;
      const index = this.options.findIndex(option => tr(option.label).toLocaleLowerCase().startsWith(this.search));
      if (index >= 0) this.show(index);
    }
  }
}
