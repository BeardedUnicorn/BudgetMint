/**
 * Forecast: the balance day by day to the horizon (a line, with zero and
 * the low mark), TaskMint's withdrawals ahead with what's estimated in
 * them, and each day money moves. What it assumes is said, and changed in
 * Settings.
 */

import {
  Box,
  Button,
  Chip,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { BalanceFlag } from '../../budget/BalanceFlag';
import { useTheme } from '@mui/material/styles';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ForecastView, Flow } from '@budgetmint/contracts';
import { useCoreQuery } from '../../../data/BudgetContext';
import { useNavigation } from '../../../contexts/NavigationContext';
import { useCompactLayout } from '../../../hooks/useCompactLayout';
import { formatDay, formatMoment, formatWeekday } from '../../../utils/dates';
import { formatCents, formatMaybeCents, formatWholeCents } from '../../../utils/money';
import { formattingLocale } from '../../../utils/locale';
import { PageContainer, PageHeader } from '../../layout/PageLayout';
import { PHONE_TABLE } from '../../ui/tables/tableStyles';
import { SECTION } from '../overview/OverviewPage';

const MONO = '"Roboto Mono", monospace';

/** A flow's line in the day table. */
function flowLabel(flow: Flow): string {
  if (flow.kind === 'withdrawal')
    return flow.status === 'projected' ? 'TaskMint withdrawal (expected)' : 'TaskMint withdrawal';
  const note = { overdue: ' (overdue)', done: flow.kind === 'bill' ? ' (paid)' : ' (received)', autopay: ' (autopay)' }[
    flow.status as 'overdue' | 'done' | 'autopay'
  ];
  return `${flow.name}${note ?? ''}`;
}

/** What the forecast assumes about TaskMint, in words. */
export function assumptions(view: ForecastView): string[] {
  const { plan } = view;
  if (!plan.useForecast) return ['TaskMint’s withdrawals aren’t counted.'];
  const lines = [
    plan.policy.kind === 'asSoonAsOpen'
      ? 'You withdraw as soon as the site allows'
      : `You withdraw on ${new Intl.DateTimeFormat(formattingLocale(), { weekday: 'long' }).format(new Date(2026, 10, 2 + plan.policy.weekday))}s`,
    `it reaches the bank ${plan.arrivalDelayHours} hours later`,
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

/** The chart's money on its axis (whole dollars), and in its tooltip. */
export const axisMoney = (dollars: number) => formatWholeCents(dollars * 100);
export const tooltipMoney = (dollars: unknown): [string, string] => [formatCents(Number(dollars) * 100), 'Balance'];
export const tooltipDay = (day: unknown) => formatWeekday(String(day));

function BalanceChart({ view }: { view: ForecastView }) {
  const theme = useTheme();
  const compact = useCompactLayout();
  const data = view.days.map(day => ({ date: day.date, balance: day.closingCents / 100 }));
  // The picture in words, for those who can't see it: where it starts, its lowest point, where it ends
  const { lowest } = useCoreQuery('get_overview');
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
            <ReferenceLine y={view.lowBalanceCents / 100} stroke={theme.palette.warning.main} strokeDasharray="4 4" />
          )}
          <Line type="monotone" dataKey="balance" stroke={theme.palette.primary.main} strokeWidth={3} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </Box>
  );
}

export function ForecastPage() {
  const view = useCoreQuery('get_forecast');
  const { navigate } = useNavigation();
  const moving = view.days.filter(day => day.flows.length > 0);
  const last = view.days[view.days.length - 1];

  return (
    <PageContainer>
      <PageHeader
        title="Forecast"
        subtitle={`The next ${view.days.length - 1} days: ${formatCents(view.days[0].closingCents)} today, ${formatCents(last.closingCents)} on ${formatDay(last.date)}.`}
        actions={
          <Button variant="outlined" onClick={() => navigate('settings', { section: 'taskmint' })}>
            Assumptions
          </Button>
        }
      />

      <Paper component="section" aria-label="Balance ahead" sx={SECTION}>
        <BalanceChart view={view} />
        {assumptions(view).map(line => (
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
                {moving.flatMap(day =>
                  day.flows.map((flow, index) => (
                    <TableRow key={`${day.date} ${index}`}>
                      <TableCell>{index === 0 ? formatWeekday(day.date) : ''}</TableCell>
                      <TableCell>{flowLabel(flow)}</TableCell>
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
