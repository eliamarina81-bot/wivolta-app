-- Wivolta AutoSwitch: comparação trimestral real de ofertas de eletricidade.
-- A rotina gera propostas para revisão humana; nunca muda o comercializador sozinha.
alter table public.wivolta_pedidos_autoswitch
  add column if not exists segmento_cliente text not null default 'residencial'
    check (segmento_cliente in ('residencial','empresarial')),
  add column if not exists preco_fora_vazio_atual numeric(12,6),
  add column if not exists preco_vazio_atual numeric(12,6),
  add column if not exists preco_cheias_atual numeric(12,6),
  add column if not exists preco_ponta_atual numeric(12,6),
  add column if not exists preco_gas_kwh numeric(12,6),
  add column if not exists termo_fixo_gas_dia numeric(12,6),
  add column if not exists poupanca_minima_anual numeric(10,2) not null default 30.00;

create or replace function public.wivolta_processar_revisoes_autoswitch()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  r record;
  v_cycle text;
  v_current_cost numeric(14,2);
  v_candidate_cost numeric(14,2);
  v_saving numeric(14,2);
  v_state text;
  v_reason text;
  v_offer_supplier text;
  v_offer_plan text;
  v_offer_valid_until date;
  v_offer_discount numeric(8,3);
  v_processed integer := 0;
  v_proposals integer := 0;
  v_incomplete integer := 0;
  v_min_saving numeric(10,2);
