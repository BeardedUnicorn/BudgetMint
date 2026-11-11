/**
 * Overview: where the balance is going. Today's balance and the lowest it
 * gets, what's overdue, what's due this week and coming in, TaskMint's next
 * withdrawal, and the next two weeks day by day.
 */

import { useState } from 'react';
import { Alert, Box, Button, Paper, Stack, Typography } from '@mui/material';
import {
  Add as AddIcon,
  CallReceived as IncomeIcon,
  EventNote as DueIcon,
  Savings as WithdrawalIcon,
  TrendingDown as LowestIcon,
} from '@mui/icons-material';
import type { UpcomingDay } from '@budgetmint/contracts';
import { useCoreQuery } from '../../../data/BudgetContext';
import { useNavigation } from '../../../contexts/NavigationContext';
import { PHONE } from '../../../theme/media';
import { formatDay, formatRelativeDay, formatWeekday } from '../../../utils/dates';
import { formatCents, formatMaybeCents } from '../../../utils/money';
import { BalanceDialog } from '../../budget/BalanceDialog';
import { ItemDialog } from '../../budget/ItemDialog';
import { OccurrenceList } from '../../budget/OccurrenceList';
import { PageContainer, PageHeader } from '../../layout/PageLayout';
import { EmptyState } from '../../ui/display/EmptyState';
import { StatsCard } from '../../ui/display/StatsCard';

const MONO = '"Roboto Mono", monospace';

export const STATS_GRID = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
  gap: 3,
  mb: 4,
  [PHONE]: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 2, mb: 3 },
} as const;

export const SECTION = { p: 3, mb: 4, [PHONE]: { p: 2, mb: 3 } } as const;

