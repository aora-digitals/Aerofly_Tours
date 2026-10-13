-- Atomic case assignment with organization scoping and audit history.
begin;
create or replace function public.phase8_staff_assign_application(
  p_application_id integer,
  p_assigned_to uuid,
  p_organization_id uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_app public.travel_applications;
  v_old_org uuid;
  v_legacy_assignee integer;
  v_global_admin boolean;
  v_manager boolean;
begin
  if v_actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  v_global_admin := public.has_any_role(array['owner','admin'],v_actor);
  v_manager := public.has_any_role(array['manager'],v_actor);
  if not (v_global_admin or v_manager or public.has_any_role(array['customer_care','counsellor','staff'],v_actor)) then
    raise exception 'Travel support staff role required' using errcode = '42501';
  end if;
  select * into v_app from public.travel_applications where id=p_application_id for update;
  if not found then raise exception 'Application not found' using errcode = 'P0002'; end if;
  if not public.phase8_staff_can_access_application(p_application_id,v_actor) then
    raise exception 'Application outside your assignment or organization scope' using errcode = '42501';
  end if;
  if not (v_global_admin or v_manager or v_app.assigned_auth_id=v_actor) then
    raise exception 'Only a manager or currently assigned staff member can reassign a case' using errcode = '42501';
  end if;
  if not public.has_any_role(array['owner','admin','manager','customer_care','counsellor','staff'],p_assigned_to) then
    raise exception 'Assignee must have an authorized staff role' using errcode = '22023';
  end if;
  if not exists (select 1 from public.organization_memberships om where om.user_id=p_assigned_to and om.organization_id=p_organization_id and om.status='active') then
    raise exception 'Assignee must be an active member of the target organization' using errcode = '22023';
  end if;
  if not v_global_admin and not public.is_organization_member(p_organization_id,v_actor) then
    raise exception 'You may only assign cases within your own organization' using errcode = '42501';
  end if;
  select id into v_legacy_assignee from public.users where "openId"='supabase:' || p_assigned_to::text limit 1;
  v_old_org := v_app.organization_id;
  update public.travel_applications set assigned_auth_id=p_assigned_to, organization_id=p_organization_id,
    "assignedTo"=v_legacy_assignee where id=p_application_id returning * into v_app;
  insert into public.application_events("applicationId","actorId","fromStatus","toStatus",note,customer_visible,metadata)
  values (p_application_id,(select u.id from public.users u where u."openId"='supabase:' || v_actor::text limit 1),
    v_app.status::text,v_app.status::text,'Case assigned to a travel team member',false,
    jsonb_build_object('assigned_to',p_assigned_to,'previous_organization_id',v_old_org,'organization_id',p_organization_id,'actor_auth_id',v_actor));
  return jsonb_build_object('id',v_app.id,'reference',v_app.reference,'status',v_app.status,
    'assigned_auth_id',v_app.assigned_auth_id,'organization_id',v_app.organization_id);
end;
$$;
revoke all on function public.phase8_staff_assign_application(integer,uuid,uuid) from public;
grant execute on function public.phase8_staff_assign_application(integer,uuid,uuid) to authenticated;
commit;
