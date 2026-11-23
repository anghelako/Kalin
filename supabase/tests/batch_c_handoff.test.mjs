import assert from 'node:assert/strict';
import test from 'node:test';
import { createHandoffHandler, containsMedicationInstruction } from '../functions/handoff-brief/handler.mjs';
import { minimizeNotes } from '../functions/_shared/handoff-content.mjs';

const circleId = '00000000-0000-4000-8000-000000000201';
const userId = '00000000-0000-4000-8000-000000000202';
const origin = 'https://kalin.example.invalid';
const names = ['Synthetic Circle', 'Synthetic Author'];
const source = [{
  body: 'Synthetic Author in Synthetic Circle wrote at 2037-03-05T12:34:56Z. ' +
    'Contacts: test@example.invalid, +63 (917) 123-4567. ' + 'a'.repeat(400),
  created_at: '2037-03-05T18:34:56Z'
}];
const notes = minimizeNotes(source, names);
const input = { circle_id: circleId, kind: 'handoff_brief', notes };
const responseText = text => Response.json({
  candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }]
});

function mock(overrides = {}) {
  const events = [];
  const env = {
    ALLOWED_ORIGINS: origin + ', https://alternate.example.invalid',
    HANDOFF_BRIEF_ENABLED: 'true',
    SUPABASE_URL: 'https://supabase.example.invalid',
    SUPABASE_ANON_KEY: 'synthetic-reader',
    SUPABASE_SERVICE_ROLE_KEY: 'synthetic-writer',
    GEMINI_API_KEY: 'synthetic-provider',
    GEMINI_MODEL: 'gemini-2.5-flash',
    ...overrides.env
  };
  const query = results => ({
    select() { return this; }, eq() { return this; }, order() { return this; },
    limit() { return this; }, in() { return this; },
    maybeSingle: async () => ({ data: results.single }),
    then: (resolve, reject) => Promise.resolve({ data: results.rows }).then(resolve, reject)
  });
  const handler = createHandoffHandler({
    env: name => env[name],
    createClient: (_url, key, options) => {
      if (key === env.SUPABASE_SERVICE_ROLE_KEY) {
        assert.equal(options.global, undefined);
        return {
          from: table => {
            assert.equal(table, 'ai_log');
            return { insert: row => {
              events.push(['save', row]);
              return { select: () => ({ single: async () => ({
                data: { id: 'fixture', body: row.body, created_at: source[0].created_at, verified_generation: true }
              }) }) };
            } };
          }
        };
      }
      assert.equal(options.global.headers.Authorization, 'Bearer mock-session');
      return {
        auth: { getUser: async token => {
          events.push(['auth', token]);
          return overrides.invalidToken ? { error: { message: 'internal auth detail' } } : { data: { user: { id: userId } } };
        } },
        from: table => {
          events.push(['read', table]);
          const rows = {
            circles: { single: { name: names[0], ai_enabled: overrides.enabled !== false, is_active: true } },
            circle_members: { single: overrides.member === false ? null : { user_id: userId }, rows: [{ user_id: userId }] },
            care_notes: { rows: overrides.source || source },
            profiles: { rows: [{ full_name: names[1] }] }
          };
          return query(rows[table]);
        },
        rpc: async (name, args) => {
          assert.equal(name, 'reserve_ai_generation');
          assert.deepEqual(args, { circle_id: circleId });
          events.push(['reserve']);
          return { data: overrides.reservation || 'ok' };
        }
      };
    },
    fetchGemini: async (_url, options) => {
      events.push(['provider', JSON.parse(options.body)]);
      return overrides.provider ? overrides.provider() : responseText('Observed a quiet afternoon.');
    }
  });
  const invoke = (body = JSON.stringify(input), headers = {}) => handler(new Request(origin + '/edge', {
    method: 'POST', body, headers: { origin, authorization: 'Bearer mock-session', ...headers }
  }));
  return { events, invoke, handler };
}

async function expectError(response, status, code) {
  assert.equal(response.status, status);
  const payload = await response.json();
  assert.equal(payload.code, code);
  assert.equal(typeof payload.message, 'string');
  assert.doesNotMatch(payload.message, /internal/);
}

test('preview truncates and redacts notes deterministically, including dates and byte limits', () => {
  assert.deepEqual(Object.keys(notes[0]), ['date', 'text']);
  assert.equal(notes[0].date, '2037-03-06');
  assert.equal(Array.from(notes[0].text).length, 300);
  assert.doesNotMatch(notes[0].text, /Synthetic|example|123-4567|12:34:56/);
  assert.match(notes[0].text, /\[email removed\].*\[phone removed\]/);
  assert.equal(minimizeNotes(Array(21).fill(source[0]), names).length, 20);
  const emoji = { ...source[0], body: '🌱'.repeat(300) };
  assert.ok(minimizeNotes(Array(20).fill(emoji), names).length < 20);
});

