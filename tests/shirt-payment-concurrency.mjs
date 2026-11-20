// Two real PostgreSQL sessions; only the isolated CI database is accepted.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';

assert.ok(['localhost', '127.0.0.1'].includes(process.env.PGHOST));
assert.equal(process.env.PGDATABASE, 'purchase_test');
assert.equal(process.env.PGUSER, 'postgres');
const first = '50000000-0000-4000-8000-000000000001';
const second = '50000000-0000-4000-8000-000000000002';
const args = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1'];
function sql(query) {
  const result = spawnSync('psql', [...args, '-c', query], {
    encoding: 'utf8', timeout: 5000, env: process.env,
  });
  assert.equal(result.status, 0, result.error?.message || result.stderr);
  return result.stdout.trim();
}

sql(`INSERT INTO public.km16_shirt_orders
  (id,stripe_session_id,amount_cents,livemode,created_at) VALUES
  ('${first}','cs_live_concurrent1',1800,true,now()-interval '2 hours'),
  ('${second}','cs_live_concurrent2',1800,true,now()-interval '1 hour')`);

const holder = spawn('psql', args, { stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
const closed = new Promise(resolve => holder.once('close', resolve));
let held = false;
try {
  const ready = new Promise((resolve, reject) => {
    let output = '', error = '';
    const timeout = setTimeout(() => reject(Error('First connection did not reserve its row')), 5000);
    holder.stdout.on('data', chunk => {
      output += chunk.toString();
      if (output.includes('LOCKED:' + first)) { clearTimeout(timeout); resolve(); }
    });
    holder.stderr.on('data', chunk => { error += chunk.toString(); });
    holder.once('error', e => { clearTimeout(timeout); reject(e); });
    holder.once('close', () => {
      clearTimeout(timeout);
      if (!output.includes('LOCKED:' + first)) reject(Error(error || 'First connection closed early'));
    });
  });
  holder.stdin.write("BEGIN; SET LOCAL ROLE service_role; SELECT 'LOCKED:' || id FROM public.km16_claim_shirt_payment_checks(1);\n");
  await ready;
  held = true;
  // The first connection is still open, holding its row lock and uncommitted update.
  assert.equal(sql('SET ROLE service_role; SELECT id FROM public.km16_claim_shirt_payment_checks(1)'), second,
    'second session must skip the locked first order and reserve the next');
  holder.stdin.end('ROLLBACK;\n');
  assert.equal(await closed, 0);
  held = false;
  assert.equal(sql('SET ROLE service_role; SELECT id FROM public.km16_claim_shirt_payment_checks(1)'), first,
    'an aborted reservation becomes available again');
  assert.equal(sql('SET ROLE service_role; SELECT count(*) FROM public.km16_claim_shirt_payment_checks(8)'), '0',
    'neither recent reservation can be claimed again');
  console.log('PASS: two concurrent PostgreSQL sessions skip locked orders, recover rollback and exclude active reservations.');
} finally {
  if (held || holder.exitCode === null) holder.kill('SIGTERM');
  await closed;
  sql(`DELETE FROM public.km16_shirt_orders WHERE id IN ('${first}','${second}')`);
}
