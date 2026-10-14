import { z } from 'zod';
import {
  apiChannel,
  operation,
  queryInput,
  urlInput,
  type ChannelDependencies,
} from '../shared.js';
import { AuthenticationError, WebPulseError, ValidationError } from '../../core/errors.js';

const snippetSchema = z.object({
  title: z.string(),
  description: z.string(),
  channelTitle: z.string(),
  publishedAt: z.string(),
});
const videoSchema = z.object({
  id: z.string(),
  snippet: snippetSchema,
  contentDetails: z.object({ duration: z.string(), caption: z.string() }).optional(),
});
const segmentSchema = z.object({ start: z.number(), duration: z.number(), text: z.string() });
const videoInput = z.strictObject({ video: urlInput });
export const youtubeOperations = {
  search: operation(
    'Search YouTube videos using an API key or OAuth access token. Uses provider quota.',
    z.strictObject({
      query: queryInput,
      limit: z.number().int().min(1).max(50).default(10),
      pageToken: z.string().max(1000).optional(),
    }),
    z.object({
      items: z.array(z.object({ id: z.object({ videoId: z.string() }), snippet: snippetSchema })),
      nextPageToken: z.string().optional(),
    }),
  ),
  getVideo: operation(
    'Read YouTube video metadata using the official API.',
    videoInput,
    videoSchema,
  ),
  getTranscript: operation(
    'Download an available caption track for a video the OAuth identity can edit. This does not retrieve arbitrary public-video transcripts.',
    z.strictObject({
      video: urlInput,
      language: z
        .string()
        .regex(/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})?$/)
        .default('en'),
    }),
    z.object({
      videoId: z.string(),
      language: z.string(),
      text: z.string(),
      segments: z.array(segmentSchema),
      untrusted: z.literal(true),
    }),
  ),
};
export function videoId(value: string): string {
  if (/^[\w-]{11}$/.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.port || !['https:', 'http:'].includes(url.protocol))
      throw new Error();
    const host = url.hostname.toLowerCase();
    let id: string | null | undefined;
    if (host === 'youtu.be') id = url.pathname.slice(1);
    else if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host))
      id =
        url.pathname === '/watch'
          ? url.searchParams.get('v')
          : /^\/(?:shorts|embed)\/([\w-]{11})$/.exec(url.pathname)?.[1];
    if (id && /^[\w-]{11}$/.test(id)) return id;
  } catch {
    /* Invalid values are reported without echoing a URL. */
  }
  throw new ValidationError('Expected a YouTube video URL or an 11-character video ID.');
}
export function parseVtt(vtt: string) {
  if (!vtt.trimStart().startsWith('WEBVTT'))
    throw new WebPulseError('INVALID_RESPONSE', 'Expected a WebVTT caption response.');
  const seconds = (value: string) =>
    value.split(':').reduce((total, component) => total * 60 + Number(component), 0);
  const segments: z.output<typeof segmentSchema>[] = [];
  for (const block of vtt.replace(/\r/g, '').split(/\n\s*\n/)) {
    const lines = block.split('\n');
    const index = lines.findIndex((line) => line.includes('-->'));
    if (index < 0) continue;
    const match = /((?:\d{2}:)?\d{2}:\d{2}\.\d{3})\s+-->\s+((?:\d{2}:)?\d{2}:\d{2}\.\d{3})/.exec(
      lines[index] ?? '',
    );
    if (!match?.[1] || !match[2])
      throw new WebPulseError('INVALID_RESPONSE', 'Malformed WebVTT timestamps.');
    const start = seconds(match[1]);
    const end = seconds(match[2]);
    if (end < start) throw new WebPulseError('INVALID_RESPONSE', 'Malformed WebVTT cue duration.');
    const text = lines
      .slice(index + 1)
      .join(' ')
      .replace(/<[^>]*>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .trim();
    if (text) segments.push({ start, duration: end - start, text });
  }
  if (!segments.length) throw new WebPulseError('NOT_FOUND', 'No caption cues were available.');
  return segments;
}
export function createYoutubeChannel({ http, credentials }: ChannelDependencies) {
  const key = () => credentials.get('youtube', 'YOUTUBE_API_KEY');
  const token = () => credentials.get('youtubeOAuth', 'YOUTUBE_ACCESS_TOKEN');
  function requestOptions(params: Record<string, string>, oauth = false) {
    const bearer = token();
    const apiKey = key();
    if (oauth && !bearer)
      throw new AuthenticationError(
        'Caption download requires YOUTUBE_ACCESS_TOKEN with video-edit permission.',
      );
    if (!apiKey && !bearer)
      throw new AuthenticationError('Set YOUTUBE_API_KEY or YOUTUBE_ACCESS_TOKEN.');
    // API key is an upstream API parameter; it is never included in diagnostics.
    const headers: Record<string, string> = bearer ? { authorization: `Bearer ${bearer}` } : {};
    return {
      query: new URLSearchParams({ ...params, ...(!bearer && apiKey ? { key: apiKey } : {}) }),
      headers,
    };
  }
  const request = <T>(
    path: string,
    params: Record<string, string>,
    schema: z.ZodType<T>,
    signal: AbortSignal,
    oauth = false,
  ) => {
    const options = requestOptions(params, oauth);
    return http.json(`https://www.googleapis.com/youtube/v3/${path}?${options.query}`, schema, {
      signal,
      headers: options.headers,
    });
  };
  return apiChannel(
    'youtube',
    'YouTube',
    youtubeOperations,
    async (name, raw, { signal }) => {
      if (name === 'search') {
        const p = youtubeOperations.search.input.parse(raw);
        return request(
          'search',
          {
            part: 'snippet',
            type: 'video',
            q: p.query,
            maxResults: String(p.limit),
            ...(p.pageToken ? { pageToken: p.pageToken } : {}),
          },
          youtubeOperations.search.output,
          signal,
        );
      }
      if (name === 'getVideo') {
        const p = videoInput.parse(raw);
        const result = await request(
          'videos',
          { part: 'snippet,contentDetails', id: videoId(p.video) },
          z.object({ items: z.array(videoSchema) }),
          signal,
        );
        if (!result.items[0])
          throw new WebPulseError('NOT_FOUND', 'The video is unavailable to this identity.');
        return result.items[0];
      }
      const p = youtubeOperations.getTranscript.input.parse(raw);
      const id = videoId(p.video);
      const tracks = await request(
        'captions',
        { part: 'snippet', videoId: id },
        z.object({
          items: z.array(
            z.object({
              id: z.string(),
              snippet: z.object({ language: z.string(), status: z.string().optional() }),
            }),
          ),
        }),
        signal,
        true,
      );
      const track = tracks.items.find(
        (item) => item.snippet.language === p.language && item.snippet.status !== 'failed',
      );
      if (!track)
        throw new WebPulseError(
          'NOT_FOUND',
          'No accessible caption track matched the requested language.',
        );
      const options = requestOptions({ tfmt: 'vtt' }, true);
      const data = await http.request(
        `https://www.googleapis.com/youtube/v3/captions/${encodeURIComponent(track.id)}?${options.query}`,
        { signal, headers: options.headers },
      );
      const segments = parseVtt(data.text);
      return {
        videoId: id,
        language: p.language,
        text: segments.map((segment) => segment.text).join('\n'),
        segments,
        untrusted: true as const,
      };
    },
    ({ signal }) =>
      request(
        'videos',
        { part: 'snippet', id: 'jNQXAC9IVRw' },
        z.object({ items: z.array(videoSchema) }).refine((data) => data.items.length > 0),
        signal,
      ),
    'Read one public video. Search quota and caption-edit permission are separate and unverified.',
    () => Boolean(key() || token()),
  );
}
