-- Atomic, authorized ticket replies; client writes must use the RPC/Edge Function.
begin;
create or replace function public.phase8_add_support_ticket_message(
  p_ticket_id bigint,
  p_body text,
  p_internal boolean default false
) returns public.support_ticket_messages
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_ticket public.support_tickets;
  v_message public.support_ticket_messages;
  v_is_staff boolean := false;
  v_old_status text;
begin
  if v_actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if length(trim(coalesce(p_body,''))) not between 1 and 10000 then raise exception 'Message must be 1-10000 characters' using errcode = '22023'; end if;
  select * into v_ticket from public.support_tickets where id = p_ticket_id for update;
  if not found then raise exception 'Ticket not found' using errcode = 'P0002'; end if;
  v_old_status := v_ticket.status;
  if v_ticket.customer_auth_id = v_actor then
    if p_internal then raise exception 'Customers cannot create internal notes' using errcode = '42501'; end if;
    if v_ticket.status in ('resolved','closed') then raise exception 'Resolved tickets must be reopened by support before replying' using errcode = '22023'; end if;
  else
    if not public.has_any_role(array['owner','admin','manager','customer_care','counsellor','staff'], v_actor) then
      raise exception 'Support staff role required' using errcode = '42501';
    end if;
    if not (public.has_any_role(array['owner','admin'], v_actor)
      or v_ticket.assigned_to = v_actor
      or (v_ticket.organization_id is not null and public.is_organization_member(v_ticket.organization_id, v_actor))) then
      raise exception 'Ticket outside your assignment or organization scope' using errcode = '42501';
    end if;
    v_is_staff := true;
  end if;
  insert into public.support_ticket_messages(ticket_id, author_id, body, is_internal)
  values (p_ticket_id, v_actor, trim(p_body), coalesce(p_internal,false)) returning * into v_message;
  if v_is_staff and not p_internal and v_ticket.status not in ('resolved','closed') then
    update public.support_tickets set status='waiting_customer' where id=p_ticket_id;
  elsif not v_is_staff and v_ticket.status='waiting_customer' then
    update public.support_tickets set status='in_progress' where id=p_ticket_id;
  end if;
  if (select status from public.support_tickets where id=p_ticket_id) <> v_old_status then
    insert into public.support_ticket_events(ticket_id, actor_id, action, from_status, to_status, metadata)
    values (p_ticket_id, v_actor, 'message_status_transition', v_old_status,
      (select status from public.support_tickets where id=p_ticket_id),
      jsonb_build_object('message_id',v_message.id));
  end if;
  return v_message;
end;
$$;
revoke all on function public.phase8_add_support_ticket_message(bigint,text,boolean) from public;
grant execute on function public.phase8_add_support_ticket_message(bigint,text,boolean) to authenticated;

-- Force direct client writes through guarded transactional operations.
revoke insert, update, delete on public.support_tickets from anon, authenticated;
revoke insert, update, delete on public.support_ticket_messages from anon, authenticated;
revoke insert, update, delete on public.support_ticket_events from anon, authenticated;
commit;
