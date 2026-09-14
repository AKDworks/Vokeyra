import type { RecordingIndicator } from '../shared/contracts';
function render(state: RecordingIndicator): void {
  const english = state.appLanguage === 'en';
  document.documentElement.lang = english ? 'en' : 'ru';
  document.title = english ? 'Vokeyra — recording' : 'Vokeyra — запись';
  document.querySelector('.indicator')!.setAttribute('aria-label', english ? 'Dictation indicator' : 'Индикатор диктовки');
  document.getElementById('cancel')!.setAttribute('aria-label', english ? 'Cancel recording' : 'Отменить запись');
  document.body.dataset.phase = state.phase;
  document.body.dataset.overlayMode = state.overlayMode ?? 'realtime';
  document.getElementById('levels')!.dataset.level = String(Math.min(4, Math.ceil(state.level * 4)));
  document.getElementById('phase')!.textContent = state.phase === 'starting' ? (english ? 'Microphone…' : 'Микрофон…') : state.phase === 'transcribing' ? (english ? 'Processing' : 'Обработка') : `${Math.floor(state.seconds / 60)}:${String(Math.floor(state.seconds % 60)).padStart(2, '0')}`;
}
window.vokeyraOverlay.onState(render);
void window.vokeyraOverlay.state().then(render);
document.getElementById('cancel')!.onclick = () => { void window.vokeyraOverlay.cancel(); };
