-- Run after applying the Phase 8 migration to a disposable/local database.
do $$
declare t text;
begin
  foreach t in array array[
    'travel_applications','application_checklist_items','application_documents',
    'application_events','travel_application_notes','application_document_versions',
    'support_tickets','support_ticket_messages','support_ticket_events'
  ] loop
    if to_regclass('public.' || t) is null then
      raise exception 'Missing Phase 8 table: %', t;
    end if;
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=t and c.relrowsecurity
    ) then raise exception 'RLS is not enabled on public.%', t; end if;
  end loop;
  if not exists (select 1 from storage.buckets where id='travel-documents' and public=false and file_size_limit=10485760) then
    raise exception 'travel-documents bucket is missing or not private/10 MB';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='phase8_set_application_status') then
    raise exception 'Application status RPC is missing';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='phase8_update_support_ticket') then
    raise exception 'Support ticket update RPC is missing';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='phase8_staff_review_document_safe') then
    raise exception 'Document review RPC is missing';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='phase8_staff_update_checklist_item') then
    raise exception 'Checklist update RPC is missing';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='phase8_create_travel_application_safe') then
    raise exception 'Safe travel application creation RPC is missing';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='phase8_set_application_status_safe') then
    raise exception 'Safe application status RPC is missing';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='phase8_add_support_ticket_message') then
    raise exception 'Atomic support reply RPC is missing';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='phase8_finalize_document_upload') then
    raise exception 'Atomic document finalization RPC is missing';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='phase8_staff_assign_application') then
    raise exception 'Atomic application assignment RPC is missing';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='phase8_staff_add_checklist_item') then
    raise exception 'Atomic checklist request RPC is missing';
  end if;
  if not exists (select 1 from pg_indexes where schemaname='public' and indexname='application_documents_version_group_uidx') then
    raise exception 'Checklist document version uniqueness index is missing';
  end if;
  if not exists (select 1 from pg_indexes where schemaname='public' and indexname='application_documents_version_no_checklist_uidx') then
    raise exception 'Unlinked document version uniqueness index is missing';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='phase8_create_travel_application') then
    raise exception 'Atomic application creation RPC is missing';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='phase8_create_support_ticket') then
    raise exception 'Atomic support ticket creation RPC is missing';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='phase8_add_support_ticket_message') then
    raise exception 'Atomic support ticket message RPC is missing';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='application_documents' and column_name='upload_completed_at') then
    raise exception 'Upload completion guard column is missing';
  end if;
  if has_table_privilege('authenticated', 'public.support_ticket_messages', 'INSERT') then
    raise exception 'Authenticated users can bypass the guarded ticket message RPC';
  end if;
  if has_table_privilege('authenticated', 'public.support_tickets', 'INSERT') then
    raise exception 'Authenticated users can bypass atomic ticket creation';
  end if;
end $$;

-- Inspect policy definitions during review; behavioral isolation must be tested with real JWTs.
select schemaname, tablename, policyname, cmd
from pg_policies
where (schemaname='public' and tablename in (
  'travel_applications','application_checklist_items','application_documents',
  'application_events','travel_application_notes','application_document_versions',
  'support_tickets','support_ticket_messages','support_ticket_events'
)) or (schemaname='storage' and tablename='objects' and policyname like 'phase8_travel_docs_%')
order by schemaname, tablename, policyname;
