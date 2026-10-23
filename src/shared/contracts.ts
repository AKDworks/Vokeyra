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
export interface AudioSource { id: string; label: string }
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
export type LinuxCompositor = 'niri' | 'kde' | 'gnome' | 'sway' | 'hyprland' | 'unknown';
export type LinuxIntegrationId = 'hotkey' | 'pushToTalk' | 'paste' | 'overlay';
export type LinuxIntegrationState = 'active' | 'ready' | 'setup' | 'unavailable' | 'error';
export interface LinuxIntegrationStatus {
  id: LinuxIntegrationId;
  state: LinuxIntegrationState;
  /** Human-readable reason. Interface translations live in renderer/i18n.ts. */
  detail: string;
  /** Optional recommended next step. */
  action?: string;
}
export interface LinuxOverlayInfo {
  mode: 'layer-shell' | 'window' | 'disabled';
  layerShell: boolean;
  reason?: string;
  title?: string;
}
export interface LinuxDesktopInfo {
  compositor: LinuxCompositor;
  compositorName: string;
  session: 'x11' | 'wayland' | 'unknown';
  /** Whether the desktop portal actually exposes GlobalShortcuts. */
  portal: 'available' | 'unavailable' | 'unknown';
  overlay: LinuxOverlayInfo;
  pasteBackend?: 'wtype' | 'ydotool' | 'dotool' | 'xdotool';
  hotkeyBackend?: 'x11' | 'swhkd' | 'compositor';
  /** Copy-ready snippet for the detected compositor, commands only. */
  hotkeyHint?: string;
  integrations: LinuxIntegrationStatus[];
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
  linux?: LinuxDesktopInfo;
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
  recheckIntegrations(): Promise<void>;
  openHotkeyConfig(): Promise<void>;
  recordingLevel(id: string, level: number, seconds: number): void;
  startAudioCapture(id: string): Promise<void>;
  stopAudioCapture(id: string): Promise<ArrayBuffer>;
  listAudioSources(): Promise<AudioSource[]>;
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
  onRecordingLimit(callback: () => void): () => void;
  onCaptureFallback(callback: (message: string) => void): () => void;
  onCaptureError(callback: (message: string) => void): () => void;
  onShortcutCaptureEnded(callback: () => void): () => void;
  onToggle(callback: () => void): () => void;
  onHold(callback: (pressed: boolean) => void): () => void;
  onDownload(callback: (state: DownloadState) => void): () => void;
  onUpdateState(callback: (state: AppUpdateState) => void): () => void;
}
export const MAX_RECORDING_SECONDS = 300;
