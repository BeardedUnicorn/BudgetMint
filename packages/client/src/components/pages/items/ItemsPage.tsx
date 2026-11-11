/**
 * Bills (or income): each with its amount, how often, when it's next due
 * and what it comes to a month; add, edit, see its history, archive or
 * delete it. Archived ones are listed apart.
 */

import { useState } from 'react';
import {
  Box,
  Button,
  Chip,
  IconButton,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Add as AddIcon,
  Archive as ArchiveIcon,
  DeleteOutlined as DeleteIcon,
  Edit as EditIcon,
  History as HistoryIcon,
  ReceiptLong as BillsIcon,
  Payments as IncomeIcon,
  Unarchive as UnarchiveIcon,
} from '@mui/icons-material';
import type { ItemKind, ItemView } from '@budgetmint/contracts';
import { useBudgetChange, useCoreQuery } from '../../../data/BudgetContext';
import { useNotification } from '../../../contexts/NotificationContext';
import { formatRelativeDay } from '../../../utils/dates';
import { describeRepeat, occurrenceLabel } from '../../../utils/describe';
import { formatCents } from '../../../utils/money';
import { ItemDialog } from '../../budget/ItemDialog';
import { PageContainer, PageHeader } from '../../layout/PageLayout';
import { ConfirmDialog } from '../../ui/dialogs/ConfirmDialog';
import { EmptyState } from '../../ui/display/EmptyState';
import { PHONE_TABLE } from '../../ui/tables/tableStyles';
import { VISUALLY_HIDDEN } from '../../ui/visuallyHidden';
import { SECTION } from '../overview/OverviewPage';
import { HistoryDialog } from './HistoryDialog';

const MONO = '"Roboto Mono", monospace';

const WORDS: Record<ItemKind, { title: string; one: string; subtitle: string; empty: string }> = {
  bill: {
    title: 'Bills',
    one: 'bill',
    subtitle: 'What goes out, and when.',
    empty: 'Add rent, utilities, subscriptions: anything that comes round.',
  },
  income: {
    title: 'Income',
    one: 'income',
    subtitle: 'Money coming in besides TaskMint’s withdrawals.',
    empty: 'A paycheck, a side job, a refund on its way.',
  },
};

type Dialog = { type: 'edit'; view: ItemView | null } | { type: 'history' | 'delete'; view: ItemView };

