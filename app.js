import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const cfg = window.NOTES_CONFIG || {};
const BUCKET = "note-images";
const COLORS = ["pink", "peach", "butter", "mint", "sky", "lavender"];
const MAX_IMAGES = 6;

const configured =
  cfg.SUPABASE_URL &&
  cfg.SUPABASE_ANON_KEY &&
  !/YOUR[-_]/i.test(cfg.SUPABASE_URL + cfg.SUPABASE_ANON_KEY);
const sb = configured ? createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

/* ------------------------------------------------------------------ helpers */

const $ = (sel, root = document) => root.querySelector(sel);

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null) continue;
    if (k === "class") e.className = v;
    else if (k === "dataset") Object.assign(e.dataset, v);
    else if (k === "html") e.innerHTML = v; // only used with static icon strings
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k in e && k !== "list") e[k] = v;
    else e.setAttribute(k, v);
  }
  e.append(...kids.flat().filter((x) => x !== null && x !== undefined && x !== false));
  return e;
}

const ICON_X =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

const hasPopover = typeof HTMLElement.prototype.showPopover === "function";
let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  if (hasPopover) {
    try { if (!t.matches(":popover-open")) t.showPopover(); } catch { /* ignore */ }
  } else {
    t.hidden = false;
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    if (hasPopover) { try { t.hidePopover(); } catch { /* ignore */ } } else t.hidden = true;
  }, 3200);
}

function relTime(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 172800) return "yesterday";
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

const newItem = (text = "", done = false) => ({ id: crypto.randomUUID(), text, done });
const isIOS =
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone =
  window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

/* -------------------------------------------------------------------- state */

const state = {
  me: null,
  profiles: {},
  notes: new Map(),
  filter: "all",
  q: "",
  seen: {},
  urls: new Map(), // storage path -> { url, exp }
  channel: null,
  pushOn: false,
  renderQueued: false,
};

const nameOf = (id) =>
  id === state.me?.id ? "You" : state.profiles[id]?.name || "Them";

const partnerProfile = () =>
  Object.values(state.profiles).find((p) => p.id !== state.me?.id);

/* ---------------------------------------------------------------- data load */

async function loadProfiles() {
  const { data, error } = await sb.from("profiles").select("id,name");
  if (error) { console.error(error); return; }
  state.profiles = Object.fromEntries(data.map((p) => [p.id, p]));
}

async function loadNotes() {
  const { data, error } = await sb.from("notes").select("*").order("updated_at", { ascending: false });
  if (error) { console.error(error); toast("Couldn't load notes. Check your connection."); return false; }
  state.notes = new Map(data.map((n) => [n.id, n]));
  return true;
}

/* ------------------------------------------------------------- unread logic */

