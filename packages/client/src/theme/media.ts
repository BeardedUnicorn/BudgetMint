// Copied from TaskMint packages/client/src/theme/media.ts @ 5c802e7: keep the two in step.
/**
 * The media queries behind the phone layout. A desktop window is at least
 * 800px wide and driven by a mouse, so it never matches any of these: phone
 * styles go under them, and everything else keeps the desktop look.
 */

/** Narrower than MUI's `sm` breakpoint: a phone held upright. Same as `theme.breakpoints.down('sm')`. */
export const PHONE = '@media (max-width:599.95px)';

/** The main pointer is a finger, so controls need room to be tapped. */
export const TOUCH = '@media (pointer: coarse)';

/** A pointer that can hover. A tap would leave a hover tint stuck on. */
export const HOVER = '@media (hover: hover)';

/** The phone's bottom bar of tabs (MUI's BottomNavigation height), above the gesture bar's inset. */
export const BOTTOM_BAR_HEIGHT = 56;

/**
 * The room to leave along the bottom for a phone's navigation bar or gesture
 * area, which the app draws under. Android's webview reports none for it in
 * env(safe-area-inset-bottom), so the app also sets --system-bottom-inset
 * from what Android says (useSystemBottomInset).
 */
export const SAFE_BOTTOM = 'max(env(safe-area-inset-bottom, 0px), var(--system-bottom-inset, 0px))';
