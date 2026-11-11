/**
 * The mark beside a day's closing balance that's below zero or below the
 * low mark, so the color isn't the only thing that says so.
 */

import { ErrorOutlined as ShortIcon, WarningAmber as LowIcon } from '@mui/icons-material';

const SX = { fontSize: '1em', verticalAlign: '-0.125em', mr: 0.5 };

export function BalanceFlag({
  short,
  low,
  hidden = false,
}: {
  short: boolean;
  low: boolean;
  /** Its surroundings say it already (a label on the whole day): hidden from screen readers. */
  hidden?: boolean;
}) {
  if (!short && !low) return null;
  const Icon = short ? ShortIcon : LowIcon;
  const name = short ? 'Below zero' : 'Low';
  return hidden ? <Icon aria-hidden sx={SX} /> : <Icon titleAccess={name} sx={SX} />;
}
