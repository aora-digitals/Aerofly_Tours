
begin;

create table if not exists public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New travel conversation',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint ai_conversations_title_length
    check (char_length(title) between 1 and 120)
);

create index if not exists ai_conversations_owner_updated_idx
  on public.ai_conversations(user_id, updated_at desc)
  where deleted_at is null;

create table if not exists public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null
    references public.ai_conversations(id) on delete cascade,
  role text not null
    check (role in ('user', 'assistant')),
  content text not null
    check (char_length(content) between 1 and 6000),
  created_at timestamptz not null default now()
);

create index if not exists ai_messages_conversation_created_idx
  on public.ai_messages(conversation_id, created_at);

alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;

drop policy if exists ai_conversations_select_own
  on public.ai_conversations;
create policy ai_conversations_select_own
  on public.ai_conversations
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists ai_conversations_insert_own
  on public.ai_conversations;
create policy ai_conversations_insert_own
  on public.ai_conversations
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists ai_conversations_update_own
  on public.ai_conversations;
create policy ai_conversations_update_own
  on public.ai_conversations
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists ai_messages_select_own
  on public.ai_messages;
create policy ai_messages_select_own
  on public.ai_messages
  for select to authenticated
  using (
    exists (
      select 1
      from public.ai_conversations c
      where c.id = ai_messages.conversation_id
        and c.user_id = (select auth.uid())
    )
  );

-- Clients may not write assistant messages directly.
-- The Edge Function uses the server-only service role.
drop policy if exists ai_messages_insert_user_own
  on public.ai_messages;
create policy ai_messages_insert_user_own
  on public.ai_messages
  for insert to authenticated
  with check (
    role = 'user'
    and exists (
      select 1
      from public.ai_conversations c
      where c.id = ai_messages.conversation_id
        and c.user_id = (select auth.uid())
    )
  );

-- A conversation owner can delete their own conversation.
-- Cascading deletion removes its messages.
drop policy if exists ai_conversations_delete_own
  on public.ai_conversations;
create policy ai_conversations_delete_own
  on public.ai_conversations
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- Atomic request counters. Never grant direct client access.
create table if not exists public.ai_rate_limits (
  subject_hash text primary key,
  window_started_at timestamptz not null,
  request_count integer not null default 0,
  constraint ai_rate_limits_count_positive
    check (request_count >= 0)
);

alter table public.ai_rate_limits enable row level security;

create or replace function public.phase10_ai_consume_rate_limit(
  p_subject_hash text,
  p_window_seconds integer default 60,
  p_max_requests integer default 12
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_allowed boolean;
begin
  if p_subject_hash is null
     or length(p_subject_hash) < 32
     or length(p_subject_hash) > 128
     or p_window_seconds < 1
     or p_window_seconds > 3600
     or p_max_requests < 1
     or p_max_requests > 100 then
    raise exception 'Invalid rate-limit arguments';
  end if;

  insert into public.ai_rate_limits (
    subject_hash, window_started_at, request_count
  )
  values (p_subject_hash, v_now, 1)
  on conflict (subject_hash) do update
  set
    window_started_at = case
      when public.ai_rate_limits.window_started_at
        <= v_now - pg_catalog.make_interval(secs => p_window_seconds)
      then v_now
      else public.ai_rate_limits.window_started_at
    end,
    request_count = case
      when public.ai_rate_limits.window_started_at
        <= v_now - pg_catalog.make_interval(secs => p_window_seconds)
      then 1
      else public.ai_rate_limits.request_count + 1
    end;

  select request_count <= p_max_requests
  into v_allowed
  from public.ai_rate_limits
  where subject_hash = p_subject_hash;

  return coalesce(v_allowed, false);
end;
$$;

revoke all on function public.phase10_ai_consume_rate_limit(text, integer, integer)
  from public, anon, authenticated;

grant execute on function public.phase10_ai_consume_rate_limit(text, integer, integer)
  to service_role;

-- Prevent direct access to rate-limit data.
revoke all on public.ai_rate_limits from public, anon, authenticated;

commit;
