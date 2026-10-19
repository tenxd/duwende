import { promises as fs, existsSync, statSync } from 'fs';
import path from 'path';

// Path segments that may name a service or a resource: letters, digits, _, $ and -. Anything else (dots, encoded
// slashes, "favicon.ico") cannot be a resource file and is answered with a quiet 404.
const SEGMENT = /^[A-Za-z0-9_$-]+$/;

/**
 * Resource base class.
 *
 * Compatibility: everything 0.1 did is still the default. New behaviour is either invisible to applications or
 * switched on in config.json `global`:
 *   resourceImport: 'copy' (default, as 0.1: the file is copied to tmp/ and imported from there)
 *                 | 'direct' (imported from where it is, so relative imports such as a shared base class work)
 *   resourcePaths:  extra path templates searched after resourcePath, first existing file wins
 *   debugErrors:    true answers a thrown error with { error, message, stack } as 0.1 did; otherwise { error: 'server_error' }
 *   strictMethods:  true answers a method the resource does not implement with 405 instead of 404
 * The framework's own 404 and 405 answer JSON requests (handle*) with { error: 'not_found' | 'method_not_allowed' } and
 * page requests (render*) with 0.1's text bodies.
 *   maxInstances:   cached instances kept (default 1000); the least recently used are dropped beyond it
 *   instanceKey:    'host' (default, as 0.1: an instance per host, service and name) | 'service' (per service and name;
 *                   the instance keeps the hostname it was first created for)
 * Internal methods are private (#name), so they can never collide with a method an application defines.
 */
export class Resource {
  static #shared = {};
  static tools = {};
  static MAX_INSTANCES = 1000;
  static INSTANCE_TTL = 7 * 24 * 60 * 60 * 1000; // kept for compatibility; eviction is now by count, least recently used first
  static debug = false; // set by Server when logging.level is 'debug'
  static #modules = new Map(); // '<mode>:<file path>' → { mtimeMs, Class }: one module copy per file version, not per host

  /** The registry servers share unless they isolate their own (global.isolateInstances). */
  static get instances() {
    return Resource.#shared;
  }

  static set instances(value) {
    Resource.#shared = value;
  }

