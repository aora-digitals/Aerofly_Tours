-- Finalize document metadata, version history, checklist status and timeline atomically.
-- Service-role only: the Edge Function first inspects the actual private object bytes.
begin;
create or replace function public.phase8_finalize_document_upload(
  p_document_id integer,
  p_actor_id uuid,
  p_size_bytes bigint,
  p_mime_type text,
  p_checksum_sha256 text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_doc public.application_documents;
  v_owner uuid;
begin
  if p_actor_id is null or p_size_bytes is null or p_size_bytes < 1 or p_size_bytes > 10485760
     or p_mime_type is null or p_mime_type not in ('application/pdf','image/jpeg','image/png','image/webp')
     or p_checksum_sha256 is null or p_checksum_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid verified document metadata' using errcode = '22023';
  end if;
  select * into v_doc from public.application_documents where id=p_document_id for update;
  if not found then raise exception 'Document not found' using errcode = 'P0002'; end if;
  select customer_auth_id into v_owner from public.travel_applications where id=v_doc."applicationId";
  if v_owner is distinct from p_actor_id or v_doc.uploaded_by is distinct from p_actor_id then
    raise exception 'Document owner mismatch' using errcode = '42501';
  end if;
  if v_doc.upload_completed_at is not null then
    return jsonb_build_object('documentId',v_doc.id,'status','uploaded','versionNumber',v_doc.version_number,'alreadyCompleted',true);
  end if;
  if v_doc.storage_path is null or v_doc.storage_path='pending' then
    raise exception 'Upload path is not initialized' using errcode = '22023';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id='travel-documents' and o.name=v_doc.storage_path) then
    raise exception 'Private storage object does not exist' using errcode = '22023';
  end if;
  update public.application_documents set status='uploaded', "sizeBytes"=p_size_bytes::integer,
    "mimeType"=p_mime_type, "uploadedAt"=now(), upload_completed_at=now(), checksum_sha256=p_checksum_sha256
  where id=p_document_id returning * into v_doc;
  insert into public.application_document_versions(document_id,version_number,storage_path,file_name,mime_type,size_bytes,checksum_sha256,uploaded_by)
  values (v_doc.id,v_doc.version_number,v_doc.storage_path,v_doc."fileName",p_mime_type,p_size_bytes,p_checksum_sha256,p_actor_id);
  if v_doc."checklistItemId" is not null then
    update public.application_checklist_items set status='received'
    where id=v_doc."checklistItemId" and status in ('pending','rejected');
  end if;
  insert into public.application_events("applicationId","fromStatus","toStatus",note,customer_visible,metadata)
  values (v_doc."applicationId",null,null,'A document was uploaded',true,
    jsonb_build_object('document_id',v_doc.id,'version_number',v_doc.version_number));
  return jsonb_build_object('documentId',v_doc.id,'status','uploaded','versionNumber',v_doc.version_number,'alreadyCompleted',false);
end;
$$;
revoke all on function public.phase8_finalize_document_upload(integer,uuid,bigint,text,text) from public, anon, authenticated;
grant execute on function public.phase8_finalize_document_upload(integer,uuid,bigint,text,text) to service_role;
commit;
