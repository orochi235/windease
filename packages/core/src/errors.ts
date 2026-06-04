export type WindeaseErrorCode =
  | 'UNKNOWN_WINDOW'
  | 'UNKNOWN_ZONE'
  | 'ILLEGAL_TRANSITION'
  | 'DUPLICATE_ZONE'
  | 'DUPLICATE_WINDOW'
  | 'ZONE_NOT_EMPTY'
  | 'UNKNOWN_STRATEGY';

export class WindeaseError extends Error {
  readonly code: WindeaseErrorCode;
  constructor(code: WindeaseErrorCode, message: string) {
    super(message);
    this.name = 'WindeaseError';
    this.code = code;
  }
}
