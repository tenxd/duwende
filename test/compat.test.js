// Compatibility: a 0.1 configuration behaves as 0.1 did, and each new option does what it says.
// Requests go through Server.handleRequest without opening a port.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { Server, checkBun, compareVersions, MIN_BUN } from '../server.js';
import { Resource } from '../resource.js';
import { Tool } from '../tool.js';
import { SessionLogger } from '../sessionLogger.js';
import * as duwende from '../index.js';
import { basePath, link, linkContext, origin, root, routedService } from '../links.js';

const ROOT = path.resolve(import.meta.dir, '..');
const FIXTURE = path.join(import.meta.dir, 'compat');
const original = process.cwd();

beforeAll(() => {
  // Fixtures import 'duwende' as applications do: a shim package re-exporting this checkout (a symlink to the
  // checkout would contain itself, which Bun will not resolve).
  const shim = path.join(FIXTURE, 'node_modules', 'duwende');
  mkdirSync(shim, { recursive: true });
  writeFileSync(path.join(shim, 'package.json'), JSON.stringify({ name: 'duwende', type: 'module', main: 'index.js' }));
  writeFileSync(path.join(shim, 'index.js'), `export * from '${path.join(ROOT, 'index.js')}';\n`);
  process.chdir(FIXTURE);
});
afterAll(() => {
  process.chdir(original);
  rmSync(path.join(FIXTURE, 'tmp'), { recursive: true, force: true });
  rmSync(path.join(FIXTURE, 'logs'), { recursive: true, force: true });
});

/** A server with the fixture config plus overrides in global (and logging). */
async function server(global = {}, logging = { enabled: false }) {
  const instance = new Server();
  await instance.loadConfig();
  instance.config.global = { ...instance.config.global, isolateInstances: true, ...global };
  instance.config.logging = logging;
  instance.logger = new SessionLogger(logging);
  instance.instances = {};
  Tool.validation = global.toolValidation || 'warn';
  await instance.loadTools();
  return instance;
}

const call = async (instance, method, url, { json = true, headers = {} } = {}) => {
  const response = await instance.handleRequest(new Request(url, { method, headers: { ...(json ? { accept: 'application/json' } : {}), ...headers } }));
  const text = await response.text();
  return { status: response.status, text, headers: response.headers, body: (() => { try { return JSON.parse(text); } catch { return text; } })() };
};

const quietly = async (fn) => {
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  try { return { result: await fn(), errors }; } finally { console.error = original; }
};

describe('the Bun requirement', () => {
  test('older Bun is refused with the reason; 1.4.3 and later are accepted', () => {
    expect(MIN_BUN).toBe('1.4.3');
    expect(() => checkBun('1.3.14')).toThrow('DUWENDE needs Bun 1.4.3 or later (this is Bun 1.3.14)');
    expect(() => checkBun('1.2.21')).toThrow('PostgreSQL client');
    expect(() => checkBun('1.4.3')).not.toThrow();
    expect(() => checkBun('1.10.0')).not.toThrow();
    expect(() => checkBun('2.0.0')).not.toThrow();
    expect(() => checkBun()).not.toThrow(); // the Bun running this suite
  });

  test('versions compare numerically; pre-release suffixes are ignored', () => {
    expect(compareVersions('1.10.0', '1.4.3')).toBe(1);
    expect(compareVersions('1.4.3', '1.4.3')).toBe(0);
    expect(compareVersions('1.4.2', '1.4.3')).toBe(-1);
    expect(compareVersions('1.4.3-canary.1', '1.4.3')).toBe(0);
  });
});

