const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const scripts = [...html.matchAll(/<script(?:\\s[^>]*)?>([\\s\\S]*?)<\\/script>/g)];
const inline = scripts.map(m => m[1]).find(s => s.includes("function calculateAnnualCost("));
assert.ok(inline, "calculator helper must exist in index.html");

const context = { document: { getElementById: () => ({ value: "", innerHTML: "" }) }, Intl, Number, Math };
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

console.log("calculator tests: PASS");
