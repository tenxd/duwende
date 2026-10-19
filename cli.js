#!/usr/bin/env bun

import { mkdir, writeFile, readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const commands = {
  init: createProject,
  resource: createResource,
  tool: createTool,
  tools: listTools
};

async function main() {
  const command = process.argv[2];
  const name = process.argv[3];

  if (!command) {
    console.error('Please specify a command: init, resource, tool, or tools');
    console.error('\nUsage:');
    console.error('  duwende init');
    console.error('  duwende resource <name> <service> [hostname]');
    console.error('  duwende tool <name>');
    console.error('  duwende tools');
    process.exit(1);
  }

  if (!commands[command]) {
    console.error(`Unknown command: ${command}`);
    console.error('\nAvailable commands:');
    console.error('  init      Initialize a new project');
    console.error('  resource  Create a new resource');
    console.error('  tool      Create a new tool');
    console.error('  tools     List information about installed tools');
    process.exit(1);
  }

  if (command === 'resource') {
    const service = process.argv[4];
    if (!name || !service) {
      console.error('Please specify both name and service for the resource');
      console.error('\nUsage:');
      console.error('  duwende resource <name> <service> [hostname]');
      console.error('\nArguments:');
      console.error('  name      The name of the resource (required)');
      console.error('  service   The service name (required)');
      console.error('  hostname  The hostname for the resource (optional, defaults to localhost)');
      process.exit(1);
    }
  }

  if (command === 'tool' && !name) {
    console.error('Please specify a name for the tool');
    console.error('\nUsage:');
    console.error('  duwende tool <name>');
    process.exit(1);
  }

  await commands[command](name);
}

async function listTools() {
  const toolsDir = join(process.cwd(), 'tools');
  if (!existsSync(toolsDir)) {
    console.error('No tools directory found');
    return;
  }

  const files = await readdir(toolsDir);
  const toolFiles = files.filter(file => file.endsWith('_tool.js'));

  if (toolFiles.length === 0) {
    console.log('No tools installed');
    return;
  }

  console.log('Installed tools:\n');

  for (const file of toolFiles) {
    try {
      const toolPath = join(toolsDir, file);
      const module = await import(toolPath);
      const toolName = file.slice(0, -8); // Remove '_tool.js'
      const toolClass = module[`${toolName}_tool`];

      console.log(`${toolName}:`);
      console.log('  Description:', toolClass.about());
      
      console.log('  Initialization Schema:');
      const initSchema = toolClass.init_schema();
      if (Object.keys(initSchema).length === 0) {
        console.log('    No initialization parameters');
      } else {
        for (const [param, schema] of Object.entries(initSchema)) {
          console.log(`    ${param}: ${schema.type}${schema.required ? ' (required)' : ''}`);
        }
      }

      console.log('  Input Schema:');
      const inSchema = toolClass.in_schema();
      if (Object.keys(inSchema).length === 0) {
        console.log('    No input parameters');
      } else {
        for (const [param, schema] of Object.entries(inSchema)) {
          console.log(`    ${param}: ${schema.type}${schema.required ? ' (required)' : ''}`);
        }
      }

      console.log('  Output Schema:');
      const outSchema = toolClass.out_schema();
      console.log('    status: number');
      console.log('    content:', outSchema.properties?.content?.type || 'any');
      console.log();
    } catch (error) {
      console.error(`Error loading tool ${file}:`, error.message);
    }
  }
}

// The server loads a resource by importing its file and reading the export named exactly like the file, so the
// export must be the name as given. snake_case names (user_profile) are the convention.
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const CONVENTIONAL = /^[a-z][a-z0-9_]*$/;

/** user_profile → UserProfile; a class name never equal to the export name. */
function resourceClassName(name) {
  const pascal = name.split('_').filter(Boolean).map(capitalize).join('') || capitalize(name);
  return pascal === name ? `${pascal}Resource` : pascal;
}

/** null when the name can be a resource, else why not. Warns about names that work but break the convention. */
function checkResourceName(name) {
  if (!IDENTIFIER.test(name)) {
    return `"${name}" cannot be a resource name: the file must export a JavaScript identifier of the same name (letters, digits, _ and $; not starting with a digit). Use snake_case, e.g. ${name.replace(/[^A-Za-z0-9_$]+/g, '_').replace(/^(\d)/, '_$1').toLowerCase()}`;
  }
  if (!CONVENTIONAL.test(name)) {
    console.warn(`Note: "${name}" works, but resource names are conventionally snake_case (${name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()}); the URL is case-sensitive: /<service>/${name}`);
  }
  return null;
}

function getResourceTemplate(name) {
  const className = resourceClassName(name);
  return `import { Resource } from 'duwende';

export class ${className} extends Resource {
  constructor(hostname, service, name, config) {
    super(hostname, service, name, config);
  }

  async handleGet(request, id, path) {
    return new Response(JSON.stringify({
      message: 'Hello from ${className} Resource!'
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  async renderGet(request, id, path) {
    return new Response('Hello from ${className} Resource!');
  }
}

export const ${name} = ${className};`;
}

async function getResourcePath(hostname, service, name) {
  const defaultPath = `services/\${service}/resources/\${name}.js`;
  const configPath = join(process.cwd(), 'config.json');
  
  try {
    if (existsSync(configPath)) {
      const configContent = await readFile(configPath, 'utf8');
      const config = JSON.parse(configContent);
      const resourcePath = config.global?.resourcePath || defaultPath;
      return resourcePath.replace(/\$\{(\w+)\}/g, (_, v) => ({ hostname, service, name })[v]);
    }
  } catch (error) {
    console.warn('Error reading config.json:', error.message);
  }
  
  return defaultPath.replace(/\$\{(\w+)\}/g, (_, v) => ({ hostname, service, name })[v]);
}

async function createProject() {
  const structure = {
    'index.js': `import { Server } from "duwende";

console.log("Current working directory:", process.cwd());

const duwende = new Server();

duwende
  .start()
  .then(() => {
    console.log("Duwende server started successfully");
  })
  .catch((error) => {
    console.error("Failed to start Duwende server:", error);
  });`,
    'config.json': JSON.stringify({
      global: {
        resourcePath: "services/\${service}/resources/\${name}.js"
      },
      resources: {},
      // Explicit, so a new project starts without the 0.x default warning and keeps query strings and
      // session cookies out of its request log.
      logging: { enabled: true, level: "basic", query: false, rotate: "daily", retainDays: 30, sessionCookie: "never" }
    }, null, 2)
  };

  // Create basic project structure
  for (const [path, content] of Object.entries(structure)) {
    const fullPath = join(process.cwd(), path);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content);
  }

  // Create example resource using the configured path
  const examplePath = await getResourcePath('localhost', 'example', 'example');
  const fullExamplePath = join(process.cwd(), examplePath);
  await mkdir(dirname(fullExamplePath), { recursive: true });
  await writeFile(fullExamplePath, getResourceTemplate('example'));

  // Create tools directory
  const projectToolsDir = join(process.cwd(), 'tools');
  await mkdir(projectToolsDir, { recursive: true });

  console.log('Project initialized successfully!');
  console.log('Run "bun run index.js" to start the server.');
}

