import { calculateAnnualOfferCost, validateProfile } from "/comparison-engine.mjs";

(() => {
  const $ = id => document.getElementById(id);
  const output = $("of-resultados");
  const status = $("of-catalog-status");
  const cycle = $("of-ciclo");
  const mode = $("of-modalidade");
  if (!output || !window.supabase) {
    if (status) status.textContent = "Não foi possível iniciar o comparador. Atualiza a página e tenta novamente.";
    return;
  }

  const supabase = window.supabase.createClient(
    "https://awhfvgzajfkxwtridqft.supabase.co",
    "sb_publishable_lgP_OLkaHrXtc1NKJmMUww_KMH0UETf"
  );
  let currentOffers = [];
  let currentProfile = null;
  const appliedDiscounts = new Set();

  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  })[char]);
  const money = value => new Intl.NumberFormat("pt-PT", {style:"currency",currency:"EUR"}).format(value);
  const dateLabel = value => value ? new Date(value + "T12:00:00").toLocaleDateString("pt-PT") : "validade final não indicada";
  const updateCycleFields = () => {
    const bi = cycle.value === "bi-horario";
    const tri = cycle.value === "tri-horario";
    $("of-vazio-wrap").style.display = bi || tri ? "block" : "none";
    $("of-ponta-wrap").style.display = tri ? "block" : "none";
    $("of-cheias-wrap").style.display = tri ? "block" : "none";
  };
  cycle.addEventListener("change", updateCycleFields);
  updateCycleFields();

  const readProfile = () => ({
    segment: $("of-segmento").value,
    annualKwh: Number($("of-consumo").value),
    powerKva: Number($("of-potencia").value),
    cycle: cycle.value,
    offPeakPercent: Number($("of-vazio").value),
    peakPercent: Number($("of-ponta").value),
    shoulderPercent: Number($("of-cheias").value),
    modality: mode.value
  });

  function renderOffers() {
    if (!currentOffers.length) return;
    const rows = currentOffers
      .filter(offer => {
        const min = offer.potencia_min_kva == null ? -Infinity : Number(offer.potencia_min_kva);
        const max = offer.potencia_max_kva == null ? Infinity : Number(offer.potencia_max_kva);
        return currentProfile.powerKva >= min && currentProfile.powerKva <= max;
      })
      .map(offer => {
        const apply = appliedDiscounts.has(offer.id);
        const cost = calculateAnnualOfferCost(offer, currentProfile, apply);
        return cost ? {offer, cost, apply} : null;
      })
      .filter(Boolean)
      .sort((a,b) => a.cost.total - b.cost.total);

    if (!rows.length) {
      output.innerHTML = '<div class="card" style="padding:16px"><strong>Não há ofertas comparáveis para estes critérios.</strong><p style="font-size:13px;margin-top:6px;color:#64748b">A Wivolta só apresenta preços com dados suficientes para calcular o perfil e a potência selecionados. Não vamos preencher lacunas com estimativas inventadas.</p></div>';
      return;
    }

    output.innerHTML = rows.map(({offer,cost,apply}, index) => {
      const percent = Number(offer.desconto_percentagem || 0);
      const scopeKnown = cost.discountScope !== null && percent > 0;
      const discountControl = scopeKnown
        ? '<label style="display:flex;gap:8px;align-items:flex-start;font-size:12px;margin-top:10px"><input type="checkbox" data-discount-id="' + escapeHtml(offer.id) + '" ' + (apply ? "checked" : "") + ' style="width:16px;height:16px;margin-top:2px"> Confirmo que cumpro as condições indicadas e quero ver a estimativa com o desconto de ' + percent + '%</label>'
        : (percent > 0 ? '<p style="font-size:12px;color:#8a4b08;margin-top:8px">Desconto anunciado: ' + percent + '%. Não aplicado: o âmbito ou as condições ainda não permitem calcular este desconto com segurança.</p>' : "");
      const conditions = offer.desconto_condicoes ? '<p style="font-size:12px;color:#64748b;margin-top:7px">' + escapeHtml(offer.desconto_condicoes) + '</p>' : "";
      const notes = offer.notas ? '<details style="margin-top:7px;font-size:12px;color:#64748b"><summary>Notas e limitações</summary><p style="margin-top:5px">' + escapeHtml(offer.notas) + '</p></details>' : "";
      const fidelity = Number(offer.fidelizacao_meses || 0) > 0 ? '<span class="badge">Fidelização: ' + Number(offer.fidelizacao_meses) + ' meses</span>' : '<span class="badge">Sem fidelização indicada</span>';
      const validity = offer.validade_fim ? 'Válida até ' + dateLabel(offer.validade_fim) : "Validade final não indicada — confirmar";
      const discountLine = apply && cost.discount > 0 ? '<p style="font-size:13px">Desconto estimado: −' + money(cost.discount) + '</p>' : "";
      const iva = offer.iva_incluido ? "IVA incluído" : "Sem IVA";
      const source = offer.fonte_documental ? '<p style="font-size:11px;color:#64748b;margin-top:6px">Fonte: ' + escapeHtml(offer.fonte_documental) + '</p>' : "";
      return '<article class="tarifa-card" style="align-items:stretch"><div style="flex:1"><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><span class="badge">#' + (index+1) + '</span><span class="badge">' + escapeHtml(offer.modalidade || "modalidade por confirmar") + '</span>' + fidelity + '</div><h3 style="margin:8px 0 2px;font-size:18px">' + escapeHtml(offer.comercializador) + ' — ' + escapeHtml(offer.plano) + '</h3><p style="font-size:12px;color:#64748b">' + escapeHtml(validity) + ' · ' + iva + '</p><p style="font-size:13px;margin-top:8px">Energia: ' + money(cost.energy) + '/ano · Potência: ' + money(cost.power) + '/ano</p>' + discountLine + conditions + discountControl + notes + source + '</div><div style="min-width:145px;text-align:right"><strong style="font-size:22px;display:block">' + money(cost.total) + '</strong><span style="font-size:12px;color:#64748b">estimativa anual</span><p style="font-size:13px;margin-top:6px">' + money(cost.total/12) + '/mês</p></div></article>';
    }).join("");

    output.querySelectorAll("[data-discount-id]").forEach(input => {
      input.addEventListener("change", event => {
        const id = event.currentTarget.getAttribute("data-discount-id");
        if (event.currentTarget.checked) appliedDiscounts.add(id);
        else appliedDiscounts.delete(id);
        renderOffers();
      });
    });
  }

  $("of-comparar").addEventListener("click", async () => {
    const profile = readProfile();
    const validation = validateProfile(profile);
    if (validation) {
      output.innerHTML = '<p role="alert" style="color:#b45309">' + escapeHtml(validation) + '</p>';
      return;
    }
    currentProfile = profile;
    currentOffers = [];
    appliedDiscounts.clear();
    output.textContent = "A consultar ofertas ativas e válidas…";
    status.textContent = "A consultar o catálogo Wivolta para " + (profile.segment === "residencial" ? "particulares" : "empresas") + ", " + profile.cycle + " e " + profile.modality + ".";

    try {
      const today = new Date().toISOString().slice(0,10);
      let query = supabase.from("ofertas_energia")
        .select("id,comercializador,plano,segmento,energia,modalidade,ciclo,potencia_min_kva,potencia_max_kva,preco_simples,preco_fora_vazio,preco_vazio,preco_cheias,preco_ponta,termo_fixo_dia,desconto_percentagem,desconto_condicoes,fidelizacao_meses,validade_inicio,validade_fim,iva_incluido,fonte_documental,notas")
        .eq("estado","ativo")
        .eq("energia","eletricidade")
        .eq("segmento",profile.segment)
        .eq("ciclo",profile.cycle)
        .or("validade_inicio.is.null,validade_inicio.lte." + today)
        .or("validade_fim.is.null,validade_fim.gte." + today);
      if (profile.modality !== "todas") query = query.eq("modalidade",profile.modality);
      const {data,error} = await query;
      if (error) throw error;
      currentOffers = Array.isArray(data) ? data : [];
      renderOffers();
      if (!currentOffers.length) {
        const detail = profile.cycle === "tri-horario"
          ? "Ainda não existem ofertas tri-horárias ativas e validadas no catálogo."
          : profile.modality === "indexada"
            ? "Ainda não existem tarifas indexadas ativas e validadas para estes critérios."
            : "Não foram encontradas ofertas ativas e válidas para estes critérios.";
        output.innerHTML = '<div class="card" style="padding:16px"><strong>' + detail + '</strong><p style="font-size:13px;color:#64748b;margin-top:6px">A Wivolta não vai substituir preços em falta por valores estimados. Podes pedir uma análise acompanhada.</p><a class="btn-primary" style="display:inline-flex;text-decoration:none;margin-top:12px" href="https://wa.me/351913629339?text=Ol%C3%A1%2C%20quero%20uma%20an%C3%A1lise%20acompanhada%20da%20minha%20tarifa.">Pedir análise à Wivolta</a></div>';
      } else {
        status.textContent = currentOffers.length + " oferta(s) ativa(s) encontradas. Os resultados estão ordenados pelo custo anual estimado para o teu perfil.";
      }
    } catch (error) {
      output.innerHTML = '<p role="alert" style="color:#b45309">Não foi possível consultar o catálogo: ' + escapeHtml(error?.message || "erro desconhecido") + '</p>';
      status.textContent = "Falha na consulta ao catálogo.";
    }
  });
})();
