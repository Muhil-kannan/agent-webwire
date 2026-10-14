import { z } from 'zod';
import { operation, queryInput, type ChannelDependencies } from '../shared.js';
import { searchExaMcp, searchResponseSchema } from '../../backends/mcp/ExaSearch.js';
import { health, type WebPulseChannel } from '../../core/types.js';

export const searchOperations = {
  web: operation(
    'Search the web using Exa keyless MCP by default, or REST when EXA_API_KEY is configured. Keyless usage is rate limited; authenticated usage may incur charges.',
    z.strictObject({ query: queryInput, limit: z.number().int().min(1).max(100).default(10) }),
    searchResponseSchema,
  ),
};
export function createSearchChannel({ http, credentials }: ChannelDependencies): WebPulseChannel {
  const hasKey = () => Boolean(credentials.get('search', 'EXA_API_KEY'));
  const search = async (query: string, limit: number, signal: AbortSignal) => {
    const result = await http.json(
      'https://api.exa.ai/search',
      searchOperations.web.output.omit({ untrusted: true }),
      {
        signal,
        method: 'POST',
        headers: {
          'x-api-key': credentials.require('search', 'EXA_API_KEY'),
          'content-type': 'application/json',
        },
        body: JSON.stringify({ query, numResults: limit, type: 'auto' }),
      },
    );
    return { ...result, untrusted: true as const };
  };
  return {
    id: 'search',
    name: 'Web search (Exa)',
    operations: searchOperations,
    backends: [
      {
        id: 'search-http',
        priority: 100,
        operations: ['web'],
        isAvailable: async () => hasKey(),
        execute: async (_, raw, { signal }) => {
          const p = searchOperations.web.input.parse(raw);
          return search(p.query, p.limit, signal);
        },
        checkHealth: async ({ signal }) => {
          const scope =
            'One authenticated Exa REST search; consumes account quota and may incur charges.';
          if (!hasKey())
            return health(
              'configuration_required',
              'Optional REST backend needs EXA_API_KEY. Keyless MCP does not need a key.',
              scope,
            );
          await search('example.com', 1, signal);
          return health('ready', 'Authenticated search probe succeeded.', scope);
        },
      },
      {
        id: 'search-mcp',
        priority: 50,
        operations: ['web'],
        // A configured account never silently falls back to anonymous access.
        isAvailable: async () => !hasKey(),
        execute: async (_, raw, { signal }) => {
          const p = searchOperations.web.input.parse(raw);
          return searchExaMcp(http, p.query, p.limit, signal);
        },
        checkHealth: async ({ signal }) => {
          const scope = 'One Exa keyless MCP search; consumes the provider free-tier quota.';
          if (hasKey())
            return health(
              'disabled',
              'Keyless access is disabled while an Exa API key is configured.',
              'No anonymous probe executed.',
            );
          await searchExaMcp(http, 'example.com', 1, signal);
          return health('ready', 'Keyless MCP search probe succeeded.', scope);
        },
      },
    ],
  };
}
