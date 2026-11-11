// Copied from TaskMint packages/client/src/components/ui/tables/tableStyles.ts @ 1623bee: keep the two in step.
/**
 * On a phone a wide table scrolls sideways inside its TableContainer
 * instead of squeezing its columns into tall rows. Its first column stays
 * put, so every row keeps its name in view. Desktop tables are unchanged.
 */

import type { SxProps, Theme } from '@mui/material/styles';
import { PHONE } from '../../../theme/media';

// Header cells are tinted with action.hover over the paper; a pinned cell
// needs an opaque background, so it paints the paper with the tint on top.
const HEAD_TINT = 'linear-gradient(var(--mui-palette-action-hover), var(--mui-palette-action-hover))';

export const PHONE_TABLE: SxProps<Theme> = {
  [PHONE]: {
    // Holds anything absolutely placed inside (a screen-reader-only column
    // name), which would otherwise widen the page past the scroller
    position: 'relative',
    '& th, & td': { whiteSpace: 'nowrap' },
    '& tr > :first-of-type': {
      position: 'sticky',
      left: 0,
      zIndex: 1,
      backgroundColor: 'background.paper',
    },
    // Above the body cells, and above a sticky header's other cells
    '& thead tr > :first-of-type': { zIndex: 3, backgroundImage: HEAD_TINT },
  },
};
