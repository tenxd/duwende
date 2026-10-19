// The CLI's generated resources must load: the server imports a resource file and reads the export named exactly
// like the file.
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const CLI = path.resolve(import.meta.dir, '..', 'cli.js');
const work = mkdtempSync(path.join(tmpdir(), 'duwende-cli-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

const run = (...args) => {
  const result = Bun.spawnSync(['bun', CLI, ...args], { cwd: work, stdout: 'pipe', stderr: 'pipe' });
  return { code: result.exitCode, out: result.stdout.toString(), err: result.stderr.toString() };
};
const exportsOf = (file) => new Bun.Transpiler({ loader: 'js' }).scan(readFileSync(file, 'utf8')).exports;

describe('duwende resource', () => {
  test.each([
    ['user', 'User'],
    ['user_profile', 'UserProfile'],
    ['UserProfile', 'UserProfileResource'],
    ['knowledgeBase', 'KnowledgeBase'],
  ])('%s: the export is named exactly like the file, and the class differs from it', (name, className) => {
    const result = run('resource', name, 'api');
    expect(result.code).toBe(0);
    const file = path.join(work, 'services', 'api', 'resources', `${name}.js`);
    expect(exportsOf(file).sort()).toEqual([className, name].sort());
    expect(readFileSync(file, 'utf8')).toContain(`export const ${name} = ${className};`);
  });

  test('a name that works but is not snake_case gets a note', () => {
    expect(run('resource', 'OrderLine', 'api').err).toContain('order_line');
    expect(run('resource', 'order_line', 'api').err).toBe('');
  });

  test('a name that cannot be an export is refused, with a suggestion', () => {
    const result = run('resource', 'user-profile', 'api');
    expect(result.code).toBe(1);
    expect(result.err).toContain('user_profile');
    expect(run('resource', '2fa', 'api').code).toBe(1);
  });

  test('init still creates a loadable example', () => {
    expect(run('init').code).toBe(0);
    expect(exportsOf(path.join(work, 'services', 'example', 'resources', 'example.js')).sort()).toEqual(['Example', 'example']);
  });
});
