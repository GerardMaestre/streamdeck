const { parentPort, workerData } = require('worker_threads');

(async () => {
  try {
    const { pluginEntrypoint, hookName, payload } = workerData;
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const pluginModule = require(pluginEntrypoint);
    const hook = pluginModule?.[hookName];

    if (typeof hook === 'function') {
      await Promise.resolve(hook(payload));
    }

    parentPort.postMessage({ ok: true });
  } catch (error) {
    parentPort.postMessage({ ok: false, error: error.message });
  }
})();