function UpcomingDays({ days, today }: { days: UpcomingDay[]; today: string }) {
  return (
    <Stack spacing={2}>
      {days.map(day => (
        <Box key={day.date}>
          <Stack direction="row" sx={{ alignItems: 'baseline', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography variant="subtitle2" component="h3" sx={{ fontWeight: 600 }}>
              {formatRelativeDay(day.date, today)}
            </Typography>
            <Typography
              variant="caption"
              sx={{ fontFamily: MONO, color: day.closingCents < 0 ? 'error.main' : 'text.secondary' }}
            >
              Balance {formatCents(day.closingCents)}
            </Typography>
          </Stack>
          <OccurrenceList occurrences={day.occurrences} today={today} />
          {day.withdrawalCents > 0 && (
            <Stack direction="row" sx={{ py: 0.5, justifyContent: 'space-between' }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                TaskMint withdrawal
              </Typography>
              <Typography sx={{ fontFamily: MONO, fontWeight: 600, color: 'secondary.main' }}>
                +{formatMaybeCents(day.withdrawalCents, day.withdrawalUncertainCents > 0)}
              </Typography>
            </Stack>
          )}
        </Box>
      ))}
    </Stack>
  );
}

export function OverviewPage() {
  const overview = useCoreQuery('get_overview');
  const { settings } = useCoreQuery('get_settings');
  const items = useCoreQuery('get_items');
  const { navigate } = useNavigation();
  const [dialog, setDialog] = useState<'balance' | 'bill' | null>(null);
  const { today, balance, lowest, firstShort, firstLow, nextWithdrawal } = overview;

  const withdrawalValue = nextWithdrawal
    ? formatMaybeCents(
        nextWithdrawal.totalCents,
        nextWithdrawal.money.estimatedCents + nextWithdrawal.money.assumedCents > 0
      )
    : '—';
  const withdrawalSubtitle = nextWithdrawal
    ? nextWithdrawal.opensNow
      ? `Open now, in the bank ${formatDay(nextWithdrawal.arrivesOn)}`
      : `${formatWeekday(nextWithdrawal.arrivesOn)}, in the bank`
    : overview.taskmint.state === 'ready'
      ? 'Nothing to withdraw yet'
      : 'TaskMint isn’t connected';

  return (
    <PageContainer>
      <PageHeader
        title="Overview"
        subtitle={
          balance
            ? `From your balance of ${formatCents(balance.cents)} at the end of ${formatDay(balance.asOf)}`
            : 'Set your balance to see where it goes'
        }
        actions={
          <>
            <Button variant="outlined" onClick={() => setDialog('balance')}>
              Update balance
            </Button>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialog('bill')}>
              Add bill
            </Button>
          </>
        }
      />

      {!balance && (
        <Alert
          severity="info"
          sx={{ mb: 3 }}
          action={
            <Button color="inherit" size="small" onClick={() => setDialog('balance')}>
              Set balance
            </Button>
          }
        >
          Until you set your balance, the forecast starts from $0.
        </Alert>
      )}
      {firstShort ? (
        <Alert severity="error" sx={{ mb: 3 }}>
          Your balance goes below zero on {formatWeekday(firstShort.date)}, to {formatCents(firstShort.cents)}.
        </Alert>
      ) : (
        // Not short: a low day is below a mark above zero
        firstLow && (
          <Alert severity="warning" sx={{ mb: 3 }}>
            Your balance goes below {formatCents(overview.lowBalanceCents)} on {formatWeekday(firstLow.date)}, to{' '}
            {formatCents(firstLow.cents)}.
          </Alert>
        )
      )}

      <Paper component="section" aria-label="Balance today" sx={SECTION}>
        <Typography variant="overline" color="text.secondary">
          Balance today
        </Typography>
        <Typography
          variant="h4"
          component="p"
          sx={{ fontFamily: MONO, fontWeight: 700, color: overview.todayCents < 0 ? 'error.main' : 'success.main' }}
        >
          {formatCents(overview.todayCents)}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Lowest in the next {overview.horizonDays} days: {formatCents(lowest.cents)} on {formatWeekday(lowest.date)}
        </Typography>
      </Paper>

      <Box sx={STATS_GRID}>
        <StatsCard
          title="Due this week"
          value={formatCents(overview.dueThisWeek.cents)}
          subtitle={overview.dueThisWeek.count === 1 ? '1 bill' : `${overview.dueThisWeek.count} bills`}
          icon={<DueIcon fontSize="large" />}
          color="warning"
        />
        <StatsCard
          title="Coming in"
          value={formatCents(overview.incomeAheadCents)}
          subtitle="In the next 14 days"
          icon={<IncomeIcon fontSize="large" />}
          color="success"
        />
        <StatsCard
          title="Next TaskMint withdrawal"
          value={withdrawalValue}
          subtitle={withdrawalSubtitle}
          icon={<WithdrawalIcon fontSize="large" />}
          color="info"
        />
        <StatsCard
          title="Lowest ahead"
          value={formatCents(lowest.cents)}
          subtitle={formatWeekday(lowest.date)}
          icon={<LowestIcon fontSize="large" />}
          color={lowest.cents < 0 ? 'error' : 'primary'}
        />
      </Box>

      {overview.overdue.length + overview.lateIncome.length > 0 && (
        <Paper component="section" aria-labelledby="overdue-title" sx={SECTION}>
          <Typography id="overdue-title" variant="h6" component="h2" sx={{ mb: 1 }}>
            Past due
          </Typography>
          <OccurrenceList occurrences={[...overview.overdue, ...overview.lateIncome]} today={today} />
        </Paper>
      )}

      {items.length === 0 ? (
        <EmptyState
          icon={<DueIcon sx={{ fontSize: 48 }} />}
          title="No bills yet"
          description="Add your bills and other income, and see your balance ahead."
          action={
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialog('bill')}>
              Add your first bill
            </Button>
          }
        />
      ) : (
        <Paper component="section" aria-labelledby="upcoming-title" sx={SECTION}>
          <Stack direction="row" sx={{ alignItems: 'baseline', justifyContent: 'space-between', mb: 2 }}>
            <Typography id="upcoming-title" variant="h6" component="h2">
              The next 14 days
            </Typography>
            <Button size="small" onClick={() => navigate('calendar')}>
              Calendar
            </Button>
          </Stack>
          {overview.upcoming.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              Nothing due or coming in.
            </Typography>
          ) : (
            <UpcomingDays days={overview.upcoming} today={today} />
          )}
        </Paper>
      )}

      {dialog === 'balance' && <BalanceDialog balance={balance} today={today} onClose={() => setDialog(null)} />}
      {dialog === 'bill' && (
        <ItemDialog
          kind="bill"
          today={today}
          defaultLeadDays={settings.reminders.leadDays}
          onClose={() => setDialog(null)}
        />
      )}
    </PageContainer>
  );
}
