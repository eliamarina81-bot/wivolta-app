alter table public.contratos
  add column if not exists ciclo_horario text,
  add column if not exists consumo_anual_simples_kwh numeric,
  add column if not exists consumo_anual_fora_vazio_kwh numeric,
  add column if not exists consumo_anual_vazio_kwh numeric,
  add column if not exists consumo_anual_cheias_kwh numeric,
  add column if not exists consumo_anual_ponta_kwh numeric,
  add column if not exists consumo_anual_gas_kwh numeric,
  add column if not exists data_ultima_fatura date,
  add column if not exists leitura_fatura_validada boolean not null default false,
  add column if not exists origem_dados text,
  add column if not exists revisao_ultima_em timestamptz;

alter table public.contratos
  add constraint contratos_ciclo_horario_check
  check (ciclo_horario is null or ciclo_horario in ('simples','bi-horario','tri-horario'));

alter table public.contratos
  add constraint contratos_consumos_nao_negativos_check
  check (
    coalesce(consumo_anual_simples_kwh,0) >= 0 and
    coalesce(consumo_anual_fora_vazio_kwh,0) >= 0 and
    coalesce(consumo_anual_vazio_kwh,0) >= 0 and
    coalesce(consumo_anual_cheias_kwh,0) >= 0 and
    coalesce(consumo_anual_ponta_kwh,0) >= 0 and
    coalesce(consumo_anual_gas_kwh,0) >= 0
  );

comment on column public.contratos.ciclo_horario is 'Ciclo horário confirmado a partir da fatura: simples, bi-horario ou tri-horario.';
comment on column public.contratos.leitura_fatura_validada is 'Só true depois de confirmação humana dos campos extraídos da fatura.';
comment on column public.contratos.origem_dados is 'Origem dos dados: fatura_confirmada, introducao_manual ou importacao.';
