-- Run this once in Supabase: SQL Editor -> New query -> paste -> Run.

-- ---------------------------------------------------------------- profiles
create table if not exists public.profiles (
  id   uuid primary key references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40)
);
alter table public.profiles enable row level security;

create policy "profiles: read"       on public.profiles for select to authenticated using (true);
create policy "profiles: insert own" on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "profiles: update own" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- ------------------------------------------------------------------- notes
create table if not exists public.notes (
  id         uuid primary key default gen_random_uuid(),
  title      text not null default '',
  kind       text not null default 'text' check (kind in ('text', 'list')),
  body       text not null default '',
  items      jsonb not null default '[]'::jsonb,
  color      text not null default 'pink'
             check (color in ('pink', 'peach', 'butter', 'mint', 'sky', 'lavender')),
  images     text[] not null default '{}',
  author_id  uuid not null default auth.uid(),
  updated_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.notes enable row level security;

-- Only the two accounts you create can log in, so "any logged-in user" = the two of you.
create policy "notes: read"   on public.notes for select to authenticated using (true);
create policy "notes: insert" on public.notes for insert to authenticated with check (author_id = auth.uid());
create policy "notes: update" on public.notes for update to authenticated using (true) with check (true);
create policy "notes: delete" on public.notes for delete to authenticated using (true);

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists notes_touch on public.notes;
create trigger notes_touch before update on public.notes
  for each row execute function public.touch_updated_at();

-- live sync
alter publication supabase_realtime add table public.notes;

-- ------------------------------------------------------------ photo storage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('note-images', 'note-images', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "note-images: read"   on storage.objects for select to authenticated using (bucket_id = 'note-images');
create policy "note-images: upload" on storage.objects for insert to authenticated with check (bucket_id = 'note-images');
create policy "note-images: delete" on storage.objects for delete to authenticated using (bucket_id = 'note-images');

-- ------------------------------------------------- push subscriptions (optional)
create table if not exists public.push_subscriptions (
  endpoint   text primary key,
  user_id    uuid not null default auth.uid(),
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;

create policy "push: read own"   on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
create policy "push: insert own" on public.push_subscriptions for insert to authenticated with check (user_id = auth.uid());
create policy "push: update own" on public.push_subscriptions for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "push: delete own" on public.push_subscriptions for delete to authenticated using (user_id = auth.uid());