describe('0.1 behaviour by default', () => {
  test('an application method named dispatch, this.log and this.logging still work', async () => {
    const s = await server();
    const posted = await call(s, 'POST', 'http://localhost/app/unit/42');
    expect(posted.body).toEqual({ result: 'dispatched to 42', logging: true });
  });

  test('a resource importing the framework relative to its tmp/ copy still loads (copy is the default)', async () => {
    const s = await server();
    expect((await call(s, 'GET', 'http://localhost/app/legacy/1')).body).toEqual({ ok: true });
  });

  test('a method the resource does not implement answers 404, an unknown HTTP method 405 (status codes as 0.1)', async () => {
    const s = await server();
    expect((await call(s, 'GET', 'http://localhost/app/empty/1')).status).toBe(404);
    expect((await call(s, 'PUT', 'http://localhost/app/empty/1')).status).toBe(404);
    expect((await call(s, 'HEAD', 'http://localhost/app/empty/1')).status).toBe(405);
  });

  test('a null body is JSON null; path segments reach resources raw', async () => {
    const s = await server();
    const empty = await call(s, 'GET', 'http://localhost/app/nothing/1');
    expect([empty.text, empty.headers.get('content-type')]).toEqual(['null', 'application/json']);
    const raw = await call(s, 'GET', 'http://localhost/app/unit/a%20b/c%2Fd');
    expect(raw.body).toMatchObject({ id: 'a%20b', rest: 'c%2Fd' });
  });

  test('the shared Resource.instances registry can still be reset by assignment', async () => {
    const s = new Server();
    await s.loadConfig();
    Resource.instances = {};
    await call(s, 'GET', 'http://localhost/app/unit/1');
    expect(Object.keys(Resource.instances)).toEqual(['localhost/app/unit']);
    expect(Resource.instances['localhost/app/unit'].instance.name).toBe('unit');
    Resource.instances = {};
  });
});

describe('the framework\'s own 404 and 405', () => {
  test('JSON requests get JSON bodies; pages keep the 0.1 text', async () => {
    const s = await server();
    const json = await call(s, 'GET', 'http://localhost/app/empty/1');
    expect([json.status, json.headers.get('content-type'), json.body]).toEqual([404, 'application/json', { error: 'not_found' }]);
    const suffix = await call(s, 'GET', 'http://localhost/app/empty.json/1', { json: false });
    expect(suffix.body).toEqual({ error: 'not_found' });
    const page = await call(s, 'GET', 'http://localhost/app/empty/1', { json: false });
    expect([page.status, page.text]).toEqual([404, 'Not Found']);
    const unknownVerb = await call(s, 'HEAD', 'http://localhost/app/empty/1');
    expect([unknownVerb.status, unknownVerb.headers.get('content-type')]).toEqual([405, 'application/json']);
    const unknownVerbPage = await call(s, 'HEAD', 'http://localhost/app/empty/1', { json: false });
    expect(unknownVerbPage.headers.get('content-type')).toStartWith('text/plain');
  });

  test('with strictMethods the 405 follows the same rule', async () => {
    const s = await server({ strictMethods: true });
    expect((await call(s, 'PUT', 'http://localhost/app/empty/1')).body).toEqual({ error: 'method_not_allowed' });
    const page = await call(s, 'PUT', 'http://localhost/app/empty/1', { json: false });
    expect([page.status, page.text]).toEqual([405, 'Method Not Allowed']);
  });

  test('an unknown resource: JSON for JSON requests, the 0.1 text for pages', async () => {
    const s = await server();
    const json = await call(s, 'GET', 'http://localhost/app/nope');
    expect([json.status, json.headers.get('content-type'), json.body]).toEqual([404, 'application/json', { error: 'not_found' }]);
    expect((await call(s, 'GET', 'http://localhost/app/nope.json', { json: false })).body).toEqual({ error: 'not_found' });
    const page = await call(s, 'GET', 'http://localhost/app/nope', { json: false });
    expect([page.status, page.text]).toEqual([404, 'Resource not found']);
  });

  test('responses an application writes itself are untouched', async () => {
    const s = await server();
    const own = await call(s, 'GET', 'http://localhost/app/nothing/1');
    expect(own.text).toBe('null');
  });
});

