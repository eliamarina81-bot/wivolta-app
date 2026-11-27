const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync(require("node:path").join(__dirname, "..", "index.html"), "utf8");
const fixtureFile = JSON.parse(fs.readFileSync(require("node:path").join(__dirname, "fixtures", "invoice-reader-fixtures.json"), "utf8"));
const fixtures = Object.fromEntries(fixtureFile.fixtures.map(item => [item.id, item]));

const context = vm.createContext({
  normalizeOcrLine(value) {
    return String(value || "").normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase();
  },
  console
});

// Carrega os extratores reais de identificação, titular e morada do próprio index.html.
const helperStart = html.indexOf("function normCode(s){");
const helperEnd = html.indexOf("function validateNif(value){", helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, "Helpers de fatura encontrados");
vm.runInContext(html.slice(helperStart, helperEnd), context);

const simpleParserStart = html.indexOf("function parseSimpleConsumptionRows(text){");
const meterParserStart = html.indexOf("function parseMeterReadingTable(text){");
const parserStart = simpleParserStart >= 0 ? simpleParserStart : (meterParserStart >= 0 ? meterParserStart : html.indexOf("function parseHourlyConsumptionTable(text){"));
const parserEnd = html.indexOf("function mostrarCampos", parserStart);
assert.ok(parserStart >= 0 && parserEnd > parserStart, "Parser de faturas encontrado no index.html");
vm.runInContext(html.slice(parserStart, parserEnd), context);

test("Galp real: soma apenas energia simples da comercialização, mesmo com quebras de linha", () => {
  const f = fixtures["galp-simple-commercial-public-structure"];
  const result = context.parseFaturaText(f.text);
  assert.equal(result.fornecedor, "Galp");
  assert.equal(result.titular, "Cliente Exemplo");
  assert.equal(result.morada, "Rua Exemplo 56 2305-625 Sabacheira");
  assert.equal(result.tarifa, "simples/por confirmar");
  assert.equal(result.simples, "371");
  assert.equal(result.fora, "");
  assert.equal(result.vazio, "");
  const sectionResult = context.extractGalpCommercializationKwh(f.text);
  assert.deepEqual(Array.from(sectionResult.rows), [200, 171]);
  assert.equal(sectionResult.totalKwh, 371);
});

test("Galp: não extrai consumos se faltar o limite da secção de comercialização", () => {
  const ambiguous = "Galp\\nEnergia Simples (medida) 200 kWh\\nISPE 200 kWh";
  assert.equal(context.extractGalpCommercializationKwh(ambiguous), null);
});

test("EDP público: separa os três períodos sem criar consumo simples", () => {
  const f = fixtures["edp-tri-publico-2025"];
  const result = context.parseFaturaText(f.text);
  assert.equal(result.tarifa, "tri-horário");
  assert.equal(result.vazio, f.expected.vazio);
  assert.equal(result.ponta, f.expected.ponta);
  assert.equal(result.cheias, f.expected.cheias);
  assert.equal(result.simples, "");
});

test("Iberdrola público: soma subperíodos explicitamente simples", () => {
  const f = fixtures["iberdrola-simple-public-2025"];
  const result = context.parseFaturaText(f.text);
  assert.equal(result.tarifa, "simples/por confirmar");
  assert.equal(result.simples, f.expected.simples);
  assert.equal(result.fora, "");
  assert.equal(result.vazio, "");
});

test("Goldenergy público: extrai leituras tri-horárias e ignora parcelas faturadas", () => {
  const f = fixtures["goldenergy-tri-publico-2025"];
  const result = context.parseFaturaText(f.text);
  assert.equal(result.tarifa, "tri-horário");
  assert.equal(result.vazio, f.expected.vazio);
  assert.equal(result.ponta, f.expected.ponta);
  assert.equal(result.cheias, f.expected.cheias);
  assert.equal(result.simples, "");
});

test("Endesa BTE público: reconhece períodos mas não adivinha consumos", () => {
  const f = fixtures["endesa-bte-public-ambiguous"];
  const result = context.parseFaturaText(f.text);
  assert.equal(result.tarifa, "tri-horário");
  assert.equal(result.ponta, "");
  assert.equal(result.cheias, "");
  assert.equal(result.vazio, "");
});

test("Bi-horário: identifica fora de vazio e vazio", () => {
  const f = fixtures["synthetic-bi-hourly"];
  const result = context.parseFaturaText(f.text);
  assert.equal(result.tarifa, "bi-horário");
  assert.equal(result.fora, f.expected.fora);
  assert.equal(result.vazio, f.expected.vazio);
});

test("Simples: lê consumo normal estimado quando não há tabela horária", () => {
  const f = fixtures["synthetic-simple"];
  const result = context.parseFaturaText(f.text);
  assert.equal(result.simples, f.expected.simples);
  assert.equal(result.tarifa, "simples/por confirmar");
});

test("Tabela tri-horária ambígua: não escolhe números à sorte", () => {
  const f = fixtures["synthetic-tri-ambiguous"];
  assert.equal(context.parseHourlyConsumptionTable(f.text), null);
});

test("PDF.js: recompõe texto pela posição x/y e mantém a ordem das colunas", async () => {
  const start = html.indexOf("function extrairTextoPdf(page){");
  const end = html.indexOf("async function processarFatura", start);
  assert.ok(start >= 0 && end > start, "Função extrairTextoPdf encontrada");
  vm.runInContext(html.slice(start, end), context);
  const items = [
    { str: "Total de consumos", width: 80, height: 10, transform: [1,0,0,10,10,100] },
    { str: "kWh", width: 18, height: 10, transform: [1,0,0,10,95,100] },
    { str: "56", width: 12, height: 10, transform: [1,0,0,10,120,100] },
    { str: "24", width: 12, height: 10, transform: [1,0,0,10,145,100] },
    { str: "60", width: 12, height: 10, transform: [1,0,0,10,170,100] },
    { str: "Data", width: 20, height: 10, transform: [1,0,0,10,10,80] }
  ];
  const output = await context.extrairTextoPdf({ getTextContent: async () => ({ items }) });
  assert.match(output, /Total de consumos kWh 56 24 60/);
  assert.match(output, /Data/);
  assert.ok(output.indexOf("Total de consumos") < output.indexOf("Data"));
});
