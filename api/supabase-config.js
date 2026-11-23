export default function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Método não permitido." });
  }

  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Vary", "Accept");

  if (process.env.WIVOLTA_PORTAL_ENABLED !== "true") {
    return res.status(200).json({ configured: false, enabled: false });
  }

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return res.status(503).json({
      configured: false,
      enabled: true,
      error: "Falta configurar o endereço e a chave pública do Supabase no servidor."
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

  return res.status(200).json({ configured: true, enabled: true, url, anonKey });
}
