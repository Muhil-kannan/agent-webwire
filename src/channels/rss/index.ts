import { z } from 'zod';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { apiChannel, operation, urlInput, type ChannelDependencies } from '../shared.js';
import { WebWireError } from '../../core/errors.js';

const entrySchema = z.object({
  id: z.string(),
  title: z.string(),
  link: z.string().optional(),
  summary: z.string().optional(),
  published: z.string().optional(),
  author: z.string().optional(),
});
export const feedSchema = z.object({
  url: z.string(),
  title: z.string(),
  description: z.string().optional(),
  link: z.string().optional(),
  entries: z.array(entrySchema),
  untrusted: z.literal(true),
});
export const rssOperations = {
  read: operation(
    'Read an RSS 2.0 or Atom feed. Entry text is untrusted and is not executed.',
    z.strictObject({ url: urlInput, limit: z.number().int().min(1).max(500).default(100) }),
    feedSchema,
  ),
};
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const array = (value: unknown): unknown[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];
function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : textValue(object(value)['#text']);
}
function textValue(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}
function link(value: unknown, base: string): string | undefined {
  for (const candidate of array(value)) {
    const item = object(candidate);
    if (item['@_rel'] && item['@_rel'] !== 'alternate') continue;
    const raw = text(item['@_href']) || text(candidate);
    try {
      const target = new URL(raw, base);
      if (
        raw &&
        ['http:', 'https:'].includes(target.protocol) &&
        !target.username &&
        !target.password
      )
        return target.href;
    } catch {
      /* An invalid feed link is omitted, never fetched. */
    }
  }
  return undefined;
}
function date(value: unknown): string | undefined {
  const raw = text(value);
  const stamp = Date.parse(raw);
  return Number.isFinite(stamp) ? new Date(stamp).toISOString() : undefined;
}
export function parseFeed(xml: string, url: string, limit: number) {
  if (/<!\s*(?:DOCTYPE|ENTITY)/i.test(xml) || XMLValidator.validate(xml) !== true)
    throw new WebWireError(
      'INVALID_RESPONSE',
      'The feed is malformed or contains a forbidden XML declaration.',
    );
  let parsed: unknown;
  try {
    parsed = new XMLParser({
      ignoreAttributes: false,
      processEntities: false,
      parseTagValue: false,
      trimValues: true,
    }).parse(xml) as unknown;
  } catch {
    throw new WebWireError('INVALID_RESPONSE', 'The XML feed could not be parsed.');
  }
  const root = object(parsed);
  const atom = root.feed !== undefined;
  const feed = object(atom ? root.feed : object(root.rss).channel);
  if (!Object.keys(feed).length || !text(feed.title))
    throw new WebWireError('INVALID_RESPONSE', 'Expected an RSS 2.0 or Atom feed with a title.');
  const entries = array(atom ? feed.entry : feed.item)
    .slice(0, limit)
    .map((raw) => {
      const entry = object(raw);
      const entryLink = link(entry.link, url);
      return {
        id: text(entry.id ?? entry.guid) || entryLink || '',
        title: text(entry.title),
        link: entryLink,
        summary:
          text(entry.summary ?? entry.description ?? entry.content ?? entry['content:encoded']) ||
          undefined,
        published: date(entry.published ?? entry.pubDate ?? entry.updated ?? entry['dc:date']),
        author:
          text(object(entry.author).name) || text(entry.author ?? entry['dc:creator']) || undefined,
      };
    });
  return {
    url,
    title: text(feed.title),
    description: text(feed.subtitle ?? feed.description) || undefined,
    link: link(feed.link, url),
    entries,
    untrusted: true as const,
  };
}
export function createRssChannel({ http }: ChannelDependencies) {
  const read = async (url: string, limit: number, signal: AbortSignal) => {
    const response = await http.request(url, {
      signal,
      headers: { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
    });
    return parseFeed(response.text, response.url, limit);
  };
  return apiChannel(
    'rss',
    'RSS / Atom',
    rssOperations,
    async (_, raw, { signal }) => {
      const p = rssOperations.read.input.parse(raw);
      return read(p.url, p.limit, signal);
    },
    ({ signal }) => read('https://hnrss.org/frontpage', 1, signal),
    'Fetch and parse one public RSS feed (hnrss.org); individual publisher availability differs.',
  );
}
