export const DEFAULT_JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
export const DEFAULT_JEV_MODEL = 'jev-latest';
export const DEFAULT_JEV_TIMEOUT_MS = 10_000;

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function unavailable(category, message, status) {
  const error = { category, message };
  if (status !== undefined) error.status = status;
  return { ok: false, error };
}

function classifyStatus(status) {
  if (status === 401 || status === 403) return 'authentication';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'server';
  return 'http';
}

export function makeJevService({
  apiKey,
  resolveApiKey,
  model = DEFAULT_JEV_MODEL,
  endpoint = DEFAULT_JEV_ENDPOINT,
  timeoutMs = DEFAULT_JEV_TIMEOUT_MS,
  fetch: request = globalThis.fetch,
} = {}) {
  const staticKey = typeof apiKey === 'string' ? apiKey.trim() : '';
  const effectiveModel = typeof model === 'string' && model.trim() ? model.trim() : DEFAULT_JEV_MODEL;
  const effectiveEndpoint = typeof endpoint === 'string' && endpoint.trim() ? endpoint.trim() : DEFAULT_JEV_ENDPOINT;
  const effectiveTimeout = Number.isInteger(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_JEV_TIMEOUT_MS;

  return {
    async decide({ state, questions } = {}) {
      let key = staticKey;
      if (typeof resolveApiKey === 'function') {
        try { key = String(await resolveApiKey() || '').trim(); }
        catch (err) { return unavailable('credential', err && err.message ? err.message : 'Jev credential could not be resolved'); }
      }
      if (!key) return unavailable('missing_api_key', 'Jev API key is not configured');
      if (typeof request !== 'function') return unavailable('unsupported_configuration', 'Jev fetch transport is unavailable');

      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      let timer;
      const timedFetch = new Promise((resolve, reject) => {
        timer = setTimeout(() => {
          if (controller) controller.abort();
          const error = new Error('Jev request timed out');
          error.code = 'JEV_TIMEOUT';
          reject(error);
        }, effectiveTimeout);
        Promise.resolve(request(effectiveEndpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ model: effectiveModel, state, questions }),
          signal: controller ? controller.signal : undefined,
        })).then(resolve, reject);
      });

      let response;
      try {
        response = await timedFetch;
      } catch (err) {
        if (err && err.code === 'JEV_TIMEOUT') return unavailable('timeout', 'Jev request timed out');
        return unavailable('network', err && err.message ? err.message : 'Jev network request failed');
      } finally {
        clearTimeout(timer);
      }

      if (!response || typeof response.status !== 'number') return unavailable('network', 'Jev returned no HTTP response');
      if (!response.ok) {
        return unavailable(classifyStatus(response.status), `Jev request failed with HTTP ${response.status}`, response.status);
      }

      let body;
      try {
        if (typeof response.json !== 'function') throw new Error('response has no JSON body');
        body = await response.json();
      } catch {
        return unavailable('malformed_response', 'Jev response was not valid JSON');
      }
      if (!isPlainObject(body) || typeof body.model !== 'string' || !isPlainObject(body.answers)) {
        return unavailable('unexpected_response', 'Jev response did not contain model and answers');
      }
      return { ok: true, model: body.model, answers: body.answers, ...(body.usage === undefined ? {} : { usage: body.usage }) };
    },
  };
}
