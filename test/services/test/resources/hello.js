import { Resource } from '../../resource.js';

export class hello extends Resource {
  constructor(hostname, service, name, config) {
    super(hostname, service, name, config);
    console.log('Config received:', JSON.stringify(config, null, 2));
  }
  
  async handleGet(request, id) {
    return this.response(200, { 
      message: 'Hello World', 
      id,
      config: this.config  // Expose config in response for testing
    });
  }
  
  async renderGet(request, id) {
    return this.response(200, `<html><body>Hello World ${id || ''}</body></html>`, {
      'Content-Type': 'text/html'
    });
  }
}