describe('safer defaults that are invisible to applications', () => {
  test('a thrown error answers a neutral 500 and is logged; debugErrors restores the 0.1 body', async () => {
    const s = await server();
    const { result, errors } = await quietly(() => call(s, 'GET', 'http://localhost/app/boom/1'));
    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: 'server_error' });
    expect(errors.join(' ')).toContain('secret detail');
    const debug = await server({ debugErrors: true });
    const detailed = await quietly(() => call(debug, 'GET', 'http://localhost/app/boom/1'));
    expect(detailed.result.body).toMatchObject({ error: 'Internal Server Error', message: 'secret detail' });
  });

  test('unknown paths answer a quiet 404', async () => {
    const s = await server();
    const { result, errors } = await quietly(async () => [
      await call(s, 'GET', 'http://localhost/favicon.ico', { json: false }),
      await call(s, 'GET', 'http://localhost/app/nope'),
      await call(s, 'GET', 'http://localhost/../etc/passwd'),
    ]);
    expect(result.map((r) => r.status)).toEqual([404, 404, 404]);
    expect(errors).toEqual([]);
  });

  test('cached instances are capped, least recently used dropped first; made-up hosts reuse one module', async () => {
    const s = await server({ maxInstances: 3 });
    for (const host of ['a', 'b', 'c', 'd', 'e']) await call(s, 'GET', `http://${host}.test/app/unit/1`);
    expect(Object.keys(s.instances).sort()).toEqual(['c.test/app/unit', 'd.test/app/unit', 'e.test/app/unit']);
    const classes = new Set(Object.values(s.instances).map((entry) => entry.instance.constructor));
    expect(classes.size).toBe(1);
  });

  test('a session cookie is never set as "null" when logging is off', async () => {
    const s = await server();
    const missing = await call(s, 'GET', 'http://localhost/app/nope');
    expect(missing.headers.get('set-cookie')).toBeNull();
  });
});

