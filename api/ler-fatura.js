export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método não permitido" });
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "A leitura por IA não está configurada no servidor." });

  try {
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (!text) return res.status(400).json({ error: "Não foi recebido texto da fatura." });
    if (text.length > 14000) return res.status(413).json({ error: "Texto demasiado extenso para análise." });

    const instructions = `Analisa texto extraído de uma fatura de eletricidade e/ou gás em Portugal. O texto pode ter erros de OCR e tabelas desformatadas.
Devolve APENAS um objeto JSON válido, sem markdown, com estas chaves:
{
 "fornecedor": string, "potencia": string, "tarifa": "simples"|"bi-horário"|"tri-horário"|"por confirmar",
 "simples": string, "fora": string, "vazio": string, "cheias": string, "ponta": string, "gas": string,
 "preco_energia": string, "termo_fixo_dia": string, "periodo_fatura": string,
 "confianca": "alta"|"media"|"baixa", "observacoes": string
}
Regras obrigatórias:
- Extrai apenas valores que estejam efetivamente no texto. Se não tiveres certeza, usa string vazia.
- Consumos em kWh: identifica a linha de total e associa os números às colunas pelo cabeçalho. Em tabelas como "Vazio Ponta Cheias" seguida de "Total de consumos kWh 56 24 60", associa respetivamente vazio=56, ponta=24, cheias=60. Não confundas valores de potência, euros, dias ou leituras de contador com kWh.
- Bi-horário: distingue vazio de fora de vazio. Se a fatura só apresentar vazio e total, não inventes fora de vazio; calcula apenas se o total de consumo estiver explicitamente presente e a diferença for inequívoca.
- Gás: extrai consumo em kWh, não m3, salvo se apenas existir m3; nesse caso não coloques m3 no campo gas e explica em observações.
- Nunca calcules, arredondes, adivinhes nem convertas unidades. Usa vírgula decimal quando existir.
- Não devolvas nomes, moradas, NIF, CPE, CUI, telefone, email ou outros dados pessoais.
- Se houver valores contraditórios, deixa o campo vazio e explica em observações.`;

    const requestBody = JSON.stringify({
      systemInstruction: { parts: [{ text: instructions }] },
      contents: [{ role: "user", parts: [{ text: "Texto da fatura já filtrado de dados pessoais:\\n" + text }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 1200, responseMimeType: "application/json" }
    });
    let response;
    for (let attempt = 0; attempt < 3; attempt++) {
      response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=" + encodeURIComponent(apiKey), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody
      });
      if (response.status !== 503 && response.status !== 429 && response.status < 500) break;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 700 * (2 ** attempt)));
    }

    const raw = await response.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
    if (!response.ok) {
      const msg = String(data?.error?.message || "").replace(/[\r\n]+/g, " ").slice(0, 180);
      console.error("Gemini invoice extraction error", response.status, msg);
      return res.status(502).json({ error: response.status === 503 ? "A Gemini está temporariamente sobrecarregada. Tentámos novamente automaticamente; aguarde um pouco e volte a tentar. A leitura local continua disponível." : response.status === 429 ? "O limite temporário da Gemini foi atingido. Tente novamente mais tarde." : "A Gemini não conseguiu analisar esta fatura.", diagnostic: "HTTP " + response.status });
    }
    const answer = data?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("").trim() || "";
    let extracted;
    try { extracted = JSON.parse(answer); } catch {
      const cleaned = answer.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/i, "").trim();
      try { extracted = JSON.parse(cleaned); } catch { extracted = null; }
    }
    if (!extracted || typeof extracted !== "object" || Array.isArray(extracted)) {
      return res.status(502).json({ error: "A Gemini devolveu uma leitura num formato inválido. Tente novamente." });
    }
    const allowed = ["fornecedor","potencia","tarifa","simples","fora","vazio","cheias","ponta","gas","preco_energia","termo_fixo_dia","periodo_fatura","confianca","observacoes"];
    const result = {};
    for (const key of allowed) result[key] = typeof extracted[key] === "string" ? extracted[key].slice(0, 300) : "";
    return res.status(200).json({ extracted: result });
  } catch (error) {
    console.error("Invoice extraction failed", error?.message || "unknown");
    return res.status(500).json({ error: "Erro interno ao analisar a fatura." });
  }
}