export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método não permitido" });
  }
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "Assistente indisponível: chave Groq não configurada." });
  try {
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) return res.status(400).json({ error: "Escreva uma pergunta." });
    if (prompt.length > 4000) return res.status(413).json({ error: "A pergunta é demasiado longa (máximo 4000 caracteres)." });
    const systemInstruction = "És a assistente informativa da Wivolta, em Portugal, especializada em eletricidade, gás e eficiência energética. Responde sempre em português europeu, clara e prática. Não inventes tarifas, preços, datas de validade, condições, parcerias, fidelizações, cálculos, legislação ou dados ERSE. Se não tiveres dados comprovados e atualizados, diz isso explicitamente e encaminha para o simulador oficial ERSE (https://simuladorprecos.erse.pt/). Não afirmes que consegues mudar contratos, consultar contas, acompanhar preços automaticamente ou executar Auto-Switch: a Wivolta ainda não disponibiliza essas funções. Não solicites NIF, CPE, CUI, moradas, dados bancários nem faturas completas; se o utilizador partilhar dados pessoais, não os repitas e aconselha a removê-los. Não substituis aconselhamento oficial ou contrato do comercializador. Distingue estimativas de valores contratuais.";
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + apiKey },
      body: JSON.stringify({
        model: "openai/gpt-oss-20b",
        messages: [{ role: "system", content: systemInstruction }, { role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 900
      })
    });
    const raw = await response.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
    if (!response.ok) {
      const detail = String(data?.error?.message || "Sem detalhe").replace(/[\r\n]+/g, " ").slice(0, 180);
      console.error("Groq chat error", response.status, detail);
      return res.status(502).json({ error: response.status === 429 ? "A Groq atingiu temporariamente o limite de pedidos. Tente novamente mais tarde." : "A Groq não conseguiu responder neste momento.", diagnostic: "HTTP " + response.status + (detail ? " — " + detail : "") });
    }
    const reply = data?.choices?.[0]?.message?.content?.trim();
    if (!reply) return res.status(502).json({ error: "A IA não devolveu uma resposta. Tente reformular." });
    return res.status(200).json({ reply });
  } catch (error) {
    console.error("Groq chat internal error", String(error?.message || error).slice(0, 180));
    return res.status(500).json({ error: "Erro interno ao processar a pergunta." });
  }
}