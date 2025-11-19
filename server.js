import { Resource } from './resource.js';
import { readdir, readFile } from 'fs/promises';
import path from 'path';
import { SessionLogger } from './logger.js';
export class Server {
  constructor() {
    this.config = {};
    this.server = null;
    this.logger = null;
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

    // Initialize logger AFTER config is loaded
    this.logger = new SessionLogger(this.config.logging || {});
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
            outputSchema: tool.out_schema(),
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
    const startTime = Date.now();
    const url = new URL(request.url);

    const pathParts = url.pathname.split("/").slice(1);
    const service = pathParts[0] || "";
    let resourceName = pathParts[1] || "index";
    const id = pathParts[2];
    const remainingPath = pathParts.slice(3).join('/');

    // Check if the resourceName ends with .json
    const isJsonRequest = resourceName.endsWith('.json');

    // Remove the .json extension for resource name
    if (isJsonRequest) {
      resourceName = resourceName.slice(0, -5); // Remove .json
    }

    const resourceConfig = {
      global: this.config.global || {},
      service: this.config.services?.[service] || {},
      instance: this.config.resources?.[resourceName] || {},
    };

    const resourceInstance = await Resource.register(
      url.hostname,
      service,
      resourceName,
      resourceConfig
    );

    if (!resourceInstance) {
      const response = new Response("Resource not found", { status: 404 });
      response.headers.set("X-Response-Time", `${Date.now() - startTime}ms`);

      // Log with session support
      const sessionId = await this.logger.logRequest(request, response, {
        service,
        resource: resourceName,
        id
      });

      // Set session cookie if newly generated
      const cookieHeader = request.headers.get("cookie") || "";
      if (!cookieHeader.includes(`session_id=${sessionId}`)) {
        response.headers.append(
          "Set-Cookie",
          `session_id=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`
        );
      }

      return response;
    }

    const acceptHeader = request.headers.get("accept");
    let response;

    if ((acceptHeader && acceptHeader.includes("json")) || isJsonRequest) {
      response = await resourceInstance.handle(request, id, remainingPath);
    } else {
      response = await resourceInstance.render(request, id, remainingPath);
    }

    // Response time
    const responseTime = Date.now() - startTime;
    if (!response.headers.has("X-Response-Time")) {
      response.headers.set("X-Response-Time", `${responseTime}ms`);
    }

    // Logging
    await this.logger.logRequest(request, response, {
      service,
      resource: resourceName,
      id,
    });

    return response;
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
