-- Run once in Supabase SQL Editor. Server-only tables: never grant browser access.
create table if not exists public.records(kind text not null,id text not null,body text not null,primary key(kind,id));
create table if not exists public.outbox(id text primary key,event_id text not null,revision integer not null,body text not null,state text not null default 'pending',attempts integer not null default 0);
create table if not exists public.account(id text primary key,email text not null,salt text not null,password_hash text not null);
create table if not exists public.sessions(id text primary key,expires bigint not null);
create table if not exists public.auth_attempts(address text primary key,count integer not null,reset_at bigint not null);
create table if not exists public.email_deliveries(id text primary key,first_attempt bigint not null,sent_at bigint,attempts integer not null default 0,last_error text);
alter table public.records enable row level security;
alter table public.outbox enable row level security;
alter table public.account enable row level security;
alter table public.sessions enable row level security;
alter table public.auth_attempts enable row level security;
alter table public.email_deliveries enable row level security;
revoke all on public.records,public.outbox,public.account,public.sessions,public.auth_attempts,public.email_deliveries from anon,authenticated;
