import { createWebChannel, webOperations } from './web/index.js';
import { createGithubChannel, githubOperations } from './github/index.js';
import { createRssChannel, rssOperations } from './rss/index.js';
import { createYoutubeChannel, youtubeOperations } from './youtube/index.js';
import { createRedditChannel, redditOperations } from './reddit/index.js';
import { createTwitterChannel, twitterOperations } from './twitter/index.js';
import { createSearchChannel, searchOperations } from './search/index.js';
import { createV2exChannel, v2exOperations } from './v2ex/index.js';
import { createLinkedinChannel, linkedinOperations } from './linkedin/index.js';
import type { ChannelDependencies } from './shared.js';

export const builtinOperations = {
  web: webOperations,
  github: githubOperations,
  rss: rssOperations,
  youtube: youtubeOperations,
  reddit: redditOperations,
  twitter: twitterOperations,
  search: searchOperations,
  v2ex: v2exOperations,
  linkedin: linkedinOperations,
};
export function builtinChannels(deps: ChannelDependencies) {
  return [
    createWebChannel(deps),
    createGithubChannel(deps),
    createRssChannel(deps),
    createYoutubeChannel(deps),
    createRedditChannel(deps),
    createTwitterChannel(deps),
    createSearchChannel(deps),
    createV2exChannel(deps),
    createLinkedinChannel(deps),
  ];
}
