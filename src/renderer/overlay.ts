import './desktop-bridge';
import type { RecordingIndicator } from '../shared/contracts';
const bars = [...document.querySelectorAll<HTMLElement>('#levels i')];
const levels = bars.map(() => 0);
function render(state: RecordingIndicator): void {
  const english = state.appLanguage === 'en';
  document.documentElement.lang = english ? 'en' : 'ru';
  document.title = english ? 'Vokeyra — recording' : 'Vokeyra — запись';
  document.querySelector('.indicator')!.setAttribute('aria-label', english ? 'Dictation indicator' : 'Индикатор диктовки');
  document.getElementById('cancel')!.setAttribute('aria-label', english ? 'Cancel recording' : 'Отменить запись');
  document.body.dataset.phase = state.phase;
  document.body.dataset.overlayMode = state.overlayMode ?? 'realtime';
  if (state.phase === 'recording') {
    levels.shift(); levels.push(Math.max(0, Math.min(1, state.level)));
  } else levels.fill(0);
  bars.forEach((bar, index) => { bar.style.height = `${3 + levels[index]! * 20}px`; });
  document.getElementById('phase')!.textContent = state.phase === 'starting' ? (english ? 'Microphone…' : 'Микрофон…') : state.phase === 'transcribing' ? (english ? 'Processing' : 'Обработка') : `${Math.floor(state.seconds / 60)}:${String(Math.floor(state.seconds % 60)).padStart(2, '0')}`;
}
window.vokeyraOverlay.onState(render);
void window.vokeyraOverlay.state().then(render);
document.getElementById('cancel')!.onclick = () => { void window.vokeyraOverlay.cancel(); };
