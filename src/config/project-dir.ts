import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

/** Ilse's folder for a project, outside the project: ~/.ilse/projects/<name>-<hash> */
export function projectDir(cwd: string, home = homedir()): string {
  const slug = basename(cwd).replace(/[^\w.-]/g, '_');
  const hash = createHash('sha1').update(cwd).digest('hex').slice(0, 6);
  return join(home, '.ilse', 'projects', `${slug}-${hash}`);
}