test('global and circle flags are independent and default to disabled', async () => {
  for (const flag of [undefined, 'false', 'TRUE']) {
    const api = mock({ env: { HANDOFF_BRIEF_ENABLED: flag } });
    await expectError(await api.invoke(), 403, 'ai_disabled');
    assert.deepEqual(api.events, []);
  }
  const api = mock({ enabled: false });
  await expectError(await api.invoke(), 403, 'ai_disabled');
  assert.ok(!api.events.some(([event, table]) => event === 'reserve' || table === 'care_notes'));
});

test('invalid tokens and outsiders cannot reach notes, reservations, Gemini, or the privileged writer', async () => {
  const invalid = mock({ invalidToken: true });
  await expectError(await invalid.invoke(), 401, 'unauthorized');
  assert.deepEqual(invalid.events.map(([stage]) => stage), ['auth']);
  const outsider = mock({ member: false });
  await expectError(await outsider.invoke(), 403, 'not_a_member');
  assert.deepEqual(outsider.events.map(([stage]) => stage), ['auth', 'read']);
});

test('rejects oversized actual bytes, oversized headers, extra fields and overlong input', async () => {
  const api = mock();
  await expectError(await api.invoke('"🌱'.padEnd(8192, '🌱') + '"'), 413, 'body_too_large');
  await expectError(await api.invoke('x', { 'content-length': '16385' }), 413, 'body_too_large');
  await expectError(await api.invoke(JSON.stringify({ ...input, author_id: userId })), 400, 'invalid_request');
  await expectError(await api.invoke(JSON.stringify({
    ...input, notes: [{ date: notes[0].date, text: 'a'.repeat(301) }]
  })), 400, 'invalid_request');
  assert.deepEqual(api.events, []);
});

test('CORS only echoes exact configured origins and rejects wildcard or absent origins', async () => {
  const api = mock();
  const allowed = await api.handler(new Request(origin, { method: 'OPTIONS', headers: { origin } }));
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get('access-control-allow-origin'), origin);
  const denied = await api.invoke(undefined, { origin: origin + '.other.invalid' });
  assert.equal(denied.headers.get('access-control-allow-origin'), null);
  await expectError(denied, 403, 'origin_denied');
  await expectError(await api.handler(new Request(origin)), 403, 'origin_denied');
  await expectError(await mock({ env: { ALLOWED_ORIGINS: '*' } }).invoke(), 403, 'origin_denied');
});

test('changed preview and exhausted reservations block provider calls', async () => {
  const changed = mock({ source: [{ ...source[0], body: 'Changed observation.' }] });
  await expectError(await changed.invoke(), 409, 'preview_changed');
  assert.ok(!changed.events.some(([stage]) => stage === 'reserve'));
  for (const code of ['daily_limit', 'cooldown']) {
    const api = mock({ reservation: code });
    await expectError(await api.invoke(), 429, code);
    assert.equal(api.events.at(-1)[0], 'reserve');
  }
});

test('sends only the reviewed minimized notes, reserves first and saves through the server writer', async () => {
  const api = mock();
  const response = await api.invoke();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).verified_generation, true);
  assert.deepEqual(api.events.slice(-3).map(([stage]) => stage), ['reserve', 'provider', 'save']);
  const [, provider] = api.events.at(-2);
  assert.equal(provider.generationConfig.maxOutputTokens, 400);
  assert.deepEqual(JSON.parse(provider.contents[0].parts[0].text), notes);
  assert.ok(!JSON.stringify(provider).includes(circleId));
  assert.deepEqual(api.events.at(-1)[1], {
    circle_id: circleId, created_by: userId, kind: 'handoff_brief',
    body: 'Observed a quiet afternoon.', verified_generation: true
  });
});

test('provider 429, 503, timeouts and unsafe drafts get safe messages without retrying or saving', async () => {
  for (const [provider, status, code] of [
    [() => new Response('internal provider detail', { status: 429 }), 429, 'provider_busy'],
    [() => new Response('internal provider detail', { status: 503 }), 503, 'provider_unavailable'],
    [() => { throw new DOMException('internal provider details', 'TimeoutError'); }, 504, 'timeout'],
    [() => responseText('Take two tablets tonight.'), 502, 'unsafe_output']
  ]) {
    const api = mock({ provider });
    await expectError(await api.invoke(), status, code);
    assert.equal(api.events.filter(([stage]) => stage === 'provider').length, 1);
    assert.ok(!api.events.some(([stage]) => stage === 'save'));
  }
  for (const text of ['• Stop the blue tablet.', 'Please change the evening dose.',
    'The dose should be reduced.', 'I recommend doubling the dose.', 'Do not take the pill.']) {
    assert.ok(containsMedicationInstruction(text));
  }
  assert.equal(containsMedicationInstruction('The family noted a quiet afternoon.'), false);
});
