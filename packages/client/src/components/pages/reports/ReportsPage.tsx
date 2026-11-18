/**
 * Reports: a month looked back on (core's get_report). What the bills and
 * income came to against what was expected, by category; TaskMint's money
 * in (with TaskMint connected); the bills paid late; what went out besides the bills, by the
 * balance's updates; what the bank statements imported show was spent, by
 * category (core's get_spending), each opening to its transactions; and
 * the six months up to it side by side.
 */

import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import {
  AccountBalanceWallet as LeftIcon,
  CallReceived as IncomeIcon,
  ChevronLeft,
  ChevronRight,
  ReceiptLong as BillsIcon,
  Savings as WithdrawalIcon,
} from '@mui/icons-material';
import { type SxProps, type Theme, useTheme } from '@mui/material/styles';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import type { CategoryReport, MonthTotals, SpendingView } from '@budgetmint/contracts';
import { useNotification } from '../../../contexts/NotificationContext';
import { useBudget, useCoreQuery } from '../../../data/BudgetContext';
import { getShell } from '../../../shell';
import { saveFile } from '../../../utils/saveFile';
import { useTaskMint } from '../../../hooks/useTaskMint';
import { addMonths, formatDay, formatMonth } from '../../../utils/dates';
import { formatCents } from '../../../utils/money';
import { PageContainer, PageHeader } from '../../layout/PageLayout';
import { StatsCard } from '../../ui/display/StatsCard';
import { PHONE_TABLE } from '../../ui/tables/tableStyles';
import { axisMoney } from '../forecast/ForecastPage';
import { MONO, SECTION, STATS_GRID } from '../../../theme/layout';
import { PHONE } from '../../../theme/media';

const categoryName = (row: CategoryReport) =>
  `${row.category ?? 'No category'}${row.kind === 'income' ? ' (income)' : ''}`;

/**
 * The month shown is tinted in the table of six; on a phone its first cell is
 * pinned over the paper, so it takes the same tint on top.
 */
const SELECTED_TINT = 'rgba(var(--mui-palette-primary-mainChannel) / var(--mui-palette-action-selectedOpacity))';
const SELECTED_ROW = {
  [PHONE]: {
    '& tbody tr.Mui-selected > :first-of-type': {
      backgroundImage: `linear-gradient(${SELECTED_TINT}, ${SELECTED_TINT})`,
    },
  },
} as const;

/** The six months as bars: bills paid and money in, side by side (whole dollars on the axis). */
function MonthsChart({ months, taskmint }: { months: MonthTotals[]; taskmint: boolean }) {
  const theme = useTheme();
  const data = months.map(row => ({
    month: formatMonth(row.month).slice(0, 3),
    bills: row.billsCents / 100,
    income: (row.incomeCents + (taskmint ? row.withdrawalsCents : 0)) / 100,
  }));
  return (
    <Box sx={{ height: 200, mb: 2 }} aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid stroke={theme.palette.divider} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="month" stroke={theme.palette.text.secondary} fontSize={12} />
          <YAxis stroke={theme.palette.text.secondary} fontSize={12} width={56} tickFormatter={axisMoney} />
          <Legend />
          <Bar dataKey="income" name="Money in" fill={theme.palette.success.main} />
          <Bar dataKey="bills" name="Bills paid" fill={theme.palette.error.main} />
        </BarChart>
      </ResponsiveContainer>
    </Box>
  );
}

