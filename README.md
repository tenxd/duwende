# DUWENDE: Dynamic Unified Web-Enabled Network Development Engine

An ultra-lightweight, flexible and extensible web application nano-framework built with Bun.

## Prerequisites

- [Bun](https://bun.sh) >= 1.0.0

## Installation

### Recommended Method

The recommended way to get started is by cloning the duwende-starter repository, which includes pre-made tools and a simple server setup:

```bash
# Clone the starter repository
git clone https://github.com/tenxd/duwende-starter.git my-project
cd my-project

# Install dependencies
bun install

# Start the server
bun run index.js
```

### Manual Installation

Alternatively, you can set up a project manually:

```bash
# First, install Bun if you haven't already
curl -fsSL https://bun.sh/install | bash

# Create a new Bun project
bun init

# Then install duwende
bun install duwende

# Initialize your project
bunx duwende init

# Start the server
bun run index.js
```

## CLI Commands

The package provides several CLI commands to help you get started and create new components:

```bash
# Initialize a new project
bunx duwende init

# Create a new resource
bunx duwende resource <name> <service> [hostname]

# Create a new tool
bunx duwende tool <name>

# List installed tools
bunx duwende tools
```

## Key Concepts

### Resource-Oriented Architecture (ROA)

Duwende follows a strict resource-oriented architecture where everything is modeled as a resource (noun) rather than actions (verbs). For example:

- Instead of a "login" endpoint, you create a "login" resource:
  - POST /login (create a login session)
  - DELETE /login (logout/destroy session)
- Resources map naturally to REST operations:
  - GET: Retrieve a resource
  - LIST: Special method for retrieving collections (GET without ID)
  - POST: Create a new resource
    - Without ID: Create a new standalone resource
    - With ID: Create a new resource derived from an existing one (parent or peer)
  - PUT: Replace a resource
  - PATCH: Update a resource
  - DELETE: Remove a resource

### Resources

- Handle specific types of requests and render responses
- Must be pure in their implementation - no external imports allowed
- Any interaction with the outside world (databases, files, APIs) must be done through Tools
- Resources are automatically loaded and managed by the server
- Each resource can implement two types of methods for each HTTP operation:
  - handleXXX(): For API responses, returns JSON data (Content-Type: application/json)
  - renderXXX(): For HTML responses, returns rendered content (Content-Type: text/html)
  - The appropriate method is called based on the Accept header in the request

Example:
```javascript
class UserResource extends Resource {
  // API endpoint: returns JSON
  async handleGet(request, id, path) {
    return new Response(JSON.stringify({
      id: id,
      name: "John Doe"
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Web endpoint: returns HTML
  async renderGet(request, id, path) {
    return new Response(`
      <html>
        <body>
          <h1>User Profile</h1>
          <p>ID: ${id}</p>
          <p>Name: John Doe</p>
        </body>
      </html>
    `, {
      headers: { 'Content-Type': 'text/html' }
    });
  }
}
```

### Tools

- Provide reusable functionality for resources
- Handle all external interactions (database connections, file operations, API calls)
- Are loaded at server startup and made available to resources
- Must implement specific schemas for initialization, input, and output

### Server

- Core server implementation that handles request routing and resource management
- Strictly follows REST principles with added LIST method
- Manages resource lifecycle and configuration
- Handles tool loading and initialization

## Configuration

The server uses a `config.json` file for configuration with two main sections:

```json
{
  "global": {
    "resourcePath": "optional/custom/path/to/resources/${service}/${name}.js"
  },
  "resources": {
    "resource-name": {
      // Resource-specific configuration
    }
  }
}
```

- `global`: Contains settings that apply to all resources
  - `resourcePath`: Optional template string for custom resource file locations
- `resources`: Contains resource-specific configurations
  - Each resource can have its own configuration object
  - Global config is automatically made available to resources

## About

This project uses [Bun](https://bun.sh), a fast all-in-one JavaScript runtime. Bun is required to run this framework.

## License

MIT © Ten X Development Corporation
