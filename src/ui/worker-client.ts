type WorkerRequest = {
  id: number;
  action: string;
  payload?: unknown;
};

let worker: Worker | null = null;
let sequence = 0;
const waiting = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();

function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('../lib/worker.mjs', import.meta.url), { type: 'module' });
  worker.onmessage = event => {
    const { id, result, error } = event.data || {};
    const pending = waiting.get(id);
    if (!pending) return;
    waiting.delete(id);
    if (error) pending.reject(new Error(error));
    else pending.resolve(result);
  };
  worker.onerror = event => {
    const error = new Error(event.message || '后台处理失败。');
    for (const pending of waiting.values()) pending.reject(error);
    waiting.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

export function callWorker<T = any>(action: string, payload: unknown = {}): Promise<T> {
  const active = ensureWorker();
  const id = ++sequence;
  return new Promise<T>((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    const request: WorkerRequest = { id, action, payload };
    active.postMessage(request);
  });
}

export function disposeWorker() {
  worker?.terminate();
  worker = null;
  waiting.clear();
}
