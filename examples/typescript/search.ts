import { WebWire, type OperationOutput } from 'agent-webwire';

const pulse = new WebWire();
const result: OperationOutput<'github', 'searchRepositories'> =
  await pulse.github.searchRepositories('AI agents', { limit: 5 });
for (const repository of result.items) console.log(repository.full_name, repository.html_url);

// Requires YOUTUBE_API_KEY or YOUTUBE_ACCESS_TOKEN:
// const videos = await pulse.youtube.search('AI agents');
