import { z } from 'zod';
import {
  apiChannel,
  operation,
  queryInput,
  identifier,
  type ChannelDependencies,
} from '../shared.js';

const postSchema = z.object({
  id: z.string(),
  title: z.string(),
  permalink: z.string(),
  subreddit: z.string(),
  author: z.string(),
  score: z.number(),
  selftext: z.string(),
  created_utc: z.number(),
  url: z.string(),
});
const listingSchema = z.object({
  data: z.object({
    children: z.array(z.object({ data: postSchema })),
    after: z.string().nullable(),
  }),
});
export const redditOperations = {
  search: operation(
    'Search Reddit with an approved OAuth access token. Anonymous endpoints are not used.',
    z.strictObject({
      query: queryInput,
      subreddit: identifier.optional(),
      limit: z.number().int().min(1).max(100).default(25),
      after: z
        .string()
        .regex(/^t3_[a-z0-9]+$/)
        .optional(),
    }),
    z.object({ items: z.array(postSchema), after: z.string().nullable() }),
  ),
  getPost: operation(
    'Read a Reddit post by its base36 ID using approved OAuth.',
    z.strictObject({ id: z.string().regex(/^[a-z0-9]{1,20}$/) }),
    postSchema,
  ),
};
export function createRedditChannel({ http, credentials }: ChannelDependencies) {
  const request = <T>(path: string, schema: z.ZodType<T>, signal: AbortSignal) =>
    http.json(`https://oauth.reddit.com${path}`, schema, {
      signal,
      headers: {
        authorization: `Bearer ${credentials.require('reddit', 'REDDIT_ACCESS_TOKEN')}`,
        'user-agent': 'node:agent-webwire:0.1.0 (read-only SDK; user-supplied approved OAuth)',
      },
    });
  return apiChannel(
    'reddit',
    'Reddit',
    redditOperations,
    async (name, raw, { signal }) => {
      if (name === 'getPost') {
        const { id } = redditOperations.getPost.input.parse(raw);
        const result = await request(`/api/info?id=t3_${id}&raw_json=1`, listingSchema, signal);
        const item = result.data.children[0]?.data;
        if (!item) {
          const { WebWireError } = await import('../../core/errors.js');
          throw new WebWireError('NOT_FOUND', 'The Reddit post is unavailable.');
        }
        return item;
      }
      const p = redditOperations.search.input.parse(raw);
      const result = await request(
        `${p.subreddit ? `/r/${encodeURIComponent(p.subreddit)}` : ''}/search?${new URLSearchParams({ q: p.query, limit: String(p.limit), raw_json: '1', ...(p.subreddit ? { restrict_sr: 'on' } : {}), ...(p.after ? { after: p.after } : {}) })}`,
        listingSchema,
        signal,
      );
      return { items: result.data.children.map((item) => item.data), after: result.data.after };
    },
    ({ signal }) => request('/api/v1/me', z.object({ name: z.string() }), signal),
    'OAuth identity probe; subreddit-specific access and search grants can differ.',
    () => Boolean(credentials.get('reddit', 'REDDIT_ACCESS_TOKEN')),
  );
}
