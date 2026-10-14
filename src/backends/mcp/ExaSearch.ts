import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema, McpError } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { SafeHttpClient } from '../http/SafeHttpClient.js';
import {
  AuthenticationError,
  BackendUnavailableError,
  NetworkError,
  RateLimitError,
  WebPulseError,
} from '../../core/errors.js';
import { abortError } from '../../core/BackendManager.js';

const endpoint = new URL('https://mcp.exa.ai/mcp');
export const searchResultSchema = z.object({
  title: z.string().nullable(),
  url: z.string().url(),
  id: z.string(),
  publishedDate: z.string().optional(),
  author: z.string().nullable().optional(),
  text: z.string().optional(),
});
export const searchResponseSchema = z.object({
  results: z.array(searchResultSchema),
  requestId: z.string().optional(),
  untrusted: z.literal(true),
});
const invalidResponse = () =>
  new WebPulseError('INVALID_RESPONSE', 'Exa MCP returned an unsupported search response.');

/** Both official Exa response forms are supported: structured JSON and labeled text. */
export function normalizeExaResult(
  raw: unknown,
  limit: number,
): z.output<typeof searchResponseSchema> {
  const parsed = CallToolResultSchema.safeParse(raw);
  if (!parsed.success) throw invalidResponse();
  const result = parsed.data;
  const text = result.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim();
  if (result.isError) {
    if (
      /rate.?limit|quota|too many requests|usage limit|limit.{0,30}(?:exceeded|reached)/i.test(text)
    )
      throw new RateLimitError('Exa keyless search is rate limited.', {
        suggestedAction:
          'Wait for the free-tier reset, or explicitly configure EXA_API_KEY to use your own account.',
      });
    if (/unauthoriz|forbidden|authenticat|api.?key|credential/i.test(text))
      throw new AuthenticationError('Exa MCP rejected the search request.');
    throw new BackendUnavailableError('Exa MCP reported a search failure.', { recoverable: false });
  }
  let data: unknown = result.structuredContent;
  if (data === undefined && text.startsWith('{')) {
    try {
      data = JSON.parse(text);
    } catch {
      throw invalidResponse();
    }
  }
  if (data !== undefined) {
    const response = searchResponseSchema.omit({ untrusted: true }).safeParse(data);
    if (!response.success) throw invalidResponse();
    return { ...response.data, results: response.data.results.slice(0, limit), untrusted: true };
  }
  if (/^No search results found\.(?: Please try a different query\.)?$/i.test(text))
    return { results: [], untrusted: true };
  // Exa's web_search_exa tool currently formats records with Title/URL and
  // optional Published, Author, Highlights or Text fields. Unknown formats fail closed.
  const blocks = text.split(/(?=^Title:[ \t])/m).filter((block) => block.trim());
  if (!blocks.length) throw invalidResponse();
  const results = blocks.map((block) => {
    const field = (name: string) =>
      new RegExp(`^${name}:[ \\t]*(.*)$`, 'm').exec(block)?.[1]?.trim();
    const title = field('Title');
    const url = field('URL');
    if (title === undefined || !url) throw invalidResponse();
    const publishedDate = field('Published(?: Date)?');
    const author = field('Author');
    const content = /^(?:Highlights|Text):[ \t]*([\s\S]*)/m
      .exec(block)?.[1]
      ?.replace(/\n\s*---\s*$/, '')
      .trim();
    return {
      id: url,
      url,
      title: title === 'N/A' ? null : title,
      ...(publishedDate && publishedDate !== 'N/A' ? { publishedDate } : {}),
      ...(author && author !== 'N/A' ? { author } : {}),
      ...(content ? { text: content } : {}),
    };
  });
  const response = searchResponseSchema.safeParse({
    results: results.slice(0, limit),
    untrusted: true,
  });
  if (!response.success) throw invalidResponse();
  return response.data;
}

export async function searchExaMcp(
  http: SafeHttpClient,
  query: string,
  limit: number,
  signal: AbortSignal,
) {
  const client = new Client({ name: 'webpulse', version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(endpoint, {
    // The core backend manager owns retries, not the protocol transport.
    reconnectionOptions: {
      maxRetries: 0,
      initialReconnectionDelay: 1000,
      maxReconnectionDelay: 1000,
      reconnectionDelayGrowFactor: 1,
    },
    fetch: async (input, init = {}) => {
      const target = new URL(input);
      if (target.href !== endpoint.href || !['GET', 'POST'].includes(init.method ?? 'GET'))
        throw new WebPulseError(
          'UNSAFE_URL',
          'The Exa MCP backend only contacts its fixed public endpoint.',
        );
      if (init.body !== undefined && typeof init.body !== 'string') throw invalidResponse();
      const headers = new Headers(init.headers);
      headers.delete('authorization');
      headers.delete('cookie');
      headers.delete('x-api-key');
      const response = await http.request(target.href, {
        method: init.method === 'POST' ? 'POST' : 'GET',
        headers: Object.fromEntries(headers),
        body: init.body,
        signal: AbortSignal.any([signal, ...(init.signal ? [init.signal] : [])]),
        // GET SSE is optional in MCP. Let the SDK handle the real 405 response.
        acceptedStatuses: init.method === 'GET' ? [405] : undefined,
        redirect: 'error',
      });
      const responseHeaders = new Headers(response.headers);
      responseHeaders.delete('content-length');
      responseHeaders.delete('content-encoding');
      return new Response([204, 205].includes(response.status) ? null : response.text, {
        status: response.status,
        headers: responseHeaders,
      });
    },
  });
  try {
    await client.connect(transport);
    const result = await client.callTool(
      { name: 'web_search_exa', arguments: { query, numResults: limit } },
      undefined,
      { signal },
    );
    return normalizeExaResult(result, limit);
  } catch (error) {
    if (signal.aborted) throw abortError(signal);
    if (error instanceof WebPulseError) throw error;
    if (error instanceof SyntaxError || error instanceof z.ZodError) throw invalidResponse();
    if (error instanceof McpError || error instanceof StreamableHTTPError)
      throw new BackendUnavailableError('The Exa MCP protocol request failed.', {
        recoverable: false,
        suggestedAction:
          'Check provider status and retry later, or explicitly configure EXA_API_KEY for REST access.',
      });
    throw new NetworkError('The Exa MCP connection failed.');
  } finally {
    await client.close();
  }
}
