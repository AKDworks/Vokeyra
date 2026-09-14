import type { DesktopApi, DownloadState, Model, ModelView, Snapshot } from '../shared/contracts';
import { setIcon } from './icons';
import { getAppLanguage, tr } from './i18n';

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
// A curated, compact menu; the catalog keeps each model's full language support.
const popularLanguages: Record<string, string> = {
  ru: 'Русский', en: 'English', kk: 'Қазақша', uk: 'Українська', be: 'Беларуская',
  de: 'Deutsch', fr: 'Français', es: 'Español', it: 'Italiano', pt: 'Português',
  zh: '中文', ja: '日本語', ko: '한국어', ar: 'العربية', tr: 'Türkçe',
  pl: 'Polski', nl: 'Nederlands', cs: 'Čeština', ro: 'Română', sv: 'Svenska', yue: '粵語',
  bg: 'Български', hr: 'Hrvatski', da: 'Dansk', et: 'Eesti', fi: 'Suomi', el: 'Ελληνικά',
  hu: 'Magyar', lv: 'Latviešu', lt: 'Lietuvių', mt: 'Malti', sk: 'Slovenčina', sl: 'Slovenščina',
  ky: 'Кыргызча', uz: "O‘zbekcha",
};
function languageName(code: string): string {
  if (popularLanguages[code]) return tr(popularLanguages[code]);
  if (!/^[a-z]{2,3}(?:-[A-Za-z]+)?$/.test(code)) return code;
  return new Intl.DisplayNames([getAppLanguage()], { type: 'language' }).of(code) ?? code;
}
function languageSummary(model: Model): string {
  const count = new Set(model.languages).size;
  if (count >= 99) return '99+ языков';
  if (count === 1) {
    const language = languageName(model.languages[0]!);
    return language.length > 45 ? 'Несколько языков' : `Только ${language}`;
  }
  const suffix = count % 10 === 1 && count % 100 !== 11 ? 'язык' : [2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100) ? 'языка' : 'языков';
  return `${count} ${suffix}`;
}
function runtimeName(model: Model): string {
  if (['gigaam-v3-e2e-ctc', 'gigaam-multilingual-ctc'].includes(model.engine)) return 'ONNX Runtime';
  if (['gigaam-v3-e2e-rnnt', 'parakeet-tdt-0-6b-v3-int8', 'moonshine-tiny-en-int8'].includes(model.engine)) return 'sherpa-onnx';
  return model.engine;
}
function node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const item = document.createElement(tag); item.className = className; item.textContent = text; return item;
}
function icon(name: Parameters<typeof setIcon>[1]): HTMLElement {
  const item = node('span', 'model-icon'); item.setAttribute('aria-hidden', 'true'); setIcon(item, name); return item;
}

