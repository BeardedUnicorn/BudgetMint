/**
 * Forecast: the balance day by day to the horizon (a line, with zero and
 * the low mark, and what's left of it besides the money set aside for
 * bills), TaskMint's withdrawals ahead with what's estimated in them, and
 * each day money moves besides the everyday spending. What it assumes is
 * said, and changed in Settings.
 */

import {
  Box,
  Button,
  Chip,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { AccountScopeSelect } from '../../budget/AccountScopeSelect';
import { BalanceFlag } from '../../budget/BalanceFlag';
import { delayLabel } from '../settings/TaskMintSection';
import { useTheme } from '@mui/material/styles';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ForecastView, Flow } from '@budgetmint/contracts';
import { useForecast, useOverview } from '../../../data/BudgetContext';
import { useNavigation } from '../../../contexts/NavigationContext';
import { useCompactLayout } from '../../../hooks/useCompactLayout';
import { useTaskMint } from '../../../hooks/useTaskMint';
import { formatDay, formatMoment, formatWeekday } from '../../../utils/dates';
import { formatCents, formatMaybeCents, formatWholeCents } from '../../../utils/money';
import { KIND_WORDS } from '../../../utils/kinds';
import { LEFT_OUT } from '../../../utils/taskmint';
import { formattingLocale } from '../../../utils/locale';
import { PageContainer, PageHeader } from '../../layout/PageLayout';
import { PHONE_TABLE } from '../../ui/tables/tableStyles';
import { SECTION } from '../overview/OverviewPage';

const MONO = '"Roboto Mono", monospace';

/**
 * The days money moves besides the everyday spending (each day has that),
 * each with the spending of the days since the one listed before it: the
 * balance has fallen by all of them, so the lines add up to it.
 */
export function movingDays(days: ForecastView['days']): { day: ForecastView['days'][number]; spendingDays: number }[] {
  const moving: { day: ForecastView['days'][number]; spendingDays: number }[] = [];
  let spent = 0;
  let count = 0;
  for (const day of days) {
    const spending = day.flows.find(flow => flow.kind === 'spending');
    spent += spending?.amountCents ?? 0;
    count += 1;
    if (day.flows.some(flow => flow.kind !== 'spending')) {
      const flows = day.flows.map(flow => (flow === spending ? { ...flow, amountCents: spent } : flow));
      moving.push({ day: { ...day, flows }, spendingDays: count });
      spent = 0;
      count = 0;
    }
  }
  return moving;
}

/** A flow's line in the day table (`days`: how many days of everyday spending it stands for). */
function flowLabel(flow: Flow, days: number): string {
  if (flow.kind === 'spending') return days > 1 ? `Everyday spending, ${days} days` : 'Everyday spending';
  if (flow.kind === 'withdrawal')
    return flow.status === 'projected' ? 'TaskMint withdrawal (expected)' : 'TaskMint withdrawal';
  const words = KIND_WORDS[flow.kind];
  const note = {
    overdue: ' (overdue)',
    done: ` (${words.verb})`,
    autopay: words.autoNote,
  }[flow.status as 'overdue' | 'done' | 'autopay'];
  return `${flow.name}${note ?? ''}`;
}

/** What the forecast assumes about TaskMint, in words. */
export function assumptions(view: ForecastView): string[] {
  const { plan } = view;
  if (!plan.useForecast) return ['TaskMint’s withdrawals aren’t counted.'];
  const leftOut = LEFT_OUT[view.taskmint.state];
  if (leftOut) return [leftOut];
  const lines = [
    plan.policy.kind === 'asSoonAsOpen'
      ? 'You withdraw as soon as the site allows'
      : `You withdraw on ${new Intl.DateTimeFormat(formattingLocale(), { weekday: 'long' }).format(new Date(2026, 10, 2 + plan.policy.weekday))}s`,
    // As Settings says it: at once, so many hours later, or days
    `it reaches the bank ${delayLabel(plan.arrivalDelayHours).toLowerCase()}`,
  ];
  if (plan.minWithdrawalCents > 0) lines.push(`and only once there's ${formatCents(plan.minWithdrawalCents)}`);
  const counted = [
    plan.countEstimates && 'time tracked but not imported',
    plan.countPastDue && 'money still pending past its release',
  ].filter(Boolean);
  const sentences = [`${lines.join(', ')}.`];
  if (counted.length > 0) sentences.push(`Counting ${counted.join(' and ')}.`);
  if (view.assumedPerDayCents > 0)
    sentences.push(`Assuming ${formatCents(view.assumedPerDayCents)} earned a day from tomorrow.`);
  return sentences;
}

