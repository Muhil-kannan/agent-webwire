import type { z } from 'zod';
import { SafeHttpClient, type HttpOptions } from '../backends/http/SafeHttpClient.js';
import { builtinChannels, builtinOperations } from '../channels/index.js';
import { Credentials } from '../channels/shared.js';
import { Redactor } from '../security/redact.js';
import { BackendManager } from './BackendManager.js';
import { ChannelRegistry } from './ChannelRegistry.js';
import { CapabilityManager } from './CapabilityManager.js';
import { ConfigManager, parseConfig, type ConfigInput, type Config } from './ConfigManager.js';
import { HealthChecker } from './HealthChecker.js';
import { ChannelUnavailableError, ValidationError, publicError } from './errors.js';
import type { ExecuteOptions, DiagnosticEvent, WebPulseChannel } from './types.js';

export type BuiltinChannel = keyof typeof builtinOperations;
export type BuiltinOperation<C extends BuiltinChannel> = keyof (typeof builtinOperations)[C] &
  string;
type Schema<C extends BuiltinChannel, O extends BuiltinOperation<C>, K extends 'input' | 'output'> =
  (typeof builtinOperations)[C][O] extends Record<K, infer S extends z.ZodType> ? S : never;
export type OperationInput<C extends BuiltinChannel, O extends BuiltinOperation<C>> = z.input<
  Schema<C, O, 'input'>
>;
export type OperationOutput<C extends BuiltinChannel, O extends BuiltinOperation<C>> = z.output<
  Schema<C, O, 'output'>
