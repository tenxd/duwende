export class Tool {
  constructor(params) {
    // Validate params against init_schema
    const validParams = this.validateParams(params, Tool.init_schema());
    Object.assign(this, validParams);
  }

  use(params) {
    // Validate params against in_schema
    const validParams = this.validateParams(params, Tool.in_schema());
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

  validateParams(params, schema) {
    // Simple validation, can be expanded for more complex schemas
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