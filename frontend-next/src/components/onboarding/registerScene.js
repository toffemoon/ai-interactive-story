// 新手引导 · 柜台两边(3D 访客登记簿)。由原型 register-anim 第 11 版搬来。
// 一张 WebGL 画布、两个镜头:左边(手机上为上)隔着柜台看糖沐,她说的话是她身边的气泡;
// 右边(下)低头看你面前的登记簿——你自己翻开、把名字写在纸上、按下印章,最后拿一张书签离开。
// three.js 只在这个模块里,Home 首访才按需加载;画布外的那些字和按钮由 RegisterOnboarding.jsx 渲染,这里按 data-ob 找。
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { TEXT } from "./registerScene.text";

// her poses, by the numbers of the site's own art in public/home
const TANGMU = { back: "11", lookback: "12", curious: "02", bow: "07", smile: "01", spark: "03", whisper: "04", wry: "10", surprise: "08" };
const BG_URL = "/home/background.webp";
const SEAL_URL = "/brand/seal-192.png";

// The handwriting face, and on the Chinese site the serif printed in the register. They have to be in
// the page before the textures are drawn, so this waits for the stylesheet and then for the glyphs.
function loadFonts(zh, printed) {
  const id = "ais-ob3d-fonts";
  let link = document.getElementById(id);
  const ready = new Promise((resolve) => {
    if (link && link.dataset.loaded) return resolve();
    if (!link) {
      link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      link.href = zh
        ? "https://fonts.googleapis.com/css2?family=Long+Cang&family=Noto+Serif+SC:wght@500;700;900&display=swap"
        : "https://fonts.googleapis.com/css2?family=Long+Cang&display=swap";
      document.head.appendChild(link);
    }
    const done = () => {
      link.dataset.loaded = "1";
      resolve();
    };
    link.addEventListener("load", done, { once: true });
    link.addEventListener("error", resolve, { once: true });
    setTimeout(resolve, 4000);
  });
  return ready.then(() =>
    Promise.all([
      ...(zh ? [900, 700, 500].map((w) => document.fonts.load(`${w} 64px "Noto Serif SC"`, printed).catch(() => null)) : []),
      document.fonts.load('64px "Long Cang"', "0123456789/").catch(() => null),
    ])
  );
}

/**
 * Builds the counter inside `root` and starts it. Resolves to { destroy } once it is running.
 * Throws when the browser has no WebGL; the caller then shows the flat register instead.
 * onDone({ name, to }) is called when a bookmark is picked: to = "explore" | "stay".
 */
