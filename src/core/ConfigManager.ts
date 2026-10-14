import { homedir } from 'node:os';
import { dirname, join, parse, resolve } from 'node:path';
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ConfigurationError } from './errors.js';

export const configSchema = z.strictObject({
  timeout: z.number().int().min(100).max(120000).default(15000),
  retries: z.number().int().min(0).max(5).default(2),
  fallback: z.boolean().default(true),
  enabledChannels: z.array(z.string().regex(/^[a-z][a-z0-9_-]*$/)).optional(),
  preferredBackends: z.record(z.string(), z.string()).default({}),
  auth: z.record(z.string(), z.string().regex(/^[A-Z_][A-Z0-9_]*$/)).default({}),
});
export type Config = z.output<typeof configSchema>;
export type ConfigInput = z.input<typeof configSchema>;
export function parseConfig(value: unknown): Config {
  const result = configSchema.safeParse(value);
  if (!result.success)
    throw new ConfigurationError(
      'Invalid WebWire settings. Secrets belong in environment variables; auth values must be environment variable names.',
    );
  return result.data;
}
export function configDirectory(
  platform = process.platform,
  env = process.env,
  home = homedir(),
): string {
  if (env.WEBWIRE_CONFIG_DIR) return resolve(env.WEBWIRE_CONFIG_DIR);
  if (platform === 'win32') return join(env.APPDATA || join(home, 'AppData', 'Roaming'), 'webwire');
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'webwire');
  return join(env.XDG_CONFIG_HOME || join(home, '.config'), 'webwire');
}
async function rejectSymlinks(path: string): Promise<void> {
  const absolute = resolve(path);
  let current = parse(absolute).root;
  for (const part of absolute.slice(current.length).split(/[\\/]/).filter(Boolean)) {
    current = join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink())
        throw new ConfigurationError('Configuration paths must not contain symbolic links.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}
export class ConfigManager {
  readonly path: string;
  constructor(directory = configDirectory()) {
    this.path = join(resolve(directory), 'config.json');
  }
  async load(): Promise<Config> {
    try {
      await rejectSymlinks(this.path);
      const file = await open(this.path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.size > 65536)
          throw new ConfigurationError('Configuration must be a regular file smaller than 64 KiB.');
        const buffer = Buffer.alloc(65537);
        const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
        if (bytesRead > 65536) throw new ConfigurationError('Configuration exceeds 64 KiB.');
        return parseConfig(JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')));
      } finally {
        await file.close();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return parseConfig({});
      if (error instanceof ConfigurationError) throw error;
      throw new ConfigurationError('Could not safely read WebWire configuration.');
    }
  }
  async save(input: ConfigInput): Promise<void> {
    const config = parseConfig(input);
    let temporary: string | undefined;
    try {
      await rejectSymlinks(this.path);
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      await rejectSymlinks(this.path);
      temporary = join(dirname(this.path), `.config-${randomUUID()}.tmp`);
      const file = await open(temporary, 'wx', 0o600);
      try {
        await file.writeFile(JSON.stringify(config, null, 2) + '\n', 'utf8');
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, this.path);
    } catch (error) {
      if (error instanceof ConfigurationError) throw error;
      throw new ConfigurationError('Could not safely write WebWire configuration.');
    } finally {
      if (temporary)
        await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT')
            throw new ConfigurationError('Could not clean up a temporary configuration file.');
        });
    }
  }
}
