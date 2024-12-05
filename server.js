import { Resource } from './resource.js';
import { readdir, readFile } from 'fs/promises';
import path from 'path';

export class Server {
  constructor() {
    this.config = {};
    this.server = null;
  }

  async loadConfig() {
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
  }

  async loadTools() {
    try {
      const basePath = path.resolve(process.cwd(), 'tools');
      const files = await readdir(basePath);
      for (const file of files) {
        if (!file.endsWith('.js')) continue;
        if (file.endsWith('.test.js')) continue;
        const name = file.slice(0, -3); // Remove .js extension

        const module = await import(path.join(basePath, file));
        if (module[name]) {
          const tool = module[name];
          Resource.tools[name] = {
            name: name,
            tool: tool,
            about: tool.about(),
            initSchema: tool.init_schema(),
            inputSchema: tool.in_schema(),
            outputSchema: tool.out_schema()
          };
        } else {
          console.error(`Failed to load ${name}: No valid export found`);
        }
      }
    } catch (error) {
      console.error(`Error loading tools:`, error);
    }
  }

  async handleRequest(request) {
    const url = new URL(request.url);
    const hostname = url.hostname;
    const path = url.pathname;

    const pathParts = path.split('/').slice(1);
    const service = pathParts[0] || '';
    const resourceName = pathParts[1] || 'index';
    const id = pathParts[2];
    const remainingPath = pathParts.slice(3).join('/');

    const resourceConfig = {
      global: this.config.global || {},
      instance: this.config.resources && this.config.resources[resourceName] || {}
    };

    const resourceInstance = await Resource.register(hostname, service, resourceName, resourceConfig);
    if (!resourceInstance) return new Response('Resource not found', { status: 404 });

    const acceptHeader = request.headers.get('Accept');
    if (acceptHeader && acceptHeader.includes('json')) {
      return resourceInstance.handle(request, id, remainingPath);
    }
    return resourceInstance.render(request, id, remainingPath);
  }

  async start(port = 1111) {
    await this.loadConfig();
    await this.loadTools();

    this.server = Bun.serve({
      fetch: (request) => this.handleRequest(request),
      port: port
    });

    console.log(`Listening on http://${this.server.hostname}:${this.server.port} ...`);
  }

  stop() {
    if (this.server) {
      this.server.stop();
      console.log('Server stopped');
    }
  }
}
