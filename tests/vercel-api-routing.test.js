import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/[...path].js';

const invokeHandler = async ({ method, url, path, body }) => {
  const headers = { host: 'localhost' };
  const rawHeaders = ['host', 'localhost'];
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    rawHeaders.push('content-type', 'application/json');
  }
  const request = {
    method,
    url,
    query: { path },
    headers,
    rawHeaders,
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) yield Buffer.from(JSON.stringify(body));
    },
  };
  const response = {
    headersSent: false,
    headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(value) { this.body = value; },
  };

  await handler(request, response);
  return {
    status: response.statusCode,
    contentType: response.headers['content-type'],
    body: response.body?.toString() || '',
  };
};

test('Vercel catch-all routes multi-segment API paths to the API handler', async () => {
  const originalFetch = globalThis.fetch;
  const originalSupabaseUrl = process.env.SUPABASE_URL;
  const originalServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://routing-test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'routing-test-key';
  globalThis.fetch = async (url) => {
    const isInsert = new URL(url).pathname === '/rest/v1/page_views';
    return new Response(JSON.stringify([]), {
      status: isInsert ? 201 : 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const responses = await Promise.all([
      invokeHandler({ method: 'POST', url: '/api/analytics/view', path: ['analytics', 'view'], body: { type: 'home' } }),
      invokeHandler({ method: 'GET', url: '/api', path: ['admin', 'products'] }),
      invokeHandler({ method: 'GET', url: '/api/admin/reset-security', path: ['admin', 'reset-security'] }),
      invokeHandler({ method: 'GET', url: '/api/products/20', path: ['products', '20'] }),
    ]);

    assert.equal(responses[0].status, 201);
    assert.equal(responses[1].status, 401);
    assert.equal(responses[2].status, 403);
    assert.equal(responses[3].status, 404);
    assert.match(responses[3].contentType, /application\/json/);
    assert.equal(JSON.parse(responses[3].body).error, 'المنتج غير موجود');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalSupabaseUrl;
    if (originalServiceKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceKey;
  }
});
