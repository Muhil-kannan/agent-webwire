import { z } from 'zod';
import {
  apiChannel,
  operation,
  identifier,
  pageInput,
  type ChannelDependencies,
} from '../shared.js';
import { WebWireError } from '../../core/errors.js';

const memberSchema = z.object({
  id: z.number(),
  username: z.string(),
  url: z.string().optional(),
  bio: z.string().nullable().optional(),
  created: z.number().optional(),
});
const topicSchema = z.object({
  id: z.number(),
  title: z.string(),
  url: z.string(),
  content: z.string(),
  replies: z.number(),
  created: z.number(),
  node: z.object({ name: z.string(), title: z.string() }),
  member: memberSchema,
});
const replySchema = z.object({
  id: z.number(),
  content: z.string(),
  created: z.number(),
  member: memberSchema,
});
export const v2exOperations = {
  getHotTopics: operation(
    'Read V2EX public hot topics.',
    z.strictObject({ limit: z.number().int().min(1).max(100).default(20) }),
    z.array(topicSchema),
  ),
  getNodeTopics: operation(
    'Read a page of public topics from a V2EX node.',
    z.strictObject({ node: identifier, page: pageInput }),
    z.array(topicSchema),
  ),
  getTopic: operation(
    'Read a V2EX topic and one page of replies. Public API has no full-text search.',
    z.strictObject({ id: z.number().int().positive(), page: pageInput }),
    z.object({ topic: topicSchema, replies: z.array(replySchema), page: z.number() }),
  ),
  getUser: operation(
    'Read a V2EX public member profile.',
    z.strictObject({ username: identifier }),
    memberSchema,
  ),
};
export function createV2exChannel({ http }: ChannelDependencies) {
  const request = <T>(path: string, schema: z.ZodType<T>, signal: AbortSignal) =>
    http.json(`https://www.v2ex.com/api${path}`, schema, { signal });
  return apiChannel(
    'v2ex',
    'V2EX',
    v2exOperations,
    async (name, raw, { signal }) => {
      if (name === 'getHotTopics') {
        const p = v2exOperations.getHotTopics.input.parse(raw);
        return (await request('/topics/hot.json', z.array(topicSchema), signal)).slice(0, p.limit);
      }
      if (name === 'getNodeTopics') {
        const p = v2exOperations.getNodeTopics.input.parse(raw);
        return request(
          `/topics/show.json?${new URLSearchParams({ node_name: p.node, page: String(p.page) })}`,
          z.array(topicSchema),
          signal,
        );
      }
      if (name === 'getUser') {
        const p = v2exOperations.getUser.input.parse(raw);
        return request(
          `/members/show.json?${new URLSearchParams({ username: p.username })}`,
          memberSchema,
          signal,
        );
      }
      const p = v2exOperations.getTopic.input.parse(raw);
      const items = await request(`/topics/show.json?id=${p.id}`, z.array(topicSchema), signal);
      if (!items[0]) throw new WebWireError('NOT_FOUND', 'The V2EX topic was not found.');
      const replies = await request(
        `/replies/show.json?topic_id=${p.id}&page=${p.page}`,
        z.array(replySchema),
        signal,
      );
      return { topic: items[0], replies, page: p.page };
    },
    ({ signal }) => request('/topics/hot.json', z.array(topicSchema).min(1), signal),
    'Public hot-topics read; other endpoints can have distinct availability.',
  );
}
