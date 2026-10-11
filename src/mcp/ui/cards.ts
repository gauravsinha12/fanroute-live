import { APP_SDK } from "./app-sdk.generated";

// MCP Apps views (SEP-1865) for Echo Show-sized screens. Each is a single
// self-contained HTML document: the MCP Apps SDK is inlined, the view receives
// the tool result from the host over postMessage and renders it. Text sizes
// are chosen to be readable from across a kitchen.

const BASE_CSS = `
:root{--bg:#101014;--panel:#1a1a21;--line:#2c2c36;--ink:#f4f1ea;--ink2:#b9b4a8;--ink3:#8a8578;--accent:#ff9f43;--accent2:#5ad1c6;--warn:#c9a2ff}
@media (prefers-color-scheme: light){:root:not([data-theme=dark]){--bg:#faf8f3;--panel:#ffffff;--line:#e4e0d6;--ink:#17161a;--ink2:#4a4740;--ink3:#7a766c;--accent:#d9730d;--accent2:#0f8a80;--warn:#7a4fd1}}
:root[data-theme=light]{--bg:#faf8f3;--panel:#ffffff;--line:#e4e0d6;--ink:#17161a;--ink2:#4a4740;--ink3:#7a766c;--accent:#d9730d;--accent2:#0f8a80;--warn:#7a4fd1}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.4 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.wrap{padding:18px 20px 20px}
.eyebrow{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink3);margin:0 0 4px}
h1{font-size:26px;line-height:1.15;margin:0 0 12px;font-weight:750}
.badge{display:inline-block;font-size:11px;padding:2px 8px;border-radius:999px;border:1px solid var(--warn);color:var(--warn);margin-left:6px;vertical-align:middle}
.empty{color:var(--ink2);font-size:18px}
button.link{all:unset;cursor:pointer;color:var(--accent);font-weight:600}
`;

