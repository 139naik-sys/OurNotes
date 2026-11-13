// Sends a push notification to the *other* person when a note is added or edited.
// Triggered by a Database Webhook on public.notes (INSERT + UPDATE). See README step 6.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT")!,
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

// What counts as a "real" edit: ticking a checklist box or changing the colour shouldn't ping anyone.
const sig = (r: any) =>
  JSON.stringify([r.title, r.kind, r.body, (r.items || []).map((i: any) => i.text), r.images]);

function preview(r: any): string {
  if ((r.title || "").trim()) return r.title.trim();
  if (r.kind === "list") {
    const t = (r.items || []).map((i: any) => i.text).filter(Boolean).slice(0, 3).join(", ");
    if (t) return t;
  }
  const b = (r.body || "").trim();
  if (b) return b;
  return (r.images || []).length ? "Sent a photo" : "New note";
}

Deno.serve(async (req) => {
  if (req.headers.get("x-webhook-secret") !== Deno.env.get("WEBHOOK_SECRET")) {
    return new Response("forbidden", { status: 403 });
  }

  const { type, record, old_record } = await req.json();
  if (type !== "INSERT" && type !== "UPDATE") return new Response("ignored");
  if (type === "UPDATE" && old_record && sig(old_record) === sig(record)) {
    return new Response("no visible change");
  }

  const editor = record.updated_by;
  const { data: prof } = await admin.from("profiles").select("name").eq("id", editor).maybeSingle();
  const who = prof?.name || "Your person";

  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("endpoint,p256dh,auth")
    .neq("user_id", editor);

  const body = preview(record);
  const payload = JSON.stringify({
    title: `${who} ${type === "INSERT" ? "added a note" : "updated a note"}`,
    body: body.length > 120 ? body.slice(0, 117) + "..." : body,
    tag: `note-${record.id}`,
    url: "./",
  });

  const results = await Promise.allSettled(
    (subs || []).map((s) =>
      webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
      ).catch(async (err: any) => {
        // subscription is gone (uninstalled / permission revoked): clean it up
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await admin.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
        }
        throw err;
      })
    ),
  );

  const sent = results.filter((r) => r.status === "fulfilled").length;
  return new Response(JSON.stringify({ sent, total: results.length }), {
    headers: { "content-type": "application/json" },
  });
});
