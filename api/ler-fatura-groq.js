export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método não permitido." });
  }
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(503).json({ error: "A análise Groq não está configurada neste ambiente." });
  try {
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (!text) return res.status(400).json({ error: "Não foi recebido texto da fatura." });
    if (text.length > 14000) return res.status(413).json({ error: "Texto demasiado extenso para análise." });
    const instructions = `Analisa texto extraído de uma fatura de eletricidade e/ou gás em Portugal. O texto pode conter erros de OCR e tabelas desformatadas.\nDevolve APENAS um objeto JSON válido com estas chaves:\n{\"fornecedor\":\"\",\"potencia\":\"\",\"tarifa\":\"simples|bi-horário|tri-horário|por confirmar\",\"simples\":\"\",\"fora\":\"\",\"vazio\":\"\",\"cheias\":\"\",\"ponta\":\"\",\"gas\":\"\",\"preco_energia\":\"\",\"termo_fixo_dia\":\"\",\"periodo_fatura\":\"\",\"confianca\":\"alta|media|baixa\",\"observacoes\":\"\"}\nRegras:\n- Extrai apenas valores efetivamente presentes. Na dúvida, deixa vazio.\n- Associa os kWh às colunas pelos cabeçalhos. Exemplo: \"Vazio Ponta Cheias\" e \"Total de consumos kWh 56 24 60\" significa vazio=56, ponta=24, cheias=60.\n- MUITO IMPORTANTE em faturas Galp: as mesmas quantidades de "Energia Simples (medida)" aparecem repetidas na secção "Comercialização" e na secção "Tarifas de Acesso". Conta o consumo apenas uma vez, usando a secção Comercialização; NUNCA somes as linhas repetidas da secção Tarifas de Acesso. A linha ISPE também repete o total e NÃO é consumo adicional. Exemplo: 200 kWh + 171 kWh na Comercialização = 371 kWh, mesmo que 200 e 171 voltem a aparecer em Tarifas de Acesso e ISPE indique 371 kWh.\n- Não confundas kWh com kVA, euros, dias ou leituras de contador.\n- Bi-horário: distingue fora de vazio e vazio. Não inventes valores nem calcules diferenças.\n- Gás: extrai kWh. Se só houver m3, deixa gas vazio e explica em observações.\n- Não calcules, arredondes, adivinhes nem convertas unidades.\n- Não devolvas nomes, moradas, NIF, CPE, CUI, telefone, email ou outros dados pessoais.\n- Se houver contradições, deixa vazio e explica em observações.`;
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai/gpt-oss-20b",
        messages: [
          { role: "system", content: instructions },
          { role: "user", content: "Texto da fatura já filtrado automaticamente. A filtragem pode não remover todos os dados pessoais:\\n" + text }
        ],
        temperature: 0.1,
        max_tokens: 1200,
        response_format: { type: "json_object" }
      })
    });
    const raw = await response.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
    if (!response.ok) {
      const providerMessage = JSON.stringify({ message: data?.error?.message || "sem detalhe fornecido", failed_generation: data?.error?.failed_generation || "" }).slice(0, 1800);
      console.error("Groq invoice extraction error", response.status, providerMessage);
      const status = response.status === 429 ? 429 : response.status === 401 || response.status === 403 ? 503 : 502;
      const message = response.status === 429
        ? "O limite de utilização da análise IA foi atingido. A leitura local continua disponível."
        : response.status === 401 || response.status === 403
          ? "A chave da análise IA não foi aceite. Verifique a configuração do serviço."
          : "O serviço de análise IA está temporariamente indisponível. A leitura local continua disponível.";
      return res.status(status).json({ error: message });
    }
    const answer = data?.choices?.[0]?.message?.content || "";
    let extracted;
    try { extracted = JSON.parse(answer); } catch { extracted = null; }
    if (!extracted || typeof extracted !== "object" || Array.isArray(extracted)) {
      return res.status(502).json({ error: "A análise IA devolveu um formato inválido. Confirme os campos manualmente." });
    }
    const allowed = ["fornecedor","potencia","tarifa","simples","fora","vazio","cheias","ponta","gas","preco_energia","termo_fixo_dia","periodo_fatura","confianca","observacoes"];
    const result = {};
    for (const key of allowed) result[key] = typeof extracted[key] === "string" ? extracted[key].slice(0, 300) : "";
    return res.status(200).json({ extracted: result });
  } catch (error) {
    console.error("Groq invoice extraction failed", error?.message || "unknown");
    return res.status(500).json({ error: "Erro interno ao analisar a fatura." });
  }
}