>;
type PageOptions = { page?: number; limit?: number };
type StateOptions = PageOptions & { state?: 'open' | 'closed' | 'all' };
export interface WebPulseOptions extends ConfigInput {
  http?: HttpOptions;
  env?: NodeJS.ProcessEnv;
  channels?: WebPulseChannel[];
}
export class WebPulse {
  readonly registry = new ChannelRegistry();
  readonly capabilities = new CapabilityManager(this.registry);
  readonly config: Config;
  readonly redactor = new Redactor();
  private readonly manager: BackendManager;
  private readonly checker: HealthChecker;
  private readonly events: DiagnosticEvent[] = [];
  constructor(options: WebPulseOptions = {}) {
    const { http: httpOptions, env, channels = [], ...settings } = options;
    this.config = parseConfig(settings);
    const http = new SafeHttpClient({
      ...httpOptions,
      timeout: httpOptions?.timeout ?? this.config.timeout,
    });
    const credentials = new Credentials(this.config, this.redactor, env);
    for (const channel of [...builtinChannels({ http, credentials }), ...channels])
      this.registry.register(channel);
    if (this.config.enabledChannels)
      for (const id of this.config.enabledChannels) this.registry.get(id);
    this.manager = new BackendManager(this.config, (event) => {
      this.events.push(event);
      if (this.events.length > 100) this.events.shift();
    });
    for (const [id, preference] of Object.entries(this.config.preferredBackends)) {
      const ch = this.registry.get(id);
      this.manager.ordered(
        ch,
        ch.backends.find((backend) => backend.id === preference)?.operations[0] ?? '',
      );
    }
    this.checker = new HealthChecker(this.registry, this.config);
  }
  static async fromConfig(manager = new ConfigManager(), overrides: WebPulseOptions = {}) {
    const config = await manager.load();
    return new WebPulse({
      ...config,
      ...overrides,
      auth: { ...config.auth, ...overrides.auth },
      preferredBackends: { ...config.preferredBackends, ...overrides.preferredBackends },
    });
  }
  get diagnostics(): DiagnosticEvent[] {
    return this.redactor.value([...this.events]);
  }
  error(error: unknown) {
    return publicError(error, this.redactor);
  }
  async execute<C extends BuiltinChannel, O extends BuiltinOperation<C>>(
    request: { channel: C; operation: O; params: OperationInput<C, O> },
    options?: ExecuteOptions,
  ): Promise<OperationOutput<C, O>> {
    return (await this.executeCapability(request, options)) as OperationOutput<C, O>;
  }
  /** Runtime-validated entry point for plugins and tools discovered at runtime. */
  async executeCapability(
    request: { channel: string; operation: string; params: unknown },
    options: ExecuteOptions = {},
  ): Promise<unknown> {
    const timeout = options.timeout ?? this.config.timeout;
    if (!Number.isInteger(timeout) || timeout < 100 || timeout > 120000)
      throw new ValidationError('Timeout must be between 100 and 120000 milliseconds.');
    const channel = this.registry.get(request.channel);
    if (this.config.enabledChannels && !this.config.enabledChannels.includes(channel.id))
      throw new ChannelUnavailableError('This channel is disabled.', { channel: channel.id });
    const spec = this.registry.operation(channel.id, request.operation);
    const signal = AbortSignal.any([
      AbortSignal.timeout(timeout),
      ...(options.signal ? [options.signal] : []),
    ]);
    return this.manager.execute(channel, request.operation, request.params, spec, signal);
  }
  async doctor(options: { channels?: string[]; signal?: AbortSignal } = {}) {
    return this.redactor.value(
      await this.checker.check(
        options.channels ?? this.registry.list().map((channel) => channel.id),
        options.signal,
      ),
    );
  }
  readonly web = {
    read: (url: string, params: { format?: 'text' | 'markdown' } = {}, options?: ExecuteOptions) =>
      this.execute({ channel: 'web', operation: 'read', params: { url, ...params } }, options),
  };
  readonly rss = {
    read: (url: string, params: { limit?: number } = {}, options?: ExecuteOptions) =>
      this.execute({ channel: 'rss', operation: 'read', params: { url, ...params } }, options),
  };
  readonly github = {
    getRepository: (owner: string, repo: string, options?: ExecuteOptions) =>
      this.execute(
        { channel: 'github', operation: 'getRepository', params: { owner, repo } },
        options,
      ),
    searchRepositories: (query: string, params: PageOptions = {}, options?: ExecuteOptions) =>
      this.execute(
        { channel: 'github', operation: 'searchRepositories', params: { query, ...params } },
        options,
      ),
    listIssues: (
      owner: string,
      repo: string,
      params: StateOptions = {},
      options?: ExecuteOptions,
    ) =>
      this.execute(
        { channel: 'github', operation: 'listIssues', params: { owner, repo, ...params } },
        options,
      ),
    listPullRequests: (
      owner: string,
      repo: string,
      params: StateOptions = {},
      options?: ExecuteOptions,
    ) =>
      this.execute(
        { channel: 'github', operation: 'listPullRequests', params: { owner, repo, ...params } },
        options,
      ),
  };
  readonly youtube = {
    search: (
      query: string,
      params: { limit?: number; pageToken?: string } = {},
      options?: ExecuteOptions,
    ) =>
      this.execute(
        { channel: 'youtube', operation: 'search', params: { query, ...params } },
        options,
      ),
    getVideo: (video: string, options?: ExecuteOptions) =>
      this.execute({ channel: 'youtube', operation: 'getVideo', params: { video } }, options),
    getTranscript: (video: string, params: { language?: string } = {}, options?: ExecuteOptions) =>
      this.execute(
        { channel: 'youtube', operation: 'getTranscript', params: { video, ...params } },
        options,
      ),
  };
  readonly reddit = {
    search: (
      query: string,
      params: { limit?: number; subreddit?: string; after?: string } = {},
      options?: ExecuteOptions,
    ) =>
      this.execute(
        { channel: 'reddit', operation: 'search', params: { query, ...params } },
        options,
      ),
    getPost: (id: string, options?: ExecuteOptions) =>
      this.execute({ channel: 'reddit', operation: 'getPost', params: { id } }, options),
  };
  readonly twitter = {
    search: (
      query: string,
      params: { limit?: number; nextToken?: string } = {},
      options?: ExecuteOptions,
    ) =>
      this.execute(
        { channel: 'twitter', operation: 'search', params: { query, ...params } },
        options,
      ),
    getPost: (id: string, options?: ExecuteOptions) =>
      this.execute({ channel: 'twitter', operation: 'getPost', params: { id } }, options),
  };
  readonly search = {
    web: (query: string, params: { limit?: number } = {}, options?: ExecuteOptions) =>
      this.execute({ channel: 'search', operation: 'web', params: { query, ...params } }, options),
  };
  readonly v2ex = {
    getHotTopics: (params: { limit?: number } = {}, options?: ExecuteOptions) =>
      this.execute({ channel: 'v2ex', operation: 'getHotTopics', params }, options),
    getNodeTopics: (node: string, params: { page?: number } = {}, options?: ExecuteOptions) =>
      this.execute(
        { channel: 'v2ex', operation: 'getNodeTopics', params: { node, ...params } },
        options,
      ),
    getTopic: (id: number, params: { page?: number } = {}, options?: ExecuteOptions) =>
      this.execute({ channel: 'v2ex', operation: 'getTopic', params: { id, ...params } }, options),
    getUser: (username: string, options?: ExecuteOptions) =>
      this.execute({ channel: 'v2ex', operation: 'getUser', params: { username } }, options),
  };
  readonly linkedin = {
    getProfile: (options?: ExecuteOptions) =>
      this.execute({ channel: 'linkedin', operation: 'getProfile', params: {} }, options),
  };
}
