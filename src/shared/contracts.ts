export interface ModelArtifact {
  filename: string;
  format: 'file' | 'tar.gz';
  sizeBytes: number;
  url: string;
  sha256: string;
}
export interface ModelCapabilities {
  streaming?: boolean;
  translation?: boolean;
  languageDetection?: boolean;
  punctuation?: boolean;
}
export interface Model {
  id: string;
  name: string;
  developer: string;
  engine: string;
  version: string;
  languages: string[];
  sizeBytes: number;
  speed: string;
  quality: string;
  speedScore?: number;
  qualityScore?: number;
  recommended?: boolean;
  recommendationReason?: string;
  description?: string;
  family?: string;
  quantization?: string;
  capabilities?: ModelCapabilities;
  license: string;
  licenseUrl: string;
  sourceUrl?: string;
  entrypoint: string;
  artifacts: ModelArtifact[];
}
export interface Catalog { schemaVersion: 2; models: Model[] }
export interface TextReplacement { from: string; to: string }
export interface Settings {
  appLanguage: 'ru' | 'en';
  hotkey: string;
  selectedModelId: string | null;
  language: string;
  pushToTalk: boolean;
  microphoneId: string;
  inputChannel: 'all' | 'first' | 'second';
  muteWhileRecording: boolean;
  audioFeedback: boolean;
  outputDeviceId: string;
  feedbackVolume: number;
  hideOnStartup: boolean;
  launchAtStartup: boolean;
  showTrayIcon: boolean;
  overlayMode: 'none' | 'minimal' | 'realtime';
  indicatorPosition: 'bottom' | 'top';
  modelUnloadDelay: 'never' | 'immediate' | '15s' | '2m' | '5m' | '10m' | '15m';
  windowSize: 'compact' | 'medium';
  pasteMethod: 'ctrl-v' | 'direct' | 'none' | 'ctrl-shift-v' | 'shift-insert';
  clipboardHandling: 'keep' | 'restore';
  autoSubmit: 'off' | 'enter' | 'ctrl-enter';
  voiceActivityDetection: boolean;
  punctuation: boolean;
  removeFillerWords: boolean;
  customVocabulary: string[];
  textReplacements: TextReplacement[];
  appendSpace: boolean;
  historyLimit: number;
  historyRetention: 'never' | 'limit' | '3d' | '2w' | '3m';
}
export type Preferences = Omit<Settings, 'selectedModelId'>;
export interface InstalledModel { model: Model; installedAt: string }
export interface HistoryEntry {
  id: string; text: string; createdAt: string; modelName: string;
  hasAudio?: boolean; duration?: number; favorite?: boolean;
  status?: 'pending' | 'complete' | 'failed';
}
export interface RecordingIndicator { phase: 'starting' | 'recording' | 'transcribing'; level: number; seconds: number; overlayMode?: 'minimal' | 'realtime'; appLanguage?: 'ru' | 'en' }
export interface OverlayApi {
  state(): Promise<RecordingIndicator>;
  cancel(): Promise<void>;
  onState(callback: (state: RecordingIndicator) => void): () => void;
}
export interface DownloadState {
  id: string;
  phase: 'downloading' | 'verifying' | 'complete' | 'cancelled' | 'error';
  received: number;
  total: number;
  error?: string;
}
export interface ModelView {
  model: Model;
  installed: InstalledModel | null;
  updateAvailable: boolean;
  supported: boolean;
}
export interface AppUpdateState {
  phase: 'idle' | 'checking' | 'available' | 'downloading' | 'current' | 'installing' | 'error';
  currentVersion: string;
  latestVersion?: string;
  percent?: number;
  message?: string;
}
export interface DesktopCapabilities {
  platform: 'windows' | 'linux' | 'other';
  session: 'native' | 'x11' | 'wayland' | 'unknown';
  globalShortcut: boolean;
  pushToTalk: boolean;
  muteAudio: boolean;
  automaticPaste: boolean;
  directTyping: boolean;
  warning?: string;
}
export interface Snapshot {
  desktop: DesktopCapabilities;
  settings: Settings;
  models: ModelView[];
  downloads: DownloadState[];
  modelsPath: string;
  engineReady: boolean;
  hotkeyRegistered: boolean;
  busy: boolean;
  history: HistoryEntry[];
  dataPath: string;
  appVersion: string;
}
export interface DesktopApi {
  snapshot(): Promise<Snapshot>;
  saveSettings(settings: Partial<Preferences>): Promise<void>;
  resetSettings(): Promise<void>;
  refreshCatalog(): Promise<void>;
  downloadModel(id: string): Promise<void>;
  cancelDownload(id: string): Promise<void>;
  deleteModel(id: string): Promise<void>;
  deleteAllModels(): Promise<number>;
  selectModel(id: string): Promise<void>;
  openModelsFolder(): Promise<void>;
  beginRecording(): Promise<string>;
  grantMicrophonePermission(): Promise<void>;
  openMicrophoneSettings(): Promise<void>;
  prepareRecordingAudio(id: string): Promise<void>;
  finishRecordingAudio(id: string): Promise<void>;
  transcribe(sessionId: string, wav: ArrayBuffer): Promise<string>;
  cancelRecording(): Promise<void>;
  copyText(text: string): Promise<void>;
  beginShortcutCapture(): Promise<void>;
  endShortcutCapture(): Promise<void>;
  recordingLevel(id: string, level: number, seconds: number): void;
  deleteHistory(id: string): Promise<void>;
  favoriteHistory(id: string): Promise<void>;
  historyAudio(id: string): Promise<ArrayBuffer>;
  retranscribeHistory(id: string): Promise<string>;
  openRecordingsFolder(): Promise<void>;
  clearHistory(): Promise<void>;
  openDataFolder(): Promise<void>;
  openLicenses(): Promise<void>;
  openGithub(): Promise<void>;
  openModelLicense(id: string): Promise<void>;
  startUpdate(): Promise<AppUpdateState>;
  onCancel(callback: () => void): () => void;
  onShortcutCaptureEnded(callback: () => void): () => void;
  onToggle(callback: () => void): () => void;
  onHold(callback: (pressed: boolean) => void): () => void;
  onDownload(callback: (state: DownloadState) => void): () => void;
  onUpdateState(callback: (state: AppUpdateState) => void): () => void;
}
export const MAX_RECORDING_SECONDS = 300;
