/**
 * Test Setup Configuration
 *
 * This file is run before each test file and sets up the testing environment
 * with necessary polyfills, mocks, and global configurations.
 */

import '@testing-library/jest-dom/vitest';
import { setFormattingLocale } from './utils/locale';

// The app writes dates and money in the system's locale; tests expect US
// English text whatever machine runs them
setFormattingLocale('en-US');

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: vi.fn((key: string) => (key in store ? store[key] : null)),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = String(value);
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn((index: number) => Object.keys(store)[index] || null),
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

// Mock sessionStorage
const sessionStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn(),
};

Object.defineProperty(window, 'sessionStorage', {
  value: sessionStorageMock,
});

// Mock window.matchMedia
// Browsers have them; jsdom doesn't lay anything out to scroll to
Element.prototype.scrollIntoView = vi.fn();
Element.prototype.scrollTo = vi.fn();

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock ResizeObserver (vitest 4 requires constructible mocks: use `function`, not arrows)
global.ResizeObserver = vi.fn().mockImplementation(function () {
  return {
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  };
});

// Mock IntersectionObserver
global.IntersectionObserver = vi.fn().mockImplementation(function () {
  return {
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  };
});

// Mock URL.createObjectURL
Object.defineProperty(URL, 'createObjectURL', {
  writable: true,
  value: vi.fn(() => 'mocked-url'),
});

Object.defineProperty(URL, 'revokeObjectURL', {
  writable: true,
  value: vi.fn(),
});

// Mock navigator.clipboard - make it configurable for userEvent
Object.defineProperty(navigator, 'clipboard', {
  value: {
    writeText: vi.fn(() => Promise.resolve()),
    readText: vi.fn(() => Promise.resolve('')),
  },
  writable: true,
  configurable: true,
});

// Fresh storage for each test (vitest's clearMocks clears the mocks' calls)
beforeEach(() => {
  localStorageMock.clear();
  sessionStorageMock.clear();
});

// Back (navigation/backStack.ts) goes back through the window's history, and
// jsdom moves there a task later: the steps an app takes as it unmounts land
// before the next test, not in it (after Testing Library's cleanup, which
// runs first: vitest runs after-hooks last-registered first)
const nextTask = () => new Promise<void>(resolve => setTimeout(resolve, 0));
afterEach(async () => {
  await nextTask();
  await nextTask();
});
