import type { DesktopApi, OverlayApi } from '../shared/contracts';
declare global { interface Window { vokeyra: DesktopApi; vokeyraOverlay: OverlayApi } }
