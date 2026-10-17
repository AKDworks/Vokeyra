import type { Settings } from '../shared/contracts';

export type AppLanguage = Settings['appLanguage'];

const ruToEn: Record<string, string> = {
  'Доступ к микрофону': 'Microphone access', 'Разрешить': 'Allow', 'Проверить доступ': 'Check access',
  'Запрашиваем доступ…': 'Requesting access…', 'Настройки Windows': 'Windows settings',
  'Доступ к микрофону разрешён.': 'Microphone access granted.',
  'Доступ к микрофону заблокирован. Нажмите «Разрешить» и подтвердите доступ.': 'Microphone access is blocked. Click Allow and confirm access.',
  'Не удалось повторно запросить доступ к микрофону.': 'Could not request microphone access again.',
  'Не удалось получить доступ к микрофону.': 'Could not access the microphone.',
  'Не удалось открыть настройки микрофона.': 'Could not open microphone settings.',
  'Откройте настройки доступа к микрофону вашей системы.': 'Open your system microphone privacy settings.',
  'В Wayland запись запускается кнопкой. Результат копируется в буфер обмена.': 'On Wayland, start recording with the button. The result is copied to the clipboard.',
  'Для автоматической вставки в Linux установите xdotool.': 'Install xdotool to enable automatic insertion on Linux.',
  'Для буфера обмена Wayland установите wl-clipboard.': 'Install wl-clipboard to use the Wayland clipboard.',
  'Удержание клавиши в Linux пока доступно только в X11.': 'Push-to-talk on Linux currently requires X11.',
  'Автоматическая вставка недоступна. Текст сохранён в истории.': 'Automatic insertion is unavailable. The text is saved in history.',
  'Разделы приложения': 'Application sections', 'Главное': 'General', 'Модели': 'Models', 'История': 'History',
  'Настройки': 'Settings', 'О программе': 'About', 'Общее': 'General', 'Звук': 'Sound',
  'Горячая клавиша транскрипции': 'Transcription shortcut', 'Удерживать для записи': 'Hold to record',
  'Язык распознавания': 'Recognition language', 'Определять автоматически': 'Detect automatically',
  'Микрофон': 'Microphone', 'По умолчанию': 'Default', 'Входной канал': 'Input channel',
  'Все каналы': 'All channels', 'Первый канал': 'First channel', 'Второй канал': 'Second channel',
  'Отключить звук во время записи': 'Mute sound while recording', 'Обратная звуковая связь': 'Audio feedback',
  'Устройство вывода': 'Output device', 'Громкость': 'Volume', 'Открыть папку с записями': 'Open recordings folder',
  'Запись вручную и последний текст': 'Manual recording and latest text', 'Готово к записи': 'Ready to record',
  'Начать запись': 'Start recording', 'Остановить запись': 'Stop recording', 'Завершить': 'Finish',
  'Отменить': 'Cancel', 'Последний текст': 'Latest text', 'Копировать': 'Copy',
  'Текст появится после записи': 'Text will appear after recording', 'Модели транскрипции': 'Transcription models',
  'Поиск моделей по имени': 'Search models by name', 'Загруженные модели': 'Downloaded models',
  'Доступные для загрузки': 'Available to download', 'Все языки': 'All languages',
  'Открыть папку моделей': 'Open models folder', 'Приложение': 'Application', 'Скрыть при запуске': 'Hide on startup',
  'Запускать при старте': 'Launch at startup', 'Показать значок в трее': 'Show tray icon',
  'Наложение': 'Overlay', 'Нет': 'None', 'Минимальное': 'Minimal', 'В реальном времени': 'Real time',
  'Позиция индикатора': 'Indicator position', 'Снизу': 'Bottom', 'Сверху': 'Top', 'Выгрузить модель': 'Unload model',
  'Никогда': 'Never', 'Немедленно': 'Immediately', 'Через 2 минуты': 'After 2 minutes',
  'Через 5 минут': 'After 5 minutes', 'Через 10 минут': 'After 10 minutes', 'Через 15 минут': 'After 15 minutes',
  'Через 15 секунд (отладка)': 'After 15 seconds (debug)', 'Вывод': 'Output', 'Метод вставки': 'Insertion method',
  'Буфер обмена (Ctrl+V)': 'Clipboard (Ctrl+V)', 'Прямой': 'Direct', 'Буфер обмена (Ctrl+Shift+V)': 'Clipboard (Ctrl+Shift+V)',
  'Буфер обмена (Shift+Insert)': 'Clipboard (Shift+Insert)', 'Обработка буфера обмена': 'Clipboard handling',
  'Не изменять буфер обмена': 'Restore previous clipboard', 'Сохранить распознанный текст': 'Keep transcribed text',
  'Автоматическая отправка': 'Automatic submit', 'Выкл.': 'Off', 'Транскрипция': 'Transcription',
  'Определение голосовой активности': 'Voice activity detection', 'Расставлять знаки препинания': 'Add punctuation',
  'Удалять слова-паразиты': 'Remove filler words', 'Пользовательский словарь': 'Custom vocabulary',
  'Добавить слово': 'Add a word', 'Добавить': 'Add', 'Добавить пробел': 'Append a space',
  'Автозамены слов': 'Word replacements', 'Как распознано': 'Recognized as', 'Заменить на': 'Replace with',
  'Об автозаменах': 'About word replacements', 'Удалить автозамену': 'Delete replacement',
  'Заменяет слова и фразы после распознавания любой моделью. Регистр исходного текста не важен; написание замены сохраняется.': 'Replaces words and phrases after transcription with any model. Matching ignores case; replacement spelling is preserved.',
  'Допустимо не более 100 автозамен.': 'You can save up to 100 replacements.',
  'Укажите исходное слово и замену: до 100 и 200 символов.': 'Enter the original text and replacement: up to 100 and 200 characters.',
  'Для этого слова уже есть автозамена.': 'A replacement for this text already exists.',
  'Размер истории': 'History size', 'записей': 'entries', 'Автоматическое удаление записей': 'Automatic history cleanup',
  'Через 3 дня': 'After 3 days', 'Через 2 недели': 'After 2 weeks', 'Через 3 месяца': 'After 3 months',
  'Экран': 'Display', 'Размер окна': 'Window size', 'Компактный · 780 × 600': 'Compact · 780 × 600',
  'Сбросить настройки': 'Reset settings', 'Вернуть параметры приложения к исходным значениям.': 'Restore the original application settings.',
  'Очистить историю': 'Clear history', 'Удалить все записи и сохранённые аудиофайлы.': 'Delete all entries and saved audio files.',
  'Удалить модели': 'Delete models', 'Удалить все скачанные модели с устройства.': 'Delete all downloaded models from this device.',
  'Сбросить': 'Reset', 'Очистить': 'Clear', 'Отмена': 'Cancel',
  'Средний · 920 × 700': 'Medium · 920 × 700', 'Язык приложения': 'Application language',
  'Русский': 'Russian', 'Версия': 'Version', 'Поддержка развития': 'Support development', 'Скоро': 'Coming soon',
  'Лицензии сторонних компонентов': 'Third-party licenses', 'Исходный код': 'Source code', 'Открыть GitHub': 'Open GitHub', 'Каталог данных приложения': 'Application data folder',
  'Открыть': 'Open', 'Проверить наличие обновлений': 'Check for updates', 'Проверяем…': 'Checking…',
  'Проверяем обновления…': 'Checking for updates…', 'Обновление найдено…': 'Update found…',
  'Устанавливаем обновление…': 'Installing update…', 'Не удалось обновить · Повторить': 'Update failed · Retry',
  'Обновление не требуется': 'Up to date', 'Не удалось проверить · Повторить': 'Could not check · Retry',
  'Модель не выбрана': 'No model selected', 'Авто': 'Auto',
  'Записей пока нет. Начните с горячей клавиши.': 'No recordings yet. Start with the keyboard shortcut.',
  'Копировать текст': 'Copy text', 'Убрать из избранного': 'Remove from favorites', 'В избранное': 'Add to favorites',
  'Распознать заново выбранной моделью': 'Transcribe again with selected model', 'Удалить запись и аудио': 'Delete recording and audio',
  'Позиция воспроизведения': 'Playback position', 'Пауза': 'Pause', 'Слушать запись': 'Play recording',
  'Не удалось распознать. Можно повторить.': 'Transcription failed. You can try again.', 'Распознавание…': 'Transcribing…',
  'Речь не обнаружена.': 'No speech detected.', 'Аудио не сохранено.': 'Audio was not saved.', 'Аудио недоступно.': 'Audio is unavailable.',
  'Рекомендуется': 'Recommended', 'Установлена': 'Installed', 'Выбрать': 'Select', 'Выбрана': 'Selected',
  'Удалить': 'Delete', 'Скачать': 'Download', 'Обновить': 'Update', 'Отмена загрузки': 'Cancel download',
  'Точность': 'Accuracy', 'Скорость': 'Speed', 'Все доступные модели загружены.': 'All available models are downloaded.',
  'Нет доступных моделей по фильтру.': 'No models match the filters.', 'Несколько языков': 'Multiple languages',
  'Очень быстрая': 'Very fast', 'Быстрая': 'Fast', 'Умеренная': 'Moderate', 'Базовое': 'Basic',
  'Низкая': 'Slow', 'Среднее': 'Medium', 'Повышенное': 'Enhanced', 'Высокое': 'High', 'Максимальное': 'Maximum', 'Нет движка': 'Engine unavailable',
  'Быстрая диктовка с минимальной нагрузкой.': 'Fast dictation with minimal system load.',
  'Баланс скорости и точности для повседневной диктовки.': 'A balance of speed and accuracy for everyday dictation.',
  'Более точное распознавание, выше нагрузка.': 'More accurate transcription with higher system load.',
  'Русская диктовка с пунктуацией. INT8 · CPU.': 'Russian dictation with punctuation. INT8 · CPU.',
  'Самая лёгкая многоязычная модель для слабых компьютеров.': 'The lightest multilingual model for lower-powered computers.',
  'Компактная повседневная модель с хорошим балансом скорости и размера.': 'A compact everyday model with a good balance of speed and size.',
  'Более точная многоязычная диктовка в компактной квантованной версии.': 'More accurate multilingual dictation in a compact quantized package.',
  'Высокая точность на разных языках для производительных компьютеров.': 'High multilingual accuracy for more powerful computers.',
  'Точная современная модель с ускоренным декодером и поддержкой многих языков.': 'A modern accurate model with faster decoding and multilingual support.',
  'Модель для максимальной точности, рассчитанная на мощный компьютер.': 'An accuracy-focused model intended for a powerful computer.',
  'Проверка SHA-256': 'Verifying SHA-256', 'Проверка SHA-256…': 'Verifying SHA-256…',
  'Не удалось скачать модель.': 'Could not download the model.',
  'Не удалось подключиться к серверу модели. Проверьте интернет и повторите загрузку.': 'Could not connect to the model server. Check your internet connection and try again.',
  'Загрузка модели заняла слишком много времени. Повторите загрузку.': 'The model download took too long. Try again.',
  'Недостаточно свободного места для загрузки модели.': 'There is not enough free space to download the model.',
  'Нет доступа к папке моделей. Проверьте разрешения.': 'The models folder is not accessible. Check its permissions.',
  'Устройство недоступно': 'Device unavailable',
  'Остановить сигнал': 'Stop sound', 'Выход': 'Output',
  'Подключаем микрофон…': 'Connecting microphone…', 'Идёт запись': 'Recording', 'Обработка…': 'Processing…',
  'Распознаём на устройстве…': 'Transcribing on device…', 'Нажмите горячую клавишу…': 'Press a keyboard shortcut…',
  'Запись отменена.': 'Recording cancelled.', 'Текст скопирован.': 'Text copied.',
  'Сбросить все настройки?': 'Reset all settings?',
  'Все параметры приложения, включая горячую клавишу и выбранную модель, вернутся к исходным значениям. История и скачанные модели сохранятся.': 'All application settings, including the shortcut and selected model, will return to their defaults. History and downloaded models will be kept.',
  'Очистить всю историю?': 'Clear all history?',
  'Все записи истории и сохранённые аудиофайлы будут удалены без возможности восстановления.': 'All history entries and saved audio files will be permanently deleted.',
  'Удалить все скачанные модели?': 'Delete all downloaded models?',
  'Все скачанные модели будут удалены с устройства. Для распознавания речи модель потребуется скачать заново.': 'All downloaded models will be removed from this device. You will need to download a model again to transcribe speech.',
  'Настройки сброшены.': 'Settings reset.', 'История очищена.': 'History cleared.', 'Скачанные модели удалены.': 'Downloaded models deleted.',
  'Настройки сброшены, но горячая клавиша по умолчанию занята другим приложением.': 'Settings were reset, but the default shortcut is used by another application.',
  'Язык сохранён.': 'Language saved.', 'Горячая клавиша сохранена.': 'Keyboard shortcut saved.',
  'Не удалось скопировать.': 'Could not copy.', 'Не удалось сохранить.': 'Could not save.',
  'Не удалось распознать. Проверьте модель и движок.': 'Could not transcribe. Check the model and engine.',
  'Не удалось удалить запись.': 'Could not delete the recording.', 'Закрыть сообщение': 'Close message',
  'Обновить устройства звука': 'Refresh audio devices', 'Прослушать сигнал': 'Preview sound',
  'Обновить каталог': 'Refresh catalog', 'Только рекомендованные': 'Recommended only',
  'Открывает сведения об авторах, источниках и лицензиях моделей и движков.': 'Opens attribution, source, and license information for models and engines.',
  'О сторонних лицензиях': 'About third-party licenses',
  'Открывает страницу проекта на GitHub в браузере по умолчанию.': 'Opens the project page on GitHub in your default browser.',
  'Меняет язык интерфейса Vokeyra; выбранный язык сохраняется для следующих запусков.': 'Changes the Vokeyra interface language and remembers it for future launches.',
  'Ссылка для добровольной поддержки проекта появится в одном из следующих обновлений.': 'A link for voluntary project support will be added in a future update.',
  'Здесь хранятся настройки, история и служебные данные Vokeyra.': 'Stores Vokeyra settings, history, and application data.',
  'Начинает и завершает запись голоса из любого приложения выбранным сочетанием клавиш.': 'Starts and stops voice recording from any application with the selected shortcut.',
  'Записывает голос только пока вы удерживаете назначенную горячую клавишу.': 'Records only while you hold the assigned keyboard shortcut.',
  'Выбирает язык речи вручную или разрешает модели определить его автоматически.': 'Selects the spoken language or lets the model detect it automatically.',
  'Выбирает устройство, с которого Vokeyra будет записывать ваш голос.': 'Selects the device Vokeyra uses to record your voice.',
  'Определяет, какие каналы подключённого микрофона или аудиоинтерфейса использовать для записи.': 'Selects which channels of the connected microphone or audio interface to record.',
  'Временно отключает системный звук, чтобы уведомления и музыка не попадали в запись.': 'Temporarily mutes system audio so notifications and music are not captured.',
  'Воспроизводит короткие сигналы при начале и завершении записи.': 'Plays short sounds when recording starts and stops.',
  'Выбирает колонки или наушники, через которые будут воспроизводиться сигналы записи.': 'Selects the speakers or headphones used for recording sounds.',
  'Регулирует громкость сигналов начала и завершения записи.': 'Adjusts the volume of recording start and stop sounds.',
  'Запускает Vokeyra в фоне, не открывая главное окно.': 'Starts Vokeyra in the background without opening the main window.',
  'Автоматически запускает Vokeyra после входа в Windows.': 'Starts Vokeyra automatically after you sign in to Windows.',
  'Показывает значок Vokeyra в системном трее и позволяет скрывать окно без завершения приложения.': 'Shows Vokeyra in the system tray and lets you hide the window without quitting.',
  'Определяет, насколько подробно индикатор записи отображается поверх остальных окон.': 'Controls how much information the recording indicator shows above other windows.',
  'Выбирает верхний или нижний край текущего экрана для индикатора записи.': 'Places the recording indicator at the top or bottom of the current display.',
  'Выбирает время бездействия, после которого поддерживаемый движок освобождает занятую моделью память.': 'Selects how long a supported engine waits before releasing model memory.',
  'Определяет, как распознанный текст попадёт в приложение, которое было активно перед записью.': 'Controls how transcribed text is inserted into the application used before recording.',
  'Оставляет распознанный текст в буфере либо возвращает прежнее текстовое содержимое после вставки.': 'Keeps the transcribed text in the clipboard or restores its previous text after insertion.',
  'После вставки текста автоматически нажимает Enter или Ctrl+Enter в активном приложении.': 'Automatically presses Enter or Ctrl+Enter in the active application after inserting text.',
  'Помогает движку отделять произнесённую речь от пауз и фонового шума.': 'Helps the engine separate speech from pauses and background noise.',
  'Сохраняет точки, запятые и другие знаки препинания в распознанном тексте.': 'Keeps periods, commas, and other punctuation in transcribed text.',
  'После распознавания удаляет «э-э», «а-а», «ммм» и отдельные разговорные вставки, сохраняя смысловые слова.': 'Removes hesitation sounds and isolated conversational fillers after transcription while preserving meaningful words.',
  'Передаёт имена и специальные термины движкам, которые поддерживают подсказки распознавания.': 'Provides names and specialist terms to engines that support transcription hints.',
  'Добавляет один пробел в конец результата, чтобы следующая диктовка не склеивалась с текстом.': 'Adds one space after the result so the next dictation does not join the previous text.',
  'Задаёт число записей для режима «Хранить последние»; допустимо от 1 до 100.': 'Sets the number of entries kept by the “Keep latest” mode, from 1 to 100.',
  'Удаляет незакреплённые записи вместе с аудио по выбранному количеству или сроку хранения.': 'Deletes non-favorite recordings and audio by the selected count or retention period.',
  'Переключает Vokeyra между компактным и увеличенным размером окна.': 'Switches Vokeyra between compact and larger window sizes.',
  'Сначала завершите запись или распознавание.': 'Finish the current recording or transcription first.',
  'Сочетание занято другим приложением. Выберите другое.': 'This shortcut is used by another application. Choose a different one.',
  'Движок этой модели пока не поддерживается.': 'This model engine is not supported yet.',
  'Сначала скачайте поддерживаемую модель.': 'Download a supported model first.',
  'Скачайте и выберите модель во вкладке «Модели».': 'Download and select a model on the Models page.',
  'Дождитесь обновления выбранной модели.': 'Wait for the selected model to finish updating.',
  'Встроенный движок модели недоступен. Переустановите Vokeyra.': 'The bundled model engine is unavailable. Reinstall Vokeyra.',
  'Файл сторонних лицензий не найден. Переустановите Vokeyra.': 'The third-party notices file is missing. Reinstall Vokeyra.',
  'Устройство не поддерживает запись 16 кГц.': 'The device does not support 16 kHz recording.',
  'У микрофона нет второго канала. Выберите первый или все каналы.': 'The microphone has no second channel. Select the first channel or all channels.',
  'Микрофон недоступен или не поддерживает выбранный канал. Проверьте настройки звука.': 'The microphone is unavailable or does not support the selected channel. Check the sound settings.',
  'Нет доступа к микрофону. Разрешите его в параметрах конфиденциальности Windows.': 'Microphone access is blocked. Allow it in Windows privacy settings.',
  'Не удалось получить список устройств. Проверьте доступ к микрофону в Windows.': 'Could not load audio devices. Check microphone access in Windows.',
  'Устройство вывода не отвечает.': 'The output device is not responding.', 'Не удалось воспроизвести сигнал.': 'Could not play the sound.',
  'Файл загружен не полностью. Повторите загрузку.': 'The file was not downloaded completely. Try again.',
  'SHA-256 не совпал. Повторите загрузку.': 'SHA-256 verification failed. Try the download again.',
};

