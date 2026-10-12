// 見どころ帳：アプリとして開いたときに、つながらなくても前に読んだ内容を見られるようにする
const CACHE = 'nkd-4';
const ROOT = new URL('./', self.location).href;
const SHELL = ['', 'manifest.json', 'icon-192.png', 'icon-512.png', 'icon-maskable.png'].map(p => ROOT + p);
const ANY = {ignoreVary: true};
let net = {ok: null, at: 0};

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE)
    .then(c => Promise.all(SHELL.map(u => c.add(new Request(u, {cache: 'reload'})).catch(() => {}))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});
function within(p, ms){
  return new Promise((ok, ng) => {
    const t = setTimeout(() => ng(new Error('timeout')), ms);
    p.then(r => { clearTimeout(t); ok(r); }, e => { clearTimeout(t); ng(e); });
  });
}
// 画面の枠：手元の控えをすぐ出して、裏で新しくしておく
async function shell(e){
  const c = await caches.open(CACHE);
  const hit = await c.match(ROOT, ANY);
  const p = fetch(ROOT, {cache: 'no-store'}).then(async r => { if (r.ok) await c.put(ROOT, r.clone()); return r; });
  if (hit){ e.waitUntil(p.catch(() => {})); return hit; }
  return p;
}
// 日付の一覧：取りに行き、すぐ返事がなければ控えを出す
async function fresh(e, req, key, ms){
  const c = await caches.open(CACHE);
  const p = fetch(req).then(async r => {
    if (!r.ok){ const err = new Error('HTTP ' + r.status); err.res = r; throw err; }
    await c.put(key, r.clone());
    net = {ok: true, at: Date.now()};
    return r;
  });
  try { return await within(p, ms); }
  catch (err) {
    if (err.res && err.res.status < 500) return err.res;   // トークン切れなどは、そのまま画面に伝える
    net = {ok: false, at: Date.now()};
    e.waitUntil(p.catch(() => {}));
    const hit = await c.match(key, ANY);
    return hit || p;
  }
}
// 1日ぶんのデータ：中身が変わると ?v= が変わるので、控えがあればそれを使う
async function versioned(req){
  const c = await caches.open(CACHE);
  const hit = await c.match(req, ANY);
  if (hit) return hit;
  const r = await fetch(req);
  if (r.ok){
    const u0 = new URL(req.url);
    for (const k of await c.keys()){ const u = new URL(k.url); if (u.origin === u0.origin && u.pathname === u0.pathname) await c.delete(k, ANY); }
    await c.put(req, r.clone());
    if (u0.pathname.includes('/data/log/')){      // 元のレスは大きいので、古いものから捨てて最近の分だけ残す
      const ks = (await c.keys()).filter(k => new URL(k.url).pathname.includes('/data/log/'));
      for (const k of ks.slice(0, Math.max(0, ks.length - 80))) await c.delete(k, ANY);
    }
  }
  return r;
}
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin){
    if (!url.href.startsWith(ROOT)) return;
    const rel = url.pathname.slice(new URL(ROOT).pathname.length);
    if (rel === '__nkd_status'){ e.respondWith(new Response(JSON.stringify(net), {headers: {'Content-Type': 'application/json'}})); return; }
    if (req.mode === 'navigate' || rel === '' || rel === 'index.html'){ e.respondWith(shell(e)); return; }
    if (rel === 'data/index.js'){ e.respondWith(fresh(e, new Request(ROOT + 'data/index.js', {cache: 'no-store'}), ROOT + 'data/index.js', 3000)); return; }
    if (rel.startsWith('data/days/') || rel.startsWith('data/hot/') || rel.startsWith('data/log/')){ e.respondWith(versioned(req)); return; }
    e.respondWith(caches.match(req, {ignoreSearch: true, ignoreVary: true}).then(h => h || fetch(req)));
    return;
  }
  if (/\/repos\/[^/]+\/[^/]+\/contents\/data\//.test(url.pathname)){   // GitHub から読む要約
    if (url.pathname.endsWith('/data/index.json')){ e.respondWith(fresh(e, req, url.origin + url.pathname, 4000)); return; }
    if (url.pathname.includes('/data/days/') || url.pathname.includes('/data/hot/') || url.pathname.includes('/data/log/')){ e.respondWith(versioned(req)); return; }
    return;
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com'){
    e.respondWith(caches.open(CACHE).then(async c => {
      const h = await c.match(req, ANY);
      if (h) return h;
      const r = await fetch(req);
      if (r.ok || r.type === 'opaque') await c.put(req, r.clone());
      return r;
    }));
  }
});
