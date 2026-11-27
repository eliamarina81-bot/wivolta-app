import test from "node:test";
import assert from "node:assert/strict";
import { calculateAnnualOfferCost, classifyDiscountScope, validateProfile } from "../comparison-engine.mjs";

test("calcula tarifa simples com termo fixo anual", () => {
  const result = calculateAnnualOfferCost({preco_simples:0.2,termo_fixo_dia:0.3}, {annualKwh:3000,cycle:"simples"});
  assert.equal(result.energy,600);
  assert.equal(result.power,109.5);
  assert.equal(result.total,709.5);
});

test("calcula bi-horário com percentagem real em vazio", () => {
  const result = calculateAnnualOfferCost({preco_fora_vazio:0.2,preco_vazio:0.1,termo_fixo_dia:0.2},{annualKwh:3000,cycle:"bi-horario",offPeakPercent:40});
  assert.equal(result.energy,480);
  assert.equal(result.total,553);
});

test("calcula tri-horário com três períodos", () => {
  const result = calculateAnnualOfferCost({preco_ponta:0.4,preco_cheias:0.2,preco_vazio:0.1,termo_fixo_dia:0.2},{annualKwh:3000,cycle:"tri-horario",peakPercent:20,shoulderPercent:45,offPeakPercent:35});
  assert.equal(result.energy,615);
  assert.equal(result.total,688);
});

test("aplica desconto ao termo de energia apenas quando o âmbito é explícito", () => {
  const offer={preco_simples:0.2,termo_fixo_dia:0.3,desconto_percentagem:10,desconto_condicoes:"Desconto aplicado sobre o preço Endesa antes de impostos."};
  const base=calculateAnnualOfferCost(offer,{annualKwh:3000,cycle:"simples"});
  const discounted=calculateAnnualOfferCost(offer,{annualKwh:3000,cycle:"simples"},true);
  assert.equal(base.total,709.5);
  assert.equal(discounted.discount,60);
  assert.equal(discounted.total,649.5);
});

test("aplica desconto ao subtotal apenas quando a condição diz total da fatura", () => {
  assert.equal(classifyDiscountScope("Desconto no total da fatura"),"subtotal");
  const result=calculateAnnualOfferCost({preco_simples:0.2,termo_fixo_dia:0.3,desconto_percentagem:10,desconto_condicoes:"Desconto no total da fatura"},{annualKwh:3000,cycle:"simples"},true);
  assert.equal(result.discount,70.95);
  assert.equal(result.total,638.55);
});

test("não aplica descontos com âmbito ambíguo", () => {
  assert.equal(classifyDiscountScope("Desconto sujeito a condições comerciais"),null);
  const result=calculateAnnualOfferCost({preco_simples:0.2,termo_fixo_dia:0.3,desconto_percentagem:15,desconto_condicoes:"Desconto sujeito a condições comerciais"},{annualKwh:3000,cycle:"simples"},true);
  assert.equal(result.discount,0);
});

test("valida percentagens de ciclos bi e tri-horários", () => {
  assert.equal(validateProfile({annualKwh:3000,powerKva:6.9,cycle:"bi-horario",offPeakPercent:40}),"");
  assert.match(validateProfile({annualKwh:3000,powerKva:6.9,cycle:"tri-horario",peakPercent:20,shoulderPercent:40,offPeakPercent:30}),/somar 100/);
});
