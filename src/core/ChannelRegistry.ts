import { ChannelUnavailableError, ConfigurationError, ValidationError } from './errors.js';
import type { WebWireChannel } from './types.js';

export class ChannelRegistry {
  private readonly channels = new Map<string, WebWireChannel>();
  register(channel: WebWireChannel): void {
    if (!/^[a-z][a-z0-9_]*$/.test(channel.id) || this.channels.has(channel.id))
      throw new ConfigurationError(`Invalid or duplicate channel: ${channel.id}`);
    if (!Object.keys(channel.operations).length || !channel.backends.length)
      throw new ConfigurationError(`Channel ${channel.id} needs operations and backends.`);
    const backendIds = channel.backends.map((backend) => backend.id);
    if (new Set(backendIds).size !== backendIds.length)
      throw new ConfigurationError(`Duplicate backend in ${channel.id}.`);
    for (const name of Object.keys(channel.operations)) {
      if (
        !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name) ||
        !channel.backends.some((backend) => backend.operations.includes(name))
      )
        throw new ConfigurationError(`Invalid or unserved operation in ${channel.id}.`);
    }
    this.channels.set(channel.id, channel);
  }
  get(id: string): WebWireChannel {
    const channel = this.channels.get(id);
    if (!channel)
      throw new ChannelUnavailableError(`Channel '${id}' is not implemented or registered.`, {
        channel: id,
        suggestedAction:
          'Run webwire channels list and review the supported channels in README.md.',
      });
    return channel;
  }
  operation(channel: string, operation: string) {
    const result = this.get(channel).operations[operation];
    if (!result) throw new ValidationError(`Unknown operation '${operation}'.`, { channel });
    return result;
  }
  list(): WebWireChannel[] {
    return [...this.channels.values()];
  }
}
