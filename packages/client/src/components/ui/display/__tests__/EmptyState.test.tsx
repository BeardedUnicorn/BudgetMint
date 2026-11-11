// Copied from TaskMint packages/client/src/components/ui/display/__tests__/EmptyState.test.tsx @ 1623bee: keep the two in step.
/**
 * Unit Tests for EmptyState Component
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { Button } from '@mui/material';
import { Timer as TimerIcon } from '@mui/icons-material';
import { EmptyState } from '../EmptyState';

describe('EmptyState', () => {
  it('renders the title', () => {
    render(<EmptyState title="Nothing here" />);

    expect(screen.getByText('Nothing here')).toBeInTheDocument();
  });

  it('renders the optional description and icon', () => {
    render(
      <EmptyState
        icon={<TimerIcon />}
        title="No sessions yet"
        description="Start a session to begin tracking your time."
      />
    );

    expect(screen.getByText('No sessions yet')).toBeInTheDocument();
    expect(screen.getByText('Start a session to begin tracking your time.')).toBeInTheDocument();
    expect(screen.getByTestId('TimerIcon')).toBeInTheDocument();
  });

  it('renders a working action slot', () => {
    const onClick = vi.fn();

    render(<EmptyState title="No sessions yet" action={<Button onClick={onClick}>Start a session</Button>} />);

    fireEvent.click(screen.getByRole('button', { name: 'Start a session' }));

    expect(onClick).toHaveBeenCalled();
  });

  it('omits description and action blocks when not provided', () => {
    render(<EmptyState title="Bare" />);

    expect(screen.getByText('Bare')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
