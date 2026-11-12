import { describe, expect, it, vi } from 'vitest';
import { registerServiceWorker, SERVICE_WORKER_URL } from '../register';

/** A navigator with a service worker container whose register() answers `outcome`. */
function navigatorWith(outcome: Promise<unknown>) {
  return { serviceWorker: { register: vi.fn(() => outcome) } } as unknown as Navigator & {
    serviceWorker: { register: ReturnType<typeof vi.fn> };
  };
}

describe('registering the service worker', () => {
  it('registers /sw.js once the page has loaded', async () => {
    const nav = navigatorWith(Promise.resolve({}));
    registerServiceWorker(true, nav, window);
    expect(nav.serviceWorker.register).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('load'));
    window.dispatchEvent(new Event('load'));
    expect(nav.serviceWorker.register).toHaveBeenCalledTimes(1);
    expect(nav.serviceWorker.register).toHaveBeenCalledWith(SERVICE_WORKER_URL);
  });

  it('goes on without it when the browser refuses', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const refused = new Error('The operation is insecure');
    registerServiceWorker(true, navigatorWith(Promise.reject(refused)), window);
    window.dispatchEvent(new Event('load'));
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(expect.any(String), refused));
    warn.mockRestore();
  });

  it('registers nothing in development, or in a browser without service workers', () => {
    const nav = navigatorWith(Promise.resolve({}));
    const win = { addEventListener: vi.fn() } as unknown as Window;
    registerServiceWorker(false, nav, win);
    registerServiceWorker(true, {} as Navigator, win);
    expect(win.addEventListener).not.toHaveBeenCalled();
    // The defaults: this page's (jsdom has no service workers)
    registerServiceWorker(true);
    window.dispatchEvent(new Event('load'));
  });
});
