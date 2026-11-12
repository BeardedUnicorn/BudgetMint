/** Each page's icon, in the sidebar and the phone's bottom bar. */

import {
  Assessment as ReportsIcon,
  CalendarToday as CalendarIcon,
  Dashboard as OverviewIcon,
  Payments as IncomeIcon,
  ReceiptLong as BillsIcon,
  Savings as SavingsIcon,
  Settings as SettingsIcon,
  ShowChart as ForecastIcon,
} from '@mui/icons-material';
import type { SidebarView } from './views';

export const VIEW_ICONS: Record<SidebarView, typeof OverviewIcon> = {
  overview: OverviewIcon,
  bills: BillsIcon,
  income: IncomeIcon,
  savings: SavingsIcon,
  calendar: CalendarIcon,
  forecast: ForecastIcon,
  reports: ReportsIcon,
  settings: SettingsIcon,
};
