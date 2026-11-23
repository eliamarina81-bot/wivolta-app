-- Wivolta: reforço de integridade e permissões do portal de clientes
-- Aplicar depois de 001_wivolta_clientes_contratos.sql.
-- Não contém chaves, tokens ou dados pessoais.

-- Impede que um alerta associe um contrato de um cliente a outro cliente.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'contratos_id_cliente_unique'
      and conrelid = 'public.contratos'::regclass
  ) then
    alter table public.contratos
      add constraint contratos_id_cliente_unique unique (id, cliente_id);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'alertas_contrato_cliente_fk'
      and conrelid = 'public.alertas_aprovacoes'::regclass
  ) then
    alter table public.alertas_aprovacoes
      add constraint alertas_contrato_cliente_fk
      foreign key (contrato_id, cliente_id)
      references public.contratos (id, cliente_id)
      on delete cascade;
  end if;
end $$;

-- Atualiza automaticamente a data de alteração dos registos editáveis.
create or replace function public.wivolta_set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists wivolta_clientes_updated_at on public.clientes;
create trigger wivolta_clientes_updated_at
before update on public.clientes
for each row execute function public.wivolta_set_updated_at();

drop trigger if exists wivolta_contratos_updated_at on public.contratos;
create trigger wivolta_contratos_updated_at
before update on public.contratos
for each row execute function public.wivolta_set_updated_at();

-- Recria a função de aprovação com validação explícita de NULL e privilégios mínimos.
create or replace function public.wivolta_aprovar_alerta(p_alerta_id uuid, p_decisao text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_count integer;
begin
  if p_decisao is null or p_decisao not in ('aprovado', 'recusado') then
    raise exception 'Decisão inválida';
  end if;

  update public.alertas_aprovacoes a
     set estado = p_decisao,
         decisao_em = now()
    from public.clientes c
   where a.id = p_alerta_id
     and a.cliente_id = c.id
     and c.user_id = auth.uid()
     and a.estado = 'pendente';

  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

revoke all on function public.wivolta_aprovar_alerta(uuid, text) from public, anon;
grant execute on function public.wivolta_aprovar_alerta(uuid, text) to authenticated;

-- A função de staff só pode ser consultada por utilizadores autenticados.
revoke all on function public.wivolta_is_staff() from public, anon;
grant execute on function public.wivolta_is_staff() to authenticated;

-- A tabela de staff continua sem políticas de leitura/escrita para clientes.
-- A proprietária deve ser adicionada manualmente no SQL Editor após criar a conta Auth:
-- insert into public.wivolta_staff (user_id)
-- select id from auth.users where email = 'EMAIL_DA_CONTA_ADMIN';