const seenKey = () => `seen:${state.me.id}`;
function loadSeen() {
  try {
    const raw = localStorage.getItem(seenKey());
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function saveSeen() {
  try { localStorage.setItem(seenKey(), JSON.stringify(state.seen)); } catch { /* ignore */ }
}
function seedSeenIfFirstRun() {
  const stored = loadSeen();
  if (stored) { state.seen = stored; return; }
  // first time on this device: don't flag everything as new
  state.seen = Object.fromEntries([...state.notes.values()].map((n) => [n.id, n.updated_at]));
  saveSeen();
}
const isUnread = (n) =>
  n.updated_by !== state.me.id &&
  (!state.seen[n.id] || new Date(n.updated_at) > new Date(state.seen[n.id]));
function markSeen(n) {
  state.seen[n.id] = n.updated_at;
  saveSeen();
  updateBadge();
  scheduleRender(); // drops the "new" tag right away
}
function unreadCount() {
  let c = 0;
  for (const n of state.notes.values()) if (isUnread(n)) c++;
  return c;
}
function updateBadge() {
  const c = unreadCount();
  document.title = c ? `(${c}) Our Notes` : "Our Notes";
  try {
    if (c) navigator.setAppBadge?.(c);
    else navigator.clearAppBadge?.();
  } catch { /* ignore */ }
}

/* ---------------------------------------------------------------- rendering */

const haystack = (n) =>
  [n.title, n.body, ...(n.items || []).map((i) => i.text)].join(" ").toLowerCase();

function visibleNotes() {
  let arr = [...state.notes.values()];
  if (state.filter === "mine") arr = arr.filter((n) => n.author_id === state.me.id);
  if (state.filter === "theirs") arr = arr.filter((n) => n.author_id !== state.me.id);
  const q = state.q.trim().toLowerCase();
  if (q) arr = arr.filter((n) => haystack(n).includes(q));
  arr.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  return arr;
}

function scheduleRender() {
  if (state.renderQueued) return;
  state.renderQueued = true;
  requestAnimationFrame(() => { state.renderQueued = false; render(); });
}

function render() {
  if (!state.me) return;
  const list = visibleNotes();
  const board = $("#board");
  board.replaceChildren(...list.map(card));

  const empty = $("#empty");
  empty.hidden = list.length > 0;
  $("#emptyText").textContent = state.notes.size === 0
    ? "No notes yet. Write the first one."
    : "Nothing matches that.";

  const partner = partnerProfile();
  $("#chipTheirs").textContent = partner ? partner.name : "Theirs";
  document.querySelectorAll("#chips .chip").forEach((c) =>
    c.classList.toggle("on", c.dataset.f === state.filter)
  );

  const myName = state.profiles[state.me.id]?.name || "";
  $("#meName").textContent = myName;
  $("#meAv").textContent = (myName[0] || "?").toUpperCase();

  hydrateImages(board);
  updateBadge();
}

function card(n) {
  const c = el("article", {
    class: "note",
    dataset: { id: n.id, color: n.color },
    tabindex: "0",
    role: "button",
    "aria-label": `Open note ${n.title || ""}`.trim(),
    onclick: () => openEditor(n),
    onkeydown: (e) => { if (e.key === "Enter" && e.target === c) openEditor(n); },
  });

  if (isUnread(n)) c.append(el("span", { class: "pill" }, "new"));

  const imgs = n.images || [];
  if (imgs.length) {
    const shown = imgs.slice(0, 4);
    const grid = el("div", { class: `pics n${shown.length}` });
    shown.forEach((p, i) => {
      const img = el("img", { alt: "", loading: "lazy", dataset: { path: p } });
      if (i === 3 && imgs.length > 4) {
        grid.append(el("div", { class: "plus", dataset: { more: `+${imgs.length - 3}` } }, img));
      } else grid.append(img);
    });
    c.append(grid);
  }

  if (n.title) c.append(el("h3", {}, n.title));

  if (n.kind === "list") {
    const items = n.items || [];
    const ul = el("ul", { class: "chk" });
    items.slice(0, 7).forEach((it) => {
      const cb = el("input", {
        type: "checkbox",
        checked: !!it.done,
        "aria-label": it.text,
        onclick: (e) => e.stopPropagation(),
        onchange: () => toggleItem(n.id, it.id, cb.checked),
      });
      ul.append(el("li", { class: it.done ? "done" : "" }, cb, el("span", {}, it.text)));
    });
    c.append(ul);
    if (items.length > 7) c.append(el("div", { class: "more" }, `+${items.length - 7} more`));
  } else if (n.body) {
    c.append(el("p", { class: "txt-body" }, n.body));
  }

  c.append(
    el("div", { class: "meta" },
      el("span", {}, nameOf(n.author_id)),
      el("span", { dataset: { time: n.updated_at } }, relTime(n.updated_at))
    )
  );
  return c;
}

async function toggleItem(noteId, itemId, done) {
  const n = state.notes.get(noteId);
  if (!n) return;
  const items = n.items.map((i) => (i.id === itemId ? { ...i, done } : i));
  const { data, error } = await sb
    .from("notes")
    .update({ items, updated_by: state.me.id })
    .eq("id", noteId)
    .select()
    .single();
  if (error) { toast("Couldn't update that item"); await loadNotes(); render(); return; }
  state.notes.set(noteId, data);
  markSeen(data);
  scheduleRender();
}

/* ------------------------------------------------------------------- images */

async function hydrateImages(root) {
  const imgs = [...root.querySelectorAll("img[data-path]")];
  const now = Date.now();
  const need = [...new Set(
    imgs.map((i) => i.dataset.path).filter((p) => {
      const c = state.urls.get(p);
      return !c || c.exp < now;
    })
  )];
  if (need.length) {
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(need, 3600);
    if (error) { console.error(error); }
    (data || []).forEach((d) => {
      if (d.signedUrl) state.urls.set(d.path, { url: d.signedUrl, exp: now + 3500 * 1000 });
    });
  }
  imgs.forEach((i) => {
    const c = state.urls.get(i.dataset.path);
    if (c && i.src !== c.url) i.src = c.url;
  });
}

async function compress(file, max = 1600, quality = 0.82) {
  let bmp;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    bmp = await new Promise((res, rej) => {
      const url = URL.createObjectURL(file);
      const im = new Image();
      im.onload = () => { URL.revokeObjectURL(url); res(im); };
      im.onerror = rej;
      im.src = url;
    });
  }
  const w0 = bmp.width || bmp.naturalWidth;
  const h0 = bmp.height || bmp.naturalHeight;
  const scale = Math.min(1, max / Math.max(w0, h0));
  const w = Math.round(w0 * scale);
  const h = Math.round(h0 * scale);
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const blob = await new Promise((r) => cv.toBlob(r, "image/jpeg", quality));
  if (!blob) throw new Error("encode failed");
  return blob;
}

/* ------------------------------------------------------------------- editor */

const dlg = $("#editor");
let ed = null;

function openEditor(n) {
  ed = n
    ? {
        id: n.id,
        kind: n.kind,
        items: (n.items || []).map((i) => ({ ...i })),
        color: n.color,
        images: (n.images || []).map((p) => ({ path: p })),
        orig: [...(n.images || [])],
      }
    : { id: null, kind: "text", items: [], color: lastColor(), images: [], orig: [] };

  $("#edTitle").value = n ? n.title : "";
  $("#edBody").value = n && n.kind === "text" ? n.body : "";
  if (ed.kind === "list" && !ed.items.length) ed.items.push(newItem());
  $("#edDelete").hidden = !n;
  $("#edSave").disabled = false;
  syncKindUI();
  renderEdList();
  renderThumbs();
  renderSwatches();
  applyColor();
  document.body.classList.add("lock");
  dlg.showModal();
  growBody();
  if (n) markSeen(n);
  else $("#edTitle").focus();
}

function lastColor() {
  try {
    const c = localStorage.getItem("lastColor");
    if (COLORS.includes(c)) return c;
  } catch { /* ignore */ }
  return COLORS[Math.floor(Math.random() * COLORS.length)];
}

function closeEditor() {
  if (dlg.open) dlg.close();
}
dlg.addEventListener("close", () => {
  document.body.classList.remove("lock");
  ed?.images.forEach((i) => i.preview && URL.revokeObjectURL(i.preview));
  ed = null;
});

function growBody() {
  const ta = $("#edBody");
  ta.style.height = "auto";
  ta.style.height = Math.min(Math.max(ta.scrollHeight, 130), 380) + "px";
}
$("#edBody").addEventListener("input", growBody);

function syncKindUI() {
  const list = ed.kind === "list";
  $("#edBody").hidden = list;
  $("#edList").hidden = !list;
  document.querySelectorAll(".seg button").forEach((b) =>
    b.classList.toggle("on", b.dataset.kind === ed.kind)
  );
}

function setKind(k) {
  if (!ed || k === ed.kind) return;
  if (k === "list") {
    const lines = $("#edBody").value.split("\n").map((s) => s.trim()).filter(Boolean);
    ed.items = lines.length ? lines.map((t) => newItem(t)) : [newItem()];
  } else {
    $("#edBody").value = ed.items.map((i) => i.text.trim()).filter(Boolean).join("\n");
  }
  ed.kind = k;
  syncKindUI();
  renderEdList();
  growBody();
}
document.querySelectorAll(".seg button").forEach((b) =>
  b.addEventListener("click", () => setKind(b.dataset.kind))
);

function focusItem(i) {
  const inputs = $("#edList").querySelectorAll('input[type="text"]');
  inputs[Math.max(0, Math.min(i, inputs.length - 1))]?.focus();
}

function renderEdList() {
  const wrap = $("#edList");
  wrap.replaceChildren();
  if (!ed || ed.kind !== "list") return;
  ed.items.forEach((it, i) => {
    const cb = el("input", {
      type: "checkbox",
      checked: !!it.done,
      "aria-label": "Done",
      onchange: () => { it.done = cb.checked; row.classList.toggle("done", it.done); },
    });
    const inp = el("input", {
      type: "text",
      value: it.text,
      placeholder: "List item",
      maxLength: 200,
      oninput: () => { it.text = inp.value; },
      onkeydown: (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          ed.items.splice(i + 1, 0, newItem());
          renderEdList();
          focusItem(i + 1);
        } else if (e.key === "Backspace" && !inp.value) {
          e.preventDefault();
          ed.items.splice(i, 1);
          if (!ed.items.length) ed.items.push(newItem());
          renderEdList();
          focusItem(i - 1);
        }
      },
    });
    const rm = el("button", {
      type: "button", class: "rm", "aria-label": "Remove item", html: ICON_X,
      onclick: () => {
        ed.items.splice(i, 1);
        if (!ed.items.length) ed.items.push(newItem());
        renderEdList();
      },
    });
    const row = el("div", { class: "li" + (it.done ? " done" : "") }, cb, inp, rm);
    wrap.append(row);
  });
  wrap.append(
    el("button", {
      type: "button", class: "add-item",
      onclick: () => { ed.items.push(newItem()); renderEdList(); focusItem(ed.items.length - 1); },
    }, "+ Add item")
  );
}

