// Procedural night-city backdrop: parallax skyline layers, neon signs, searchlights, flying cars and rain.
// Everything is drawn at runtime, so there are no image assets to license or download.
(() => {
  const canvas = document.getElementById("city");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const NEON = ["#00f0ff", "#ff2a6d", "#fcee0a", "#b967ff"];
  const WINDOW_TINTS = ["255,214,120", "0,240,255", "255,42,109", "185,103,255", "255,255,255"];

  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  let W = 0, H = 0, dpr = 1, sky, layers = [], cars = [], drops = [], raf = 0, last = 0, t = 0;

  const LAYER_SPECS = [
    { color: "#1c1238", minH: 0.32, maxH: 0.62, minW: 40, maxW: 90, win: 2, lit: 0.18, alpha: 0.55, speed: 4, sink: 0.05, signCount: 0 },
    { color: "#120b26", minH: 0.22, maxH: 0.48, minW: 60, maxW: 130, win: 3, lit: 0.22, alpha: 0.75, speed: 10, sink: 0.1, signCount: 3 },
    { color: "#06040d", minH: 0.12, maxH: 0.34, minW: 90, maxW: 190, win: 4, lit: 0.26, alpha: 0.9, speed: 22, sink: 0.18, signCount: 4 },
  ];

  function offscreen(w, h) {
    const c = document.createElement("canvas");
    c.width = Math.ceil(w * dpr);
    c.height = Math.ceil(h * dpr);
    const g = c.getContext("2d");
    g.scale(dpr, dpr);
    return [c, g];
  }

  function buildSky() {
    const [c, g] = offscreen(W, H);
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "#05030b");
    grad.addColorStop(0.55, "#170a2e");
    grad.addColorStop(0.85, "#3a0f45");
    grad.addColorStop(1, "#5c1240");
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    // Smog glow from the city below.
    const glow = g.createRadialGradient(W * 0.6, H * 1.05, 0, W * 0.6, H * 1.05, Math.max(W, H) * 0.7);
    glow.addColorStop(0, "rgba(255,42,109,0.35)");
    glow.addColorStop(1, "rgba(255,42,109,0)");
    g.fillStyle = glow;
    g.fillRect(0, 0, W, H);
    return c;
  }

  // Each layer is a horizontally tileable strip; buildings that cross the edge are drawn on both sides.
  function buildLayer(spec) {
    const scale = Math.min(1, Math.max(0.6, W / 1200));
    const tileW = Math.ceil(Math.max(W, 800) * 1.5);
    const [c, g] = offscreen(tileW, H);
    const signs = [];
    let x = 0;
    while (x < tileW) {
      const w = rand(spec.minW, spec.maxW) * scale;
      const h = H * rand(spec.minH, spec.maxH);
      const b = {
        w, h, top: H - h,
        crown: Math.random() < 0.35 ? { w: w * rand(0.3, 0.6), h: rand(10, 40) * scale } : null,
        antenna: Math.random() < 0.3 ? rand(15, 60) * scale : 0,
        windows: [],
      };
      const cell = spec.win * 3;
      for (let wy = b.top + cell; wy < H - cell; wy += cell) {
        for (let wx = cell * 0.7; wx < w - cell; wx += cell) {
          if (Math.random() < spec.lit) b.windows.push([wx, wy, pick(WINDOW_TINTS), rand(0.25, 0.85)]);
        }
      }
      for (const ox of [x, x - tileW]) drawBuilding(g, ox, b, spec);
      x += w + rand(-8, 14) * scale;
    }
    for (let i = 0; i < spec.signCount; i++) {
      const vertical = Math.random() < 0.6;
      signs.push({
        x: rand(0, tileW),
        y: H * rand(1 - spec.maxH * 0.9, 1 - spec.minH * 0.6),
        w: (vertical ? rand(6, 10) : rand(40, 90)) * scale,
        h: (vertical ? rand(50, 120) : rand(10, 18)) * scale,
        color: pick(NEON),
        phase: rand(0, 100),
        flicker: Math.random() < 0.4,
      });
    }
    return { canvas: c, tileW, signs, ...spec };
  }

  function drawBuilding(g, x, b, spec) {
    g.fillStyle = spec.color;
    g.fillRect(x, b.top, b.w, b.h);
    if (b.crown) g.fillRect(x + (b.w - b.crown.w) / 2, b.top - b.crown.h, b.crown.w, b.crown.h);
    if (b.antenna) {
      const ax = x + b.w * 0.5, ay = b.top - (b.crown?.h ?? 0);
      g.fillRect(ax - 1, ay - b.antenna, 2, b.antenna);
      g.fillStyle = "rgba(255,42,109,0.9)";
      g.fillRect(ax - 1.5, ay - b.antenna - 2, 3, 3);
    }
    for (const [wx, wy, tint, a] of b.windows) {
      g.fillStyle = `rgba(${tint},${a * spec.alpha})`;
      g.fillRect(x + wx, wy, spec.win, spec.win * 1.4);
    }
  }

  function spawnCar(anywhere) {
    const dir = Math.random() < 0.5 ? 1 : -1;
    return {
      x: anywhere ? rand(0, W) : dir > 0 ? -40 : W + 40,
      y: H * rand(0.25, 0.6),
      v: dir * rand(40, 120),
      color: dir > 0 ? "#ff2a6d" : "#fcee0a",
      len: rand(10, 22),
    };
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    canvas.width = Math.ceil(W * dpr);
    canvas.height = Math.ceil(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sky = buildSky();
    layers = LAYER_SPECS.map(buildLayer);
    const small = W < 700;
    cars = Array.from({ length: small ? 3 : 7 }, () => spawnCar(true));
    drops = Array.from({ length: Math.min(small ? 70 : 200, Math.round((W * H) / 8000)) }, () => ({
      x: rand(0, W), y: rand(0, H), len: rand(8, 18), v: rand(500, 900),
    }));
  }

  function drawSearchlights() {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const [i, base] of [0.22, 0.78].entries()) {
      const angle = Math.sin(t * 0.15 + i * 2) * 0.45 - Math.PI / 2;
      const ox = W * base, oy = H;
      const reach = H * 1.2, spread = 0.07;
      const grad = ctx.createLinearGradient(ox, oy, ox + Math.cos(angle) * reach, oy + Math.sin(angle) * reach);
      grad.addColorStop(0, "rgba(0,240,255,0.10)");
      grad.addColorStop(1, "rgba(0,240,255,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(ox + Math.cos(angle - spread) * reach, oy + Math.sin(angle - spread) * reach);
      ctx.lineTo(ox + Math.cos(angle + spread) * reach, oy + Math.sin(angle + spread) * reach);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawLayer(layer, scrollY) {
    const offset = (t * layer.speed) % layer.tileW;
    const y = Math.min(scrollY * layer.sink, H * 0.25);
    for (const x of [-offset, layer.tileW - offset]) {
      if (x > W) continue;
      ctx.drawImage(layer.canvas, x, y, layer.tileW, H);
    }
    for (const s of layer.signs) {
      let sx = (s.x - offset + layer.tileW) % layer.tileW;
      if (sx > W + 100) continue;
      const on = !s.flicker || Math.sin(t * 9 + s.phase) + Math.sin(t * 23 + s.phase) > -1.2;
      ctx.globalAlpha = on ? 0.85 : 0.15;
      ctx.shadowColor = s.color;
      ctx.shadowBlur = 14;
      ctx.fillStyle = s.color;
      ctx.fillRect(sx, s.y + y, s.w, s.h);
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  function frame(now) {
    const dt = Math.min((now - last) / 1000 || 0, 0.05);
    last = now;
    t += dt;
    const scrollY = window.scrollY;

    ctx.drawImage(sky, 0, 0, W, H);
    drawSearchlights();
    drawLayer(layers[0], scrollY);

    for (const c of cars) {
      c.x += c.v * dt;
      if (c.x < -60 || c.x > W + 60) Object.assign(c, spawnCar(false));
      ctx.fillStyle = c.color;
      ctx.shadowColor = c.color;
      ctx.shadowBlur = 8;
      ctx.fillRect(c.x, c.y, c.len * Math.sign(c.v) * -1, 2);
    }
    ctx.shadowBlur = 0;

    drawLayer(layers[1], scrollY);
    drawLayer(layers[2], scrollY);

    ctx.strokeStyle = "rgba(170,200,255,0.22)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const d of drops) {
      d.y += d.v * dt;
      d.x -= d.v * dt * 0.12;
      if (d.y > H) { d.y = -d.len; d.x = rand(0, W * 1.1); }
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x - d.len * 0.12, d.y + d.len);
    }
    ctx.stroke();

    if (!reduceMotion.matches) raf = requestAnimationFrame(frame);
  }

  function start() {
    cancelAnimationFrame(raf);
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  let lastSize = "";
  function onResize() {
    // Mobile browsers resize on address-bar show/hide; only rebuild on meaningful changes.
    const size = `${canvas.clientWidth}x${Math.round(canvas.clientHeight / 150)}`;
    if (size === lastSize) return;
    lastSize = size;
    resize();
    start();
  }

  let resizeTimer;
  window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(onResize, 150); });
  document.addEventListener("visibilitychange", () => (document.hidden ? cancelAnimationFrame(raf) : start()));
  reduceMotion.addEventListener("change", start);
  window.addEventListener("scroll", () => { if (reduceMotion.matches) start(); }, { passive: true });

  onResize();
})();