const enToRu = Object.fromEntries(Object.entries(ruToEn).map(([ru, en]) => [en, ru]));
let current: AppLanguage = 'ru';
const listeners = new Set<() => void>();
const originalText = new WeakMap<Text, string>();
const originalAttributes = new WeakMap<Element, Map<string, string>>();

function translateCore(value: string): string {
  const table = current === 'en' ? ruToEn : enToRu;
  const exact = table[value];
  if (exact) return exact;
  if (current === 'en') {
    return value
      .replace(/^Хранить последние (\d+)$/, 'Keep latest $1')
      .replace(/^Только (.+)$/, '$1 only')
      .replace(/^(\d+) (?:язык|языка|языков)$/, '$1 languages')
      .replace(/^Идёт запись · /, 'Recording · ')
      .replace(/^(\d+) МБ$/, '$1 MB')
      .replace(/^Загрузка (\d+)%$/, 'Downloading $1%')
      .replace(/^Микрофон (\d+)$/, 'Microphone $1')
      .replace(/^Выход (\d+)$/, 'Output $1')
      .replace(/ · Авто$/, ' · Auto')
      .replace(/^Доступна версия (.+) · Скачать$/, 'Version $1 available · Download')
      .replace(/^Найдена версия (.+)…$/, 'Version $1 found…')
      .replace(/^Скачивание обновления (\\d+)%$/, 'Downloading update $1%')
      .replace(/^Устанавливаем версию (.+)…$/, 'Installing version $1…')
      .replace(/^Лицензия: (.+)$/, 'License: $1')
      .replace(/^Открыть лицензию (.+) для (.+)$/, 'Open $1 license for $2')
      .replace(/^(.+), активная модель$/, '$1, active model')
      .replace(/^(Точность|Скорость): (.+), (\d+) из 5$/, (_value, label: string, description: string, score: string) => `${ruToEn[label] ?? label}: ${ruToEn[description] ?? description}, ${score} of 5`)
      .replace(/^Удалить (.+)$/, 'Delete $1')
      .replace(/^Скачать (.+)$/, 'Download $1');
  }
  return value
    .replace(/^Keep latest (\d+)$/, 'Хранить последние $1')
    .replace(/^(.+) only$/, 'Только $1')
    .replace(/^(\d+) languages$/, '$1 языков')
    .replace(/^Recording · /, 'Идёт запись · ')
    .replace(/^(\d+) MB$/, '$1 МБ')
    .replace(/^Downloading (\d+)%$/, 'Загрузка $1%')
    .replace(/^Microphone (\d+)$/, 'Микрофон $1')
    .replace(/^Output (\d+)$/, 'Выход $1')
    .replace(/ · Auto$/, ' · Авто')
    .replace(/^Version (.+) available · Download$/, 'Доступна версия $1 · Скачать')
    .replace(/^Version (.+) found…$/, 'Найдена версия $1…')
    .replace(/^Downloading update (\\d+)%$/, 'Скачивание обновления $1%')
    .replace(/^Installing version (.+)…$/, 'Устанавливаем версию $1…')
    .replace(/^License: (.+)$/, 'Лицензия: $1')
    .replace(/^Open (.+) license for (.+)$/, 'Открыть лицензию $1 для $2')
    .replace(/^(.+), active model$/, '$1, активная модель')
    .replace(/^(Accuracy|Speed): (.+), (\d+) of 5$/, (_value, label: string, description: string, score: string) => `${enToRu[label] ?? label}: ${enToRu[description] ?? description}, ${score} из 5`)
    .replace(/^Delete (.+)$/, 'Удалить $1')
    .replace(/^Download (.+)$/, 'Скачать $1');
}

