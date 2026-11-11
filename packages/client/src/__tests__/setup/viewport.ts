// Copied from TaskMint packages/client/src/__tests__/setup/viewport.ts @ 1623bee: keep the two in step.
/**
 * Tests run as a desktop: setupTests' window.matchMedia matches nothing.
 * setPhoneViewport() makes the rest of one test a phone (narrower than
 * 600px, touch only), so useCompactLayout() is true. The desktop answer
 * comes back when the test finishes.
 */

import { onTestFinished } from 'vitest';

const PHONE_FEATURES = ['max-width:599.95px', 'pointer: coarse', 'hover: none'];

function mediaQueryList(query: string, matches: boolean): MediaQueryList {
  return {
    matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList;
}

/** `also`: more media features that match (prefers-reduced-motion, say). */
export function setPhoneViewport(also: string[] = []): void {
  const matchMedia = vi.mocked(window.matchMedia);
  const features = [...PHONE_FEATURES, ...also].map(feature => feature.replace(/\s/g, ''));
  matchMedia.mockImplementation(query =>
    mediaQueryList(
      query,
      features.some(feature => query.replace(/\s/g, '').includes(feature))
    )
  );
  onTestFinished(() => {
    matchMedia.mockImplementation(query => mediaQueryList(query, false));
  });
}
