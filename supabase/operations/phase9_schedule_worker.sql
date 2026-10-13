-- Run manually in Supabase SQL Editor AFTER enabling pg_cron and pg_net
-- and creating these Vault secrets:
--   phase9_project_url       = https://YOUR_PROJECT_REF.supabase.co
--   phase9_dispatch_secret   = the same value as NOTIFICATION_DISPATCH_SECRET
-- Never store the secret in this SQL file or in frontend code.

do $$
declare existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname='aerofly-notification-dispatch';
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
end $$;

select cron.schedule(
  'aerofly-notification-dispatch',
  '* * * * *',
  $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name='phase9_project_url')
             || '/functions/v1/notification-dispatch',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'x-notification-dispatch-secret',
          (select decrypted_secret from vault.decrypted_secrets where name='phase9_dispatch_secret')
      ),
      body := '{"batchSize":20}'::jsonb,
      timeout_milliseconds := 10000
    );
  $job$
);
