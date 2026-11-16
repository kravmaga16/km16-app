import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const sql=readFileSync('docs/phase14-schema-propose-non-deploye.sql','utf8');
for(const table of ['km16_member_review_status','km16_member_review_history']){
 assert.ok(sql.includes('create table if not exists public.'+table),'Missing '+table);
 assert.ok(sql.includes('alter table public.'+table+' enable row level security'),'RLS missing '+table);
 assert.ok(sql.includes('revoke all on public.'+table+' from public, anon, authenticated'),'Direct grants must be revoked '+table);
}
assert.match(sql,/check \(state in \('a_verifier','en_cours','controle'\)\)/);
assert.match(sql,/primary key \(season_id,environment,source,source_member_id\)/);
assert.doesNotMatch(sql,/grant\s+.+\s+to\s+(anon|authenticated)/i);
assert.doesNotMatch(sql,/create\s+(or\s+replace\s+)?function/i);
assert.doesNotMatch(sql,/references public\.km16_external_clients/i,'Source FK could obstruct archival/deletion');
console.log('KM16 phase 14 draft SQL guardrails passed (static checks only)');
