import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../../src/mcp/server.js';
import { WebPulse } from '../../src/index.js';
import { repository } from '../fixtures/data.js';

const sessions: Array<{ client: Client; server: ReturnType<typeof createMcpServer> }> = [];
async function connect(pulse: WebPulse) {
  const server = createMcpServer(pulse);
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  // Cache output schemas, just as a real client does during tool discovery.
  await client.listTools();
  sessions.push({ client, server });
  return client;
}
afterEach(async () => {
  for (const session of sessions.splice(0)) {
    await session.client.close();
    await session.server.close();
  }
});
describe('official MCP protocol', () => {
  it('negotiates, discovers schemas and invokes an SDK operation', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () => Response.json(repository));
    const client = await connect(new WebPulse({ http: { fetch }, env: {} }));
    const tools = await client.listTools();
    expect(
      tools.tools.find((tool) => tool.name === 'webpulse_youtube_transcript')?.description,
    ).toContain('can edit');
    expect(
      tools.tools.find((tool) => tool.name === 'webpulse_github_search')?.inputSchema.properties,
    ).toHaveProperty('query');
    const result = await client.callTool({
      name: 'webpulse_github_repository',
      arguments: { owner: 'octocat', repo: 'Hello-World' },
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({ data: repository });
  });
  it('rejects invalid inputs and unsafe URLs without network access', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const client = await connect(new WebPulse({ http: { fetch }, env: {} }));
    await client.listTools();
    const invalid = await client.callTool({
      name: 'webpulse_github_repository',
      arguments: { owner: '../escape', repo: 'repo' },
    });
    expect(invalid.isError).toBe(true);
    const unsafe = await client.callTool({
      name: 'webpulse_web_read',
      arguments: { url: 'http://169.254.169.254/' },
    });
    expect(unsafe.isError).toBe(true);
    expect(unsafe.structuredContent).toMatchObject({ error: { code: 'UNSAFE_URL' } });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('redacts credentials and returns structured provider failures', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () => new Response('test-secret', { status: 401 }));
    const client = await connect(
      new WebPulse({ http: { fetch }, env: { GITHUB_TOKEN: 'test-secret' } }),
    );
    const result = await client.callTool({
      name: 'webpulse_github_repository',
      arguments: { owner: 'octocat', repo: 'Hello-World' },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain('test-secret');
    expect(result.structuredContent).toMatchObject({ error: { code: 'AUTHENTICATION' } });
  });
  it('hides disabled channels and exposes scoped doctor results', async () => {
    const client = await connect(new WebPulse({ enabledChannels: [] }));
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['webpulse_doctor']);
    const result = await client.callTool({
      name: 'webpulse_doctor',
      arguments: { channels: ['web'] },
    });
    expect(result.structuredContent).toMatchObject({
      data: [{ channel: 'web', backends: [{ status: 'disabled' }] }],
    });
    const unknown = await client.callTool({
      name: 'webpulse_doctor',
      arguments: { channels: ['missing'] },
    });
    expect(unknown.isError).toBe(true);
  });
});
