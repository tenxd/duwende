import { Resource } from '../resource.js';

export class hello extends Resource {
  constructor(hostname, service, name, config) {
    super(hostname, service, name, config);
  }
  
  async handleGet(request, id) {
    return this.response(200, { message: 'Hello World', id });
  }
  
  async renderGet(request, id) {
    return this.response(200, `<html><body>Hello World ${id || ''}</body></html>`, {
      'Content-Type': 'text/html'
    });
  }
}
