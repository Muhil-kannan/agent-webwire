import { z } from 'zod';
import {
  apiChannel,
  operation,
  identifier,
  queryInput,
  pageInput,
  limitInput,
  type ChannelDependencies,
} from '../shared.js';

const repositorySchema = z.object({
  id: z.number(),
  name: z.string(),
  full_name: z.string(),
  html_url: z.string(),
  description: z.string().nullable(),
  stargazers_count: z.number(),
  language: z.string().nullable(),
  private: z.boolean(),
  default_branch: z.string(),
});
const issueSchema = z.object({
  id: z.number(),
  number: z.number(),
  title: z.string(),
  html_url: z.string(),
  state: z.string(),
  body: z.string().nullish(),
  pull_request: z.object({ url: z.string().optional() }).optional(),
});
const pullSchema = z.object({
  id: z.number(),
  number: z.number(),
  title: z.string(),
  html_url: z.string(),
  state: z.string(),
  body: z.string().nullish(),
  draft: z.boolean().optional(),
  merged_at: z.string().nullable().optional(),
});
const repoInput = { owner: identifier, repo: identifier };
const listInput = z.strictObject({
  ...repoInput,
  page: pageInput,
  limit: limitInput,
  state: z.enum(['open', 'closed', 'all']).default('open'),
});
const pageSchema = <S extends z.ZodType>(item: S) =>
  z.object({ items: z.array(item), page: z.number(), hasMore: z.boolean() });
export const githubOperations = {
  getRepository: operation(
    'Get a GitHub repository visible to the configured identity.',
    z.strictObject(repoInput),
    repositorySchema,
  ),
  searchRepositories: operation(
    'Search GitHub repositories.',
    z.strictObject({ query: queryInput, page: pageInput, limit: limitInput }),
    pageSchema(repositorySchema).extend({ total: z.number() }),
  ),
  listIssues: operation(
    'List repository issues, excluding pull requests. Pagination uses upstream page numbers.',
    listInput,
    pageSchema(issueSchema),
  ),
  listPullRequests: operation('List repository pull requests.', listInput, pageSchema(pullSchema)),
};
export function createGithubChannel({ http, credentials }: ChannelDependencies) {
  const request = <T>(path: string, schema: z.ZodType<T>, signal: AbortSignal) => {
    const token = credentials.get('github', 'GITHUB_TOKEN');
    return http.json(`https://api.github.com${path}`, schema, {
      signal,
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
  };
  return apiChannel(
    'github',
    'GitHub',
    githubOperations,
    async (name, raw, { signal }) => {
      if (name === 'searchRepositories') {
        const p = githubOperations.searchRepositories.input.parse(raw);
        const data = await request(
          `/search/repositories?${new URLSearchParams({ q: p.query, page: String(p.page), per_page: String(p.limit) })}`,
          z.object({ items: z.array(repositorySchema), total_count: z.number() }),
          signal,
        );
        return {
          items: data.items,
          total: data.total_count,
          page: p.page,
          hasMore: p.page * p.limit < Math.min(data.total_count, 1000),
        };
      }
      if (name === 'getRepository') {
        const p = githubOperations.getRepository.input.parse(raw);
        return request(
          `/repos/${encodeURIComponent(p.owner)}/${encodeURIComponent(p.repo)}`,
          repositorySchema,
          signal,
        );
      }
      const p = listInput.parse(raw);
      const endpoint = name === 'listIssues' ? 'issues' : 'pulls';
      const path = `/repos/${encodeURIComponent(p.owner)}/${encodeURIComponent(p.repo)}/${endpoint}?${new URLSearchParams({ page: String(p.page), per_page: String(p.limit), state: p.state })}`;
      if (name === 'listIssues') {
        const items = await request(path, z.array(issueSchema), signal);
        return {
          items: items.filter((item) => !item.pull_request),
          page: p.page,
          hasMore: items.length === p.limit,
        };
      }
      const items = await request(path, z.array(pullSchema), signal);
      return { items, page: p.page, hasMore: items.length === p.limit };
    },
    ({ signal }) => request('/repos/octocat/Hello-World', repositorySchema, signal),
    'Read one public repository using the current token if configured; search and private-repo grants are not certified.',
  );
}
