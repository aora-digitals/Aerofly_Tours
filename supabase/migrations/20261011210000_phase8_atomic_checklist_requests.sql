-- Add checklist entries and request missing information atomically. Requests move
-- active cases to action_required and emit a customer-visible timeline event.
begin;
create or replace function public.phase8_staff_add_checklist_item(
  p_application_id integer,
  p_label text,
  p_item_key text default null,
  p_required boolean default true,
  p_notes text default null,
  p_request_customer boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_app public.travel_applications;
  v_item public.application_checklist_items;
  v_old_status text;
  v_new_status public.travel_application_status;
  v_legacy_actor integer;
begin
  if v_actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if length(trim(coalesce(p_label,''))) not between 2 and 255 then raise exception 'Checklist label must be 2-255 characters' using errcode = '22023'; end if;
  if not public.has_any_role(array['owner','admin','manager','customer_care','counsellor','staff'],v_actor)
    or not public.phase8_staff_can_access_application(p_application_id,v_actor) then
    raise exception 'Not authorized for this application' using errcode = '42501';
  end if;
  select * into v_app from public.travel_applications where id=p_application_id for update;
  if not found then raise exception 'Application not found' using errcode = 'P0002'; end if;
  v_old_status := v_app.status::text;
  if v_app.status in ('approved','rejected','completed','cancelled') then
    raise exception 'Cannot change checklist on a terminal or approved case' using errcode = '22023';
  end if;
  select id into v_legacy_actor from public.users where "openId"='supabase:' || v_actor::text limit 1;
  insert into public.application_checklist_items("applicationId","itemKey",label,required,status,notes,requested_from_customer,sort_order)
  values (p_application_id,coalesce(nullif(left(trim(coalesce(p_item_key,'')),120),''),gen_random_uuid()::text),trim(p_label),coalesce(p_required,true),'pending',nullif(left(trim(coalesce(p_notes,'')),2000),''),coalesce(p_request_customer,false),
    coalesce((select max(sort_order)+1 from public.application_checklist_items where "applicationId"=p_application_id),0))
  returning * into v_item;
  v_new_status := v_app.status;
  if p_request_customer and v_app.status in ('submitted','under_review') then
    v_new_status := 'action_required';
    update public.travel_applications set status=v_new_status where id=p_application_id;
  end if;
  insert into public.application_events("applicationId","actorId","fromStatus","toStatus",note,customer_visible,metadata)
  values (p_application_id,v_legacy_actor,v_old_status,v_new_status::text,
    case when p_request_customer then 'Additional information requested: ' || trim(p_label) else 'A document checklist item was added: ' || trim(p_label) end,
    true,jsonb_build_object('checklist_item_id',v_item.id,'requested_from_customer',coalesce(p_request_customer,false),'actor_auth_id',v_actor));
  return jsonb_build_object('id',v_item.id,'applicationId',v_item."applicationId",'itemKey',v_item."itemKey",'label',v_item.label,
    'required',v_item.required,'status',v_item.status,'notes',v_item.notes,'requested_from_customer',v_item.requested_from_customer,
    'application_status',v_new_status::text);
end;
$$;
revoke all on function public.phase8_staff_add_checklist_item(integer,text,text,boolean,text,boolean) from public;
grant execute on function public.phase8_staff_add_checklist_item(integer,text,text,boolean,text,boolean) to authenticated;
commit;
