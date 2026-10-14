import type { ChannelRegistry } from './ChannelRegistry.js';
import type { Capability } from './types.js';

export class CapabilityManager {
  constructor(private readonly registry: ChannelRegistry) {}
  list(): Capability[] {
    return this.registry.list().flatMap((channel) =>
      Object.entries(channel.operations).map(([operation, spec]) => ({
        channel: channel.id,
        operation,
        description: spec.description,
        readOnly: spec.readOnly,
        backends: channel.backends
          .filter((backend) => backend.operations.includes(operation))
          .map((backend) => backend.id),
      })),
    );
  }
}
