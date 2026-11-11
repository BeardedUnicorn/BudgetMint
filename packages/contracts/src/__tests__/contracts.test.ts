import { describe, expect, expectTypeOf, it } from 'vitest';
import { BUDGET_SCHEMA, COMMAND_NAMES, FORECAST_SCHEMA, LIMITS } from '../index';
import type { CommandArgs, CommandName, CommandReply, OccStatus, Overview, Repeat } from '../index';

describe('the generated contracts', () => {
  it('name every command core runs, and its schemas and limits', () => {
    expect(COMMAND_NAMES).toContain('get_overview');
    expect(BUDGET_SCHEMA).toBe(1);
    expect(FORECAST_SCHEMA).toBe(1);
    expect(LIMITS.MAX_NAME).toBe(80);
  });

  it('type each command’s arguments and reply', () => {
    expectTypeOf<CommandName>().toEqualTypeOf<(typeof COMMAND_NAMES)[number]>();
    expectTypeOf<CommandArgs<'get_overview'>>().toEqualTypeOf<void>();
    expectTypeOf<CommandReply<'get_overview'>>().toEqualTypeOf<Overview>();
    expectTypeOf<CommandReply<'reset_docs'>>().toEqualTypeOf<null>();
    expectTypeOf<Extract<Repeat, { every: 'months' }>>().toEqualTypeOf<{ every: 'months'; n: number; day: number }>();
    expectTypeOf<Extract<OccStatus, { state: 'done' }>['amountCents']>().toEqualTypeOf<number>();
  });
});