function renderThumbs() {
  const wrap = $("#edImages");
  wrap.replaceChildren();
  ed.images.forEach((im, i) => {
    const img = el("img", {
      alt: "Attached photo",
      dataset: im.path ? { path: im.path } : {},
      src: im.preview || "",
      onclick: () => { if (img.src) openLightbox(img.src); },
    });
    wrap.append(
      el("div", { class: "thumb" },
        img,
        el("button", {
          type: "button", class: "x", "aria-label": "Remove photo", html: ICON_X,
          onclick: () => {
            const [gone] = ed.images.splice(i, 1);
            if (gone.preview) URL.revokeObjectURL(gone.preview);
            renderThumbs();
          },
        })
      )
    );
  });
  hydrateImages(wrap);
}

$("#edFile").addEventListener("change", async (e) => {
  const files = [...e.target.files];
  e.target.value = "";
  for (const f of files) {
    if (!ed) return;
    if (ed.images.length >= MAX_IMAGES) { toast(`Up to ${MAX_IMAGES} photos per note`); break; }
    try {
      const blob = await compress(f);
      if (!ed) return;
      ed.images.push({ blob, preview: URL.createObjectURL(blob) });
      renderThumbs();
    } catch (err) {
      console.error(err);
      toast("Couldn't read that photo");
    }
  }
});

