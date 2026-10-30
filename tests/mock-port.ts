function event<Args extends unknown[]>() {
  const listeners = new Set<(...args: Args) => void>();
  return {
    addListener: (listener: (...args: Args) => void) => { listeners.add(listener); },
    removeListener: (listener: (...args: Args) => void) => { listeners.delete(listener); },
    emit: (...args: Args) => { for (const listener of [...listeners]) listener(...args); },
    get size() { return listeners.size; }
  };
}
export function portPair(sender: browser.runtime.MessageSender = {}) {
  let closed = false;
  const clientMessages = event<[unknown]>(), serverMessages = event<[unknown]>();
  const clientDisconnect = event<[]>(), serverDisconnect = event<[]>();
  const client = {
    name: 'local-blocklist-request-v1', onMessage: clientMessages, onDisconnect: clientDisconnect,
    postMessage: (value: unknown) => {
      if (closed) throw new Error('Port closed');
      const copy = structuredClone(value);
      queueMicrotask(() => { if (!closed) serverMessages.emit(copy); });
    },
    disconnect: () => { if (!closed) { closed = true; serverDisconnect.emit(); } }
  };
  const server = {
    name: client.name, sender, onMessage: serverMessages, onDisconnect: serverDisconnect,
    postMessage: (value: unknown) => {
      if (closed) throw new Error('Port closed');
      const copy = structuredClone(value);
      queueMicrotask(() => { if (!closed) clientMessages.emit(copy); });
    },
    disconnect: () => { if (!closed) { closed = true; clientDisconnect.emit(); } }
  };
  return { client, server, get closed() { return closed; } };
}
export function connectTo(handler: (message: Record<string, unknown>) => Promise<unknown>) {
  return () => {
    const pair = portPair();
    pair.server.onMessage.addListener(message => {
      void handler(message as Record<string, unknown>).then(value => {
        if (pair.closed) return;
        if (value === undefined) pair.server.disconnect();
        else pair.server.postMessage(value);
      }, error => {
        if (!pair.closed) pair.server.postMessage({ ok: false, error: String(error.message) });
      });
    });
    return pair.client;
  };
}
