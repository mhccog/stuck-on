/* StuckSky: the renderer for "Everything we're stuck on", separable from the page UI.
   Usage:
     const sky = StuckSky.create(canvas, problems, { isVisible: (p) => true, isIdle: () => true });
     sky.start();  sky.flyTo(problem);  sky.pick(x, y);  sky.hover = p;  sky.selected = p;
   Input: problems in the shape of data/problems.json (needs id, family, subfield, neglect).
   It adds p.v (unit vector on the sky sphere), p.sx/p.sy/p.z (screen projection) to each problem. */
(function (global) {
  'use strict';
  const FAMILY_COLOURS = {
    'Mathematics': '#9cc2ff', 'Computing & information': '#8fe3d4', 'Physics & the cosmos': '#c7b6ff',
    'Life': '#a8e6a1', 'Health & medicine': '#ff9e8a', 'Chemistry & materials': '#ffc78a',
    'Earth & climate': '#7fd0e8', 'Society & economics': '#ffd9a0', 'Mind & philosophy': '#e8b6ff',
    'Engineering & energy': '#f3a6b8',
  };
  const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; }
  function rgba(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; }
  const v3 = { add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul: (a, k) => [a[0] * k, a[1] * k, a[2] * k], cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }, dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] };
  function basis(c) { const up = Math.abs(c[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]; const e1 = v3.norm(v3.cross(c, up)); const e2 = v3.cross(c, e1); return [e1, e2]; }
  function offset(c, dx, dy) { const [e1, e2] = basis(c); return v3.norm(v3.add(c, v3.add(v3.mul(e1, dx), v3.mul(e2, dy)))); }
  function anglesFor(v) { const yaw = -Math.atan2(v[0], v[2]); const r = Math.hypot(v[0], v[2]); return [yaw, Math.atan2(v[1], r)]; }
  function makeSprite(hex) {
    const s = 64, c = document.createElement('canvas'); c.width = c.height = s;
    const g = c.getContext('2d'), gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.12, rgba(hex, 0.95)); gr.addColorStop(0.35, rgba(hex, 0.32)); gr.addColorStop(1, rgba(hex, 0));
    g.fillStyle = gr; g.fillRect(0, 0, s, s); return c;
  }

  function create(canvas, problems, opts) {
    opts = opts || {};
    const colours = Object.assign({}, FAMILY_COLOURS, opts.colours || {});
    const isVisible = opts.isVisible || (() => true);
    const isIdle = opts.isIdle || (() => true);
    const isActiveFamily = opts.isActiveFamily || (() => true);
    const reduceMotion = opts.reduceMotion ?? matchMedia('(prefers-reduced-motion: reduce)').matches;
    const ctx = canvas.getContext('2d');
    const P = problems;
    const fams = [], famInfo = {}, sprites = {};
    const view = { yaw: 0.6, pitch: -0.25, zoom: 1, tYaw: null, tPitch: null, tZoom: null };
    const sky = { P, fams, famInfo, view, colours, hover: null, selected: null, W: 0, H: 0, DPR: 1 };

    // ---------------------------------------------------------- layout on the sphere
    (function layout() {
      const byFam = {};
      for (const p of P) { p.ph = hash(p.id + 'ph'); (byFam[p.family] ||= []).push(p); }
      fams.push(...Object.keys(byFam).sort((a, b) => byFam[b].length - byFam[a].length));
      const nmax = byFam[fams[0]] ? byFam[fams[0]].length : 1;
      const golden = Math.PI * (3 - Math.sqrt(5));
      fams.forEach((f, i) => {
        const n = fams.length, y = 0.78 - 1.56 * (i + 0.5) / n, r = Math.sqrt(1 - y * y), th = i * golden;
        famInfo[f] = { centre: v3.norm([Math.cos(th) * r, y * 0.85, Math.sin(th) * r]), cap: 0.14 + 0.44 * Math.sqrt(byFam[f].length / nmax), n: byFam[f].length, colour: colours[f] || '#e9e4da' };
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
          });
          // constellation lines: each star joins its nearest earlier neighbour in the same subfield
          for (let j = 1; j < list.length; j++) {
            let best = null, bd = -2;
            for (let m = Math.max(0, j - 40); m < j; m++) { const d = v3.dot(list[j].v, list[m].v); if (d > bd) { bd = d; best = list[m]; } }
            if (best && bd > Math.cos(0.09)) list[j].link = best;
          }
        });
      }
      for (const f of fams) sprites[f] = makeSprite(famInfo[f].colour);
      // crowding: dense constellations are dimmed per star so they stay calm rather than burn white
      const cosR = Math.cos(0.035);
      for (const p of P) { let k = 0; for (const o of P) if (o !== p && o.family === p.family && v3.dot(p.v, o.v) > cosR) k++; p.crowd = 1 / Math.sqrt(1 + k / 5); }
    })();

    // ---------------------------------------------------------- projection
    let cy0 = 0, cp0 = 1, sy0 = 0, sp0 = 0;
    function setRot() { cy0 = Math.cos(view.yaw); sy0 = Math.sin(view.yaw); cp0 = Math.cos(view.pitch); sp0 = Math.sin(view.pitch); }
    function rot(v) { const x1 = v[0] * cy0 + v[2] * sy0, z1 = -v[0] * sy0 + v[2] * cy0; return [x1, v[1] * cp0 - z1 * sp0, v[1] * sp0 + z1 * cp0]; }
    const mobile = () => sky.W < 720;
    sky.radius = () => Math.min(sky.W, sky.H) * (mobile() ? 0.46 : 0.4) * view.zoom;
    const centre = () => [sky.W / 2, sky.H * (mobile() ? 0.44 : 0.5)];

    sky.resize = function () {
      sky.DPR = Math.min(2, devicePixelRatio || 1); sky.W = innerWidth; sky.H = innerHeight;
      canvas.width = sky.W * sky.DPR; canvas.height = sky.H * sky.DPR;
    };
    sky.flyToVec = function (v, zoom) { const [yaw, pitch] = anglesFor(v); view.tYaw = yaw; view.tPitch = pitch; view.tZoom = zoom; };
    /* side: 'left' keeps the star left of a right-hand panel, 'centre' centres it */
    sky.flyTo = function (p, zoom, side) {
      const z = zoom || Math.max(view.zoom, mobile() ? 2.2 : 2.6);
      sky.flyToVec(p.v, z);
      if (side !== 'centre') { if (!mobile()) view.tYaw += 0.12 / z; else view.tPitch -= 0.16 / z; }
    };
    sky.flyToFamily = function (f) { const fi = famInfo[f]; if (fi) sky.flyToVec(fi.centre, Math.max(1, 0.9 / (fi.cap + 0.25))); };
    sky.stopFlying = () => { view.tYaw = null; };
    sky.pick = function (x, y) {
      let best = null, bd = mobile() ? 22 : 14;
      for (const p of P) { if (p.z < 0.05 || !p.on) continue; const d = Math.hypot(p.sx - x, p.sy - y); if (d < bd) { bd = d; best = p; } }
      return best;
    };

    // ---------------------------------------------------------- drawing
    let lastNow = 0;
    function frame(now) {
      requestAnimationFrame(frame);
      const W = sky.W, H = sky.H;
      const t = now / 1000, dt = Math.min(0.1, lastNow ? (now - lastNow) / 1000 : 0.016); lastNow = now;
      if (view.tYaw !== null) {
        let dy = view.tYaw - view.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        const k = reduceMotion ? 1 : 1 - Math.exp(-dt * 2.1);
        view.yaw += dy * k; view.pitch += (view.tPitch - view.pitch) * k; view.zoom += (view.tZoom - view.zoom) * k;
        if (Math.abs(dy) < 0.0008 && Math.abs(view.tPitch - view.pitch) < 0.0008 && Math.abs(view.tZoom - view.zoom) < 0.002) view.tYaw = null;
      } else if (!reduceMotion && isIdle()) {
        view.yaw += 0.027 * dt; // the slow turning of the sky
      }
      setRot();
      ctx.setTransform(sky.DPR, 0, 0, sky.DPR, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const R = sky.radius(), [cx, cy] = centre();
      const g = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 1.04);
      g.addColorStop(0, 'rgba(30,38,60,0.10)'); g.addColorStop(0.92, 'rgba(30,38,60,0.05)'); g.addColorStop(1, 'rgba(30,38,60,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 1.04, 0, 6.2832); ctx.fill();
      ctx.strokeStyle = 'rgba(233,228,218,0.045)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.2832); ctx.stroke();

      for (const p of P) { const r = rot(p.v); p.sx = cx + r[0] * R; p.sy = cy - r[1] * R; p.z = r[2]; p.on = isVisible(p); }
      ctx.lineWidth = 0.7;
      for (const p of P) {
        if (!p.link || p.z < 0.05 || p.link.z < 0.05) continue;
        ctx.strokeStyle = rgba(famInfo[p.family].colour, (p.on && p.link.on ? 0.075 : 0.015) * Math.min(1, p.z * 2.5));
        ctx.beginPath(); ctx.moveTo(p.sx, p.sy); ctx.lineTo(p.link.sx, p.link.sy); ctx.stroke();
      }
      ctx.globalCompositeOperation = 'lighter';
      const zf = Math.sqrt(view.zoom);
      for (const p of P) {
        if (p.z < 0) continue;
        const edge = Math.min(1, p.z * 3), dim = p.on ? 1 : 0.1, col = famInfo[p.family].colour;
        if (p.neglect == null) {
          ctx.globalCompositeOperation = 'source-over';
          ctx.strokeStyle = rgba(col, 0.38 * edge * dim); ctx.lineWidth = 0.8;
          ctx.beginPath(); ctx.arc(p.sx, p.sy, 2.3 * zf, 0, 6.2832); ctx.stroke();
          ctx.globalCompositeOperation = 'lighter';
          continue;
        }
        const n = p.neglect, n2 = n * n; // 1 = nobody visibly working on it
        const breathe = reduceMotion ? 0.85 : 0.72 + 0.28 * Math.sin(t * (0.5 + p.ph * 0.5) + p.ph * 6.28);
        const size = (2.4 + n2 * 16 * (n > 0.7 ? breathe : 1)) * zf;
        ctx.globalAlpha = (0.16 + 0.62 * n2) * edge * dim * Math.min(1, (0.6 + 0.2 * view.zoom) * p.crowd);
        ctx.drawImage(sprites[p.family], p.sx - size, p.sy - size, size * 2, size * 2);
        if (n < 0.5) { ctx.globalAlpha = 0.55 * edge * dim; ctx.fillStyle = '#dfe5f2'; ctx.fillRect(p.sx - 0.8, p.sy - 0.8, 1.6, 1.6); }
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      ctx.textAlign = 'center'; ctx.font = `500 ${mobile() ? 10 : 11}px ui-sans-serif, system-ui, sans-serif`;
      for (const f of fams) {
        const fi = famInfo[f], r = rot(fi.centre); if (r[2] < 0.25) continue;
        const tw = ctx.measureText(f).width * 1.25 / 2 + 8;
        const lx = Math.max(tw, Math.min(W - tw, cx + r[0] * R)), ly = cy - r[1] * R - fi.cap * R * 0.95 - 8;
        ctx.fillStyle = rgba(fi.colour, Math.min(1, (r[2] - 0.25) * 2) * (isActiveFamily(f) ? 0.75 : 0.25));
        ctx.fillText(f.toUpperCase().split('').join('\u2009'), lx, ly);
      }
      for (const [p, a] of [[sky.hover, 0.6], [sky.selected, 0.9]]) {
        if (!p || p.z < 0) continue;
        ctx.strokeStyle = `rgba(255,217,160,${a})`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(p.sx, p.sy, 9 + (p === sky.selected && !reduceMotion ? Math.sin(t * 2) * 1.5 : 0), 0, 6.2832); ctx.stroke();
      }
    }
    sky.start = function () { requestAnimationFrame(frame); };
    sky.startAt = function (f) { const fi = famInfo[f || fams[0]]; if (fi) { const [yaw, pitch] = anglesFor(fi.centre); view.yaw = yaw + 0.5; view.pitch = pitch * 0.6; } };
    sky.resize();
    return sky;
  }

  global.StuckSky = { create, FAMILY_COLOURS, hash, rgba };
})(window);
