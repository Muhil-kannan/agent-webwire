import type { z } from 'zod';

export interface ExecuteOptions {
  signal?: AbortSignal;
  timeout?: number;
}
export interface Operation<I = unknown, O = unknown> {
  description: string;
  input: z.ZodType<I>;
  output: z.ZodType<O>;
  readOnly: boolean;
}
export interface HealthStatus {
  status: 'ready' | 'configuration_required' | 'unavailable' | 'disabled';
  message: string;
  scope: string;
  checkedAt: string;
  suggestedAction?: string;
}
export interface BackendContext {
  signal: AbortSignal;
}
export interface Backend {
  id: string;
  priority: number;
  operations: readonly string[];
  isAvailable(context: BackendContext): Promise<boolean>;
  checkHealth(context: BackendContext): Promise<HealthStatus>;
  execute(operation: string, params: unknown, context: BackendContext): Promise<unknown>;
}
export interface WebPulseChannel {
  id: string;
  name: string;
  operations: Readonly<Record<string, Operation>>;
  backends: readonly Backend[];
}
export interface Capability {
  channel: string;
  operation: string;
  description: string;
  readOnly: boolean;
  backends: string[];
}
export interface DiagnosticEvent {
  channel: string;
  operation: string;
  backend: string;
  attempt: number;
  outcome: 'success' | 'unavailable' | 'error';
  code?: string;
  durationMs: number;
}
export interface ChannelHealth {
  channel: string;
  name: string;
  capabilities: string[];
  backends: Array<HealthStatus & { backend: string }>;
}
export function health(
  status: HealthStatus['status'],
  message: string,
  scope: string,
  suggestedAction?: string,
): HealthStatus {
  return {
    status,
    message,
    scope,
    checkedAt: new Date().toISOString(),
    ...(suggestedAction ? { suggestedAction } : {}),
  };
}