export async function mountRegister(root, { zh, onDone }) {
  const $ = (name) => root.querySelector(`[data-ob="${name}"]`);
  const ac = new AbortController();
  const { signal } = ac;
  let dead = false;
  const T = zh ? TEXT.zh : TEXT.en;
  const LINES = T.lines, SUGGESTIONS = T.suggestions, SERIF = T.serif;
  const herEl = $("her"), deskEl = $("desk");
  const bubbleEl = $("bubble"), lineEl = $("line"), saidEl = $("said"), narrEl = $("narr");
  const nameEl = $("name"), hintEl = $("hint"), stampTagEl = $("stamp"), suggestEl = $("suggest");
  const marksEl = $("marks"), skipEl = $("skip"), openEl = $("open");
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const touch = matchMedia("(pointer: coarse)").matches;

  // What she says types itself into the bubble. The rest of the line is laid out but unseen, so the
  // bubble has its final size from the first character; a line she has said before comes back whole.
  // The whole line goes to screen readers at once.
  const shownEl = document.createElement("span"), restEl = document.createElement("span");
  restEl.className = "rest";
  lineEl.replaceChildren(shownEl, restEl);
  const seen = new Set();
  let saidText = "", saidAt = 0;
  function say(text) {
    if (text === saidText) return;
    saidText = text;
    saidAt = seen.has(text) ? -1e9 : performance.now();
    seen.add(text);
    bubbleEl.classList.toggle("off", !text);
    shownEl.textContent = "";
    restEl.textContent = text;
    saidEl.textContent = text;
  }
  function typeOn(now) {
    const n = Math.min(saidText.length, reduceMotion ? Infinity : Math.floor((now - saidAt) / (zh ? 38 : 18)));
    if (shownEl.textContent.length !== n) {
      shownEl.textContent = saidText.slice(0, n);
      restEl.textContent = saidText.slice(n);
    }
  }
  function narrate(text) {
    narrEl.classList.toggle("off", !text);
    if (text) narrEl.textContent = text;
  }

  // a phone keyboard shrinks the visible area; the two sides shrink with it instead of scrolling away
  if (window.visualViewport) {
    const vv = window.visualViewport;
    const fit = () => {
      root.style.setProperty("--vvh", `${Math.round(vv.height)}px`);
      window.scrollTo(0, 0);
    };
    vv.addEventListener("resize", fit, { signal });
    fit();
  }

  // a still film grain over everything
  {
    const c = document.createElement("canvas");
    c.width = c.height = 160;
    const x = c.getContext("2d");
    const d = x.createImageData(160, 160);
    for (let i = 0; i < d.data.length; i += 4) {
      const v = Math.random() * 255;
      d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
      d.data[i + 3] = 255;
    }
    x.putImageData(d, 0, 0);
    $("grain").style.backgroundImage = `url(${c.toDataURL()})`;
  }

  let renderer = null, scene = null, pmrem = null, ro = null;
  const owned = [];
  function destroy() {
    dead = true;
    ac.abort();
    if (ro) ro.disconnect();
    if (import.meta.env.DEV) delete window.__ob;
    if (!renderer) return;
    renderer.setAnimationLoop(null);
    if (scene) {
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        [].concat(o.material || []).forEach((m) => m.dispose());
      });
      if (scene.environment) scene.environment.dispose();
    }
    owned.forEach((t) => t.dispose());
    if (pmrem) pmrem.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
  }

  try {
    // throws without WebGL
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    $('gl').appendChild(renderer.domElement);

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0e1320);
    // one camera for each side of the counter
    const camHer = new THREE.PerspectiveCamera(35, 1, 0.05, 60);
    const camDesk = new THREE.PerspectiveCamera(35, 1, 0.05, 60);
    // reflections come from a rough copy of this shop: amber pendants overhead, the blue window on
    // the left, dim shelves behind; the spot lamp stays the key light
    function shopRoom() {
      const env = new THREE.Scene();
      env.add(new THREE.Mesh(new THREE.BoxGeometry(20, 10, 20), new THREE.MeshBasicMaterial({ color: 0x24150b, side: THREE.BackSide })));
      const panel = (w, h, hex, k, x, y, z, rx = 0, ry = 0) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
          new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k), side: THREE.DoubleSide }));
        m.position.set(x, y, z); m.rotation.set(rx, ry, 0);
        env.add(m);
      };
      panel(1.2, 1.2, 0xffd27a, 6, -2.5, 4.5, -3, Math.PI / 2);
      panel(1.2, 1.2, 0xffd27a, 6, 2.5, 4.5, -3, Math.PI / 2);
      panel(1.5, 1.5, 0xffd27a, 5, 0.5, 4.5, 2, Math.PI / 2);
      panel(4, 5, 0x5b7cc8, 1.2, -9.5, 3, 0, 0, Math.PI / 2);
      panel(16, 4, 0x6a3a14, 0.8, 0, 2.5, -9.5);
      panel(12, 5, 0xffc68a, 1.4, 0, 3, 9.5); // the room on your side of the counter
      return env;
    }
    pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(shopRoom(), 0.04).texture;

    /* ---------- assets ---------- */
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const loader = new THREE.TextureLoader();
    const loadTex = (url) => new Promise((resolve, reject) => {
      loader.load(url, (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = maxAniso;
        owned.push(t);
        resolve(t);
      }, undefined, reject);
    });
    const loadImg = (url) => new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
    const serifGlyphs = [T.slip, T.title, T.shop, ...T.cols].join('');
    // Tangmu's poses, from the shop's own onboarding set (1024 x 1536 art, measured from its alpha).
    // feet: the row her shoes end on; x: the middle of her stance; s: the back views are drawn about
    // 6% small; face: where to centre the portrait beside her lines (eyes a little above the middle)
    const POSES = {
      back: { feet: 1403, x: 524, s: 1.067 },
      lookback: { feet: 1420, x: 485, s: 1.052 },
      curious: { feet: 1500, x: 485, face: [0.49, 0.135] },
      bow: { feet: 1499, x: 543, face: [0.462, 0.142] },
      smile: { feet: 1475, x: 476, face: [0.502, 0.125] },
      spark: { feet: 1468, x: 578, face: [0.462, 0.158] },
      whisper: { feet: 1457, x: 583, face: [0.458, 0.165] },
      wry: { feet: 1510, x: 451, face: [0.49, 0.122] },
      surprise: { feet: 1516, x: 443, face: [0.522, 0.158] },
    };
    const POSE_NAMES = Object.keys(POSES);
    const [[bgImg, sealTex, sealImg], poseList] = await Promise.all([
      Promise.all([loadImg(BG_URL), loadTex(SEAL_URL), loadImg(SEAL_URL)]),
      Promise.all(POSE_NAMES.map((n) => loadTex(`/home/tangmu${TANGMU[n]}.webp`))),
      loadFonts(zh, serifGlyphs),
    ]);
    // taken down while it was still loading
    if (dead) throw new Error('unmounted');

    /* ---------- procedural surfaces ---------- */
    function makeCanvas(w, h) {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      return [c, c.getContext('2d')];
    }
    function canvasTex(c, srgb = true) {
      const t = new THREE.CanvasTexture(c);
      owned.push(t);
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = maxAniso;
      return t;
    }
    function tiled(t, rx, ry) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(rx, ry);
      return t;
    }

    // seeded value noise and fbm, used once at load
    const noise = (() => {
      let s = 7;
      const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
      const perm = Array.from({ length: 256 }, (_, i) => i);
      for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
      const p = new Uint8Array(512);
      for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
      const val = new Float32Array(256);
      for (let i = 0; i < 256; i++) val[i] = rnd() * 2 - 1;
      const h = (a, b) => val[p[(p[a & 255] + b) & 255]];
      const fade = (t) => t * t * (3 - 2 * t);
      // P: the lattice repeats every P cells, for textures that must tile
      return (x, y, P = 256) => {
        const xi = Math.floor(x), yi = Math.floor(y);
        const u = fade(x - xi), v = fade(y - yi);
        const x0 = ((xi % P) + P) % P, y0 = ((yi % P) + P) % P, x1 = (x0 + 1) % P, y1 = (y0 + 1) % P;
        const a = h(x0, y0), b = h(x1, y0), c = h(x0, y1), d = h(x1, y1);
        return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
      };
    })();
    const fbm = (x, y, oct, P = 256) => {
      let sum = 0, amp = 0.5, f = 1;
      for (let i = 0; i < oct; i++) { sum += amp * noise(x * f, y * f, P * f); f *= 2; amp *= 0.5; }
      return sum;
    };

    // walnut, sampled from the painted counter: warped grain, broad tone, pores, varnish
    function makeWood() {
      const w = 1024, h = 512;
      const [c, x] = makeCanvas(w, h);
      const [dc, dx] = makeCanvas(w, h);
      const img = x.createImageData(w, h), dat = dx.createImageData(w, h);
      const dark = [28, 13, 5], light = [80, 40, 17];
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
          const warp = fbm(i / 260, j / 40, 3);
          const fine = Math.pow(0.5 + 0.5 * Math.sin(j / 2.6 + warp * 5), 3);
          const figure = Math.pow(0.5 + 0.5 * Math.sin(j / 11 + warp * 9 + 1.3), 2);
          const grain = fine * 0.6 + figure * 0.4;
          const broad = 0.5 + 0.5 * fbm(i / 140 + 11, j / 200, 2);
          const t = Math.min(1, 0.12 + 0.5 * grain + 0.38 * broad);
          const k = (j * w + i) * 4;
          img.data[k] = dark[0] + (light[0] - dark[0]) * t;
          img.data[k + 1] = dark[1] + (light[1] - dark[1]) * t;
          img.data[k + 2] = dark[2] + (light[2] - dark[2]) * t;
          img.data[k + 3] = 255;
          dat.data[k] = 255 * (0.45 + 0.3 * grain);
          dat.data[k + 1] = 255 * (0.35 + 0.2 * (1 - grain));
          dat.data[k + 3] = 255;
        }
      }
      x.putImageData(img, 0, 0);
      dx.putImageData(dat, 0, 0);
      for (let n = 0; n < 2600; n++) {
        const px = Math.random() * w, py = Math.random() * h, len = 3 + Math.random() * 10;
        x.fillStyle = `rgba(14, 5, 1, ${0.15 + Math.random() * 0.2})`;
        x.fillRect(px, py, len, 1);
        dx.fillStyle = 'rgb(100, 140, 0)';
        dx.fillRect(px, py, len, 1);
      }
      return [c, dc];
    }

    // book cloth weave, one tile: albedo plus a data map (R bump, G roughness)
    const CLOTH = [28, 44, 98];
    function makeClothTile() {
      const n = 256;
      const [c, x] = makeCanvas(n, n);
      const [dc, dx] = makeCanvas(n, n);
      const img = x.createImageData(n, n), dat = dx.createImageData(n, n);
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const over = ((i >> 2) + (j >> 2)) & 1;
          const s = over ? Math.abs(Math.sin((i + 0.5) * Math.PI / 4)) : Math.abs(Math.sin((j + 0.5) * Math.PI / 4));
          const mottle = noise(i / 9 + 3, j / 9) * 0.06;
          const shade = 0.8 + 0.22 * s + mottle;
          const k = (j * n + i) * 4;
          img.data[k] = CLOTH[0] * shade; img.data[k + 1] = CLOTH[1] * shade; img.data[k + 2] = CLOTH[2] * shade;
          img.data[k + 3] = 255;
          dat.data[k] = 255 * (0.25 + 0.7 * s);
          dat.data[k + 1] = 255 * 0.82;
          dat.data[k + 3] = 255;
        }
      }
      x.putImageData(img, 0, 0);
      dx.putImageData(dat, 0, 0);
      return [c, dc];
    }

    // paper fibre: a bump tile shared by every page
    function makeFibre() {
      const n = 512;
      const [c, x] = makeCanvas(n, n);
      const d = x.createImageData(n, n);
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const v = 0.5 + 0.35 * fbm(i / 6, j / 6, 3) + 0.15 * noise(i / 1.5, j / 40);
        const k = (j * n + i) * 4;
        d.data[k] = d.data[k + 1] = d.data[k + 2] = 255 * Math.min(1, Math.max(0, v));
        d.data[k + 3] = 255;
      }
      x.putImageData(d, 0, 0);
      return c;
    }

    // leather for the half binding: a fine pebbled grain crossed by shallow creases, one tile that
    // repeats every 256 px; albedo plus data (R bump, G roughness)
    const LEATHER = [64, 36, 21];
    function makeLeatherTile() {
      const n = 256;
      const [c, x] = makeCanvas(n, n);
      const [dc, dx] = makeCanvas(n, n);
      const img = x.createImageData(n, n), dat = dx.createImageData(n, n);
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const pebble = fbm(i / 2.56, j / 2.56, 2, 100);
          const crease = Math.min(1, Math.pow(1 - Math.min(1, Math.abs(noise(i / 16, j / 16, 16)) * 2.4), 8)
            + 0.5 * Math.pow(1 - Math.min(1, Math.abs(noise(i / 8 + 3, j / 8, 32)) * 2.4), 10));
          const mottle = fbm(i / 32, j / 32, 2, 8);
          const shade = 0.92 + 0.35 * pebble + 0.3 * mottle - 0.35 * crease;
          const k = (j * n + i) * 4;
          img.data[k] = LEATHER[0] * shade; img.data[k + 1] = LEATHER[1] * shade; img.data[k + 2] = LEATHER[2] * shade;
          img.data[k + 3] = 255;
          dat.data[k] = 255 * Math.min(1, Math.max(0, 0.55 + 0.45 * pebble - 0.45 * crease));
          dat.data[k + 1] = 255 * Math.min(1, Math.max(0, 0.5 + 0.25 * crease - 0.15 * pebble));
          dat.data[k + 3] = 255;
        }
      }
      x.putImageData(img, 0, 0);
      dx.putImageData(dat, 0, 0);
      return [c, dc];
    }

    const [leatherC, leatherDataC] = makeLeatherTile();
    const [woodC, woodDataC] = makeWood();
    const woodTex = tiled(canvasTex(woodC), 5, 2.5);
    const woodData = tiled(canvasTex(woodDataC, false), 5, 2.5);
    const [clothTileC, clothDataTileC] = makeClothTile();
    const clothTex = tiled(canvasTex(clothTileC), 5, 7);
    const clothData = tiled(canvasTex(clothDataTileC, false), 5, 7);
    const fibreTex = tiled(canvasTex(makeFibre(), false), 2, 3);

    // half-resolution backdrop: the GPU upscale gives it a soft, out-of-focus look
    const [bgC, bgX] = makeCanvas(836, 470);
    bgX.drawImage(bgImg, 0, 0, 836, 470);
    const bgTex = canvasTex(bgC);

    /* ---------- book dimensions (metres-ish) ---------- */
    const W = 0.62, D = 0.84, COVER_T = 0.014, BLOCK_T = 0.046;
    const HINGE_Y = COVER_T + BLOCK_T;
    const BW = W + 0.012, BD = D + 0.02; // the boards
    // the block is rounded and backed: its spine stands 6 mm proud of the boards' spine edges, and
    // the boards overhang it by 8 mm at the fore-edge, head and tail
    const X_C = -W / 2 - 0.006; // the fold, where every leaf meets the spine
    const PW = W / 2 + 0.004 - X_C, PD = BD - 0.016;
    const PS = 1.5; // pixel scale for every page canvas; layout below is written at 1024 wide
    const PAGE_PX = 1024, PAGE_PY = Math.round(1024 * PD / PW);
    const COVER_PY = Math.round(1024 * BD / BW);

    function pageCanvas(h = PAGE_PY) {
      const [c, x] = makeCanvas(Math.round(PAGE_PX * PS), Math.round(h * PS));
      x.scale(PS, PS);
      return [c, x];
    }

    // cover outside: cloth, worn edges, a pasted title slip (题签), gold foil
    const [coverC, coverX] = pageCanvas(COVER_PY);
    const [coverDC, coverDX] = pageCanvas(COVER_PY);
    coverX.fillStyle = coverX.createPattern(clothTileC, 'repeat');
    coverX.fillRect(0, 0, PAGE_PX, COVER_PY);
    coverDX.fillStyle = coverDX.createPattern(clothDataTileC, 'repeat');
    coverDX.fillRect(0, 0, PAGE_PX, COVER_PY);
    const wear = (x0, y0, x1, y1) => {
      const g = coverX.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, 'rgba(190, 200, 225, 0.22)');
      g.addColorStop(1, 'rgba(190, 200, 225, 0)');
      return g;
    };
    [[0, 0, 0, 34, 0, 0, PAGE_PX, 34], [0, COVER_PY, 0, COVER_PY - 34, 0, COVER_PY - 34, PAGE_PX, 34],
     [PAGE_PX, 0, PAGE_PX - 34, 0, PAGE_PX - 34, 0, 34, COVER_PY]].forEach(([a, b, c2, d, rx, ry, rw, rh]) => {
      coverX.fillStyle = wear(a, b, c2, d);
      coverX.fillRect(rx, ry, rw, rh);
    });
    // half binding: a leather strip down the spine side of each board and leather corners at the
    // fore-edge (modelled further down); the cloth panel between them carries the slip and the foil
    const BAND_W = 0.085, LEG = 0.075;
    const BAND_PX = BAND_W / BW * PAGE_PX, FILLET_X = BAND_PX + 8;
    const SLIP_X = 196;
    // title slip
    coverX.save();
    coverX.shadowColor = 'rgba(0, 0, 0, 0.4)'; coverX.shadowBlur = 8; coverX.shadowOffsetY = 3;
    coverX.fillStyle = '#ece1c8';
    coverX.fillRect(SLIP_X, 120, 150, 560);
    coverX.restore();
    coverX.strokeStyle = '#8a7454'; coverX.lineWidth = 3;
    coverX.strokeRect(SLIP_X + 11, 131, 128, 538);
    coverX.fillStyle = '#2b2118';
    coverX.font = `900 92px ${SERIF}`;
    coverX.textAlign = 'center'; coverX.textBaseline = 'middle';
    if (zh) Array.from(T.slip).forEach((ch, i) => coverX.fillText(ch, SLIP_X + 75, 225 + i * 118));
    else {
      // an English title runs down the slip, read with the head tilted, as on a spine
      coverX.save();
      coverX.translate(SLIP_X + 75, 400);
      coverX.rotate(Math.PI / 2);
      coverX.font = `700 76px ${SERIF}`;
      coverX.scale(Math.min(1, 500 / coverX.measureText(T.slip).width), 1);
      coverX.fillText(T.slip, 0, 0);
      coverX.restore();
    }
    coverDX.fillStyle = 'rgb(150, 235, 0)';
    coverDX.fillRect(SLIP_X, 120, 150, 560);
    // gold foil: colour in the albedo, metal and low roughness in the data map. One fillet frames
    // the cloth: down the edge of the leather strip, and under the leather corners
    const foil = coverX.createLinearGradient(0, COVER_PY - 220, PAGE_PX, COVER_PY - 80);
    foil.addColorStop(0, '#b0823a'); foil.addColorStop(0.5, '#f1d48c'); foil.addColorStop(1, '#a87a34');
    [[coverX, foil], [coverDX, 'rgb(230, 70, 255)']].forEach(([ctx, style]) => {
      ctx.fillStyle = style; ctx.strokeStyle = style;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `700 54px ${SERIF}`;
      ctx.fillText(T.shop, (FILLET_X + PAGE_PX - 46) / 2, COVER_PY - 150);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(FILLET_X, 46); ctx.lineTo(PAGE_PX - 46, 46); ctx.lineTo(PAGE_PX - 46, COVER_PY - 46);
      ctx.lineTo(FILLET_X, COVER_PY - 46); ctx.closePath();
      ctx.stroke();
    });
    const coverTex = canvasTex(coverC);
    const coverData = canvasTex(coverDC, false);

    // inside of the boards: the pastedown, with the cloth turned in over the edges framing it
    const TURN_PX = Math.round(0.012 / BW * PAGE_PX);
    const [endC, endX] = pageCanvas(COVER_PY);
    endX.fillStyle = endX.createPattern(clothTileC, 'repeat');
    endX.fillRect(0, 0, PAGE_PX, COVER_PY);
    // the leather turns in too: at head and tail along the spine strip, and round each corner
    const leatherFill = endX.createPattern(leatherC, 'repeat');
    leatherFill.setTransform(new DOMMatrix().scale(0.63));
    endX.fillStyle = leatherFill;
    const LEG_PX = LEG / BW * PAGE_PX;
    [[0, 0, BAND_PX, TURN_PX], [0, COVER_PY - TURN_PX, BAND_PX, TURN_PX],
     [PAGE_PX - LEG_PX, 0, LEG_PX, TURN_PX], [PAGE_PX - TURN_PX, 0, TURN_PX, LEG_PX],
     [PAGE_PX - LEG_PX, COVER_PY - TURN_PX, LEG_PX, TURN_PX], [PAGE_PX - TURN_PX, COVER_PY - LEG_PX, TURN_PX, LEG_PX],
    ].forEach(([x, y, w, h]) => endX.fillRect(x, y, w, h));
    endX.save();
    endX.shadowColor = 'rgba(0, 0, 0, 0.55)'; endX.shadowBlur = 5;
    endX.fillStyle = '#28345a';
    endX.fillRect(0, TURN_PX, PAGE_PX - TURN_PX, COVER_PY - 2 * TURN_PX);
    endX.restore();
    endX.fillStyle = 'rgba(214, 178, 106, 0.16)';
    for (let y = TURN_PX + 30; y < COVER_PY - TURN_PX - 10; y += 56) {
      for (let x = Math.round(y / 56) % 2 ? 40 : 68; x < PAGE_PX - TURN_PX - 10; x += 56) {
        endX.beginPath(); endX.arc(x, y, 3, 0, Math.PI * 2); endX.fill();
      }
    }
    endX.strokeStyle = 'rgba(225, 215, 190, 0.22)'; endX.lineWidth = 1.2;
    endX.beginPath();
    endX.moveTo(0, TURN_PX + 0.6); endX.lineTo(PAGE_PX - TURN_PX - 0.6, TURN_PX + 0.6);
    endX.lineTo(PAGE_PX - TURN_PX - 0.6, COVER_PY - TURN_PX - 0.6); endX.lineTo(0, COVER_PY - TURN_PX - 0.6);
    endX.stroke();
    const endTex = canvasTex(endC);

    // page edges: 240 leaves sewn in signatures of 12. Rows are leaves (the top leaf at the top),
    // columns run along the edge; each edge then gets its own wear
    function makeEdge(wear) {
      const [c, x] = makeCanvas(512, 512);
      x.fillStyle = '#e6dac0'; x.fillRect(0, 0, 512, 512);
      const LEAVES = 240, h = 512 / LEAVES;
      for (let n = 0; n < LEAVES; n++) {
        const y = n * h;
        x.fillStyle = `rgba(105, 80, 45, ${0.05 + Math.random() * 0.1 + (n % 12 === 11 ? 0.16 : 0)})`;
        x.fillRect(0, y + h * 0.55, 512, h * 0.45);
        if (Math.random() < 0.18) {
          // a leaf standing a hair proud catches the light for part of its length
          x.fillStyle = 'rgba(255, 250, 235, 0.3)';
          x.fillRect(Math.random() * 400, y, 80 + Math.random() * 300, h * 0.5);
        }
      }
      // the outermost leaves have yellowed more
      const g = x.createLinearGradient(0, 0, 0, 512);
      g.addColorStop(0, 'rgba(150, 110, 50, 0.16)'); g.addColorStop(0.12, 'rgba(150, 110, 50, 0)');
      g.addColorStop(0.88, 'rgba(150, 110, 50, 0)'); g.addColorStop(1, 'rgba(150, 110, 50, 0.16)');
      x.fillStyle = g; x.fillRect(0, 0, 512, 512);
      wear(x);
      return c;
    }
    const edgeMatOf = (c) => new THREE.MeshStandardMaterial({
      map: canvasTex(c), bumpMap: canvasTex(c, false), bumpScale: 0.25, roughness: 0.9, envMapIntensity: 0.25,
    });
    // fore-edge (head at the left): thumbed grey toward the tail, where the pages get turned
    const foreEdgeMat = edgeMatOf(makeEdge((x) => {
      const g = x.createLinearGradient(330, 0, 512, 0);
      g.addColorStop(0, 'rgba(70, 55, 40, 0)'); g.addColorStop(1, 'rgba(70, 55, 40, 0.22)');
      x.fillStyle = g; x.fillRect(330, 0, 182, 512);
    }));
    // head (spine at the left): a film of dust settles on the top edge
    const headEdgeMat = edgeMatOf(makeEdge((x) => {
      x.fillStyle = 'rgba(120, 110, 95, 0.14)'; x.fillRect(0, 0, 512, 512);
    }));
    // tail (spine at the left): thumbed toward the fore-edge corner
    const tailEdgeMat = edgeMatOf(makeEdge((x) => {
      const g = x.createLinearGradient(360, 0, 512, 0);
      g.addColorStop(0, 'rgba(70, 55, 40, 0)'); g.addColorStop(1, 'rgba(70, 55, 40, 0.24)');
      x.fillStyle = g; x.fillRect(360, 0, 152, 512);
    }));

    // paper ground with mottling, fibres, vignette and the shadow where pages dip into the spine
    const [mottleC, mottleX] = makeCanvas(96, Math.round(96 * PAGE_PY / PAGE_PX));
    {
      const d = mottleX.createImageData(mottleC.width, mottleC.height);
      for (let j = 0; j < mottleC.height; j++) for (let i = 0; i < mottleC.width; i++) {
        const v = fbm(i / 22, j / 22, 3);
        const k = (j * mottleC.width + i) * 4;
        d.data[k] = 120; d.data[k + 1] = 92; d.data[k + 2] = 52;
        d.data[k + 3] = 255 * Math.max(0, v) * 0.16;
      }
      mottleX.putImageData(d, 0, 0);
    }
    function paper(ctx, gutter) {
      ctx.fillStyle = '#eee3cb';
      ctx.fillRect(0, 0, PAGE_PX, PAGE_PY);
      ctx.drawImage(mottleC, 0, 0, PAGE_PX, PAGE_PY);
      for (let i = 0; i < 5000; i++) {
        ctx.fillStyle = `rgba(90, 70, 40, ${Math.random() * 0.06})`;
        ctx.fillRect(Math.random() * PAGE_PX, Math.random() * PAGE_PY, 0.8 + Math.random() * 2.2, 0.6);
      }
      const g = ctx.createRadialGradient(PAGE_PX / 2, PAGE_PY / 2, PAGE_PY * 0.3, PAGE_PX / 2, PAGE_PY / 2, PAGE_PY * 0.78);
      g.addColorStop(0, 'rgba(120, 90, 50, 0)');
      g.addColorStop(1, 'rgba(120, 90, 50, 0.2)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, PAGE_PX, PAGE_PY);
      if (gutter) {
        const atLeft = gutter === 'left';
        const gg = ctx.createLinearGradient(atLeft ? 0 : PAGE_PX, 0, atLeft ? 110 : PAGE_PX - 110, 0);
        gg.addColorStop(0, 'rgba(70, 48, 22, 0.42)');
        gg.addColorStop(0.35, 'rgba(70, 48, 22, 0.14)');
        gg.addColorStop(1, 'rgba(70, 48, 22, 0)');
        ctx.fillStyle = gg;
        ctx.fillRect(atLeft ? 0 : PAGE_PX - 110, 0, 110, PAGE_PY);
      }
    }
    const INK = '#1d2747';
    function inkOn(ctx) {
      ctx.fillStyle = INK;
      ctx.shadowColor = 'rgba(29, 39, 71, 0.45)';
      ctx.shadowBlur = 2;
    }
    function inkOff(ctx) { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; }

    // title page (front of the page that turns)
    const [titleC, titleX] = pageCanvas();
    paper(titleX, 'left');
    titleX.textAlign = 'center'; titleX.textBaseline = 'alphabetic';
    titleX.fillStyle = '#2b2118';
    titleX.font = zh ? `900 128px ${SERIF}` : `700 88px ${SERIF}`;
    titleX.fillText(T.title, PAGE_PX / 2, PAGE_PY * 0.38);
    titleX.fillStyle = '#6b5a40';
    titleX.font = `500 44px ${SERIF}`;
    titleX.fillText(T.shop, PAGE_PX / 2, PAGE_PY * 0.38 + 90);
    titleX.globalCompositeOperation = 'multiply';
    titleX.globalAlpha = 0.9;
    titleX.drawImage(sealImg, PAGE_PX / 2 - 100, PAGE_PY * 0.56, 200, 200);
    titleX.globalAlpha = 1;
    titleX.globalCompositeOperation = 'source-over';
    const titleTex = canvasTex(titleC);

    // the register table, shared by the left (empty) and right (today) pages
    const COLS = [80, 300, 640, 944];
    const TABLE_TOP = 210, HEAD_H = 84, ROW_H = 140, ROWS = 7;
    function table(ctx, withHeader) {
      ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
      ctx.fillStyle = '#2b2118';
      ctx.font = `700 56px ${SERIF}`;
      if (withHeader) ctx.fillText(T.title, 80, 140);
      ctx.fillStyle = '#6b5a40';
      ctx.font = `500 34px ${SERIF}`;
      ctx.textAlign = 'right';
      ctx.fillText(T.shop, 944, 140);
      ctx.textAlign = 'left';
      ctx.font = `500 42px ${SERIF}`;
      ctx.fillText(T.cols[0], COLS[0] + 10, TABLE_TOP + 58);
      ctx.fillText(T.cols[1], COLS[1] + 20, TABLE_TOP + 58);
      ctx.fillText(T.cols[2], COLS[2] + 20, TABLE_TOP + 58);
      ctx.strokeStyle = '#8a7454'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(COLS[0], TABLE_TOP + HEAD_H); ctx.lineTo(COLS[3], TABLE_TOP + HEAD_H); ctx.stroke();
      ctx.lineWidth = 2;
      for (let r = 1; r <= ROWS; r++) {
        ctx.strokeStyle = r === 1 ? '#b9a77f' : '#cfc0a0';
        const y = TABLE_TOP + HEAD_H + r * ROW_H;
        ctx.beginPath(); ctx.moveTo(COLS[0], y); ctx.lineTo(COLS[3], y); ctx.stroke();
      }
      ctx.strokeStyle = '#cfc0a0';
      [COLS[1], COLS[2]].forEach((x) => {
        ctx.beginPath(); ctx.moveTo(x, TABLE_TOP + 8); ctx.lineTo(x, TABLE_TOP + HEAD_H + ROWS * ROW_H); ctx.stroke();
      });
    }
    // the back of the turning page: its spine edge is on the canvas's right, since the texture is mirrored
    const [leftC, leftX] = pageCanvas();
    paper(leftX, 'right');
    table(leftX, true);
    const leftTex = canvasTex(leftC);
    leftTex.repeat.x = -1; leftTex.offset.x = 1;

    const [regBase, regBaseX] = pageCanvas();
    paper(regBaseX, 'left');
    table(regBaseX, false);
    const [regC, regX] = pageCanvas();
    const regTex = canvasTex(regC);
    const today = new Date();
    const dateText = `${today.getMonth() + 1}/${today.getDate()}`;
    const ROW1_BASE = TABLE_TOP + HEAD_H + ROW_H - 38;
    // the seal goes in the middle of today's 店章 cell, the size of the stamp on the counter
    const STAMP_S = 0.085;
    const STAMP_PX = { x: (COLS[2] + COLS[3]) / 2, y: TABLE_TOP + HEAD_H + ROW_H / 2, size: STAMP_S / PW * PAGE_PX };
    // the name in ink; while an input method is still composing, its letters in pencil after it
    let typedName = '', draftText = '';
    let caretOn = true, writing = false;
    let stampedAt = null;
    function drawRegister() {
      regX.drawImage(regBase, 0, 0, PAGE_PX, PAGE_PY);
      regX.textBaseline = 'alphabetic'; regX.textAlign = 'left';
      inkOn(regX);
      regX.font = '88px "Long Cang", "Kaiti SC", "STKaiti", cursive';
      regX.fillText(dateText, COLS[0] + 12, ROW1_BASE);
      inkOff(regX);
      regX.save();
      regX.translate(COLS[1] + 22, ROW1_BASE + 4);
      regX.rotate(-0.018);
      regX.font = '100px "Long Cang", "Kaiti SC", "STKaiti", cursive';
      // a long name is squeezed to fit the cell, as a hand would
      const full = typedName + draftText;
      const room = COLS[2] - COLS[1] - 52, wFull = regX.measureText(full).width;
      regX.scale(Math.min(1, room / Math.max(wFull, 1)), 1);
      if (typedName) { inkOn(regX); regX.fillText(typedName, 0, 0); inkOff(regX); }
      if (draftText) {
        regX.fillStyle = 'rgba(70, 62, 52, 0.42)';
        regX.fillText(draftText, regX.measureText(typedName).width, 0);
      }
      if (writing && caretOn) {
        regX.fillStyle = INK;
        regX.fillRect(wFull + (full ? 8 : 2), -82, 5, 88);
      }
      regX.restore();
      if (stampedAt !== null) {
        regX.save();
        regX.globalCompositeOperation = 'multiply';
        regX.globalAlpha = 0.9;
        regX.translate(STAMP_PX.x, STAMP_PX.y);
        regX.rotate(stampedAt);
        regX.drawImage(sealImg, -STAMP_PX.size / 2, -STAMP_PX.size / 2, STAMP_PX.size, STAMP_PX.size);
        regX.restore();
      }
      regTex.needsUpdate = true;
    }

    /* ---------- scene ---------- */
    // backdrop: the real bookshop art, far behind and slightly soft
    const bgH = 10.5, bgW = bgH * (1672 / 941);
    const bg = new THREE.Mesh(
      new THREE.PlaneGeometry(bgW, bgH),
      new THREE.MeshBasicMaterial({ map: bgTex, color: 0xb8b2aa, toneMapped: false })
    );
    bg.position.set(0, 1.9, -8);
    scene.add(bg);

    // Tangmu. A small shader grades the flat anime art into the shop's warm low light and adds a
    // warm rim from the pendant lamps behind her and a cool one from the window on the left.
    // Her feet (row 1493 of 1536 in the art) stand on the floor, 30 cm behind the counter's back edge.
    const SPRITE_H = 2.72, SPRITE_W = SPRITE_H * 2 / 3;
    const SPRITE_POS = new THREE.Vector3(0.4, SPRITE_H / 2 - SPRITE_H * (1 - 1493 / 1536), -1.05);
    const spriteGeo = new THREE.PlaneGeometry(SPRITE_W, SPRITE_H);
    const spriteFrag = `
      uniform sampler2D map;
      uniform float opacity;
      uniform vec2 texel;
      uniform vec3 gain, lift, warmRim, coolRim;
      uniform float shade;
      varying vec2 vUv;
      void main() {
        vec4 c = texture2D(map, vUv);
        if (c.a < 0.003) discard;
        float aL = texture2D(map, vUv - vec2(texel.x, 0.0)).a;
        float aR = texture2D(map, vUv + vec2(texel.x, 0.0)).a;
        float aD = texture2D(map, vUv - vec2(0.0, texel.y)).a;
        float aU = texture2D(map, vUv + vec2(0.0, texel.y)).a;
        vec2 grad = vec2(aR - aL, aU - aD);
        float edge = clamp(length(grad) * 1.4, 0.0, 1.0) * c.a;
        vec2 n = length(grad) > 0.0001 ? -normalize(grad) : vec2(0.0);
        float warm = max(dot(n, normalize(vec2(0.55, 0.85))), 0.0);
        float cool = max(dot(n, normalize(vec2(-0.9, 0.35))), 0.0);
        vec3 col = lift + c.rgb * (gain - lift);
        col *= mix(1.0 - shade, 1.0, smoothstep(0.18, 0.7, vUv.y));
        col += warmRim * warm * edge + coolRim * cool * edge;
        gl_FragColor = vec4(col, c.a * opacity);
        #include <colorspace_fragment>
      }`;
    const mkSprite = (map) => new THREE.Mesh(spriteGeo, new THREE.ShaderMaterial({
      uniforms: {
        map: { value: map },
        opacity: { value: 1 },
        texel: { value: new THREE.Vector2(3 / map.image.width, 3 / map.image.height) },
        gain: { value: new THREE.Vector3(0.86, 0.78, 0.66) },
        lift: { value: new THREE.Vector3(0.006, 0.004, 0.003) },
        warmRim: { value: new THREE.Vector3(0.55, 0.36, 0.14) },
        coolRim: { value: new THREE.Vector3(0.1, 0.15, 0.3) },
        shade: { value: 0.22 },
      },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: spriteFrag,
      transparent: true, depthWrite: false, toneMapped: false,
    }));
    // poses swap like a visual novel: the new one goes in opaque underneath and the old one fades out
    // over it in a fifth of a second; a lively change can also give a small hop. Every pose stands
    // with its feet where the first one stood.
    const poseTex = {}, poseAlpha = {};
    POSE_NAMES.forEach((n, i) => {
      poseTex[n] = poseList[i];
      // a coarse alpha map, to tell a click on her from a click beside her
      const [c, x] = makeCanvas(48, 72);
      x.drawImage(poseList[i].image, 0, 0, 48, 72);
      const d = x.getImageData(0, 0, 48, 72).data;
      poseAlpha[n] = (u, v) => d[(Math.min(71, Math.floor((1 - v) * 72)) * 48 + Math.min(47, Math.floor(u * 48))) * 4 + 3];
    });
    const FEET_X = SPRITE_POS.x + (476 / 1024 - 0.5) * SPRITE_W;
    const sprites = [mkSprite(poseTex.smile), mkSprite(poseTex.smile)];
    sprites.forEach((m) => { m.position.z = SPRITE_POS.z; m.userData.base = { x: 0, y: 0, s: 1 }; scene.add(m); });
    // the swap runs on wall-clock time, so it finishes even when frames come slowly
    let poseName = null, front = 0, swapAt = -1, hopH = 0;
    function setPose(name, hop = 0) {
      if (name === poseName) return;
      const first = poseName === null;
      poseName = name;
      const out = sprites[front], into = sprites[1 - front];
      const tex = poseTex[name], p = POSES[name], s = p.s || 1;
      into.material.uniforms.map.value = tex;
      into.material.uniforms.texel.value.set(3 / tex.image.width, 3 / tex.image.height);
      // 18 rows of shoe sink into the floor, as the first pose always had
      into.userData.base = { x: FEET_X - (p.x / 1024 - 0.5) * SPRITE_W * s, y: SPRITE_H * s * ((p.feet + 18) / 1536 - 0.5), s };
      into.renderOrder = 1;
      into.material.uniforms.opacity.value = 1;
      into.visible = true;
      out.renderOrder = 2;
      front = 1 - front;
      out.visible = !first;
      swapAt = first ? -1 : performance.now() / 1000;
      hopH = hop;
    }
    setPose('smile');

    // the counter: a varnished walnut cabinet down to the floor
    const counter = new THREE.Mesh(
      new RoundedBoxGeometry(7, 0.9, 2.4, 3, 0.012),
      new THREE.MeshPhysicalMaterial({
        map: woodTex, roughnessMap: woodData, bumpMap: woodData, bumpScale: 0.5,
        roughness: 1, metalness: 0, clearcoat: 0.45, clearcoatRoughness: 0.25, envMapIntensity: 0.4,
      })
    );
    counter.position.set(0, 0.45, 0.45);
    counter.receiveShadow = true;
    scene.add(counter);

    // the floor on her side, and a soft shadow where she stands
    const floorTex = woodTex.clone();
    floorTex.needsUpdate = true;
    floorTex.repeat.set(7, 4);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 7.5),
      new THREE.MeshStandardMaterial({ map: floorTex, color: 0x8a6a55, roughness: 0.7, envMapIntensity: 0.3 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, -4.5);
    floor.receiveShadow = true;
    scene.add(floor);
    const [footC, footX] = makeCanvas(128, 64);
    const fg = footX.createRadialGradient(64, 32, 2, 64, 32, 62);
    fg.addColorStop(0, 'rgba(0, 0, 0, 0.7)'); fg.addColorStop(1, 'rgba(0, 0, 0, 0)');
    footX.fillStyle = fg;
    footX.save(); footX.scale(1, 0.5); footX.fillRect(0, 0, 128, 128); footX.restore();
    const footShadow = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.36),
      new THREE.MeshBasicMaterial({ map: canvasTex(footC, false), transparent: true, depthWrite: false }));
    footShadow.rotation.x = -Math.PI / 2;
    footShadow.position.set(0.4 + (0.47 - 0.5) * 1.2, 0.003, -1.0);
    scene.add(footShadow);

    // lights: the painting's amber pendant is the key; a cool window rim; a soft fill from where you stand
    scene.add(new THREE.HemisphereLight(0x8fa3d6, 0x2a1408, 0.45));
    const lamp = new THREE.SpotLight(0xffd88a, 40, 0, 0.6, 0.85, 2);
    lamp.position.set(0.55, 3.3, 1.9);
    lamp.target.position.set(0, 0.9, 0.45);
    lamp.castShadow = true;
    lamp.shadow.mapSize.set(2048, 2048);
    lamp.shadow.bias = -0.0004;
    lamp.shadow.normalBias = 0.02;
    lamp.shadow.radius = 5;
    scene.add(lamp, lamp.target);
    const rim = new THREE.DirectionalLight(0x8fa8ff, 0.5);
    rim.position.set(-3, 2.5, -1);
    const fill = new THREE.DirectionalLight(0xffc98a, 0.32);
    fill.position.set(0, 1.4, 5);
    // the pendant over her side of the counter, so what she holds is lit
    const nearLamp = new THREE.PointLight(0xffd9a6, 2.4, 3.5, 2);
    nearLamp.position.set(0.55, 2.45, -0.25);
    scene.add(rim, fill, nearLamp);

    // the book
    const sheen = { sheen: 0.45, sheenRoughness: 0.55, sheenColor: new THREE.Color(0x6f86c2) };
    const clothMat = new THREE.MeshPhysicalMaterial({
      map: clothTex, roughnessMap: clothData, bumpMap: clothData, bumpScale: 0.8,
      roughness: 1, envMapIntensity: 0.35, ...sheen,
    });
    const coverOutMat = new THREE.MeshPhysicalMaterial({
      map: coverTex, roughnessMap: coverData, metalnessMap: coverData, bumpMap: coverData, bumpScale: 0.8,
      roughness: 1, metalness: 1, envMapIntensity: 0.9, ...sheen,
    });
    const endMat = new THREE.MeshStandardMaterial({ map: endTex, roughness: 0.85, envMapIntensity: 0.3 });
    const leatherMat = new THREE.MeshPhysicalMaterial({
      map: tiled(canvasTex(leatherC), 1, 1), roughnessMap: tiled(canvasTex(leatherDataC, false), 1, 1),
      bumpMap: tiled(canvasTex(leatherDataC, false), 1, 1), bumpScale: 0.6,
      roughness: 1, clearcoat: 0.3, clearcoatRoughness: 0.45, envMapIntensity: 0.6,
    });
    // the corners are rubbed paler at the tip (vertex colours)
    const cornerMat = leatherMat.clone();
    cornerMat.vertexColors = true;
    const paperMat = new THREE.MeshStandardMaterial({ color: 0xeee3cb, roughness: 0.95, envMapIntensity: 0.25 });
    const pageMat = (map, side) => new THREE.MeshStandardMaterial({
      map, side, roughness: 0.93, bumpMap: fibreTex, bumpScale: 0.35, envMapIntensity: 0.25,
    });

    const book = new THREE.Group();
    scene.add(book);
    const backCover = new THREE.Mesh(new RoundedBoxGeometry(BW, COVER_T, BD, 2, 0.005),
      [clothMat, clothMat, endMat, clothMat, clothMat, clothMat]);
    backCover.position.set(-W / 2 + BW / 2, COVER_T / 2, 0);

    const coverPivot = new THREE.Group();
    coverPivot.position.set(-W / 2, HINGE_Y, 0);
    const coverMesh = new THREE.Mesh(new RoundedBoxGeometry(BW, COVER_T, BD, 2, 0.005),
      [clothMat, clothMat, coverOutMat, endMat, clothMat, clothMat]);
    coverMesh.position.set(BW / 2, COVER_T / 2, 0);
    coverPivot.add(coverMesh);
    // once past upright the spine gives and the cover settles flat on the counter, its spine edge
    // 12 mm out from the back board's
    const PIVOT_OPEN = new THREE.Vector2(-W / 2 - 0.012, COVER_T);

    // the leaves. Each is sampled across its width from the fold (S) and only bends that way;
    // the fore-edge corners are worn round.
    const sstep = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
    const S = [];
    for (let s = 0; s < 0.1 - 1e-6; s += 0.004) S.push(s);
    for (let s = 0.1; s < PW - 0.02; s += 0.02) S.push(s);
    for (let s = PW - 0.012; s < PW - 1e-6; s += 0.003) S.push(s);
    S.push(PW);
    const NS = S.length - 1;
    const ZS = [];
    [0, 0.0033, 0.0067, 0.01].forEach((d) => ZS.push(-PD / 2 + d));
    for (let i = 0; i <= 8; i++) ZS.push(-PD / 2 + 0.04 + (PD - 0.08) * i / 8);
    [0.01, 0.0067, 0.0033, 0].forEach((d) => ZS.push(PD / 2 - d));
    const NZ = ZS.length - 1;
    const CORNER_R = 0.01;
    function roundCorner(s, z) {
      const dx = s - (PW - CORNER_R), dz = Math.abs(z) - (PD / 2 - CORNER_R);
      if (dx <= 0 || dz <= 0) return [s, z];
      const m = Math.max(dx, dz);
      const a = dx >= dz ? (Math.PI / 4) * (dz / dx) : Math.PI / 2 - (Math.PI / 4) * (dx / dz);
      return [PW - CORNER_R + m * Math.cos(a), Math.sign(z) * (PD / 2 - CORNER_R + m * Math.sin(a))];
    }
    function locate(s) {
      let i = 0;
      while (i < NS - 1 && S[i + 1] < s) i++;
      return [i, Math.min(1, (s - S[i]) / (S[i + 1] - S[i]))];
    }

    // the fold: shut, the top leaf lies flat at HINGE_Y; open, the fold sinks to C_OPEN, the
    // right-hand leaves curve down into it over GUT_L and the turned leaf drapes onto the cover
    const C_OPEN = 0.032, GUT_L = 0.08;
    const riseR = (u, depth) => (u < GUT_L ? depth * 2.4 * Math.pow(1 - u / GUT_L, 1.4) / GUT_L : 0);
    let dropL = COVER_T + 0.0012 - (C_OPEN + 0.0018);
    const heightL = (u) => { const b = u / 0.005; return 0.002 * b * Math.exp(1 - b) + dropL * sstep(0.004, 0.042, u); };
    const riseL = (u) => (heightL(u + 0.0005) - heightL(u - 0.0005)) / 0.001;
    // a leaf's section from the fold: theta is its angle there, curl how far the fore-edge leads (+)
    // or trails (−), gut how far the book has relaxed open
    function leafShape(theta, curl, gut, xs, ys) {
      const depth = (HINGE_Y - C_OPEN) * gut;
      const wR = 1 - sstep(0, 1.1, theta), wL = sstep(Math.PI - 1.1, Math.PI, theta);
      xs[0] = 0; ys[0] = 0;
      for (let i = 0; i < NS; i++) {
        const sm = (S[i] + S[i + 1]) / 2, ds = S[i + 1] - S[i];
        let phi = theta + curl * Math.pow(sm / PW, 1.5);
        if (wR > 0) phi += wR * Math.atan(riseR(sm, depth));
        if (wL > 0) phi -= wL * Math.atan(riseL(sm));
        phi = Math.min(Math.PI + 0.8, Math.max(0, phi));
        xs[i + 1] = xs[i] + Math.cos(phi) * ds;
        ys[i + 1] = ys[i] + Math.sin(phi) * ds;
      }
    }
    const regXs = new Float32Array(NS + 1), regYs = new Float32Array(NS + 1);
    const leafXs = new Float32Array(NS + 1), leafYs = new Float32Array(NS + 1);
    // the drape is integrated along the leaf, so scale it until the leaf really lands on the cover
    for (let n = 0; n < 4; n++) {
      leafShape(Math.PI, 0, 1, leafXs, leafYs);
      dropL *= (COVER_T + 0.0012 - (C_OPEN + 0.0018)) / leafYs[NS];
    }

    function leafGeometry() {
      const n = (NS + 1) * (NZ + 1);
      const pos = new Float32Array(n * 3), uv = new Float32Array(n * 2);
      const seg = new Uint16Array(n), frac = new Float32Array(n);
      let v = 0;
      for (let k = 0; k <= NZ; k++) for (let i = 0; i <= NS; i++, v++) {
        const [s, z] = roundCorner(S[i], ZS[k]);
        [seg[v], frac[v]] = locate(s);
        pos[v * 3 + 2] = z;
        uv[v * 2] = s / PW; uv[v * 2 + 1] = 0.5 - z / PD;
      }
      const idx = [];
      for (let k = 0; k < NZ; k++) for (let i = 0; i < NS; i++) {
        const a = k * (NS + 1) + i, c = a + NS + 1;
        idx.push(a, c, a + 1, a + 1, c, c + 1);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.userData = { seg, frac };
      return g;
    }
    function setLeaf(g, xs, ys) {
      const p = g.attributes.position.array, { seg, frac } = g.userData;
      for (let v = 0; v < seg.length; v++) {
        const i = seg[v], f = frac[v];
        p[v * 3] = xs[i] + (xs[i + 1] - xs[i]) * f;
        p[v * 3 + 1] = ys[i] + (ys[i + 1] - ys[i]) * f;
      }
      g.attributes.position.needsUpdate = true;
      g.computeVertexNormals();
    }

    // today's page, and the leaf that turns over it
    const regPage = new THREE.Mesh(leafGeometry(), pageMat(regTex, THREE.FrontSide));
    regPage.position.x = X_C;
    const leafGeo = leafGeometry();
    const pageFront = new THREE.Mesh(leafGeo, pageMat(titleTex, THREE.FrontSide));
    const pageBack = new THREE.Mesh(leafGeo, pageMat(leftTex, THREE.BackSide));
    const pagePivot = new THREE.Group();
    pagePivot.position.x = X_C;
    pagePivot.add(pageFront, pageBack);

    // flip any part of a hand-built mesh whose triangles face away from its outward hint
    function orient(geo, parts) {
      const p = geo.attributes.position.array, idx = geo.index.array;
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
      parts.forEach(({ start, count, hint }) => {
        const tri = start + Math.floor(count / 6) * 3;
        a.fromArray(p, idx[tri] * 3); b.fromArray(p, idx[tri + 1] * 3); c.fromArray(p, idx[tri + 2] * 3);
        const n = b.sub(a).cross(c.sub(a));
        if (n.x * hint[0] + n.y * hint[1] + n.z * hint[2] >= 0) return;
        for (let k = start; k < start + count; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; }
      });
      geo.index.needsUpdate = true;
    }

    // the text block, as layers of leaves swept from head to tail. Its top follows today's page and
    // its lower layers flatten toward the back board, so when open the leaves fan into the fold.
    // The spine side bulges; the fore-edge is a little hollow.
    const NY = 6, SPINE_BULGE = 0.006, FORE_HOLLOW = 0.003;
    const blk = { s: [], z: [], t: [], seg: [], frac: [], uv: [], idx: [], parts: [] };
    function blockFace(nA, nB, at, uvOf, mat, hint) {
      const base = blk.s.length, start = blk.idx.length;
      for (let b = 0; b < nB; b++) for (let a = 0; a < nA; a++) {
        const [s0, z0, t] = at(a, b);
        const [s, z] = roundCorner(s0, z0);
        const [i, f] = locate(s);
        blk.s.push(s); blk.z.push(z); blk.t.push(t); blk.seg.push(i); blk.frac.push(f);
        blk.uv.push(...uvOf(s, z, t));
      }
      for (let b = 0; b < nB - 1; b++) for (let a = 0; a < nA - 1; a++) {
        const p = base + b * nA + a;
        blk.idx.push(p, p + nA, p + 1, p + 1, p + nA, p + nA + 1);
      }
      blk.parts.push({ start, count: blk.idx.length - start, mat, hint });
    }
    const alongLength = (s, z, t) => [(z + PD / 2) / PD, t];
    const alongWidth = (s, z, t) => [s / PW, t];
    blockFace(NS + 1, NZ + 1, (a, b) => [S[a], ZS[b], 1], (s, z) => [s / PW, 0.5 - z / PD], 0, [0, 1, 0]);
    blockFace(NY + 1, NZ + 1, (a, b) => [0, ZS[b], a / NY], alongLength, 1, [-1, 0, 0]);
    blockFace(NY + 1, NZ + 1, (a, b) => [PW, ZS[b], a / NY], alongLength, 2, [1, 0, 0]);
    blockFace(NS + 1, NY + 1, (a, b) => [S[a], ZS[0], b / NY], alongWidth, 3, [0, 0, -1]);
    blockFace(NS + 1, NY + 1, (a, b) => [S[a], ZS[NZ], b / NY], alongWidth, 4, [0, 0, 1]);
    const blkN = blk.s.length;
    const blockGeo = new THREE.BufferGeometry();
    blockGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(blkN * 3), 3));
    blockGeo.setAttribute('uv', new THREE.Float32BufferAttribute(blk.uv, 2));
    blockGeo.setIndex(blk.idx);
    blk.parts.forEach((p) => blockGeo.addGroup(p.start, p.count, p.mat));
    function updateBlock(crease) {
      const p = blockGeo.attributes.position.array;
      for (let v = 0; v < blkN; v++) {
        const i = blk.seg[v], f = blk.frac[v], s = blk.s[v], t = blk.t[v];
        const xTop = X_C + regXs[i] + (regXs[i + 1] - regXs[i]) * f;
        const yTop = crease + 0.0002 + regYs[i] + (regYs[i + 1] - regYs[i]) * f;
        const xFlat = X_C + s;
        p[v * 3] = xFlat + (xTop - xFlat) * Math.pow(t, 1.5)
          - Math.sin(Math.PI * t) * (SPINE_BULGE * (1 - sstep(0, 0.012, s)) + FORE_HOLLOW * sstep(PW - 0.02, PW, s));
        p[v * 3 + 1] = COVER_T + (yTop - COVER_T) * t;
        p[v * 3 + 2] = blk.z[v];
      }
      blockGeo.attributes.position.needsUpdate = true;
      blockGeo.computeVertexNormals();
    }
    const mullMat = new THREE.MeshStandardMaterial({ color: 0xb59c74, roughness: 0.9, envMapIntensity: 0.25 });
    const blockMesh = new THREE.Mesh(blockGeo, [paperMat, mullMat, foreEdgeMat, headEdgeMat, tailEdgeMat]);
    leafShape(0, 0, 0, regXs, regYs);
    updateBlock(HINGE_Y);
    orient(blockGeo, blk.parts);

    // the spine: a leather strip from the back board's spine corner to the front board's, a C round
    // the block when shut and a low arch under the fold when the book lies open
    const SHELL_N = 20, SHELL_T = 0.003, SHELL_L = BD - 0.003;
    const shellGeo = new THREE.BufferGeometry();
    const shellParts = [];
    {
      const N = SHELL_N, idx = [], uv = [];
      // outer surface and inner surface (N x 2 ends each), the two end rings, the two long edges
      const O = (n, e) => n * 2 + e, I = (n, e) => 2 * N + n * 2 + e;
      const C = (e, n, inner) => 4 * N + e * 2 * N + n * 2 + inner;
      const E = (side, k) => 8 * N + side * 4 + k;
      for (let n = 0; n < N; n++) uv.push(n / (N - 1), 0, n / (N - 1), 1);
      for (let n = 0; n < N; n++) uv.push(n / (N - 1), 0, n / (N - 1), 1);
      for (let e = 0; e < 2; e++) for (let n = 0; n < N; n++) uv.push(n / (N - 1), e, n / (N - 1), e);
      for (let k = 0; k < 8; k++) uv.push(0, 0);
      const part = (fill, hint) => { const start = idx.length; fill(); shellParts.push({ start, count: idx.length - start, hint }); };
      const strip = (f) => () => { for (let n = 0; n < N - 1; n++) idx.push(f(n, 0), f(n + 1, 0), f(n, 1), f(n + 1, 0), f(n + 1, 1), f(n, 1)); };
      part(strip(O), [-1, 0, 0]);
      part(strip(I), [1, 0, 0]);
      part(strip((n, k) => C(0, n, k)), [0, 0, -1]);
      part(strip((n, k) => C(1, n, k)), [0, 0, 1]);
      part(() => idx.push(E(0, 0), E(0, 1), E(0, 2), E(0, 1), E(0, 3), E(0, 2)), [1, -0.3, 0]);
      part(() => idx.push(E(1, 0), E(1, 1), E(1, 2), E(1, 1), E(1, 3), E(1, 2)), [1, 0.3, 0]);
      shellGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((8 * N + 8) * 3), 3));
      shellGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      shellGeo.setIndex(idx);
    }
    const shOut = Array.from({ length: SHELL_N }, () => new THREE.Vector2());
    const shIn = Array.from({ length: SHELL_N }, () => new THREE.Vector2());
    const shA = new THREE.Vector2(-W / 2, 0), shB = new THREE.Vector2();
    const sh1 = new THREE.Vector2(), sh2 = new THREE.Vector2();
    function updateShell(ang, drop) {
      const ca = Math.cos(ang), sa = Math.sin(ang);
      shB.set(coverPivot.position.x - COVER_T * sa, coverPivot.position.y + COVER_T * ca);
      sh1.set(shA.x - 0.025 * (1 - drop), shA.y + 0.006 + 0.0085 * drop);
      const lx = -0.025 * (1 - drop), ly = -0.006 - 0.0085 * drop; // in the front board's frame
      sh2.set(shB.x + lx * ca - ly * sa, shB.y + lx * sa + ly * ca);
      const N = SHELL_N;
      for (let n = 0; n < N; n++) {
        const t = n / (N - 1), m = 1 - t;
        shOut[n].set(
          m * m * m * shA.x + 3 * m * m * t * sh1.x + 3 * m * t * t * sh2.x + t * t * t * shB.x,
          m * m * m * shA.y + 3 * m * m * t * sh1.y + 3 * m * t * t * sh2.y + t * t * t * shB.y);
      }
      for (let n = 0; n < N; n++) {
        const a = shOut[Math.max(0, n - 1)], b = shOut[Math.min(N - 1, n + 1)];
        const tx = b.x - a.x, ty = b.y - a.y, l = Math.hypot(tx, ty) || 1;
        shIn[n].set(shOut[n].x + SHELL_T * ty / l, shOut[n].y - SHELL_T * tx / l);
      }
      const p = shellGeo.attributes.position.array, z0 = -SHELL_L / 2, z1 = SHELL_L / 2;
      const put = (v, q, z) => { p[v * 3] = q.x; p[v * 3 + 1] = q.y; p[v * 3 + 2] = z; };
      for (let n = 0; n < N; n++) {
        put(n * 2, shOut[n], z0); put(n * 2 + 1, shOut[n], z1);
        put(2 * N + n * 2, shIn[n], z0); put(2 * N + n * 2 + 1, shIn[n], z1);
        put(4 * N + n * 2, shOut[n], z0); put(4 * N + n * 2 + 1, shIn[n], z0);
        put(6 * N + n * 2, shOut[n], z1); put(6 * N + n * 2 + 1, shIn[n], z1);
      }
      [0, N - 1].forEach((n, side) => {
        const v = 8 * N + side * 4;
        put(v, shOut[n], z0); put(v + 1, shOut[n], z1); put(v + 2, shIn[n], z0); put(v + 3, shIn[n], z1);
      });
      shellGeo.attributes.position.needsUpdate = true;
      shellGeo.computeVertexNormals();
    }
    // its leather carries a pair of gold fillets near the head and the tail
    const [spC, spX] = makeCanvas(256, 2048), [spDC, spDX] = makeCanvas(256, 2048);
    spX.fillStyle = spX.createPattern(leatherC, 'repeat'); spX.fillRect(0, 0, 256, 2048);
    spDX.fillStyle = spDX.createPattern(leatherDataC, 'repeat'); spDX.fillRect(0, 0, 256, 2048);
    const spGold = spX.createLinearGradient(0, 0, 256, 0);
    spGold.addColorStop(0, '#8a6428'); spGold.addColorStop(0.5, '#e6c47a'); spGold.addColorStop(1, '#8a6428');
    [0.05, 0.064, 0.936, 0.95].forEach((v) => {
      spX.fillStyle = spGold; spX.fillRect(0, v * 2048 - 3, 256, 6);
      spDX.fillStyle = 'rgb(150, 70, 255)'; spDX.fillRect(0, v * 2048 - 3, 256, 6);
    });
    const shellMat = new THREE.MeshPhysicalMaterial({
      map: canvasTex(spC), roughnessMap: canvasTex(spDC, false), metalnessMap: canvasTex(spDC, false),
      bumpMap: canvasTex(spDC, false), bumpScale: 0.6, roughness: 1, metalness: 1,
      clearcoat: 0.3, clearcoatRoughness: 0.45, envMapIntensity: 0.7,
    });
    const shell = new THREE.Mesh(shellGeo, shellMat);
    updateShell(0, 0);
    orient(shellGeo, shellParts);

    // the leather of the half binding, half a millimetre proud of the cloth. UVs are planar at
    // 10 tiles a metre, taken along whichever axis each face looks
    function planarUV(geo) {
      const g = geo.index ? geo.toNonIndexed() : geo;
      g.computeVertexNormals();
      const p = g.attributes.position, n = g.attributes.normal, uv = new Float32Array(p.count * 2);
      for (let i = 0; i < p.count; i++) {
        const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
        const [a, b] = ay >= ax && ay >= az ? [p.getX(i), p.getZ(i)] : ax >= az ? [p.getZ(i), p.getY(i)] : [p.getX(i), p.getY(i)];
        uv[i * 2] = a * 10; uv[i * 2 + 1] = b * 10;
      }
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      return g;
    }
    // the strip down the spine side of a board (board frame: x across from the spine edge, y up
    // through the board). Leather shows outside and on the edges; inside, the pastedown covers it,
    // so each piece stops just short of the board's inner face. The front strip is creased where the
    // cover bends, 8 mm in.
    function bandGeometry(front) {
      const top = front ? COVER_T + 0.0005 : COVER_T - 0.0003, bot = front ? 0.0003 : -0.0005;
      const s = new THREE.Shape();
      s.moveTo(-0.0006, bot);
      s.lineTo(BAND_W, bot);
      s.lineTo(BAND_W, top - 0.0004);
      s.lineTo(BAND_W - 0.0012, top);
      if (front) { s.lineTo(0.0105, top); s.lineTo(0.0085, top - 0.0011); s.lineTo(0.0065, top); }
      s.lineTo(-0.0006, top);
      const g = new THREE.ExtrudeGeometry(s, { depth: BD + 0.001, bevelEnabled: false });
      g.translate(0, 0, -(BD + 0.001) / 2);
      return planarUV(g);
    }
    // a mitred corner over the fore-edge corner of a board; sz −1 at the head, +1 at the tail
    function cornerGeometry(sz, front) {
      const r = 0.0055, b0 = -sz * BD / 2; // the shape is drawn in (x, −z)
      const s = new THREE.Shape();
      s.moveTo(BW - LEG, b0);
      s.lineTo(BW - r, b0);
      s.quadraticCurveTo(BW, b0, BW, b0 + sz * r);
      s.lineTo(BW, b0 + sz * LEG);
      const g = new THREE.ExtrudeGeometry(s, {
        depth: COVER_T - 0.0008, bevelEnabled: true, bevelThickness: 0.0005, bevelSize: 0.0005, bevelSegments: 2, curveSegments: 6,
      });
      g.rotateX(-Math.PI / 2);
      if (front) g.translate(0, 0.0008, 0);
      const out = planarUV(g);
      const p = out.attributes.position, col = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) {
        const w = Math.exp(-Math.hypot(p.getX(i) - BW, p.getZ(i) - sz * BD / 2) / 0.014);
        col[i * 3] = 1 + 0.9 * w; col[i * 3 + 1] = 1 + 0.65 * w; col[i * 3 + 2] = 1 + 0.45 * w;
      }
      out.setAttribute('color', new THREE.BufferAttribute(col, 3));
      return out;
    }
    function leatherOn(parent, x0, front) {
      const band = new THREE.Mesh(bandGeometry(front), leatherMat);
      band.position.x = x0;
      parent.add(band);
      [-1, 1].forEach((sz) => {
        const c = new THREE.Mesh(cornerGeometry(sz, front), cornerMat);
        c.position.x = x0;
        parent.add(c);
      });
    }
    leatherOn(coverPivot, 0, true);
    leatherOn(book, -W / 2, false);

    // headbands: a red and cream silk bead at each end of the spine, along the block's spine edge
    const HB_N = 14, HB_SIDES = 8, HB_R = 0.0024;
    const [hbC, hbX] = makeCanvas(256, 32);
    hbX.fillStyle = '#ede0c2'; hbX.fillRect(0, 0, 256, 32);
    hbX.fillStyle = '#a3261c';
    for (let i = -2; i < 44; i += 2) {
      hbX.beginPath();
      hbX.moveTo(i * 6, 0); hbX.lineTo((i + 1) * 6, 0); hbX.lineTo((i + 1) * 6 + 7, 32); hbX.lineTo(i * 6 + 7, 32);
      hbX.fill();
    }
    const hbMat = new THREE.MeshStandardMaterial({ map: canvasTex(hbC), roughness: 0.55, envMapIntensity: 0.4, side: THREE.DoubleSide });
    function headbandGeometry() {
      const uv = [], idx = [];
      for (let n = 0; n < HB_N; n++) for (let k = 0; k <= HB_SIDES; k++) uv.push(n / (HB_N - 1), k / HB_SIDES);
      for (let n = 0; n < HB_N - 1; n++) for (let k = 0; k < HB_SIDES; k++) {
        const a = n * (HB_SIDES + 1) + k, b = a + HB_SIDES + 1;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(uv.length / 2 * 3), 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      return g;
    }
    const headbands = [-1, 1].map((sz) => {
      const m = new THREE.Mesh(headbandGeometry(), hbMat);
      m.userData.z = sz * (PD / 2 - 0.0006);
      return m;
    });
    function updateHeadbands(crease) {
      const h = crease + 0.0002 - COVER_T;
      headbands.forEach((m) => {
        const p = m.geometry.attributes.position.array, z = m.userData.z;
        let v = 0;
        for (let n = 0; n < HB_N; n++) {
          const t = 0.05 + 0.9 * n / (HB_N - 1);
          const x = X_C + 0.0016 - SPINE_BULGE * Math.sin(Math.PI * t), y = COVER_T + h * t;
          const dx = -SPINE_BULGE * Math.PI * Math.cos(Math.PI * t), l = Math.hypot(dx, h);
          const nx = h / l, ny = -dx / l;
          for (let k = 0; k <= HB_SIDES; k++, v++) {
            const a = (k / HB_SIDES) * Math.PI * 2;
            p[v * 3] = x + HB_R * Math.cos(a) * nx;
            p[v * 3 + 1] = y + HB_R * Math.cos(a) * ny;
            p[v * 3 + 2] = z + HB_R * Math.sin(a);
          }
        }
        m.geometry.attributes.position.needsUpdate = true;
        m.geometry.computeVertexNormals();
      });
    }
    updateHeadbands(HINGE_Y);

    // the ribbon: vermilion silk glued in at the head, lying down the fold on today's page (under
    // the leaf that turns), then out over the tail, across the back board and onto the counter
    const RB_HW = 0.0055, RB_N1 = 18, RB_N2 = 40, RB_N = RB_N1 + RB_N2;
    const [rbC, rbX] = makeCanvas(32, 256);
    rbX.fillStyle = '#8c2118'; rbX.fillRect(0, 0, 32, 256);
    for (let i = 0; i < 32; i++) {
      rbX.fillStyle = Math.random() < 0.5 ? `rgba(255, 200, 180, ${0.04 + Math.random() * 0.08})` : `rgba(60, 0, 0, ${0.04 + Math.random() * 0.08})`;
      rbX.fillRect(i, 0, 1, 256);
    }
    rbX.fillStyle = 'rgba(40, 0, 0, 0.06)';
    for (let j = 0; j < 256; j += 2) rbX.fillRect(0, j, 32, 1);
    rbX.fillStyle = 'rgba(50, 5, 0, 0.35)'; rbX.fillRect(0, 0, 2, 256); rbX.fillRect(30, 0, 2, 256);
    const ribbonTex = tiled(canvasTex(rbC), 1, 1);
    ribbonTex.wrapS = THREE.ClampToEdgeWrapping;
    const ribbonMat = new THREE.MeshPhysicalMaterial({
      map: ribbonTex, roughness: 0.5, sheen: 0.6, sheenRoughness: 0.4, sheenColor: new THREE.Color(0xc8604c),
      side: THREE.DoubleSide, envMapIntensity: 0.4,
    });
    const ribbonGeo = new THREE.BufferGeometry();
    {
      const idx = [];
      for (let n = 0; n < RB_N - 1; n++) for (let k = 0; k < 2; k++) {
        const a = n * 3 + k, b = a + 3;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
      ribbonGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(RB_N * 9), 3));
      ribbonGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(RB_N * 6), 2));
      ribbonGeo.setIndex(idx);
    }
    const ribbon = new THREE.Mesh(ribbonGeo, ribbonMat);
    const rbCurve = new THREE.CatmullRomCurve3([], false, 'centripetal');
    // a point on today's page, half a millimetre above it, s from the fold
    function regAt(s, crease, z) {
      const [i, f] = locate(s);
      return new THREE.Vector3(X_C + regXs[i] + (regXs[i + 1] - regXs[i]) * f,
        crease + 0.0013 + regYs[i] + (regYs[i + 1] - regYs[i]) * f, z);
    }
    function updateRibbon(crease) {
      const cs = [], ws = [];
      // down the fold: it leaves the spine at the head and drifts a centimetre onto the page
      for (let n = 0; n < RB_N1; n++) {
        const z = -PD / 2 + 0.004 + (PD - 0.01) * n / (RB_N1 - 1);
        const s = 0.013 - 0.008 * Math.exp(-(z + PD / 2) / 0.05);
        const l = regAt(s - RB_HW, crease, z), r = regAt(s + RB_HW, crease, z);
        cs.push(l.clone().add(r).multiplyScalar(0.5));
        ws.push(r.sub(l).multiplyScalar(0.5));
      }
      // over the tail: down the page edges, across the board's turn-in, over its edge, onto the wood
      const c0 = cs[RB_N1 - 1], x0 = c0.x, zt = PD / 2, zb = BD / 2;
      rbCurve.points = [
        c0.clone(),
        new THREE.Vector3(x0, c0.y - 0.0015, zt + 0.0012),
        new THREE.Vector3(x0, (c0.y + COVER_T) / 2, zt + 0.0016),
        new THREE.Vector3(x0, COVER_T + 0.0025, zt + 0.0022),
        new THREE.Vector3(x0, COVER_T + 0.0012, zb - 0.002),
        new THREE.Vector3(x0, COVER_T - 0.002, zb + 0.0012),
        new THREE.Vector3(x0 + 0.001, 0.004, zb + 0.0018),
        new THREE.Vector3(x0 + 0.003, 0.0007, zb + 0.012),
        new THREE.Vector3(x0 + 0.009, 0.0007, zb + 0.04),
        new THREE.Vector3(x0 + 0.02, 0.0007, zb + 0.068),
        new THREE.Vector3(x0 + 0.032, 0.0007, zb + 0.092),
      ];
      const pts = rbCurve.getPoints(RB_N2);
      const wLast = ws[RB_N1 - 1];
      for (let n = 1; n <= RB_N2; n++) {
        const tg = pts[Math.min(RB_N2, n + 1)].clone().sub(pts[n - 1]).normalize();
        // flat across the path; where it hangs straight down, across the book
        const w = new THREE.Vector3(tg.z, 0, -tg.x);
        w.x += Math.max(0, 1 - w.length());
        w.setLength(RB_HW);
        cs.push(pts[n]);
        ws.push(wLast.clone().lerp(w, Math.min(1, n / 6)));
      }
      const p = ribbonGeo.attributes.position.array, uv = ribbonGeo.attributes.uv.array;
      let len = 0;
      for (let n = 0; n < RB_N; n++) {
        if (n > 0) len += cs[n].distanceTo(cs[n - 1]);
        const c = cs[n], w = ws[n];
        // the free end is cut in a V
        const mid = n === RB_N - 1 ? c.clone().sub(cs[n - 1]).setLength(-0.008).add(c) : c;
        p.set([c.x - w.x, c.y - w.y, c.z - w.z, mid.x, mid.y, mid.z, c.x + w.x, c.y + w.y, c.z + w.z], n * 9);
        uv.set([0, len / 0.05, 0.5, len / 0.05, 1, len / 0.05], n * 6);
      }
      ribbonGeo.attributes.position.needsUpdate = true;
      ribbonGeo.attributes.uv.needsUpdate = true;
      ribbonGeo.computeVertexNormals();
    }

    const stamp = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.11), new THREE.MeshBasicMaterial({
      map: sealTex, transparent: true, depthWrite: false, toneMapped: false, opacity: 0,
    }));
    stamp.rotation.x = -Math.PI / 2;
    stamp.renderOrder = 3;

    // contact shadow: the darkness right under the book, widening as it opens
    const [csC, csX] = makeCanvas(256, 256);
    csX.shadowColor = 'rgba(0, 0, 0, 0.9)';
    csX.shadowBlur = 34;
    csX.fillStyle = 'rgba(0, 0, 0, 0.75)';
    csX.fillRect(56, 56, 144, 144);
    const contact = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      map: canvasTex(csC, false), transparent: true, depthWrite: false, opacity: 0.6,
    }));
    contact.rotation.x = -Math.PI / 2;
    contact.position.y = 0.0012;

    book.add(contact, backCover, blockMesh, shell, ...headbands, regPage, ribbon, coverPivot, pagePivot, stamp);
    book.traverse((o) => { if (o.isMesh && o !== stamp && o !== contact) { o.castShadow = true; o.receiveShadow = true; } });
    pageFront.material.shadowSide = THREE.DoubleSide;
    // these are reshaped every frame, so their first bounds mean nothing
    [blockMesh, shell, ...headbands, regPage, ribbon, pageFront, pageBack].forEach((m) => { m.frustumCulled = false; });

    // a point on today's page, in page pixels, as it lies on the open register, in book space
    leafShape(0, 0, 1, regXs, regYs);
    function onPage(px, py) {
      const [i, f] = locate((px / PAGE_PX) * PW);
      return new THREE.Vector3(
        X_C + regXs[i] + (regXs[i + 1] - regXs[i]) * f,
        C_OPEN + 0.0025 + regYs[i] + (regYs[i + 1] - regYs[i]) * f,
        -PD / 2 + (py / PAGE_PY) * PD
      );
    }
    // where the seal lands, and today's name cell, which is where you write
    const STAMP_AT = onPage(STAMP_PX.x, STAMP_PX.y);
    const NAME_TL = onPage(COLS[1] + 6, TABLE_TOP + HEAD_H + 8);
    const NAME_BR = onPage(COLS[2] - 6, TABLE_TOP + HEAD_H + ROW_H - 8);

    // the shop's stamp, standing on the counter beside the register: a square seal block in dark
    // lacquer, a brass collar, a turned wooden handle. It lives in book space, like the page it marks.
    const stampTool = new THREE.Group();
    const lacquer = new THREE.MeshPhysicalMaterial({ color: 0x2a1610, roughness: 0.45, clearcoat: 0.7, clearcoatRoughness: 0.3, envMapIntensity: 0.6 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xb48a4c, metalness: 1, roughness: 0.32, envMapIntensity: 1 });
    const handleWood = new THREE.MeshPhysicalMaterial({ map: woodTex, color: 0xc08a5a, roughness: 0.6, clearcoat: 0.5, clearcoatRoughness: 0.35, envMapIntensity: 0.5 });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x9e2a1f, roughness: 0.8 });
    const sealFoot = new THREE.Mesh(new THREE.BoxGeometry(STAMP_S, 0.004, STAMP_S), rubber);
    sealFoot.position.y = 0.002;
    const sealBlock = new THREE.Mesh(new RoundedBoxGeometry(STAMP_S + 0.004, 0.03, STAMP_S + 0.004, 2, 0.005), lacquer);
    sealBlock.position.y = 0.004 + 0.015;
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.03, 0.016, 24), brass);
    collar.position.y = 0.034 + 0.008;
    const handle = new THREE.Mesh(new THREE.LatheGeometry([
      new THREE.Vector2(0.018, 0), new THREE.Vector2(0.014, 0.03), new THREE.Vector2(0.016, 0.06),
      new THREE.Vector2(0.03, 0.085), new THREE.Vector2(0.032, 0.1), new THREE.Vector2(0.024, 0.118), new THREE.Vector2(0.001, 0.124),
    ], 28), handleWood);
    handle.position.y = 0.05;
    stampTool.add(sealFoot, sealBlock, collar, handle);
    stampTool.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    const STAMP_REST = new THREE.Vector3(W / 2 + 0.16, 0, 0.18);
    const STAMP_TOP = 0.174;
    stampTool.position.copy(STAMP_REST);
    book.add(stampTool);

    // drifting dust in the lamp light
    const [dotC, dotX] = makeCanvas(32, 32);
    const dg = dotX.createRadialGradient(16, 16, 0, 16, 16, 16);
    dg.addColorStop(0, 'rgba(255,255,255,1)'); dg.addColorStop(1, 'rgba(255,255,255,0)');
    dotX.fillStyle = dg; dotX.fillRect(0, 0, 32, 32);
    const DUST = 140;
    const dustPos = new Float32Array(DUST * 3), dustSeed = new Float32Array(DUST);
    for (let i = 0; i < DUST; i++) {
      dustPos[i * 3] = (Math.random() - 0.5) * 3;
      dustPos[i * 3 + 1] = 1.0 + Math.random() * 2;
      dustPos[i * 3 + 2] = -1 + Math.random() * 2.6;
      dustSeed[i] = Math.random() * 100;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
      size: 0.014, map: canvasTex(dotC), color: 0xffd9a0, transparent: true, opacity: 0.55,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    scene.add(dust);

    /* ---------- motion helpers ---------- */
    const clamp01 = (x) => Math.min(1, Math.max(0, x));
    const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
    const easeOut = (x) => 1 - Math.pow(1 - x, 3);
    const span = (t, a, b) => clamp01((t - a) / (b - a));

    // the cover and the turned leaf both end flat, on the counter and on the cover
    const COVER_END = Math.PI, PAGE_END = Math.PI;

    // the register lies on the counter from the start, between you and her
    const BOOK_TO = new THREE.Vector3(0.3, 0.9, 0.2);
    book.position.copy(BOOK_TO);
    book.rotation.set(0, -0.05, 0);

    book.updateMatrixWorld(true);

    /* ---------- the two sides ---------- */
    // she is only drawn on her side: from yours, looking down at the counter, all that showed of her
    // was a pair of legs at the top edge
    sprites.forEach((m) => m.layers.set(1));
    camHer.layers.enable(1);
    // her side: across the counter at her, the closed register low in the frame. It stays put.
    const HER_POS = new THREE.Vector3(0, 1.8, 4.1), HER_LOOK = new THREE.Vector3(0.2, 1.3, -1.0);
    function fitHer() {
      // pull back on a narrow side so all of her stays in frame
      const halfH = Math.tan(THREE.MathUtils.degToRad(camHer.fov / 2));
      const dir = HER_POS.clone().sub(HER_LOOK);
      const dist = dir.length();
      dir.normalize();
      const back = Math.max(dist, 1.9 / 2 / (halfH * camHer.aspect) + 1.2);
      // slide the view sideways until she stands far enough right for her bubble to fit on her left
      const r = rects.her, look = HER_LOOK.clone();
      const sideW = Math.min(r.w < 520 ? 230 : 300, r.w * 0.5);
      const at = new THREE.Vector3(FEET_X, 1.6, SPRITE_POS.z), by = at.clone().setX(FEET_X + 0.24);
      for (let i = 0; i < 3; i++) {
        camHer.position.copy(look).addScaledVector(dir, back);
        camHer.lookAt(look);
        camHer.updateMatrixWorld();
        const [hx] = toView(at, camHer, r), reach = toView(by, camHer, r)[0] - hx;
        const want = Math.min(r.w * 0.68, Math.max(r.w * 0.5, 12 + sideW + reach + 14 + 20));
        look.x -= (want - hx) / (reach / 0.24);
      }
      camHer.position.copy(look).addScaledVector(dir, back);
      camHer.lookAt(look);
      camHer.updateMatrixWorld();
    }
    // your side: looking down at the counter in front of you, from where you stand. Shut, it frames
    // the register and the stamp beside it; open, the page you write on and the stamp.
    const DESK_DIR = new THREE.Vector3(0, 1.55, 0.82).normalize();
    const deskShut = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
    const deskOpen = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
    const inBook = (x, y, z) => book.localToWorld(new THREE.Vector3(x, y, z));
    const stampPts = (y) => [-1, 1].flatMap((a) => [-1, 1].map((b) =>
      inBook(STAMP_REST.x + a * STAMP_S * 0.7, y, STAMP_REST.z + b * STAMP_S * 0.7)));
    const fitCam = new THREE.PerspectiveCamera();
    function frame(cam, pts, out, mx, my) {
      // look at the middle of the points, then back off along DESK_DIR until all of them fit
      new THREE.Box3().setFromPoints(pts).getCenter(out.look);
      fitCam.fov = cam.fov; fitCam.aspect = cam.aspect; fitCam.near = cam.near; fitCam.far = cam.far;
      fitCam.updateProjectionMatrix();
      let lo = 0.2, hi = 8;
      const v = new THREE.Vector3();
      for (let i = 0; i < 26; i++) {
        const k = (lo + hi) / 2;
        fitCam.position.copy(out.look).addScaledVector(DESK_DIR, k);
        fitCam.lookAt(out.look);
        fitCam.updateMatrixWorld();
        const fits = pts.every((p) => { v.copy(p).project(fitCam); return Math.abs(v.x) <= mx && Math.abs(v.y) <= my; });
        if (fits) hi = k; else lo = k;
      }
      out.pos.copy(out.look).addScaledVector(DESK_DIR, hi);
    }
    function fitDesk() {
      const top = HINGE_Y + COVER_T;
      const shut = [-1, 1].flatMap((a) => [-1, 1].map((b) => inBook(a * W / 2, top, b * BD / 2)));
      frame(camDesk, [...shut, ...stampPts(0), ...stampPts(STAMP_TOP)], deskShut, 0.86, 0.8);
      // a wide side shows both pages; a narrow one the page you write on, and the fold beside it
      const wide = camDesk.aspect >= 1.15;
      const left = wide ? X_C - PW - 0.01 : X_C - 0.07;
      const open = [-1, 1].flatMap((b) => [left, W / 2 + 0.01].map((x) => inBook(x, C_OPEN, b * PD / 2)));
      frame(camDesk, [...open, ...stampPts(0), ...stampPts(STAMP_TOP)], deskOpen, 0.94, 0.86);
    }
    let deskC = 0;
    function deskCamTo(c) {
      deskC = c;
      camDesk.position.lerpVectors(deskShut.pos, deskOpen.pos, c);
      camDesk.lookAt(new THREE.Vector3().lerpVectors(deskShut.look, deskOpen.look, c));
      camDesk.updateMatrixWorld();
    }

    /* ---------- the register ---------- */
    // her entrance, as in the shop's onboarding: busy with her back to you, a glance back at LOOK, then
    // at GO she turns to greet you. From then on nothing happens until you open the register.
    const LOOK = 1.4, GO = 2.6;
    // the register's own clock starts when you open it: the cover goes over, then today's leaf turns
    const OPEN = { cover: 0, pageA: 1.55, pageB: 2.7, ready: 3.1 };
    const STEP = { INTRO: 0, OPEN: 1, WRITE: 2, STAMP: 3, END: 4 };
    let state = STEP.INTRO;
    let t = 0, ot = -1, st = -1;
    let poking = 0, pokes = 0, idle = 0, nudged = false, greeted = false;
    let inked = false, thanked = false, shake = 0, wiggle = 0, stampAngle = 0;

    function applyBook(time) {
      // the hard cover is lifted slowly to just past upright, then falls the rest of the way under
      // its own weight and bounces twice on the counter
      const UP = Math.PI / 2 + 0.18;
      let ang = UP * (0.5 - 0.5 * Math.cos(Math.PI * span(time, OPEN.cover, OPEN.cover + 0.62)));
      const fall = span(time, OPEN.cover + 0.62, OPEN.cover + 0.9);
      if (fall > 0) ang = UP + (COVER_END - UP) * fall * fall;
      const bounce = span(time, OPEN.cover + 0.9, OPEN.cover + 1.3);
      if (bounce > 0) ang = COVER_END - 0.07 * Math.abs(Math.sin(bounce * Math.PI * 2)) * (1 - bounce) * (1 - bounce);
      coverPivot.rotation.z = ang;
      // past upright the spine gives, and the cover comes down flat beside the block
      const drop = sstep(Math.PI / 2, COVER_END, ang);
      coverPivot.position.set(-W / 2 + (PIVOT_OPEN.x + W / 2) * drop, HINGE_Y + (PIVOT_OPEN.y - HINGE_Y) * drop, 0);
      updateShell(ang, drop);
      // the leaves relax into the fold as the cover leaves them
      const gut = sstep(0.25, COVER_END, ang);
      const crease = HINGE_Y + (C_OPEN - HINGE_Y) * gut;
      leafShape(0, 0, gut, regXs, regYs);
      setLeaf(regPage.geometry, regXs, regYs);
      regPage.position.y = crease + 0.0008;
      updateBlock(crease);
      updateHeadbands(crease);
      updateRibbon(crease);
      // the top leaf: tugged up a little as the cover leaves it, then turned by its fore-edge,
      // which leads on the way up, trails on the way down and lifts once more as it settles
      const turn = ease(span(time, OPEN.pageA, OPEN.pageB));
      let theta, curl;
      if (turn > 0) {
        const settle = span(time, OPEN.pageB, OPEN.pageB + 0.4);
        theta = PAGE_END * turn;
        curl = 1.5 * Math.sin(Math.PI * turn) * Math.cos(Math.PI * turn) - 0.18 * Math.sin(Math.PI * settle) * (1 - settle);
      } else {
        const tug = Math.sin(Math.PI * span(time, OPEN.cover + 0.1, OPEN.cover + 0.85));
        theta = 0.02 * tug;
        curl = 0.16 * tug;
      }
      leafShape(theta, curl, gut, leafXs, leafYs);
      setLeaf(leafGeo, leafXs, leafYs);
      pagePivot.position.y = crease + 0.0018;
      // contact shadow widens as the cover goes over
      const open = clamp01(ang / COVER_END);
      contact.scale.set((W + 0.03) / 0.5625 * (1 + 0.95 * open), 1, (D + 0.03) / 0.5625);
      contact.position.x = 0.006 + (-0.307 - 0.006) * open;
    }

    // her lines while she waits for you; a poke or a nudge is a passing remark, then she goes back
    function applyHer(time) {
      if (state !== STEP.INTRO) return;
      if (time < LOOK) { setPose('back'); say(''); narrate(LINES.enter); }
      else if (time < GO) { setPose('lookback', 0.02); say(LINES.huh); narrate(LINES.enter); }
      else {
        narrate('');
        if (!poking) { setPose('curious'); say(LINES.hello); }
        if (!greeted) {
          greeted = true;
          hint(touch ? T.hintOpenTouch : T.hintOpen);
          openEl.focus({ preventScroll: true });
        }
      }
    }
    function aside(text, pose) {
      poking = 2.4;
      setPose(pose, 0.035);
      say(text);
    }

    // on from her greeting: you open the register yourself
    function openBook() {
      if (state !== STEP.INTRO) return;
      state = STEP.OPEN;
      ot = 0; poking = 0;
      t = Math.max(t, GO);
      narrate('');
      hintEl.hidden = true;
      openEl.hidden = true;
      setPose('bow', 0.02);
      say(LINES.ask);
    }
    function showWriting() {
      if (state >= STEP.WRITE) return;
      state = STEP.WRITE;
      ot = OPEN.ready;
      applyBook(ot);
      deskCamTo(1);
      skipEl.hidden = true;
      openEl.hidden = true;
      nameEl.hidden = false;
      suggestEl.hidden = false;
      stampTagEl.hidden = false;
      writing = true;
      setPose('smile');
      hint(touch ? T.hintWriteTouch : T.hintWrite);
      drawRegister();
      // a phone only raises its keyboard for a tap, so there the tap on the page does the focusing
      if (!touch) nameEl.focus({ preventScroll: true });
    }
    function skipToWriting() {
      if (state >= STEP.WRITE) return;
      t = GO; greeted = true; poking = 0;
      narrate('');
      say(LINES.ask);
      showWriting();
    }
    function hint(text) {
      hintEl.textContent = text;
      hintEl.hidden = false;
    }

    /* ---------- writing ---------- */
    let composeBase = null, fontReq = 0;
    async function setName(ink, draft) {
      const mine = ++fontReq;
      const all = ink + draft;
      if (all) await document.fonts.load('100px "Long Cang"', all).catch(() => null);
      if (mine !== fontReq) return;
      typedName = ink; draftText = draft;
      drawRegister();
    }
    function onName() {
      if (state !== STEP.WRITE) return;
      const v = nameEl.value;
      // while an input method composes, only what is already chosen goes on in ink
      const ink = composeBase === null ? v : composeBase;
      setName(ink, composeBase === null ? '' : v.slice(composeBase.length));
      if (v) hintEl.hidden = true;
      setPose(v.trim() ? 'curious' : 'smile');
    }
    nameEl.addEventListener('compositionstart', () => { composeBase = nameEl.value; }, { signal });
    nameEl.addEventListener('compositionend', () => { composeBase = null; onName(); }, { signal });
    nameEl.addEventListener('input', onName, { signal });
    nameEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing && composeBase === null) { e.preventDefault(); pressStamp(); }
    }, { signal });
    suggestEl.addEventListener('click', () => {
      if (state !== STEP.WRITE) return;
      const pick = SUGGESTIONS[(SUGGESTIONS.indexOf(nameEl.value) + 1 + Math.floor(Math.random() * (SUGGESTIONS.length - 1))) % SUGGESTIONS.length];
      nameEl.value = pick;
      composeBase = null;
      onName();
      setPose('whisper', 0.02);
      say(LINES.suggest(pick));
      if (!touch) nameEl.focus({ preventScroll: true });
    }, { signal });

    /* ---------- the stamp ---------- */
    function pressStamp() {
      if (state !== STEP.WRITE) return;
      if (!nameEl.value.trim() || composeBase !== null) {
        setPose('wry', 0.035);
        say(LINES.empty);
        wiggle = 1;
        if (!touch) nameEl.focus({ preventScroll: true });
        return;
      }
      state = STEP.STAMP;
      st = 0;
      typedName = nameEl.value.trim(); draftText = '';
      writing = false;
      drawRegister();
      nameEl.blur();
      nameEl.hidden = true; hintEl.hidden = true; suggestEl.hidden = true; stampTagEl.hidden = true;
      stampAngle = THREE.MathUtils.degToRad(-5 - Math.random() * 7);
    }
    // lifted off the counter, carried over the cell in an arc, pressed down, held, and put back
    const stampAbove = STAMP_AT.clone().add(new THREE.Vector3(0, 0.2, 0));
    function moveStamp(s) {
      const go = ease(span(s, 0, 0.42)), down = span(s, 0.42, 0.52), back = ease(span(s, 0.82, 1.3));
      const p = stampTool.position;
      if (back > 0) {
        p.lerpVectors(STAMP_AT, STAMP_REST, back);
        p.y += Math.sin(Math.PI * back) * 0.14;
      } else if (down > 0) {
        p.copy(stampAbove).lerp(STAMP_AT, down * down);
      } else {
        p.lerpVectors(STAMP_REST, stampAbove, go);
        p.y += Math.sin(Math.PI * go) * 0.06;
      }
      stampTool.rotation.y = -stampAngle * (back > 0 ? 1 - back : go);
      // a little give in the rubber while it is held down
      const press = span(s, 0.52, 0.82);
      stampTool.scale.y = press > 0 && press < 1 ? 1 - 0.06 * Math.sin(Math.PI * press) : 1;
    }

    /* ---------- the end ---------- */
    // each bookmark leaves the register for a different part of the shop
    ['explore', 'stay'].forEach((id) => $(id).addEventListener('click', () => {
      if (state === STEP.END) onDone({ name: typedName, to: id });
    }, { signal }));

    function reset() {
      state = STEP.INTRO; t = 0; ot = -1; st = -1;
      poking = 0; pokes = 0; idle = 0; nudged = false; greeted = false;
      inked = false; thanked = false; shake = 0; wiggle = 0;
      typedName = ''; draftText = ''; writing = false; stampedAt = null;
      nameEl.value = ''; composeBase = null;
      stampTool.position.copy(STAMP_REST); stampTool.rotation.set(0, 0, 0); stampTool.scale.set(1, 1, 1);
      say(''); narrate('');
      [nameEl, hintEl, stampTagEl, suggestEl, marksEl].forEach((el) => { el.hidden = true; });
      skipEl.hidden = false; openEl.hidden = false;
      applyHer(0);
      applyBook(-1);
      deskCamTo(0);
      drawRegister();
      if (reduceMotion) skipToWriting();
    }
    skipEl.addEventListener('click', skipToWriting, { signal });
    openEl.addEventListener('click', openBook, { signal });

    /* ---------- pointing ---------- */
    const ray = new THREE.Raycaster(), pointer = new THREE.Vector2();
    ray.layers.enableAll();
    function aim(e, el, cam) {
      const r = el.getBoundingClientRect();
      pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(pointer, cam);
    }
    function onHer(e) {
      aim(e, herEl, camHer);
      const hit = ray.intersectObject(sprites[front])[0];
      return !!hit && poseAlpha[poseName](hit.uv.x, hit.uv.y) > 60;
    }
    const onStamp = (e) => { aim(e, deskEl, camDesk); return ray.intersectObject(stampTool, true).length > 0; };
    // her side, while she waits: a tap on her gets a reaction, a tap beside her a pointer to the register
    herEl.addEventListener('click', (e) => {
      if (e.target !== herEl || state !== STEP.INTRO || t < GO) return;
      idle = 0;
      if (onHer(e)) {
        const n = pokes++ % 2;
        aside(LINES.poke[n], n ? 'wry' : 'surprise');
      } else aside(LINES.nudge, 'smile');
    }, { signal });
    herEl.addEventListener('pointermove', (e) => {
      herEl.style.cursor = state === STEP.INTRO && t >= GO && e.target === herEl && onHer(e) ? 'pointer' : '';
    }, { signal });
    // your side: the register opens at a tap; once it is open, a tap on the stamp stamps and a tap
    // anywhere else on the counter is back to writing
    deskEl.addEventListener('mousedown', (e) => { if (e.target === deskEl && state === STEP.WRITE) e.preventDefault(); }, { signal });
    deskEl.addEventListener('click', (e) => {
      if (e.target !== deskEl) return;
      if (state === STEP.INTRO) openBook();
      else if (state === STEP.WRITE) {
        if (onStamp(e)) pressStamp();
        else nameEl.focus({ preventScroll: true });
      }
    }, { signal });
    deskEl.addEventListener('pointermove', (e) => {
      const live = e.target === deskEl && (state === STEP.INTRO || (state === STEP.WRITE && onStamp(e)));
      deskEl.style.cursor = live ? 'pointer' : state === STEP.WRITE ? 'text' : '';
    }, { signal });
    stampTagEl.addEventListener('click', pressStamp, { signal });

    /* ---------- labels on the counter, and her bubble ---------- */
    const rects = { her: { x: 0, y: 0, w: 1, h: 1 }, desk: { x: 0, y: 0, w: 1, h: 1 }, H: 1 };
    const pv = new THREE.Vector3();
    function toView(p, cam, r) {
      pv.copy(p).project(cam);
      return [(pv.x + 1) / 2 * r.w, (1 - pv.y) / 2 * r.h];
    }
    const placed = new WeakMap();
    function put(el, x, y) {
      const key = `${Math.round(x)},${Math.round(y)}`;
      if (placed.get(el) === key) return;
      placed.set(el, key);
      el.style.left = `${Math.round(x)}px`;
      el.style.top = `${Math.round(y)}px`;
    }
    function placeLabels() {
      const r = rects.desk;
      if (!hintEl.hidden) {
        if (state === STEP.INTRO) {
          const [x, y] = toView(inBook(0, HINGE_Y + COVER_T, BD / 2), camDesk, r);
          put(hintEl, x, Math.min(y + 12, r.h - 52));
        } else {
          const [x, y] = toView(inBook((NAME_TL.x + NAME_BR.x) / 2, NAME_BR.y, NAME_BR.z), camDesk, r);
          put(hintEl, x, y + 10);
        }
      }
      if (!nameEl.hidden) {
        const [x0, y0] = toView(book.localToWorld(NAME_TL.clone()), camDesk, r);
        const [x1, y1] = toView(book.localToWorld(NAME_BR.clone()), camDesk, r);
        put(nameEl, Math.min(x0, x1), Math.min(y0, y1));
        const w = `${Math.round(Math.abs(x1 - x0))}px`, h = `${Math.round(Math.abs(y1 - y0))}px`;
        if (nameEl.style.width !== w) nameEl.style.width = w;
        if (nameEl.style.height !== h) nameEl.style.height = h;
      }
      if (!stampTagEl.hidden) {
        const [x, y] = toView(inBook(STAMP_REST.x, 0, STAMP_REST.z + STAMP_S * 0.7), camDesk, r);
        put(stampTagEl, x, y + 8);
      }
    }
    // The bubble sits beside her face: to its left if there is room, else to its right, else under
    // her. The side is chosen from where she stands, not from the pose, so it stays put while her
    // poses change; only its height follows her face.
    const headAt = new THREE.Vector3(), headSide = new THREE.Vector3();
    function placeBubble() {
      if (!saidText) return;
      const r = rects.her, m = sprites[front], s = m.userData.base.s;
      const fy = (POSES[poseName].face || [0.5, 0.14])[1];
      headAt.set(FEET_X, m.position.y + (0.5 - fy) * SPRITE_H * s, SPRITE_POS.z);
      headSide.copy(headAt).x += 0.24;
      const [hx, hy] = toView(headAt, camHer, r);
      const reach = Math.abs(toView(headSide, camHer, r)[0] - hx);
      // beside her it is a narrow card; under her it may run wider
      const edge = 12, sideW = Math.round(Math.min(r.w < 520 ? 230 : 300, r.w * 0.5));
      let bw = sideW, x = hx - reach - 14 - bw, y = hy - 31, side = 'left';
      if (x < edge) { x = hx + reach + 14; side = 'right'; }
      if (x + bw > r.w - edge) {
        side = 'under';
        bw = Math.round(Math.min(440, r.w - 2 * edge));
        x = Math.min(Math.max(hx - bw / 2, edge), r.w - bw - edge);
      }
      if (bubbleEl.style.width !== `${bw}px`) bubbleEl.style.width = `${bw}px`;
      const bh = bubbleEl.offsetHeight;
      if (side === 'under') y = r.h - bh - (narrEl.classList.contains('off') ? 14 : 58);
      y = Math.min(Math.max(y, 60), r.h - bh - edge);
      bubbleEl.classList.toggle('flip', side === 'right');
      bubbleEl.classList.toggle('under', side === 'under');
      if (side === 'under') bubbleEl.style.setProperty('--tail', `${Math.round(Math.min(Math.max(hx - x, 24), bw - 24))}px`);
      put(bubbleEl, x, y);
    }

    /* ---------- sizing ---------- */
    function resize() {
      // the canvas fills the layer, which leaves out the page's scrollbar
      const box = $('gl').getBoundingClientRect();
      renderer.setSize(Math.max(1, box.width), Math.max(1, box.height), false);
      const g = renderer.domElement.getBoundingClientRect();
      for (const [k, el] of [['her', herEl], ['desk', deskEl]]) {
        const b = el.getBoundingClientRect();
        rects[k] = { x: b.left - g.left, y: b.top - g.top, w: Math.max(1, b.width), h: Math.max(1, b.height) };
      }
      rects.H = g.height;
      camHer.aspect = rects.her.w / rects.her.h;
      camHer.updateProjectionMatrix();
      camDesk.aspect = rects.desk.w / rects.desk.h;
      camDesk.updateProjectionMatrix();
      fitHer();
      fitDesk();
      deskCamTo(deskC);
    }
    const ro = new ResizeObserver(resize);
    ro.observe(herEl);
    ro.observe(deskEl);
    window.addEventListener('resize', resize, { signal });
    resize();
    reset();

    let holdAt = 0;

    /* ---------- loop ---------- */
    const clock = new THREE.Clock();
    let blinkAcc = 0;
    function drawView(cam, r) {
      const y = rects.H - r.y - r.h;
      renderer.setViewport(r.x, y, r.w, r.h);
      renderer.setScissor(r.x, y, r.w, r.h);
      renderer.render(scene, cam);
    }
    renderer.setScissorTest(true);
    // both sides share one shadow map, worked out once a frame
    renderer.shadowMap.autoUpdate = false;
    const camShake = new THREE.Vector3();
    let time = 0;
    function tick(dt, now) {
      time += dt;
      if (poking > 0) poking = Math.max(0, poking - dt);
      if (state === STEP.INTRO) {
        // the clock stops at her greeting until you open the register
        if (!holdAt) t = Math.min(GO, t + dt);
        applyHer(t);
        // left alone for a while, she points you at the register once
        if (t >= GO && !poking) idle += dt;
        if (idle > 8 && !nudged) { nudged = true; aside(LINES.nudge, 'smile'); }
      }
      if (state === STEP.OPEN) {
        ot += dt;
        applyBook(ot);
        deskCamTo(ease(span(ot, 0.15, 1.6)));
        if (ot >= OPEN.ready) showWriting();
      }
      if (state === STEP.WRITE) {
        blinkAcc += dt;
        if (blinkAcc > 0.55) { blinkAcc = 0; caretOn = !caretOn; drawRegister(); }
        const ready = !!nameEl.value.trim();
        stampTagEl.classList.toggle('quiet', !ready);
        stampTagEl.classList.toggle('pulse', ready);
      }
      if (wiggle > 0) {
        stampTool.rotation.z = Math.sin(time * 38) * 0.06 * wiggle;
        wiggle = Math.max(0, wiggle - dt * 2.2);
        if (!wiggle) stampTool.rotation.z = 0;
      }
      if (st >= 0 && st < 3) {
        st += dt;
        moveStamp(st);
        if (st > 0.52 && !inked) {
          // the ink goes into the paper the moment the rubber touches it
          inked = true; shake = 1;
          stampedAt = stampAngle;
          drawRegister();
          setPose('spark', 0.035);
        }
        if (st > 0.95 && !thanked) { thanked = true; say(LINES.done(typedName)); }
        if (st > 2.4 && marksEl.hidden) {
          state = STEP.END;
          say(LINES.next);
          marksEl.hidden = false;
          $('explore').focus({ preventScroll: true });
        }
      }
      // the pose crossfade and hop, breathing, and drifting dust
      const since = swapAt < 0 ? 1e3 : now / 1000 - swapAt;
      const fade = Math.min(1, since / 0.2), hopT = Math.min(1, since / 0.32);
      const breathe = 1 + Math.sin(time * 1.6) * 0.004;
      sprites.forEach((m, i) => {
        const b = m.userData.base, cur = i === front;
        if (!cur) {
          m.material.uniforms.opacity.value = 1 - fade;
          m.visible = fade < 1;
        }
        m.position.x = b.x;
        m.position.y = b.y + (cur ? hopH * Math.sin(Math.PI * hopT) : 0);
        m.scale.set(b.s, b.s * breathe, 1);
      });
      const p = dustGeo.attributes.position;
      for (let i = 0; i < DUST; i++) {
        const s = dustSeed[i];
        p.array[i * 3] += Math.sin(time * 0.3 + s) * 0.0004;
        p.array[i * 3 + 1] += 0.0006 + Math.sin(time * 0.5 + s) * 0.0003;
        if (p.array[i * 3 + 1] > 3.1) p.array[i * 3 + 1] = 1.0;
      }
      p.needsUpdate = true;

      typeOn(now);
      placeBubble();
      placeLabels();

      // the thump of the stamp shakes your side, and hers a little
      const k = shake > 0 ? Math.sin((1 - shake) * Math.PI * 3) * 0.006 * shake : 0;
      shake = Math.max(0, shake - dt * 4);
      renderer.shadowMap.needsUpdate = true;
      camShake.set(0, k * 0.3, 0);
      camHer.position.add(camShake);
      drawView(camHer, rects.her);
      camHer.position.sub(camShake);
      camShake.set(0, k, 0);
      camDesk.position.sub(camShake);
      drawView(camDesk, rects.desk);
      camDesk.position.add(camShake);
    }
    renderer.setAnimationLoop(() => tick(Math.min(clock.getDelta(), 0.05), performance.now()));
    // dev only, for checking in a preview that gets no frames: freeze the clock, step it by hand, jump
    if (import.meta.env.DEV) {
      let fake = performance.now();
      window.__ob = {
        freeze() {
          renderer.setAnimationLoop(null);
          document.head.append(Object.assign(document.createElement('style'), { textContent: '.ob3d *, .ob3d *::before, .ob3d *::after { transition: none !important; animation: none !important; }' }));
        },
        tick(sec) {
          fake = Math.max(fake, performance.now());
          for (let i = 0; i < Math.round(sec * 30); i++) { fake += 1000 / 30; tick(1 / 30, fake); }
        },
        hold(at) { holdAt = at; t = at; applyHer(t); },
        jump(at, name) {
          skipToWriting();
          if (name) { nameEl.value = name; onName(); }
          if (at === 'end') { pressStamp(); st = 2.6; }
        },
      };
    }
    return { destroy };
  } catch (err) {
    destroy();
    throw err;
  }
}