begin
  for r in
    select *
    from public.wivolta_pedidos_autoswitch
    where estado_acompanhamento = 'ativo'
      and consentimento_acompanhamento = true
      and consentimento_rgpd = true
      and proxima_revisao_em <= now()
    order by proxima_revisao_em
    for update skip locked
  loop
    if exists (
      select 1 from public.wivolta_autoswitch_revisoes x
      where x.pedido_id = r.id
        and x.created_at >= date_trunc('day', now())
        and x.tipo = 'revisao_trimestral'
    ) then
      update public.wivolta_pedidos_autoswitch
      set proxima_revisao_em = now() + interval '90 days'
      where id = r.id;
      continue;
    end if;

    v_cycle := coalesce(
      r.ciclo_horario,
      case
        when coalesce(r.consumo_ponta_kwh,0) > 0 or coalesce(r.consumo_cheias_kwh,0) > 0 then 'tri-horario'
        when coalesce(r.consumo_fora_vazio_kwh,0) > 0 or coalesce(r.consumo_vazio_kwh,0) > 0 then 'bi-horario'
        when coalesce(r.consumo_simples_kwh,0) > 0 then 'simples'
        else null
      end
    );
    v_current_cost := null;
    v_candidate_cost := null;
    v_saving := null;
    v_state := null;
    v_reason := null;
    v_offer_supplier := null;
    v_offer_plan := null;
    v_offer_valid_until := null;
    v_offer_discount := null;
    v_min_saving := coalesce(r.poupanca_minima_anual,30.00);

    if r.energia <> 'eletricidade' then
      v_state := 'sem_ofertas_validas';
      v_reason := 'O catálogo atual ainda não contém ofertas de gás/dual validadas para comparação automática.';
    elsif r.potencia_kva is null or r.potencia_kva <= 0 or r.termo_fixo_dia is null then
      v_state := 'dados_incompletos';
      v_reason := 'Falta confirmar a potência contratada e o termo diário atual.';
    elsif v_cycle = 'simples' then
      if coalesce(r.consumo_simples_kwh,0) <= 0 or r.preco_kwh is null or r.preco_kwh <= 0 then
        v_state := 'dados_incompletos';
        v_reason := 'Para tarifa simples, falta confirmar consumo anual e preço atual por kWh sem IVA.';
      else
        v_current_cost := (r.consumo_simples_kwh * r.preco_kwh) + (r.termo_fixo_dia * 365);
      end if;
    elsif v_cycle = 'bi-horario' then
      if coalesce(r.consumo_fora_vazio_kwh,0) + coalesce(r.consumo_vazio_kwh,0) <= 0
        or r.preco_fora_vazio_atual is null or r.preco_vazio_atual is null then
        v_state := 'dados_incompletos';
        v_reason := 'Para tarifa bi-horária, faltam consumos anuais e os dois preços atuais (fora de vazio e vazio), sem IVA.';
      else
        v_current_cost :=
          (coalesce(r.consumo_fora_vazio_kwh,0) * r.preco_fora_vazio_atual)
          + (coalesce(r.consumo_vazio_kwh,0) * r.preco_vazio_atual)
          + (r.termo_fixo_dia * 365);
      end if;
    elsif v_cycle = 'tri-horario' then
      v_state := 'sem_ofertas_validas';
      v_reason := 'O catálogo ainda não contém ofertas tri-horárias validadas. O pedido fica registado, mas não é apresentada uma poupança inventada.';
    else
      v_state := 'dados_incompletos';
      v_reason := 'É necessário confirmar o ciclo horário da eletricidade.';
    end if;

    if v_state is null then
      select
        o.comercializador,
        o.plano,
        o.validade_fim,
        o.desconto_percentagem,
        case
          when v_cycle = 'simples'
            then (r.consumo_simples_kwh * o.preco_simples) + (o.termo_fixo_dia * 365)
          when v_cycle = 'bi-horario'
            then (coalesce(r.consumo_fora_vazio_kwh,0) * o.preco_fora_vazio)
              + (coalesce(r.consumo_vazio_kwh,0) * o.preco_vazio)
              + (o.termo_fixo_dia * 365)
        end as custo_anual
      into v_offer_supplier, v_offer_plan, v_offer_valid_until, v_offer_discount, v_candidate_cost
      from public.ofertas_energia o
      where o.estado = 'ativo'
        and o.energia = 'eletricidade'
        and o.segmento = r.segmento_cliente
        and o.ciclo = v_cycle
        and o.iva_incluido = false
        and o.validade_inicio is not null
        and o.validade_inicio <= current_date
        and o.validade_fim is not null
        and o.validade_fim >= current_date
        and (o.potencia_min_kva is null or o.potencia_min_kva <= r.potencia_kva)
        and (o.potencia_max_kva is null or o.potencia_max_kva >= r.potencia_kva)
        and lower(coalesce(o.comercializador,'')) <> lower(coalesce(r.comercializador_atual,''))
        and o.termo_fixo_dia is not null
        and (
          (v_cycle = 'simples' and o.preco_simples is not null)
          or
          (v_cycle = 'bi-horario' and o.preco_fora_vazio is not null and o.preco_vazio is not null)
        )
      order by custo_anual asc
      limit 1;

      if v_offer_supplier is null then
        v_state := 'sem_ofertas_validas';
        v_reason := 'Não foi encontrada uma oferta de eletricidade com validade explícita, ciclo, segmento e potência compatíveis.';
      else
        v_saving := round(v_current_cost - v_candidate_cost, 2);
        if v_saving < v_min_saving then
          v_state := 'sem_poupanca_suficiente';
          v_reason := 'A melhor alternativa não atinge a poupança mínima anual configurada. Não é proposta mudança.';
        elsif r.fim_fidelizacao is not null and r.fim_fidelizacao >= current_date then
          v_state := 'bloqueado_fidelizacao';
          v_reason := 'Foi encontrada uma alternativa, mas a fidelização indicada ainda está em vigor até ' || r.fim_fidelizacao::text || '. Não avançar antes de confirmar eventuais encargos.';
        else
          v_state := 'proposta_disponivel';
          v_reason := 'Foi encontrada uma alternativa com poupança estimada acima do mínimo. Requer validação humana, confirmação das condições e autorização específica antes de qualquer mudança.';
          v_proposals := v_proposals + 1;
        end if;
      end if;
    end if;

    insert into public.wivolta_autoswitch_revisoes
      (pedido_id, proxima_revisao, oferta_comercializador, oferta_plano,
       poupanca_anual_estimada, poupanca_estimada_anual, notas, estado,
       tipo, comercializador_sugerido, plano_sugerido, motivo, dados_snapshot, analisada_em)
    values
      (r.id, (current_date + 90),
       v_offer_supplier, v_offer_plan,
       v_saving, v_saving,
       v_reason, v_state, 'revisao_trimestral',
       v_offer_supplier, v_offer_plan,
       v_reason,
       jsonb_build_object(
         'energia', r.energia,
         'segmento_cliente', r.segmento_cliente,
         'ciclo_horario', v_cycle,
         'comercializador_atual', r.comercializador_atual,
         'potencia_kva', r.potencia_kva,
         'custo_atual_anual_sem_iva', v_current_cost,
         'custo_alternativa_anual_sem_iva', v_candidate_cost,
         'poupanca_anual_estimada_sem_iva', v_saving,
         'poupanca_minima_anual', v_min_saving,
         'validade_oferta_ate', v_offer_valid_until,
         'desconto_anunciado_nao_aplicado', v_offer_discount,
         'fim_fidelizacao', r.fim_fidelizacao,
         'preco_simples_atual', r.preco_kwh,
         'preco_fora_vazio_atual', r.preco_fora_vazio_atual,
         'preco_vazio_atual', r.preco_vazio_atual,
         'termo_fixo_dia_atual', r.termo_fixo_dia
       ),
       now());

    update public.wivolta_pedidos_autoswitch
    set ultima_revisao_em = now(),
        proxima_revisao_em = now() + interval '90 days',
        status = v_state
    where id = r.id;

    v_processed := v_processed + 1;
    if v_state = 'dados_incompletos' then
      v_incomplete := v_incomplete + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'processados', v_processed,
    'propostas_disponiveis', v_proposals,
    'dados_incompletos', v_incomplete,
    'executado_em', now()
  );
end;
$function$;

revoke all on function public.wivolta_processar_revisoes_autoswitch() from public, anon, authenticated;
