#!/usr/bin/env bun
// Runs applications' own test suites against this checkout of DUWENDE, to find breaking changes before a release.
//
//   bun scripts/compat-matrix.js <app dir> [<app dir> …] [--baseline <duwende package dir>] [--keep] [--command "bun run test"]
//
// For each application: copies it to a temporary directory (the original is never touched), runs its tests with the
// DUWENDE version it has installed (the baseline), replaces node_modules/duwende with this checkout's package files,
// and runs the tests again. A test that passes on the baseline and fails on the candidate is a regression; the script
// lists them and exits 1 if there are any. Tests that already fail on the baseline are reported but not counted.
//
// The test command is the application's "test" script when it has one, else `bun test`; --command overrides it.
// Applications whose tests need services (a database, a mail sink) need them running, as for their own CI.
//
// --baseline <dir> installs that DUWENDE package for the baseline run instead of the one installed (for example the
// published release: `git archive main | tar -x -C /tmp/duwende-main`). Use it when an application's
// node_modules/duwende links to a working checkout, because then "installed" is whatever that checkout has checked
// out; the script warns when it sees links there. An application whose output shows no recognisable test results
// (the script reads `bun test` output) is reported as unverified, not as passing.
import { cpSync, existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const ROOT = path.resolve(import.meta.dir, '..');
const args = process.argv.slice(2);
const keep = args.includes('--keep');
const valueOf = (flag) => (args.indexOf(flag) >= 0 ? args[args.indexOf(flag) + 1] : null);
const override = valueOf('--command');
const baselinePackage = valueOf('--baseline') ? path.resolve(valueOf('--baseline')) : null;
const values = new Set(['--command', '--baseline'].map((flag) => args.indexOf(flag)).filter((index) => index >= 0).map((index) => index + 1));
const apps = args.filter((arg, index) => !arg.startsWith('--') && !values.has(index));

if (!apps.length) {
  console.error('usage: bun scripts/compat-matrix.js <app dir> [<app dir> …] [--keep] [--command "<test command>"]');
  process.exit(2);
}

const candidateVersion = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

/** Run the tests; returns { pass, fail, failed: Set<test name>, output }. */
async function runTests(dir) {
  const pkg = existsSync(path.join(dir, 'package.json')) ? JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) : {};
  const command = override || (pkg.scripts?.test ? 'bun run test' : 'bun test');
  const child = Bun.spawn(['sh', '-c', command], { cwd: dir, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, CI: '1' } });
  const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  await child.exited;
  const output = `${stdout}\n${stderr}`;
  const count = (word) => Number(output.match(new RegExp(`^\\s*(\\d+) ${word}$`, 'm'))?.[1] ?? 0);
  const failed = new Set([...output.matchAll(/^\(fail\) (.+?)(?: \[[\d.]+m?s\])?$/gm)].map((match) => match[1].trim()));
  return { pass: count('pass'), fail: count('fail'), failed, output, command, exitCode: child.exitCode };
}

/** Replace node_modules/duwende with the package files from `from` (removes links in the copy, never their targets). */
function install(dir, from) {
  const target = path.join(dir, 'node_modules', 'duwende');
  if (!existsSync(target) && !lstatSync(target, { throwIfNoEntry: false })) throw new Error('node_modules/duwende not found; install the application\'s dependencies first');
  rmSync(target, { recursive: true, force: true });
  const files = ['package.json', ...JSON.parse(readFileSync(path.join(from, 'package.json'), 'utf8')).files.filter((file) => !file.includes('*'))];
  files.filter((file) => existsSync(path.join(from, file))).forEach((file) => cpSync(path.join(from, file), path.join(target, file), { recursive: true }));
}

/** Whether node_modules/duwende is, or contains, links (to a working checkout, typically). */
const linked = (dir) => {
  const target = path.join(dir, 'node_modules', 'duwende');
  const info = lstatSync(target, { throwIfNoEntry: false });
  if (!info) return false;
  if (info.isSymbolicLink()) return true;
  return readdirSync(target).some((file) => lstatSync(path.join(target, file)).isSymbolicLink());
};

const installedVersion = (dir) => {
  const file = path.join(dir, 'node_modules', 'duwende', 'package.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).version : 'none';
};

const results = [];
for (const app of apps) {
  const source = path.resolve(app);
  const work = mkdtempSync(path.join(tmpdir(), 'duwende-compat-'));
  console.log(`\n▶ ${source}`);
  try {
    cpSync(source, work, { recursive: true, filter: (file) => !file.split(path.sep).includes('.git') });
    if (baselinePackage) install(work, baselinePackage);
    else if (linked(work)) console.log('  ! node_modules/duwende links to a working checkout, so the baseline is whatever it has checked out; pass --baseline');
    const baselineVersion = installedVersion(work);
    const baseline = await runTests(work);
    console.log(`  baseline  duwende ${baselineVersion}: ${baseline.pass} pass, ${baseline.fail} fail  (${baseline.command})`);
    if (baseline.pass + baseline.fail === 0) {
      console.log('  ? no test results recognised (the script reads `bun test` output): unverified');
      results.push({ app: source, regressions: 0, unverified: true, work });
      continue;
    }
    install(work, ROOT);
    const candidate = await runTests(work);
    console.log(`  candidate duwende ${candidateVersion}: ${candidate.pass} pass, ${candidate.fail} fail`);
    const regressions = [...candidate.failed].filter((name) => !baseline.failed.has(name));
    const lostTests = Math.max(0, (baseline.pass + baseline.fail) - (candidate.pass + candidate.fail));
    regressions.forEach((name) => console.log(`  ✗ regression: ${name}`));
    if (lostTests) console.log(`  ✗ ${lostTests} test(s) did not run on the candidate (a file failed to load?)`);
    if (!regressions.length && !lostTests) console.log('  ✓ no regressions');
    if (regressions.length || lostTests) console.log(`  candidate output kept for inspection in ${work}`);
    results.push({ app: source, regressions: regressions.length + lostTests, work });
  } catch (error) {
    console.log(`  ! could not run: ${error.message}`);
    results.push({ app: source, regressions: 0, error: error.message, work });
  } finally {
    const keepIt = keep || results.at(-1)?.regressions > 0;
    if (!keepIt) rmSync(work, { recursive: true, force: true });
  }
}

const broken = results.filter((result) => result.regressions > 0 || result.error);
const unverified = results.filter((result) => result.unverified);
const clean = results.length - broken.length - unverified.length;
console.log(`\n${clean}/${results.length} application(s) verified without regressions against duwende ${candidateVersion}` +
  `${unverified.length ? `; ${unverified.length} unverified (no test results)` : ''}${broken.length ? `; ${broken.length} with regressions or errors` : ''}`);
process.exit(broken.length ? 1 : 0);
