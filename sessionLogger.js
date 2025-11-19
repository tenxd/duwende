import { appendFile, mkdir } from "fs/promises";
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

export class SessionLogger {
  constructor(config = {}) {
    // default config (overridden by config.json if provided)
    this.config = {
      enabled: config.enabled ?? true,
      level: config.level ?? "basic",
      sessionDir: config.sessionDir ?? path.resolve("logs/sessions")
    };
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

  // Build structured JSON event for this request
  buildEvent(request, response, sessionId, context) {
    const headers = request.headers;

    const event = {
      timestamp: new Date().toISOString(),
      sessionId,
      method: request.method,
      url: request.url,
      service: context.service,
      resource: context.resource,
      id: context.id,
      status: response?.status ?? null
    };

    // Detailed logging
    if (this.config.level === "detailed" || this.config.level === "verbose") {
      event.accept = headers.get("accept") || null;
      event.responseTime = response?.headers?.get("x-response-time") || null;
    }

    // Verbose logging: include sanitized headers
    if (this.config.level === "verbose") {
      event.requestHeaders = sanitizeHeaders(headers);
    }

    return event;
  }

  // Write JSON-lines log file for that session
  async writeEvent(sessionId, event) {
    await mkdir(this.config.sessionDir, { recursive: true });

    const file = path.join(this.config.sessionDir, `${sessionId}.log`);

    // JSON Lines → 1 valid JSON object per line
    await appendFile(file, JSON.stringify(event) + "\n");
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
