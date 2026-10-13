-- Run after the role-specific workspace migration in a local Supabase database.
-- Catalogue-level assertions; use the manual multi-user RLS matrix in the guide
-- for end-to-end identity and row-isolation tests.
do $$
declare
  v_customer uuid; v_sales uuid; v_finance uuid; v_marketing uuid;
  v_operations uuid; v_support uuid; v_department_manager uuid;
begin
  select id into v_customer from public.roles where key='customer';
  select id into v_sales from public.roles where key='sales';
  select id into v_finance from public.roles where key='finance';
  select id into v_marketing from public.roles where key='marketing';
  select id into v_operations from public.roles where key='operations';
  select id into v_support from public.roles where key='support';
  select id into v_department_manager from public.roles where key='department_manager';

  if v_customer is null or v_sales is null or v_finance is null or v_marketing is null
     or v_operations is null or v_support is null or v_department_manager is null then
    raise exception 'Required Phase 7 workspace roles are missing';
  end if;

  if exists (select 1 from public.role_permissions rp join public.permissions p on p.id=rp.permission_id
    where rp.role_id=v_customer and p.key in ('admin.dashboard.read','finance.read','finance.manage','refunds.manage','employees.read','employees.manage','roles.read','roles.manage','settings.manage')) then
    raise exception 'Customer role has administrative permission grants';
  end if;
  if not exists (select 1 from public.role_permissions rp join public.permissions p on p.id=rp.permission_id where rp.role_id=v_sales and p.key='sales.read')
     or exists (select 1 from public.role_permissions rp join public.permissions p on p.id=rp.permission_id where rp.role_id=v_sales and p.key in ('finance.read','refunds.manage','roles.manage')) then
    raise exception 'Sales role permission boundary is incorrect';
  end if;
  if not exists (select 1 from public.role_permissions rp join public.permissions p on p.id=rp.permission_id where rp.role_id=v_finance and p.key='finance.read')
     or exists (select 1 from public.role_permissions rp join public.permissions p on p.id=rp.permission_id where rp.role_id=v_finance and p.key in ('roles.manage','employees.manage','tours.manage')) then
    raise exception 'Finance role permission boundary is incorrect';
  end if;
  if not exists (select 1 from public.role_permissions rp join public.permissions p on p.id=rp.permission_id where rp.role_id=v_marketing and p.key='marketing.read')
     or exists (select 1 from public.role_permissions rp join public.permissions p on p.id=rp.permission_id where rp.role_id=v_marketing and p.key in ('finance.read','refunds.manage','roles.manage')) then
    raise exception 'Marketing role permission boundary is incorrect';
  end if;
  if not exists (select 1 from public.role_permissions rp join public.permissions p on p.id=rp.permission_id where rp.role_id=v_operations and p.key='departures.read')
     or exists (select 1 from public.role_permissions rp join public.permissions p on p.id=rp.permission_id where rp.role_id=v_operations and p.key in ('finance.read','refunds.manage','roles.manage')) then
    raise exception 'Operations role permission boundary is incorrect';
  end if;
  if not exists (select 1 from public.role_permissions rp join public.permissions p on p.id=rp.permission_id where rp.role_id=v_support and p.key='support.read')
     or exists (select 1 from public.role_permissions rp join public.permissions p on p.id=rp.permission_id where rp.role_id=v_support and p.key in ('finance.read','refunds.manage','roles.manage')) then
    raise exception 'Support role permission boundary is incorrect';
  end if;
  if not exists (select 1 from public.role_permissions rp join public.permissions p on p.id=rp.permission_id where rp.role_id=v_department_manager and p.key='organization.read')
     or exists (select 1 from public.role_permissions rp join public.permissions p on p.id=rp.permission_id where rp.role_id=v_department_manager and p.key in ('roles.manage','finance.manage','refunds.manage')) then
    raise exception 'Department manager permission boundary is incorrect';
  end if;
end;
$$;
