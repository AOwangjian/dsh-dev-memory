// dsh-dev-memory — same-origin HTTP routes on host.webServer (PANEL v2).
// Pattern copied from dsh-plugin/lib/http/routes.js: webServer.register({kind,path,handler}),
// sendJson, isSameOrigin, requireTrustedPost, readJsonBody.

const BODY_LIMIT_BYTES = 4 * 1024;

export function sendJson(response, status, value) {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(value));
}

/** POST mutations are only accepted from the local web server origin. */
export function isSameOrigin(request) {
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (origin === undefined || host === undefined) return false;
  try {
    const url = new URL(origin);
    const localHostnames = new Set(['localhost', '127.0.0.1', '[::1]']);
    return url.host === host && localHostnames.has(url.hostname);
  } catch {
    return false;
  }
}

function requireMethod(request, response, method) {
  if (request.method === method) return true;
  response.writeHead(405, { allow: method });
  response.end();
  return false;
}

export function requireTrustedPost(request, response) {
  if (!requireMethod(request, response, 'POST')) return false;
  if (isSameOrigin(request)) return true;
  sendJson(response, 403, { error: 'untrusted origin' });
  return false;
}

export async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > BODY_LIMIT_BYTES) throw new Error('request body too large');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sendError(response, err, fallback = 500) {
  const status = Number.isInteger(err && err.status) ? err.status : fallback;
  sendJson(response, status, { error: err && err.message ? err.message : String(err) });
}

/**
 * Register GET /dsh-dev-memory/state, POST /dsh-dev-memory/config,
 * GET/POST /dsh-dev-memory/workspaces.
 */
export function mountDevMemoryRoutes(webServer, { getSnapshot, updateConfig, listWorkspaces, mutateWorkspace }) {
  const disposers = [
    webServer.register({
      kind: 'exact',
      path: '/dsh-dev-memory/state',
      handler: (request, response) => {
        if (!requireMethod(request, response, 'GET')) return;
        try {
          sendJson(response, 200, getSnapshot(request));
        } catch (err) {
          sendError(response, err);
        }
      },
    }),
    webServer.register({
      kind: 'exact',
      path: '/dsh-dev-memory/config',
      handler: async (request, response) => {
        if (!requireTrustedPost(request, response)) return;
        let body;
        try {
          body = await readJsonBody(request);
        } catch (err) {
          sendJson(response, 400, { error: err && err.message ? err.message : 'invalid json' });
          return;
        }
        try {
          const config = updateConfig(body);
          sendJson(response, 200, { ok: true, config });
        } catch (err) {
          sendError(response, err);
        }
      },
    }),
    webServer.register({
      kind: 'exact',
      path: '/dsh-dev-memory/workspaces',
      handler: async (request, response) => {
        if (request.method === 'GET') {
          try {
            sendJson(response, 200, typeof listWorkspaces === 'function' ? listWorkspaces(request) : { workspaces: [], activeWorkspaceId: null });
          } catch (err) {
            sendError(response, err);
          }
          return;
        }
        if (!requireTrustedPost(request, response)) return;
        let body;
        try {
          body = await readJsonBody(request);
        } catch (err) {
          sendJson(response, 400, { error: err && err.message ? err.message : 'invalid json' });
          return;
        }
        try {
          const workspace = typeof mutateWorkspace === 'function' ? mutateWorkspace(body) : null;
          sendJson(response, 200, { ok: true, workspace });
        } catch (err) {
          sendError(response, err);
        }
      },
    }),
  ];
  return () => {
    for (const dispose of disposers) {
      if (typeof dispose === 'function') dispose();
    }
  };
}
