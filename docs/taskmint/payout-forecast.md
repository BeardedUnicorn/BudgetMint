# The payout forecast (contract, schema 1)

What TaskMint publishes for other apps (BudgetMint) about the withdrawals to
come. It's built by `packages/client/src/utils/payoutForecast.ts` and
published by cloud sync ([ADR 0003](../adr/0003-payout-forecast.md)).

## Where

`users/{uid}/published/payoutForecast` in Firestore (project
`taskmint-f9a05`), readable by the signed-in owner only:

| Field | |
|---|---|
| `schema` | The contract's version (int). Skip a forecast with a newer one than you know. |
| `json` | The forecast below, as a JSON string |
| `hash` | FNV-1a 64 of `json`'s UTF-8 bytes, in hex |
| `deviceId` | The TaskMint device that wrote it |
| `appVersion` | That TaskMint's version |
| `epoch` | The account's TaskMint epoch |
| `updatedAt` | The server's time of writing |

Missing means no TaskMint device syncs with the account (or none has
published yet). It's deleted with TaskMint's cloud data.

## The forecast

All times are epoch milliseconds, all money integer cents.

| Field | |
|---|---|
| `schema` | `1` |
| `asOfMs` | The latest moment the data was written (imports, timers). The forecast holds from then on: no reader's now is earlier. |
| `fundsReleaseDays` | Days after work its earnings are released |
| `withdrawalIntervalMs` | The wait the payment site imposes between withdrawals |
| `lastImportMs` | When the ledger was last imported; `null` for never. TaskMint warns after 3 days. |
| `cutoff` | `{takenAtMs, amountCents}`: the latest withdrawal, which the curve counts from; `null` with none recorded |
| `recentWithdrawals` | `[{takenAtMs, amountCents}]`: the withdrawals of the 92 days up to the latest, newest first, 12 at most |
| `nextAllowedAtMs` | `cutoff.takenAtMs + withdrawalIntervalMs`; `null` with no cutoff |
| `scheduled` | `{releaseMs, dueMs}`: the withdrawal the user scheduled in TaskMint (for the release at `releaseMs`, due at `dueMs`), or `null` |
| `carried` | `{actualCents, estimatedCents, pastDueCents}`: in every withdrawal from `asOfMs` on, until one takes it |
| `carriedDays` | `[{day, actualCents, estimatedCents, pastDueCents}]`: `carried` by the work day (`YYYY-MM-DD` in `zone`) it was earned, oldest first. They add up to `carried`. |
| `steps` | `[{atMs, day, actualCents, estimatedCents, pastDueCents, open?}]`, by `atMs` (then `day`): money from work day `day` (`YYYY-MM-DD` in `zone`) becoming withdrawable at `atMs`. Several steps may share an `atMs`, one per work day. |
| `recentDays` | `[{day, actualCents, estimatedCents}]`: earnings per work day (`YYYY-MM-DD` in `zone`) for the 42 days up to the latest, oldest first; days with none are left out |
| `zone` | The IANA time zone of the device that built it |

- `actualCents` is the site's amounts (imported); `estimatedCents` tracked
  time not imported yet, at each timer's rate (TaskMint shows it with a `~`).
- `pastDueCents` is part of `actualCents`: money the site still listed as
  pending after its release time, so it waits on the site's approval.
- `day` and `carriedDays` say which work days' money a withdrawal takes:
  everything in `carriedDays` and every step at or before its time. A
  forecast from an older TaskMint has neither; read it as days unknown.
- New fields may appear without a new `schema`; ignore what you don't know.

### What a withdrawal takes

`W(t) = carried + Σ (steps with atMs ≤ t)`, for `t ≥ asOfMs`.

- The next withdrawal is allowed from `max(now, nextAllowedAtMs)` (any time
  with no cutoff), and one at `t1` takes `W(t1)`.
- Each one after it is allowed `withdrawalIntervalMs` after the one before:
  one at `t2` takes `W(t2) − W(t1)`.

### Open steps

A step with `open: {sinceMs, centsPerHour}` is a day whose timer hasn't
stopped: its money is as of `sinceMs`. At `now`:

- it has earned `estimatedCents + centsPerHour × (now − sinceMs) / 3_600_000`
  (rounded to cents; `centsPerHour` is 0 for a paused timer);
- it's released `fundsReleaseDays` calendar days (in `zone`) after the
  timer stops: assuming it stops now, at `max(atMs, now + fundsReleaseDays)`.

## Fixtures

[`payout-forecast/`](payout-forecast/) holds forecasts with TaskMint's own
answers at a fixed `nowMs`: `withdrawable` (`withdrawableAt` at each
`atMs`) and `next` (the next withdrawal: `opensAtMs`, `isOpen` and what it
takes; `null` with no withdrawal recorded). A reader must get the same
from the forecast alone. They're written by
`packages/client/src/utils/__tests__/payoutForecastFixtures.test.ts`
(`UPDATE_FIXTURES=1`).
