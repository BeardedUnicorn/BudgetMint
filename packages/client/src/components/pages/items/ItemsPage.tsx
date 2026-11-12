/**
 * Bills (or income): each with its amount, how often, when it's next due
 * and what it comes to a month; add, edit, see its history, archive or
 * delete it. Archived ones are listed apart. A long list can be searched,
 * narrowed to a category and put in another order; on a phone, each row's
 * actions are in a menu by its name (the column that stays in view).
 */

import { type ReactNode, useEffect, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  IconButton,
  ListItemIcon,
  Menu,
  MenuItem,
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
  MoreVert as MoreIcon,
  ReceiptLong as BillsIcon,
  Payments as IncomeIcon,
  Unarchive as UnarchiveIcon,
} from '@mui/icons-material';
import type { ItemKind, ItemView } from '@budgetmint/contracts';
import { useBudgetChange, useCoreQuery } from '../../../data/BudgetContext';
import { useNotification } from '../../../contexts/NotificationContext';
import { useCompactLayout } from '../../../hooks/useCompactLayout';
import { useTaskMint } from '../../../hooks/useTaskMint';
import { useNavigation } from '../../../contexts/NavigationContext';
import { formatRelativeDay } from '../../../utils/dates';
import { describeEnd, describeRepeat, describeWeekends, occurrenceLabel } from '../../../utils/describe';
import { formatCents } from '../../../utils/money';
import { ItemDialog } from '../../budget/ItemDialog';
import { PageContainer, PageHeader } from '../../layout/PageLayout';
import { ConfirmDialog } from '../../ui/dialogs/ConfirmDialog';
import { EmptyState } from '../../ui/display/EmptyState';
import { PHONE_TABLE } from '../../ui/tables/tableStyles';
import { VISUALLY_HIDDEN } from '../../ui/visuallyHidden';
import { SECTION } from '../overview/OverviewPage';
import { HistoryDialog } from './HistoryDialog';
import { ALL_ITEMS, CategoryTotals, categoriesOf, findItems, ItemFilters, type ItemQuery } from './ItemFilters';

const MONO = '"Roboto Mono", monospace';

/** A note under an amount: on one line, in the body's type rather than the figures'. */
const NOTE_UNDER = { display: 'block', whiteSpace: 'nowrap', fontFamily: 'fontFamily' } as const;

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
    subtitle: 'Paychecks and other money coming in.',
    empty: 'A paycheck, a side job, a refund on its way.',
  },
};

type Dialog = { type: 'edit'; view: ItemView | null } | { type: 'history' | 'delete'; view: ItemView };

interface Action {
  /** Its tooltip (and, without `short`, its menu item). */
  title: string;
  short?: string;
  /** What a screen reader says: the item's name in it. */
  name: string;
  icon: ReactNode;
  run: () => void;
}

