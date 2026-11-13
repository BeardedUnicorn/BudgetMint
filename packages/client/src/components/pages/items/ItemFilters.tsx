/**
 * Finding a bill (or income) in a long list: search by name or category,
 * one category only, and an order other than core's (next due first). And
 * what each category comes to a month. With more than one bank account,
 * one account's only.
 */

import { MenuItem, Stack, TextField, Typography } from '@mui/material';
import type { AccountView, ItemView } from '@budgetmint/contracts';
import { MAIN_ACCOUNT } from '@budgetmint/contracts';
import { formatCents } from '../../../utils/money';

export type ItemOrder = 'next' | 'name' | 'amount' | 'monthly';

export interface ItemQuery {
  search: string;
  /** '' for every category. */
  category: string;
  /** '' for every bank account. */
  account: string;
  order: ItemOrder;
}

export const ALL_ITEMS: ItemQuery = { search: '', category: '', account: '', order: 'next' };

/** The bank account an item is in (the main one, when it names none). */
export const accountOf = (view: ItemView) => view.item.accountId ?? MAIN_ACCOUNT;

const ORDERS: Record<ItemOrder, string> = {
  next: 'Next date',
  name: 'Name',
  amount: 'Amount',
  monthly: 'A month',
};

/** What the list's items are filed under, A to Z. */
/** A category whatever its letters' case: "Utilities" and "utilities" are one. */
const sameCategory = (a: string | null, b: string) => a !== null && a.toLocaleLowerCase() === b.toLocaleLowerCase();

/** The categories in use, each once (as first spelled), in order. */
export const categoriesOf = (views: ItemView[]) =>
  views
    .flatMap(view => (view.item.category ? [view.item.category] : []))
    .filter((category, index, all) => all.findIndex(other => sameCategory(other, category)) === index)
    .sort((a, b) => a.localeCompare(b));

/** `views` as `query` asks: the ones it finds, in its order (core's is next due, then name). */
export function findItems(views: ItemView[], query: ItemQuery): ItemView[] {
  const words = query.search.trim().toLocaleLowerCase();
  const found = views.filter(
    view =>
      (query.category === '' || sameCategory(view.item.category, query.category)) &&
      (query.account === '' || accountOf(view) === query.account) &&
      (words === '' || `${view.item.name} ${view.item.category ?? ''}`.toLocaleLowerCase().includes(words))
  );
  const by: Record<ItemOrder, ((a: ItemView, b: ItemView) => number) | null> = {
    next: null,
    name: (a, b) => a.item.name.localeCompare(b.item.name),
    // As the column shows it: a varying one at its estimate
    amount: (a, b) => (b.estimate?.cents ?? b.current.amountCents) - (a.estimate?.cents ?? a.current.amountCents),
    monthly: (a, b) => b.monthlyCents - a.monthlyCents,
  };
  const compare = by[query.order];
  return compare ? [...found].sort(compare) : found;
}

export function ItemFilters({
  query,
  categories,
  accounts,
  onChange,
}: {
  query: ItemQuery;
  categories: string[];
  /** The bank accounts to choose among: none, with only one in use. */
  accounts: AccountView[];
  onChange: (query: ItemQuery) => void;
}) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
      <TextField
        size="small"
        type="search"
        label="Search"
        placeholder="Name or category"
        value={query.search}
        onChange={event => onChange({ ...query, search: event.target.value })}
        sx={{ flex: 2 }}
      />
      {categories.length > 0 && (
        <TextField
          select
          size="small"
          label="Category"
          value={query.category}
          onChange={event => onChange({ ...query, category: event.target.value })}
          sx={{ flex: 1, minWidth: 0 }}
        >
          <MenuItem value="">Every category</MenuItem>
          {categories.map(category => (
            <MenuItem key={category} value={category}>
              {category}
            </MenuItem>
          ))}
        </TextField>
      )}
      {accounts.length > 0 && (
        <TextField
          select
          size="small"
          label="Account"
          value={query.account}
          onChange={event => onChange({ ...query, account: event.target.value })}
          sx={{ flex: 1, minWidth: 0 }}
        >
          <MenuItem value="">Every account</MenuItem>
          {accounts.map(account => (
            <MenuItem key={account.id} value={account.id}>
              {account.name}
            </MenuItem>
          ))}
        </TextField>
      )}
      <TextField
        select
        size="small"
        label="Order"
        value={query.order}
        onChange={event => onChange({ ...query, order: event.target.value as ItemOrder })}
        sx={{ flex: 1, minWidth: 0 }}
      >
        {(Object.keys(ORDERS) as ItemOrder[]).map(order => (
          <MenuItem key={order} value={order}>
            {ORDERS[order]}
          </MenuItem>
        ))}
      </TextField>
    </Stack>
  );
}

/** What each category comes to a month (the uncategorized last), when there's more than one way to file them. */
export function CategoryTotals({ views }: { views: ItemView[] }) {
  const totals = new Map<string, number>();
  const names = categoriesOf(views);
  for (const view of views) {
    // Under the category's first spelling
    const key = names.find(name => sameCategory(view.item.category, name)) ?? '';
    totals.set(key, (totals.get(key) ?? 0) + view.monthlyCents);
  }
  if (totals.size < 2) return null;
  const rows = [...totals].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
  return (
    <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }} aria-label="A month, by category">
      A month by category:{' '}
      {rows.map(([category, cents]) => `${category || 'No category'} ${formatCents(cents)}`).join(' · ')}
    </Typography>
  );
}
