import { Resource } from 'duwende';

export class Boom extends Resource {
  async handleGet() {
    throw new Error('secret detail');
  }
}

export const boom = Boom;