/** A row's actions: buttons, or on a phone a menu. */
function ItemActions({ actions, label, compact }: { actions: Action[]; label: string; compact: boolean }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  if (!compact) {
    return actions.map(action => (
      <Tooltip key={action.name} title={action.title}>
        <IconButton size="small" aria-label={action.name} onClick={action.run}>
          {action.icon}
        </IconButton>
      </Tooltip>
    ));
  }
  return (
    <>
      <IconButton size="small" aria-label={label} onClick={event => setAnchor(event.currentTarget)}>
        <MoreIcon fontSize="small" />
      </IconButton>
      <Menu anchorEl={anchor} open={anchor !== null} onClose={() => setAnchor(null)}>
        {actions.map(action => (
          <MenuItem
            key={action.name}
            aria-label={action.name}
            onClick={() => {
              setAnchor(null);
              action.run();
            }}
          >
            <ListItemIcon>{action.icon}</ListItemIcon>
            {action.short ?? action.title}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

function ItemsTable({ views, today, onOpen }: { views: ItemView[]; today: string; onOpen: (dialog: Dialog) => void }) {
  const change = useBudgetChange();
  const { showError } = useNotification();
  const compact = useCompactLayout();
  const archive = (view: ItemView, archived: boolean) => {
    try {
      change('archive_item', { itemId: view.item.id, archived }, `${view.item.name} ${archived ? 'archived' : 'back'}`);
    } catch (error) {
      showError((error as Error).message);
    }
  };
  const actionsOf = (view: ItemView): Action[] => {
    const { item } = view;
    const edit: Action[] = [
      {
        title: 'Edit',
        name: `Edit ${item.name}`,
        icon: <EditIcon fontSize="small" />,
        run: () => onOpen({ type: 'edit', view }),
      },
      {
        title: 'History',
        name: `${item.name}'s history`,
        icon: <HistoryIcon fontSize="small" />,
        run: () => onOpen({ type: 'history', view }),
      },
    ];
    return item.archived
      ? [
          ...edit,
          {
            title: 'Bring back',
            name: `Bring back ${item.name}`,
            icon: <UnarchiveIcon fontSize="small" />,
            run: () => archive(view, false),
          },
          {
            title: 'Delete',
            name: `Delete ${item.name}`,
            icon: <DeleteIcon fontSize="small" />,
            run: () => onOpen({ type: 'delete', view }),
          },
        ]
      : [
          ...edit,
          {
            title: 'Archive (stop it, keep its history)',
            short: 'Archive',
            name: `Archive ${item.name}`,
            icon: <ArchiveIcon fontSize="small" />,
            run: () => archive(view, true),
          },
        ];
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
            {!compact && (
              <TableCell>
                <Box component="span" sx={VISUALLY_HIDDEN}>
                  Actions
                </Box>
              </TableCell>
            )}
          </TableRow>
        </TableHead>
        <TableBody>
          {views.map(view => {
            const { item } = view;
            const segment = view.current;
            return (
              <TableRow key={item.id} hover>
                <TableCell>
                  {/* A long name wraps (and its chips go under it) rather than widening the table,
                      but a long schedule beside it doesn't squeeze it to a few letters a line */}
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5, minWidth: compact ? 0 : 120 }}
                  >
                    <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere', minWidth: 0 }}>
                      {item.name}
                    </Typography>
                    {item.category && <Chip size="small" label={item.category} />}
                    {item.autopay && (
                      <Chip
                        size="small"
                        label={item.kind === 'bill' ? 'Autopay' : 'Automatic'}
                        variant="outlined"
                        color="info"
                      />
                    )}
                    {item.saveUp && <Chip size="small" label="Saving up" variant="outlined" color="secondary" />}
                    {compact && <ItemActions actions={actionsOf(view)} label={`${item.name}: what to do`} compact />}
                  </Stack>
                  {item.note && (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: 'block', overflowWrap: 'anywhere' }}
                    >
                      {item.note}
                    </Typography>
                  )}
                </TableCell>
                <TableCell align="right" sx={{ fontFamily: MONO }}>
                  {view.estimate ? `~${formatCents(view.estimate.cents)}` : formatCents(segment.amountCents)}
                  {(view.estimate || item.varies) && (
                    <Typography variant="caption" color="text.secondary" sx={NOTE_UNDER}>
                      {!view.estimate
                        ? 'varies'
                        : view.estimate.from === 1
                          ? 'as last time'
                          : `average of last ${view.estimate.from}`}
                    </Typography>
                  )}
                </TableCell>
                <TableCell>
                  {describeRepeat(segment.repeat, segment.from)}
                  {segment.repeat.every !== 'once' && describeEnd(view.item.schedule.at(-1)!.until)}
                  {segment.weekends !== 'keep' && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      {describeWeekends(segment.weekends)}
                    </Typography>
                  )}
                </TableCell>
                <TableCell sx={{ color: view.next?.late ? 'error.main' : undefined }}>
                  {/* Said in words too, not only in red */}
                  {view.next?.late && `${occurrenceLabel(view.next)}: `}
                  {view.next ? formatRelativeDay(view.next.due, today) : '—'}
                </TableCell>
                <TableCell align="right" sx={{ fontFamily: MONO }}>
                  {view.monthlyCents > 0 ? formatCents(view.monthlyCents) : '—'}
                </TableCell>
                {!compact && (
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    <ItemActions actions={actionsOf(view)} label="" compact={false} />
                  </TableCell>
                )}
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
  const [query, setQuery] = useState<ItemQuery>(ALL_ITEMS);
  // An item deleted (here or on another device) takes its dialog with it
  const dialog = opened?.view && !all.some(view => view.item.id === opened.view?.item.id) ? null : opened;
  const words = WORDS[kind];
  const { shown: taskmintShown } = useTaskMint();
  // With TaskMint connected, its withdrawals are income too, but not listed here
  const subtitle =
    kind === 'income' && taskmintShown ? 'Money coming in besides TaskMint’s withdrawals.' : words.subtitle;
  const views = all.filter(view => view.item.kind === kind);
  const unarchived = views.filter(view => !view.item.archived);
  const monthly = unarchived.reduce((sum, view) => sum + view.monthlyCents, 0);
  const categories = categoriesOf(views);
  // A category no longer used by any (renamed, deleted) filters nothing out
  const asked = categories.includes(query.category) ? query : { ...query, category: '' };
  const found = findItems(views, asked);
  const active = found.filter(view => !view.item.archived);
  const archived = found.filter(view => view.item.archived);
  const narrowed = found.length < views.length;
  const Icon = kind === 'bill' ? BillsIcon : IncomeIcon;
  const add = () => setDialog({ type: 'edit', view: null });
  // Opened to add one (⌘N)
  const { params, clearParams } = useNavigation();
  useEffect(() => {
    if (!params.add) return;
    setDialog({ type: 'edit', view: null });
    clearParams();
  }, [params.add, clearParams]);

  return (
    <PageContainer>
      <PageHeader
        title={words.title}
        subtitle={unarchived.length > 0 ? `${subtitle} About ${formatCents(monthly)} a month.` : subtitle}
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
            {views.length > 1 && <ItemFilters query={asked} categories={categories} onChange={setQuery} />}
            {active.length > 0 ? (
              <>
                <ItemsTable views={active} today={today} onOpen={setDialog} />
                {!narrowed && <CategoryTotals views={active} />}
              </>
            ) : (
              <Typography variant="body2" color="text.secondary">
                {narrowed ? `No ${words.title.toLowerCase()} match.` : 'All archived.'}
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
