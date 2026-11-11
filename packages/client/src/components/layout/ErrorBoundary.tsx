/**
 * What shows when a page fails while rendering: the problem and a way to
 * try again, instead of React's blank window. When core itself stopped,
 * trying again can't help: the way out is a reload.
 */

import { Component, type ReactNode } from 'react';
import { Alert, Button, Stack, Typography } from '@mui/material';
import { cloudErrorMessage } from '../../cloud/errors';
import { CoreStopped } from '../../core';
import { AuthLayout } from '../auth/AuthLayout';

interface Props {
  children: ReactNode;
  /** Tests: what reloading does. */
  reload?: () => void;
}

export class ErrorBoundary extends Component<Props, { problem: string | null; stopped: boolean }> {
  state = { problem: null, stopped: false };

  static getDerivedStateFromError(error: unknown) {
    return { problem: cloudErrorMessage(error), stopped: error instanceof CoreStopped };
  }

  componentDidCatch(error: unknown) {
    console.error('BudgetMint stopped on an error:', error);
  }

  render() {
    const { problem, stopped } = this.state;
    if (problem === null) return this.props.children;
    const { reload = () => window.location.reload() } = this.props;
    return (
      <AuthLayout title="BudgetMint ran into a problem">
        <Stack spacing={2}>
          <Alert severity="error">{problem}</Alert>
          <Typography variant="body2" color="text.secondary">
            What you saved is still saved. If it keeps happening, close BudgetMint and open it again.
          </Typography>
          {stopped ? (
            <Button variant="contained" onClick={reload}>
              Reload
            </Button>
          ) : (
            <Button variant="contained" onClick={() => this.setState({ problem: null })}>
              Try again
            </Button>
          )}
        </Stack>
      </AuthLayout>
    );
  }
}
