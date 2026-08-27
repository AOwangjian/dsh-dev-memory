// dsh-dev-memory — PANEL v2 HTTP routes (same-origin host.webServer).
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mountDevMemoryRoutes } from '../lib/http.js';

function makeWebServer() {
  const routes = [];
  return {
    routes,
    register(def) {
      routes.push(def);
      return () => {};
    },
  };
}

function mockRes() {
  return {
    status: null,
    headers: null,
    body: '',
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(data) {
      this.body = data == null ? '' : String(data);
    },
  };
}

function jsonReq(method, body, headers) {
  const req = new EventEmitter();
  req.method = method;
  req.headers = headers || {};
  const buf = Buffer.from(body == null ? '' : JSON.stringify(body));
  queueMicrotask(() => {
    req.emit('data', buf);
    req.emit('end');
  });
  req[Symbol.asyncIterator] = async function* () {
    yield buf;
  };
  return req;
}

function trustedHeaders() {
  return { origin: 'http://127.0.0.1:12393', host: '127.0.0.1:12393' };
}

function mountWith(state) {
  const webServer = makeWebServer();
  const snapshot = {
    enabled: true,
    memoryRootOverride: null,
    maxInjectTokens: 1500,
    bootRoot: '/boot/memory',
    scriptsDir: '/scripts',
    autoWriteLevels: [2, 3],
    writeConfidenceMin: 'medium',
    audit: [{ ts: 1, module: 'm', action: 'write' }],
    health: { ok: true },
    ...state,
  };
  mountDevMemoryRoutes(webServer, {
    getSnapshot() {
      const memoryRoot = snapshot.memoryRootOverride || snapshot.bootRoot;
      return {
        config: {
          memoryRoot,
          scriptsDir: snapshot.scriptsDir,
          maxInjectTokens: snapshot.maxInjectTokens,
          autoWriteLevels: snapshot.autoWriteLevels,
          writeConfidenceMin: snapshot.writeConfidenceMin,
          enabled: snapshot.enabled,
        },
        audit: snapshot.audit,
        health: snapshot.health,
        pendingLevel1: [],
      };
    },
    updateConfig(body) {
      if (typeof body.enabled === 'boolean') snapshot.enabled = body.enabled;
      if (typeof body.memoryRoot === 'string') {
        const next = body.memoryRoot.trim();
        snapshot.memoryRootOverride = next ? next : null;
      }
      if (typeof body.maxInjectTokens === 'number' && Number.isInteger(body.maxInjectTokens) && body.maxInjectTokens > 0) {
        snapshot.maxInjectTokens = body.maxInjectTokens;
      }
      const memoryRoot = snapshot.memoryRootOverride || snapshot.bootRoot;
      return {
        memoryRoot,
        scriptsDir: snapshot.scriptsDir,
        maxInjectTokens: snapshot.maxInjectTokens,
        autoWriteLevels: snapshot.autoWriteLevels,
        writeConfidenceMin: snapshot.writeConfidenceMin,
        enabled: snapshot.enabled,
      };
    },
  });
  const byPath = Object.fromEntries(webServer.routes.map((r) => [r.path, r]));
  return { webServer, snapshot, byPath };
}

test('GET /dsh-dev-memory/state returns config/audit/health/pendingLevel1', async () => {
  const { byPath } = mountWith();
  const route = byPath['/dsh-dev-memory/state'];
  assert.ok(route);
  assert.equal(route.kind, 'exact');
  const res = mockRes();
  await route.handler({ method: 'GET', headers: {} }, res);
  assert.equal(res.status, 200);
  const json = JSON.parse(res.body);
  assert.equal(json.config.memoryRoot, '/boot/memory');
  assert.equal(json.config.scriptsDir, '/scripts');
  assert.equal(json.config.maxInjectTokens, 1500);
  assert.deepEqual(json.config.autoWriteLevels, [2, 3]);
  assert.equal(json.config.writeConfidenceMin, 'medium');
  assert.equal(json.config.enabled, true);
  assert.equal(json.audit.length, 1);
  assert.deepEqual(json.health, { ok: true });
  assert.deepEqual(json.pendingLevel1, []);
});

