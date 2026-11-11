/**
 * Reports: a month looked back on (core's get_report). What the bills and
 * income came to against what was expected, by category; TaskMint's money
 * in; the bills paid late; what went out besides the bills, by the
 * balance's updates; and the six months up to it side by side.
 */

import { useState } from 'react';
import {
  Alert,
  Box,
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
import type { CategoryReport } from '@budgetmint/contracts';
import { useCoreQuery } from '../../../data/BudgetContext';
import { addMonths, formatDay, formatMonth } from '../../../utils/dates';
import { formatCents } from '../../../utils/money';
import { PageContainer, PageHeader } from '../../layout/PageLayout';
import { StatsCard } from '../../ui/display/StatsCard';
import { PHONE_TABLE } from '../../ui/tables/tableStyles';
import { SECTION, STATS_GRID } from '../overview/OverviewPage';

const MONO = '"Roboto Mono", monospace';

const categoryName = (row: CategoryReport) =>
  `${row.category ?? 'No category'}${row.kind === 'income' ? ' (income)' : ''}`;

export function ReportsPage() {
  const { today } = useCoreQuery('get_overview');
  const [month, setMonth] = useState(today.slice(0, 7));
  const report = useCoreQuery('get_report', { month });
  const current = today.slice(0, 7);

  return (
    <PageContainer>
      <PageHeader
        title="Reports"
        subtitle={`${formatMonth(report.month)}: what came in and went out.`}
        actions={
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
        <StatsCard
          title="From TaskMint"
          value={formatCents(report.withdrawalsCents)}
          subtitle="Withdrawals in the bank"
          icon={<WithdrawalIcon fontSize="large" />}
          color="info"
        />
        <StatsCard
          title="Left over"
          value={formatCents(report.netCents)}
          subtitle={report.unfinished ? 'So far this month' : 'Money in, less the bills paid'}
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
        <TableContainer>
          <Table size="small" sx={PHONE_TABLE}>
            <TableHead>
              <TableRow>
                <TableCell>Month</TableCell>
                <TableCell align="right">Bills paid</TableCell>
                <TableCell align="right">Income</TableCell>
                <TableCell align="right">TaskMint</TableCell>
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
                  <TableCell align="right" sx={{ fontFamily: MONO }}>
                    {formatCents(row.withdrawalsCents)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </PageContainer>
  );
}
