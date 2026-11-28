const GEMINI_MODEL = process.env.GEMINI_INVOICE_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash";
const MAX_TEXT_CHARS = 15000;

const INVOICE_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    fornecedor: { type: "STRING", nullable: true },
    potencia_kva: { type: "NUMBER", nullable: true },
    ciclo_horario: {
      type: "STRING",
      nullable: true,
      enum: ["simples", "bi-horário", "tri-horário"]
    },
    consumo_kwh: {
      type: "OBJECT",
      properties: {
        simples_total: { type: "NUMBER", nullable: true },
        vazio: { type: "NUMBER", nullable: true },
        fora_de_vazio: { type: "NUMBER", nullable: true },
        ponta: { type: "NUMBER", nullable: true },
        cheias: { type: "NUMBER", nullable: true }
      },
      required: ["simples_total", "vazio", "fora_de_vazio", "ponta", "cheias"]
    },
    total_fatura_eur: { type: "NUMBER", nullable: true },
    observacoes_incerteza: {
      type: "ARRAY",
      items: { type: "STRING" }
    }
  },
  required: [
    "fornecedor",
    "potencia_kva",
    "ciclo_horario",
    "consumo_kwh",
    "total_fatura_eur",
    "observacoes_incerteza"
  ]
};

function sanitizeTextForGemini(rawText) {
  let text = String(rawText || "");

  // Oculta CPE/CUI sem remover o restante da linha técnica.
  text = text.replace(/\b(CPE|CUI)\b[\s:=-]*[A-Z0-9]{6,30}/gi, "$1: [OCULTADO]");
  text = text.replace(/\bPT0002[A-Z0-9]{10,20}\b/gi, "[INSTALACAO_OCULTADA]");

  text = text.replace(/\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g, "[IBAN_OCULTADO]");
  text = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[EMAIL_OCULTADO]");
  text = text.replace(/(?:\+351\s?)?\b(?:9\d{2}|2\d{2})\s?\d{3}\s?\d{3}\b/g, "[TELEFONE_OCULTADO]");
  text = text.replace(/\b(NIF|NIPC|CC|CART[ÃA]O\s+DE\s+CIDAD[ÃA]O)\b[\s:=-]*\d{8,9}/gi, "$1: [OCULTADO]");

  return text.slice(0, MAX_TEXT_CHARS);
}

function cleanNullableNumber(value, min = 0, max = 1000000) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < min || value > max) return null;
  return Number(value.toFixed(3));
}

