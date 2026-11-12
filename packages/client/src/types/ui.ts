// Adapted from TaskMint packages/client/src/types/ui.ts and types/form.ts @ 1623bee (the props the copied components take): FormDialog's dirty and CurrencyInput's autoFocus are BudgetMint's.
import type { ReactNode } from 'react';
import type { SxProps, Theme } from '@mui/material/styles';

export interface StatsCardProps {
  title: string;
  /** The figure, formatted */
  value: string;
  subtitle: string;
  icon: ReactNode;
  color: 'primary' | 'success' | 'warning' | 'info' | 'error';
}

export interface CurrencyInputProps {
  /** The amount as typed */
  value: string;
  onChange: (value: string) => void;
  label: string;
  error: boolean;
  helperText?: string;
  disabled?: boolean;
  sx?: SxProps<Theme>;
  onBlur?: () => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  /** The input itself, to move focus to it (a refused amount). */
  inputRef?: React.Ref<HTMLInputElement>;
  /** It has the focus when it appears. */
  autoFocus?: boolean;
}

/** An open dialog around a form, with Cancel and Save. */
export interface FormDialogProps {
  onClose: () => void;
  title: string;
  children: ReactNode;
  onSubmit: () => void;
  /** Something was changed: Escape asks before throwing it away. */
  dirty?: boolean;
}

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  /** May return a promise: the dialog waits for it, closing when it resolves and staying open if it rejects. */
  onConfirm: () => void | Promise<void>;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** The alert's and the confirm button's color; an error starts on Cancel. */
  severity?: 'warning' | 'error';
}
