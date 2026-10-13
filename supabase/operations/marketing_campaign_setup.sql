-- Enable the Vault extension if needed. Run once in the Supabase SQL Editor.
-- Verify an existing phase9_project_url secret before reusing it.
-- Replace both placeholders before running this block.
do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'phase9_project_url') then
    perform vault.create_secret('https://YOUR_PROJECT_REF.supabase.co', 'phase9_project_url');
  end if;
  if not exists (select 1 from vault.decrypted_secrets where name = 'marketing_campaign_secret') then
    perform vault.create_secret('REPLACE_WITH_MARKETING_CAMPAIGN_WORKER_SECRET', 'marketing_campaign_secret');
  end if;
end $$;
