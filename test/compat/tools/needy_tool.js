import { Tool } from 'duwende';

export class NeedyTool extends Tool {
  constructor(params = {}) {
    super(params);
    this.name = params.name;
  }

  async use() {
    return { status: 200, content: this.name ?? null };
  }

  static init_schema() {
    return { name: { type: 'string', required: true }, size: { type: 'integer', required: false } };
  }
}

export const needy_tool = NeedyTool;
