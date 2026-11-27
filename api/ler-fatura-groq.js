export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "Método não permitido." }); }
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(503).json({ error: "A análise Groq não está configurada neste ambiente." });
  try {
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    const images = Array.isArray(body?.images) ? body.images.slice(0, 5) : [];
    if (!text && !images.length) return res.status(400).json({ error: "Não foi recebido texto nem imagem da fatura." });
    if (text.length > 14000) return res.status(413).json({ error: "Texto demasiado extenso para análise." });
    const safeImages = [];
    for (const image of images) {
      if (typeof image !== "string" || !/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(image)) continue;
      if (image.length > 1300000) return res.status(413).json({ error: "Uma página da fatura ficou demasiado grande. Reduza a resolução e tente novamente." });
      safeImages.push(image);
    }
    const instructions = `Analisa uma fatura de eletricidade e/ou gás em Portugal. Recebes texto extraído e/ou imagens das páginas. Lê visualmente tabelas, cabeçalhos e colunas quando existirem imagens.
Devolve APENAS JSON válido com estas chaves:
{"fornecedor":"","potencia":"","tarifa":"simples|bi-horário|tri-horário|por confirmar","simples":"","fora":"","vazio":"","cheias":"","ponta":"","gas":"","preco_energia":"","termo_fixo_dia":"","periodo_fatura":"","confianca":"alta|media|baixa","observacoes":""}
Regras:
- Extrai apenas valores efetivamente visíveis. Na dúvida, deixa vazio.
- Associa kWh às colunas pelos cabeçalhos. "Vazio Ponta Cheias" e "Total de consumos kWh 56 24 60" significa vazio=56, ponta=24, cheias=60.
- Em faturas Galp, as quantidades "Energia Simples (medida)" repetem-se em Comercialização e Tarifas de Acesso. Conta apenas Comercialização; nunca somes a repetição em Tarifas de Acesso. ISPE repete o total e não é consumo adicional. Exemplo: 200+171=371 kWh.
- Não confundas kWh com kVA, euros, dias ou leituras do contador.
- Bi-horário: distingue fora de vazio e vazio. Não inventes nem calcules diferenças.
- Gás: extrai kWh. Se só houver m3, deixa gas vazio e explica.
- Não calcules, arredondes, adivinhes nem convertas unidades.
- Não devolvas nomes, moradas, NIF, CPE, CUI, telefone, email ou outros dados pessoais.
- Se houver contradições, deixa vazio e explica em observações.`;
    const userContent = [{ type: "text", text: "Analisa esta fatura. O texto seguinte foi filtrado automaticamente e pode estar incompleto:\n" + text }];
    for (const image of safeImages) userContent.push({ type: "image_url", image_url: { url: image } });
    const model = safeImages.length ? "meta-llama/llama-4-scout-17b-16e-instruct" : "openai/gpt-oss-20b";
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST", headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "system", content: instructions }, { role: "user", content: safeImages.length ? userContent : userContent[0].text }], temperature: 0.1, max_tokens: 1400 })
    });
    const raw = await response.text();
    let data = {}; try { data = raw ? JSON.parse(raw) : {}; } catch {}
    if (!response.ok) {
      console.error("Groq invoice extraction error", response.status, String(data?.error?.message || "sem detalhe").slice(0, 1200));
      const status = response.status === 429 ? 429 : response.status === 401 || response.status === 403 ? 503 : 502;
      return res.status(status).json({ error: response.status === 429 ? "O limite de utilização da análise IA foi atingido." : "A análise visual Groq está temporariamente indisponível. Confirme os campos manualmente." });
    }
    const answer = data?.choices?.[0]?.message?.content || "";
    let extracted;
    try { extracted = JSON.parse(answer.replace(/^\`\`\`(?:json)?\s*/i, "").replace(/\s*\`\`\`$/, "").trim()); } catch { extracted = null; }
    if (!extracted || typeof extracted !== "object" || Array.isArray(extracted)) return res.status(502).json({ error: "A análise IA devolveu um formato inválido. Confirme os campos manualmente." });
    const allowed = ["fornecedor","potencia","tarifa","simples","fora","vazio","cheias","ponta","gas","preco_energia","termo_fixo_dia","periodo_fatura","confianca","observacoes"];
    const result = {}; for (const key of allowed) result[key] = typeof extracted[key] === "string" ? extracted[key].slice(0, 300) : "";
    return res.status(200).json({ extracted: result, mode: safeImages.length ? "vision" : "text" });
  } catch (error) {
    console.error("Groq invoice extraction failed", error?.message || "unknown");
    return res.status(500).json({ error: "Erro interno ao analisar a fatura." });
  }
}