function renderSwatches() {
  const wrap = $("#edColors");
  wrap.replaceChildren(
    ...COLORS.map((c) =>
      el("button", {
        type: "button", class: "swatch", role: "radio",
        dataset: { color: c },
        "aria-label": c,
        "aria-checked": String(ed.color === c),
        onclick: () => { ed.color = c; applyColor(); renderSwatches(); },
      })
    )
  );
}
function applyColor() {
  dlg.dataset.color = ed.color;
}

function openLightbox(src) {
  const lb = $("#lightbox");
  $("img", lb).src = src;
  lb.showModal();
}
$("#lightbox").addEventListener("click", () => $("#lightbox").close());

$("#edCancel").addEventListener("click", closeEditor);

$("#editorForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!ed) return;

  const title = $("#edTitle").value.trim();
  const body = $("#edBody").value.trim();
  const items = ed.items
    .map((i) => ({ id: i.id, text: i.text.trim(), done: !!i.done }))
    .filter((i) => i.text);
  const empty = !title && !ed.images.length && (ed.kind === "list" ? !items.length : !body);
  if (empty) { toast("Add something first"); return; }

  const saveBtn = $("#edSave");
  saveBtn.disabled = true;
  saveBtn.textContent = "Saving...";
  const uploaded = [];
  try {
    const paths = [];
    for (const im of ed.images) {
      if (im.path) { paths.push(im.path); continue; }
      const path = `${state.me.id}/${crypto.randomUUID()}.jpg`;
      const { error } = await sb.storage.from(BUCKET).upload(path, im.blob, {
        contentType: "image/jpeg",
        cacheControl: "3600",
      });
      if (error) throw error;
      uploaded.push(path);
      paths.push(path);
    }

    const row = {
      title,
      kind: ed.kind,
      body: ed.kind === "text" ? body : "",
      items: ed.kind === "list" ? items : [],
      color: ed.color,
      images: paths,
      updated_by: state.me.id,
    };

    let res;
    if (ed.id) {
      res = await sb.from("notes").update(row).eq("id", ed.id).select().single();
    } else {
      res = await sb.from("notes").insert({ ...row, author_id: state.me.id }).select().single();
    }
    if (res.error) throw res.error;

    const removed = ed.orig.filter((p) => !paths.includes(p));
    if (removed.length) sb.storage.from(BUCKET).remove(removed);

    try { localStorage.setItem("lastColor", ed.color); } catch { /* ignore */ }
    state.notes.set(res.data.id, res.data);
    markSeen(res.data);
    closeEditor();
    scheduleRender();
  } catch (err) {
    console.error(err);
    if (uploaded.length) sb.storage.from(BUCKET).remove(uploaded);
    toast(err?.code === "PGRST116" ? "That note was deleted, so it couldn't be saved." : "Couldn't save. Try again.");
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Save";
  }
});

