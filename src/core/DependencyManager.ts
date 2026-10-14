import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { health } from './types.js';

/** Optional plugins can use argument-array execution; no shell or raw stderr is exposed. */
export class DependencyManager {
  async probe(executable: string, args: readonly string[] = ['--version'], signal?: AbortSignal) {
    try {
      await promisify(execFile)(executable, [...args], {
        timeout: 5000,
        maxBuffer: 65536,
        shell: false,
        windowsHide: true,
        signal,
      });
      return health(
        'ready',
        'Executable probe succeeded.',
        'Only the supplied probe command was checked.',
      );
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return health(
        'unavailable',
        code === 'ENOENT'
          ? 'Executable or its interpreter is missing.'
          : 'Executable probe failed or timed out.',
        'Executable availability.',
        'Install or repair the optional tool explicitly; WebPulse will not install system software.',
      );
    }
  }
}
