// Real PostgreSQL sessions, only in the explicitly named local CI database.
// No worker, external connection, SMTP call or real checkout is used.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';

assert.ok(['localhost', '127.0.0.1'].includes(process.env.PGHOST));
assert.equal(process.env.PGDATABASE, 'checkout_reminder_test');
assert.equal(process.env.PGUSER, 'postgres');
const args = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1'];
const attemptId = n => `70000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const userId = n => `71000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sessions = [];
function sql(query) {
  const result = spawnSync('psql', [...args, '-c', query], {
    encoding: 'utf8', timeout: 7000, env: process.env,
  });
  assert.equal(result.status, 0, result.error?.message || result.stderr);
  return result.stdout.trim();
}
function session(name) {
  const child = spawn('psql', args, {
    stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PGAPPNAME: name },
  });
  const state = { child, output: '', error: '', done: false };
  child.stdout.on('data', data => { state.output += data.toString(); });
  child.stderr.on('data', data => { state.error += data.toString(); });
  state.closed = new Promise(resolve => child.once('close', code => { state.done = true; resolve(code); }));
  state.waitFor = async marker => {
    const deadline = Date.now() + 6000;
    while (!state.output.includes(marker)) {
      if (state.done || Date.now() >= deadline) throw Error(`${name}: ${state.error || state.output || 'timed out waiting for ' + marker}`);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  };
  state.send = query => child.stdin.write(query + '\n');
  state.end = async query => {
    child.stdin.end(query + '\n');
    assert.equal(await state.closed, 0, state.error);
  };
  sessions.push(state);
  return state;
}
async function waitBlocked(name) {
  const deadline = Date.now() + 5000;
  while (sql(`SELECT count(*) FROM pg_stat_activity WHERE application_name='${name}' AND wait_event_type='Lock'`) !== '1') {
    if (Date.now() >= deadline) throw Error(`${name} did not wait on the expected concurrent lock`);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}
function seed(n, email) {
  sql(`INSERT INTO auth.users VALUES ('${userId(n)}');
    INSERT INTO public.km16_videos VALUES ('concurrent${n}','Concurrency fixture',1900,'eur',true);
    INSERT INTO public.km16_checkout_reminders
      (id,kind,source_id,user_id,email,product_id,group_key,title,amount_cents,total_cents,
       stripe_session_id,livemode,opt_in,consented_at,created_at,due_at,next_check_at,state)
    VALUES ('${attemptId(n)}','video','concurrent${n}','${userId(n)}','${email}',
      'concurrent${n}','concurrent${n}','Concurrency fixture',1900,1900,'cs_live_concurrent${n}',
      true,true,'2026-11-20 10:00:00+00','2026-11-20 10:00:00+00',
      '2026-11-21 10:00:00+00','2026-11-21 10:00:00+00','pending')`);
}
function token(n) {
  return sql(`SELECT lock_token FROM public.km16_checkout_reminders WHERE id='${attemptId(n)}'`);
}
function removeAttempts() {
  sql("DELETE FROM public.km16_checkout_reminders WHERE id::text LIKE '70000000-%'");
}
try {
  sql(`CREATE OR REPLACE FUNCTION public.km16_checkout_reminder_clock()
    RETURNS timestamptz LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''
    AS $$ SELECT '2026-11-21 10:00:00+00'::timestamptz; $$`);

  seed(1, 'claim-one@example.invalid');
  seed(2, 'claim-two@example.invalid');
  const claimHolder = session('checkout-claim-holder');
  claimHolder.send("BEGIN; SET LOCAL ROLE service_role; SELECT 'CLAIM:'||id FROM public.km16_claim_checkout_reminders(1);");
  await claimHolder.waitFor('CLAIM:' + attemptId(1));
  assert.equal(sql('SET ROLE service_role; SELECT id FROM public.km16_claim_checkout_reminders(1)'), attemptId(2),
    'a second worker must skip the locked first attempt');
  await claimHolder.end('ROLLBACK;');
  assert.equal(sql('SET ROLE service_role; SELECT id FROM public.km16_claim_checkout_reminders(1)'), attemptId(1),
    'a rolled-back claim is available to another worker');
  assert.equal(sql('SET ROLE service_role; SELECT count(*) FROM public.km16_claim_checkout_reminders(10)'), '0',
    'neither committed checking lease may be claimed again');
  removeAttempts();

  seed(3, 'shared-recipient@example.invalid');
  seed(4, 'shared-recipient@example.invalid');
  assert.equal(sql('SET ROLE service_role; SELECT count(*) FROM public.km16_claim_checkout_reminders(10)'), '2');
  const firstToken = token(3), secondToken = token(4);
  const prepareHolder = session('checkout-prepare-holder');
  prepareHolder.send(`BEGIN; SET LOCAL ROLE service_role; SELECT 'PREPARED:'||public.km16_prepare_checkout_reminder_send('${attemptId(3)}','${firstToken}','${'a'.repeat(64)}');`);
  await prepareHolder.waitFor('PREPARED:true');
  const prepareWaiter = session('checkout-prepare-waiter');
  prepareWaiter.send(`SET ROLE service_role; SET statement_timeout='6s'; SELECT 'SECOND:'||public.km16_prepare_checkout_reminder_send('${attemptId(4)}','${secondToken}','${'b'.repeat(64)}');`);
  await waitBlocked('checkout-prepare-waiter');
  await prepareHolder.end('COMMIT;');
  await prepareWaiter.waitFor('SECOND:false');
  await prepareWaiter.end('');
  assert.equal(sql("SELECT count(*) FROM public.km16_checkout_reminders WHERE state='sending'"), '1',
    'only one recipient send may start under concurrent products');
  assert.equal(sql(`SELECT state||':'||error_code FROM public.km16_checkout_reminders WHERE id='${attemptId(4)}'`), 'pending:recipient_rate_limit',
    'waiter must see the committed first send and defer');
  removeAttempts();

  seed(5, 'stop-race@example.invalid');
  seed(6, 'stop-race@example.invalid');
  sql(`UPDATE public.km16_checkout_reminders SET state='accepted',created_at='2026-11-18 10:00:00+00',
    consented_at='2026-11-18 10:00:00+00',due_at='2026-11-19 10:00:00+00',next_check_at='2026-11-19 10:00:00+00',
    attempted_at='2026-11-19 10:00:00+00',
    sent_at='2026-11-19 10:00:00+00',unsubscribe_token_hash='${'c'.repeat(64)}' WHERE id='${attemptId(5)}'`);
  assert.equal(sql('SET ROLE service_role; SELECT count(*) FROM public.km16_claim_checkout_reminders(10)'), '1');
  const candidateToken = token(6);
  const stopHolder = session('checkout-stop-holder');
  stopHolder.send(`BEGIN; SET LOCAL ROLE service_role; SELECT 'STOPPED:'||public.km16_stop_checkout_reminders('${'c'.repeat(64)}');`);
  await stopHolder.waitFor('STOPPED:true');
  const stoppedPrepare = session('checkout-stopped-prepare');
  stoppedPrepare.send(`SET ROLE service_role; SET statement_timeout='6s'; SELECT 'STOP-WON:'||public.km16_prepare_checkout_reminder_send('${attemptId(6)}','${candidateToken}','${'d'.repeat(64)}');`);
  await waitBlocked('checkout-stopped-prepare');
  await stopHolder.end('COMMIT;');
  await stoppedPrepare.waitFor('STOP-WON:false');
  await stoppedPrepare.end('');
  assert.equal(sql(`SELECT state||':'||error_code FROM public.km16_checkout_reminders WHERE id='${attemptId(6)}'`), 'skipped:unsubscribed',
    'unsubscribe committed before prepare must prevent SMTP');
  assert.equal(sql("SELECT count(*) FROM public.km16_checkout_reminders WHERE state='sending'"), '0');
  assert.equal(sql("SELECT count(*) FROM public.km16_checkout_reminder_stops WHERE email='stop-race@example.invalid'"), '1');
  console.log('PASS concurrent PostgreSQL workers: SKIP LOCKED, rollback recovery, lease fencing, recipient budget serialization, unsubscribe before send.');
} finally {
  for (const active of sessions) {
    if (!active.done) active.child.kill('SIGTERM');
    await active.closed;
  }
  removeAttempts();
  sql(`DELETE FROM public.km16_checkout_reminder_stops WHERE email IN ('shared-recipient@example.invalid','stop-race@example.invalid');
    DELETE FROM public.km16_videos WHERE id LIKE 'concurrent%';
    DELETE FROM auth.users WHERE id::text LIKE '71000000-%';
    CREATE OR REPLACE FUNCTION public.km16_checkout_reminder_clock()
      RETURNS timestamptz LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''
      AS $$ SELECT pg_catalog.now(); $$`);
}
