import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

class ResizeObserverMock {
  constructor(callback) {
    this.callback = callback;
  }

  observe(target) {
    this.callback([
      {
        target,
        contentRect: { width: 1200, height: 800 },
      },
    ]);
  }

  disconnect() {}
}

Object.defineProperty(globalThis, 'ResizeObserver', {
  writable: true,
  configurable: true,
  value: ResizeObserverMock,
});

if (!globalThis.URL) {
  globalThis.URL = {};
}

if (!globalThis.URL.createObjectURL) {
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
} else {
  vi.spyOn(globalThis.URL, 'createObjectURL').mockImplementation(() => 'blob:mock-url');
}

if (!globalThis.URL.revokeObjectURL) {
  globalThis.URL.revokeObjectURL = vi.fn();
} else {
  vi.spyOn(globalThis.URL, 'revokeObjectURL').mockImplementation(() => {});
}

if (!globalThis.requestAnimationFrame) {
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
}

if (!globalThis.cancelAnimationFrame) {
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
}
