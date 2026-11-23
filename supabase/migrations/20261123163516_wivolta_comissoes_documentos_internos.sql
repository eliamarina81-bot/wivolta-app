-- Wivolta: tabelas internas de remuneração e documentos comerciais
-- Informação confidencial; nunca expor no comparador público nem em endpoints anónimos.
create table if not exists public.comissoes_internas (
  id uuid primary key default gen_random_uuid(),
  comercializador text not null,
  segmento text not null check (segmento in ('residencial','empresas','condominios','geral')),
  energia text not null check (energia in ('eletricidade','gas','dual','margem','ponto','geral')),
  modalidade text not null,
  valor numeric(14,4),
  moeda text not null default 'EUR',
  unidade text,
  condicoes jsonb not null default '{}'::jsonb,
  regras_estorno jsonb not null default '{}'::jsonb,
  notas text,
  origem_interna text,
  estado text not null default 'referencia_documental'
    check (estado in ('referencia_documental','confirmada','suspensa','expirada')),
  updated_at timestamptz not null default now()
);
create table if not exists public.documentos_adesao (
  id uuid primary key default gen_random_uuid(),
  comercializador text not null,
  segmento text not null check (segmento in ('residencial','empresas','condominios','geral')),
  energia text not null check (energia in ('eletricidade','gas','dual','solar','geral')),
  categoria text not null,
  nome_ficheiro_origem text not null,
  validade_ate date,
  estado text not null default 'disponivel'
    check (estado in ('disponivel','requer_validacao','expirado','apenas_referencia')),
  requisitos jsonb not null default '{}'::jsonb,
  notas text,
  updated_at timestamptz not null default now()
);
alter table public.comissoes_internas enable row level security;
alter table public.documentos_adesao enable row level security;
drop policy if exists "staff consulta comissoes internas" on public.comissoes_internas;
create policy "staff consulta comissoes internas" on public.comissoes_internas for select to authenticated using ((select public.wivolta_is_staff()));
drop policy if exists "staff gere comissoes internas" on public.comissoes_internas;
create policy "staff gere comissoes internas" on public.comissoes_internas for all to authenticated using ((select public.wivolta_is_staff())) with check ((select public.wivolta_is_staff()));
drop policy if exists "staff consulta documentos de adesao" on public.documentos_adesao;
create policy "staff consulta documentos de adesao" on public.documentos_adesao for select to authenticated using ((select public.wivolta_is_staff()));
drop policy if exists "staff gere documentos de adesao" on public.documentos_adesao;
create policy "staff gere documentos de adesao" on public.documentos_adesao for all to authenticated using ((select public.wivolta_is_staff())) with check ((select public.wivolta_is_staff()));
revoke all on public.comissoes_internas, public.documentos_adesao from anon;
grant select, insert, update, delete on public.comissoes_internas, public.documentos_adesao to authenticated;
create index if not exists comissoes_internas_comercializador_idx on public.comissoes_internas(comercializador, segmento);
create index if not exists documentos_adesao_comercializador_idx on public.documentos_adesao(comercializador, segmento);
