/**
 * What's said of a bill, of income and of money moved between two bank
 * accounts, where the three differ: one table, so no page takes a transfer
 * for income.
 */

import type { ItemKind } from '@budgetmint/contracts';

interface KindWords {
  /** One that's happened: its chip, and the choice that says so. */
  done: string;
  /** "Rent marked paid". */
  verb: string;
  /** Still open after its day. */
  late: string;
  /** It goes by itself: its chip, and the switch that says so. */
  auto: string;
  autoSwitch: string;
  /** In the forecast's day table, after the name. */
  autoNote: string;
  /** The quick action on one still open. */
  mark: string;
  markNext: string;
  /** The choices in an occurrence's dialog. */
  stillOpen: string;
  doneOn: string;
  /** "$50.00 due Nov 12", and what follows on autopay. */
  expected: string;
  onAuto: string;
  /** The item form: the day of the month, its weekends, and "First due: …". */
  onDay: string;
  comes: string;
  weekend: string;
  /** Before an amount in a list: out, in, or neither. */
  sign: string;
  /** After saving with the balance moved too. */
  balanceSaid: string;
}

export const KIND_WORDS: Record<ItemKind, KindWords> = {
  bill: {
    done: 'Paid',
    verb: 'paid',
    late: 'Overdue',
    auto: 'Autopay',
    autoSwitch: 'Paid automatically (autopay)',
    autoNote: ' (autopay)',
    mark: 'Mark paid',
    markNext: 'Mark the next one paid',
    stillOpen: 'Still to pay',
    doneOn: 'Paid on',
    expected: 'due',
    onAuto: ', on autopay',
    onDay: 'Due on',
    comes: 'due',
    weekend: 'When it’s due on a Saturday or Sunday',
    sign: '−',
    balanceSaid: 'taken off your balance',
  },
  income: {
    done: 'Received',
    verb: 'received',
    late: 'Late',
    // Income that comes in on its own isn't "autopay": nothing is paid
    auto: 'Automatic',
    autoSwitch: 'Comes in automatically',
    autoNote: ' (automatic)',
    mark: 'Mark received',
    markNext: 'Mark the next one received',
    stillOpen: 'Still to come',
    doneOn: 'Received on',
    expected: 'expected',
    onAuto: ', comes in automatically',
    onDay: 'Comes on',
    comes: 'comes',
    weekend: 'When it comes on a Saturday or Sunday',
    sign: '+',
    balanceSaid: 'added to your balance',
  },
  transfer: {
    done: 'Moved',
    verb: 'moved',
    late: 'Overdue',
    auto: 'Automatic',
    autoSwitch: 'Moves automatically',
    autoNote: ' (automatic)',
    mark: 'Mark moved',
    markNext: 'Mark the next one moved',
    stillOpen: 'Still to move',
    doneOn: 'Moved on',
    expected: 'to move',
    onAuto: ', moves automatically',
    onDay: 'Moves on',
    comes: 'moves',
    weekend: 'When it’s on a Saturday or Sunday',
    sign: '',
    balanceSaid: 'the balances moved with it',
  },
};
