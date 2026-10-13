-- Version numbers are unique within an application/checklist/document category.
-- Backfill existing metadata deterministically before enforcing the invariant.
begin;
with ranked as (
  select id, row_number() over (
    partition by "applicationId", "checklistItemId", "documentType"
    order by "uploadedAt" asc, id asc
  )::integer as new_version
  from public.application_documents
)
update public.application_documents d
set version_number = ranked.new_version
from ranked
where d.id = ranked.id and d.version_number is distinct from ranked.new_version;

update public.application_document_versions v
set version_number = d.version_number
from public.application_documents d
where v.document_id = d.id and v.version_number is distinct from d.version_number;

create unique index if not exists application_documents_version_group_uidx
  on public.application_documents("applicationId", "checklistItemId", "documentType", version_number)
  where "checklistItemId" is not null;
create unique index if not exists application_documents_version_no_checklist_uidx
  on public.application_documents("applicationId", "documentType", version_number)
  where "checklistItemId" is null;
commit;
