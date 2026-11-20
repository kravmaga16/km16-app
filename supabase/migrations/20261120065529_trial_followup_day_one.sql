alter table public.km16_trial_reminders drop constraint km16_trial_reminders_day_check;
alter table public.km16_trial_reminders add constraint km16_trial_reminders_day_check
check (day in (3,7) or (day=1 and channel='email'));

CREATE OR REPLACE FUNCTION public.km16_trial_tick()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 -- Un essai ancien ne déclenche pas plusieurs rappels en retard.
 update public.km16_trial_reminders set state='uncertain',error_code='interrupted' where state='sending' and locked_at<now()-interval '3 minutes';
 update public.km16_trial_reminders r set state='skipped',error_code='no_longer_eligible' where state='pending' and not public.km16_trial_eligible(r.trial_id);
 insert into public.km16_trial_reminders(trial_id,day,channel,target,due_at)
 select t.id,d.day,'email',t.email,((t.attended_on+d.day)+time '09:00') at time zone 'Europe/Paris'
 from public.km16_trial_attendance t
 cross join lateral (values (case when t.attended_on >= date '2026-11-20' then 1 else 3 end),(7)) d(day)
 where public.km16_trial_eligible(t.id) and ((t.attended_on+d.day)+time '09:00') at time zone 'Europe/Paris' between now()-interval '2 days' and now()
 on conflict do nothing;
 insert into public.km16_trial_reminders(trial_id,day,channel,target,due_at)
 select t.id,d.day,'push',l.token_hash,((t.attended_on+d.day)+time '09:00') at time zone 'Europe/Paris'
 from public.km16_trial_attendance t cross join (values(3),(7)) d(day)
 join public.km16_trial_push_links l on l.email=t.email
 where public.km16_trial_eligible(t.id) and ((t.attended_on+d.day)+time '09:00') at time zone 'Europe/Paris' between now()-interval '2 days' and now()
 on conflict do nothing;
 update public.km16_trial_reminders set state='skipped',error_code='expired' where state='pending' and due_at<now()-interval '2 days';
end $function$

;