$("#edDelete").addEventListener("click", async () => {
  if (!ed?.id) return;
  if (!confirm("Delete this note for both of you?")) return;
  const id = ed.id;
  const paths = ed.orig;
  const { error } = await sb.from("notes").delete().eq("id", id);
  if (error) { toast("Couldn't delete. Try again."); return; }
  if (paths.length) sb.storage.from(BUCKET).remove(paths);
  state.notes.delete(id);
  closeEditor();
  scheduleRender();
});

$("#fab").addEventListener("click", () => openEditor(null));

/* ---------------------------------------------------------------- realtime */

const sig = (n) =>
  JSON.stringify([n.title, n.kind, n.body, (n.items || []).map((i) => i.text), n.images]);

function snippet(n) {
  if (n.title) return n.title;
  if (n.kind === "list") return (n.items || []).map((i) => i.text).filter(Boolean).slice(0, 2).join(", ");
  return (n.body || "").split("\n")[0].slice(0, 40) || "a photo";
}

function onNoteChange(p) {
  if (p.eventType === "DELETE") {
    state.notes.delete(p.old.id);
  } else {
    const n = p.new;
    const prev = state.notes.get(n.id);
    state.notes.set(n.id, n);
    if (n.updated_by !== state.me.id && (!prev || sig(prev) !== sig(n))) {
      toast(`${nameOf(n.updated_by)} ${prev ? "updated" : "added"} "${snippet(n)}"`);
    }
  }
  scheduleRender();
}

function subscribe() {
  if (state.channel) sb.removeChannel(state.channel);
  state.channel = sb
    .channel("notes-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "notes" }, onNoteChange)
    .subscribe();
}

async function refreshAll() {
  if (!state.me) return;
  await loadProfiles();
  if (await loadNotes()) scheduleRender();
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refreshAll();
});
setInterval(() => {
  document.querySelectorAll("[data-time]").forEach((s) => { s.textContent = relTime(s.dataset.time); });
}, 60000);

/* --------------------------------------------------------- push notifications */

const swSupported = "serviceWorker" in navigator;
const canShowBell =
  !!cfg.VAPID_PUBLIC_KEY && swSupported && ("PushManager" in window || (isIOS && !isStandalone));

