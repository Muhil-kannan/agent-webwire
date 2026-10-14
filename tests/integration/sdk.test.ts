import { describe, expect, it, vi, expectTypeOf } from 'vitest';
import { WebPulse, ConfigManager } from '../../src/index.js';
import { parseFeed } from '../../src/channels/rss/index.js';
import { videoId, parseVtt } from '../../src/channels/youtube/index.js';
import {
  repository,
  issue,
  video,
  post,
  member,
  topic,
  html,
  rss,
  atom,
  vtt,
} from '../fixtures/data.js';

function setup(env: NodeJS.ProcessEnv = {}) {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (input) => {
    const url = new URL(String(input));
    const path = url.pathname;
    if (url.hostname === 'example.com')
      return path === '/plain'
        ? new Response('Plain text', { headers: { 'content-type': 'text/plain' } })
        : new Response(html, { headers: { 'content-type': 'text/html' } });
    if (url.hostname === 'hnrss.org') return new Response(rss);
    if (url.hostname === 'api.github.com') {
      if (path === '/search/repositories')
        return Response.json({ items: [repository], total_count: 50 });
      if (path.endsWith('/issues'))
        return Response.json([
          issue,
          { ...issue, id: 4, pull_request: { url: 'https://api.github.com/pulls/2' } },
        ]);
      if (path.endsWith('/pulls')) return Response.json([{ ...issue, draft: false }]);
      return Response.json(repository);
    }
    if (url.hostname === 'www.googleapis.com') {
      if (path.endsWith('/search'))
        return Response.json({
          items: [{ id: { videoId: video.id }, snippet: video.snippet }],
          nextPageToken: 'next',
        });
      if (path.endsWith('/captions'))
        return Response.json({
          items: [{ id: 'track', snippet: { language: 'en', status: 'serving' } }],
        });
      if (path.includes('/captions/')) return new Response(vtt);
      return Response.json({ items: [video] });
    }
    if (url.hostname === 'oauth.reddit.com')
      return Response.json(
        path === '/api/v1/me'
          ? { name: 'tester' }
          : { data: { children: [{ data: post }], after: 't3_next' } },
      );
    if (url.hostname === 'api.x.com')
      return Response.json(
        path.endsWith('/recent')
          ? { data: [{ id: '123', text: 'Post' }], meta: { result_count: 1, next_token: 'next' } }
          : { data: { id: '123', text: 'Post' } },
      );
    if (url.hostname === 'api.exa.ai')
      return Response.json({
        results: [{ id: '1', title: 'Example', url: 'https://example.com' }],
        requestId: 'req',
      });
    if (url.hostname === 'api.linkedin.com') return Response.json({ sub: 'me', name: 'Tester' });
    if (url.hostname === 'www.v2ex.com') {
      if (path.includes('/members/')) return Response.json(member);
      if (path.includes('/replies/'))
        return Response.json([{ id: 1, content: 'Reply', created: 123, member }]);
      return Response.json([topic]);
    }
    throw new Error('Unexpected request');
  });
  return { pulse: new WebPulse({ http: { fetch }, env, retries: 0 }), fetch };
}
describe('core SDK operations', () => {
  it('extracts title, metadata, text and Markdown without executing scripts', async () => {
    const { pulse } = setup();
    const page = await pulse.web.read('https://example.com');
    expect(page.title).toBe('Example article');
    expect(page.metadata.description).toBe('An example');
    expect(page.markdown).toContain('[Details](https://example.com/details)');
    expect(page.text).not.toContain('throw new Error');
    expect(page.untrusted).toBe(true);
    expect((await pulse.web.read('https://example.com', { format: 'text' })).content).toBe(
      page.text,
    );
    expect((await pulse.web.read('https://example.com/plain')).content).toBe('Plain text');
    expectTypeOf(page.title).toEqualTypeOf<string>();
  });
  it('reads repository, search pagination, issues and pull requests', async () => {
    const { pulse, fetch } = setup({ GITHUB_TOKEN: 'test-gh-token' });
    expect(await pulse.github.getRepository('octocat', 'Hello-World')).toEqual(repository);
    const result = await pulse.github.searchRepositories('TypeScript & Node', {
      page: 2,
      limit: 10,
    });
    expect(result).toMatchObject({ page: 2, hasMore: true, total: 50 });
    expect(new URL(String(fetch.mock.calls[1]?.[0])).searchParams.get('q')).toBe(
      'TypeScript & Node',
    );
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('authorization')).toBe(
      'Bearer test-gh-token',
    );
    expect((await pulse.github.listIssues('octocat', 'Hello-World')).items).toEqual([issue]);
    expect((await pulse.github.listPullRequests('octocat', 'Hello-World')).items).toHaveLength(1);
    expect(JSON.stringify(pulse.diagnostics)).not.toContain('test-gh-token');
  });
  it('parses RSS and Atom metadata, relative links and dates', async () => {
    const { pulse } = setup();
    expect((await pulse.rss.read('https://hnrss.org/feed')).entries[0]).toMatchObject({
      id: 'entry-1',
      title: 'Hello',
      published: '2026-10-14T00:00:00.000Z',
      author: 'Editor',
    });
    const result = parseFeed(atom, 'https://example.com/atom', 10);
    expect(result.entries[0]).toMatchObject({
      id: 'atom-1',
      link: 'https://example.com/article',
      author: 'Ada',
    });
    expect(parseFeed(rss, 'https://example.com/feed', 1).entries).toHaveLength(1);
    for (const xml of [
      '<not-feed/>',
      '<rss>',
      '<!DOCTYPE rss [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><rss/>',
    ])
      expect(() => parseFeed(xml, 'https://example.com', 10)).toThrow();
  });
  it('uses official YouTube search, metadata and authorized caption download', async () => {
    const { pulse, fetch } = setup({
      YOUTUBE_API_KEY: 'test-yt-key',
      YOUTUBE_ACCESS_TOKEN: 'test-yt-oauth',
    });
    expect((await pulse.youtube.search('AI agents')).nextPageToken).toBe('next');
    expect(await pulse.youtube.getVideo('https://youtu.be/jNQXAC9IVRw')).toEqual(video);
    const transcript = await pulse.youtube.getTranscript(video.id);
    expect(transcript.segments).toEqual([
      { start: 1, duration: 2.5, text: 'Hello & welcome' },
      { start: 4, duration: 1, text: 'World' },
    ]);
    expect(
      fetch.mock.calls.some(([input]) => String(input).includes('/captions/track?tfmt=vtt')),
    ).toBe(true);
    const onlyKey = setup({ YOUTUBE_API_KEY: 'test-yt-key' });
    await expect(onlyKey.pulse.youtube.getTranscript(video.id)).rejects.toMatchObject({
      code: 'AUTHENTICATION',
    });
    expect(onlyKey.fetch).not.toHaveBeenCalled();
    await onlyKey.pulse.youtube.getVideo(video.id);
    expect(String(onlyKey.fetch.mock.calls[0]?.[0])).toContain('key=test-yt-key');
  });
  it('validates YouTube hosts and caption format', () => {
    for (const value of [
      video.id,
      `https://www.youtube.com/watch?v=${video.id}`,
      `https://youtube.com/shorts/${video.id}`,
      `https://youtube.com/embed/${video.id}`,
    ])
      expect(videoId(value)).toBe(video.id);
    for (const value of [
      'https://youtube.com.evil.com/watch?v=jNQXAC9IVRw',
      'https://youtube.com@evil.com/watch?v=jNQXAC9IVRw',
      'https://youtube.com/watch?v=bad',
      'garbage',
    ])
      expect(() => videoId(value)).toThrow();
    for (const value of [
      'bad',
      'WEBVTT\n',
      'WEBVTT\n\n00:00:03.000 --> 00:00:01.000\nBackwards',
      'WEBVTT\n\nbad --> time\nBroken',
    ])
      expect(() => parseVtt(value)).toThrow();
  });
  it('uses approved Reddit, X, Exa and LinkedIn APIs with scoped authentication', async () => {
    const { pulse, fetch } = setup({
      REDDIT_ACCESS_TOKEN: 'reddit-test',
      X_BEARER_TOKEN: 'x-test',
      EXA_API_KEY: 'exa-test',
      LINKEDIN_ACCESS_TOKEN: 'li-test',
    });
    expect(
      (await pulse.reddit.search('TypeScript', { subreddit: 'typescript', after: 't3_abc' }))
        .items[0],
    ).toEqual(post);
    expect(await pulse.reddit.getPost('abc123')).toEqual(post);
    expect((await pulse.twitter.search('AI')).nextToken).toBe('next');
    expect((await pulse.twitter.getPost('123')).text).toBe('Post');
    expect((await pulse.search.web('AI')).results[0]?.title).toBe('Example');
    const exa = fetch.mock.calls.find(([input]) => String(input).includes('api.exa.ai'));
    expect(exa?.[1]?.method).toBe('POST');
    expect(JSON.parse(String(exa?.[1]?.body))).toMatchObject({ query: 'AI', numResults: 10 });
    expect((await pulse.linkedin.getProfile()).sub).toBe('me');
  });
  it('reads V2EX topics, node pages, replies and profiles', async () => {
    const { pulse } = setup();
    expect(await pulse.v2ex.getHotTopics()).toEqual([topic]);
    expect(await pulse.v2ex.getNodeTopics('python')).toEqual([topic]);
    expect((await pulse.v2ex.getTopic(10)).replies[0]?.content).toBe('Reply');
    expect(await pulse.v2ex.getUser('tester')).toEqual(member);
  });
  it('fails honestly on missing configuration and unavailable platforms', async () => {
    const { pulse, fetch } = setup();
    for (const pending of [
      pulse.youtube.search('AI'),
      pulse.reddit.search('AI'),
      pulse.twitter.search('AI'),
      pulse.linkedin.getProfile(),
    ])
      await expect(pending).rejects.toMatchObject({ code: 'BACKEND_UNAVAILABLE' });
    expect(fetch).not.toHaveBeenCalled();
    await expect(
      pulse.executeCapability({ channel: 'instagram', operation: 'search', params: {} }),
    ).rejects.toMatchObject({ code: 'CHANNEL_UNAVAILABLE' });
    await expect(pulse.web.read('https://example.com', {}, { timeout: 1 })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });
  it('loads config explicitly and supports credential-name overrides', async () => {
    const store = new ConfigManager();
    vi.spyOn(store, 'load').mockResolvedValue({
      timeout: 1000,
      retries: 0,
      fallback: true,
      auth: { github: 'CUSTOM_GH' },
      preferredBackends: {},
    });
    const { fetch } = setup();
    const pulse = await WebPulse.fromConfig(store, {
      env: { CUSTOM_GH: 'custom-token' },
      http: { fetch },
    });
    await pulse.github.getRepository('octocat', 'Hello-World');
    expect(pulse.error(new Error('custom-token')).message).not.toContain('custom-token');
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('authorization')).toBe(
      'Bearer custom-token',
    );
    expect(() => new WebPulse({ enabledChannels: ['missing'] })).toThrow();
    expect(() => new WebPulse({ preferredBackends: { web: 'unknown' } })).toThrow();
    const disabled = new WebPulse({ enabledChannels: [] });
    await expect(disabled.web.read('https://example.com')).rejects.toMatchObject({
      code: 'CHANNEL_UNAVAILABLE',
    });
  });
  it('runs real mocked read probes and distinguishes configured, disabled and failed health', async () => {
    const { pulse } = setup({
      YOUTUBE_API_KEY: 'key',
      REDDIT_ACCESS_TOKEN: 'reddit',
      X_BEARER_TOKEN: 'x',
      EXA_API_KEY: 'exa',
      LINKEDIN_ACCESS_TOKEN: 'li',
    });
    expect((await pulse.doctor()).every((result) => result.backends[0]?.status === 'ready')).toBe(
      true,
    );
    const missing = await setup().pulse.doctor({ channels: ['youtube'] });
    expect(missing[0]?.backends[0]?.status).toBe('configuration_required');
    const disabled = new WebPulse({ enabledChannels: [] });
    expect((await disabled.doctor({ channels: ['web'] }))[0]?.backends[0]?.status).toBe('disabled');
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () => new Response('', { status: 401 }));
    expect(
      (await new WebPulse({ http: { fetch } }).doctor({ channels: ['web'] }))[0]?.backends[0]
        ?.status,
    ).toBe('configuration_required');
    fetch.mockRejectedValue(new Error('secret raw failure'));
    expect(
      (await new WebPulse({ http: { fetch } }).doctor({ channels: ['web'] }))[0]?.backends[0]
        ?.status,
    ).toBe('unavailable');
  });
});
