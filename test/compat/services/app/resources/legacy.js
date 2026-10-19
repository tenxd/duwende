// Imports the framework relative to the tmp/ copy, as some 0.1 applications do: works only with resourceImport 'copy'.
import { Resource } from '../../../resource.js';

export class Legacy extends Resource {
  async handleGet() {
    return this.response(200, { ok: true });
  }
}

export const legacy = Legacy;
