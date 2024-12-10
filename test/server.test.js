import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { Server } from '../server.js';
import { Resource } from '../resource.js';

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
});