describe('opt-in options', () => {
  test('resourceImport direct: a resource imports a module relative to its own file', async () => {
    const s = await server({ resourceImport: 'direct' });
    expect((await call(s, 'GET', 'http://localhost/app/shared/team')).body).toEqual({ message: 'hello team' });
    const copy = await server();
    const { result } = await quietly(() => call(copy, 'GET', 'http://localhost/app/shared/team'));
    expect(result.status).toBe(404);
  });

  test('strictMethods answers an unimplemented method with 405', async () => {
    const s = await server({ strictMethods: true });
    expect((await call(s, 'GET', 'http://localhost/app/empty/1')).status).toBe(405);
  });

  test('decodePath decodes segments', async () => {
    const s = await server({ decodePath: true });
    expect((await call(s, 'GET', 'http://localhost/app/unit/a%20b')).body.id).toBe('a b');
  });

  test('hosts: a mapped host starts at the resource; "*" maps every other host; unmapped hosts keep the prefix', async () => {
    const mapped = await server({ hosts: { 'shop.test': 'app' } });
    expect((await call(mapped, 'GET', 'http://shop.test/unit/7')).body.id).toBe('7');
    expect((await call(mapped, 'GET', 'http://other.test/app/unit/8')).body.id).toBe('8');
    const wildcard = await server({ hosts: { '*': 'app' } });
    expect((await call(wildcard, 'GET', 'http://any.test/unit/9')).body.id).toBe('9');
  });

  test('static serves files under its prefix and nothing outside its directory', async () => {
    const s = await server({ static: { prefix: '/assets', dir: 'public' } });
    expect((await call(s, 'GET', 'http://localhost/assets/hello.txt', { json: false })).text).toBe('static hello\n');
    expect((await call(s, 'GET', 'http://localhost/assets/..%2Fconfig.json', { json: false })).status).toBe(404);
    expect((await call(s, 'GET', 'http://localhost/assets/%E0%A4%A', { json: false })).status).toBe(404);
  });

  test('toolPaths adds tools from more directories without replacing loaded ones', async () => {
    const extra = mkdtempSync(path.join(tmpdir(), 'duwende-tools-'));
    writeFileSync(path.join(extra, 'extra_tool.js'), `export class ExtraTool { static about() { return 'x'; } static init_schema() { return {}; } static in_schema() { return {}; } static out_schema() { return {}; } }\nexport const extra_tool = ExtraTool;\n`);
    await server({ toolPaths: [extra] });
    expect(Resource.tools.extra_tool.path).toBe(extra);
    expect(Resource.tools.needy_tool).toBeDefined();
    rmSync(extra, { recursive: true, force: true });
  });

  test('tool validation: warn reports once, strict throws, off is silent', async () => {
    await server();
    const NeedyTool = Resource.tools.needy_tool.tool;
    const warnings = [];
    const warn = console.warn;
    console.warn = (message) => warnings.push(message);
    try {
      Tool.validation = 'warn';
      new NeedyTool({});
      new NeedyTool({});
      new NeedyTool({ name: 'ok', size: 3 });
      expect(warnings.filter((m) => m.includes('missing required parameter: name'))).toHaveLength(1);
      expect(warnings.some((m) => m.includes('"integer"'))).toBe(true);
      Tool.validation = 'strict';
      expect(() => new NeedyTool({})).toThrow('missing required parameter: name');
      expect(() => new NeedyTool({ name: 5 })).toThrow('must be string');
      Tool.validation = 'off';
      const before = warnings.length;
      new NeedyTool({ name: 5 });
      expect(warnings.length).toBe(before);
    } finally {
      console.warn = warn;
      Tool.validation = 'warn';
    }
  });

  test('logging: path-only or allowlisted query, daily files, retention, cookie modes', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'duwende-logs-'));
    const pathOnly = new SessionLogger({ query: false, sessionDir: dir });
    expect(pathOnly.loggedUrl('http://x.test/a/b?token=secret&q=1')).toBe('http://x.test/a/b');
    const allow = new SessionLogger({ query: ['q'], sessionDir: dir });
    expect(allow.loggedUrl('http://x.test/a?token=secret&q=1')).toBe('http://x.test/a?q=1');
    expect(new SessionLogger({}).loggedUrl('http://x.test/a?q=1')).toBe('http://x.test/a?q=1');

    const s = await server({}, { enabled: true, rotate: 'daily', query: false, sessionDir: dir, sessionCookie: 'always' });
    const first = await call(s, 'GET', 'http://localhost/app/unit/1?token=secret');
    await call(s, 'GET', 'http://localhost/app/unit/2');
    expect(first.headers.get('set-cookie')).toContain('session_id=');
    const files = readdirSync(dir);
    expect(files).toEqual([`${new Date().toISOString().slice(0, 10)}.log`]);
    expect(await Bun.file(path.join(dir, files[0])).text()).not.toContain('secret');

    writeFileSync(path.join(dir, 'old.log'), '{}\n');
    const old = (Date.now() - 40 * 86400000) / 1000;
    utimesSync(path.join(dir, 'old.log'), old, old);
    const retained = new SessionLogger({ sessionDir: dir, retainDays: 30 });
    expect(await retained.prune()).toBe(1);
    expect(readdirSync(dir)).not.toContain('old.log');

    const never = await server({}, { enabled: true, sessionDir: dir, sessionCookie: 'never' });
    expect((await call(never, 'GET', 'http://localhost/app/nope')).headers.get('set-cookie')).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });

  test('isolateInstances keeps a server\'s instances out of the shared registry', async () => {
    Resource.instances = {};
    const s = await server();
    await call(s, 'GET', 'http://localhost/app/unit/1');
    expect(Object.keys(Resource.instances)).toEqual([]);
    expect(Object.keys(s.instances)).toEqual(['localhost/app/unit']);
  });
});

