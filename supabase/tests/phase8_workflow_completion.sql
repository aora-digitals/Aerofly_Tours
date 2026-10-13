-- Structural/security assertions for Phase 8 completion migrations.
-- Run against a disposable local Supabase database after applying all Phase 8 migrations.
do $$
declare v_count integer;
begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='application_documents' and column_name='upload_completed_at') then
    raise exception 'Missing upload_completed_at guard column';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='application_documents' and column_name='reviewer_auth_id') then
    raise exception 'Missing document reviewer identity';
  end if;
  if to_regprocedure('public.phase8_staff_review_document_safe(integer,public.document_status,text)') is null then
    raise exception 'Document review RPC missing';
  end if;
  if to_regprocedure('public.phase8_staff_update_checklist_item(integer,public.checklist_status,text)') is null then
    raise exception 'Checklist review RPC missing';
  end if;
  if to_regprocedure('public.phase8_set_application_status(integer,public.travel_application_status,text)') is null then
    raise exception 'Application status RPC missing';
  end if;
  if to_regprocedure('public.phase8_set_application_status_safe(integer,public.travel_application_status,text)') is null then
    raise exception 'Safe application status RPC missing';
  end if;
  if to_regprocedure('public.phase8_create_travel_application_safe(public.travel_application_type,text,text,text,text,text,text,text,jsonb,public.travel_application_urgency)') is null then
    raise exception 'Safe application creation RPC missing';
  end if;
  if to_regprocedure('public.phase8_create_support_ticket(text,text,text,text,integer,integer)') is null then
    raise exception 'Atomic support ticket creation RPC missing';
  end if;
  if to_regprocedure('public.phase8_add_support_ticket_message(bigint,text,boolean)') is null then
    raise exception 'Atomic support reply RPC missing';
  end if;
  if to_regprocedure('public.phase8_finalize_document_upload(integer,uuid,bigint,text,text)') is null then
    raise exception 'Atomic document finalization RPC missing';
  end if;
  if to_regprocedure('public.phase8_staff_assign_application(integer,uuid,uuid)') is null then
    raise exception 'Atomic application assignment RPC missing';
  end if;
  if to_regprocedure('public.phase8_staff_add_checklist_item(integer,text,text,boolean,text,boolean)') is null then
    raise exception 'Atomic checklist request RPC missing';
  end if;
  if not exists (select 1 from pg_indexes where schemaname='public' and indexname='application_documents_version_group_uidx') then
    raise exception 'Checklist document version uniqueness index is missing';
  end if;
  if not exists (select 1 from pg_indexes where schemaname='public' and indexname='application_documents_version_no_checklist_uidx') then
    raise exception 'Unlinked document version uniqueness index is missing';
  end if;
  if not exists (select 1 from pg_trigger where tgname='phase8_ticket_message_audit' and not tgisinternal) then
    raise exception 'Support ticket message audit trigger missing';
  end if;
  if has_table_privilege('authenticated', 'public.travel_application_notes', 'INSERT') then
    raise exception 'Authenticated users can directly insert private application notes';
  end if;
  if has_table_privilege('authenticated', 'public.application_documents', 'UPDATE') then
    raise exception 'Authenticated users can directly update document review state';
  end if;
  if has_function_privilege('anon', 'public.phase8_staff_review_document_safe(integer,public.document_status,text)', 'EXECUTE') then
    raise exception 'Anonymous users can execute document review RPC';
  end if;
  if not has_function_privilege('authenticated', 'public.phase8_staff_review_document_safe(integer,public.document_status,text)', 'EXECUTE') then
    raise exception 'Authenticated role cannot invoke guarded document review RPC';
  end if;
  if has_function_privilege('authenticated', 'public.phase8_staff_review_document(integer,public.document_status,text)', 'EXECUTE') then
    raise exception 'Unsafe composite-returning document review RPC is still callable';
  end if;
  if has_function_privilege('authenticated', 'public.phase8_set_application_status(integer,public.travel_application_status,text)', 'EXECUTE') then
    raise exception 'Unsafe composite-returning application status RPC is still callable';
  end if;
  if has_function_privilege('authenticated', 'public.phase8_create_travel_application(public.travel_application_type,text,text,text,text,text,text,text,jsonb,public.travel_application_urgency)', 'EXECUTE') then
    raise exception 'Unsafe composite-returning application creation RPC is still callable';
  end if;
  select count(*) into v_count from pg_policies where schemaname='public' and tablename='application_events' and policyname='phase8_events_customer_select';
  if v_count <> 1 then raise exception 'Customer-visible event policy is missing'; end if;
  if not exists (select 1 from storage.buckets where id='travel-documents' and public=false) then
    raise exception 'Travel documents bucket is not private';
  end if;
  if has_column_privilege('authenticated','public.travel_applications','internalNotes','SELECT') then
    raise exception 'Legacy internalNotes remains readable by authenticated clients';
  end if;
  if has_column_privilege('authenticated','public.application_documents','storage_path','SELECT') then
    raise exception 'Private storage path remains readable by authenticated clients';
  end if;
  if has_function_privilege('authenticated','public.phase8_finalize_document_upload(integer,uuid,bigint,text,text)','EXECUTE') then
    raise exception 'Authenticated clients can bypass verified upload finalization';
  end if;
  if not has_function_privilege('service_role','public.phase8_finalize_document_upload(integer,uuid,bigint,text,text)','EXECUTE') then
    raise exception 'Service role cannot finalize verified uploads';
  end if;
end $$;

select schemaname, tablename, policyname, cmd, qual, with_check
from pg_policies
where (schemaname='public' and tablename in (
  'travel_applications','application_checklist_items','application_documents',
  'application_events','travel_application_notes','application_document_versions',
  'support_tickets','support_ticket_messages','support_ticket_events'
)) or (schemaname='storage' and tablename='objects' and policyname like 'phase8_travel_docs_%')
order by schemaname, tablename, policyname;
