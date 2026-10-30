import { parseHTML } from 'linkedom';
import vm from 'node:vm';
import { build } from 'esbuild';
export async function source(entry: string): Promise<string> {
  const result = await build({ entryPoints: [entry], bundle: true, write: false, format: 'iife', target: 'es2022' });
  return result.outputFiles[0]!.text;
}
export function harness(html: string, href = 'https://focus.test/allowed') {
  const { window: parsed } = parseHTML(html);
  // LinkeDOM's default window delegates unknown properties to Node's global object.
  // Use an independent event surface for page globals, as a browser realm would.
  const window = Object.assign(new parsed.EventTarget(), {
    document: parsed.document, Event: parsed.Event, HTMLAnchorElement: parsed.HTMLAnchorElement
  }) as unknown as typeof parsed;
  for (const input of window.document.querySelectorAll('input')) {
    if (input.type === 'checkbox') Object.defineProperty(input, 'checked', { value: input.hasAttribute('checked'), writable: true });
  }
  for (const select of window.document.querySelectorAll('select')) {
    let value = select.querySelector('option[selected]')?.getAttribute('value') ?? select.querySelector('option')?.getAttribute('value') ?? '';
    Object.defineProperty(select, 'value', { configurable: true, get: () => value, set: (next: string) => { value = next; } });
  }
  for (const form of window.document.querySelectorAll('form')) {
    Object.assign(form, { reset: () => {
      for (const input of form.querySelectorAll('input')) { input.value = ''; if (input.type === 'checkbox') (input as HTMLInputElement).checked = false; }
      for (const select of form.querySelectorAll('select')) select.value = select.querySelector('option')?.value ?? '';
    } });
  }
  const timers = new Map<number, () => void>(); let timer = 0;
  const location = { href };
  const history = {
    pushState(_state: unknown, _title: string, path: string) { location.href = new URL(path, location.href).href; },
    replaceState(_state: unknown, _title: string, path: string) { location.href = new URL(path, location.href).href; }
  };
  Object.assign(window, { location, history, stop: () => undefined });
  Object.defineProperty(window, 'top', { value: window, configurable: true });
  const context = vm.createContext({
    window, document: window.document, location, history, URL, Blob, crypto, TextEncoder, console,
    HTMLAnchorElement: window.HTMLAnchorElement,
    HTMLMediaElement: class { static [Symbol.hasInstance](value: { tagName?: string }) { return value?.tagName === 'VIDEO' || value?.tagName === 'AUDIO'; } },
    Event: window.Event, setTimeout: (fn: () => void) => { timers.set(++timer, fn); return timer; }, clearTimeout: (id: number) => timers.delete(id)
  });
  return { window, context, timers, location, run: (code: string) => vm.runInContext(code, context),
    fire: (target: EventTarget, type: string) => target.dispatchEvent(new window.Event(type, { bubbles: true, cancelable: true })) };
}
export async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise<void>(resolve => setImmediate(resolve));
}
