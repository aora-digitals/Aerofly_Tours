-- Phase 8 follow-up: permit in-organization ticket assignment for support staff,
-- while requiring manager privileges for organization changes.
begin;
create or replace function public.phase8_update_support_ticket(
  p_ticket_id bigint,
  p_status text default null,
  p_priority text default null,
  p_assigned_to uuid default null,
  p_organization_id uuid default null
) returns public.support_tickets
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_ticket public.support_tickets;
  v_old text;
  v_target_org uuid;
begin
  if v_actor is null or not public.has_any_role(array['owner','admin','manager','customer_care','counsellor','staff'], v_actor) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select * into v_ticket from public.support_tickets where id = p_ticket_id for update;
  if not found then raise exception 'Ticket not found' using errcode = 'P0002'; end if;
  if not (public.has_any_role(array['owner','admin'], v_actor)
      or v_ticket.assigned_to = v_actor
      or (v_ticket.organization_id is not null and public.is_organization_member(v_ticket.organization_id, v_actor))
      or (v_ticket.organization_id is null and public.has_any_role(array['owner','admin','manager'], v_actor)
          and exists (select 1 from public.organization_memberships om where om.user_id=v_actor and om.status='active'))) then
    raise exception 'Ticket outside your organization or assignment scope' using errcode = '42501';
  end if;
  if p_status is not null and p_status not in ('open','in_progress','waiting_customer','escalated','resolved','closed') then
    raise exception 'Invalid ticket status' using errcode = '22023';
  end if;
  if p_priority is not null and p_priority not in ('low','normal','high','urgent') then
    raise exception 'Invalid ticket priority' using errcode = '22023';
  end if;
  v_target_org := coalesce(p_organization_id, v_ticket.organization_id);
  if p_organization_id is not null and p_organization_id is distinct from v_ticket.organization_id then
    if not public.has_any_role(array['owner','admin','manager'], v_actor) then
      raise exception 'Only managers can move a ticket between organizations' using errcode = '42501';
    end if;
    if not public.has_any_role(array['owner','admin'], v_actor)
       and not public.is_organization_member(p_organization_id, v_actor) then
      raise exception 'Managers may only move tickets into their own organization' using errcode = '42501';
    end if;
  end if;
  if p_assigned_to is not null then
    if not public.has_any_role(array['owner','admin','manager','customer_care','counsellor','staff'], p_assigned_to) then
      raise exception 'Assignee must have an active support staff role' using errcode = '22023';
    end if;
    if v_target_org is null or not public.is_organization_member(v_target_org, p_assigned_to) then
      raise exception 'Assignee must be an active member of the ticket organization' using errcode = '22023';
    end if;
    if not public.has_any_role(array['owner','admin','manager'], v_actor)
       and v_ticket.organization_id is distinct from v_target_org then
      raise exception 'Only managers can change ticket organization' using errcode = '42501';
    end if;
  end if;
  v_old := v_ticket.status;
  update public.support_tickets set
    status = coalesce(p_status, status),
    priority = coalesce(p_priority, priority),
    assigned_to = coalesce(p_assigned_to, assigned_to),
    organization_id = coalesce(p_organization_id, organization_id),
    resolved_at = case when p_status = 'resolved' then now() when p_status in ('open','in_progress') then null else resolved_at end
  where id = p_ticket_id returning * into v_ticket;
  insert into public.support_ticket_events(ticket_id, actor_id, action, from_status, to_status, metadata)
  values (p_ticket_id, v_actor, 'ticket_updated', v_old, v_ticket.status,
    jsonb_build_object('priority', v_ticket.priority, 'assigned_to', v_ticket.assigned_to,
      'organization_id', v_ticket.organization_id));
  return v_ticket;
end;
$$;
revoke all on function public.phase8_update_support_ticket(bigint, text, text, uuid, uuid) from public;
grant execute on function public.phase8_update_support_ticket(bigint, text, text, uuid, uuid) to authenticated;
commit;
