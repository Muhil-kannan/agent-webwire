export const repository = {
  id: 1,
  name: 'Hello-World',
  full_name: 'octocat/Hello-World',
  html_url: 'https://github.com/octocat/Hello-World',
  description: 'A sample',
  stargazers_count: 5,
  language: 'TypeScript',
  private: false,
  default_branch: 'main',
};
export const issue = {
  id: 3,
  number: 1,
  title: 'Fix something',
  html_url: 'https://github.com/octocat/Hello-World/issues/1',
  state: 'open',
  body: 'Details',
};
export const video = {
  id: 'jNQXAC9IVRw',
  snippet: {
    title: 'Me at the zoo',
    description: 'A video',
    channelTitle: 'jawed',
    publishedAt: '2005-04-23T00:00:00Z',
  },
};
export const post = {
  id: 'abc123',
  title: 'TypeScript',
  permalink: '/r/typescript/comments/abc123/',
  subreddit: 'typescript',
  author: 'tester',
  score: 3,
  selftext: 'Content',
  created_utc: 123,
  url: 'https://www.reddit.com/r/typescript/comments/abc123/',
};
export const member = { id: 1, username: 'tester', url: 'https://www.v2ex.com/member/tester' };
export const topic = {
  id: 10,
  title: 'Topic',
  url: 'https://www.v2ex.com/t/10',
  content: 'Text',
  replies: 1,
  created: 123,
  node: { name: 'python', title: 'Python' },
  member,
};
export const html = `<!doctype html><html lang="en"><head><title>Example article</title><meta name="description" content="An example" /></head><body><article><h1>Example article</h1><p>${'This article explains reliable web access for agents. '.repeat(20)}</p><a href="/details">Details</a><script>throw new Error('must not run')</script></article></body></html>`;
export const rss =
  '<?xml version="1.0"?><rss version="2.0"><channel><title>Example feed</title><link>https://example.com</link><description>News</description><item><guid>entry-1</guid><title>Hello</title><link>/entry</link><description>Summary</description><pubDate>Wed, 14 Oct 2026 00:00:00 GMT</pubDate><author>Editor</author></item></channel></rss>';
export const atom =
  '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Atom feed</title><link href="https://example.com/"/><entry><id>atom-1</id><title>Atom entry</title><link rel="self" href="https://example.com/api/1"/><link rel="alternate" href="/article"/><updated>2026-10-14T00:00:00Z</updated><author><name>Ada</name></author><summary>Text</summary></entry></feed>';
export const vtt =
  'WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.500\nHello &amp; welcome\n\n2\n00:00:04.000 --> 00:00:05.000\n<v Speaker>World</v>\n';
