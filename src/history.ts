// MAIN world: no policy, extension API, URLs, messages with data, or secrets.
(() => {
  const key = Symbol.for('local-blocklist.history.v1');
  const scope = window as unknown as Record<symbol, unknown>;
  if (scope[key]) return;
  scope[key] = true;
  const dispatch = window.dispatchEvent.bind(window);
  const PageEvent = Event;
  const notify = () => { try { dispatch(new PageEvent('local-blocklist:location')); } catch { /* Notifications must not change History semantics. */ } };
  for (const method of ['pushState', 'replaceState'] as const) {
    const original = history[method];
    history[method] = function (...args: Parameters<History[typeof method]>): void {
      Reflect.apply(original, this, args);
      notify();
    };
  }
})();