describe('links, instances per service, unknown hosts (0.3.1)', () => {
  const global = {
    hosts: { 'example.com': 'shop', 'www.example.com': 'shop', 'admin.example.com': 'admin' },
    origins: { shop: 'https://example.com', admin: 'https://admin.example.com' },
  };
  const ctx = { config: { global }, service: 'shop', hostname: 'stale.example.net' };
  const at = (url) => ({ request: new Request(url) });

  test('the helpers are exported from duwende', () => {
    expect([duwende.basePath, duwende.link, duwende.origin, duwende.routedService].every((fn) => typeof fn === 'function')).toBe(true);
  });

  test('basePath: no prefix on a host routed to the service, the prefix elsewhere; the request decides the host', () => {
    expect(basePath(ctx, 'shop', at('https://www.example.com/x'))).toBe('');
    expect(basePath(ctx, 'admin', at('https://www.example.com/x'))).toBe('/admin');
    expect(basePath({ config: { global: {} }, service: 'shop' }, undefined, at('http://localhost:1112/shop'))).toBe('/shop');
    expect(routedService(global, 'nope.example.com')).toBeUndefined();
    expect(routedService({ hosts: { '*': 'shop' } }, 'any.test')).toBe('shop');
  });

  test('link: relative on the current host, absolute on another, origins first, prefix for the target host', () => {
    expect(link(ctx, '/item/42', at('https://www.example.com/'))).toBe('/item/42');
    expect(link(ctx, 'orders?page=2', { service: 'admin', ...at('https://example.com/') })).toBe('https://admin.example.com/orders?page=2');
    expect(link(ctx, 'item/42', { absolute: true })).toBe('https://example.com/item/42');
    const dev = { config: { global: { origins: { shop: 'http://localhost:1112' } } }, service: 'shop' };
    expect(link(dev, 'item/42', at('http://localhost:1112/shop/x'))).toBe('/shop/item/42');
    expect(link(dev, 'item/42', { absolute: true })).toBe('http://localhost:1112/shop/item/42');
  });

  test('origin: configured first, else https plus a hostname the map lists (the current one if listed)', () => {
    expect(origin(ctx, 'admin')).toBe('https://admin.example.com');
    const unconfigured = { config: { global: { hosts: global.hosts } }, service: 'shop' };
    expect(origin(unconfigured, 'shop', at('http://www.example.com:8080/'))).toBe('https://www.example.com');
    expect(origin(unconfigured, 'admin', at('http://example.com:8080/'))).toBe('https://admin.example.com');
  });

  test('absolute links never come from a Host header', () => {
    // A client-chosen Host (no refuseUnknownHosts, "*" routes everything): links still use configured hosts only.
    const open = { config: { global: { hosts: { 'example.com': 'shop', '*': 'shop' } } }, service: 'shop' };
    expect(link(open, 'reset?t=1', { absolute: true, ...at('https://evil.test/reset') })).toBe('https://example.com/reset?t=1');
    // One instance per service keeps the first request's hostname; without a request it must not be used.
    const stale = { config: { global: { hosts: { 'example.com': 'shop' } } }, service: 'shop', hostname: 'evil.test' };
    expect(link(stale, 'reset', { absolute: true })).toBe('https://example.com/reset');
    // No origin and no mapped host: refuse rather than guess, with or without a request.
    const none = { config: { global: {} }, service: 'shop', hostname: 'evil.test' };
    expect(() => link(none, 'reset', { absolute: true })).toThrow('set global.origins.shop');
    expect(() => link(none, 'reset', { absolute: true, ...at('https://evil.test/') })).toThrow('never built from the Host header');
    expect(() => origin(none)).toThrow();
    // Relative links need no origin.
    expect(link(none, 'reset', at('https://evil.test/'))).toBe('/shop/reset');
  });

  test('root: a base without a trailing slash, relative or absolute', () => {
    expect(root(ctx, 'shop', at('https://example.com/'))).toBe('');
    expect(root(ctx, 'shop', { absolute: true })).toBe('https://example.com');
    const dev = { config: { global: { origins: { shop: 'http://localhost:1112/' } } }, service: 'shop' };
    expect(root(dev, 'shop', { absolute: true })).toBe('http://localhost:1112/shop');
    expect(root(dev, 'shop', at('http://localhost:1112/shop/x'))).toBe('/shop');
    expect(link(ctx, '', { absolute: true })).toBe('https://example.com/');
  });

  test('linkContext: plain JSON roots for browser code; untrusted services left out', () => {
    const page = linkContext(ctx, at('https://www.example.com/'));
    expect(page).toEqual({ service: 'shop', roots: { shop: '', admin: 'https://admin.example.com' } });
    expect(JSON.parse(JSON.stringify(page))).toEqual(page);
    const partial = { config: { global: { hosts: { 'example.com': 'shop' } } }, service: 'blog' };
    expect(linkContext(partial, { ...at('https://example.com/'), services: ['shop', 'blog', 'admin'] }).roots).toEqual({ shop: '', blog: '/blog', admin: '/admin' });
  });

  test('a mapped service without an origins entry is reported at start; configured ones are not', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'duwende-origins-'));
    writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
      global: { hosts: { 'a.test': 'app', 'b.test': 'admin' }, origins: { admin: 'https://b.test' } }, logging: { enabled: false },
    }));
    const warnings = [];
    const warn = console.warn;
    const before = process.cwd();
    console.warn = (message) => warnings.push(String(message));
    try {
      process.chdir(dir);
      await new Server().loadConfig();
    } finally {
      process.chdir(before);
      console.warn = warn;
      rmSync(dir, { recursive: true, force: true });
    }
    const line = warnings.find((message) => message.includes('without global.origins'));
    expect(line).toContain('"app"');
    expect(line).not.toContain('"admin"');
  });

  test('a resource works as the context', async () => {
    const s = await server({ hosts: { 'shop.test': 'app' } });
    await call(s, 'GET', 'http://shop.test/unit/1');
    const instance = Object.values(s.instances)[0].instance;
    expect(link(instance, 'unit/2')).toBe('/unit/2');
    // On a host the map doesn't list, a link to a service the map serves elsewhere goes to that host.
    expect(link(instance, 'unit/2', at('http://other.test/app/unit/1'))).toBe('https://shop.test/unit/2');
  });

  test('instanceKey service: one instance for every host; made-up hosts create none', async () => {
    const s = await server({ instanceKey: 'service' });
    for (const host of ['a.test', 'b.test', 'c.test']) await call(s, 'GET', `http://${host}/app/unit/1`);
    expect(Object.keys(s.instances)).toEqual(['app/unit']);
    const byHost = await server();
    for (const host of ['a.test', 'b.test']) await call(byHost, 'GET', `http://${host}/app/unit/1`);
    expect(Object.keys(byHost.instances).length).toBe(2);
  });

  test('a host listed with null is known but not routed: it keeps the prefix, even beside "*"', async () => {
    const hosts = { 'main.test': null, 'shop.test': 'app', '*': 'app' };
    const s = await server({ hosts, refuseUnknownHosts: true });
    expect((await call(s, 'GET', 'http://main.test/app/unit/1')).body.id).toBe('1');
    expect((await call(s, 'GET', 'http://shop.test/unit/2')).body.id).toBe('2');
    expect((await call(s, 'GET', 'http://other.test/unit/3')).body.id).toBe('3');
    const strict = await server({ hosts: { 'main.test': null, 'shop.test': 'app' }, refuseUnknownHosts: true });
    expect((await call(strict, 'GET', 'http://main.test/app/unit/1')).status).toBe(200);
    expect((await call(strict, 'GET', 'http://evil.test/app/unit/1')).status).toBe(421);
    const context = { config: { global: { hosts: { 'main.test': null, 'shop.test': 'app' } } }, service: 'app' };
    expect(routedService(context.config.global, 'main.test')).toBeNull();
    expect(link(context, 'unit/1', at('http://main.test/'))).toBe('https://shop.test/unit/1');
    expect(linkContext(context, at('http://main.test/')).roots).toEqual({ app: 'https://shop.test' });
    const { servicesWithoutOrigins } = await import('../links.js');
    expect(servicesWithoutOrigins({ hosts: { 'main.test': null, 'shop.test': 'app' } })).toEqual(['app']);
  });

  test('refuseUnknownHosts: 421 for hosts the map does not list, JSON or text; off by default; "*" accepts all', async () => {
    const s = await server({ hosts: { 'shop.test': 'app' }, refuseUnknownHosts: true });
    expect((await call(s, 'GET', 'http://shop.test/unit/1')).status).toBe(200);
    const json = await call(s, 'GET', 'http://evil.test/app/unit/1');
    expect([json.status, json.body]).toEqual([421, { error: 'unknown_host' }]);
    const page = await call(s, 'GET', 'http://evil.test/app/unit/1', { json: false });
    expect([page.status, page.text]).toEqual([421, 'Unknown host']);
    expect(Object.keys(s.instances)).toEqual(['shop.test/app/unit']);
    const off = await server({ hosts: { 'shop.test': 'app' } });
    expect((await call(off, 'GET', 'http://evil.test/app/unit/1')).status).toBe(200);
    const wildcard = await server({ hosts: { '*': 'app' }, refuseUnknownHosts: true });
    expect((await call(wildcard, 'GET', 'http://any.test/unit/1')).status).toBe(200);
    const noMap = await server({ refuseUnknownHosts: true });
    expect((await call(noMap, 'GET', 'http://any.test/app/unit/1')).status).toBe(200);
  });
});