export class ModelsView {
  private snapshot?: Snapshot;
  private downloads = new Map<string, DownloadState>();
  private busy = false;
  private recommended = false;
  private language = '';
  private languages: string[] = [];
  private startingDownloads = new Set<string>();
  constructor(private api: DesktopApi, private refresh: () => Promise<void>) {
    el('model-search').oninput = () => this.render();
    el('recommended-models').onclick = () => {
      this.recommended = !this.recommended;
      el('recommended-models').setAttribute('aria-pressed', String(this.recommended)); this.render();
    };
    const refreshButton = el<HTMLButtonElement>('refresh-catalog');
    refreshButton.onclick = () => { refreshButton.disabled = true; void this.run(() => api.refreshCatalog()).finally(() => { refreshButton.disabled = false; }); };
    const trigger = el<HTMLButtonElement>('model-language');
    trigger.onclick = () => {
      if (!el('model-language-menu').hidden) { this.close(); return; }
      this.close();
      el('model-language-menu').hidden = false; trigger.setAttribute('aria-expanded', 'true');
      this.renderLanguages(); el('model-language-options').querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
    };
    el('model-language-filter').addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); this.close(); trigger.focus(); }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const buttons = [...el('model-language-options').querySelectorAll<HTMLButtonElement>('button')];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[Math.max(0, Math.min(buttons.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus();
      }
    });
    el('model-language-filter').addEventListener('focusout', event => {
      if (!el('model-language-filter').contains(event.relatedTarget as Node | null)) this.close();
    });
    document.addEventListener('pointerdown', event => { if (!el('model-language-filter').contains(event.target as Node)) this.close(); });
    document.querySelector('main')?.addEventListener('scroll', () => this.close());
    window.addEventListener('blur', () => this.close());
  }
  close(): void { el('model-language-menu').hidden = true; el('model-language').setAttribute('aria-expanded', 'false'); }
  update(snapshot: Snapshot, downloads: Map<string, DownloadState>, busy: boolean): void {
    this.snapshot = snapshot; this.downloads = downloads; this.busy = busy;
    const supported = new Set(snapshot.models.flatMap(item => item.model.languages));
    this.languages = Object.keys(popularLanguages).filter(code => supported.has(code));
    if (this.language && !this.languages.includes(this.language)) {
      this.language = ''; el('model-language-value').textContent = 'Все языки';
    }
    this.render();
  }
  private renderLanguages(): void {
    const list = el('model-language-options'); list.replaceChildren();
    for (const code of ['', ...this.languages]) {
      const label = code ? languageName(code) : 'Все языки';
      const option = node('button', 'language-option', label); option.type = 'button';
      option.setAttribute('aria-pressed', String(code === this.language));
      option.onclick = () => { this.language = code; el('model-language-value').textContent = label; this.close(); el('model-language').focus(); this.render(); };
      list.append(option);
    }
  }
  private async run(operation: () => Promise<unknown>): Promise<void> {
    const error = el('model-error'); error.hidden = true;
    try { await operation(); await this.refresh(); }
    catch (reason) {
      error.textContent = String(reason instanceof Error ? reason.message : reason).replace(/^Error invoking remote method '[^']+': Error: /, ''); error.hidden = false;
    }
  }
  private render(): void {
    if (!this.snapshot) return;
    const list = el('model-list');
    const focused = document.activeElement as HTMLElement | null;
    const focusedId = focused?.closest<HTMLElement>('[data-model]')?.dataset.model;
    const focusedAction = focused?.dataset.action;
    list.replaceChildren();
    const query = el<HTMLInputElement>('model-search').value.trim().toLocaleLowerCase();
    const items = this.snapshot.models.filter(({ model }) => [model.name, model.developer, model.family, model.quantization]
      .some(value => value?.toLocaleLowerCase().includes(query))
      && (!this.recommended || model.recommended) && (!this.language || model.languages.includes(this.language)));
    const installed = items.filter(item => item.installed);
    const available = items.filter(item => !item.installed)
      .sort((a, b) => Number(!!b.model.recommended) - Number(!!a.model.recommended));
    const filtered = !!query || this.recommended || !!this.language;
    installed.forEach(item => list.append(this.card(item)));
    list.append(node('h3', 'models-section', 'Доступные для загрузки'));
    if (!available.length) list.append(node('p', 'models-empty', filtered ? 'Нет доступных моделей по фильтру.' : 'Все доступные модели загружены.'));
    available.forEach(item => list.append(this.card(item)));
    if (focusedId && focusedAction) [...list.querySelectorAll<HTMLElement>('[data-action]')].find(control => control.closest<HTMLElement>('[data-model]')?.dataset.model === focusedId && control.dataset.action === focusedAction)?.focus({ preventScroll: true });
  }
  private card(item: ModelView): HTMLElement {
    const { model, installed } = item;
    const active = !!installed && model.id === this.snapshot!.settings.selectedModelId;
    const state = this.downloads.get(model.id);
    const downloading = !!state && ['downloading', 'verifying'].includes(state.phase);
    const card = node('article', `model-card${active ? ' selected' : ''}`); card.dataset.model = model.id;
    const top = node('div', 'model-card-top');
    const details = node('div', 'model-details');
    const title = node('div', 'model-title'); title.append(node('strong', '', model.name));
    card.setAttribute('aria-label', active ? `${model.name}, активная модель` : model.name);
    if (model.recommended && !installed) {
      const badge = node('span', 'model-badge', 'Рекомендуется'); title.append(badge);
    }
    const metadata = [model.developer, runtimeName(model), model.quantization]
      .filter((value, index, values) => value && values.indexOf(value) === index).join(' · ');
    details.append(title, node('p', 'model-description', metadata));
    if (model.license.toUpperCase() !== 'MIT') {
      const license = node('p', 'model-license', `Лицензия: ${model.license}`); details.append(license);
    }
    const ratings = node('div', 'model-ratings');
    for (const [label, score, description] of [['Точность', model.qualityScore, model.quality], ['Скорость', model.speedScore, model.speed]] as const) {
      const row = node('div', 'model-rating'); row.append(node('span', '', label));
      if (score !== undefined) {
        const meter = node('span', 'model-meter'); meter.setAttribute('role', 'meter');
        meter.setAttribute('aria-valuemin', '0'); meter.setAttribute('aria-valuemax', '5'); meter.setAttribute('aria-valuenow', String(score));
        const fill = node('span', 'model-meter-fill'); fill.style.width = `${score / 5 * 100}%`; meter.append(fill);
        meter.setAttribute('aria-label', `${label}: ${description}, ${score} из 5`);
        row.append(meter);
      } else row.append(node('span', 'rating-description', description));
      ratings.append(row);
    }
    top.append(details, ratings);
    const bottom = node('div', 'model-bottom');
    const languages = node('span', 'model-languages'); languages.append(icon('language'), document.createTextNode(languageSummary(model))); bottom.append(languages);
    const actions = node('div', 'model-card-actions');
    const size = node('span', 'model-size'); size.append(icon(installed ? 'memory' : 'download'), document.createTextNode(`${Math.round((installed?.model.sizeBytes ?? model.sizeBytes) / 1_000_000)} МБ`));
    actions.append(size);
    const action = (label: string, name: string, callback: () => Promise<unknown>, symbol?: Parameters<typeof setIcon>[1], disabled = false) => {
      const button = node('button', `model-action${name === 'delete' ? ' delete-action' : ''}`); button.type = 'button'; button.dataset.action = name;
      if (symbol) button.append(icon(symbol)); button.append(document.createTextNode(label)); button.disabled = disabled;
      button.onclick = () => { button.disabled = true; void this.run(callback).finally(() => { button.disabled = disabled; }); };
      return button;
    };
    if (!downloading && !item.supported) actions.append(node('span', 'muted', 'Нет движка'));
    else if (!downloading) {
      if (installed && item.updateAvailable) actions.append(action('Обновить', 'download', () => this.api.downloadModel(model.id), 'refresh', this.busy));
      if (!installed) {
        card.classList.add('downloadable'); card.tabIndex = 0; card.dataset.action = 'download-card';
        card.setAttribute('role', 'button'); card.setAttribute('aria-label', `Скачать ${model.name}`);
        card.setAttribute('aria-disabled', String(this.busy || this.startingDownloads.has(model.id)));
        const download = () => {
          if (this.busy || this.startingDownloads.has(model.id)) return;
          this.startingDownloads.add(model.id); card.setAttribute('aria-disabled', 'true');
          void this.run(() => this.api.downloadModel(model.id)).finally(() => {
            this.startingDownloads.delete(model.id); this.render();
          });
        };
        card.onclick = download;
        card.onkeydown = event => {
          if (event.target === card && ['Enter', ' '].includes(event.key)) {
            event.preventDefault(); if (!event.repeat) download();
          }
        };
      }
      if (installed && !active) actions.append(action('Выбрать', 'select', () => this.api.selectModel(model.id), undefined, this.busy));
    }
    if (installed && !downloading) actions.append(action('Удалить', 'delete', () => this.api.deleteModel(model.id), 'delete', this.busy));
    bottom.append(actions); card.append(top, bottom);
    if (downloading && state) {
      const percent = state.phase === 'verifying' ? 100 : Math.max(0, Math.min(100, state.received / Math.max(1, state.total) * 100));
      const progress = node('div', 'progress-row');
      const bar = node('div', 'model-meter download-progress'); bar.setAttribute('role', 'progressbar');
      bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '100'); bar.setAttribute('aria-valuenow', String(Math.floor(percent)));
      bar.setAttribute('aria-label', `${state.phase === 'verifying' ? 'Проверка SHA-256' : 'Загрузка'} ${model.name}`);
      const fill = node('span', 'model-meter-fill'); fill.style.width = `${percent}%`; bar.append(fill);
      const footer = node('div', 'download-footer');
      footer.append(node('span', '', state.phase === 'verifying' ? 'Проверка SHA-256…' : `Загрузка ${Math.floor(percent)}%`),
        action('Отменить', 'cancel', () => this.api.cancelDownload(model.id)));
      progress.append(bar, footer); card.append(progress);
    }
    if (state?.phase === 'error') card.append(node('p', 'download-error', state.error ?? 'Не удалось скачать модель.'));
    return card;
  }
}