async function createResource(name) {
  const problem = checkResourceName(name);
  if (problem) {
    console.error(problem);
    process.exit(1);
  }
  const service = process.argv[4];
  const hostname = process.argv[5] || 'localhost';
  const resourcePath = await getResourcePath(hostname, service, name);
  const fullPath = join(process.cwd(), resourcePath);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, getResourceTemplate(name));
  console.log(`Resource ${name} created successfully at ${resourcePath}`);
}

async function createTool(name) {
  // Convert to snake_case if not already
  const snakeName = name.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
  const className = name.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
    .replace(/^[a-z]/, letter => letter.toUpperCase());

  const content = `import { Tool } from 'duwende';

export class ${className}Tool extends Tool {
  constructor(params) {
    super(params);
  }

  async use(params) {
    try {
      return {
        status: 200,
        content: 'Tool execution successful'
      };
    } catch (error) {
      return {
        status: 500,
        content: error.message
      };
    }
  }

  static init_schema() {
    return {
      // Define initialization parameters schema
    };
  }

  static in_schema() {
    return {
      // Define input parameters schema
    };
  }

  static out_schema() {
    return {
      type: 'object',
      properties: {
        status: { type: 'number' },
        content: { type: 'any' }
      }
    };
  }

  static about() {
    return 'Description of what this tool does';
  }
}

export const ${snakeName}_tool = ${className}Tool;`;

  const path = join(process.cwd(), 'tools', `${snakeName}_tool.js`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
  console.log(`Tool ${name} created successfully as ${snakeName}_tool.js`);
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

main().catch(console.error);
