import { execute } from './worker-core.mjs';

self.onmessage = event => {
  const { id, action, payload } = event.data || {};
  try {
    const result = execute(action, payload);
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error?.message || String(error) });
  }
};
