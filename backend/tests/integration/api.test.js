/**
 * API Integration Tests
 * Tests the Express API endpoints
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestUser } from '../helpers/testUtils.js';
import { users } from '../../src/db/firestore.js';

// We import the app but DON'T start it on a port
// Instead we use the native http module to test
import app from '../../src/index.js';
import http from 'http';

let server;
let baseUrl;

async function request(path, options = {}) {
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json, text, headers: res.headers };
}

describe('API Integration Tests', () => {
  before(async () => {
    // Start the server on a random port
    server = http.createServer(app);
    await new Promise((resolve) => {
      server.listen(0, () => {
        baseUrl = `http://localhost:${server.address().port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  describe('GET /api/health', () => {
    it('should return healthy status', async () => {
      const { status, json } = await request('/api/health');
      assert.equal(status, 200);
      assert.equal(json.status, 'healthy');
      assert.equal(json.service, 'OpenCalendar');
      assert.ok(json.version);
      assert.ok(json.timestamp);
    });
  });

  describe('GET /api/auth/status', () => {
    it('should return unauthenticated when no token', async () => {
      const { status, json } = await request('/api/auth/status');
      assert.equal(status, 200);
      assert.equal(json.authenticated, false);
      assert.equal(json.user, null);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('should clear auth cookie', async () => {
      const { status, json } = await request('/api/auth/logout', { method: 'POST' });
      assert.equal(status, 200);
      assert.equal(json.success, true);
    });
  });

  describe('Protected Routes', () => {
    it('should reject unauthenticated calendar requests', async () => {
      const { status, json } = await request('/api/calendar/events');
      assert.equal(status, 401);
      assert.ok(json.error);
    });

    it('should reject unauthenticated sync requests', async () => {
      const { status } = await request('/api/calendar/sync', { method: 'POST' });
      assert.equal(status, 401);
    });

    it('should reject unauthenticated settings requests', async () => {
      const { status } = await request('/api/user/settings', {
        method: 'PATCH',
        body: JSON.stringify({ timezone: 'UTC' }),
      });
      assert.equal(status, 401);
    });
  });

  describe('Static Files', () => {
    it('should serve the dashboard HTML', async () => {
      const { status, text } = await request('/');
      assert.equal(status, 200);
      assert.ok(text.includes('OpenCalendar'));
    });
  });
});
