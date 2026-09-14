import type { DesktopApi, HistoryEntry } from '../shared/contracts';
import { setIcon } from './icons';
import { appLocale, onAppLanguageChange } from './i18n';

const time = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

export class HistoryView {
  private audio = new Audio();
  private url = '';
  private token = 0;
  private activeId = '';
  private resetPlayer?: () => void;
  private signature = '';
  private busy = false;
  constructor(private list: HTMLElement, private api: DesktopApi, private refresh: () => Promise<void>,
    private retry: (id: string) => Promise<void>) { onAppLanguageChange(() => { this.signature = ''; }); }

  stop(): void {
    ++this.token;
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    this.audio.onended = this.audio.ontimeupdate = this.audio.onloadedmetadata = this.audio.onerror = null;
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = ''; this.activeId = '';
    this.resetPlayer?.(); this.resetPlayer = undefined;
  }

  setBusy(busy: boolean): void {
    this.busy = busy;
    this.list.querySelectorAll<HTMLButtonElement>('[data-needs-idle]').forEach(button => {
      button.disabled = busy || button.dataset.unavailable === 'true';
    });
  }

  render(entries: HistoryEntry[]): void {
    const signature = JSON.stringify(entries);
    if (this.signature === signature) return;
    this.signature = signature;
    this.stop(); this.list.replaceChildren();
    if (!entries.length) {
      const empty = document.createElement('p'); empty.className = 'empty-state';
      empty.textContent = 'Записей пока нет. Начните с горячей клавиши.';
      this.list.append(empty); return;
    }
    for (const entry of entries) this.list.append(this.card(entry));
    this.setBusy(this.busy);
  }

  private card(entry: HistoryEntry): HTMLElement {
    const card = document.createElement('article'); card.className = 'history-entry'; card.dataset.entry = entry.id;
    const heading = document.createElement('div'); heading.className = 'history-heading';
    const date = document.createElement('time'); date.dateTime = entry.createdAt;
    date.textContent = new Date(entry.createdAt).toLocaleString(appLocale(), {
      day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    const actions = document.createElement('div'); actions.className = 'history-actions';
    const error = document.createElement('p'); error.className = 'history-error'; error.hidden = true; error.setAttribute('role', 'status');
    const run = async (operation: () => Promise<unknown>, failure: string) => {
      error.hidden = true;
      try { await operation(); await this.refresh(); }
      catch {
        const current = [...this.list.querySelectorAll<HTMLElement>('[data-entry]')].find(node => node.dataset.entry === entry.id);
        const target = current?.querySelector<HTMLElement>('.history-error') ?? error;
        target.textContent = failure; target.hidden = false;
      }
    };
    const iconButton = (icon: Parameters<typeof setIcon>[1], label: string, action: () => void) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'icon-button';
      button.setAttribute('aria-label', label); setIcon(button, icon);
      button.onclick = action; return button;
    };
    const copy = iconButton('copy', 'Копировать текст', () => { void run(() => this.api.copyText(entry.text), 'Не удалось скопировать.'); });
    copy.disabled = !entry.text;
    const favorite = iconButton(entry.favorite ? 'starFilled' : 'star', entry.favorite ? 'Убрать из избранного' : 'В избранное', () => {
      void run(() => this.api.favoriteHistory(entry.id), 'Не удалось сохранить.');
    });
    favorite.classList.toggle('favorite', !!entry.favorite); favorite.setAttribute('aria-pressed', String(!!entry.favorite));
    const retry = iconButton('refresh', 'Распознать заново выбранной моделью', () => {
      void run(() => this.retry(entry.id), 'Не удалось распознать. Проверьте модель и движок.');
    });
    retry.dataset.needsIdle = ''; retry.dataset.unavailable = String(!entry.hasAudio);
    const remove = iconButton('delete', 'Удалить запись и аудио', () => {
      void run(() => this.api.deleteHistory(entry.id), 'Не удалось удалить запись.');
    });
    remove.dataset.needsIdle = '';
    actions.append(copy, favorite, retry, remove); heading.append(date, actions);
    const text = document.createElement('p'); text.className = 'history-text';
    text.textContent = entry.text || (entry.status === 'failed' ? 'Не удалось распознать. Можно повторить.' : entry.status === 'pending' ? 'Распознавание…' : 'Речь не обнаружена.');
    text.classList.toggle('muted', !entry.text);
    card.append(heading, text);
    if (entry.hasAudio) {
      const player = document.createElement('div'); player.className = 'history-player';
      const elapsed = document.createElement('span'); elapsed.textContent = '0:00';
      const duration = document.createElement('span'); duration.textContent = time(entry.duration || 0);
      const seek = document.createElement('input'); seek.type = 'range'; seek.min = '0'; seek.max = String(entry.duration || 1); seek.step = '0.01'; seek.value = '0';
      seek.setAttribute('aria-label', 'Позиция воспроизведения'); seek.disabled = true;
      const updateProgress = () => {
        const progress = Math.max(0, Math.min(100, Number(seek.value) / Number(seek.max) * 100));
        seek.style.setProperty('--progress', `${progress}%`);
      };
      const playing = (value: boolean) => {
        setIcon(play, value ? 'pause' : 'play');
        play.setAttribute('aria-label', value ? 'Пауза' : 'Слушать запись');
      };
      const play = iconButton('play', 'Слушать запись', () => {
        void (async () => {
          if (this.activeId === entry.id && this.url) {
            if (!this.audio.paused) { this.audio.pause(); playing(false); }
            else { await this.audio.play(); playing(true); }
            return;
          }
          this.stop(); const token = this.token; this.activeId = entry.id;
          this.resetPlayer = () => { playing(false); elapsed.textContent = '0:00'; seek.value = '0'; seek.disabled = true; updateProgress(); };
          const wav = await this.api.historyAudio(entry.id);
          if (token !== this.token) return;
          this.url = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
          this.audio.src = this.url;
          this.audio.ontimeupdate = () => { seek.value = String(this.audio.currentTime); elapsed.textContent = time(this.audio.currentTime); updateProgress(); };
          this.audio.onloadedmetadata = () => {
            if (Number.isFinite(this.audio.duration)) { seek.max = String(this.audio.duration); duration.textContent = time(this.audio.duration); seek.disabled = false; updateProgress(); }
          };
          this.audio.onended = () => { playing(false); this.audio.currentTime = 0; };
          this.audio.onerror = () => { this.stop(); error.textContent = 'Аудио недоступно.'; error.hidden = false; };
          await this.audio.play(); if (token === this.token) playing(true);
        })().catch(() => { playing(false); error.textContent = 'Аудио недоступно.'; error.hidden = false; });
      });
      play.dataset.needsIdle = '';
      seek.oninput = () => { if (this.activeId === entry.id && this.url) this.audio.currentTime = Number(seek.value); updateProgress(); };
      player.append(play, elapsed, seek, duration); card.append(player);
    } else {
      const missing = document.createElement('p'); missing.className = 'muted'; missing.textContent = 'Аудио не сохранено.'; card.append(missing);
    }
    card.append(error); return card;
  }
}
