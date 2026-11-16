import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const sql=readFileSync('docs/phase14-rpc-ecriture-non-deploye.sql','utf8');
for(const token of [
 'function public.km16_member_review_set(',
 "lower(u.email)='alexandre.marchat@gmail.com'",
 'c.archived_at is null',
 'for update;',
 'pg_catalog.pg_advisory_xact_lock(',
 'v_version<>p_expected_version',
 'if v_previous=p_state then',
 'insert into public.km16_member_review_status',
 'insert into public.km16_member_review_history',
 'revoke all on function public.km16_member_review_set',
 'grant execute on function public.km16_member_review_set'
])assert.ok(sql.includes(token),'Missing safeguard: '+token);
assert.doesNotMatch(sql,/\b(update|delete|truncate)\s+public\.km16_(external_clients|membership|external_payment)/i);
console.log('KM16 phase 14 draft write RPC safeguards passed (static only)');
