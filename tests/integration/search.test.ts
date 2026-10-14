import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebWire } from '../../src/index.js';
import { normalizeExaResult } from '../../src/backends/mcp/ExaSearch.js';
import { SafeHttpClient } from '../../src/backends/http/SafeHttpClient.js';
import { runCli } from '../../src/cli/program.js';
import { createMcpServer } from '../../src/mcp/server.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const record = {
  id: 'https://example.com/typescript',
  title: 'TypeScript news',
  url: 'https://example.com/typescript',
  text: 'The latest developments.',
};
const labeled =
  'Title: TypeScript news\nURL: https://example.com/typescript\nPublished: 2026-10-14\nAuthor: N/A\nHighlights:\nThe latest developments.';
function mockExa(result: unknown = { content: [{ type: 'text', text: labeled }] }, sse = false) {
  return vi.fn<typeof globalThis.fetch>().mockImplementation(async (input, init) => {
    if (String(input).startsWith('https://api.exa.ai/'))
      return Response.json({ results: [record] });
    expect(String(input)).toBe('https://mcp.exa.ai/mcp');
    if (init?.method === 'GET') return new Response(null, { status: 405 });
    const message = JSON.parse(String(init?.body)) as {
      id?: number;
      method: string;
      params?: { protocolVersion?: string };
    };
    if (message.method === 'notifications/initialized' || message.id === undefined)
      return new Response(null, { status: 202 });
    const value = {
      jsonrpc: '2.0',
      id: message.id,
      result:
        message.method === 'initialize'
          ? {
              protocolVersion: message.params?.protocolVersion,
              capabilities: { tools: {} },
              serverInfo: { name: 'exa-test', version: '1.0.0' },
            }
          : result,
    };
    return sse
      ? new Response(`: heartbeat\r\nevent: message\r\ndata: ${JSON.stringify(value)}\r\n\r\n`, {
          headers: { 'content-type': 'text/event-stream' },
        })
      : Response.json(value);
  });
}
const toolCalls = (fetch: ReturnType<typeof mockExa>) =>
  fetch.mock.calls.filter(
    ([, init]) => init?.body && JSON.parse(String(init.body)).method === 'tools/call',
  );
const oldExit = process.exitCode;
afterEach(() => {
  process.exitCode = oldExit;
});

