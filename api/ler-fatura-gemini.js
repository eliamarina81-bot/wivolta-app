export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método não permitido." });
  }

  // A rota exige consentimento explícito. A interface ainda não a chama:
  // só deve ser ligada depois dos testes do leitor local.
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  if (body?.consent !== true) {
    return res.status(403).json({ error: "É necessário consentimento explícito para a análise Gemini." });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(503).json({ error: "A segunda camada Gemini não está configurada." });

  try {
    const rawText = typeof body?.text === "string" ? body.text.trim() : "";
    if (!rawText) return res.status(400).json({ error: "Não foi recebido texto extraído da fatura." });
    if (rawText.length > 14000) return res.status(413).json({ error: "Texto demasiado extenso para análise." });

    // Defesa adicional: não enviar identificadores pessoais para o modelo.
    const safeText = rawText
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[EMAIL REMOVIDO]")
      .replace(/\b(?:PT)?\d{9}\b/g, "[NIF/ID REMOVIDO]")
      .replace(/\bPT\d{4}\d{12}[A-Z]{2}\b/gi, "[CÓDIGO DE INSTALAÇÃO REMOVIDO]")
      .replace(/\b(?:IBAN\s*)?PT50(?:[\s\d-]{20,})/gi, "[IBAN REMOVIDO]")
      .replace(/\b(?:9[1236]\d{7}|2\d{8})\b/g, "[TELEFONE REMOVIDO]")
      .split(/\r?\n/)
      .filter(line => !/^\s*(titular|nome(?: do cliente)?|cliente|morada|endereco|local de consumo|morada de fornecimento|nif|nipc|cpe|cui|iban|telefone|telemovel|email|contacto)\b/i.test(line))
      .join("\n")
      .slice(0, 12000);

    const prompt = `És um extrator conservador de dados de faturas de energia em Portugal.
Analisa apenas o texto fornecido. Não inventes, não calcules consumos, não convertas m³ em kWh, não infiras preços, campanhas, descontos ou poupanças.
Se não conseguires associar um valor inequivocamente a uma unidade e período, devolve null.
Não devolvas dados pessoais nem identificadores de instalação.
Em eletricidade, distingue ciclo simples, bi-horário (fora de vazio e vazio) e tri-horário (ponta, cheias e vazio).
Não somes linhas repetidas, taxas, leituras de contador ou totais repetidos. Em caso de dúvida, null e explica em avisos.
Devolve exclusivamente o objeto JSON pedido.

Texto extraído:
${safeText}`;

    const model = process.env.GEMINI_INVOICE_MODEL || "gemini-2.5-flash";
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent?key=" + encodeURIComponent(apiKey),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 1200,
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                fornecedor: { type: "STRING", nullable: true },
                ciclo: { type: "STRING", nullable: true, enum: ["simples", "bi-horário", "tri-horário"] },
                potencia_kva: { type: "STRING", nullable: true },
                consumo_simples_kwh: { type: "STRING", nullable: true },
                consumo_fora_vazio_kwh: { type: "STRING", nullable: true },
                consumo_vazio_kwh: { type: "STRING", nullable: true },
                consumo_cheias_kwh: { type: "STRING", nullable: true },
                consumo_ponta_kwh: { type: "STRING", nullable: true },
                consumo_gas_kwh: { type: "STRING", nullable: true },
                periodo_fatura: { type: "STRING", nullable: true },
                avisos: { type: "ARRAY", items: { type: "STRING" } }
              },
              required: [
                "fornecedor", "ciclo", "potencia_kva", "consumo_simples_kwh",
                "consumo_fora_vazio_kwh", "consumo_vazio_kwh", "consumo_cheias_kwh",
                "consumo_ponta_kwh", "consumo_gas_kwh", "periodo_fatura", "avisos"
              ]
            }
          }
        })
      }
    );

    const raw = await response.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
    if (!response.ok) {
      console.error("Gemini invoice extraction error", response.status, String(data?.error?.message || "").slice(0, 300));
      const status = response.status === 429 ? 429 : 502;
      return res.status(status).json({ error: response.status === 429
        ? "O limite de utilização Gemini foi atingido. Confirme os campos manualmente."
        : "A análise Gemini está indisponível. A leitura local continua disponível." });
    }

    const answer = data?.candidates?.[0]?.content?.parts?.map(part => part.text || "").join("").trim();
    let parsed;
    try { parsed = JSON.parse(answer || ""); } catch { parsed = null; }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return res.status(502).json({ error: "A resposta Gemini não respeitou o formato JSON. Confirme os campos manualmente." });
    }

    const fields = [
      "fornecedor", "ciclo", "potencia_kva", "consumo_simples_kwh",
      "consumo_fora_vazio_kwh", "consumo_vazio_kwh", "consumo_cheias_kwh",
      "consumo_ponta_kwh", "consumo_gas_kwh", "periodo_fatura"
    ];
    const extracted = {};
    for (const field of fields) {
      const value = parsed[field];
      extracted[field] = typeof value === "string" && value.trim() ? value.trim().slice(0, 100) : null;
    }
    if (!["simples", "bi-horário", "tri-horário"].includes(extracted.ciclo)) extracted.ciclo = null;
    extracted.avisos = Array.isArray(parsed.avisos)
      ? parsed.avisos.filter(item => typeof item === "string").slice(0, 10).map(item => item.slice(0, 240))
      : ["A IA não forneceu avisos estruturados."];
    return res.status(200).json({ extracted, requiresUserConfirmation: true, source: "gemini-flash" });
  } catch (error) {
    console.error("Gemini invoice extraction failed", error?.message || "unknown");
    return res.status(500).json({ error: "Erro interno ao analisar a fatura." });
  }
}
