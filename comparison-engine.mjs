export function classifyDiscountScope(conditions = "") {
  const text = String(conditions).toLocaleLowerCase("pt-PT").normalize("NFD").replace(/[\\u0300-\\u036f]/g, "");
  if (/total da fatura|total da factura|total da conta/.test(text)) return "subtotal";
  if (/preco (?:de )?energia|termo de energia|preco endesa|preco unitario de energia/.test(text)) return "energia";
  return null;
}

export function calculateAnnualOfferCost(offer, profile, applyDiscount = false) {
  const number = value => value === null || value === undefined || value === "" ? NaN : Number(value);
  const consumption = number(profile.annualKwh);
  const powerDaily = number(offer.termo_fixo_dia);
  if (!Number.isFinite(consumption) || consumption <= 0 || !Number.isFinite(powerDaily) || powerDaily < 0) return null;

  let energy = 0;
  if (profile.cycle === "simples") {
    const price = number(offer.preco_simples);
    if (!Number.isFinite(price) || price < 0) return null;
    energy = consumption * price;
  } else if (profile.cycle === "bi-horario") {
    const offPeak = number(profile.offPeakPercent);
    if (!Number.isFinite(offPeak) || offPeak < 0 || offPeak > 100) return null;
    const outside = number(offer.preco_fora_vazio);
    const off = number(offer.preco_vazio);
    if (![outside, off].every(v => Number.isFinite(v) && v >= 0)) return null;
    energy = consumption * ((1 - offPeak / 100) * outside + (offPeak / 100) * off);
  } else if (profile.cycle === "tri-horario") {
    const peak = number(profile.peakPercent), shoulder = number(profile.shoulderPercent), offPeak = number(profile.offPeakPercent);
    if (![peak, shoulder, offPeak].every(v => Number.isFinite(v) && v >= 0 && v <= 100) || Math.abs(peak + shoulder + offPeak - 100) > 0.001) return null;
    const p = number(offer.preco_ponta), s = number(offer.preco_cheias), o = number(offer.preco_vazio);
    if (![p, s, o].every(v => Number.isFinite(v) && v >= 0)) return null;
    energy = consumption * (peak / 100 * p + shoulder / 100 * s + offPeak / 100 * o);
  } else return null;

  const power = powerDaily * 365;
  const subtotal = energy + power;
  const scope = classifyDiscountScope(offer.desconto_condicoes);
  const percent = number(offer.desconto_percentagem);
  const hasDiscount = Number.isFinite(percent) && percent > 0 && percent <= 100;
  const discount = applyDiscount && hasDiscount && scope
    ? (scope === "subtotal" ? subtotal : energy) * percent / 100
    : 0;
  return { energy, power, subtotal, discount, total: subtotal - discount, discountScope: scope, discountPercent: hasDiscount ? percent : 0 };
}

export function validateProfile(profile) {
  const kwh = Number(profile.annualKwh);
  const power = Number(profile.powerKva);
  if (!Number.isFinite(kwh) || kwh <= 0) return "Indica um consumo anual em kWh superior a zero.";
  if (!Number.isFinite(power) || power <= 0) return "Seleciona uma potência contratada válida.";
  if (profile.cycle === "bi-horario") {
    const v = Number(profile.offPeakPercent);
    if (!Number.isFinite(v) || v < 0 || v > 100) return "Indica a percentagem real de consumo em vazio (0–100%).";
  }
  if (profile.cycle === "tri-horario") {
    const values = [profile.peakPercent, profile.shoulderPercent, profile.offPeakPercent].map(Number);
    if (values.some(v => !Number.isFinite(v) || v < 0 || v > 100)) return "Indica as três percentagens horárias entre 0 e 100%.";
    if (Math.abs(values.reduce((a,b)=>a+b,0)-100) > 0.001) return "As percentagens de ponta, cheias e vazio têm de somar 100%.";
  }
  return "";
}
