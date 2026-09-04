-- ============================================================
--  News_92 Studio — схема базы для Supabase
--  Как применить: Supabase → SQL Editor → New query → вставить
--  ВЕСЬ этот файл целиком → Run. Скрипт можно запускать повторно,
--  он не ломает уже созданное.
-- ============================================================

-- ------------------------------------------------------------
-- 1. ПРОФИЛИ
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  username   text,
  avatar_url text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select using (auth.uid() = id);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Удаления профиля через сайт нет: политики DELETE намеренно не существует.


-- ------------------------------------------------------------
-- 2. АВТОСОЗДАНИЕ ПРОФИЛЯ ПРИ РЕГИСТРАЦИИ
--    Пользователь ничего не создаёт руками: профиль появляется сам.
-- ------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username, avatar_url)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'username',      -- регистрация по email
      new.raw_user_meta_data ->> 'full_name',     -- вход через Google
      new.raw_user_meta_data ->> 'name',
      split_part(coalesce(new.email, 'гость@'), '@', 1)
    ),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ------------------------------------------------------------
-- 3. ОТЗЫВЫ
-- ------------------------------------------------------------
create table if not exists public.reviews (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  username   text,
  avatar_url text,
  rating     integer not null check (rating between 1 and 5),
  text       text    not null check (char_length(text) between 3 and 2000),
  service    text,
  created_at timestamptz not null default now(),
  approved   boolean not null default false
);

create index  if not exists reviews_public_idx    on public.reviews (approved, created_at desc);
create unique index if not exists reviews_one_per_user on public.reviews (user_id);  -- один отзыв на аккаунт

alter table public.reviews enable row level security;

-- Гости и все посетители видят только одобренные отзывы.
drop policy if exists reviews_select_approved on public.reviews;
create policy reviews_select_approved on public.reviews
  for select using (approved = true);

-- Автор дополнительно видит свой отзыв, даже пока он на модерации.
drop policy if exists reviews_select_own on public.reviews;
create policy reviews_select_own on public.reviews
  for select using (auth.uid() = user_id);

-- Создать отзыв можно только от своего имени и только неодобренным.
drop policy if exists reviews_insert_own on public.reviews;
create policy reviews_insert_own on public.reviews
  for insert with check (auth.uid() = user_id and approved = false);

-- Свой отзыв можно удалить.
drop policy if exists reviews_delete_own on public.reviews;
create policy reviews_delete_own on public.reviews
  for delete using (auth.uid() = user_id);

-- ВАЖНО: обычной политики UPDATE для reviews нет.
-- Поэтому пользователь не может ни выставить себе approved = true,
-- ни поменять оценку или чужой user_id.

-- --- модерация прямо на сайте ---
-- Право одобрять и удалять отзывы выдано ровно одному аккаунту — владельцу.
-- Именно это, а не проверка в браузере, защищает флаг approved: подделать
-- условие в JS можно, но база откажет всем, кроме этого user_id.
-- ЕСЛИ МЕНЯЕТЕ ВЛАДЕЛЬЦА: подставьте новый UID здесь и в ADMIN_UID в index.html.
drop policy if exists reviews_select_admin on public.reviews;
create policy reviews_select_admin on public.reviews
  for select using (auth.uid() = 'b7ad6c3f-beff-4052-afa3-62cc89190f78');

drop policy if exists reviews_update_admin on public.reviews;
create policy reviews_update_admin on public.reviews
  for update using (auth.uid() = 'b7ad6c3f-beff-4052-afa3-62cc89190f78')
  with check  (auth.uid() = 'b7ad6c3f-beff-4052-afa3-62cc89190f78');

drop policy if exists reviews_delete_admin on public.reviews;
create policy reviews_delete_admin on public.reviews
  for delete using (auth.uid() = 'b7ad6c3f-beff-4052-afa3-62cc89190f78');


-- ------------------------------------------------------------
-- 4. ЗАЯВКИ
-- ------------------------------------------------------------
create table if not exists public.orders (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete set null,
  service     text not null,
  description text,
  price       numeric,
  status      text not null default 'new'
              check (status in ('new','in_progress','completed','cancelled')),
  created_at  timestamptz not null default now()
);

create index if not exists orders_user_idx on public.orders (user_id, created_at desc);

alter table public.orders enable row level security;

-- Пользователь видит ТОЛЬКО свои заявки.
drop policy if exists orders_select_own on public.orders;
create policy orders_select_own on public.orders
  for select using (auth.uid() = user_id);

-- Создать заявку можно только от своего имени и только со статусом 'new'.
drop policy if exists orders_insert_own on public.orders;
create policy orders_insert_own on public.orders
  for insert with check (auth.uid() = user_id and status = 'new');

-- Политик UPDATE и DELETE нет: клиент не может изменить статус или цену
-- после создания и не может удалить заявку. Статусы меняете вы в Table editor.


-- ------------------------------------------------------------
-- 5. ХРАНИЛИЩЕ АВАТАРОВ
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- Аватары читают все (они показываются в отзывах).
drop policy if exists avatars_read on storage.objects;
create policy avatars_read on storage.objects
  for select using (bucket_id = 'avatars');

-- Загружать/менять/удалять можно только внутри своей папки <user_id>/...
drop policy if exists avatars_insert_own on storage.objects;
create policy avatars_insert_own on storage.objects
  for insert with check (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists avatars_update_own on storage.objects;
create policy avatars_update_own on storage.objects
  for update using (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists avatars_delete_own on storage.objects;
create policy avatars_delete_own on storage.objects
  for delete using (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );


-- ------------------------------------------------------------
-- ГОТОВО.
-- Проверить, что защита включена:
--   select tablename, rowsecurity from pg_tables
--   where schemaname = 'public' and tablename in ('profiles','reviews','orders');
-- В колонке rowsecurity у всех трёх должно быть true.
-- ------------------------------------------------------------
