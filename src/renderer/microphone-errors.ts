export class MicrophoneAccessError extends Error {
  constructor() {
    super('Доступ к микрофону заблокирован. Нажмите «Разрешить» и подтвердите доступ.');
    this.name = 'MicrophoneAccessError';
  }
}

export function microphoneAccessDenied(error: unknown): boolean {
  return error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError');
}
