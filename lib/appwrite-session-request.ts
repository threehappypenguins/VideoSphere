// =============================================================================
// APPWRITE SESSION REQUEST (Node HTTP)
// =============================================================================
// Call Appwrite's session endpoint via Node HTTP so we can read Set-Cookie.
// When the request is from a server, Appwrite often returns empty secret in the
// body but still sends the session in Set-Cookie; fetch() cannot read Set-Cookie.
// =============================================================================

import https from 'node:https';
import http from 'node:http';

export type SessionRequestResult = {
  statusCode: number;
  setCookies: string[];
};

export function createSessionViaNodeHttp(
  endpoint: string,
  projectId: string,
  email: string,
  password: string
): Promise<SessionRequestResult> {
  const url = new URL(endpoint.startsWith('http') ? endpoint : `https://${endpoint}`);
  const path = `${url.pathname.replace(/\/$/, '')}/account/sessions/email`;
  const body = JSON.stringify({ email, password });
  const isHttps = url.protocol === 'https:';

  return new Promise((resolve) => {
    const req = (isHttps ? https : http).request(
      {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body, 'utf8'),
          'X-Appwrite-Project': projectId,
        },
      },
      (res) => {
        res.resume();
        const raw = res.headers['set-cookie'];
        const setCookies = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
        resolve({
          statusCode: res.statusCode ?? 0,
          setCookies,
        });
      }
    );
    req.on('error', () => resolve({ statusCode: 0, setCookies: [] }));
    req.write(body);
    req.end();
  });
}
