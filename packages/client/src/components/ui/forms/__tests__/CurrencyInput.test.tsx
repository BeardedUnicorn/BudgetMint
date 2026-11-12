// Adapted from TaskMint packages/client/src/components/ui/forms/__tests__/CurrencyInput.test.tsx @ 1623bee: the field reads either decimal mark, and tidies the amount when it's left.
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, it, expect } from 'vitest';
import { setFormattingLocale } from '../../../../utils/locale';
import { parseDollars } from '../../../../utils/money';
import { CurrencyInput, MAX_AMOUNT, cleanAmount } from '../CurrencyInput';

describe('cleanAmount', () => {
  it.each([
    ['$1,234.5', '1234.5'],
    ['-5', '5'],
    ['', ''],
    ['12345678', '12345678'],
    // Either mark before one or two last digits is the decimal one
    ['135,50', '135.50'],
    ['12,5', '12.5'],
    ['1.820,00', '1820.00'],
    ['1,820.5', '1820.5'],
    ['1 234,50 $', '1234.50'],
    // Before three digits a comma groups thousands, as several marks do
    ['1,820', '1820'],
    ['1,234,567', '1234567'],
    ['1.234.567', '1234567'],
    ['1,2345', '12345'],
    ['1.2.3', '12.3'],
    // A point alone, or the later of the two kinds, is the decimal mark: a third decimal is dropped
    ['12.345', '12.34'],
    ['1,234.567', '1234.56'],
    ['1.234,567', '1234.56'],
    // A mark just typed is kept, for the digits that follow
    ['.', '.'],
    [',', '.'],
    ['135,', '135.'],
    ['1,820.', '1820.'],
    ['1.820,', '1820.'],
    ['123456789012', String(MAX_AMOUNT)],
    ['123.456.789.012,50', String(MAX_AMOUNT)],
  ])('keeps %j as %j', (typed, kept) => {
    expect(cleanAmount(typed)).toBe(kept);
  });

  it.each([
    '1,200.5',
    '$40',
    '.5',
    '1234,50',
    '12,5',
    '1.234,50',
    '1 234,50 $',
    '1,200',
    '1,234,567.8',
    '1.234.567',
    '12,',
    '12.',
    '135,50',
  ])('reads %j as the balance form does', typed => {
    expect(parseDollars(cleanAmount(typed))).toBe(parseDollars(typed));
  });
});

describe('CurrencyInput', () => {
  afterEach(() => setFormattingLocale('en-US'));

  function Field({ start = '', onAmount }: { start?: string; onAmount?: (amount: string) => void }) {
    const [amount, setAmount] = useState(start);
    return (
      <>
        <CurrencyInput
          label="Amount"
          value={amount}
          onChange={typed => {
            setAmount(typed);
            onAmount?.(typed);
          }}
          error={false}
        />
        <button type="button" onClick={() => setAmount('')}>
          Start over
        </button>
      </>
    );
  }
  const field = () => screen.getByLabelText('Amount');
  const type = (text: string) => fireEvent.change(field(), { target: { value: text } });

  it('shows what is typed with its marks, and gives the amount kept from it', () => {
    let kept = '';
    render(<Field onAmount={amount => (kept = amount)} />);

    type('$1,8');
    expect(field()).toHaveValue('1,8');
    expect(kept).toBe('1.8');
    type('1,820');
    expect(field()).toHaveValue('1,820');
    expect(kept).toBe('1820');
    type('135,');
    expect(field()).toHaveValue('135,');
    type('135,50');
    expect(field()).toHaveValue('135,50');
    expect(kept).toBe('135.50');
  });

  it('writes the amount out in full once the field is left, and reads it again from there', () => {
    let kept = '';
    render(<Field onAmount={amount => (kept = amount)} />);

    type('13550');
    fireEvent.blur(field());
    expect(field()).toHaveValue('13,550.00');
    // Typed on from the tidied text
    type('13,550.005');
    expect(kept).toBe('13550.00');
    type('13,550.5');
    expect(kept).toBe('13550.5');
    fireEvent.blur(field());
    expect(field()).toHaveValue('13,550.50');
    // More than it takes: the most it takes
    type('123456789012');
    fireEvent.blur(field());
    expect(field()).toHaveValue(MAX_AMOUNT.toLocaleString('en-US', { minimumFractionDigits: 2 }));
  });

  it('shows an amount it starts with in full, none as empty, and a lone mark as typed', () => {
    render(<Field start="1200.5" />);
    expect(field()).toHaveValue('1,200.50');
    type('');
    fireEvent.blur(field());
    expect(field()).toHaveValue('');
    type('.');
    fireEvent.blur(field());
    expect(field()).toHaveValue('.');
  });

  it('follows the amount when it is changed from outside while typing', () => {
    render(<Field />);
    type('12,5');
    fireEvent.click(screen.getByRole('button', { name: 'Start over' }));
    expect(field()).toHaveValue('');
  });

  it('writes the amount as the locale does, and reads that back', () => {
    setFormattingLocale('de-DE');
    let kept = '';
    render(<Field onAmount={amount => (kept = amount)} />);
    type('1.820,5');
    expect(kept).toBe('1820.5');
    fireEvent.blur(field());
    expect(field()).toHaveValue('1.820,50');
    type('1.820,57');
    expect(kept).toBe('1820.57');
  });
});