test('POST /dsh-dev-memory/config updates enabled and memoryRoot', async () => {
  const { byPath } = mountWith();
  const route = byPath['/dsh-dev-memory/config'];
  assert.ok(route);
  const res = mockRes();
  await route.handler(jsonReq('POST', { enabled: false, memoryRoot: '/tmp/override' }, trustedHeaders()), res);
  assert.equal(res.status, 200);
  const json = JSON.parse(res.body);
  assert.equal(json.ok, true);
  assert.equal(json.config.enabled, false);
  assert.equal(json.config.memoryRoot, '/tmp/override');
});

test('POST /dsh-dev-memory/config rejects untrusted origin', async () => {
  const { byPath } = mountWith();
  const res = mockRes();
  await byPath['/dsh-dev-memory/config'].handler(
    jsonReq('POST', { enabled: false }, { origin: 'http://evil.example', host: '127.0.0.1:12393' }),
    res,
  );
  assert.equal(res.status, 403);
  assert.equal(JSON.parse(res.body).error, 'untrusted origin');
});

test('POST /dsh-dev-memory/config rejects missing origin', async () => {
  const { byPath } = mountWith();
  const res = mockRes();
  await byPath['/dsh-dev-memory/config'].handler(jsonReq('POST', { enabled: false }, { host: '127.0.0.1:12393' }), res);
  assert.equal(res.status, 403);
});

test('GET /dsh-dev-memory/workspaces returns registry rows and the active workspace id', async () => {
  const webServer = makeWebServer();
  mountDevMemoryRoutes(webServer, {
    getSnapshot() { return { config: {}, audit: [], health: {}, pendingLevel1: [] }; },
    updateConfig() { return {}; },
    listWorkspaces() { return { workspaces: [{ id: 'D--fish' }], activeWorkspaceId: 'D--fish' }; },
  });
  const route = Object.fromEntries(webServer.routes.map((r) => [r.path, r]))['/dsh-dev-memory/workspaces'];
  assert.ok(route);
  const res = mockRes();
  await route.handler({ method: 'GET', headers: {}, url: '/dsh-dev-memory/workspaces' }, res);
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.body), { workspaces: [{ id: 'D--fish' }], activeWorkspaceId: 'D--fish' });
});

test('GET /dsh-dev-memory/state?workspace=id is forwarded to the snapshot handler', async () => {
  const webServer = makeWebServer();
  let seen;
  mountDevMemoryRoutes(webServer, {
    getSnapshot(request) {
      seen = request.url;
      if (String(request.url).includes('missing')) {
        const err = new Error('unknown workspace: missing');
        err.status = 404;
        throw err;
      }
      return { config: { memoryRoot: '/browse/memory' }, audit: [], health: {}, pendingLevel1: [], browseWorkspaceId: 'D--other' };
    },
    updateConfig() { return {}; },
  });
  const route = Object.fromEntries(webServer.routes.map((r) => [r.path, r]))['/dsh-dev-memory/state'];
  const ok = mockRes();
  await route.handler({ method: 'GET', headers: {}, url: '/dsh-dev-memory/state?workspace=D--other' }, ok);
  assert.equal(seen, '/dsh-dev-memory/state?workspace=D--other');
  assert.equal(ok.status, 200);
  assert.equal(JSON.parse(ok.body).browseWorkspaceId, 'D--other');
  const missing = mockRes();
  await route.handler({ method: 'GET', headers: {}, url: '/dsh-dev-memory/state?workspace=missing' }, missing);
  assert.equal(missing.status, 404);
});

test('POST /dsh-dev-memory/workspaces mutates only from a trusted origin', async () => {
  const webServer = makeWebServer();
  let command;
  mountDevMemoryRoutes(webServer, {
    getSnapshot() { return {}; },
    updateConfig() { return {}; },
    mutateWorkspace(body) { command = body; return { id: body.id, pinned: true }; },
  });
  const route = Object.fromEntries(webServer.routes.map((r) => [r.path, r]))['/dsh-dev-memory/workspaces'];
  const denied = mockRes();
  await route.handler(jsonReq('POST', { action: 'pin', id: 'D--fish', pinned: true }, { origin: 'http://evil.example', host: '127.0.0.1:12393' }), denied);
  assert.equal(denied.status, 403);
  const ok = mockRes();
  await route.handler(jsonReq('POST', { action: 'pin', id: 'D--fish', pinned: true }, trustedHeaders()), ok);
  assert.equal(ok.status, 200);
  assert.equal(JSON.parse(ok.body).ok, true);
  assert.equal(command.action, 'pin');
});
