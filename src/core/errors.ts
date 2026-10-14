import { Redactor } from '../security/redact.js';

export type ErrorCode =
  | 'AUTHENTICATION'
  | 'RATE_LIMIT'
  | 'BACKEND_UNAVAILABLE'
  | 'CHANNEL_UNAVAILABLE'
  | 'CONFIGURATION'
  | 'NETWORK'
  | 'VALIDATION'
  | 'UNSAFE_URL'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'RESPONSE_TOO_LARGE'
  | 'INVALID_RESPONSE'
  | 'NOT_FOUND'
  | 'INTERNAL';
export interface ErrorDetails {
  channel?: string;
  backend?: string;
  recoverable?: boolean;
  suggestedAction?: string;
  retryAfterMs?: number;
}
export class WebWireError extends Error {
  override readonly name: string = 'WebWireError';
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details: ErrorDetails = {},
  ) {
    super(message);
  }
  toJSON() {
    return { code: this.code, message: this.message, recoverable: false, ...this.details };
  }
}
export class AuthenticationError extends WebWireError {
  constructor(message = 'Authentication or permission check failed.', details: ErrorDetails = {}) {
    super('AUTHENTICATION', message, {
      suggestedAction: 'Check the configured credential, scopes and platform access grant.',
      ...details,
    });
  }
}
export class RateLimitError extends WebWireError {
  constructor(
    message = 'The provider rate limit or quota was reached.',
    details: ErrorDetails = {},
  ) {
    super('RATE_LIMIT', message, {
      suggestedAction: 'Wait for the provider reset or review the account quota.',
      ...details,
    });
  }
}
export class BackendUnavailableError extends WebWireError {
  constructor(message = 'No compatible backend is available.', details: ErrorDetails = {}) {
    super('BACKEND_UNAVAILABLE', message, { recoverable: true, ...details });
  }
}
export class ChannelUnavailableError extends WebWireError {
  constructor(message: string, details: ErrorDetails = {}) {
    super('CHANNEL_UNAVAILABLE', message, details);
  }
}
export class ConfigurationError extends WebWireError {
  constructor(message: string) {
    super('CONFIGURATION', message, {
      suggestedAction: 'Review configuration and run webwire channels list.',
    });
  }
}
export class NetworkError extends WebWireError {
  constructor(message = 'The network request failed.', details: ErrorDetails = {}) {
    super('NETWORK', message, { recoverable: true, ...details });
  }
}
export class ValidationError extends WebWireError {
  constructor(message: string, details: ErrorDetails = {}) {
    super('VALIDATION', message, details);
  }
}
export function normalizeError(error: unknown): WebWireError {
  return error instanceof WebWireError
    ? error
    : new WebWireError('INTERNAL', 'An unexpected operation failure occurred.');
}
export function publicError(error: unknown, redactor = new Redactor()) {
  return redactor.value(normalizeError(error).toJSON());
}
