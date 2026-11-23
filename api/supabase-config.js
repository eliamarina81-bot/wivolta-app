export default function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Método não permitido." });
  }

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Vary", "Accept");

  if (!url || !anonKey) {
    return res.status(503).json({
      configured: false,
      error: "A ligação ao Supabase ainda não está configurada no servidor."
    });
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(".supabase.co")) {
      return res.status(500).json({ configured: false, error: "O endereço Supabase configurado não é válido." });
    }
  } catch {
    return res.status(500).json({ configured: false, error: "O endereço Supabase configurado não é válido." });
  }

  return res.status(200).json({ configured: true, url, anonKey });
}
