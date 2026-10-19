import { Resource } from 'duwende';

// An application method named like a framework internal ("dispatch") must keep working.
export class Unit extends Resource {
  async dispatch(target) {
    return `dispatched to ${target}`;
  }

  async handlePost(request, id) {
    this.log('posting', id);
    return this.response(200, { result: await this.dispatch(id), logging: this.logging });
  }

  async handleGet(request, id, rest) {
    return this.response(200, { id, rest, hostname: this.hostname });
  }
}

export const unit = Unit;
