# Changelog

## Unreleased

- **A host listed with `null` in `global.hosts` is "listed, not routed".** Use it for a shared main hostname that
  keeps every service under its prefix while other hostnames are mapped: `{ "example.com": null, "admin.example.com":
  "admin" }`. Such a host keeps `/{service}/{resource}`, counts as known for `refuseUnknownHosts`, and now never falls
  back to `"*"` (0.3.1 routed it as the wildcard's service when the map also had `"*"`). The startup warning about
  services without `global.origins` no longer counts it as a service.

## 0.3.1 (2026-10-20)

Everything new is opt-in; an application on 0.3.0 runs unchanged.

- **Link helpers for the hosts map.** `import { basePath, link, root, origin, linkContext, routedService } from
  'duwende'`. Plain functions, not Resource methods, so they cannot collide with an application's method names. Pass
  a resource (or `{ config, hostname, service }`) as the context, and the request whenever there is one: the current
  host is then the request's host.
  - `basePath(context, service?, { request })`: `''` on a host the map routes to the service, else `'/service'`.
  - `link(context, path, { service, absolute, request })`: a path on the current host, or an absolute URL when the
    service is served on another host or `absolute` is true; an absolute URL carries the prefix its own host needs.
    On a host the map doesn't list, a link to a service the map serves elsewhere points to that host.
  - `root(context, service?, { absolute, request })`: a service's root without a trailing slash, to append `/path` to.
  - `origin(context, service?, { request })`: the trusted origin a service is served on.
  - `linkContext(context, { request, services })`: `{ service, roots }` as plain JSON for a page to embed, so browser
    code builds the same links as `` `${roots[service]}/${path}` ``. A service on another host without a trusted origin
    is left out.
  - New option `global.origins: { "<service>": "https://host[:port]" }`.
- **Absolute links never come from a Host header.** The Host header is chosen by the client, so a link built from it
  can send a password-reset or invitation email to the attacker's domain. Absolute URLs come only from configuration:
  `global.origins[service]`, else `https://` plus a hostname the hosts map lists for that service (the current host
  when it is one of them, otherwise the first). With neither, absolute links and `origin()` throw an error asking for
  `global.origins`; relative links always work. At start, the server warns about every service the hosts map names
  without an `origins` entry. Set `origins` for every service whose links leave a request (emails, sitemaps,
  invitations), when several hostnames serve one service, and in development (`http://localhost:1112`).
- **`global.instanceKey: "service"`**: one resource instance per service and name for every host, so a made-up Host
  header creates nothing. The instance keeps the hostname it was first created for: read the host from the request.
  Default `"host"` (0.x behaviour).
- **`global.refuseUnknownHosts: true`**: with a hosts map and no `"*"`, a host the map doesn't list gets 421
  (`{ "error": "unknown_host" }` for JSON requests, `Unknown host` for pages) before any routing or static file.
  Without a map, or with `"*"`, nothing is refused. A proxy rule becomes a second line of defence, not the only one.
- **`duwende resource` makes resources that load.** The generated file exported the name in lower case
  (`duwende resource UserProfile api` exported `userprofile`), while the server loads the export named exactly like
  the file, so a resource whose name had capitals never loaded and answered 404. The export is now the name as given,
  the class name never clashes with it (`user_profile` → `UserProfile`, `UserProfile` → `UserProfileResource`), names
  that cannot be a JavaScript export (`user-profile`) are refused with a suggestion, and non-snake_case names get a
  note. Resources made with lower-case names are unaffected.
- `package.json`: `bin` uses npm's normalised path (`cli.js`); npm applied this itself when publishing 0.3.0.

## 0.3.0 (2026-10-20)

**Requires Bun 1.4.3 or later.** On Bun 1.3.14, under concurrent load (about 20 requests in flight), Bun's built-in
PostgreSQL client (`Bun.SQL`) handed queries other queries' results: text values were parsed as JSON, rows came back
with values that do not exist, plain reads failed with "current transaction is aborted", and connections stalled.
Turning off prepared statements did not help; the same load on Bun 1.4.3 is clean. Older versions were not tested and
are refused too. The server refuses to start on Bun older than 1.4.3, with a message saying why (the check runs in `loadConfig()`, which every way of starting a server goes through, including
applications that call `Bun.serve` themselves). Upgrade with `bun upgrade`. This is the one thing an upgrade from 0.1
may require; `engines.bun` states it too.

An application written for 0.1 runs unchanged: every 0.1 behaviour is still the default. Improvements are either
invisible to applications or switched on in `config.json`. Defaults that will change in 1.0 print a warning at start.

### Safer by default, no change needed

- **No stack traces to clients.** A thrown error in a `handle*` or `render*` method answers 500 with
  `{ "error": "server_error" }` and writes the message and stack to the server log. `global.debugErrors: true`
  restores 0.1's body (`error`, `message`, `stack`).
- **JSON 404 and 405 for JSON requests.** The answers DUWENDE writes itself — an unknown resource, a method a
  resource does not implement, an unknown HTTP method — are `{ "error": "not_found" }` or
  `{ "error": "method_not_allowed" }` with `Content-Type: application/json` when the request is a JSON request (a
  `.json` suffix or an `Accept` header containing `json`). Page requests keep 0.1's text bodies (`Resource not found`,
  `Not Found`, `Method Not Allowed`), and status codes are unchanged. Responses an application writes itself are
  untouched. **This changes the body JSON clients receive for these answers:** an outside client that reads them as
  text should parse JSON instead.
- **Quiet 404 for unknown paths.** Service and resource segments must contain only letters, digits, `_`, `$` and
  `-`, and the file must exist; anything else (`/favicon.ico`, `..`) answers 404 without logging a stack.
- **Bounded instance cache.** Resource instances are still cached per host, service and name, but at most
  `global.maxInstances` (default 1000) are kept, least recently used dropped first. A resource file is imported once
  per version of the file, not once per Host header, so made-up hosts no longer pile up module copies.
- **Framework internals are private.** The request dispatcher and error handler are `#private` methods, so an
  application method with the same name (for example `dispatch`) no longer replaces them.
- **Instance messages** ("Instance created", "Instance reused") are printed only at `logging.level: "debug"`.
- **Session cookie.** A `session_id` cookie is no longer set to `null` when logging is off.
- **No more npm copy of Bun.** 0.1 declared `bun` as a peer dependency, and Bun installs peer dependencies
  automatically, so every application got an npm copy of Bun in `node_modules` and `bun run` scripts used that copy
  (whatever version was newest at install time) instead of the Bun on the machine. The peer dependency is gone;
  `engines.bun` (`>=1.2.0`) still states the requirement. After upgrading, remove the stray copy with
  `rm -rf node_modules/bun node_modules/@oven node_modules/.bin/bun node_modules/.bin/bunx` and run `bun install`,
  then check that `bun run test` reports the machine's Bun version.
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
release in an application: `bun add duwende@0.3.1`.
