// Copied from TaskMint packages/client/src/components/ui/forms/__tests__/CurrencyInput.test.tsx @ 1623bee: keep the two in step.
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { CurrencyInput, MAX_AMOUNT, cleanAmount } from '../CurrencyInput';

describe('cleanAmount', () => {
  it.each([
    ['$1,234.5', '1234.5'],
    ['12.345', '12.34'],
    ['1.2.3', '1.23'],
    ['-5', '5'],
    ['', ''],
    ['.', '.'],
    ['123456789012', String(MAX_AMOUNT)],
    ['12345678', '12345678'],
  ])('keeps %j as %j', (typed, kept) => {
    expect(cleanAmount(typed)).toBe(kept);
  });
});

describe('CurrencyInput', () => {
  it('shows the amount kept from what was typed', () => {
    function Field() {
      const [amount, setAmount] = useState('');
      return <CurrencyInput label="Amount" value={amount} onChange={setAmount} error={false} />;
    }
    render(<Field />);

    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '$40.505' } });
    expect(screen.getByLabelText('Amount')).toHaveValue('40.50');
  });
});
