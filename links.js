/**
 * Links that follow the hosts map (global.hosts). On a host the map routes to a service, that service's URLs have no
 * service segment (/item/42); everywhere else they start with it (/store/item/42). These helpers build links that are
 * right either way, so an application writes every link through them and works with or without the map.
 *
 * They are plain functions, not Resource methods, so they can never collide with a method an application defines.
 * `context` is anything with { config: { global } } plus either a `request` or a `hostname` (and a default `service`);
 * a resource instance is one. Pass the request (as context.request or options.request) whenever there is one: the
 * current host is then the request's host, which is what matters when one instance serves several hosts
 * (instanceKey 'service'). Without a request, the context's hostname is used.
 *
 *   basePath(context, service?, { request }?)          '' where the current host is routed to the service, else '/service'
 *   link(context, path, { service, absolute, request }) a path on the current host, or an absolute URL when the service
 *                                                       is served on another host, or when absolute is true
 *   origin(context, service?, { request }?)            the origin a service is served on: scheme://host[:port]
 *   routedService(global, hostname)                     the service the hosts map routes a host to, or undefined
 *
 * Origins, in order: global.origins[service] ("https://admin.example.com", "http://localhost:1112"); the request's
 * origin when the service is reached on the current host; the first hostname the map routes to the service, over
 * https; the current host. Set origins whenever links leave a request (emails, sitemaps, invitations), or when
 * several hostnames serve one service.
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
const current = (context = {}, request = context.request) => {
  const url = request ? new URL(request.url) : null;
  return {
    global: globalOf(context),
    service: context.service,
    hostname: url ? url.hostname : context.hostname || 'localhost',
    here: url ? url.origin : null,
  };
};

/** Hostnames (not '*') the hosts map routes to a service, in config order. */
const hostsFor = (global, service) => Object.entries(global.hosts || {})
  .filter(([hostname, target]) => hostname !== '*' && target === service)
  .map(([hostname]) => hostname);

const prefix = (global, hostname, service) => (routedService(global, hostname) === service ? '' : `/${service}`);

/** Is the service reached on the current host: routed here, or not mapped to any host at all? */
const reachedHere = (ctx, service) => routedService(ctx.global, ctx.hostname) === service || hostsFor(ctx.global, service).length === 0;

const originOf = (ctx, service) => {
  const configured = ctx.global.origins?.[service];
  if (configured) return String(configured).replace(/\/+$/, '');
  const here = ctx.here || `https://${ctx.hostname}`;
  if (reachedHere(ctx, service)) return here;
  return `https://${hostsFor(ctx.global, service)[0]}`;
};

/** '' where the current host is routed to the service, else '/service'. */
export const basePath = (context, service, { request } = {}) => {
  const ctx = current(context, request ?? context?.request);
  return prefix(ctx.global, ctx.hostname, service ?? ctx.service);
};

/** The origin (scheme://host[:port]) a service is served on. */
export const origin = (context, service, { request } = {}) => {
  const ctx = current(context, request ?? context?.request);
  return originOf(ctx, service ?? ctx.service);
};

/**
 * A link to `path` (relative to the service, with or without a leading slash; may carry ?query and #hash) in the
 * context's service, or in `service`: a path on the current host, or an absolute URL when the service is served on
 * another host or when absolute is true. An absolute URL's service prefix is the one its own host needs.
 */
export const link = (context, path = '', { service, absolute = false, request } = {}) => {
  const ctx = current(context, request ?? context?.request);
  const target = service ?? ctx.service;
  const tail = String(path).replace(/^\/+/, '');
  if (!absolute && reachedHere(ctx, target)) return `${prefix(ctx.global, ctx.hostname, target)}/${tail}`;
  const base = originOf(ctx, target);
  return `${base}${prefix(ctx.global, new URL(base).hostname, target)}/${tail}`;
};