  static #candidates(hostname, service, name, global = {}) {
    const templates = [global.resourcePath || 'services/${service}/resources/${name}.js', ...(global.resourcePaths || [])];
    return templates.map((template) => template.replace(/\$\{(\w+)\}/g, (_, v) => ({ hostname, service, name })[v]));
  }

  static async #load(file, name, mode) {
    const absolute = path.resolve(process.cwd(), file);
    const mtimeMs = statSync(absolute).mtimeMs;
    const cacheKey = `${mode}:${absolute}`;
    const cached = Resource.#modules.get(cacheKey);
    if (cached && cached.mtimeMs === mtimeMs) return cached.Class;
    const module = mode === 'direct' ? await import(`${absolute}?v=${mtimeMs}`) : await Resource.#importCopy(absolute, name);
    const Class = module?.[name] || null;
    if (Class) Resource.#modules.set(cacheKey, { mtimeMs, Class });
    return Class;
  }

  static async #importCopy(absolute, name) {
    const code = await fs.readFile(absolute, 'utf8');
    const tmpDir = path.resolve(process.cwd(), 'tmp');
    await fs.mkdir(tmpDir, { recursive: true });
    const tempFilePath = path.join(tmpDir, `${name}-${Date.now()}-${Math.floor(Math.random() * 1000000)}.mjs`);
    try {
      await Bun.write(tempFilePath, code);
      return await import(tempFilePath);
    } finally {
      await fs.unlink(tempFilePath).catch((err) => console.warn(`Failed to delete temporary file: ${tempFilePath}`, err));
    }
  }

  static #evict(registry, max) {
    const keys = Object.keys(registry);
    if (keys.length <= max) return;
    keys.sort((a, b) => registry[a].lastUsed - registry[b].lastUsed)
      .slice(0, keys.length - max)
      .forEach((key) => delete registry[key]);
  }

  static async register(hostname, service, name, config, registry = Resource.instances) {
    // instanceKey 'service': one instance per service and resource for every host (made-up Host headers create none).
    const key = config.global?.instanceKey === 'service' ? `${service}/${name}` : `${hostname}/${service}/${name}`;
    const timestamp = Date.now();
    if (registry[key]) {
      registry[key].lastUsed = timestamp;
      if (Resource.debug) console.log(`Instance reused: `, registry[key].instance.name);
      return registry[key].instance;
    }
    if (!SEGMENT.test(name) || (service !== '' && !SEGMENT.test(service))) return null;

    const globalConfig = config.global || {};
    const file = Resource.#candidates(hostname, service, name, globalConfig).find((candidate) => {
      const absolute = path.resolve(process.cwd(), candidate);
      return existsSync(absolute) && statSync(absolute).isFile();
    });
    if (!file) return null;

    try {
      const Class = await Resource.#load(file, name, globalConfig.resourceImport === 'direct' ? 'direct' : 'copy');
      if (!Class) {
        console.error(`Error loading resource: ${file} has no export named ${name}`);
        return null;
      }
      const instanceConfig = { ...config.instance, global: config.global, service: config.service };
      const instance = new Class(hostname, service, name, instanceConfig);
      registry[key] = { instance, created: timestamp, lastUsed: timestamp };
      if (Resource.debug) console.log(`Instance created: ${instance.name}`);
      Resource.#evict(registry, Number(globalConfig.maxInstances) || Resource.MAX_INSTANCES);
      return instance;
    } catch (error) {
      console.error(`Error loading resource: ${error.message}`);
      return null;
    }
  }

  constructor(hostname, service, name, config) {
    this.hostname = hostname;
    this.service = service;
    this.name = name;
    this.config = config;
    // Check instance config first, fall back to global config, default to true if neither specified
    this.logging = config?.logging ?? config?.global?.logging ?? true;
  }

  response(status, content, headers = {}) {
    const defaultHeaders = {
      'Content-Type': 'application/json',
    };

    // Merge default headers with custom headers
    const finalHeaders = { ...defaultHeaders, ...headers };

    // Convert content to JSON if it's an object
    const body = typeof content === 'object' ?
      JSON.stringify(content) :
      String(content);

    // If content type is JSON but content is a string, update header
    if (typeof content === 'string' && finalHeaders['Content-Type'] === 'application/json') {
      finalHeaders['Content-Type'] = 'text/plain';
    }

    return new Response(body, {
      status,
      headers: finalHeaders
    });
  }

  log(name, value, isAssertion = false) {
    if (!this.logging) return;

    const prefix = `[${this.name}]`;

    if (isAssertion) {
      console.assert(value, `${prefix} ${name}`);
    } else {
      console.log(`${prefix} ${name}:`, value);
    }
  }

  #errorResponse(error) {
    console.error(`[${this.service}/${this.name}]`, error?.stack || error);
    const details = this.config?.global?.debugErrors === true;
    return this.response(500, details
      ? { error: 'Internal Server Error', message: error.message, stack: error.stack }
      : { error: 'server_error' });
  }

  async #run(prefix, request, id, path) {
    const verb = request.method === 'GET' && !id ? 'List' : request.method.charAt(0) + request.method.slice(1).toLowerCase();
    const known = ['List', 'Get', 'Post', 'Put', 'Patch', 'Delete', 'Options'];
    const method = this[`${prefix}${verb}`];
    if (!known.includes(verb) || typeof method !== 'function') return this.#frameworkAnswer(405, prefix === 'handle');
    try {
      return await method.call(this, request, id, path);
    } catch (error) {
      return this.#errorResponse(error);
    }
  }

  async render(request, id, path) {
    return this.#run('render', request, id, path);
  }

  async handle(request, id, path) {
    return this.#run('handle', request, id, path);
  }

  /** The framework's own 404/405: JSON for JSON requests (handle*), the 0.1 text bodies for pages (render*). */
  #frameworkAnswer(status, json) {
    if (json) return this.response(status, { error: status === 405 ? 'method_not_allowed' : 'not_found' });
    return this.response(status, status === 405 ? 'Method Not Allowed' : 'Not Found');
  }

  #notImplemented(json) {
    return this.#frameworkAnswer(this.config?.global?.strictMethods === true ? 405 : 404, json);
  }

  async renderList(request) { return this.#notImplemented(false); }
  async renderGet(request, id, path) { return this.#notImplemented(false); }
  async renderPost(request, id, path) { return this.#notImplemented(false); }
  async renderPut(request, id, path) { return this.#notImplemented(false); }
  async renderPatch(request, id, path) { return this.#notImplemented(false); }
  async renderDelete(request, id, path) { return this.#notImplemented(false); }
  async renderOptions(request, id, path) { return this.#notImplemented(false); }
  async handleList(request) { return this.#notImplemented(true); }
  async handleGet(request, id, path) { return this.#notImplemented(true); }
  async handlePost(request, id, path) { return this.#notImplemented(true); }
  async handlePut(request, id, path) { return this.#notImplemented(true); }
  async handlePatch(request, id, path) { return this.#notImplemented(true); }
  async handleDelete(request, id, path) { return this.#notImplemented(true); }
  async handleOptions(request, id, path) { return this.#notImplemented(true); }
}