const page = (title: string, css: string, body: string, script: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>${BASE_CSS}${css}</style></head>
<body><div class="wrap" id="root"><p class="empty">Loading…</p></div>
<script>${APP_SDK}</script>
<script>
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const app = new McpApps.App({ name: "Fanroute Live", version: "0.1.0" }, {}, { autoResize: true });
const root = document.getElementById("root");
const open = (url) => app.openLink({ url }).catch(() => {});
${script}
app.ontoolresult = (result) => { try { render(result.structuredContent || {}, result._meta || {}); } catch (e) { root.innerHTML = '<p class="empty">Could not show this result.</p>'; } };
// Follow the host's theme when it sends one; otherwise the OS preference applies.
const applyTheme = (ctx) => { if (ctx && ctx.theme) document.documentElement.dataset.theme = ctx.theme; };
app.onhostcontextchanged = applyTheme;
app.connect().then(() => applyTheme(app.getHostContext()));
</script></body></html>`;

export const CONCERTS_URI = "ui://fanroute-live/concerts.html";
export const PLEDGE_URI = "ui://fanroute-live/pledge.html";

export const concertsHtml = () =>
  page(
    "Shows you'd like",
    `
.list{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.row{display:grid;grid-template-columns:76px 1fr;gap:14px;align-items:center;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:12px 14px}
.date{text-align:center;border-radius:12px;background:var(--bg);border:1px solid var(--line);padding:6px 0}
.date .m{font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--accent)}
.date .d{font-size:26px;font-weight:800;line-height:1}
.date .w{font-size:11px;color:var(--ink3)}
.artist{font-size:20px;font-weight:700}
.meta{color:var(--ink2);font-size:14px}
.why{color:var(--accent2);font-size:13px;margin-top:2px}
.foot{margin-top:12px;color:var(--ink3);font-size:12px}
`,
    "",
    `
function render(d){
  const shows = d.shows || [];
  const demo = d.sources && d.sources.events === "demo";
  let h = '<p class="eyebrow">' + esc(d.city) + ' · ' + esc(d.windowLabel || "") + '</p>';
  h += '<h1>Shows you\\'d like' + (demo ? '<span class="badge">demo listings</span>' : '') + '</h1>';
  if (!shows.length) { root.innerHTML = h + '<p class="empty">Nothing from artists you\\'d like in this window yet.</p>'; return; }
  h += '<ul class="list">';
  for (const s of shows.slice(0, 8)) {
    const dt = new Date(s.date + "T12:00:00Z");
    const m = dt.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
    const w = dt.toLocaleString("en-US", { weekday: "short", timeZone: "UTC" });
    h += '<li class="row"><div class="date"><div class="m">' + esc(m) + '</div><div class="d">' + dt.getUTCDate() + '</div><div class="w">' + esc(w) + (s.time ? ' ' + esc(s.time) : '') + '</div></div>';
    h += '<div><div class="artist">' + esc(s.artist) + '</div><div class="meta">' + esc(s.venue) + (s.with && s.with.length ? ' · with ' + esc(s.with.join(", ")) : '') + '</div>';
    h += '<div class="why">' + esc(s.reason) + '</div>';
    if (s.url) h += '<button class="link" data-url="' + esc(s.url) + '">Tickets</button>';
    h += '</div></li>';
  }
  h += '</ul><p class="foot">Taste: ' + esc(d.sources && d.sources.taste) + ' · Listings: ' + esc(d.sources && d.sources.events) + '</p>';
  root.innerHTML = h;
  root.querySelectorAll("button[data-url]").forEach((b) => b.addEventListener("click", () => open(b.dataset.url)));
}
`,
  );

export const pledgeHtml = () =>
  page(
    "Bring them to your city",
    `
.grid{display:grid;grid-template-columns:1fr 168px;gap:18px;align-items:center}
.big{font-size:40px;font-weight:800;line-height:1}
.of{color:var(--ink2);font-size:16px}
.bar{height:14px;border-radius:999px;background:var(--line);overflow:hidden;margin:10px 0 6px}
.bar>i{display:block;height:100%;background:linear-gradient(90deg,var(--accent),#ffcf7a)}
.note{color:var(--ink2);font-size:14px;margin-top:8px}
.qr{background:#fff;border-radius:14px;padding:8px}
.qr svg{display:block;width:100%;height:auto}
.scan{font-size:12px;color:var(--ink3);text-align:center;margin-top:6px}
.cities{list-style:none;margin:12px 0 0;padding:0;display:grid;gap:6px}
.cities li{display:flex;justify-content:space-between;font-size:15px;border-bottom:1px solid var(--line);padding:4px 0}
.ok{color:var(--accent2);font-weight:700}
`,
    "",
    `
function money(n, cur){ return (cur === "USD" || !cur ? "$" : cur + " ") + Math.round(n); }
function render(d, meta){
  if (d.status === "no_campaign") {
    root.innerHTML = '<p class="eyebrow">Fan pledges</p><h1>' + esc(d.artist) + ' hasn\\'t opened pledges yet</h1><p class="empty">Fanroute will let you know when they do.</p>';
    return;
  }
  const c = d.campaign || {};
  if (d.status === "city_not_listed") {
    let h = '<p class="eyebrow">Fan pledges · ' + esc(d.artist) + '</p><h1>' + esc(d.city) + ' isn\\'t on this tour\\'s list</h1><p class="note">Cities fans can pledge for:</p><ul class="cities">';
    for (const x of d.cities || []) h += '<li><span>' + esc(x.name) + '</span><span>' + money(x.pledged, c.currency) + ' of ' + money(x.goal, c.currency) + '</span></li>';
    root.innerHTML = h + '</ul>';
    return;
  }
  const p = d.progress || { pledged: 0, goal: 1, backers: 0 };
  const pct = Math.min(100, Math.round((p.pledged / Math.max(1, p.goal)) * 100));
  let h = '<p class="eyebrow">Fan pledges · ' + esc(d.artist) + '</p><h1>Bring ' + esc(d.artist) + ' to ' + esc(d.city) + '</h1>';
  h += '<div class="grid"><div><div class="big">' + money(p.pledged, c.currency) + ' <span class="of">of ' + money(p.goal, c.currency) + '</span></div>';
  h += '<div class="bar"><i style="width:' + pct + '%"></i></div><div class="of">' + p.backers + ' fan' + (p.backers === 1 ? '' : 's') + ' so far' + (p.reached ? ' · <span class="ok">goal reached</span>' : '') + '</div>';
  h += '<p class="note">Pledge ' + money(c.pledgeAmount, c.currency) + ' with PayPal. It\\'s a hold, not a charge: you only pay if the ' + esc(d.city) + ' show is confirmed.</p>';
  if (c.link) h += '<button class="link" data-url="' + esc(c.link) + '">Open the pledge page</button>';
  h += '</div>';
  if (meta["fanroute/qr"]) h += '<div><div class="qr">' + meta["fanroute/qr"] + '</div><div class="scan">Scan with your phone</div></div>';
  h += '</div>';
  root.innerHTML = h;
  root.querySelectorAll("button[data-url]").forEach((b) => b.addEventListener("click", () => open(b.dataset.url)));
}
`,
  );
