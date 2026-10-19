import { Resource } from './resource.js';
import { Tool } from './tool.js';
import { readdir, readFile } from 'fs/promises';
import { existsSync, statSync } from 'fs';
import path from 'path';
import { SessionLogger } from './sessionLogger.js';

/**
 * DUWENDE server.
 *
 * Compatibility: with a 0.1 config.json the server behaves as 0.1 did. New options, all in `global` unless noted:
 *   hosts: { "<hostname>": "<service>", "*": "<service>" } — on a mapped host the path starts at the resource
 *          (/{resource}/{id}); "*" maps every other host. Unmapped hosts keep /{service}/{resource}/{id}.
 *   toolPaths: [dirs] loaded after tools/ (a name already loaded is not replaced)
 *   static: { prefix: "/assets", dir: "public" } — files served by the server itself (development; use the proxy in production)
 *   decodePath: true — URL-decode path segments before they reach resources (0.1 passes them raw)
 *   isolateInstances: true — this server keeps its own resource instances instead of the shared Resource.instances
 *   toolValidation: 'warn' (default) | 'strict' | 'off' — see Tool
 * and in `logging` the options described in SessionLogger. See CHANGELOG.md.
 */
// The oldest Bun this release runs on. On Bun 1.3.14, under concurrent load, Bun's built-in PostgreSQL client (Bun.SQL)
// handed queries other queries' results: text parsed as JSON, rows with values that do not exist, reads failing with
// "current transaction is aborted". Turning off prepared statements did not help; Bun 1.4.3 is clean.
export const MIN_BUN = '1.4.3';

/** Compare dotted versions numerically: -1, 0 or 1. Pre-release suffixes are ignored. */
export const compareVersions = (a, b) => {
  const parts = (v) => String(v).split('-')[0].split('.').map((n) => Number(n) || 0);
  const [x, y] = [parts(a), parts(b)];
  const length = Math.max(x.length, y.length);
  for (let i = 0; i < length; i += 1) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0) ? -1 : 1;
  }
  return 0;
};

/** Throws when the running Bun is older than MIN_BUN. */
export const checkBun = (version = Bun.version) => {
  if (compareVersions(version, MIN_BUN) < 0) {
    throw new Error(`DUWENDE needs Bun ${MIN_BUN} or later (this is Bun ${version}): under concurrent load, older Bun's built-in PostgreSQL client can return one query's results to another. Upgrade with \`bun upgrade\`.`);
  }
};

export class Server {
  constructor() {
    this.config = {};
    this.server = null;
    this.logger = null;
    this.instances = null;
  }

  async loadConfig() {
    // Every way of starting a server loads its config first, including applications that call Bun.serve themselves.
    checkBun();
    try {
      const configFile = await readFile('config.json', 'utf8');
      const parsed = JSON.parse(configFile);
      if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) {
        throw new Error('Config must be a single top-level JSON object');
      }
      this.config = parsed;
    } catch (error) {
      console.warn(`Config error: ${error.message}. Using empty configuration.`);
    }