function b64ToU8(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function refreshBell() {
  const b = $("#btnBell");
  if (!canShowBell) { b.hidden = true; return; }
  b.hidden = false;
  let on = false;
  try {
    if ("PushManager" in window && typeof Notification !== "undefined" && Notification.permission === "granted") {
      const reg = await navigator.serviceWorker.ready;
      on = !!(await reg.pushManager.getSubscription());
    }
  } catch { /* ignore */ }
  state.pushOn = on;
  b.classList.toggle("on", on);
  b.title = on ? "Notifications are on (tap to turn off)" : "Turn on notifications";
}

async function enablePush() {
  if (!("PushManager" in window)) {
    toast("On iPhone: tap Share, Add to Home Screen, then open Our Notes from there.");
    return;
  }
  const perm = await Notification.requestPermission();
  if (perm !== "granted") { toast("Notifications are blocked in your browser settings."); return; }
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: b64ToU8(cfg.VAPID_PUBLIC_KEY),
    });
  }
  const j = sub.toJSON();
  const { error } = await sb.from("push_subscriptions").upsert(
    { user_id: state.me.id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth },
    { onConflict: "endpoint" }
  );
  if (error) { console.error(error); toast("Couldn't turn on notifications."); return; }
  toast("Notifications on");
}

async function disablePush() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    await sb.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
    await sub.unsubscribe();
  }
  toast("Notifications off");
}

$("#btnBell").addEventListener("click", async () => {
  try {
    if (state.pushOn) await disablePush();
    else await enablePush();
  } catch (err) {
    console.error(err);
    toast("Something went wrong with notifications.");
  }
  refreshBell();
});

/* ------------------------------------------------------------ name + filters */

const nameDlg = $("#nameDialog");
function askName(required) {
  return new Promise((resolve) => {
    $("#nameInput").value = state.profiles[state.me.id]?.name || "";
    $("#nameCancel").hidden = !!required;
    nameDlg.showModal();
    const done = () => { nameDlg.removeEventListener("close", done); resolve(); };
    nameDlg.addEventListener("close", done);
  });
}
nameDlg.addEventListener("cancel", (e) => {
  if ($("#nameCancel").hidden) e.preventDefault(); // can't skip the first time
});
$("#nameCancel").addEventListener("click", () => nameDlg.close());
$("#nameForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("#nameInput").value.trim();
  if (!name) return;
  const { error } = await sb.from("profiles").upsert({ id: state.me.id, name });
  if (error) { console.error(error); toast("Couldn't save your name."); return; }
  state.profiles[state.me.id] = { id: state.me.id, name };
  nameDlg.close();
  scheduleRender();
});
$("#btnMe").addEventListener("click", () => askName(false));

document.querySelectorAll("#chips .chip").forEach((c) =>
  c.addEventListener("click", () => { state.filter = c.dataset.f; scheduleRender(); })
);
$("#search").addEventListener("input", (e) => { state.q = e.target.value; scheduleRender(); });

/* ------------------------------------------------------------- auth + start */

function showAuth() {
  state.me = null;
  state.notes = new Map();
  if (state.channel) { sb.removeChannel(state.channel); state.channel = null; }
  $("#app").hidden = true;
  $("#auth").hidden = false;
  try { navigator.clearAppBadge?.(); } catch { /* ignore */ }
  document.title = "Our Notes";
}

async function boot(user) {
  state.me = user;
  $("#auth").hidden = true;
  $("#app").hidden = false;

  await loadProfiles();
  if (!state.profiles[user.id]) await askName(true);
  await loadNotes();
  seedSeenIfFirstRun();
  render();
  subscribe();
  refreshBell();
}

$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("#loginBtn");
  const err = $("#loginErr");
  err.textContent = "";
  btn.disabled = true;
  btn.textContent = "Logging in...";
  const { data, error } = await sb.auth.signInWithPassword({
    email: $("#email").value.trim(),
    password: $("#password").value,
  });
  btn.disabled = false;
  btn.textContent = "Log in";
  if (error) { err.textContent = "That email or password didn't work."; return; }
  $("#password").value = "";
  await boot(data.user);
});

$("#btnOut").addEventListener("click", async () => {
  if (state.pushOn) { try { await disablePush(); } catch { /* ignore */ } }
  await sb.auth.signOut();
  showAuth();
});

async function start() {
  if (!configured) { $("#setup").hidden = false; return; }

  if (swSupported) {
    navigator.serviceWorker.register("sw.js").catch((err) => console.warn("SW failed", err));
  }

  sb.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT" && state.me) showAuth();
  });

  const { data } = await sb.auth.getSession();
  if (data.session) await boot(data.session.user);
  else showAuth();
}

start();
