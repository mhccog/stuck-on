/* Everything we're stuck on: a calm sky of open problems.
   All data comes from data/problems.json, built from public sources by scripts/build.py. */
(() => {
  'use strict';
  const FAMILY_COLOURS = {
    'Mathematics': '#9cc2ff', 'Computing & information': '#8fe3d4', 'Physics & the cosmos': '#c7b6ff',
    'Life': '#a8e6a1', 'Health & medicine': '#ff9e8a', 'Chemistry & materials': '#ffc78a',
    'Earth & climate': '#7fd0e8', 'Society & economics': '#ffd9a0', 'Mind & philosophy': '#e8b6ff',
    'Engineering & energy': '#f3a6b8',
  };
  const SOURCE_LABEL = { wikipedia: 'Wikipedia lists', gapmap: 'Gap Map', erdos: 'Erdős problems', opg: 'Open Problem Garden', openalex: 'Recent papers' };
  const SOURCE_INFO = {
    wikipedia: ['Wikipedia "List of unsolved problems in …" pages', 'CC BY-SA 4.0', 'https://en.wikipedia.org/wiki/Lists_of_problems'],
    gapmap: ['Convergent Research Gap Map, open JSON', 'MIT licence', 'https://www.gap-map.org/api/'],
    erdos: ['teorth/erdosproblems community database', 'Apache-2.0', 'https://github.com/teorth/erdosproblems'],
    opg: ['Open Problem Garden, unsolved lists by category (crawled at its 10-second crawl delay)', 'GNU FDL', 'https://www.openproblemgarden.org/'],
    openalex: ['Sentences in recent abstracts saying something "remains an open question", "remains poorly understood"… via OpenAlex', 'CC0 metadata; quoted sentence links to the paper', 'https://openalex.org/'],
  };
  const $ = (id) => document.getElementById(id);
  const canvas = $('sky'), ctx = canvas.getContext('2d');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let W = 0, H = 0, DPR = 1;
  let data = null, P = [], fams = [], famInfo = {};
  const view = { yaw: 0.6, pitch: -0.25, zoom: 1, tYaw: null, tPitch: null, tZoom: null, flyT: 0 };
  let hover = null, selected = null, activeFams = new Set(), query = '', matchSet = null;
  let lastInteract = performance.now(), drifting = false, driftTimer = null;
  const sprites = {};

  // ------------------------------------------------------------- helpers
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; }
  const londonFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
  const regionName = (() => { try { const d = new Intl.DisplayNames(['en'], { type: 'region' }); return (c) => { try { return d.of(c); } catch { return c; } }; } catch { return (c) => c; } })();
  function rgba(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; }
  const fmtN = (n) => n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n);

  function makeSprite(hex) {
    const s = 64, c = document.createElement('canvas'); c.width = c.height = s;
    const g = c.getContext('2d'), gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.12, rgba(hex, 0.95)); gr.addColorStop(0.35, rgba(hex, 0.32)); gr.addColorStop(1, rgba(hex, 0));
    g.fillStyle = gr; g.fillRect(0, 0, s, s); return c;
  }

  // ------------------------------------------------------------- sphere layout
  const v3 = { add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul: (a, k) => [a[0] * k, a[1] * k, a[2] * k], cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }, dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] };
  function basis(c) { const up = Math.abs(c[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]; const e1 = v3.norm(v3.cross(c, up)); const e2 = v3.cross(c, e1); return [e1, e2]; }
  function offset(c, dx, dy) { const [e1, e2] = basis(c); return v3.norm(v3.add(c, v3.add(v3.mul(e1, dx), v3.mul(e2, dy)))); }

  function layout() {
    const byFam = {};
    for (const p of P) (byFam[p.family] ||= []).push(p);
    fams = Object.keys(byFam).sort((a, b) => byFam[b].length - byFam[a].length);
    const nmax = byFam[fams[0]].length;
    // family centres: spread over the sphere, biggest near the equator front
    const golden = Math.PI * (3 - Math.sqrt(5));
    fams.forEach((f, i) => {
      const n = fams.length, y = 0.78 - 1.56 * (i + 0.5) / n, r = Math.sqrt(1 - y * y), th = i * golden;
      const c = [Math.cos(th) * r, y * 0.85, Math.sin(th) * r];
      famInfo[f] = { centre: v3.norm(c), cap: 0.14 + 0.44 * Math.sqrt(byFam[f].length / nmax), n: byFam[f].length, colour: FAMILY_COLOURS[f] || '#e9e4da' };
    });
    for (const f of fams) {
      const fi = famInfo[f], subs = {};
      for (const p of byFam[f]) (subs[norm(p.subfield) || '—'] ||= []).push(p);
      const keys = Object.keys(subs).sort((a, b) => subs[b].length - subs[a].length);
      keys.forEach((k, i) => {
        const rr = fi.cap * Math.sqrt((i + 0.5) / keys.length) * 0.92, th = i * golden + hash(f) * 6.28;
        const sc = offset(fi.centre, Math.cos(th) * rr, Math.sin(th) * rr);
        const list = subs[k].sort((a, b) => (a.id < b.id ? -1 : 1));
        const subR = Math.min(0.2, 0.018 * Math.sqrt(list.length) + 0.012);
        list.forEach((p, j) => {
          const jr = subR * Math.sqrt((j + 0.5) / list.length) * (0.75 + 0.5 * hash(p.id + 'r'));
          const jt = j * golden + hash(p.id) * 1.4;
          p.v = offset(sc, Math.cos(jt) * jr, Math.sin(jt) * jr);
          p.sub = k;
        });
        // constellation lines: each star joins its nearest earlier neighbour in the same subfield
        for (let j = 1; j < list.length; j++) {
          let best = null, bd = -2;
          for (let m = Math.max(0, j - 40); m < j; m++) { const d = v3.dot(list[j].v, list[m].v); if (d > bd) { bd = d; best = list[m]; } }
          if (best && bd > Math.cos(0.09)) list[j].link = best;
        }
      });
    }
  }

  // ------------------------------------------------------------- projection
  let cy0 = 0, cp0 = 1, sy0 = 0, sp0 = 0;
  function setRot() { cy0 = Math.cos(view.yaw); sy0 = Math.sin(view.yaw); cp0 = Math.cos(view.pitch); sp0 = Math.sin(view.pitch); }
  function rot(v) {
    const x1 = v[0] * cy0 + v[2] * sy0, z1 = -v[0] * sy0 + v[2] * cy0;
    const y2 = v[1] * cp0 - z1 * sp0, z2 = v[1] * sp0 + z1 * cp0;
    return [x1, y2, z2];
  }
  const radius = () => Math.min(W, H) * (W < 720 ? 0.46 : 0.4) * view.zoom;
  const centre = () => [W / 2, H * (W < 720 ? 0.44 : 0.5)];
  function anglesFor(v) { const yaw = -Math.atan2(v[0], v[2]); const r = Math.hypot(v[0], v[2]); return [yaw, Math.atan2(v[1], r)]; }

  // ------------------------------------------------------------- drawing
  function visible(p) {
    if (activeFams.size && !activeFams.has(p.family)) return false;
    if (matchSet && !matchSet.has(p)) return false;
    return true;
  }
  function frame(now) {
    requestAnimationFrame(frame);
    const t = now / 1000;
    // easing towards fly targets
    if (view.tYaw !== null) {
      let dy = view.tYaw - view.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      const k = reduceMotion ? 1 : 0.035;
      view.yaw += dy * k; view.pitch += (view.tPitch - view.pitch) * k; view.zoom += (view.tZoom - view.zoom) * k;
      if (Math.abs(dy) < 0.0008 && Math.abs(view.tPitch - view.pitch) < 0.0008 && Math.abs(view.tZoom - view.zoom) < 0.002) view.tYaw = null;
    } else if (!dragging && !reduceMotion && now - lastInteract > 2500 && !selected) {
      view.yaw += 0.00045; // the slow turning of the sky
    }
    setRot();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const R = radius(), [cx, cy] = centre();
    // faint sphere edge, so the sky reads as a globe
    const g = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 1.04);
    g.addColorStop(0, 'rgba(30,38,60,0.10)'); g.addColorStop(0.92, 'rgba(30,38,60,0.05)'); g.addColorStop(1, 'rgba(30,38,60,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 1.04, 0, 6.2832); ctx.fill();
    ctx.strokeStyle = 'rgba(233,228,218,0.045)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.2832); ctx.stroke();

    // project
    for (const p of P) {
      const r = rot(p.v); p.sx = cx + r[0] * R; p.sy = cy - r[1] * R; p.z = r[2];
      p.on = visible(p);
    }
    // constellation lines
    ctx.lineWidth = 0.7;
    for (const p of P) {
      if (!p.link || p.z < 0.05 || p.link.z < 0.05) continue;
      const a = (p.on && p.link.on ? 0.075 : 0.015) * Math.min(1, p.z * 2.5);
      ctx.strokeStyle = rgba(famInfo[p.family].colour, a);
      ctx.beginPath(); ctx.moveTo(p.sx, p.sy); ctx.lineTo(p.link.sx, p.link.sy); ctx.stroke();
    }
    // stars
    ctx.globalCompositeOperation = 'lighter';
    const zf = Math.sqrt(view.zoom);
    for (const p of P) {
      if (p.z < 0) continue;
      const edge = Math.min(1, p.z * 3);
      const dim = p.on ? 1 : 0.1;
      const col = famInfo[p.family].colour;
      if (p.neglect == null) {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = rgba(col, 0.38 * edge * dim); ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.arc(p.sx, p.sy, 2.3 * zf, 0, 6.2832); ctx.stroke();
        ctx.globalCompositeOperation = 'lighter';
        continue;
      }
      const n = p.neglect; // 1 = nobody visibly working on it
      const breathe = reduceMotion ? 0.85 : 0.72 + 0.28 * Math.sin(t * (0.5 + p.ph * 0.5) + p.ph * 6.28);
      const n3 = n * n * n;
      const size = (2.4 + n3 * 16 * (n > 0.7 ? breathe : 1)) * zf;
      const alpha = (0.16 + 0.62 * n3) * edge * dim * Math.min(1, 0.6 + 0.2 * view.zoom);
      ctx.globalAlpha = alpha;
      ctx.drawImage(sprites[p.family], p.sx - size, p.sy - size, size * 2, size * 2);
      // steady core for busy problems
      if (n < 0.5) { ctx.globalAlpha = 0.55 * edge * dim; ctx.fillStyle = '#dfe5f2'; ctx.fillRect(p.sx - 0.8, p.sy - 0.8, 1.6, 1.6); }
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    // family labels
    ctx.textAlign = 'center'; ctx.font = `500 ${W < 720 ? 10 : 11}px ui-sans-serif, system-ui, sans-serif`;
    for (const f of fams) {
      const fi = famInfo[f], r = rot(fi.centre); if (r[2] < 0.25) continue;
      const tw = ctx.measureText(f).width * 1.25 / 2 + 8;
      const lx = Math.max(tw, Math.min(W - tw, cx + r[0] * R)), ly = cy - r[1] * R - fi.cap * R * 0.95 - 8;
      const a = Math.min(1, (r[2] - 0.25) * 2) * (activeFams.size && !activeFams.has(f) ? 0.25 : 0.75);
      ctx.fillStyle = rgba(fi.colour, a);
      ctx.fillText(f.toUpperCase().split('').join('\u2009'), lx, ly);
    }
    // hover + selection rings
    for (const [p, a] of [[hover, 0.6], [selected, 0.9]]) {
      if (!p || p.z < 0) continue;
      ctx.strokeStyle = `rgba(255,217,160,${a})`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(p.sx, p.sy, 9 + (p === selected && !reduceMotion ? Math.sin(t * 2) * 1.5 : 0), 0, 6.2832); ctx.stroke();
    }
  }

  // ------------------------------------------------------------- interaction
  let dragging = false, dragStart = null, moved = 0, pinch = null;
  function pick(x, y) {
    let best = null, bd = W < 720 ? 22 : 14;
    for (const p of P) { if (p.z < 0.05 || !p.on) continue; const d = Math.hypot(p.sx - x, p.sy - y); if (d < bd) { bd = d; best = p; } }
    return best;
  }
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId); dragging = true; moved = 0; dragStart = { x: e.clientX, y: e.clientY, yaw: view.yaw, pitch: view.pitch };
    view.tYaw = null; interact(); canvas.classList.add('dragging');
  });
  canvas.addEventListener('pointermove', (e) => {
    if (dragging && dragStart && !pinch) {
      const dx = e.clientX - dragStart.x, dy = e.clientY - dragStart.y; moved = Math.max(moved, Math.hypot(dx, dy));
      const k = 1 / radius();
      view.yaw = dragStart.yaw + dx * k; view.pitch = Math.max(-1.45, Math.min(1.45, dragStart.pitch + dy * k));
      interact();
    } else if (e.pointerType === 'mouse') {
      const p = pick(e.clientX, e.clientY);
      if (p !== hover) { hover = p; showTip(p, e.clientX, e.clientY); canvas.classList.toggle('hovering', !!p); }
      else if (p) moveTip(e.clientX, e.clientY);
    }
  });
  canvas.addEventListener('pointerup', (e) => {
    dragging = false; canvas.classList.remove('dragging');
    if (moved < 6) { const p = pick(e.clientX, e.clientY); if (p) { stopDrift(); select(p, true); } else if (selected) closePanel(); }
  });
  canvas.addEventListener('pointerleave', () => { hover = null; showTip(null); });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); view.tYaw = null; view.zoom = Math.max(0.7, Math.min(7, view.zoom * Math.exp(-e.deltaY * 0.0012))); interact(); }, { passive: false });
  canvas.addEventListener('touchstart', (e) => { if (e.touches.length === 2) { pinch = { d: Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY), z: view.zoom }; } }, { passive: true });
  canvas.addEventListener('touchmove', (e) => { if (pinch && e.touches.length === 2) { const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); view.zoom = Math.max(0.7, Math.min(7, pinch.z * d / pinch.d)); interact(); } }, { passive: true });
  canvas.addEventListener('touchend', (e) => { if (e.touches.length < 2) pinch = null; });
  function interact() { lastInteract = performance.now(); }

  const tip = $('tip');
  function showTip(p, x, y) {
    if (!p) { tip.hidden = true; return; }
    tip.innerHTML = `${esc(p.title)}<small>${esc(p.family)} · ${esc(SOURCE_LABEL[p.source])} · ${quietWord(p)}</small>`;
    tip.hidden = false; moveTip(x, y);
  }
  function moveTip(x, y) { const r = tip.getBoundingClientRect(); tip.style.left = Math.min(W - r.width - 10, x + 14) + 'px'; tip.style.top = Math.min(H - r.height - 10, y + 14) + 'px'; }
  function quietWord(p) {
    if (p.neglect == null) return 'not measured yet';
    if (p.neglect >= 0.85) return 'very quiet';
    if (p.neglect >= 0.6) return 'quiet';
    if (p.neglect >= 0.3) return 'some activity';
    return 'busy';
  }

  function flyTo(p, zoom) {
    const [yaw, pitch] = anglesFor(p.v);
    view.tYaw = yaw; view.tPitch = pitch; view.tZoom = zoom || Math.max(view.zoom, W < 720 ? 2.2 : 2.6);
    // shift so the star sits left of the panel on desktop
    if (W >= 720) view.tYaw += 0.12 / view.tZoom;
    else view.tPitch -= 0.16 / view.tZoom;
  }

  // ------------------------------------------------------------- detail panel
  const panel = $('panel'), body = $('panelBody');
  function select(p, fly) {
    selected = p; if (fly) flyTo(p);
    history.replaceState(null, '', '#p=' + p.id);
    body.innerHTML = renderDetail(p);
    panel.hidden = false; panel.scrollTop = 0;
    if (W < 720) $('caption').classList.remove('show');
  }
  function closePanel() { selected = null; panel.hidden = true; history.replaceState(null, '', location.pathname + location.search); }
  $('close').addEventListener('click', closePanel);
  addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (drifting) stopDrift(); closePanel(); } });

  function meter(label, sig, max) {
    if (!sig) return `<div class="meter none"><span>${label}</span><div class="bar"></div><b>—</b></div>`;
    const w = Math.min(100, 100 * Math.log1p(sig.n) / Math.log1p(max));
    return `<div class="meter ${sig.n ? '' : 'none'}"><span>${label}</span><div class="bar"><span style="width:${w}%"></span></div><b>${fmtN(sig.n)}</b></div>`;
  }
  function renderDetail(p) {
    const col = famInfo[p.family].colour, s = p.signals || {};
    let h = `<div class="kicker"><i style="background:${col};box-shadow:0 0 8px ${col}"></i>${esc(p.family)}${p.subfield ? ' · ' + esc(p.subfield) : ''}</div>`;
    h += `<h2>${esc(p.title)}</h2>`;
    if (p.source === 'openalex') h += `<p class="statement quote">“${esc(p.statement)}”</p>`;
    else if (p.statement && norm(p.statement) !== norm(p.title)) h += `<p class="statement">${esc(p.statement)}</p>`;

    // quietness
    const orb = p.neglect == null ? `border:1px solid ${rgba(col, .6)}` : `background:radial-gradient(circle,#fff 0 12%,${col} 30%,${rgba(col, 0)} ${40 + p.neglect * 30}%);opacity:${0.4 + 0.6 * p.neglect}`;
    h += `<div class="sect"><h3>How quiet it is</h3><div class="quietness"><span class="orb" style="${orb}"></span><span>${p.neglect == null ? 'Not measured yet: it has no short name we can search for.' : `${cap(quietWord(p))}: quieter than ${Math.round(p.neglect * 100)}% of problems from ${esc(SOURCE_LABEL[p.source])}.`}</span></div>`;
    if (p.measured) h += `<p class="muted">Measured by: ${esc(p.measured)}${p.query ? ` · searched as “${esc(p.query)}”` : ''}</p>`;
    if (s.papers || s.repos || s.hn) {
      const mx = 2000;
      h += meter('Papers', s.papers, mx) + meter('Repositories', s.repos, mx) + meter('HN threads', s.hn, 500);
      const ts = Math.max(...['papers', 'repos', 'hn'].map((k) => (s[k] && s[k].t) || 0));
      if (ts) h += `<p class="muted">Counts cover the last 24 months, checked ${esc(londonFmt.format(new Date(ts * 1000)))}.</p>`;
    }
    h += `</div>`;

    // where it was stated
    h += `<div class="sect"><h3>Where it was written down</h3>`;
    if (p.paper) {
      const pp = p.paper;
      h += `<p><a href="${esc(p.sourceUrl)}" target="_blank" rel="noopener">${esc(pp.title)}</a></p><p class="muted">${esc(pp.venue || 'Venue not recorded')} · ${esc(pp.date || '')}${pp.countries && pp.countries.length ? ' · authors in ' + pp.countries.map(regionName).map(esc).join(', ') : ''} · cited ${pp.citedBy} time${pp.citedBy === 1 ? '' : 's'} so far</p>`;
    } else {
      h += `<p><a href="${esc(p.sourceUrl)}" target="_blank" rel="noopener">${esc(p.sourceName)}</a></p>`;
    }
    h += `<p class="muted">${esc(p.confidence || '')}</p></div>`;

    // who's working
    const who = [];
    if (p.paper) for (const a of p.paper.authors || []) who.push(`<li><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.name)}</a><small>Author of the paper that stated it · public OpenAlex profile</small></li>`);
    if (p.gapmap) {
      for (const c of p.gapmap.capabilities) who.push(`<li>${c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.title)}</a>` : esc(c.title)}<small>Capability Gap Map links to this gap</small></li>`);
      for (const r of p.gapmap.resources.slice(0, 8)) who.push(`<li><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.name)}</a><small>${esc(r.kind)} · listed by Gap Map</small></li>`);
    }
    if (p.erdos) {
      const e = p.erdos;
      who.push(`<li><a href="${esc(p.sourceUrl)}" target="_blank" rel="noopener">Problem #${esc(e.number)} and its forum thread</a><small>erdosproblems.com${e.prize && e.prize !== 'no' ? ' · prize ' + esc(e.prize) : ''}</small></li>`);
      if (e.leanUrl) who.push(`<li><a href="${esc(e.leanUrl)}" target="_blank" rel="noopener">Lean formalisation of the statement</a><small>google-deepmind/formal-conjectures</small></li>`);
      for (const o of e.oeis.slice(0, 3)) who.push(`<li><a href="https://oeis.org/${esc(o)}" target="_blank" rel="noopener">${esc(o)}</a><small>Linked integer sequence on the OEIS</small></li>`);
    }
    if (p.opg && p.opg.authors.length) who.push(`<li>Posed by ${esc(p.opg.authors.join(', '))}<small>Open Problem Garden${p.opg.importance ? ' · importance ' + '✭'.repeat(p.opg.importance) : ''}</small></li>`);
    for (const it of (s.papers && s.papers.items) || []) who.push(`<li><a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a><small>${esc((it.who || []).join(', '))}${it.who && it.who.length >= 4 ? ' et al.' : ''} · ${esc(it.date || '')} · ${esc(s.papers.via)}</small></li>`);
    for (const it of (s.repos && s.repos.items) || []) who.push(`<li><a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a><small>GitHub · ★ ${it.stars} · pushed ${esc(it.pushed)}${it.desc ? ' · ' + esc(it.desc) : ''}</small></li>`);
    for (const it of (s.hn && s.hn.items) || []) if (it.title) who.push(`<li><a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a><small>Hacker News · ${esc(it.date)}</small></li>`);
    h += `<div class="sect"><h3>Who's visibly working on it</h3>`;
    h += who.length ? `<ul class="who">${who.join('')}</ul>` : `<p class="muted">Nobody we can find in public, in the sources we check. That's what the glow means.</p>`;
    h += `<p class="muted">Public work only. No contact details and no messaging.</p></div>`;

    const links = [`<a href="${esc(p.sourceUrl)}" target="_blank" rel="noopener">Source ↗</a>`];
    if (p.articleUrl) links.push(`<a href="${esc(p.articleUrl)}" target="_blank" rel="noopener">Wikipedia article ↗</a>`);
    const q = p.query || (p.source === 'erdos' ? `Erdős problem ${p.erdos.number}` : p.title.slice(0, 120));
    links.push(`<a href="https://scholar.google.com/scholar?q=${encodeURIComponent('"' + q + '"')}" target="_blank" rel="noopener">Search Scholar ↗</a>`);
    h += `<div class="links">${links.join('')}</div>`;
    return h;
  }
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  // ------------------------------------------------------------- search & filters
  const qEl = $('q'), resEl = $('results');
  let resIdx = -1, resList = [];
  qEl.addEventListener('input', () => {
    query = norm(qEl.value.trim());
    if (query.length < 2) { matchSet = null; resEl.hidden = true; return; }
    const words = query.split(/\s+/);
    resList = P.filter((p) => { const s = p._s ||= norm(p.title + ' ' + p.statement + ' ' + p.subfield + ' ' + p.family + ' ' + (p.erdos ? p.erdos.tags.join(' ') : '')); return words.every((w) => s.includes(w)); });
    matchSet = new Set(resList);
    resList.sort((a, b) => (norm(b.title).includes(query) - norm(a.title).includes(query)) || ((b.neglect ?? -1) - (a.neglect ?? -1)));
    resIdx = -1;
    resEl.innerHTML = resList.length ? resList.slice(0, 30).map((p, i) => `<li data-i="${i}" role="option"><span>${esc(p.title.length > 110 ? p.title.slice(0, 108) + '…' : p.title)}</span><small>${esc(p.family)} · ${esc(SOURCE_LABEL[p.source])} · ${quietWord(p)}</small></li>`).join('') + (resList.length > 30 ? `<li class="more"><small>${resList.length - 30} more lit up on the sky</small></li>` : '')
      : `<li><small>No open problem matches “${esc(qEl.value.trim())}” in these sources.</small></li>`;
    resEl.hidden = false;
  });
  resEl.addEventListener('click', (e) => { const li = e.target.closest('li[data-i]'); if (li) { stopDrift(); select(resList[+li.dataset.i], true); resEl.hidden = true; } });
  qEl.addEventListener('keydown', (e) => {
    const items = [...resEl.querySelectorAll('li[data-i]')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); resIdx = Math.max(0, Math.min(items.length - 1, resIdx + (e.key === 'ArrowDown' ? 1 : -1))); items.forEach((li, i) => li.classList.toggle('on', i === resIdx)); }
    if (e.key === 'Enter' && items.length) { stopDrift(); select(resList[resIdx >= 0 ? resIdx : 0], true); resEl.hidden = true; }
    if (e.key === 'Escape') { qEl.value = ''; qEl.dispatchEvent(new Event('input')); }
  });
  qEl.addEventListener('focus', () => { if (resList.length && query.length >= 2) resEl.hidden = false; });
  document.addEventListener('click', (e) => { if (!e.target.closest('.searchwrap')) resEl.hidden = true; });

  function renderChips() {
    const el = $('fields');
    el.innerHTML = fams.map((f) => `<button class="chip ${activeFams.size ? (activeFams.has(f) ? 'on' : 'off') : ''}" data-f="${esc(f)}"><i style="background:${famInfo[f].colour}"></i>${esc(f)} <em>${famInfo[f].n}</em></button>`).join('');
  }
  $('fields').addEventListener('click', (e) => {
    const b = e.target.closest('.chip'); if (!b) return;
    const f = b.dataset.f;
    if (activeFams.has(f)) activeFams.delete(f); else activeFams.add(f);
    renderChips();
    if (activeFams.size === 1) { const fi = famInfo[[...activeFams][0]]; const [yaw, pitch] = anglesFor(fi.centre); view.tYaw = yaw; view.tPitch = pitch; view.tZoom = Math.max(1, 0.9 / (fi.cap + 0.25)); }
  });

  // ------------------------------------------------------------- drift
  const caption = $('caption');
  function driftPool() {
    return P.filter((p) => p.neglect != null && p.neglect >= 0.8 && visible(p));
  }
  function driftStep() {
    const pool = driftPool();
    if (!pool.length) { stopDrift(); return; }
    const p = pool[Math.floor(Math.random() * pool.length)];
    selected = null; panel.hidden = true; hover = p;
    flyTo(p, W < 720 ? 2.4 : 3);
    if (W >= 720) view.tYaw -= 0.12 / view.tZoom; // centred while drifting
    else view.tPitch += 0.16 / view.tZoom;
    caption.classList.remove('show');
    setTimeout(() => {
      if (!drifting) return;
      $('capTopic').textContent = `${p.family} · ${SOURCE_LABEL[p.source]}`;
      $('capMain').textContent = p.title.length > 180 ? p.title.slice(0, 178) + '…' : p.title;
      $('capSub').textContent = driftLine(p);
      caption.classList.add('show');
    }, 1600);
    driftTimer = setTimeout(driftStep, reduceMotion ? 12000 : 11000);
  }
  function driftLine(p) {
    const s = p.signals || {};
    if (p.source === 'openalex') return `Written down ${p.paper.date ? 'in ' + new Date(p.paper.date).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : 'recently'}${p.paper.countries.length ? ' by authors in ' + p.paper.countries.map(regionName).join(', ') : ''}. Cited ${p.paper.citedBy} time${p.paper.citedBy === 1 ? '' : 's'} so far.`;
    if (p.source === 'gapmap') return `Gap Map lists ${p.gapmap.nResources} resource${p.gapmap.nResources === 1 ? '' : 's'} working towards it.`;
    if (s.papers || s.repos || s.hn) {
      const parts = [];
      if (s.papers) parts.push(`${s.papers.n} paper${s.papers.n === 1 ? '' : 's'}`);
      if (s.repos) parts.push(`${s.repos.n} repositor${s.repos.n === 1 ? 'y' : 'ies'}`);
      if (s.hn) parts.push(`${s.hn.n} Hacker News mention${s.hn.n === 1 ? '' : 's'}`);
      return `In two years: ${parts.join(', ')}.`;
    }
    if (p.source === 'erdos') return `Open in the community database since at least ${p.erdos.lastUpdate || 'its first listing'}${p.erdos.formalized ? '' : '; its statement is not yet formalised'}.`;
    return '';
  }
  function startDrift() { drifting = true; $('drift').setAttribute('aria-pressed', 'true'); $('driftLabel').textContent = 'Drifting'; driftStep(); }
  function stopDrift() { if (!drifting) return; drifting = false; clearTimeout(driftTimer); $('drift').setAttribute('aria-pressed', 'false'); $('driftLabel').textContent = 'Drift'; caption.classList.remove('show'); hover = null; }
  $('drift').addEventListener('click', () => (drifting ? stopDrift() : startDrift()));
  canvas.addEventListener('pointerdown', () => { if (drifting) stopDrift(); });

  // ------------------------------------------------------------- side lists & about
  function renderQuiet() {
    const named = P.filter((p) => p.signals && p.signals.papers && p.signals.repos && p.signals.hn && p.signals.papers.n === 0 && p.signals.repos.n === 0 && p.signals.hn.n === 0);
    named.sort((a, b) => hash(a.id + new Date().toDateString()) - hash(b.id + new Date().toDateString()));
    const list = named.slice(0, 7);
    $('quietList').innerHTML = list.length ? list.map((p) => `<li data-id="${p.id}"><i style="background:${famInfo[p.family].colour};box-shadow:0 0 6px ${famInfo[p.family].colour}"></i><span>${esc(p.title)}<small>${esc(p.family)} · ${esc(SOURCE_LABEL[p.source])}</small></span></li>`).join('')
      : '<li class="muted">None measured yet.</li>';
    $('quiet').querySelector('.hint').textContent = `${named.length} named problems with no papers, repositories or Hacker News threads mentioning them in two years. A few, changing daily:`;
  }
  $('quietList').addEventListener('click', (e) => { const li = e.target.closest('li[data-id]'); if (li) { stopDrift(); select(P.find((p) => p.id === li.dataset.id), true); } });
  $('aboutBtn').addEventListener('click', () => $('about').showModal());

  function renderMeta() {
    const m = data.meta, quiet = P.filter((p) => p.neglect != null && p.neglect >= 0.8).length;
    $('counts').innerHTML = `<b>${m.count.toLocaleString('en-GB')}</b> open problems · <b>${m.measured.toLocaleString('en-GB')}</b> measured<br><b>${quiet.toLocaleString('en-GB')}</b> glowing softly · rebuilt ${esc(londonFmt.format(new Date(m.generated)))}`;
    const order = ['wikipedia', 'opg', 'erdos', 'gapmap', 'openalex'];
    $('health').innerHTML = order.filter((k) => m.sources[k]).map((k) => { const s = m.sources[k]; return `<span class="pill ${s.ok ? 'ok' : 'bad'}" title="${esc(s.ok ? (s.note || 'fetched ' + (s.fetched || '')) : (s.note || '') + ' ' + (s.error || ''))}">${esc(SOURCE_LABEL[k])} ${s.count}${s.ok ? '' : ' · down'}</span>`; }).join('');
    $('srcList').innerHTML = order.map((k) => { const s = m.sources[k] || { ok: false, count: 0 }; const [d, lic, url] = SOURCE_INFO[k]; return `<div class="src"><b><a href="${url}" target="_blank" rel="noopener">${esc(SOURCE_LABEL[k])}</a></b><span class="${s.ok ? '' : 'bad'}">${s.count} ${s.ok ? '' : '· last fetch failed'}</span><small>${esc(d)} · ${esc(lic)}</small></div>`; }).join('')
      + `<div class="src"><b>Activity signals</b><span></span><small>arXiv API, Europe PMC REST API, OpenAlex (keyless, ${m.openalexCreditsUsed} credits used in the last build), GitHub search API, Hacker News Algolia API.</small></div>`;
  }

  // ------------------------------------------------------------- boot
  function resize() {
    DPR = Math.min(2, devicePixelRatio || 1); W = innerWidth; H = innerHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
  }
  addEventListener('resize', resize);
  resize();

  fetch('data/problems.json', { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then((d) => {
    data = d; P = d.problems.filter((p) => p.family);
    for (const p of P) p.ph = hash(p.id + 'ph');
    layout();
    for (const f of fams) sprites[f] = makeSprite(famInfo[f].colour);
    renderChips(); renderMeta(); renderQuiet();
    const m = location.hash.match(/p=([0-9a-f]+)/);
    const p0 = m && P.find((p) => p.id === m[1]);
    if (p0) select(p0, true);
    else { const [yaw, pitch] = anglesFor(famInfo[fams[0]].centre); view.yaw = yaw + 0.5; view.pitch = pitch * 0.6; }
    if (new URLSearchParams(location.search).has('drift')) startDrift();
    requestAnimationFrame(frame);
  }).catch((err) => {
    $('counts').textContent = 'The problem data could not be loaded (' + err.message + '). Nothing is shown rather than anything made up.';
  });
  window.__stuck = { get data() { return data; }, select: (id) => { const p = P.find((x) => x.id === id); if (p) select(p, true); }, view };
})();
