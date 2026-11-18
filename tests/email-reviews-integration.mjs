// Imported only by the guarded, disposable local Supabase integration runner.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function testEmailReviewJournal({ request, sql, admin, member, anon, service, observedAt, alertsCall }) {
  const path = '/functions/v1/km16-admin-email-reviews';
  const call = (token, body, extra = {}) => request(path, {
    token, method: 'POST', origin: 'https://app.km16.fr', body, ...extra,
  });
  const history = { action: 'history', categorie: 'achats', notification_id: 1 };
  const base = { action: 'record', categorie: 'achats', notification_id: 1,
    expected_state: 'failed', expected_attempted_at: null, expected_last_review_id: 0,
    decision: 'verification_effectuee', note: 'Vérification fictive, aucun envoi.' };
  const make = (extra = {}) => ({ ...base, request_id: randomUUID(), ...extra });
  const count = () => Number(sql(['-c', 'SELECT count(*) FROM public.km16_email_alert_reviews']));
  let checks = 0;
  const passed = label => console.log('REVIEW PASS ' + (++checks) + ': ' + label);
  const before = count();
  assert.equal(before, 0);

  const preflight = await request(path, { method: 'OPTIONS', origin: 'https://app.km16.fr' });
  assert.equal(preflight.status, 204);
  for (const body of [history, make()]) {
    assert.equal((await call(null, body)).status, 401);
    assert.equal((await call('not-a-valid-token', body)).status, 401);
    assert.equal((await call(member.token, body)).status, 403);
    assert.equal((await call(admin.token, body, { origin: 'https://foreign.example.invalid' })).status, 403);
  }
  assert.equal((await request(path, { method: 'GET', token: admin.token, origin: 'https://app.km16.fr' })).status, 405);
  for (const token of [anon, member.token]) {
    const denied = await request('/rest/v1/km16_email_alert_reviews?select=id&limit=1', { token });
    assert.ok([401, 403].includes(denied.status));
    const rpc = await request('/rest/v1/rpc/km16_record_email_alert_review', {
      token, method: 'POST', body: { p_request_id: randomUUID(), p_categorie: 'achats', p_notification_id: 1,
        p_expected_state: 'failed', p_expected_attempted_at: null, p_expected_last_review_id: 0,
        p_decision: 'verification_effectuee', p_note: 'Forbidden fictional request', p_actor_id: admin.id },
    });
    assert.ok([401, 403, 404].includes(rpc.status), 'browser roles cannot execute the recording RPC');
  }
  assert.equal(count(), before);
  passed('real Auth denies untrusted sessions and direct browser access to journal/RPC');

  const empty = await call(admin.token, history);
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.data, { reviews: [], has_more: false, next_before_id: null });
  const payload = make({ note: '  Vérification fictive, aucun envoi.  ' });
  const first = await call(admin.token, payload);
  assert.equal(first.status, 200, JSON.stringify(first.data));
  const row = first.data.review;
  assert.ok(Number.isSafeInteger(row.id) && row.id > 0);
  assert.equal(row.recorded_by, admin.id);
  assert.equal(row.note, payload.note.trim());
  assert.equal(row.observed_state, 'failed');
  assert.equal(row.observed_attempted_at, null);
  assert.equal(row.previous_review_id, 0);
  assert.ok(Number.isFinite(Date.parse(row.recorded_at)));
  assert.equal(first.headers.get('cache-control'), 'no-store');
  assert.equal(count(), 1);
  const forged = await call(admin.token, make({ notification_id: 11, actor_id: member.id, recorded_by: member.id }));
  assert.ok([200, 400].includes(forged.status));
  if (forged.status === 200) assert.equal(forged.data.review.recorded_by, admin.id, 'actor comes from verified Auth');
  passed('recording uses server identity/time, normalized note and separate journal only');

  const replay = await call(admin.token, payload);
  assert.equal(replay.status, 200);
  assert.deepEqual(replay.data.review, row);
  assert.equal((await call(admin.token, { ...payload, note: 'Changed fictional decision' })).status, 409);
  assert.equal((await call(admin.token, make())).status, 409, 'stale journal revision rejected');
  assert.equal((await call(admin.token, make({ expected_last_review_id: row.id,
    expected_attempted_at: '2000-01-01T00:00:00Z' }))).status, 409);
  // Explicit fixture-only edits simulate a worker between observation and recording.
  try {
    sql(['-c', "UPDATE public.km16_admin_purchase_notifications SET state='accepted', attempted_at='2000-01-01T00:00:00Z' WHERE id=1"]);
    assert.deepEqual((await call(admin.token, payload)).data.review, row, 'successful replay survives delivery changes');
    assert.equal((await call(admin.token, make({ expected_last_review_id: row.id }))).status, 409);
  } finally {
    sql(['-c', "UPDATE public.km16_admin_purchase_notifications SET state='failed', attempted_at=NULL WHERE id=1"]);
  }
  passed('request replay is idempotent and stale delivery/journal observations are rejected');

  const concurrent = make({ expected_last_review_id: row.id, decision: 'a_reexaminer' });
  const same = await Promise.all([call(admin.token, concurrent), call(admin.token, concurrent)]);
  assert.deepEqual(same.map(x => x.status), [200, 200]);
  assert.equal(same[0].data.review.id, same[1].data.review.id);
  const candidates = [make({ expected_last_review_id: same[0].data.review.id }),
    make({ expected_last_review_id: same[0].data.review.id, decision: 'ne_pas_relancer' })];
  const race = await Promise.all(candidates.map(body => call(admin.token, body)));
  assert.deepEqual(race.map(x => x.status).sort(), [200, 409]);
  let last = race.find(x => x.status === 200).data.review.id;
  passed('simultaneous repeats create one event and competing decisions cannot overwrite each other');

  for (const [notification_id, expected_state, expected_attempted_at] of [
    [2, 'uncertain', observedAt], [3, 'sending', new Date(Date.parse(observedAt) - 30 * 60_000).toISOString()],
  ]) {
    const result = await call(admin.token, make({ categorie: 'emails_programmes', notification_id,
      expected_state, expected_attempted_at, decision: 'ne_pas_relancer' }));
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.equal(result.data.review.categorie, 'emails_programmes');
    assert.equal(result.data.review.observed_state, expected_state);
  }
  const beforeInvalid = count();
  for (const body of [null, [], { ...history, before_id: -1 }, make({ decision: 'send_now' }),
    make({ note: ' ' }), make({ note: 'x'.repeat(1001) }), make({ request_id: 'bad' }),
    make({ categorie: 'wrong' }), make({ notification_id: Number.MAX_SAFE_INTEGER + 1 })]) {
    assert.equal((await call(admin.token, body)).status, 400, 'invalid inputs must be rejected');
  }
  for (const id of [4, 6, 7, 8]) {
    const result = await call(admin.token, make({ notification_id: id }));
    assert.equal(result.status, 409, 'non-actionable or changed source cannot be annotated');
  }
  assert.equal((await call(admin.token, make({ notification_id: 999999 }))).status, 404);
  assert.equal(count(), beforeInvalid);
  passed('both sources and manual decisions work; invalid/non-actionable cases add no records');

  for (let i = 0; i < 21; i++) {
    const result = await call(admin.token, make({ expected_last_review_id: last, note: 'Fictional history entry ' + i }));
    assert.equal(result.status, 200);
    last = result.data.review.id;
  }
  const all = [];
  let beforeId;
  for (let page = 0; page < 5; page++) {
    const result = await call(admin.token, { ...history, ...(beforeId ? { before_id: beforeId } : {}) });
    assert.equal(result.status, 200);
    assert.ok(result.data.reviews.length <= 20);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    all.push(...result.data.reviews);
    if (!result.data.has_more) { assert.equal(result.data.next_before_id, null); break; }
    assert.equal(result.data.next_before_id, result.data.reviews.at(-1).id);
    beforeId = result.data.next_before_id;
  }
  assert.equal(all.length, 24);
  assert.equal(all[0].id, last);
  assert.equal(new Set(all.map(x => x.id)).size, all.length);
  assert.ok(all.every((x, i) => !i || all[i - 1].id > x.id));
  assert.ok(all.every(x => x.categorie === 'achats' && x.notification_id === 1));
  const alert = await alertsCall(admin.token);
  assert.ok(alert.data.alerts.some(x => x.categorie === 'achats' && x.notification_id === 1), 'annotations never hide an alert');
  passed('bounded history pages preserve complete order without hiding delivery alerts');

  const journalHash = () => sql(['-c', "SELECT md5(jsonb_agg(to_jsonb(r) ORDER BY id)::text) FROM public.km16_email_alert_reviews r"]);
  const hash = journalHash();
  for (const method of ['PATCH', 'DELETE']) {
    const denied = await request('/rest/v1/km16_email_alert_reviews?id=eq.' + row.id, {
      token: service, key: service, method, ...(method === 'PATCH' ? { body: { note: 'Forbidden overwrite' } } : {}),
    });
    assert.equal(denied.status, 403, 'even service_role cannot modify/delete journal events');
  }
  assert.equal(journalHash(), hash);
  passed('journal is append-only even through the service REST API');
  assert.equal(checks, 7);
  console.log('KM16_EMAIL_REVIEW_INTEGRATION_OK: 7 checks; real Auth/REST/Edge; audit writes only.');
}
