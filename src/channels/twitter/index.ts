import { z } from 'zod';
import { apiChannel, operation, queryInput, type ChannelDependencies } from '../shared.js';

const tweetSchema = z.object({
  id: z.string(),
  text: z.string(),
  author_id: z.string().optional(),
  created_at: z.string().optional(),
});
export const twitterOperations = {
  search: operation(
    'Search recent X posts using the official API and an entitled bearer token; account charges may apply.',
    z.strictObject({
      query: queryInput,
      limit: z.number().int().min(10).max(100).default(10),
      nextToken: z.string().max(1000).optional(),
    }),
    z.object({ items: z.array(tweetSchema), nextToken: z.string().optional() }),
  ),
  getPost: operation(
    'Read one X post using the official API.',
    z.strictObject({ id: z.string().regex(/^\d{1,30}$/) }),
    tweetSchema,
  ),
};
export function createTwitterChannel({ http, credentials }: ChannelDependencies) {
  const request = <T>(path: string, schema: z.ZodType<T>, signal: AbortSignal) =>
    http.json(`https://api.x.com/2${path}`, schema, {
      signal,
      headers: { authorization: `Bearer ${credentials.require('twitter', 'X_BEARER_TOKEN')}` },
    });
  const search = async (
    query: string,
    limit: number,
    nextToken: string | undefined,
    signal: AbortSignal,
  ) => {
    const result = await request(
      `/tweets/search/recent?${new URLSearchParams({ query, max_results: String(limit), 'tweet.fields': 'created_at,author_id', ...(nextToken ? { next_token: nextToken } : {}) })}`,
      z.object({
        data: z.array(tweetSchema).optional(),
        meta: z.object({ result_count: z.number(), next_token: z.string().optional() }),
      }),
      signal,
    );
    return { items: result.data ?? [], nextToken: result.meta.next_token };
  };
  return apiChannel(
    'twitter',
    'Twitter / X',
    twitterOperations,
    async (name, raw, { signal }) => {
      if (name === 'getPost') {
        const p = twitterOperations.getPost.input.parse(raw);
        const result = await request(
          `/tweets/${p.id}?tweet.fields=created_at,author_id`,
          z.object({ data: tweetSchema }),
          signal,
        );
        return result.data;
      }
      const p = twitterOperations.search.input.parse(raw);
      return search(p.query, p.limit, p.nextToken, signal);
    },
    ({ signal }) => search('typescript', 10, undefined, signal),
    'Recent-search API read; consumes account quota and may incur provider charges.',
    () => Boolean(credentials.get('twitter', 'X_BEARER_TOKEN')),
  );
}
