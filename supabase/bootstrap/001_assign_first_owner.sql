-- ============================================================
-- AeroFly Tours
-- One-time owner bootstrap
-- ============================================================

begin;

-- Replace this UUID with the actual auth.users.id.
select id, email
from auth.users
where id = 'REPLACE_WITH_YOUR_SUPABASE_USER_UUID';

-- Assign AeroFly organization membership.
insert into public.organization_memberships (
  user_id,
  organization_id,
  job_title,
  status
)
select
  'REPLACE_WITH_YOUR_SUPABASE_USER_UUID'::uuid,
  o.id,
  'Owner',
  'active'
from public.organizations o
where o.slug = 'aerofly-tours'
on conflict (user_id, organization_id)
do update set
  job_title = excluded.job_title,
  status = 'active';

-- Remove only the default customer role from this account.
delete from public.user_roles
where user_id = 'REPLACE_WITH_YOUR_SUPABASE_USER_UUID'::uuid;

-- Assign owner.
insert into public.user_roles (
  user_id,
  role_id,
  organization_id
)
select
  'REPLACE_WITH_YOUR_SUPABASE_USER_UUID'::uuid,
  r.id,
  o.id
from public.roles r
cross join public.organizations o
where r.key = 'owner'
  and o.slug = 'aerofly-tours'
on conflict do nothing;

commit;