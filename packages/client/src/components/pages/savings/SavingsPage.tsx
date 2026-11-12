/**
 * Savings: each bill money is set aside for (a yearly insurance, a holiday
 * to save up for), at its next time due: how much is set aside so far, the
 * next part and when. What's set aside stays in the account but isn't
 * counted as safe to spend (core's goals). A goal is a once-only bill saved
 * up for; any bill a month or more apart can be saved for from its form.
 */

import { useState } from 'react';
import { Box, Button, LinearProgress, Paper, Stack, Typography } from '@mui/material';
import { Add as AddIcon, Savings as SavingsIcon } from '@mui/icons-material';
import type { GoalView } from '@budgetmint/contracts';
import { useNotification } from '../../../contexts/NotificationContext';
import { useBudgetChange, useCoreQuery } from '../../../data/BudgetContext';
import { formatDayInYear } from '../../../utils/dates';
import { formatCents } from '../../../utils/money';
import { ItemDialog } from '../../budget/ItemDialog';
import { PageContainer, PageHeader } from '../../layout/PageLayout';
import { ConfirmDialog } from '../../ui/dialogs/ConfirmDialog';
import { EmptyState } from '../../ui/display/EmptyState';
import { SECTION } from '../overview/OverviewPage';

const MONO = '"Roboto Mono", monospace';

/** The next part, in words. */
function nextLine(goal: GoalView): string {
  if (!goal.nextPart) return 'All of it is set aside.';
  const more = goal.partsLeft - 1;
  const after = more === 0 ? ', the last' : `, then ${more} more`;
  return `Next ${formatCents(goal.nextPart.cents)} on ${formatDayInYear(goal.nextPart.date)}${after}.`;
}

function Goal({
  goal,
  onEdit,
  onArchive,
  onDelete,
}: {
  goal: GoalView;
  onEdit: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const share = goal.targetCents > 0 ? Math.min(100, (goal.setAsideCents / goal.targetCents) * 100) : 100;
  return (
    <Paper component="section" aria-label={goal.name} sx={{ p: 2.5 }}>
      <Stack direction="row" sx={{ alignItems: 'baseline', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
            {goal.name}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {goal.once ? 'On' : 'Next due'} {formatDayInYear(goal.due)}
          </Typography>
        </Box>
        <Stack direction="row" spacing={0.5}>
          <Button size="small" onClick={onEdit} aria-label={`Edit ${goal.name}`}>
            Edit
          </Button>
          <Button size="small" onClick={onArchive} aria-label={`Archive ${goal.name}`}>
            Archive
          </Button>
          <Button size="small" color="error" onClick={onDelete} aria-label={`Delete ${goal.name}`}>
            Delete
          </Button>
        </Stack>
      </Stack>
      <LinearProgress
        variant="determinate"
        value={share}
        aria-label={`${goal.name}: ${Math.round(share)}% set aside`}
        sx={{ my: 1.5, height: 8, borderRadius: 4 }}
      />
      <Typography sx={{ fontFamily: MONO, fontWeight: 600 }}>
        {formatCents(goal.setAsideCents)} of {formatCents(goal.targetCents)}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {nextLine(goal)}
      </Typography>
    </Paper>
  );
}

export function SavingsPage() {
  const view = useCoreQuery('get_goals');
  const items = useCoreQuery('get_items');
  const { settings } = useCoreQuery('get_settings');
  /** A goal being added (null), or the bill being edited. */
  const [editing, setEditing] = useState<string | null | undefined>(undefined);
  const edited = editing ? items.find(view => view.item.id === editing) : undefined;
  /** The goal asked about deleting. */
  const [deleting, setDeleting] = useState<GoalView | null>(null);
  const change = useBudgetChange();
  const { showError } = useNotification();
  /** A change to a goal, or a toast saying why not (it's gone already, on another device). */
  const act = (run: () => void) => {
    try {
      run();
    } catch (error) {
      showError((error as Error).message);
    }
  };

  const add = (
    <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing(null)}>
      Add a goal
    </Button>
  );
  return (
    <PageContainer>
      <PageHeader
        title="Savings"
        subtitle={
          view.goals.length > 0
            ? `${formatCents(view.setAsideCents)} set aside today, not counted as safe to spend.`
            : 'Set money aside a month at a time for yearly bills and things to come.'
        }
        actions={add}
      />
      {view.goals.length === 0 ? (
        <EmptyState
          icon={<SavingsIcon sx={{ fontSize: 48 }} />}
          title="Nothing set aside yet"
          description="Add a goal, or turn on “Set money aside” in a yearly or monthly bill’s form: BudgetMint spreads it over the months before it’s due."
          action={add}
        />
      ) : (
        <Box
          sx={{
            ...SECTION,
            p: 0,
            display: 'grid',
            gap: 2,
            gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 320px), 1fr))',
          }}
        >
          {view.goals.map(goal => (
            <Goal
              key={goal.itemId}
              goal={goal}
              onEdit={() => setEditing(goal.itemId)}
              onArchive={() =>
                act(() => change('archive_item', { itemId: goal.itemId, archived: true }, `${goal.name} archived`))
              }
              onDelete={() => setDeleting(goal)}
            />
          ))}
        </Box>
      )}
      {editing !== undefined && (editing === null || edited) && (
        <ItemDialog
          kind="bill"
          view={edited}
          goal={editing === null}
          today={view.today}
          defaultLeadDays={settings.reminders.leadDays}
          onClose={() => setEditing(undefined)}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => act(() => change('delete_item', { itemId: deleting!.itemId }, `${deleting!.name} deleted`))}
        title={`Delete ${deleting?.name ?? ''}?`}
        message="What's set aside for it is let go, and its history goes too. Undo brings it back for a few seconds."
        confirmLabel="Delete"
        severity="error"
      />
    </PageContainer>
  );
}
