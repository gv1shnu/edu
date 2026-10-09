// Night-city backdrop: Warped City parallax layers (CC0, Luis Zuno @ansimuz) plus flying cars and rain.
// The canvas renders at the art's native pixel scale and CSS upscales it with crisp, pixelated edges.
(() => {
  const canvas = document.getElementById("city");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

  const ART_H = 224; // all three layers share this height and are horizontally tileable
  const LAYERS = [
    { src: "assets/warped-city/sky.png", speed: 2, sink: 0 },
    { src: "assets/warped-city/far.png", speed: 6, sink: 0.04 },
    { src: "assets/warped-city/near.png", speed: 14, sink: 0.1 },
  ];
  const CAR_COLORS = ["#ff2a6d", "#fcee0a", "#00f0ff"];

  const rand = (a, b) => a + Math.random() * (b - a);
  let W = 0, H = 0, scale = 1, cars = [], drops = [], raf = 0, last = 0, t = 0;

  function spawnCar(anywhere) {
    const dir = Math.random() < 0.5 ? 1 : -1;
    return {
      x: anywhere ? rand(0, W) : dir > 0 ? -8 : W + 8,
      // Fly in the band between the distant skyline and the near rooftops.
      y: Math.round(H - ART_H + rand(70, 130)),
      v: dir * rand(12, 35),
      color: CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)],
    };
  }

  function resize() {
    const cssW = canvas.clientWidth, cssH = canvas.clientHeight;
    // Integer upscale so the art fills the height; the top of the sky is cropped as needed.
    scale = Math.max(1, Math.ceil(cssH / ART_H));
    W = Math.ceil(cssW / scale);
    H = Math.ceil(cssH / scale);
    canvas.width = W;
    canvas.height = H;
    ctx.imageSmoothingEnabled = false;
    cars = Array.from({ length: W < 200 ? 3 : 6 }, () => spawnCar(true));
    drops = Array.from({ length: Math.round((W * H) / 450) }, () => ({ x: rand(0, W), y: rand(0, H), len: rand(3, 6), v: rand(110, 170) }));
  }

  function drawLayer(layer, scrollY) {
    const { img } = layer;
    const offset = Math.round((t * layer.speed) % img.width);
    const y = H - ART_H + Math.round(Math.min(scrollY / scale * layer.sink, 40));
    for (let x = -offset; x < W; x += img.width) ctx.drawImage(img, x, y);
  }

  function frame(now) {
    const dt = Math.min((now - last) / 1000 || 0, 0.05);
    last = now;
    t += dt;
    const scrollY = window.scrollY;

    drawLayer(LAYERS[0], scrollY);
    for (const c of cars) {
      c.x += c.v * dt;
      if (c.x < -10 || c.x > W + 10) Object.assign(c, spawnCar(false));
      const x = Math.round(c.x);
      ctx.fillStyle = c.color;
      ctx.fillRect(x, c.y, 2, 1);
      ctx.globalAlpha = 0.4;
      ctx.fillRect(c.v > 0 ? x - 4 : x + 2, c.y, 4, 1);
      ctx.globalAlpha = 1;
    }
    drawLayer(LAYERS[1], scrollY);
    drawLayer(LAYERS[2], scrollY);

    ctx.fillStyle = "rgba(170,200,255,0.35)";
    for (const d of drops) {
      d.y += d.v * dt;
      d.x -= d.v * dt * 0.15;
      if (d.y > H) { d.y = -d.len; d.x = rand(0, W * 1.15); }
      ctx.fillRect(Math.round(d.x), Math.round(d.y), 1, d.len);
    }

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

  const loaded = LAYERS.map((layer) => new Promise((resolve, reject) => {
    layer.img = Object.assign(new Image(), { onload: resolve, onerror: reject, src: layer.src });
  }));

  Promise.all(loaded).then(() => {
    let resizeTimer;
    window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(onResize, 150); });
    document.addEventListener("visibilitychange", () => (document.hidden ? cancelAnimationFrame(raf) : start()));
    reduceMotion.addEventListener("change", start);
    window.addEventListener("scroll", () => { if (reduceMotion.matches) start(); }, { passive: true });
    onResize();
  }, (err) => console.warn("City backdrop failed to load:", err));
})();
