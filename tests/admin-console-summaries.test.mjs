import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';

test('admin summaries return scoped history and exact course counts with MFA', async () => {
 const db=new PGlite();
 try{
  await db.exec(`
   create role anon;
   create role authenticated;
   create schema auth;
   create function auth.jwt() returns jsonb language sql stable as
   $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
   create function public.km16_ops_is_admin() returns boolean language sql stable as
   $$ select auth.jwt()->>'sub' = 'fixture-admin' $$;
   create table public.km16_course_sessions(id int primary key, session_date date);
   create table public.km16_course_bookings(id int primary key, session_id int, status text);
   create table public.km16_booking_member_links(booking_id int primary key);
   create table public.km16_booking_external_links(booking_id int primary key);
   create table public.km16_course_attendance(booking_id int primary key, present boolean);
   create table public.km16_membership_followup_log(order_id uuid, recorded_at timestamptz);
   create table public.km16_membership_followup_outbox(id int primary key, order_id uuid, created_at timestamptz, state text);
   insert into public.km16_course_sessions values
    (1,(now() at time zone 'Europe/Paris')::date-1), (2,(now() at time zone 'Europe/Paris')::date);
   insert into public.km16_course_bookings values
    (1,1,'Inscrit'), (2,1,'Inscrit'), (3,1,'Annulé'), (4,2,'Inscrit'), (5,2,'Inscrit');
   insert into public.km16_booking_member_links values (2);
   insert into public.km16_booking_external_links values (2),(5);
   insert into public.km16_course_attendance values (2,false);
   insert into public.km16_membership_followup_log values
    ('00000000-0000-0000-0000-000000000001','2026-01-01 UTC'),
    ('00000000-0000-0000-0000-000000000001','2026-01-02 UTC');
   insert into public.km16_membership_followup_outbox values
    (1,'00000000-0000-0000-0000-000000000001','2026-01-03 UTC','failed'),
    (2,'00000000-0000-0000-0000-000000000001','2026-01-03 UTC','accepted');
  `);
  await db.exec(readFileSync(new URL('../supabase/migrations/20261127171430_admin_course_and_followup_summaries.sql',import.meta.url),'utf8'));
  const counts='select * from public.km16_admin_course_alert_counts()';
  const ids=['00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002'];
  const summaries='select * from public.km16_admin_followup_summaries($1::uuid[]) order by order_id';
  await db.exec('set role anon');
  await assert.rejects(db.query(counts),{code:'42501'});
  await assert.rejects(db.query(summaries,[ids]),{code:'42501'});
  await db.exec('set role authenticated');
  for(const claims of [{sub:'fixture-member',aal:'aal2'},{sub:'fixture-admin',aal:'aal1'},{aal:'aal2'},{}]){
   await db.query("select set_config('request.jwt.claims', $1, false)",[JSON.stringify(claims)]);
   await assert.rejects(db.query(counts),{code:'42501'});
   await assert.rejects(db.query(summaries,[ids]),{code:'42501'});
  }
  await db.query("select set_config('request.jwt.claims', $1, false)",[JSON.stringify({sub:'fixture-admin',aal:'aal2'})]);
  assert.deepEqual((await db.query(counts)).rows,[{unlinked:2,attendance_due:1}]);
  const {rows}=await db.query(summaries,[[...ids,ids[0]]]);
  assert.equal(rows.length,2);
  assert.equal(rows[0].delivery_state,'accepted');
  assert.equal(rows[0].recorded_at.toISOString(),'2026-01-02T00:00:00.000Z');
  assert.deepEqual(rows[1],{order_id:ids[1],recorded_at:null,delivery_at:null,delivery_state:null});
  await assert.rejects(db.query(summaries,[Array(101).fill(ids[0])]),{code:'22023'});
 }finally{await db.close();}
});

test('course scope is restricted and omits unchanged rosters', async () => {
 const db=new PGlite();
 try{
  await db.exec(`
   create role anon;
   create role authenticated;
   create function public.km16_ops_is_admin() returns boolean language sql stable as
   $$ select current_setting('role',true)='authenticated' and current_setting('fixture.admin',true)='yes' $$;
   create table public.km16_course_sessions(id uuid primary key, course_key text, session_date date, category text, start_time time, end_time time, venue text, enabled boolean);
   create table public.km16_course_bookings(id uuid primary key, session_id uuid, first_name text, last_name text, email text, status text, created_at timestamptz, cancelled_at timestamptz, read_at timestamptz);
   create table public.km16_booking_member_links(booking_id uuid primary key,membership_order_id uuid);
   create table public.km16_booking_external_links(booking_id uuid primary key,external_id uuid,season_id text);
   create table public.km16_course_attendance(booking_id uuid primary key,present boolean);
   insert into public.km16_course_sessions(id,session_date,enabled) values
    ('00000000-0000-0000-0000-000000000001','2026-11-27',true),
    ('00000000-0000-0000-0000-000000000002','2026-11-28',true);
   insert into public.km16_course_bookings(id,session_id,email,status) values
    ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001','fixture@example.invalid','Inscrit'),
    ('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000002','outside@example.invalid','Inscrit');
  `);
  await db.exec(readFileSync(new URL('../supabase/migrations/20261127182516_course_console_scoped_snapshot.sql',import.meta.url),'utf8'));
  const query='select public.km16_admin_course_scope($1::date,$2::uuid,$3::text) as value';
  const date='2026-11-27';
  await db.exec('set role anon');
  await assert.rejects(db.query(query,[date,null,null]),{code:'42501'});
  await db.exec('set role authenticated');
  await assert.rejects(db.query(query,[date,null,null]),{code:'42501'});
  await db.exec("set fixture.admin='yes'");
  await assert.rejects(db.query(query,[null,null,null]),{code:'22023'});
  const call=async (...args)=>(await db.query(query,args)).rows[0].value;
  const snapshot=await call(date,null,null);
  assert.equal(snapshot.bookings.length,1);
  assert.equal(snapshot.bookings[0].email,'fixture@example.invalid');
  assert.deepEqual(await call(date,null,snapshot.version),{version:snapshot.version,unchanged:true});
  const id=snapshot.sessions[0].id;
  assert.deepEqual(await call(null,id,null),snapshot);
  await db.exec("reset role; insert into public.km16_course_attendance values ('00000000-0000-0000-0000-000000000011',false); set role authenticated");
  const updated=await call(null,id,snapshot.version);
  assert.equal(updated.unchanged,false);
  assert.equal(updated.bookings[0].present,false);
 }finally{await db.close();}
});
