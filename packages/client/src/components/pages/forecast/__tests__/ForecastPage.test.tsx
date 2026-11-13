import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import type { ForecastState, ForecastView } from '@budgetmint/contracts';
import { forecastDoc, item, monthly, override, startBudget, TEST_NOW } from '../../../../__tests__/setup/budget';
import { assumptions } from '../ForecastPage';

async function forecast(seed: Parameters<typeof startBudget>[0] = {}) {
  const started = await startBudget(seed);
  await started.user.click(screen.getByRole('button', { name: 'Forecast' }));
  return started;
}

const DAY = 86_400_000;

describe('the forecast', () => {
  it('lists each day money moves, with the balance it leaves', async () => {
    const autopay = monthly('gym', 'Gym', 15, 3_000, { autopay: true });
    await forecast({
      items: [monthly('rent', 'Rent', 12, 50_000), monthly('water', 'Water', 9, 1_000), autopay],
      settings: { balance: { cents: 100_000, asOf: '2026-11-08' }, lowBalanceCents: 60_000, horizonDays: 30 },
      overrides: [
        override({
          itemId: 'rent',
          date: '2026-11-12',
          status: { state: 'done', on: '2026-11-10', amountCents: 49_000 },
        }),
      ],
    });
    expect(screen.getByText('The next 30 days: $500.00 today, $460.00 on Dec 10.')).toBeInTheDocument();
    const days = screen.getByRole('region', { name: 'Day by day' });
    expect(within(days).getByText('Water (overdue)')).toBeInTheDocument();
    expect(within(days).getByText('Rent (paid)')).toBeInTheDocument();
    expect(within(days).getByText('Gym (autopay)')).toBeInTheDocument();
    expect(within(days).getByText('-$490.00')).toBeInTheDocument();
    // The chart says in words what it shows
    expect(
      screen.getByRole('img', {
        name: /^The balance day by day: \$[\d,.]+ today, lowest -?\$[\d,.]+ on \w+, \w+ \d+, -?\$[\d,.]+ on \w+ \d+$/,
      })
    ).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'TaskMint withdrawals ahead' })).not.toBeInTheDocument();
  });

  it('says how much income is due and unmarked, and so left out', async () => {
    const pay = item({
      id: 'pay',
      kind: 'income',
      name: 'Paycheck',
      schedule: [{ from: '2026-11-10', until: null, repeat: { every: 'once' }, amountCents: 80_000, weekends: 'keep' }],
    });
    await forecast({ items: [pay] });
    expect(
      screen.getByText('$800.00 of income is due but not marked received, so it isn’t counted.')
    ).toBeInTheDocument();
  });

  it('counts the everyday spending of the days between the ones listed, so the lines add up', async () => {
    await forecast({
      items: [monthly('rent', 'Rent', 12, 50_000), monthly('gym', 'Gym', 13, 3_000)],
      // $10 a day
      settings: { balance: { cents: 100_000, asOf: '2026-11-09' }, spendingWeeklyCents: 7_000, horizonDays: 14 },
    });
    const days = screen.getByRole('region', { name: 'Day by day' });
    // The 10th, 11th and 12th's spending comes off by the 12th, with the rent
    const spending = within(days).getByText('Everyday spending, 3 days').closest('tr')!;
    expect(spending).toHaveTextContent('-$30.00');
    expect(spending).toHaveTextContent('$470.00');
    // The day after: its own only
    expect(within(days).getByText('Everyday spending').closest('tr')).toHaveTextContent('-$10.00');
    // And the days after the last bill, so the table ends where the forecast does
    const rows = within(days).getAllByRole('row');
    expect(rows[rows.length - 1]).toHaveTextContent(/Tue, Nov 24.*Everyday spending, 11 days.*-\$110\.00.*\$320\.00/);
    expect(screen.getByText(/\$320\.00 on Nov 24\.$/)).toBeInTheDocument();
  });

  it('counts no spending on the balance’s own day', async () => {
    await forecast({
      items: [monthly('rent', 'Rent', 12, 50_000)],
      settings: { balance: { cents: 100_000, asOf: '2026-11-10' }, spendingWeeklyCents: 7_000, horizonDays: 14 },
    });
    const days = screen.getByRole('region', { name: 'Day by day' });
    // The 11th and the 12th: today's is in the balance already
    expect(within(days).getByText('Everyday spending, 2 days').closest('tr')).toHaveTextContent('-$20.00');
  });

  it('lists TaskMint’s withdrawals ahead, with what’s estimated', async () => {
    await forecast({
      settings: { balance: { cents: 0, asOf: '2026-11-09' } },
      forecast: forecastDoc({
        asOfMs: TEST_NOW,
        carried: { actualCents: 1_000 },
        steps: [{ atMs: TEST_NOW + 4 * DAY, actualCents: 500, estimatedCents: 200, pastDueCents: 0 }],
      }),
    });
    const ahead = screen.getByRole('region', { name: 'TaskMint withdrawals ahead' });
    const rows = within(ahead).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Open now');
    expect(rows[1]).toHaveTextContent('$10.00—');
    expect(rows[2]).toHaveTextContent('~$7.00$2.00');
    const days = screen.getByRole('region', { name: 'Day by day' });
    expect(within(days).getAllByText('TaskMint withdrawal (expected)')).toHaveLength(2);
  });

  it('says when no money moves, and opens the assumptions', async () => {
    const { user } = await forecast({ settings: { balance: { cents: 0, asOf: '2026-11-09' }, horizonDays: 14 } });
    expect(screen.getByText('No money moves before Nov 24.')).toBeInTheDocument();
    const scroll = vi.mocked(Element.prototype.scrollIntoView);
    scroll.mockClear();
    await user.click(screen.getByRole('button', { name: 'Assumptions' }));
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    // Where everyday spending, the horizon and the low mark are
    expect((scroll.mock.contexts[0] as Element).id).toBe('settings-forecast');
    expect(item).toBeDefined();
  });

  it('says what it assumes about TaskMint', () => {
    const view = (plan: Partial<ForecastView['plan']>, assumed = 0, state: ForecastState = 'ready') =>
      ({
        taskmint: { state },
        plan: {
          useForecast: true,
          policy: { kind: 'asSoonAsOpen' },
          minWithdrawalCents: 0,
          arrivalDelayHours: 24,
          countEstimates: true,
          countPastDue: true,
          future: { kind: 'off' },
          ...plan,
        },
        assumedPerDayCents: assumed,
      }) as ForecastView;
    expect(assumptions(view({ useForecast: false }))).toEqual(['TaskMint’s withdrawals aren’t counted.']);
    // Counted, but there's no forecast to count them from: why
    expect(assumptions(view({}, 0, 'missing'))).toEqual([
      'TaskMint isn’t connected, so its withdrawals aren’t counted.',
    ]);
    expect(assumptions(view({}, 0, 'newer'))).toEqual([
      'TaskMint’s forecast is from a newer version: update BudgetMint to count its withdrawals.',
    ]);
    expect(assumptions(view({}, 0, 'checking'))).toEqual(['TaskMint’s forecast hasn’t been read yet.']);
    expect(assumptions(view({}))).toEqual([
      'You withdraw as soon as the site allows, it reaches the bank 24 hours later.',
      'Counting time tracked but not imported and money still pending past its release.',
    ]);
    expect(
      assumptions(
        view(
          {
            policy: { kind: 'weekly', weekday: 4, hour: 9 },
            minWithdrawalCents: 5_000,
            countEstimates: false,
            countPastDue: false,
          },
          1_200
        )
      )
    ).toEqual([
      "You withdraw on Fridays, it reaches the bank 24 hours later, and only once there's $50.00.",
      'Assuming $12.00 earned a day from tomorrow.',
    ]);
  });

  it('lists each day under the other on a phone, marking the low and short ones', async () => {
    const { setPhoneViewport } = await import('../../../../__tests__/setup/viewport');
    setPhoneViewport();
    const { user } = await startBudget({
      items: [
        monthly('rent', 'Rent', 12, 50_000),
        item({
          id: 'pay',
          kind: 'income',
          name: 'Pay',
          schedule: [
            { from: '2026-11-13', until: null, repeat: { every: 'once' }, amountCents: 200_000, weekends: 'keep' },
          ],
        }),
        monthly('car', 'Car', 15, 300_000),
      ],
      settings: { balance: { cents: 100_000, asOf: '2026-11-09' }, lowBalanceCents: 60_000, horizonDays: 14 },
    });
    await user.click(
      within(screen.getByRole('navigation', { name: 'Pages' })).getByRole('button', { name: 'Forecast' })
    );
    const days = screen.getByRole('region', { name: 'Day by day' });
    expect(within(days).queryByRole('table')).not.toBeInTheDocument();
    const day = (name: string) => within(days).getByRole('heading', { name }).parentElement!.parentElement!;
    expect(within(day('Thu, Nov 12')).getByTitle('Low')).toBeInTheDocument();
    expect(day('Thu, Nov 12')).toHaveTextContent('Rent−$500.00'.replace('−', '-'));
    expect(day('Fri, Nov 13')).toHaveTextContent('+$2,000.00');
    expect(within(day('Sun, Nov 15')).getByTitle('Below zero')).toBeInTheDocument();
  });
});
