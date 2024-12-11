import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { Server } from '../server.js';
import { Resource } from '../resource.js';

// Change to test directory
process.chdir(__dirname);

describe('Server', () => {
  const server = new Server();
  const testPort = 3456;

  beforeAll(async () => {
    await server.start(testPort);
    
    // Give server time to start
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  afterAll(async () => {
    server.stop();
  });

  test('routes JSON requests to resource', async () => {
    const response = await fetch(`http://localhost:${testPort}/test/hello/123`, {
      headers: { 'Accept': 'application/json' }
    });
    
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.message).toBe('Hello World');
    expect(data.id).toBe('123');
  });

  test('routes HTML requests to resource', async () => {
    const response = await fetch(`http://localhost:${testPort}/test/hello/123`, {
      headers: { 'Accept': 'text/html' }
    });
    
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('Hello World 123');
  });

  test('returns 404 for non-existent resource', async () => {
    const response = await fetch(`http://localhost:${testPort}/test/nonexistent`, {
      headers: { 'Accept': 'application/json' }
    });
    
    expect(response.status).toBe(404);
  });

  test('passes service configuration to resource', async () => {
    const response = await fetch(`http://localhost:${testPort}/test/hello/123`, {
      headers: { 'Accept': 'application/json' }
    });
    
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.config.service.logging).toBe(true);
  });

  test('maintains configuration hierarchy', async () => {
    const response = await fetch(`http://localhost:${testPort}/test/hello/123`, {
      headers: { 'Accept': 'application/json' }
    });
    
    expect(response.status).toBe(200);
    const data = await response.json();
    
    // Resource-specific config should be at top level
    expect(data.config.shared).toBe('instance');
    
    // Service config should be accessible
    expect(data.config.service.shared).toBe('service');
    expect(data.config.service.serviceOnly).toBe('service-specific');
    
    // Global config should be accessible
    expect(data.config.global.shared).toBe('global');
  });
});
