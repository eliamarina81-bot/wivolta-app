export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY não configurada no servidor' });
  }

  try {
    const { prompt, context } = req.body || {};
    if (!prompt) {
      return res.status(400).json({ error: 'Falta a pergunta ou texto do utilizador' });
    }

    const systemInstruction =
      'És o assistente virtual oficial da Wivolta em Portugal. Ajuda os utilizadores a comparar tarifas de eletricidade e gás, compreender faturas e poupar energia. Responde em português de Portugal de forma clara, honesta e sem inventar preços ou parcerias não confirmadas.';

    const fullPrompt = context
      ? `Contexto da página/fatura:\n${context}\n\nPergunta do utilizador:\n${prompt}`
      : prompt;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: systemInstruction }]
          },
          contents: [
            {
              role: 'user',
              parts: [{ text: fullPrompt }]
            }
          ]
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.error?.message || 'Erro ao comunicar com a API Gemini'
      });
    }

    const reply =
      data.candidates?.[0]?.content?.parts?.[0]?.text ||
      'Não foi possível gerar uma resposta neste momento.';

    return res.status(200).json({ reply });
  } catch (err) {
    return res.status(500).json({ error: 'Erro interno no servidor Wivolta' });
  }
}