function cleanNullableString(value, maxLength = 80) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function validateAndNormalizeGeminiOutput(rawObject) {
  const warnings = [];
  const rawConsumption =
    rawObject?.consumo_kwh && typeof rawObject.consumo_kwh === "object"
      ? rawObject.consumo_kwh
      : {};

  const consumption = {
    simples_total: cleanNullableNumber(rawConsumption.simples_total, 0, 500000),
    vazio: cleanNullableNumber(rawConsumption.vazio, 0, 500000),
    fora_de_vazio: cleanNullableNumber(rawConsumption.fora_de_vazio, 0, 500000),
    ponta: cleanNullableNumber(rawConsumption.ponta, 0, 500000),
    cheias: cleanNullableNumber(rawConsumption.cheias, 0, 500000)
  };

  const periods = [
    ["vazio", consumption.vazio],
    ["fora_de_vazio", consumption.fora_de_vazio],
    ["ponta", consumption.ponta],
    ["cheias", consumption.cheias]
  ].filter(([, value]) => typeof value === "number" && value > 0);

  const valuesByPeriod = new Map();
  for (const [name, value] of periods) {
    const key = String(value);
    if (!valuesByPeriod.has(key)) valuesByPeriod.set(key, []);
    valuesByPeriod.get(key).push(name);
  }
  for (const [value, names] of valuesByPeriod.entries()) {
    if (names.length > 1) {
      warnings.push(
        "O valor " + value + " kWh aparece em mais do que um período (" +
        names.join(", ") + "); confirme manualmente."
      );
    }
  }

  const notes = Array.isArray(rawObject?.observacoes_incerteza)
    ? rawObject.observacoes_incerteza
        .filter(note => typeof note === "string" && note.trim())
        .slice(0, 10)
        .map(note => note.trim().slice(0, 240))
    : [];

  const allowedCycles = ["simples", "bi-horário", "tri-horário"];
  const cycle = allowedCycles.includes(rawObject?.ciclo_horario)
    ? rawObject.ciclo_horario
    : null;

  return {
    fornecedor: cleanNullableString(rawObject?.fornecedor, 60),
    potencia_kva: cleanNullableNumber(rawObject?.potencia_kva, 1.15, 500),
    ciclo_horario: cycle,
    consumo_kwh: consumption,
    total_fatura_eur: cleanNullableNumber(rawObject?.total_fatura_eur, 0, 250000),
    observacoes_incerteza: [...notes, ...warnings].slice(0, 20)
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método não permitido." });
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) body = {};

  const hasConsent = body.consent === true || body.geminiConsent === true;
  if (!hasConsent) {
    return res.status(403).json({
      error: "É necessária autorização explícita do utilizador para usar o Gemini."
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: "A segunda camada Gemini não está configurada."
    });
  }

  const rawInputText =
    typeof body.text === "string" && body.text.trim()
      ? body.text
      : typeof body.structuredText === "string"
        ? body.structuredText
        : "";

  if (!rawInputText.trim()) {
    return res.status(400).json({ error: "Texto em falta para a segunda leitura." });
  }
  if (rawInputText.length > MAX_TEXT_CHARS) {
    return res.status(413).json({ error: "Texto demasiado extenso para análise." });
  }

  const sanitizedText = sanitizeTextForGemini(rawInputText);
  if (!sanitizedText.trim()) {
    return res.status(400).json({ error: "Não existem dados técnicos para a segunda leitura." });
  }

  const localWarnings = Array.isArray(body.localWarnings)
    ? body.localWarnings
        .filter(warning => typeof warning === "string")
        .slice(0, 10)
        .map(warning => warning.slice(0, 240))
    : [];

  const systemInstruction = [
    "És um extrator técnico de consumos e dados de faturas de energia em Portugal para a Wivolta.",
    "Nunca inventes, estimes ou adivinhes valores. Usa null perante dúvida ou ambiguidade.",
    "Não somes leituras de contador como consumo nem dupliques linhas de acesso às redes, impostos ou totais repetidos.",
    "Não devolvas CPE, CUI, nome, morada, NIF, IBAN, telefone ou email.",
    "Se um valor aparecer repetido em períodos distintos, regista-o em observacoes_incerteza.",
    "Não calcules consumos nem derives um total a partir dos períodos.",
    "Devolve apenas JSON válido conforme o esquema."
  ].join("\n");

  const promptText = [
    "Texto da fatura extraído localmente; identificadores pessoais e de instalação foram ocultados:",
    sanitizedText,
    localWarnings.length
      ? "Avisos da leitura local: " + localWarnings.join(" | ")
      : "Sem avisos locais."
  ].join("\n\n");

  try {
    const endpoint =
      "https://generativelanguage.googleapis.com/v1beta/models/" +
      encodeURIComponent(GEMINI_MODEL) +
      ":generateContent?key=" + encodeURIComponent(apiKey);

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: "user", parts: [{ text: promptText }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 1400,
          responseMimeType: "application/json",
          responseSchema: INVOICE_RESPONSE_SCHEMA
        }
      })
    });

    if (!response.ok) {
      const status = response.status === 429 ? 429 : 502;
      console.error("Gemini invoice extraction failed with status", response.status);
      return res.status(status).json({
        error: status === 429
          ? "O limite de utilização Gemini foi atingido. Confirme os campos manualmente."
          : "A segunda leitura Gemini está indisponível. A leitura local continua disponível."
      });
    }

    const data = await response.json();
    const rawJson = data?.candidates?.[0]?.content?.parts
      ?.map(part => part.text || "")
      .join("")
      .trim();

    if (!rawJson) {
      return res.status(502).json({ error: "Resposta vazia do Gemini." });
    }

    let parsed;
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      parsed = null;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return res.status(502).json({
        error: "A resposta Gemini não respeitou o formato esperado. Confirme os campos manualmente."
      });
    }

    const normalized = validateAndNormalizeGeminiOutput(parsed);
    return res.status(200).json({
      source: "gemini-flash-text-only",
      autoApplyLocal: false,
      requiresManualConfirmation: true,
      canCompare: false,
      extracted: normalized
    });
  } catch (error) {
    console.error("Gemini invoice extraction failed:", error?.message || "unknown");
    return res.status(500).json({
      error: "Erro ao processar a segunda leitura com o Gemini."
    });
  }
}
