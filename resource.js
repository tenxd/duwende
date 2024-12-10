import { promises as fs } from 'fs';
import path from 'path';

export class Resource {
  static instances = {};
  static tools = {};
  static MAX_INSTANCES = 1000;
  static INSTANCE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
  
  static async register(hostname, service, name, config) {
    const key = `${hostname}/${service}/${name}`;
    const timestamp = Date.now();

    if (this.instances[key]) {
      this.instances[key].lastUsed = timestamp;
      console.log(`Instance reused: `, this.instances[key].instance.name);
      return this.instances[key].instance;
    }

    let code;
    const globalConfig = config.global;
    const instanceConfig = config.instance;
    instanceConfig.global = config.global;

    const defaultPath = `services/\${service}/resources/\${name}.js`;
    const resourcePath = globalConfig?.resourcePath || defaultPath;
    const interpolatedPath = resourcePath.replace(/\$\{(\w+)\}/g, (_, v) => ({ hostname, service, name })[v]);
    
    try {
      code = await fs.readFile(interpolatedPath, 'utf8');
    } catch (error) {
      console.error(`Error reading file: ${interpolatedPath}`, error);
    }

    if (!code) {
      console.error(`Resource not found: ${key}`);
      return null;
    }

    // console.log(`Code:`, code);
    
    let tempFilePath;
    try {
      const tempFileName = `${name}-${Date.now()}-${Math.floor(Math.random() * 1000000)}.mjs`;
      const tmpDir = path.resolve(process.cwd(), 'tmp');
      await fs.mkdir(tmpDir, { recursive: true });
      tempFilePath = path.join(tmpDir, tempFileName);
      await Bun.write(tempFilePath, code);
      const module = await import(tempFilePath);
      
      if (module[name]) {
        const instance = new module[name](hostname, service, name, instanceConfig);
        this.instances[key] = {
          instance: instance,
          created: timestamp,
          lastUsed: timestamp
        };
        console.log(`Instance created: ${instance.name}`);
        
        // Check if we've exceeded the maximum number of instances
        if (Object.keys(this.instances).length > this.MAX_INSTANCES) {
          const cutoffTime = timestamp - this.INSTANCE_TTL;
          this.instances = Object.fromEntries(
            Object.entries(this.instances).filter(([_, value]) => value.lastUsed > cutoffTime)
          );
        }
        
        return instance;
      }
    } catch (error) {
      console.error(`Error loading resource: ${error.message}`);
    } finally {
      // Clean up the temporary file
      if (tempFilePath) {
        try {
          await fs.unlink(tempFilePath);
        } catch (err) {
          console.warn(`Failed to delete temporary file: ${tempFilePath}`, err);
        }
      }
    }
    return null;
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

  async render(request, id, path) {
    const methodRenderers = {
      GET: id ? this.renderGet : this.renderList,
      POST: this.renderPost,
      PUT: this.renderPut,
      PATCH: this.renderPatch,
      DELETE: this.renderDelete,
    };

    const renderer = methodRenderers[request.method];
    if (renderer) {
      try {
        return await renderer.call(this, request, id, path);
      } catch (error) {
        return this.response(500, {
          error: 'Internal Server Error',
          message: error.message,
          stack: error.stack
        });
      }
    } else {
      return this.response(405, 'Method Not Allowed');
    }
  }

  async renderList(request) {
    return this.response(404, 'Not Found');
  }

  async renderGet(request, id, path) {
    return this.response(404, 'Not Found');
  }

  async renderPost(request, id, path) {
    return this.response(404, 'Not Found');
  }

  async renderPut(request, id, path) {
    return this.response(404, 'Not Found');
  }

  async renderPatch(request, id, path) {
    return this.response(404, 'Not Found');
  }

  async renderDelete(request, id, path) {
    return this.response(404, 'Not Found');
  }

  async handle(request, id, path) {
    const methodHandlers = {
      GET: id ? this.handleGet : this.handleList,
      POST: this.handlePost,
      PUT: this.handlePut,
      PATCH: this.handlePatch,
      DELETE: this.handleDelete,
    };

    const handler = methodHandlers[request.method];
    if (handler) {
      try {
        return await handler.call(this, request, id, path);
      } catch (error) {
        return this.response(500, {
          error: 'Internal Server Error',
          message: error.message,
          stack: error.stack
        });
      }
    } else {
      return this.response(405, 'Method Not Allowed');
    }
  }

  async handleList(request) {
    return this.response(404, 'Not Found');
  }

  async handleGet(request, id, path) {
    return this.response(404, 'Not Found');
  }

  async handlePost(request, id, path) {
    return this.response(404, 'Not Found');
  }

  async handlePut(request, id, path) {
    return this.response(404, 'Not Found');
  }

  async handlePatch(request, id, path) {
    return this.response(404, 'Not Found');
  }

  async handleDelete(request, id, path) {
    return this.response(404, 'Not Found');
  }
}
