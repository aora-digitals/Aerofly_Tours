-- Phase 7 schema/security smoke checks. Run only after all Phase 7 migrations.
-- This validates installed objects and direct-write grants; it does not replace multi-user RLS integration tests.
do $$
declare
  v_missing text;
begin
  select string_agg(required_name, ', ') into v_missing
  from (values
    ('organization_settings'),
    ('admin_audit_log'),
    ('organization_memberships'),
    ('role_permissions'),
    ('user_roles'),
    ('admin_erp_overview_scoped'),
    ('admin_erp_reports_scoped'),
    ('admin_assign_user_role'),
    ('admin_remove_user_role'),
    ('admin_set_role_permission'),
    ('admin_set_membership')
  ) required(required_name)
  where not exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname=required.required_name
  ) and not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=required.required_name
  );
  if v_missing is not null then
    raise exception 'Phase 7 objects missing: %', v_missing;
  end if;

  if not (select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='admin_audit_log') then
    raise exception 'admin_audit_log must have RLS enabled';
  end if;
  if not (select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='organization_settings') then
    raise exception 'organization_settings must have RLS enabled';
  end if;

  if has_table_privilege('authenticated','public.user_roles','INSERT') then
    raise exception 'authenticated must not directly insert user_roles';
  end if;
  if has_table_privilege('authenticated','public.role_permissions','INSERT') then
    raise exception 'authenticated must not directly insert role_permissions';
  end if;
  if has_table_privilege('authenticated','public.organization_memberships','UPDATE') then
    raise exception 'authenticated must not directly update organization_memberships';
  end if;
  if has_table_privilege('authenticated','public.finance_transactions','INSERT') then
    raise exception 'authenticated must not directly insert finance_transactions';
  end if;

  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='has_permission') then
    raise exception 'has_permission helper is missing';
  end if;
  raise notice 'Phase 7 schema smoke checks passed';
end $$;
