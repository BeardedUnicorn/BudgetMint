import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AmountSetting } from '../AmountSetting';

describe('AmountSetting', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const field = () => screen.getByLabelText('Low balance mark');
  const type = (text: string) => fireEvent.change(field(), { target: { value: text } });
  function show(onSave = vi.fn()) {
    const view = render(
      <AmountSetting label="Low balance mark" cents={10_000} onSave={onSave} helperText="Leave it empty for none." />
    );
    return { onSave, ...view };
  }

  it('says Saved for a moment once a typed amount is saved, then its hint again', () => {
    const { onSave } = show();
    expect(screen.getByText('Leave it empty for none.')).toBeInTheDocument();
    type('135,50');
    fireEvent.blur(field());
    expect(onSave).toHaveBeenCalledWith(13_550);
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
    expect(screen.queryByText('Leave it empty for none.')).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(screen.getByText('Leave it empty for none.')).toBeInTheDocument();
  });

  it('says nothing when the field is left as it was', () => {
    const { onSave } = show();
    fireEvent.blur(field());
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('says so when what is typed isn’t an amount, until it’s typed over', () => {
    const { onSave } = show();
    type('.');
    fireEvent.blur(field());
    expect(onSave).not.toHaveBeenCalled();
    expect(field()).toHaveValue('.');
    expect(field()).toBeInvalid();
    expect(screen.getByText('That isn’t an amount, so it wasn’t saved. Type one like 12.50.')).toBeInTheDocument();
    type('.5');
    expect(field()).toBeValid();
    expect(screen.getByText('Leave it empty for none.')).toBeInTheDocument();
    fireEvent.blur(field());
    expect(onSave).toHaveBeenCalledWith(50);
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
  });

  it('saves none when it’s emptied, and stops its timer when it goes', () => {
    const { onSave, unmount } = show();
    type('');
    fireEvent.blur(field());
    expect(onSave).toHaveBeenCalledWith(0);
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
