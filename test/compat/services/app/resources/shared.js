// Imports a module relative to its own file: works only with resourceImport 'direct'.
import { Resource } from 'duwende';
import { greeting } from '../../../lib/shared.js';

export class Shared extends Resource {
  async handleGet(request, id) {
    return this.response(200, { message: greeting(id) });
  }
}

export const shared = Shared;
