-- Run as the database administrator in ONE call. No schema changes or real user IDs.
-- Tests SQL roles/claims and deployed RLS, not HTTP/JWT verification or browser login.
begin;
set local statement_timeout = '30s';
set local lock_timeout = '3s';
do $test$
declare
  owner_a uuid := gen_random_uuid();
  owner_b uuid := gen_random_uuid();
  admin_id uuid := gen_random_uuid();
  new_user uuid := gen_random_uuid();
  event_id uuid := gen_random_uuid();
  n integer;
begin
  insert into public.profiles(user_id, display_name, role) values
    (owner_a, 'security-smoke', 'user'), (owner_b, 'security-smoke', 'user'),
    (admin_id, 'security-smoke', 'admin');
  insert into public.decks(user_id, name, game, is_public)
    select actor, 'security-smoke-private', game, false
    from unnest(array[owner_a, owner_b]) actor cross join unnest(array['bs', 'acg']) game;
  insert into public.decks(user_id, name, game, is_public)
    select owner_b, 'security-smoke-public', game, true from unnest(array['bs', 'acg']) game;
  insert into public.events(id, name, created_by) values (event_id, 'security-smoke', admin_id);

  set local role anon;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{}', true);
  select count(*) into n from public.decks where user_id in (owner_a, owner_b);
  if n <> 0 then raise exception 'anon can read fixture decks'; end if;
  begin
    insert into public.decks(user_id, name, game) values (owner_a, 'security-smoke-anon', 'acg');
    raise exception 'anon insert unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', owner_a::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', owner_a, 'role', 'authenticated')::text, true);
  if public.is_admin() then raise exception 'ordinary user is admin'; end if;
  select count(*) into n from public.decks where user_id = owner_b and not is_public;
  if n <> 0 then raise exception 'other private decks visible'; end if;
  select count(*) into n from public.decks where user_id = owner_b and is_public;
  if n <> 2 then raise exception 'public deck positive control failed'; end if;
  update public.decks set name = 'security-smoke-updated' where user_id = owner_a;
  get diagnostics n = row_count;
  if n <> 2 then raise exception 'own update positive control failed'; end if;
  update public.decks set name = 'security-smoke-denied' where user_id = owner_b;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'other deck update allowed'; end if;
  delete from public.decks where user_id = owner_b;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'other deck delete allowed'; end if;
  begin
    update public.decks set user_id = owner_b where user_id = owner_a;
    raise exception 'ownership transfer unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.profiles set role = 'admin' where user_id = owner_a;
    raise exception 'role escalation unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.events(name, created_by) values ('security-smoke-denied', owner_a);
    raise exception 'nonadmin event insert unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;
  update public.events set name = 'security-smoke-denied' where id = event_id;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'nonadmin event update allowed'; end if;
  delete from public.events where id = event_id;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'nonadmin event delete allowed'; end if;

  perform set_config('request.jwt.claim.sub', new_user::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', new_user, 'role', 'authenticated')::text, true);
  begin
    insert into public.profiles(user_id, role) values (new_user, 'admin');
    raise exception 'admin profile insert unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;
  insert into public.profiles(user_id, display_name, role) values (new_user, 'security-smoke', 'user');
  insert into public.decks(user_id, name, game) values (new_user, 'security-smoke-own', 'acg');
  delete from public.decks where user_id = new_user;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'own insert/delete positive control failed'; end if;

  perform set_config('request.jwt.claim.sub', admin_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  if not public.is_admin() then raise exception 'admin positive control failed'; end if;
  insert into public.events(name, created_by) values ('security-smoke-admin', admin_id);
  update public.events set name = 'security-smoke-admin-updated' where id = event_id;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'admin update positive control failed'; end if;
  delete from public.events where id = event_id;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'admin delete positive control failed'; end if;
end;
$test$;
rollback;
select 'PASS: RLS ownership, public-read, admin writes and role-escalation checks; all fixtures rolled back' as result;
