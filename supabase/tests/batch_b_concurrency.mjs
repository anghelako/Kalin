// Run against a disposable local PostgreSQL database after Batch B.
// Uses real independent connections and confirms blocking before releasing each race.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const database = process.env.PGDATABASE;
const host = process.env.PGHOST || '127.0.0.1';
if (!database || !['127.0.0.1', 'localhost', '::1'].includes(host)) {
  throw new Error('Set PGDATABASE to a disposable local database and use a loopback host.');
}
const modulePath = process.env.BATCH_B_POSTGRES_JS;
const { default: postgres } = await import(modulePath ? pathToFileURL(resolve(modulePath)).href : 'postgres');
const connect = () => postgres({ host, database, max: 1, connect_timeout: 5, onnotice: () => {} });
const observer = connect();
const holder = connect();
const waiter = connect();

const ids = Object.fromEntries(
  ['owner', 'member', 'circle', 'twoClaims', 'claimFirst', 'leaveFirst', 'item', 'schedule']
    .map(name => [name, randomUUID()])
);

async function asActor(connection, id) {
  await connection.unsafe("BEGIN; SET LOCAL ROLE authenticated; SET LOCAL statement_timeout = '12s'").simple();
  await connection`
    SELECT set_config('request.jwt.claim.sub', ${id}, true),
           set_config('request.jwt.claims', jsonb_build_object('sub', ${id}::text)::text, true)
  `;
}

async function waitForBlock(blockedPid, blockingPid) {
  const limit = Date.now() + 5000;
  do {
    const [{ blocked }] = await observer`
      SELECT ${blockingPid}::integer = ANY(pg_blocking_pids(${blockedPid}::integer)) AS blocked
    `;
    if (blocked) return;
    await delay(20);
  } while (Date.now() < limit);
  throw new Error('The race did not reach the expected PostgreSQL lock.');
}

async function race(firstActor, secondActor, first, second) {
  const [{ pid: holderPid }] = await holder`SELECT pg_backend_pid() AS pid`;
  const [{ pid: waiterPid }] = await waiter`SELECT pg_backend_pid() AS pid`;
  await asActor(holder, firstActor);
  await asActor(waiter, secondActor);
  await first(holder);
  const pending = Promise.resolve(second(waiter)).then(result => ({ result }), error => ({ error }));
  try {
    await waitForBlock(waiterPid, holderPid);
  } catch (error) {
    await holder`ROLLBACK`;
    await pending;
    throw error;
  }
  await holder`COMMIT`;
  const outcome = await pending;
  await waiter.unsafe(outcome.error ? 'ROLLBACK' : 'COMMIT');
  return outcome;
}

const claim = id => connection => connection`SELECT public.claim_shift(${id})`;
const leave = connection => connection`
  DELETE FROM public.circle_members WHERE circle_id = ${ids.circle} AND user_id = auth.uid()
`;
const mark = connection => connection`
  SELECT public.mark_dose_taken(${ids.schedule}, public.manila_today(), time '08:00') AS dose
`;
function expectCode(outcome, message) {
  assert.equal(outcome.error?.code, 'P0001');
  assert.equal(outcome.error?.message, message);
}

try {
  await observer.begin(async sql => {
    await sql`
      INSERT INTO auth.users (id, raw_user_meta_data)
      VALUES (${ids.owner}, '{"full_name":"Synthetic owner"}'),
             (${ids.member}, '{"full_name":"Synthetic member"}')
    `;
    await sql`INSERT INTO public.circles (id, name, created_by) VALUES (${ids.circle}, 'Synthetic races', ${ids.owner})`;
    await sql`INSERT INTO public.circle_members (circle_id, user_id) VALUES (${ids.circle}, ${ids.member})`;
    await sql`
      INSERT INTO public.shifts (id, circle_id, shift_date, slot, created_by)
      VALUES (${ids.twoClaims}, ${ids.circle}, public.manila_today() + 2, 'morning', ${ids.owner}),
             (${ids.claimFirst}, ${ids.circle}, public.manila_today() + 2, 'evening', ${ids.owner}),
             (${ids.leaveFirst}, ${ids.circle}, public.manila_today() + 3, 'morning', ${ids.owner})
    `;
    await sql`INSERT INTO public.pharmacy_items (id, circle_id, name, stock) VALUES (${ids.item}, ${ids.circle}, 'Synthetic stock', 10)`;
    await sql`
      INSERT INTO public.medication_schedules (id, circle_id, item_id, dose_amount, frequency, times)
      VALUES (${ids.schedule}, ${ids.circle}, ${ids.item}, 2, 'daily', ARRAY[time '08:00'])
    `;
  });

  expectCode(await race(ids.owner, ids.member, claim(ids.twoClaims), claim(ids.twoClaims)), 'shift_taken');
  const [winner] = await observer`SELECT assigned_to, assigned_name FROM public.shifts WHERE id = ${ids.twoClaims}`;
  assert.equal(winner.assigned_to, ids.owner);
  assert.equal(winner.assigned_name, 'Synthetic owner');

  const claimThenLeave = await race(ids.member, ids.member, claim(ids.claimFirst), leave);
  assert.ifError(claimThenLeave.error);
  const [released] = await observer`SELECT assigned_to, assigned_name FROM public.shifts WHERE id = ${ids.claimFirst}`;
  assert.equal(released.assigned_to, null);
  assert.equal(released.assigned_name, null);

  await observer`INSERT INTO public.circle_members (circle_id, user_id) VALUES (${ids.circle}, ${ids.member})`;
  expectCode(await race(ids.member, ids.member, leave, claim(ids.leaveFirst)), 'not_a_member');
  const [open] = await observer`SELECT assigned_to FROM public.shifts WHERE id = ${ids.leaveFirst}`;
  assert.equal(open.assigned_to, null);

  await observer`INSERT INTO public.circle_members (circle_id, user_id) VALUES (${ids.circle}, ${ids.member})`;
  const doseRace = await race(ids.owner, ids.member, async connection => {
    const [{ dose }] = await mark(connection);
    assert.equal(dose.status, 'ok');
  }, mark);
  assert.ifError(doseRace.error);
  assert.equal(doseRace.result[0].dose.status, 'already_taken');
  const [balances] = await observer`
    SELECT (SELECT stock FROM public.pharmacy_items WHERE id = ${ids.item})::text AS stock,
           (SELECT count(*) FROM public.medication_doses WHERE schedule_id = ${ids.schedule})::integer AS doses,
           (SELECT count(*) FROM public.stock_movements WHERE item_id = ${ids.item} AND reason = 'dose')::integer AS movements
  `;
  assert.deepEqual({ ...balances }, { stock: '8.00', doses: 1, movements: 1 });
  console.log('Batch B concurrency passed: competing claims, both leave/claim orders, and duplicate dose.');
} finally {
  await Promise.allSettled([holder`ROLLBACK`, waiter`ROLLBACK`]);
  await Promise.allSettled([holder.end({ timeout: 1 }), waiter.end({ timeout: 1 })]);
  try {
    await observer.begin(async sql => {
      await sql`DELETE FROM public.circles WHERE id = ${ids.circle}`;
      await sql`DELETE FROM auth.users WHERE id IN (${ids.owner}, ${ids.member})`;
    });
  } finally {
    await observer.end({ timeout: 1 });
  }
}
