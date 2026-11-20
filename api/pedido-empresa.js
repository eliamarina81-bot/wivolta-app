export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método não permitido." });
  }
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.WIVOLTA_FROM_EMAIL;
  if (!apiKey || !from) {
    return res.status(503).json({ error: "O envio de email ainda não está configurado no servidor." });
  }
  try {
    let body = req.body;
    if (typeof body === "string") body = JSON.parse(body);
    if (!body || !body.client || !body.file || !body.file.data) {
      return res.status(400).json({ error: "Pedido ou fatura em falta." });
    }
    const raw = String(body.file.data);
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw) || raw.length > 5_500_000) {
      return res.status(413).json({ error: "Ficheiro inválido ou demasiado grande (máximo 4 MB)." });
    }
    const allowed = ["application/pdf", "image/jpeg", "image/png"];
    if (!allowed.includes(body.file.type)) {
      return res.status(415).json({ error: "Formato não suportado. Use PDF, JPG ou PNG." });
    }
    const attachment = {
      filename: String(body.file.name || "fatura").replace(/[^\w.() -]/g, "_").slice(0, 100),
      content: raw
    };
    const fields = body.client;
    const safe = (v) => String(v || "Não indicado").slice(0, 500);
    const text = [
      "Novo pedido de análise empresarial — Wivolta",
      "",
      "Nome/empresa: " + safe(fields.name),
      "Telefone: " + safe(fields.phone),
      "Email: " + safe(fields.email),
      "NIF/NIPC: " + safe(fields.nif),
      "Serviço: " + safe(fields.service),
      "Comercializador atual: " + safe(fields.supplier),
      "CPE: " + safe(fields.cpe),
      "CUI: " + safe(fields.cui),
      "Potência: " + safe(fields.power),
      "Observações: " + safe(fields.notes),
      "",
      "A fatura foi anexada pelo cliente ao pedido."
    ].join("\n");
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: ["wivolta.parceiros@gmail.com"],
        subject: "Pedido empresarial Wivolta — " + safe(fields.name),
        text,
        attachments: [attachment]
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error("Resend error", response.status, result);
      return res.status(502).json({ error: "Não foi possível enviar o pedido. Tente novamente mais tarde." });
    }
    return res.status(200).json({ ok: true, id: result.id });
  } catch (error) {
    console.error("Company request error", error);
    return res.status(500).json({ error: "Erro ao preparar o pedido." });
  }
}