/** What the forecast assumes besides TaskMint, in words. */
export function spendingAssumption(view: ForecastView): string | null {
  const weekly = view.spendingWeeklyCents;
  return weekly > 0 ? `Everyday spending: ${formatCents(weekly)} a week, a day’s share each day.` : null;
}

/** The chart's money on its axis (whole dollars), and in its tooltip. */
export const axisMoney = (dollars: number) => formatWholeCents(dollars * 100);
export const tooltipMoney = (dollars: unknown, name?: unknown): [string, string] => [
  formatCents(Number(dollars) * 100),
  name === 'free' ? 'Besides what’s set aside' : 'Balance',
];
export const tooltipDay = (day: unknown) => formatWeekday(String(day));

function BalanceChart({ view }: { view: ForecastView }) {
  const theme = useTheme();
  const compact = useCompactLayout();
  const data = view.days.map(day => ({
    date: day.date,
    balance: day.closingCents / 100,
    free: (day.closingCents - day.setAsideCents) / 100,
  }));
  const setAside = view.days.some(day => day.setAsideCents > 0);
  // The picture in words, for those who can't see it: where it starts, its lowest point, where it ends
  const { lowest } = useOverview();
  const last = view.days[view.days.length - 1];
  const label = `The balance day by day: ${formatCents(view.days[0].closingCents)} today, lowest ${formatCents(lowest.cents)} on ${formatWeekday(lowest.date)}, ${formatCents(last.closingCents)} on ${formatDay(last.date)}`;
  return (
    <Box sx={{ height: compact ? 240 : 320 }} role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={theme.palette.divider} strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            tickFormatter={formatDay}
            tick={{ fill: theme.palette.text.secondary, fontSize: 12 }}
            minTickGap={24}
          />
          <YAxis
            tickFormatter={axisMoney}
            tick={{ fill: theme.palette.text.secondary, fontSize: 12 }}
            width={compact ? 56 : 72}
          />
          <Tooltip
            formatter={tooltipMoney}
            labelFormatter={tooltipDay}
            contentStyle={{
              background: theme.palette.background.paper,
              border: `1px solid ${theme.palette.divider}`,
              borderRadius: 8,
            }}
          />
          <ReferenceLine y={0} stroke={theme.palette.error.main} />
          {view.lowBalanceCents > 0 && (
            // Dotted and named, so it isn't taken for the dashed balance line
            <ReferenceLine
              y={view.lowBalanceCents / 100}
              stroke={theme.palette.warning.main}
              strokeDasharray="2 4"
              label={{
                value: 'Low mark',
                position: 'insideBottomRight',
                fill: theme.palette.text.secondary,
                fontSize: 11,
              }}
            />
          )}
          <Line type="monotone" dataKey="balance" stroke={theme.palette.primary.main} strokeWidth={3} dot={false} />
          {setAside && (
            <Line
              type="monotone"
              dataKey="free"
              stroke={theme.palette.secondary.main}
              strokeWidth={2}
              strokeDasharray="6 4"
              dot={false}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </Box>
  );
}

export function ForecastPage() {
  const view = useForecast();
  const { navigate } = useNavigation();
  const { shown: taskmintShown } = useTaskMint();
  const compact = useCompactLayout();
  // The days money moves besides the everyday spending (each day has that)
  const moving = movingDays(view.days);
  const spending = spendingAssumption(view);
  const last = view.days[view.days.length - 1];

  return (
    <PageContainer>
      <PageHeader
        title="Forecast"
        subtitle={`The next ${view.days.length - 1} days: ${formatCents(view.days[0].closingCents)} today, ${formatCents(last.closingCents)} on ${formatDay(last.date)}.`}
        actions={
          <>
            <AccountScopeSelect />
            <Button variant="outlined" onClick={() => navigate('settings', { section: 'forecast' })}>
              Assumptions
            </Button>
          </>
        }
      />

      <Paper component="section" aria-label="Balance ahead" sx={SECTION}>
        <BalanceChart view={view} />
        {[
          // TaskMint's only once it's connected: without it, there's nothing to assume
          ...(taskmintShown ? assumptions(view) : []),
          ...(spending ? [spending] : []),
          // Left out until it's marked received: the balance ahead runs low by it
          ...(view.lateIncomeCents > 0
            ? [`${formatCents(view.lateIncomeCents)} of income is due but not marked received, so it isn’t counted.`]
            : []),
          ...(view.days.some(day => day.setAsideCents > 0)
            ? ['The dashed balance line leaves out the money set aside.']
            : []),
        ].map(line => (
          <Typography key={line} variant="caption" color="text.secondary" component="p">
            {line}
          </Typography>
        ))}
      </Paper>

      {view.withdrawals.length > 0 && (
        <Paper component="section" aria-labelledby="withdrawals-title" sx={SECTION}>
          <Typography id="withdrawals-title" variant="h6" component="h2" sx={{ mb: 2 }}>
            TaskMint withdrawals ahead
          </Typography>
          <TableContainer>
            <Table size="small" sx={PHONE_TABLE}>
              <TableHead>
                <TableRow>
                  <TableCell>Withdrawn</TableCell>
                  <TableCell>In the bank</TableCell>
                  <TableCell align="right">Amount</TableCell>
                  <TableCell align="right">Of it, estimated</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {view.withdrawals.map(withdrawal => {
                  const uncertain = withdrawal.money.estimatedCents + withdrawal.money.assumedCents;
                  return (
                    <TableRow key={withdrawal.atMs}>
                      <TableCell>
                        {withdrawal.opensNow ? (
                          <Chip size="small" color="success" label="Open now" />
                        ) : (
                          formatMoment(withdrawal.atMs)
                        )}
                      </TableCell>
                      <TableCell>{formatWeekday(withdrawal.arrivesOn)}</TableCell>
                      <TableCell align="right" sx={{ fontFamily: MONO, fontWeight: 600 }}>
                        {formatMaybeCents(withdrawal.totalCents, uncertain > 0)}
                      </TableCell>
                      <TableCell align="right" sx={{ fontFamily: MONO }}>
                        {uncertain > 0 ? formatCents(uncertain) : '—'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      <Paper component="section" aria-labelledby="days-title" sx={SECTION}>
        <Typography id="days-title" variant="h6" component="h2" sx={{ mb: 2 }}>
          Day by day
        </Typography>
        {moving.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No money moves before {formatDay(last.date)}.
          </Typography>
        ) : compact ? (
          // A phone has no room for four columns: each day, its money, and the balance it leaves
          <Stack spacing={2}>
            {moving.map(({ day, spendingDays }) => (
              <Box key={day.date}>
                <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <Typography variant="subtitle2" component="h3" sx={{ fontWeight: 600 }}>
                    {formatWeekday(day.date)}
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{
                      fontFamily: MONO,
                      fontWeight: 600,
                      color: day.short ? 'error.main' : day.low ? 'warning.main' : 'text.secondary',
                    }}
                  >
                    <BalanceFlag short={day.short} low={day.low} />
                    Balance {formatCents(day.closingCents)}
                  </Typography>
                </Stack>
                {day.flows.map((flow, index) => (
                  <Stack key={index} direction="row" sx={{ justifyContent: 'space-between', gap: 1 }}>
                    <Typography variant="body2">{flowLabel(flow, spendingDays)}</Typography>
                    <Typography
                      variant="body2"
                      sx={{ fontFamily: MONO, color: flow.amountCents > 0 ? 'success.main' : 'text.primary' }}
                    >
                      {flow.amountCents > 0 ? '+' : ''}
                      {formatMaybeCents(flow.amountCents, flow.uncertainCents > 0)}
                    </Typography>
                  </Stack>
                ))}
              </Box>
            ))}
          </Stack>
        ) : (
          <TableContainer>
            <Table size="small" sx={PHONE_TABLE}>
              <TableHead>
                <TableRow>
                  <TableCell>Day</TableCell>
                  <TableCell>What</TableCell>
                  <TableCell align="right">Amount</TableCell>
                  <TableCell align="right">Balance</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {moving.flatMap(({ day, spendingDays }) =>
                  day.flows.map((flow, index) => (
                    <TableRow key={`${day.date} ${index}`}>
                      <TableCell>{index === 0 ? formatWeekday(day.date) : ''}</TableCell>
                      <TableCell>{flowLabel(flow, spendingDays)}</TableCell>
                      <TableCell
                        align="right"
                        sx={{ fontFamily: MONO, color: flow.amountCents > 0 ? 'success.main' : 'text.primary' }}
                      >
                        {flow.amountCents > 0 ? '+' : ''}
                        {formatMaybeCents(flow.amountCents, flow.uncertainCents > 0)}
                      </TableCell>
                      <TableCell
                        align="right"
                        sx={{
                          fontFamily: MONO,
                          fontWeight: 600,
                          color: day.short ? 'error.main' : day.low ? 'warning.main' : undefined,
                        }}
                      >
                        {index === day.flows.length - 1 && (
                          <>
                            <BalanceFlag short={day.short} low={day.low} />
                            {formatCents(day.closingCents)}
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>
    </PageContainer>
  );
}
