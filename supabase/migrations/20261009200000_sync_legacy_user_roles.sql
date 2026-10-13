
-- ============================================================
-- AeroFly Tours: Synchronize legacy users.role with user_roles
-- File: 20261009200000_sync_legacy_user_roles.sql
--
-- Mapping:
--   public.users.role = 'user'  -> public.roles.key = 'customer'
--   Other supported role values -> matching public.roles.key
--
-- Organization-specific assignments are preserved.
-- Untrusted clients cannot promote themselves by updating users.role.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. Validate required role definitions before changing data.
-- ------------------------------------------------------------

do $$
declare
  missing_roles text;
begin
  select string_agg(required_role, ', ')
  into missing_roles
  from unnest(array[
    'customer',
    'owner',
    'manager',
    'marketing',
    'customer_care',
    'staff',
    'counsellor',
    'admin'
  ]) as required(required_role)
  where not exists (
    select 1
    from public.roles r
    where r.key = required.required_role
  );

  if missing_roles is not null then
    raise exception
      'Missing role definitions in public.roles: %',
      missing_roles;
  end if;
end;
$$;


-- ------------------------------------------------------------
-- 2. Synchronization trigger function.
--
-- SECURITY DEFINER allows the function to update user_roles
-- under controlled privileges, including when table RLS applies.
--
-- Only trusted server/database operations may change an
-- existing role or create a privileged legacy user record.
-- Ordinary signup may create a default "user" account.
-- ------------------------------------------------------------

create or replace function public.sync_legacy_user_role()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_user_id uuid;
  v_role_key text;
  v_is_trusted boolean;
begin
  v_is_trusted :=
    session_user in ('postgres', 'supabase_admin')
    or coalesce(auth.role(), '') = 'service_role';

  -- Do not synchronize records that are not linked to Supabase Auth.
  if new."openId" !~ '^supabase:[0-9a-fA-F-]{36}$' then
    if tg_op = 'UPDATE'
       and new.role is distinct from old.role
       and not v_is_trusted then
      raise exception 'Only trusted server operations can change user roles'
        using errcode = '42501';
    end if;

    return new;
  end if;

  v_user_id := substring(new."openId" from 10)::uuid;

  -- Block direct client-side role escalation.
  if tg_op = 'INSERT' then
    if new.role::text <> 'user' and not v_is_trusted then
      raise exception 'Only trusted server operations can assign privileged roles'
        using errcode = '42501';
    end if;
  elsif new.role is distinct from old.role then
    if not v_is_trusted then
      raise exception 'Only trusted server operations can change user roles'
        using errcode = '42501';
    end if;
  end if;

  -- A profile must exist because user_roles references profiles(id).
  if not exists (
    select 1
    from public.profiles p
    where p.id = v_user_id
  ) then
    -- Do not break signup if profile creation is still in progress.
    return new;
  end if;

  -- Legacy "user" means the authorization role "customer".
  v_role_key :=
    case new.role::text
      when 'user' then 'customer'
      else new.role::text
    end;

  if not exists (
    select 1
    from public.roles r
    where r.key = v_role_key
  ) then
    raise exception 'No authorization role exists for legacy role: %',
      v_role_key;
  end if;

  -- Replace only global assignments.
  -- Preserve organization-specific roles.
  delete from public.user_roles ur
  where ur.user_id = v_user_id
    and ur.organization_id is null;

  insert into public.user_roles (
    user_id,
    role_id,
    organization_id
  )
  select
    v_user_id,
    r.id,
    null
  from public.roles r
  where r.key = v_role_key
  on conflict do nothing;

  return new;
end;
$$;

-- Only trusted database/server execution should invoke this
-- function directly. The trigger itself remains installed.
revoke all on function public.sync_legacy_user_role()
from public, anon, authenticated;


-- ------------------------------------------------------------
-- 3. Install the trigger.
-- ------------------------------------------------------------

drop trigger if exists users_sync_legacy_role
on public.users;

create trigger users_sync_legacy_role
after insert or update of role, "openId"
on public.users
for each row
execute function public.sync_legacy_user_role();


-- ------------------------------------------------------------
-- 4. Backfill existing Supabase-linked users.
--
-- This runs as part of the trusted migration.
-- It preserves organization-specific role assignments.
-- ------------------------------------------------------------

delete from public.user_roles ur
using public.users u
where u."openId" ~ '^supabase:[0-9a-fA-F-]{36}$'
  and ur.user_id = substring(u."openId" from 10)::uuid
  and ur.organization_id is null
  and exists (
    select 1
    from public.profiles p
    where p.id = ur.user_id
  );

insert into public.user_roles (
  user_id,
  role_id,
  organization_id
)
select
  substring(u."openId" from 10)::uuid,
  r.id,
  null
from public.users u
join public.profiles p
  on p.id = substring(u."openId" from 10)::uuid
join public.roles r
  on r.key = case u.role::text
    when 'user' then 'customer'
    else u.role::text
  end
where u."openId" ~ '^supabase:[0-9a-fA-F-]{36}$'
on conflict do nothing;

commit;
