import { onRequest } from '../functions/api/[[path]].js';

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  try {
    const headers = new Headers();
    if (Array.isArray(req.rawHeaders)) {
      for (let index = 0; index < req.rawHeaders.length; index += 2) {
        headers.append(req.rawHeaders[index], req.rawHeaders[index + 1]);
      }
    } else {
      for (const [name, value] of Object.entries(req.headers)) {
        if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
      }
    }

    const method = req.method || 'GET';
    const requestInit = { method, headers };
    if (method !== 'GET' && method !== 'HEAD') {
      const chunks = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      requestInit.body = Buffer.concat(chunks);
    }

    const requestUrl = new URL(req.url || '/', 'https://vercel.local');
    const request = new Request(requestUrl, requestInit);
    const response = await onRequest({ request, env: process.env });

    res.statusCode = response.status;
    response.headers.forEach((value, name) => res.setHeader(name, value));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error('Vercel API request failed', error);
    if (res.headersSent) return res.end();
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'حدث خطأ داخلي. حاول مرة أخرى.' }));
  }
}
