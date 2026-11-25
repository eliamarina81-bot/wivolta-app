const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
const inline = scripts.map(m => m[1]).find(s => s.includes("function parseFaturaText("));
assert.ok(inline, "OCR parser must exist in index.html");

const elements = new Map();
const context = {
  document: {
    getElementById: id => {
      if (!elements.has(id)) elements.set(id, { value: "", textContent: "", innerHTML: "", classList: { remove() {} } });
      return elements.get(id);
    }
  },
  Intl, Number, Math
};
vm.createContext(context);
vm.runInContext(inline, context);
const parse = context.parseFaturaText;

const bi = parse([
  "EDP Comercial",
  "NIF 123456789",
  "CPE PT 0002 123456789123 AB",
  "CUI PT 1002 123456789123 AB",
  "Potência contratada 6,9 kVA",
  "Tarifa bi-horária",
  "Consumo fora de vazio 200 kWh",
  "Consumo vazio 100 kWh",
  "Gás 150 kWh"
].join("\n"));
assert.equal(bi.fornecedor, "EDP");
assert.equal(bi.nif, "123456789");
assert.equal(bi.validacao.nif, true, "checks the NIF checksum");
assert.equal(bi.validacao.cpe, true, "checks CPE structure and electricity operator prefix");
assert.equal(bi.validacao.cui, true, "checks CUI structure and gas operator prefix");
assert.equal(bi.potencia, "6.9", "extracts decimal power");
assert.equal(bi.tarifa, "bi-horário");
assert.equal(bi.fora, "200", "extracts off-peak consumption");
assert.equal(bi.vazio, "100", "does not duplicate off-peak value into vazio");
assert.equal(bi.gas, "150", "extracts gas kWh");
context.mostrarCampos(bi, "synthetic invoice text");
assert.match(elements.get("ocr-validacao").textContent, /checksum OK/);
assert.match(elements.get("ocr-validacao").textContent, /CPE: estrutura OK/);
assert.match(elements.get("ocr-validacao").textContent, /CUI: estrutura OK/);
assert.equal(elements.get("ocr-nif").value, "123456789");

const tri = parse("Tarifa tri-horária\nPonta 10 kWh\nCheias 20 kWh\nVazio 30 kWh");
assert.equal(tri.tarifa, "tri-horário");
assert.equal(tri.ponta, "10");
assert.equal(tri.cheias, "20");
assert.equal(tri.vazio, "30");

const simple = parse("NIPC 123456780\nPotência 3.45 kVA\nConsumo total 1200 kWh");
assert.equal(simple.nif, "123456780");
assert.equal(simple.validacao.nif, false, "flags invalid NIF checksum");
assert.equal(simple.potencia, "3.45");
assert.equal(simple.simples, "1200");

const galp = parse([
  "Galp",
  "Tarifa 6.9 kVA Social Simples Sem Ciclo",
  "Energia Simples (medida) 200 kWh 0,10330000 €/kWh",
  "Energia Simples (medida) 171 kWh 0,10330000 €/kWh",
  "ISPE 371 kWh 0,00000000 €/kWh"
].join("\n"));
assert.equal(galp.fornecedor, "Galp");
assert.equal(galp.potencia, "6.9");
assert.equal(galp.tarifa, "simples/por confirmar");
assert.equal(galp.simples, "371", "adds the two Galp simple-energy lines and ignores the duplicate ISPE total");

const wrongCpe = parse("CPE PT1002123456789123AB");
assert.equal(wrongCpe.validacao.cpe, false, "rejects gas operator prefix in CPE");
const wrongCui = parse("CUI PT0002123456789123AB");
assert.equal(wrongCui.validacao.cui, false, "rejects electricity operator prefix in CUI");
const malformed = parse("CPE PT0002AB");
assert.equal(malformed.validacao.cpe, false, "rejects malformed CPE");

console.log("OCR parser tests: PASS (26 checks)");
