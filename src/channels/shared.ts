import { z } from 'zod';
import type { Backend, BackendContext, Operation, WebPulseChannel } from '../core/types.js';
import { health } from '../core/types.js';
import { AuthenticationError } from '../core/errors.js';
import type { Redactor } from '../security/redact.js';
import type { Config } from '../core/ConfigManager.js';
import type { SafeHttpClient } from '../backends/http/SafeHttpClient.js';

export interface ChannelDependencies {
  http: SafeHttpClient;
  credentials: Credentials;
}
export class Credentials {
  constructor(
    private readonly config: Config,
    private readonly redactor: Redactor,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}
  get(service: string, defaultEnv: string): string | undefined {
    const value = this.env[this.config.auth[service] ?? defaultEnv];
    this.redactor.add(value);
    return value || undefined;
  }
  require(service: string, defaultEnv: string): string {
    const value = this.get(service, defaultEnv);
    if (!value)
      throw new AuthenticationError(
        `Set ${this.config.auth[service] ?? defaultEnv} for this capability.`,
      );
    return value;
  }
}
export const urlInput = z.string().min(1).max(8192);
export const queryInput = z.string().trim().min(1).max(1000);
export const pageInput = z.number().int().min(1).max(100).default(1);
export const limitInput = z.number().int().min(1).max(100).default(20);
export const identifier = z
  .string()
  .regex(/^[\w.-]{1,100}$/)
  .refine((value) => !['.', '..'].includes(value));
export function operation<I extends z.ZodType, O extends z.ZodType>(
  description: string,
  input: I,
  output: O,
) {
  return { description, input, output, readOnly: true };
}
export function apiChannel(
  id: string,
  name: string,
  operations: Record<string, Operation>,
  execute: Backend['execute'],
  probe: (context: BackendContext) => Promise<unknown>,
  scope: string,
  available: () => boolean = () => true,
): WebPulseChannel {
  return {
    id,
    name,
    operations,
    backends: [
      {
        id: `${id}-http`,
        priority: 100,
        operations: Object.keys(operations),
        isAvailable: async () => available(),
        execute,
        checkHealth: async (context) => {
          if (!available())
            return health(
              'configuration_required',
              'Required environment credentials are missing.',
              scope,
              'See docs/AUTHENTICATION.md and webpulse configure.',
            );
          await probe(context);
          return health('ready', 'Read probe succeeded.', scope);
        },
      },
    ],
  };
}
