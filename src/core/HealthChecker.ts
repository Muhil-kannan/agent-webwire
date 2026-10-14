import type { ChannelRegistry } from './ChannelRegistry.js';
import type { Config } from './ConfigManager.js';
import { abortable } from './BackendManager.js';
import { health, type ChannelHealth } from './types.js';
import { normalizeError } from './errors.js';

export class HealthChecker {
  constructor(
    private readonly registry: ChannelRegistry,
    private readonly config: Config,
  ) {}
  async check(channels: string[], signal?: AbortSignal): Promise<ChannelHealth[]> {
    // Validate all names before any network request.
    const selected = channels.map((id) => this.registry.get(id));
    return Promise.all(
      selected.map(async (channel) => ({
        channel: channel.id,
        name: channel.name,
        capabilities: Object.keys(channel.operations),
        backends: await Promise.all(
          channel.backends.map(async (backend) => {
            if (this.config.enabledChannels && !this.config.enabledChannels.includes(channel.id))
              return {
                backend: backend.id,
                ...health(
                  'disabled',
                  'Channel is disabled in configuration.',
                  'No probe executed.',
                ),
              };
            const deadline = AbortSignal.any([
              AbortSignal.timeout(this.config.timeout),
              ...(signal ? [signal] : []),
            ]);
            try {
              return {
                backend: backend.id,
                ...(await abortable(() => backend.checkHealth({ signal: deadline }), deadline)),
              };
            } catch (error) {
              const failure = normalizeError(error);
              return {
                backend: backend.id,
                ...health(
                  failure.code === 'AUTHENTICATION' ? 'configuration_required' : 'unavailable',
                  failure.message,
                  'The configured read probe did not succeed.',
                  failure.details.suggestedAction ??
                    'Check connectivity, credentials and provider status, then retry doctor.',
                ),
              };
            }
          }),
        ),
      })),
    );
  }
}