/** What the month's bank statements show was spent, by category: each opens to its transactions. */
function Spending({ spending }: { spending: SpendingView }) {
  /** The category whose transactions are shown. */
  const [shown, setShown] = useState<string | null>(null);
  const named = (category: string | null) => category ?? 'No category';
  return (
    <Paper component="section" aria-labelledby="spending-title" sx={SECTION}>
      <Typography id="spending-title" variant="h6" component="h2">
        Spending, by your bank statements
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {formatCents(spending.spentCents)} spent in the statements imported for this month, bills among it.
      </Typography>
      <TableContainer>
        <Table size="small" sx={PHONE_TABLE}>
          <TableHead>
            <TableRow>
              <TableCell>Category</TableCell>
              <TableCell align="right">Transactions</TableCell>
              <TableCell align="right">Spent</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {spending.categories.flatMap(row => {
              const name = named(row.category);
              const its = spending.transactions
                .map(kept => kept.transaction)
                .filter(kept => kept.flow === 'spend' && named(kept.category).toLowerCase() === name.toLowerCase());
              return [
                <TableRow key={name}>
                  <TableCell>
                    <Button
                      size="small"
                      color="inherit"
                      aria-expanded={shown === name}
                      onClick={() => setShown(current => (current === name ? null : name))}
                    >
                      {name}
                    </Button>
                  </TableCell>
                  <TableCell align="right">{row.count}</TableCell>
                  <TableCell align="right" sx={{ fontFamily: MONO }}>
                    {formatCents(row.cents)}
                  </TableCell>
                </TableRow>,
                ...(shown === name ? its : []).map(kept => (
                  <TableRow key={`${name} ${kept.id}`}>
                    <TableCell sx={{ pl: 4 }}>{kept.name}</TableCell>
                    <TableCell align="right">{formatDay(kept.on)}</TableCell>
                    <TableCell align="right" sx={{ fontFamily: MONO }}>
                      {formatCents(-kept.amountCents)}
                    </TableCell>
                  </TableRow>
                )),
              ];
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
}

export function ReportsPage() {
  const { today } = useCoreQuery('get_overview');
  const { core } = useBudget();
  const { showError } = useNotification();
  const [month, setMonth] = useState(today.slice(0, 7));
  const report = useCoreQuery('get_report', { month });
  const spending = useCoreQuery('get_spending', { month });
  const { shown: taskmintShown } = useTaskMint();
  const current = today.slice(0, 7);

  return (
    <PageContainer>
      <PageHeader
        title="Reports"
        subtitle={`${formatMonth(report.month)}: what came in and went out.`}
        actions={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
            <Button
              variant="outlined"
              onClick={() => {
                const { csv, fileStem } = core.call('export_month', { month });
                saveFile(getShell(), `${fileStem}.csv`, csv, 'text/csv').catch((error: Error) =>
                  showError(`It wasn’t saved: ${error.message}`)
                );
              }}
            >
              Download this month
            </Button>
            {/* Together on a line of their own where the button leaves no room (a phone) */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <IconButton aria-label="The month before" onClick={() => setMonth(addMonths(month, -1))}>
                <ChevronLeft />
              </IconButton>
              <Typography sx={{ minWidth: 150, textAlign: 'center', fontWeight: 600 }}>{formatMonth(month)}</Typography>
              <IconButton
                aria-label="The month after"
                onClick={() => setMonth(addMonths(month, 1))}
                disabled={month >= current}
              >
                <ChevronRight />
              </IconButton>
            </Box>
          </Box>
        }
      />

      {report.partial && (
        <Alert severity="info" sx={{ mb: 3 }}>
          BudgetMint reads a year and a month of what was paid here: this month may be missing some.
        </Alert>
      )}

      <Box sx={STATS_GRID}>
        <StatsCard
          title="Bills paid"
          value={formatCents(report.bills.doneCents)}
          subtitle={`Of ${formatCents(report.bills.expectedCents)} expected${report.bills.openCents > 0 ? `, ${formatCents(report.bills.openCents)} still to pay` : ''}`}
          icon={<BillsIcon fontSize="large" />}
          color="warning"
        />
        <StatsCard
          title="Income received"
          value={formatCents(report.income.doneCents)}
          subtitle={`Of ${formatCents(report.income.expectedCents)} expected`}
          icon={<IncomeIcon fontSize="large" />}
          color="success"
        />
        {taskmintShown && (
          <StatsCard
            title="From TaskMint"
            value={formatCents(report.withdrawalsCents)}
            subtitle="Withdrawals in the bank"
            icon={<WithdrawalIcon fontSize="large" />}
            color="info"
          />
        )}
        <StatsCard
          title="Left over"
          value={formatCents(report.netCents)}
          subtitle={`${report.unfinished ? 'So far: money in' : 'Money in'}, less the bills paid${
            report.spendingAssumedCents > 0
              ? `, before about ${formatCents(report.spendingAssumedCents)} of everyday spending`
              : ''
          }`}
          icon={<LeftIcon fontSize="large" />}
          color={report.netCents < 0 ? 'error' : 'primary'}
        />
      </Box>

      {report.outside && (
        <Paper component="section" aria-label="Spending besides the bills" sx={SECTION}>
          <Typography variant="h6" component="h2">
            Spending besides the bills
          </Typography>
          <Typography variant="body2" color="text.secondary">
            About {formatCents(report.outside.cents)} over the {report.outside.days} days your balance updates cover.
          </Typography>
        </Paper>
      )}

      {spending.categories.length > 0 && <Spending spending={spending} />}

      <Paper component="section" aria-labelledby="categories-title" sx={SECTION}>
        <Typography id="categories-title" variant="h6" component="h2" sx={{ mb: 2 }}>
          By category
        </Typography>
        {report.categories.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Nothing was due this month.
          </Typography>
        ) : (
          <TableContainer>
            <Table size="small" sx={PHONE_TABLE}>
              <TableHead>
                <TableRow>
                  <TableCell>Category</TableCell>
                  <TableCell align="right">Expected</TableCell>
                  <TableCell align="right">Paid</TableCell>
                  <TableCell align="right">Open</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {report.categories.map(row => (
                  <TableRow key={categoryName(row)}>
                    <TableCell>{categoryName(row)}</TableCell>
                    <TableCell align="right" sx={{ fontFamily: MONO }}>
                      {formatCents(row.totals.expectedCents)}
                    </TableCell>
                    <TableCell align="right" sx={{ fontFamily: MONO }}>
                      {formatCents(row.totals.doneCents)}
                    </TableCell>
                    <TableCell align="right" sx={{ fontFamily: MONO }}>
                      {row.totals.openCents > 0 ? formatCents(row.totals.openCents) : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>

      <Paper component="section" aria-labelledby="late-title" sx={SECTION}>
        <Typography id="late-title" variant="h6" component="h2" sx={{ mb: 1 }}>
          Paid late
        </Typography>
        {report.paidLate.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No bill was paid after it was due.
          </Typography>
        ) : (
          report.paidLate.map(late => (
            <Typography key={`${late.itemId} ${late.due}`} variant="body2">
              {late.name}: due {formatDay(late.due)}, paid {formatDay(late.paidOn)}
            </Typography>
          ))
        )}
      </Paper>

      <Paper component="section" aria-labelledby="months-title" sx={SECTION}>
        <Typography id="months-title" variant="h6" component="h2" sx={{ mb: 2 }}>
          Six months
        </Typography>
        <MonthsChart months={report.months} taskmint={taskmintShown} />
        <TableContainer>
          <Table size="small" sx={[PHONE_TABLE, SELECTED_ROW] as SxProps<Theme>}>
            <TableHead>
              <TableRow>
                <TableCell>Month</TableCell>
                <TableCell align="right">Bills paid</TableCell>
                <TableCell align="right">Income</TableCell>
                {taskmintShown && <TableCell align="right">TaskMint</TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {report.months.map(row => (
                <TableRow key={row.month} selected={row.month === report.month}>
                  <TableCell>{formatMonth(row.month)}</TableCell>
                  <TableCell align="right" sx={{ fontFamily: MONO }}>
                    {formatCents(row.billsCents)}
                  </TableCell>
                  <TableCell align="right" sx={{ fontFamily: MONO }}>
                    {formatCents(row.incomeCents)}
                  </TableCell>
                  {taskmintShown && (
                    <TableCell align="right" sx={{ fontFamily: MONO }}>
                      {formatCents(row.withdrawalsCents)}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </PageContainer>
  );
}
