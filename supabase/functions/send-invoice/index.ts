import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY") || "";
const BREVO_SENDER_EMAIL = Deno.env.get("BREVO_SENDER_EMAIL") || "";
const BREVO_SENDER_NAME = Deno.env.get("BREVO_SENDER_NAME") || "Hillareds skytteförening";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const isEmail = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // --- verify caller is an admin ---
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ ok: false, error: "Missing auth" }, 401);

  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) return json({ ok: false, error: "Invalid auth" }, 401);
  const callerId = userData.user.id;

  const { data: prof, error: profErr } = await admin
    .from("profiles").select("role").eq("id", callerId).maybeSingle();
  if (profErr) return json({ ok: false, error: "Role lookup failed: " + profErr.message }, 500);
  if (!prof || prof.role !== "admin") return json({ ok: false, error: "Forbidden" }, 403);

  // --- dispatch ---
  let payload: any;
  try { payload = await req.json(); } catch { return json({ ok: false, error: "Bad JSON" }, 400); }
  const action = payload?.action;

  try {
    if (action === "meta") {
      const { data, error } = await admin
        .from("skytt_faktura").select("skytt_id, email, faktura_skickad");
      if (error) throw error;
      return json({ ok: true, data: data ?? [] });
    }

    if (action === "saveEmail") {
      const skytt_id = (payload.skytt_id ?? "").trim();
      const email = (payload.email ?? "").trim();
      if (!skytt_id) return json({ ok: false, error: "Skytt saknas" }, 400);
      if (!isEmail(email)) return json({ ok: false, error: "Ogiltig e-post" }, 400);
      const { error } = await admin.from("skytt_faktura").upsert({ skytt_id, email });
      if (error) throw error;
      return json({ ok: true, data: { skytt_id, email } });
    }

    if (action === "send") {
      const skytt_id = (payload.skytt_id ?? "").trim();
      const email = (payload.email ?? "").trim();
      const subject = payload.subject ?? "";
      const text = payload.text ?? "";
      if (!skytt_id) return json({ ok: false, error: "Skytt saknas" }, 400);
      if (!isEmail(email)) return json({ ok: false, error: "Ogiltig e-post" }, 400);
      if (!BREVO_API_KEY) return json({ ok: false, error: "BREVO_API_KEY saknas" }, 500);
      if (!isEmail(BREVO_SENDER_EMAIL)) return json({ ok: false, error: "BREVO_SENDER_EMAIL saknas/ogiltig" }, 500);

      const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": BREVO_API_KEY, "content-type": "application/json", "accept": "application/json" },
        body: JSON.stringify({
          sender: { email: BREVO_SENDER_EMAIL, name: BREVO_SENDER_NAME },
          to: [{ email }],
          subject,
          textContent: text,
        }),
      });
      if (!resp.ok) {
        const detail = await resp.text();
        return json({ ok: false, error: "Brevo " + resp.status + ": " + detail }, 502);
      }
      const { error } = await admin.from("skytt_faktura")
        .upsert({ skytt_id, email, faktura_skickad: new Date().toISOString() });
      if (error) throw error;
      return json({ ok: true, data: { skytt_id, email } });
    }

    return json({ ok: false, error: "Okänd action" }, 400);
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
