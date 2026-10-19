import { appendFile, mkdir, readdir, stat, unlink } from "fs/promises";
import path from "path";
import crypto from "crypto";

// Parse cookies safely from header
function parseCookies(header) {
  if (!header) return {};
  return Object.fromEntries(
    header
      .split(";")
      .map(c => c.trim().split("="))
      .filter(([k, v]) => k)
  );
}

// Remove sensitive data
function sanitizeHeaders(headers) {
  const out = {};
  for (const [key, value] of headers.entries()) {
    const k = key.toLowerCase();
    if (k === "authorization" || k === "cookie" || k === "set-cookie") {
      out[k] = "[REDACTED]";
    } else {
      out[k] = value;
    }
  }
  return out;
}

const HOUR = 60 * 60 * 1000;

/**
 * Request logging (config.json `logging`). Defaults are 0.1's; the options are new:
 *   enabled: true (default) | false
 *   level: 'basic' | 'detailed' | 'verbose' | 'debug' (debug also prints instance messages)
 *   query: true (default: full URL, as 0.1) | false (path only) | ['allowed', 'params'] (only those parameters)
 *   rotate: 'session' (default: a file per session, as 0.1) | 'daily' (a file per day)
 *   retainDays: delete log files older than this many days (default: keep everything, as 0.1)
 *   sessionCookie: 'unknown' (default: set on 404s, as 0.1) | 'always' | 'never'
 */
export class SessionLogger {
  constructor(config = {}) {
    // default config (overridden by config.json if provided)
    this.config = {
      enabled: config.enabled ?? true,
      level: config.level ?? "basic",
      sessionDir: config.sessionDir ?? path.resolve("logs/sessions"),
      query: config.query ?? true,
      rotate: config.rotate ?? "session",
      retainDays: config.retainDays ?? null,
      sessionCookie: config.sessionCookie ?? "unknown",
    };
    this.prunedAt = 0;
  }

  // Extract or assign a session ID
  getOrCreateSessionId(request) {
    const cookies = parseCookies(request.headers.get("cookie"));
    let sid = cookies.session_id;

    if (!sid) {
      sid = crypto.randomUUID();
    }

    return sid;
  }

  /** The URL as the query option allows it to be logged. */
  loggedUrl(raw) {
    if (this.config.query === true) return raw;
    const url = new URL(raw);
    if (this.config.query === false) return `${url.origin}${url.pathname}`;
    const allowed = Array.isArray(this.config.query) ? this.config.query : [];
    const kept = [...url.searchParams].filter(([key]) => allowed.includes(key));
    const query = new URLSearchParams(kept).toString();
    return `${url.origin}${url.pathname}${query ? `?${query}` : ""}`;
  }

  // Build structured JSON event for this request
  buildEvent(request, response, sessionId, context) {
    const headers = request.headers;

    const event = {
      timestamp: new Date().toISOString(),
      sessionId,
      method: request.method,
      url: this.loggedUrl(request.url),
      service: context.service,
      resource: context.resource,
      id: context.id,
      status: response?.status ?? null
    };

    // Detailed logging
    if (["detailed", "verbose", "debug"].includes(this.config.level)) {
      event.accept = headers.get("accept") || null;
      event.responseTime = response?.headers?.get("x-response-time") || null;
    }

    // Verbose logging: include sanitized headers
    if (["verbose", "debug"].includes(this.config.level)) {
      event.requestHeaders = sanitizeHeaders(headers);
    }

    return event;
  }

  // Write JSON-lines log file for that session (or day)
  async writeEvent(sessionId, event) {
    await mkdir(this.config.sessionDir, { recursive: true });

    const name = this.config.rotate === "daily" ? event.timestamp.slice(0, 10) : sessionId;
    const file = path.join(this.config.sessionDir, `${name}.log`);

    // JSON Lines → 1 valid JSON object per line
    await appendFile(file, JSON.stringify(event) + "\n");
    await this.prune();
  }

  /** Delete .log files older than retainDays, at most once an hour. */
  async prune(now = Date.now()) {
    const days = Number(this.config.retainDays);
    if (!days || now - this.prunedAt < HOUR) return 0;
    this.prunedAt = now;
    const cutoff = now - days * 24 * HOUR;
    const files = (await readdir(this.config.sessionDir).catch(() => [])).filter((file) => file.endsWith(".log"));
    const old = [];
    for (const file of files) {
      const full = path.join(this.config.sessionDir, file);
      const info = await stat(full).catch(() => null);
      if (info && info.mtimeMs < cutoff) old.push(full);
    }
    await Promise.all(old.map((file) => unlink(file).catch(() => {})));
    return old.length;
  }

  // Main call used by Server.handleRequest()
  async logRequest(request, response, context) {
    if (!this.config.enabled) return null;

    const sid = this.getOrCreateSessionId(request);
    const event = this.buildEvent(request, response, sid, context);

    await this.writeEvent(sid, event);

    return sid; // server will set cookie if needed
  }
}
