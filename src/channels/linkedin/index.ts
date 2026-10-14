import { z } from 'zod';
import { apiChannel, operation, type ChannelDependencies } from '../shared.js';

export const linkedinOperations = {
  getProfile: operation(
    'Read the consenting LinkedIn identity through OpenID Connect. Other-user profiles and job search are unsupported.',
    z.strictObject({}),
    z.object({
      sub: z.string(),
      name: z.string().optional(),
      given_name: z.string().optional(),
      family_name: z.string().optional(),
      picture: z.string().optional(),
      email: z.string().optional(),
      email_verified: z.boolean().optional(),
    }),
  ),
};
export function createLinkedinChannel({ http, credentials }: ChannelDependencies) {
  const profile = (signal: AbortSignal) =>
    http.json('https://api.linkedin.com/v2/userinfo', linkedinOperations.getProfile.output, {
      signal,
      headers: {
        authorization: `Bearer ${credentials.require('linkedin', 'LINKEDIN_ACCESS_TOKEN')}`,
      },
    });
  return apiChannel(
    'linkedin',
    'LinkedIn (own profile)',
    linkedinOperations,
    async (_, __, { signal }) => profile(signal),
    ({ signal }) => profile(signal),
    'Consenting OIDC self profile only.',
    () => Boolean(credentials.get('linkedin', 'LINKEDIN_ACCESS_TOKEN')),
  );
}
