// Uses independent PostgreSQL sessions on a disposable local database after Batch C.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const database = process.env.PGDATABASE;
const host = process.env.PGHOST || '127.0.0.1';
if (!database || !['127.0.0.1', 'localhost', '::1'].includes(host)) {
  throw new Error('Set PGDATABASE for a disposable local database and use a loopback host.');
}
const modulePath = process.env.BATCH_C_POSTGRES_JS;
const { default: postgres } = await import(modulePath ? pathToFileURL(resolve(modulePath)).href : 'postgres');
const connect = () => postgres({ host, database, max: 1, connect_timeout: 5, onnotice: () => {} });
const observer = connect();
const first = connect();
const second = connect();
const [owner, member, sharedCircle, capCircleA, capCircleB] = Array.from({ length: 5 }, () => randomUUID());

async function asActor(connection, user) {
  await connection.unsafe("BEGIN; SET LOCAL ROLE authenticated; SET LOCAL statement_timeout = '12s'").simple();
  await connection`
    SELECT set_config('request.jwt.claim.sub', ${user}, true),
           set_config('request.jwt.claims', jsonb_build_object('sub', ${user}::text)::text, true)
  `;
}

async function race(firstUser, firstCircle, secondUser, secondCircle, expected) {
  const [{ pid: holderPid }] = await first`SELECT pg_backend_pid() AS pid`;
  const [{ pid: waiterPid }] = await second`SELECT pg_backend_pid() AS pid`;
  await asActor(first, firstUser);
  await asActor(second, secondUser);
  const [{ code }] = await first`SELECT public.reserve_ai_generation(${firstCircle}) AS code`;
  assert.equal(code, 'ok');
  const pending = Promise.resolve(second`SELECT public.reserve_ai_generation(${secondCircle}) AS code`)
    .then(rows => ({ code: rows[0].code }), error => ({ error }));
  let waited = false;
  try {
    const deadline = Date.now() + 5000;
    do {
      const [{ blocked }] = await observer`
        SELECT ${holderPid}::integer = ANY(pg_blocking_pids(${waiterPid}::integer)) AS blocked
      `;
      if (blocked) { waited = true; break; }
      await delay(20);
    } while (Date.now() < deadline);
  } finally {
    await first`COMMIT`;
  }
  const result = await pending;
  await second.unsafe(result.error ? 'ROLLBACK' : 'COMMIT');
  assert.ok(waited, 'second reservation was blocked by the first transaction');
  assert.ifError(result.error);
  assert.equal(result.code, expected);
}

try {
  await observer.begin(async sql => {
    await sql`INSERT INTO auth.users (id) VALUES (${owner}), (${member})`;
    await sql`
      INSERT INTO public.circles (id, name, created_by, ai_enabled)
      VALUES (${sharedCircle}, 'Synthetic shared cooldown', ${owner}, true),
             (${capCircleA}, 'Synthetic cap A', ${member}, true),
             (${capCircleB}, 'Synthetic cap B', ${member}, true)
    `;
    await sql`INSERT INTO public.circle_members (circle_id, user_id) VALUES (${sharedCircle}, ${member})`;
    await sql`
      INSERT INTO private.ai_generation_reservations (user_id, reserved_at)
      SELECT ${member}, date_trunc('day', clock_timestamp(), 'Asia/Manila') FROM generate_series(1,9)
    `;
  });
  await race(owner, sharedCircle, member, sharedCircle, 'cooldown');
  await race(member, capCircleA, member, capCircleB, 'daily_limit');
  const [{ circleCount, userCount }] = await observer`
    SELECT (SELECT count(*) FROM private.ai_generation_reservations WHERE circle_id = ${sharedCircle})::int AS "circleCount",
           (SELECT count(*) FROM private.ai_generation_reservations WHERE user_id = ${member})::int AS "userCount"
  `;
  assert.equal(circleCount, 1);
  assert.equal(userCount, 10);
  console.log('Batch C races passed: one reservation per circle cooldown and at most ten per user.');
} finally {
  await Promise.allSettled([first`ROLLBACK`, second`ROLLBACK`]);
  await Promise.allSettled([first.end({ timeout: 1 }), second.end({ timeout: 1 })]);
  try {
    await observer.begin(async sql => {
      await sql`DELETE FROM public.circles WHERE id IN (${sharedCircle}, ${capCircleA}, ${capCircleB})`;
      await sql`DELETE FROM auth.users WHERE id IN (${owner}, ${member})`;
    });
  } finally {
    await observer.end({ timeout: 1 });
  }
}
