-- Enable pg_cron and pg_net from Supabase Dashboard > Database > Extensions first.
-- Store these values in Supabase Vault; never put the secret in frontend code.
-- Vault secret names required:
--   phase9_project_url       = https://YOUR_PROJECT_REF.supabase.co
--   marketing_campaign_secret = same value as MARKETING_CAMPAIGN_WORKER_SECRET

select cron.unschedule(jobid)
from cron.job
where jobname = 'aerofly-marketing-campaign-dispatch';

select cron.schedule(
  'aerofly-marketing-campaign-dispatch',
  '* * * * *',
  $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'phase9_project_url') || '/functions/v1/marketing-campaigns',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-marketing-worker-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'marketing_campaign_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 15000
    );
  $job$
);
