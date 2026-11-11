// Copied from TaskMint packages/client/src/components/ui/visuallyHidden.ts @ 1623bee: keep the two in step.
/** Read by screen readers, not shown (a column header for icon buttons, say). */
export const VISUALLY_HIDDEN = {
  position: 'absolute',
  // Strings: in sx, a bare 1 is 100% and -1 is a spacing unit
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
} as const;
