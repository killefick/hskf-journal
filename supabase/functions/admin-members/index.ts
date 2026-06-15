import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const VALID_ROLES = new Set(["admin", "member", "revisor"]);
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
    if (action === "list") {
      const { data: list, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
      if (error) throw error;
      const { data: profs, error: pErr } = await admin.from("profiles").select("id, full_name, role");
      if (pErr) throw pErr;
      const byId = new Map((profs ?? []).map((p: any) => [p.id, p]));
      const members = list.users.map((u: any) => ({
        id: u.id,
        email: u.email,
        full_name: byId.get(u.id)?.full_name ?? "",
        role: byId.get(u.id)?.role ?? "member",
      }));
      return json({ ok: true, data: members });
    }

    if (action === "create") {
      const { email, full_name, role, redirectTo } = payload;
      if (!isEmail(email)) return json({ ok: false, error: "Ogiltig e-post" }, 400);
      if (!VALID_ROLES.has(role)) return json({ ok: false, error: "Ogiltig roll" }, 400);

      const { data: invited, error } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo,
        data: { full_name: full_name ?? "" },
      });
      if (error) throw error;
      const id = invited.user.id;
      const { error: upErr } = await admin.from("profiles").upsert({ id, full_name: full_name ?? "", role });
      if (upErr) throw upErr;
      return json({ ok: true, data: { id, email, full_name: full_name ?? "", role } });
    }

    if (action === "setRole") {
      const { id, role } = payload;
      if (!id) return json({ ok: false, error: "id saknas" }, 400);
      if (!VALID_ROLES.has(role)) return json({ ok: false, error: "Ogiltig roll" }, 400);
      const { error } = await admin.from("profiles").upsert({ id, role });
      if (error) throw error;
      return json({ ok: true, data: { id, role } });
    }

    if (action === "update") {
      const { id, full_name, email } = payload;
      if (!id) return json({ ok: false, error: "id saknas" }, 400);
      if (!isEmail(email)) return json({ ok: false, error: "Ogiltig e-post" }, 400);
      const newName = (full_name ?? "").trim();

      // Only call the auth API when the email actually changed.
      const { data: cur, error: getErr } = await admin.auth.admin.getUserById(id);
      if (getErr) throw getErr;
      if (cur.user?.email !== email) {
        const { error: emErr } = await admin.auth.admin.updateUserById(id, { email, email_confirm: true });
        if (emErr) throw emErr;
      }

      // Names are referenced by id everywhere (journal + faktura resolve through
      // member_directory), so a rename is a single profile update — no propagation.
      const { error: upErr } = await admin.from("profiles").upsert({ id, full_name: newName });
      if (upErr) throw upErr;

      return json({ ok: true, data: { id, email, full_name: newName } });
    }

    if (action === "delete") {
      const { id } = payload;
      if (!id) return json({ ok: false, error: "id saknas" }, 400);
      if (id === callerId) return json({ ok: false, error: "Du kan inte ta bort ditt eget konto" }, 400);
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) throw error;
      await admin.from("profiles").delete().eq("id", id);
      return json({ ok: true, data: { id } });
    }

    return json({ ok: false, error: "Okänd action" }, 400);
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