export function tr(value: string): string {
  const match = value.match(/^(\s*)(.*?)(\s*)$/s);
  return match ? `${match[1]}${translateCore(match[2]!)}${match[3]}` : translateCore(value);
}

function excluded(node: Node): boolean {
  const parent = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
  return !!parent?.closest('.history-text, .dictionary-chip, .replacement-text, #transcript, #data-path');
}

function localizeNode(root: Node): void {
  if (excluded(root)) return;
  if (root.nodeType === Node.TEXT_NODE) {
    const textNode = root as Text;
    if (!originalText.has(textNode)) originalText.set(textNode, textNode.data);
    const source = originalText.get(textNode)!;
    if (source) {
      const translated = current === 'en' ? translateCore(source) : source;
      if (translated !== root.textContent) root.textContent = translated;
    }
    return;
  }
  if (!(root instanceof Element)) return;
  for (const attribute of ['aria-label', 'placeholder', 'data-help', 'title']) {
    const value = root.getAttribute(attribute);
    if (!value) continue;
    let originals = originalAttributes.get(root);
    if (!originals) { originals = new Map(); originalAttributes.set(root, originals); }
    if (!originals.has(attribute)) originals.set(attribute, value);
    const source = originals.get(attribute)!;
    const translated = current === 'en' ? translateCore(source) : source;
    if (translated !== value) root.setAttribute(attribute, translated);
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) if (!excluded(node)) localizeNode(node);
  root.querySelectorAll('[aria-label], [placeholder], [data-help], [title]').forEach(element => {
    if (excluded(element)) return;
    for (const attribute of ['aria-label', 'placeholder', 'data-help', 'title']) {
      const value = element.getAttribute(attribute);
      if (!value) continue;
      let originals = originalAttributes.get(element);
      if (!originals) { originals = new Map(); originalAttributes.set(element, originals); }
      if (!originals.has(attribute)) originals.set(attribute, value);
      const source = originals.get(attribute)!;
      const translated = current === 'en' ? translateCore(source) : source;
      if (translated !== value) element.setAttribute(attribute, translated);
    }
  });
}

export function setAppLanguage(language: AppLanguage): void {
  if (current === language && document.documentElement.lang === language) return;
  current = language;
  document.documentElement.lang = language;
  localizeNode(document.body);
  listeners.forEach(listener => listener());
}

export function getAppLanguage(): AppLanguage { return current; }
export function appLocale(): string { return current === 'en' ? 'en-US' : 'ru-RU'; }
export function onAppLanguageChange(listener: () => void): () => void {
  listeners.add(listener); return () => listeners.delete(listener);
}

new MutationObserver(records => {
  for (const record of records) {
    if (record.type === 'characterData') localizeNode(record.target);
    else record.addedNodes.forEach(localizeNode);
  }
}).observe(document.body, { subtree: true, childList: true, characterData: true });
