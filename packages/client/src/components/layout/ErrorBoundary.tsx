/**
 * What shows when a page fails while rendering: the problem and a way to
 * try again, instead of React's blank window.
 */

import { Component, type ReactNode } from 'react';
import { Alert, Button, Stack, Typography } from '@mui/material';
import { cloudErrorMessage } from '../../cloud/errors';
import { AuthLayout } from '../auth/AuthLayout';

export class ErrorBoundary extends Component<{ children: ReactNode }, { problem: string | null }> {
  state = { problem: null };

  static getDerivedStateFromError(error: unknown) {
    return { problem: cloudErrorMessage(error) };
  }

  componentDidCatch(error: unknown) {
    console.error('BudgetMint stopped on an error:', error);
  }

  render() {
    const { problem } = this.state;
    if (problem === null) return this.props.children;
    return (
      <AuthLayout title="BudgetMint ran into a problem">
        <Stack spacing={2}>
          <Alert severity="error">{problem}</Alert>
          <Typography variant="body2" color="text.secondary">
            What you saved is still saved. If it keeps happening, close BudgetMint and open it again.
          </Typography>
          <Button variant="contained" onClick={() => this.setState({ problem: null })}>
            Try again
          </Button>
        </Stack>
      </AuthLayout>
    );
  }
}
