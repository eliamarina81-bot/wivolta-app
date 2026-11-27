const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
const inline = scripts.map(m => m[1]).find(s => s.includes("function calculateAnnualCost("));
assert.ok(inline, "calculator helper must exist in index.html");

const elements = new Map();
const context = {
  document: {
    getElementById: id => {
      if (!elements.has(id)) elements.set(id, { value: "", innerHTML: "", addEventListener() {} });
      return elements.get(id);
    }
  },
  Intl, Number, Math
};
vm.createContext(context);
vm.runInContext(inline, context);

const calc = context.calculateAnnualCost;
assert.deepEqual(JSON.parse(JSON.stringify(calc(3000, 0.15, 0.30, 50))), {
  energy: 450,
  power: 109.5,
  subtotal: 559.5,
  discount: 50,
  total: 509.5
}, "calculates energy, daily power term, discount and annual total");

assert.equal(calc(0, 0.15, 0.30, 0).total, 109.5, "handles zero consumption with fixed power term");
assert.equal(calc(100, 0.2, 0.1, 1000).total, 0, "caps discount to subtotal, preventing negative totals");
assert.equal(calc(-1, 0.2, 0.1, 0), null, "rejects negative consumption");
assert.equal(calc(100, NaN, 0.1, 0), null, "rejects invalid energy price");
assert.equal(calc(100, 0.2, 0.1, -1), null, "rejects negative discount");

const set = (id, value) => { context.document.getElementById(id).value = value; };
set("calc-kwh", "3000");
set("calc-kwhprice", "0.15");
set("calc-power", "6.9");
set("calc-powerprice", "0.30");
set("calc-discount", "50");
context.calcularCusto();
assert.match(elements.get("calc-result").innerHTML, /Total estimado/);
assert.match(elements.get("calc-result").innerHTML, /509,50/, "renders the expected annual total");
assert.match(elements.get("calc-result").innerHTML, /6,9 kVA/, "shows the contracted power as a reference");

set("calc-kwh", "");
context.calcularCusto();
assert.match(elements.get("calc-result").innerHTML, /role="alert"/, "shows validation message for missing input");

set("calc-kwh", "100");
set("calc-kwhprice", "0.2");
set("calc-powerprice", "0.1");
set("calc-discount", "1000");
context.calcularCusto();
assert.match(elements.get("calc-result").innerHTML, /limitado ao subtotal/, "warns when discount exceeds subtotal");

console.log("calculator tests: PASS (12 checks)");