describe('Exa keyless search', () => {
  it.each([false, true])(
    'negotiates MCP and normalizes results without credentials (SSE=%s)',
    async (sse) => {
      const fetch = mockExa(undefined, sse);
      const pulse = new WebWire({ env: {}, http: { fetch } });
      const result = await pulse.search.web('latest TypeScript developments', { limit: 3 });
      expect(result).toEqual({
        results: [{ ...record, publishedDate: '2026-10-14' }],
        untrusted: true,
      });
      const request = JSON.parse(String(toolCalls(fetch)[0]?.[1]?.body));
      expect(request.params).toEqual({
        name: 'web_search_exa',
        arguments: { query: 'latest TypeScript developments', numResults: 3 },
      });
      for (const [input, init] of fetch.mock.calls) {
        expect(String(input)).toBe('https://mcp.exa.ai/mcp');
        const headers = new Headers(init?.headers);
        expect(headers.has('x-api-key')).toBe(false);
        expect(headers.has('authorization')).toBe(false);
        expect(headers.has('cookie')).toBe(false);
      }
      expect(pulse.diagnostics.at(-1)).toMatchObject({ backend: 'search-mcp', outcome: 'success' });
    },
  );
  it('accepts structured JSON and recognizes real empty results', () => {
    for (const response of [
      { content: [], structuredContent: { results: [record], requestId: 'req' } },
      { content: [{ type: 'text', text: JSON.stringify({ results: [record] }) }] },
    ])
      expect(normalizeExaResult(response, 1).results).toEqual([record]);
    expect(
      normalizeExaResult(
        {
          content: [
            { type: 'text', text: 'No search results found. Please try a different query.' },
          ],
        },
        3,
      ).results,
    ).toEqual([]);
  });
  it('preserves optional fields, caps results, and rejects unsupported/malformed formats', () => {
    const text =
      'Title: N/A\nURL: https://example.com/1\nPublished Date: N/A\nAuthor: Ada\nText: One\n\n---\n\nTitle: Second\nURL: https://example.com/2\nText: Two';
    expect(normalizeExaResult({ content: [{ type: 'text', text }] }, 1).results).toEqual([
      {
        id: 'https://example.com/1',
        url: 'https://example.com/1',
        title: null,
        author: 'Ada',
        text: 'One',
      },
    ]);
    for (const value of [
      {},
      { content: [] },
      { content: [{ type: 'text', text: 'Provider changed its response' }] },
      { content: [], structuredContent: { unexpected: true } },
      { content: [{ type: 'text', text: '{bad' }] },
      { content: [{ type: 'text', text: 'Title: Missing link' }] },
      { content: [{ type: 'text', text: 'Title: Bad\nURL: invalid-url' }] },
    ])
      expect(() => normalizeExaResult(value, 1)).toThrow(
        expect.objectContaining({ code: 'INVALID_RESPONSE' }),
      );
  });
  it('prefers configured REST and never uses anonymous access after a credential/quota/network failure', async () => {
    const fetch = mockExa();
    const pulse = new WebWire({ env: { EXA_API_KEY: 'test-key' }, retries: 0, http: { fetch } });
    expect((await pulse.search.web('query')).results).toEqual([record]);
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('x-api-key')).toBe('test-key');
    for (const status of [401, 429, 500]) {
      fetch.mockClear();
      fetch.mockImplementation(async () => new Response('private provider message', { status }));
      await expect(pulse.search.web('query')).rejects.toMatchObject({
        code: status === 401 ? 'AUTHENTICATION' : status === 429 ? 'RATE_LIMIT' : 'NETWORK',
      });
      expect(fetch).toHaveBeenCalledOnce();
      expect(String(fetch.mock.calls[0]?.[0])).toBe('https://api.exa.ai/search');
    }
  });
  it.each([
    ['Free rate limit reached; configure an API key', 'RATE_LIMIT'],
    ['Unauthorized request', 'AUTHENTICATION'],
    ['An upstream tool failed', 'BACKEND_UNAVAILABLE'],
  ])('reports tool failures without leaking provider text or retrying (%s)', async (text, code) => {
    const fetch = mockExa({ isError: true, content: [{ type: 'text', text }] });
    const pulse = new WebWire({ env: {}, http: { fetch } });
    await expect(pulse.search.web('query')).rejects.toMatchObject({ code });
    expect(toolCalls(fetch)).toHaveLength(1);
  });
  it('preserves HTTP quota hints and rejects malformed protocol JSON', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(
        async () =>
          new Response('private quota body', { status: 429, headers: { 'retry-after': '60' } }),
      );
    const pulse = new WebWire({ env: {}, http: { fetch } });
    await expect(pulse.search.web('q')).rejects.toMatchObject({
      code: 'RATE_LIMIT',
      details: { retryAfterMs: 60000 },
    });
    expect(fetch).toHaveBeenCalledOnce();
    fetch.mockImplementation(
      async () => new Response('{bad', { headers: { 'content-type': 'application/json' } }),
    );
    await expect(pulse.search.web('q')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('enforces cancellation and response limits for MCP traffic', async () => {
    let started!: () => void;
    const requested = new Promise<void>((resolve) => {
      started = resolve;
    });
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(() => {
      started();
      return new Promise(() => {});
    });
    const pulse = new WebWire({ env: {}, http: { fetch } });
    const controller = new AbortController();
    const pending = pulse.search.web('query', {}, { signal: controller.signal });
    await requested;
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
    const oversized = new WebWire({ env: {}, http: { fetch: mockExa(), maxBytes: 20 } });
    await expect(oversized.search.web('query')).rejects.toMatchObject({
      code: 'RESPONSE_TOO_LARGE',
    });
  });
  it('refuses MCP redirects and does not hide an active doctor failure behind a disabled backend', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(
        async () =>
          new Response('', { status: 302, headers: { location: 'https://other.com/mcp' } }),
      );
    const pulse = new WebWire({ env: {}, http: { fetch } });
    await expect(pulse.search.web('query')).rejects.toMatchObject({
      code: 'NETWORK',
      details: { recoverable: false },
    });
    expect(fetch).toHaveBeenCalledOnce();
    fetch.mockImplementation(async () => new Response('', { status: 401 }));
    const out: string[] = [];
    process.exitCode = 0;
    await runCli(
      ['node', 'webwire', 'doctor', '--channel', 'search', '--json'],
      { out: (s) => out.push(s), err: () => {} },
      new WebWire({ env: { EXA_API_KEY: 'test' }, http: { fetch } }),
    );
    expect(
      JSON.parse(out.join(''))[0].backends.map((item: { status: string }) => item.status),
    ).toEqual(['configuration_required', 'disabled']);
    expect(process.exitCode).toBe(1);
  });
  it('checks the active search mode honestly without probing the other mode', async () => {
    const fetch = mockExa();
    const keyless = await new WebWire({ env: {}, http: { fetch } }).doctor({
      channels: ['search'],
    });
    expect(keyless[0]?.backends).toEqual([
      expect.objectContaining({ backend: 'search-http', status: 'configuration_required' }),
      expect.objectContaining({ backend: 'search-mcp', status: 'ready' }),
    ]);
    fetch.mockClear();
    const keyed = await new WebWire({ env: { EXA_API_KEY: 'test' }, http: { fetch } }).doctor({
      channels: ['search'],
    });
    expect(keyed[0]?.backends).toEqual([
      expect.objectContaining({ backend: 'search-http', status: 'ready' }),
      expect.objectContaining({ backend: 'search-mcp', status: 'disabled' }),
    ]);
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('makes CLI search work without configuration and preserves JSON output', async () => {
    const out: string[] = [],
      err: string[] = [];
    process.exitCode = 0;
    await runCli(
      ['node', 'webwire', 'search', 'latest TypeScript developments', '--limit', '3', '--json'],
      { out: (s) => out.push(s), err: (s) => err.push(s) },
      new WebWire({ env: {}, http: { fetch: mockExa() } }),
    );
    expect(JSON.parse(out.join('')).results[0].title).toBe('TypeScript news');
    expect(err).toEqual([]);
    expect(process.exitCode).toBe(0);
  });
  it('works through the WebWire MCP server with the existing result contract', async () => {
    const server = createMcpServer(new WebWire({ env: {}, http: { fetch: mockExa() } }));
    const client = new Client({ name: 'test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      await client.listTools();
      const result = await client.callTool({
        name: 'webwire_search_web',
        arguments: { query: 'query', limit: 3 },
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        data: { results: [{ title: 'TypeScript news' }], untrusted: true },
      });
    } finally {
      await client.close();
      await server.close();
    }
  });
  it('allows protocol-specific 405 responses only when explicitly requested', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () => new Response('', { status: 405 }));
    const http = new SafeHttpClient({ fetch });
    await expect(http.request('https://mcp.exa.ai/mcp')).rejects.toMatchObject({ code: 'NETWORK' });
    expect((await http.request('https://mcp.exa.ai/mcp', { acceptedStatuses: [405] })).status).toBe(
      405,
    );
  });
});