function ItemsTable({ views, today, onOpen }: { views: ItemView[]; today: string; onOpen: (dialog: Dialog) => void }) {
  const change = useBudgetChange();
  const { showError } = useNotification();
  const archive = (view: ItemView, archived: boolean) => {
    try {
      change('archive_item', { itemId: view.item.id, archived }, `${view.item.name} ${archived ? 'archived' : 'back'}`);
    } catch (error) {
      showError((error as Error).message);
    }
  };

  return (
    <TableContainer>
      <Table size="small" sx={PHONE_TABLE}>
        <TableHead>
          <TableRow>
            <TableCell>Name</TableCell>
            <TableCell align="right">Amount</TableCell>
            <TableCell>How often</TableCell>
            <TableCell>Next</TableCell>
            <TableCell align="right">A month</TableCell>
            <TableCell>
              <Box component="span" sx={VISUALLY_HIDDEN}>
                Actions
              </Box>
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {views.map(view => {
            const { item } = view;
            const segment = view.current;
            return (
              <TableRow key={item.id} hover>
                <TableCell>
                  {/* A long name wraps (and its chips go under it) rather than widening the table */}
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere', minWidth: 0 }}>
                      {item.name}
                    </Typography>
                    {item.category && <Chip size="small" label={item.category} />}
                    {item.autopay && <Chip size="small" label="Autopay" variant="outlined" color="info" />}
                  </Stack>
                </TableCell>
                <TableCell align="right" sx={{ fontFamily: MONO }}>
                  {formatCents(segment.amountCents)}
                </TableCell>
                <TableCell>{describeRepeat(segment.repeat, segment.from)}</TableCell>
                <TableCell sx={{ color: view.next?.late ? 'error.main' : undefined }}>
                  {/* Said in words too, not only in red */}
                  {view.next?.late && `${occurrenceLabel(view.next)}: `}
                  {view.next ? formatRelativeDay(view.next.due, today) : '—'}
                </TableCell>
                <TableCell align="right" sx={{ fontFamily: MONO }}>
                  {view.monthlyCents > 0 ? formatCents(view.monthlyCents) : '—'}
                </TableCell>
                <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                  <Tooltip title="Edit">
                    <IconButton
                      size="small"
                      aria-label={`Edit ${item.name}`}
                      onClick={() => onOpen({ type: 'edit', view })}
                    >
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="History">
                    <IconButton
                      size="small"
                      aria-label={`${item.name}'s history`}
                      onClick={() => onOpen({ type: 'history', view })}
                    >
                      <HistoryIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  {item.archived ? (
                    <>
                      <Tooltip title="Bring back">
                        <IconButton
                          size="small"
                          aria-label={`Bring back ${item.name}`}
                          onClick={() => archive(view, false)}
                        >
                          <UnarchiveIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete">
                        <IconButton
                          size="small"
                          aria-label={`Delete ${item.name}`}
                          onClick={() => onOpen({ type: 'delete', view })}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </>
                  ) : (
                    <Tooltip title="Archive (stop it, keep its history)">
                      <IconButton size="small" aria-label={`Archive ${item.name}`} onClick={() => archive(view, true)}>
                        <ArchiveIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

export function ItemsPage({ kind }: { kind: ItemKind }) {
  const all = useCoreQuery('get_items');
  const { today } = useCoreQuery('get_overview');
  const { settings } = useCoreQuery('get_settings');
  const change = useBudgetChange();
  const { showError } = useNotification();
  const [opened, setDialog] = useState<Dialog | null>(null);
  // An item deleted (here or on another device) takes its dialog with it
  const dialog = opened?.view && !all.some(view => view.item.id === opened.view?.item.id) ? null : opened;
  const words = WORDS[kind];
  const views = all.filter(view => view.item.kind === kind);
  const active = views.filter(view => !view.item.archived);
  const archived = views.filter(view => view.item.archived);
  const monthly = active.reduce((sum, view) => sum + view.monthlyCents, 0);
  const Icon = kind === 'bill' ? BillsIcon : IncomeIcon;
  const add = () => setDialog({ type: 'edit', view: null });

  return (
    <PageContainer>
      <PageHeader
        title={words.title}
        subtitle={active.length > 0 ? `${words.subtitle} About ${formatCents(monthly)} a month.` : words.subtitle}
        actions={
          <Button variant="contained" startIcon={<AddIcon />} onClick={add}>
            Add {words.one}
          </Button>
        }
      />
      {views.length === 0 ? (
        <EmptyState
          icon={<Icon sx={{ fontSize: 48 }} />}
          title={`No ${words.title.toLowerCase()} yet`}
          description={words.empty}
          action={
            <Button variant="contained" startIcon={<AddIcon />} onClick={add}>
              Add {words.one}
            </Button>
          }
        />
      ) : (
        <>
          <Paper sx={SECTION}>
            {active.length > 0 ? (
              <ItemsTable views={active} today={today} onOpen={setDialog} />
            ) : (
              <Typography variant="body2" color="text.secondary">
                All archived.
              </Typography>
            )}
          </Paper>
          {archived.length > 0 && (
            <Paper component="section" aria-labelledby="archived-title" sx={SECTION}>
              <Typography id="archived-title" variant="h6" component="h2" sx={{ mb: 2 }}>
                Archived
              </Typography>
              <ItemsTable views={archived} today={today} onOpen={setDialog} />
            </Paper>
          )}
        </>
      )}

      {dialog?.type === 'edit' && (
        <ItemDialog
          kind={kind}
          view={dialog.view ?? undefined}
          today={today}
          defaultLeadDays={settings.reminders.leadDays}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.type === 'history' && <HistoryDialog view={dialog.view} today={today} onClose={() => setDialog(null)} />}
      <ConfirmDialog
        open={dialog?.type === 'delete'}
        onClose={() => setDialog(null)}
        onConfirm={() => {
          const { item } = dialog!.view!;
          try {
            change('delete_item', { itemId: item.id }, `${item.name} deleted`);
          } catch (error) {
            // Refused (it's gone already): said in a toast, and the question closes
            showError((error as Error).message);
          }
        }}
        title={`Delete ${dialog?.view?.item.name ?? ''}?`}
        message="Its history goes too. Undo brings it back for a few seconds; after that it's gone."
        confirmLabel="Delete"
        severity="error"
      />
    </PageContainer>
  );
}
