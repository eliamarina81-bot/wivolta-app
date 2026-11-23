-- Wivolta: estrutura inicial de clientes, contratos e aprovações
-- Executar no Supabase SQL Editor. RLS ativo; nenhum acesso público anónimo.

create extension if not exists pgcrypto;

create table if not exists public.clientes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  email text,
  nome text,
  telefone text,
  nif text,
  preferencia_contacto text not null default 'email'
    check (preferencia_contacto in ('email','telefone','whatsapp')),
  consentimento_rgpd boolean not null default false,
  consentimento_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.contratos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  tipo_energia text not null check (tipo_energia in ('eletricidade','gas','dual')),
  comercializador text,
  tarifa text,
  potencia_kva numeric(8,3),
  preco_kwh numeric(12,6),
  termo_fixo_dia numeric(12,6),
  data_inicio date,
  fim_desconto date,
  fim_fidelizacao date,
  proxima_revisao timestamptz not null default (now() + interval '90 days'),
  poupanca_minima_anual numeric(10,2) not null default 30.00,
  estado text not null default 'ativo'
    check (estado in ('ativo','em_revisao','aguarda_aprovacao','substituido','terminado')),
  aprovacao_manual_obrigatoria boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.alertas_aprovacoes (
  id uuid primary key default gen_random_uuid(),
  contrato_id uuid not null references public.contratos(id) on delete cascade,
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  tipo text not null check (tipo in ('revisao_90_dias','fim_desconto_15_dias','proposta_alternativa')),
  mensagem text,
  data_envio timestamptz,
  estado text not null default 'pendente'
    check (estado in ('pendente','aprovado','recusado','expirado')),
  decisao_em timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.wivolta_staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.wivolta_is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.wivolta_staff s where s.user_id = auth.uid());
$$;

create or replace function public.wivolta_criar_cliente()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.clientes (user_id, email)
  values (new.id, new.email)
  on conflict (user_id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists wivolta_auth_user_created on auth.users;
create trigger wivolta_auth_user_created
after insert on auth.users
for each row execute procedure public.wivolta_criar_cliente();

create or replace function public.wivolta_aprovar_alerta(p_alerta_id uuid, p_decisao text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_count integer;
begin
  if p_decisao not in ('aprovado','recusado') then
    raise exception 'Decisão inválida';
  end if;
  update public.alertas_aprovacoes a
  set estado = p_decisao, decisao_em = now()
  from public.clientes c
  where a.id = p_alerta_id
    and a.cliente_id = c.id
    and c.user_id = auth.uid()
    and a.estado = 'pendente';
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

alter table public.clientes enable row level security;
alter table public.contratos enable row level security;
alter table public.alertas_aprovacoes enable row level security;
alter table public.wivolta_staff enable row level security;

drop policy if exists "cliente ve o proprio perfil ou staff" on public.clientes;
create policy "cliente ve o proprio perfil ou staff" on public.clientes
for select to authenticated
using (user_id = auth.uid() or public.wivolta_is_staff());

drop policy if exists "cliente atualiza o proprio perfil ou staff" on public.clientes;
create policy "cliente atualiza o proprio perfil ou staff" on public.clientes
for update to authenticated
using (user_id = auth.uid() or public.wivolta_is_staff())
with check (user_id = auth.uid() or public.wivolta_is_staff());

drop policy if exists "cliente ve os proprios contratos ou staff" on public.contratos;
create policy "cliente ve os proprios contratos ou staff" on public.contratos
for select to authenticated
using (
  public.wivolta_is_staff()
  or exists (select 1 from public.clientes c where c.id = cliente_id and c.user_id = auth.uid())
);

drop policy if exists "cliente ve os proprios alertas ou staff" on public.alertas_aprovacoes;
create policy "cliente ve os proprios alertas ou staff" on public.alertas_aprovacoes
for select to authenticated
using (
  public.wivolta_is_staff()
  or exists (select 1 from public.clientes c where c.id = cliente_id and c.user_id = auth.uid())
);

revoke all on public.wivolta_staff from anon, authenticated;
revoke insert, delete on public.clientes, public.contratos, public.alertas_aprovacoes from anon, authenticated;
grant select, update on public.clientes to authenticated;
grant select on public.contratos, public.alertas_aprovacoes to authenticated;
grant execute on function public.wivolta_aprovar_alerta(uuid,text) to authenticated;
revoke all on function public.wivolta_criar_cliente() from public, anon, authenticated;
revoke all on function public.wivolta_is_staff() from public, anon;
grant execute on function public.wivolta_is_staff() to authenticated;

create index if not exists contratos_cliente_id_idx on public.contratos(cliente_id);
create index if not exists contratos_proxima_revisao_idx on public.contratos(proxima_revisao);
create index if not exists contratos_fim_desconto_idx on public.contratos(fim_desconto);
create index if not exists alertas_cliente_estado_idx on public.alertas_aprovacoes(cliente_id, estado);

-- Nota: o utilizador administrador Wivolta deve ser adicionado manualmente
-- a wivolta_staff pelo SQL Editor, usando o UUID da conta Auth da proprietária.
