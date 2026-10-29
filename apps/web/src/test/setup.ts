import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

configure({ asyncUtilTimeout: 10_000 });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

// Browser APIs that jsdom lacks but Radix UI, the theme provider and the sidebar use.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }),
});

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => undefined;
Element.prototype.releasePointerCapture ??= () => undefined;
Element.prototype.scrollIntoView ??= () => undefined;
