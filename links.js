/**
 * Links that follow the hosts map (global.hosts). On a host the map routes to a service, that service's URLs have no
 * service segment (/item/42); everywhere else they start with it (/store/item/42). These helpers build links that are
 * right either way, so an application writes every link through them and works with or without the map.
 *
 * They are plain functions, not Resource methods, so they can never collide with a method an application defines.
 * `context` is anything with { config: { global } } plus either a `request` or a `hostname` (and a default `service`);
 * a resource instance is one. Pass the request (as context.request or options.request) whenever there is one: the
 * current host is then the request's host, which matters when one instance serves several hosts (instanceKey
 * 'service'). Without a request, the context's hostname is used.
 *
 *   basePath(context, service?, { request })            '' where the current host is routed to the service, else '/service'
 *   link(context, path, { service, absolute, request }) a path on the current host, or an absolute URL when the service
 *                                                       is served on another host, or when absolute is true
 *   root(context, service?, { absolute, request })      a service's root without a trailing slash, to append paths to
 *   origin(context, service?, { request })              the trusted origin a service is served on: scheme://host[:port]
 *   linkContext(context, { request, services })         { service, roots } that a page can embed for browser code
 *   routedService(global, hostname)                     the service the hosts map routes a host to, or undefined
 *
 * Absolute URLs never come from a Host header. A Host header is chosen by the client, so a link built from it could
 * point a password-reset email at the attacker's domain. Origins come only from configuration: global.origins[service]
 * ("https://admin.example.com", "http://localhost:1112"), or else https:// plus a hostname the hosts map lists for the
 * service (the current host when it is one of them, otherwise the first). With neither, absolute links throw an error
 * saying to set global.origins. Relative links need no origin and always work.
 */

const own = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);

/** The service the hosts map routes this hostname to ('*' for any other host), or undefined. */
export const routedService = (global = {}, hostname = '') => {
  const hosts = global.hosts || {};
  if (own(hosts, hostname)) return hosts[hostname];
  return own(hosts, '*') ? hosts['*'] : undefined;
};

const globalOf = (context = {}) => context.config?.global || context.global || {};

/** The context with the request (if any) deciding the current host. */
const current = (context = {}, request = context.request) => ({
  global: globalOf(context),
  service: context.service,
  hostname: request ? new URL(request.url).hostname : context.hostname || 'localhost',
});

/** Hostnames (not '*') the hosts map lists for a service, in config order: trusted, because they come from config. */
const hostsFor = (global, service) => Object.entries(global.hosts || {})
  .filter(([hostname, target]) => hostname !== '*' && target === service)
  .map(([hostname]) => hostname);

const prefix = (global, hostname, service) => (routedService(global, hostname) === service ? '' : `/${service}`);

/** Is the service reached on the current host: routed here, or not mapped to any host at all? */
const reachedHere = (ctx, service) => routedService(ctx.global, ctx.hostname) === service || hostsFor(ctx.global, service).length === 0;

/** A configured origin for the service, never one taken from a Host header; throws when there is none. */
const trustedOrigin = (ctx, service) => {
  const configured = ctx.global.origins?.[service];
  if (configured) return String(configured).replace(/\/+$/, '');
  const mapped = hostsFor(ctx.global, service);
  if (mapped.length) return `https://${mapped.includes(ctx.hostname) ? ctx.hostname : mapped[0]}`;
  throw new Error(`No origin is configured for service "${service}": set global.origins.${service} (e.g. "https://example.com"). Absolute links are never built from the Host header.`);
};

/** '' where the current host is routed to the service, else '/service'. */
export const basePath = (context, service, { request } = {}) => {
  const ctx = current(context, request ?? context?.request);
  return prefix(ctx.global, ctx.hostname, service ?? ctx.service);
};

/** The trusted origin (scheme://host[:port]) a service is served on. Throws when none is configured. */
export const origin = (context, service, { request } = {}) => {
  const ctx = current(context, request ?? context?.request);
  return trustedOrigin(ctx, service ?? ctx.service);
};

/**
 * A service's root without a trailing slash, to append '/path' to: relative ('' or '/service') when the service is
 * reached on the current host and absolute is false, else its trusted origin plus the prefix that host needs.
 */
export const root = (context, service, { absolute = false, request } = {}) => {
  const ctx = current(context, request ?? context?.request);
  const target = service ?? ctx.service;
  if (!absolute && reachedHere(ctx, target)) return prefix(ctx.global, ctx.hostname, target);
  const base = trustedOrigin(ctx, target);
  return `${base}${prefix(ctx.global, new URL(base).hostname, target)}`;
};

/**
 * A link to `path` (relative to the service, with or without a leading slash; may carry ?query and #hash) in the
 * context's service, or in `service`: a path on the current host, or an absolute URL when the service is served on
 * another host or when absolute is true. An absolute URL carries the prefix its own host needs. On a host the map
 * doesn't list, a link to a service the map serves elsewhere points to that host.
 */
export const link = (context, path = '', { service, absolute = false, request } = {}) =>
  `${root(context, service, { absolute, request })}/${String(path).replace(/^\/+/, '')}`;

/**
 * What browser code needs to build the same links: { service, roots: { "<service>": root } } for the current service
 * and every service the hosts map or origins name, relative where the service is on this host and absolute otherwise.
 * It is plain JSON, safe to embed in a page; build a link in the browser as `${roots[service]}/${path}`. A service
 * without a trusted origin on another host is left out rather than guessed.
 */
export const linkContext = (context, { request, services } = {}) => {
  const ctx = current(context, request ?? context?.request);
  const names = services || [...new Set([ctx.service, ...Object.values(ctx.global.hosts || {}), ...Object.keys(ctx.global.origins || {})].filter(Boolean))];
  const roots = Object.fromEntries(names.flatMap((name) => {
    try {
      return [[name, root(context, name, { request: request ?? context?.request })]];
    } catch {
      return [];
    }
  }));
  return { service: ctx.service ?? null, roots };
};

/** Startup check: the mapped services without a global.origins entry (absolute links then use a mapped hostname). */
export const servicesWithoutOrigins = (global = {}) =>
  [...new Set(Object.values(global.hosts || {}))].filter((service) => !global.origins?.[service]);
