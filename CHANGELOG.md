# Changelog

## 0.3.0 (beta, branch `release/0.3`)

An application written for 0.1 runs unchanged: every 0.1 behaviour is still the default. Improvements are either
invisible to applications or switched on in `config.json`. Defaults that will change in 1.0 print a warning at start.

### Safer by default, no change needed

- **No stack traces to clients.** A thrown error in a `handle*` or `render*` method answers 500 with
  `{ "error": "server_error" }` and writes the message and stack to the server log. `global.debugErrors: true`
  restores 0.1's body (`error`, `message`, `stack`).
- **Quiet 404 for unknown paths.** Service and resource segments must contain only letters, digits, `_`, `$` and
  `-`, and the file must exist; anything else (`/favicon.ico`, `..`) answers 404 without logging a stack.
- **Bounded instance cache.** Resource instances are still cached per host, service and name, but at most
  `global.maxInstances` (default 1000) are kept, least recently used dropped first. A resource file is imported once
  per version of the file, not once per Host header, so made-up hosts no longer pile up module copies.
- **Framework internals are private.** The request dispatcher and error handler are `#private` methods, so an
  application method with the same name (for example `dispatch`) no longer replaces them.
- **Instance messages** ("Instance created", "Instance reused") are printed only at `logging.level: "debug"`.
- **Session cookie.** A `session_id` cookie is no longer set to `null` when logging is off.
- **Tools load independently.** A tool that fails to import is reported and skipped; the others still load.

### New options

| Option | Values | Default (0.1 behaviour) |
| --- | --- | --- |
| `global.resourceImport` | `"copy"` (copy to `tmp/`, then import) or `"direct"` (import the file where it is, so relative imports such as a shared base class work) | `"copy"` |
| `global.resourcePaths` | extra path templates searched after `resourcePath`; the first existing file wins | none |
| `global.toolPaths` | extra directories loaded after `tools/`; a name already loaded is not replaced | none |
| `global.hosts` | `{ "<hostname>": "<service>", "*": "<service>" }`: on a mapped host, `/{resource}/{id}` without the service segment | none |
| `global.static` | `{ "prefix": "/assets", "dir": "public" }`: files served by the server (development; use the proxy in production) | none |
| `global.decodePath` | `true`: URL-decode path segments before they reach resources | raw segments |
| `global.strictMethods` | `true`: a method the resource does not implement answers 405 | 404 |
| `global.isolateInstances` | `true`: the server keeps its own instance registry instead of the shared `Resource.instances` | shared |
| `global.toolValidation` | `"warn"`, `"strict"` (constructor throws) or `"off"` | `"warn"` |
| `global.debugErrors` | `true`: error details in 500 responses | off |
| `global.maxInstances` | number of cached resource instances | 1000 |
| `logging.query` | `true` (full URL), `false` (path only) or a list of query parameters to keep | `true` |
| `logging.rotate` | `"session"` (a file per session) or `"daily"` (a file per day) | `"session"` |
| `logging.retainDays` | delete log files older than this many days | keep all |
| `logging.sessionCookie` | `"unknown"` (set on 404s), `"always"` or `"never"` | `"unknown"` |
| `logging.level` | adds `"debug"` (also prints instance messages) | `"basic"` |

### Tool validation

0.1 validated tool constructor parameters against the base class's empty schema, so a tool's `init_schema()` was
never checked. It is now. With the default `"warn"`, a missing required parameter or a value of the wrong type is
reported once per tool and parameter, and nothing throws. Types: `string`, `number`, `boolean`, `function`, `array`,
`object`, `any`; unknown types are treated as `any`, with a warning. Run your application once and read the warnings
before switching to `"strict"`.

### Planned for 1.0

- `toolValidation` becomes `"strict"`.
- Request logging is off unless `logging.enabled` is set (0.x prints a warning at start when there is no `logging` block).
- `strictMethods` becomes the default.
Each will have a flag that restores the 0.x behaviour.

### Checking an application before upgrading

`bun scripts/compat-matrix.js <app dir> …` copies each application to a temporary directory and runs its test suite
with the DUWENDE it has installed and again with this checkout, then lists any test that passes before and fails
after. The original application is never touched. `--baseline <dir>` installs a given DUWENDE package for the
baseline run, which is needed when the application's `node_modules/duwende` links to a working checkout. To try the
beta in an application directly: `bun add github:tenxd/duwende#release/0.3`.
