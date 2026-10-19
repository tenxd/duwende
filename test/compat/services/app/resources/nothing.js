import { Resource } from 'duwende';

export class Nothing extends Resource {
  async handleGet() {
    return this.response(200, null);
  }
}

export const nothing = Nothing;
