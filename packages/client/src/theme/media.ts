// Copied from TaskMint packages/client/src/theme/media.ts @ 1623bee: keep the two in step.
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