    // Initialize logger AFTER config is loaded
    this.logger = new SessionLogger(this.config.logging || {});
    const global = this.config.global || {};
    Resource.debug = this.config.logging?.level === 'debug';
    Tool.validation = ['warn', 'strict', 'off'].includes(global.toolValidation) ? global.toolValidation : 'warn';
    this.instances = global.isolateInstances === true ? {} : null;
    if (!this.config.logging) {
      console.warn('[duwende] request logging is on because config.json has no "logging" block; set logging.enabled explicitly (the default becomes off in 1.0)');
    }
  }

  async loadTools() {
    const dirs = ['tools', ...(this.config.global?.toolPaths || [])];
    for (const dir of dirs) {
      const basePath = path.resolve(process.cwd(), dir);
      const files = await readdir(basePath).catch((error) => {
        if (dir === 'tools') console.error(`Error loading tools:`, error);
        else console.error(`Error loading tools from ${dir}: ${error.message}`);
        return [];
      });
      for (const file of files) {
        if (!file.endsWith('.js')) continue;
        if (file.endsWith('.test.js')) continue;
        const name = file.slice(0, -3); // Remove .js extension
        if (Resource.tools[name] && Resource.tools[name].path && Resource.tools[name].path !== basePath) {
          console.error(`Tool ${name} in ${dir} ignored: already loaded from ${Resource.tools[name].path}`);
          continue;
        }
        try {
          const module = await import(path.join(basePath, file));
          if (module[name]) {
            const tool = module[name];
            Resource.tools[name] = {
              name: name,
              path: basePath,
              tool: tool,
              about: tool.about(),
              initSchema: tool.init_schema(),
              inputSchema: tool.in_schema(),
              outputSchema: tool.out_schema(),
            };
          } else {
            console.error(`Failed to load ${name}: No valid export found`);
          }
        } catch (error) {
          console.error(`Error loading tool ${name}:`, error);
        }
      }
    }
  }

  /** { service, resourceName, id, remainingPath, isJsonRequest } for a URL. */
  route(url) {
    const decode = this.config.global?.decodePath === true;
    const segment = (part) => {
      if (!decode) return part;
      try { return decodeURIComponent(part); } catch { return part; }
    };
    const hosts = this.config.global?.hosts || {};
    const hosted = hosts[url.hostname] ?? hosts['*'];
    const raw = url.pathname.split("/").slice(1);
    const pathParts = hosted === undefined ? raw : [hosted, ...raw];
    const service = segment(pathParts[0] || "");
    let resourceName = segment(pathParts[1] || "index");
    const id = pathParts[2] === undefined ? undefined : segment(pathParts[2]);
    const remainingPath = pathParts.slice(3).map(segment).join('/');

    // Check if the resourceName ends with .json
    const isJsonRequest = resourceName.endsWith('.json');

    // Remove the .json extension for resource name
    if (isJsonRequest) {
      resourceName = resourceName.slice(0, -5); // Remove .json
    }
    return { service, resourceName, id, remainingPath, isJsonRequest };
  }

  /** global.static = { prefix, dir }: serve files under prefix from dir, never outside it. */
  staticResponse(url) {
    const config = this.config.global?.static;
    if (!config?.prefix || !config?.dir || !url.pathname.startsWith(`${config.prefix}/`)) return null;
    const root = path.resolve(process.cwd(), config.dir);
    const relative = (() => {
      try { return decodeURIComponent(url.pathname.slice(config.prefix.length)); } catch { return null; }
    })();
    if (relative === null) return new Response('Not found', { status: 404 });
    const file = path.resolve(root, `.${relative}`);
    if (!file.startsWith(`${root}${path.sep}`) || !existsSync(file) || !statSync(file).isFile()) return new Response('Not found', { status: 404 });
    return new Response(Bun.file(file));
  }

  async withSessionCookie(request, response, sessionId, notFound) {
    const mode = this.logger.config.sessionCookie;
    const wanted = mode === 'always' || (mode !== 'never' && notFound);
    if (!wanted || !sessionId) return response;
    const cookieHeader = request.headers.get("cookie") || "";
    if (!cookieHeader.includes(`session_id=${sessionId}`)) {
      response.headers.append("Set-Cookie", `session_id=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`);
    }
    return response;
  }

  async handleRequest(request) {
    const startTime = Date.now();
    const url = new URL(request.url);
    const file = this.staticResponse(url);
    if (file) return file;

    const { service, resourceName, id, remainingPath, isJsonRequest } = this.route(url);

    const resourceConfig = {
      global: this.config.global || {},
      service: this.config.services?.[service] || {},
      instance: this.config.resources?.[resourceName] || {},
    };

    const resourceInstance = await Resource.register(
      url.hostname,
      service,
      resourceName,
      resourceConfig,
      this.instances || Resource.instances
    );

    const acceptHeader = request.headers.get("accept");
    const wantsJson = Boolean((acceptHeader && acceptHeader.includes("json")) || isJsonRequest);

    if (!resourceInstance) {
      // JSON requests get a JSON body; pages keep 0.1's text.
      const response = wantsJson
        ? new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "Content-Type": "application/json" } })
        : new Response("Resource not found", { status: 404 });
      response.headers.set("X-Response-Time", `${Date.now() - startTime}ms`);
      const sessionId = await this.logger.logRequest(request, response, { service, resource: resourceName, id });
      return this.withSessionCookie(request, response, sessionId, true);
    }

    let response;

    if (wantsJson) {
      response = await resourceInstance.handle(request, id, remainingPath);
    } else {
      response = await resourceInstance.render(request, id, remainingPath);
    }

    // Response time
    const responseTime = Date.now() - startTime;
    if (!response.headers.has("X-Response-Time")) {
      response.headers.set("X-Response-Time", `${responseTime}ms`);
    }

    const sessionId = await this.logger.logRequest(request, response, { service, resource: resourceName, id });
    return this.withSessionCookie(request, response, sessionId, false);
  }

  async start(port = 1111) {
    await this.loadConfig();
    await this.loadTools();

    // The default idle timeout is 10 seconds.
    // This is used if no value is provided in config.json.
    const DEFAULT_IDLE_TIMEOUT_SEC = 10;

    // Determine the final port: config value (preferred) or the argument/default (1111)
    const finalPort = this.config.port ?? port;

    // Determine the final idle timeout: config value (preferred) or the new default
    const finalIdleTimeout = this.config.idleTimeout ?? DEFAULT_IDLE_TIMEOUT_SEC;

    this.server = Bun.serve({
      fetch: (request) => this.handleRequest(request),
      port: finalPort,
      idleTimeout: finalIdleTimeout,
    });

    console.log(`Listening on http://${this.server.hostname}:${this.server.port} ...`);
    console.log(`Connection Idle Timeout set to ${finalIdleTimeout}s.`);

    if (this.config.logging?.enabled) {
      console.log(`Request logging enabled (level: ${this.config.logging.level || "basic"})`);
    }
  }

  stop() {
    if (this.server) {
      this.server.stop();
      console.log('Server stopped');
    }
  }
}
