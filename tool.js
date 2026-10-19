const TYPES = {
  array: Array.isArray,
  object: (value) => value !== null && typeof value === 'object' && !Array.isArray(value),
  any: () => true,
};
const KNOWN = ['string', 'number', 'boolean', 'function', 'bigint', 'symbol', 'array', 'object', 'any'];
const warned = new Set();

const warnOnce = (key, message) => {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[duwende] ${message}`);
};

/**
 * Tool base class.
 *
 * 0.1 validated constructor parameters against the base class's empty schema, so a tool's own init_schema() was never
 * checked. It is now, with the strictness set in config.json `global.toolValidation`:
 *   'warn' (default): a missing required parameter or a wrong type is reported once per tool and parameter; nothing throws
 *   'strict': the constructor throws (the intended 1.0 default)
 *   'off': no checks, as 0.1
 * Types: string, number, boolean, function, array, object, any. Unknown types are treated as any, with a warning.
 * Null and undefined count as missing. Tool.check(schema, params) returns the first problem, or null.
 */
export class Tool {
  static validation = 'warn'; // set by Server from global.toolValidation

  constructor(params = {}) {
    const mode = Tool.validation;
    if (mode === 'off') return;
    const problems = Tool.problems(this.constructor.init_schema?.() || {}, params || {}, this.constructor.name);
    if (!problems.length) return;
    if (mode === 'strict') throw new Error(`${this.constructor.name}: ${problems[0]}`);
    problems.forEach((problem) => warnOnce(`${this.constructor.name}:${problem}`, `${this.constructor.name}: ${problem} (toolValidation is 'warn'; 'strict' will throw)`));
  }

  static problems(schema = {}, params = {}, owner = 'tool') {
    return Object.entries(schema).flatMap(([key, rule]) => {
      if (rule?.type && !KNOWN.includes(rule.type)) warnOnce(`${owner}:type:${key}`, `${owner}: schema type "${rule.type}" for ${key} is not one of ${KNOWN.join(', ')}; treated as any`);
      const value = params[key];
      const missing = value === undefined || value === null;
      if (missing) return rule?.required ? [`missing required parameter: ${key}`] : [];
      if (!rule?.type || !KNOWN.includes(rule.type)) return [];
      const ok = TYPES[rule.type] ? TYPES[rule.type](value) : typeof value === rule.type;
      return ok ? [] : [`parameter ${key} must be ${rule.type}`];
    });
  }

  static check(schema, params) {
    return Tool.problems(schema, params)[0] || null;
  }

  use(params) {
    // Implementation should be provided by subclasses
    throw new Error('use method must be implemented by subclasses');
  }

  static init_schema() {
    // Should be overridden by subclasses
    return {};
  }

  static in_schema() {
    // Should be overridden by subclasses
    return {};
  }

  static out_schema() {
    // Should be overridden by subclasses
    return {};
  }

  static about() {
    // Should be overridden by subclasses
    return 'A generic tool';
  }

  /** 0.1's helper, kept for subclasses that call it. */
  validateParams(params, schema) {
    const validParams = {};
    for (const [key, value] of Object.entries(schema)) {
      if (params.hasOwnProperty(key) && typeof params[key] === value.type) {
        validParams[key] = params[key];
      } else if (value.required) {
        throw new Error(`Missing or invalid required parameter: ${key}`);
      }
    }
    return validParams;
  }
}
