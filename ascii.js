/* ASCII-сцены по бокам первого экрана, «написанные» символами кода.
   coder  — программист за ноутбуком: процедурная 3D-сцена (SDF + raymarching).
   horse  — скачущая лошадь, кадры Эдварда Майбриджа (1887), общественное достояние.
   planet — вращающийся Марс, карта Viking MDIM 2.1 (NASA/JPL/USGS), общественное достояние. */
(() => {
  const canvases = [...document.querySelectorAll("canvas.ascii")];
  if (!canvases.length) return;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Тоновые полосы от светлого к тёмному — у каждой свой символ, пары мерцают между собой.
  const RAMP = [["="], ["/"], ["{", "}"], ["0", "1"], ["#"]];
  const ALPHA = [0.3, 0.5, 0.72, 0.88, 1];
  const GLITCH = "{}<>/=;01#";
  const SAMPLE = 3; // субпикселей на ячейку по каждой оси

  const loadImage = (src) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

  const luminance = (data, i) => (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;

  /* ---------- Лошадь: спрайт из N кадров на светлом фоне ---------- */
  function horseScene(canvas) {
    const frames = Number(canvas.dataset.frames) || 1;
    const fps = Number(canvas.dataset.fps) || 12;
    const mirror = "mirror" in canvas.dataset;
    let sprite = null, grids = [];

    return {
      async load() { sprite = await loadImage(canvas.dataset.src); },

      // Плотность всех кадров считаем один раз на размер сетки.
      layout(cols, rows, w, h) {
        const fw = sprite.width / frames, fh = sprite.height;
        const off = document.createElement("canvas");
        off.width = cols * SAMPLE;
        off.height = rows * SAMPLE;
        const ctx = off.getContext("2d", { willReadFrequently: true });
        const fit = Math.min(w / fw, h / fh);
        const dw = (fw * fit * off.width) / w, dh = (fh * fit * off.height) / h;
        const dx = (off.width - dw) / 2, dy = (off.height - dh) / 2;

        grids = [];
        for (let f = 0; f < frames; f++) {
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, off.width, off.height);
          if (mirror) ctx.setTransform(-1, 0, 0, 1, off.width, 0);
          ctx.drawImage(sprite, f * fw, 0, fw, fh, dx, dy, dw, dh);
          const { data } = ctx.getImageData(0, 0, off.width, off.height);

          // Фон — светлая бумага фотопластинки; берём по верхнему краю кадра.
          let bg = 0, n = 0;
          const top = Math.ceil(dy) + 1;
          for (let x = Math.ceil(dx) + 1; x < dx + dw - 1; x += 2) { bg += luminance(data, (top * off.width + x) * 4); n++; }
          bg = n ? bg / n : 0.85;

          const grid = new Float32Array(cols * rows).fill(-1);
          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              let l = 0, m = 0;
              for (let sy = 0; sy < SAMPLE; sy++) {
                for (let sx = 0; sx < SAMPLE; sx++) {
                  const i = ((r * SAMPLE + sy) * off.width + c * SAMPLE + sx) * 4;
                  if (data[i + 3] < 128) continue;
                  l += luminance(data, i);
                  m++;
                }
              }
              if (!m) continue;
              const v = (bg - l / m) / bg;
              if (v > 0.22) grid[r * cols + c] = Math.min(0.999, ((v - 0.22) / 0.78) * 1.2);
            }
          }
          grids.push(grid);
        }
      },

      fill(t, out) {
        const f = reduceMotion ? 3 : Math.floor(t * fps) % frames;
        out.set(grids[f]);
      },
    };
  }

  /* ---------- Планета: шар с картой поверхности, свет сбоку ---------- */
  function planetScene(canvas) {
    const TILT = 0.44;                      // наклон оси, рад
    const SPIN = (Math.PI * 2) / 48;        // оборот за 48 с
    const LIGHT = (() => { const v = [-0.6, 0.35, 0.72], l = Math.hypot(...v); return v.map((x) => x / l); })();
    let tex = null, tw = 0, th = 0;
    let geo = null;

    return {
      async load() {
        const img = await loadImage(canvas.dataset.src);
        tw = img.width; th = img.height;
        const c = document.createElement("canvas");
        c.width = tw; c.height = th;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        const { data } = ctx.getImageData(0, 0, tw, th);
        tex = new Float32Array(tw * th);
        let lo = 1, hi = 0;
        for (let i = 0; i < tex.length; i++) {
          const l = luminance(data, i * 4);
          tex[i] = l;
          if (l < lo) lo = l;
          if (l > hi) hi = l;
        }
        for (let i = 0; i < tex.length; i++) tex[i] = (tex[i] - lo) / (hi - lo || 1);
      },

      // Геометрия шара от времени не зависит — считаем на размер сетки.
      layout(cols, rows, w, h, cw, ch) {
        const R = Math.min(w, h) * 0.47, cx = w / 2, cy = h / 2;
        const n = cols * rows;
        geo = { lat: new Float32Array(n), lon: new Float32Array(n), shade: new Float32Array(n).fill(-1) };
        const ct = Math.cos(TILT), st = Math.sin(TILT);
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const j = r * cols + c;
            const x = (c * cw + cw / 2 - cx) / R, y = -(r * ch + ch / 2 - cy) / R;
            const r2 = x * x + y * y;
            if (r2 > 1) {
              // Тонкая дымка атмосферы по краю диска.
              const d = Math.sqrt(r2) - 1;
              if (d < 0.05) { geo.shade[j] = -2; geo.lat[j] = 1 - d / 0.05; }
              continue;
            }
            const z = Math.sqrt(1 - r2);
            // Поворот на наклон оси в плоскости экрана → координаты тела.
            const bx = x * ct + y * st, by = -x * st + y * ct;
            geo.lat[j] = Math.asin(Math.max(-1, Math.min(1, by)));
            geo.lon[j] = Math.atan2(bx, z);
            const lambert = Math.max(0, x * LIGHT[0] + y * LIGHT[1] + z * LIGHT[2]);
            geo.shade[j] = 0.1 + 0.9 * lambert;
          }
        }
      },

      fill(t, out) {
        const rot = reduceMotion ? 2.2 : t * SPIN;
        const { lat, lon, shade } = geo;
        for (let j = 0; j < out.length; j++) {
          const s = shade[j];
          if (s === -1) { out[j] = -1; continue; }
          if (s === -2) { out[j] = 0.06 * lat[j]; continue; }
          let u = (lon[j] + rot) / (Math.PI * 2);
          u -= Math.floor(u);
          const v = 0.5 - lat[j] / Math.PI;
          const k = tex[Math.min(th - 1, (v * th) | 0) * tw + Math.min(tw - 1, (u * tw) | 0)];
          out[j] = Math.min(0.999, s * (0.4 + 0.6 * k));
        }
      },
    };
  }

  /* ---------- Программист за ноутбуком ---------- */
  // Мир в метрах: x — куда смотрит человек, y — вверх, z — вбок. Пол на y = 0.
  const smin = (a, b, k) => {
    const h = Math.max(k - Math.abs(a - b), 0) / k;
    return Math.min(a, b) - h * h * k * 0.25;
  };
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const smooth = (a, b, v) => { const x = clamp01((v - a) / (b - a)); return x * x * (3 - 2 * x); };
  const norm3 = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
  const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

  function sdCapsule(px, py, pz, c, o) {
    const ax = c[o], ay = c[o + 1], az = c[o + 2];
    const bx = c[o + 3] - ax, by = c[o + 4] - ay, bz = c[o + 5] - az;
    const qx = px - ax, qy = py - ay, qz = pz - az;
    let h = (qx * bx + qy * by + qz * bz) / (bx * bx + by * by + bz * bz);
    h = h < 0 ? 0 : h > 1 ? 1 : h;
    const dx = qx - bx * h, dy = qy - by * h, dz = qz - bz * h;
    return Math.sqrt(dx * dx + dy * dy + dz * dz) - (c[o + 6] + (c[o + 7] - c[o + 6]) * h);
  }

  // Скруглённый параллелепипед, повёрнутый вокруг z: cx cy cz | hx hy hz | r | угол.
  function sdBox(px, py, pz, b, o) {
    const x = px - b[o], y = py - b[o + 1];
    const ca = Math.cos(b[o + 7]), sa = Math.sin(b[o + 7]);
    const qx = Math.abs(x * ca + y * sa) - b[o + 3];
    const qy = Math.abs(-x * sa + y * ca) - b[o + 4];
    const qz = Math.abs(pz - b[o + 2]) - b[o + 5];
    const ox = qx > 0 ? qx : 0, oy = qy > 0 ? qy : 0, oz = qz > 0 ? qz : 0;
    return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0) - b[o + 6];
  }

  const deg = Math.PI / 180;
  const SCREEN_TILT = 14 * deg;
  const HINGE = [0.736, 0.767];
  const lerp3 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

  // Позы: type — печатает; sip — отпивает между делом; hold — пьёт и печатает одной рукой;
  // lean — откинулся на спинку с кружкой в обеих руках;
  // cycle — «рабочий день» на 60 с: работа → кофе → откинулся → снова работа, с плавными переходами.
  const POSES = {
    type: { lean: false },
    sip: { lean: false },
    hold: { lean: false },
    lean: { lean: true },
    cycle: { lean: false },
  };
  const MUG_HALF = [0.042, 0.06, 0.042];
  // Где стоит кружка: у локтя (до неё тянутся) или на дальнем краю стола (просто стоит).
  const MUG_NEAR = [0.36, 0.795, 0.32];
  const MUG_FAR = [0.9, 0.795, 0.22];
  const MUG_REACH = [0.78, 0.795, 0.3];   // рядом с крышкой — тянутся с наклоном
  const MUG_GRIP = [0.035, 0.035, -0.04];   // кружка относительно запястья

  // Мебель; наклон спинки стула выставляет setLean() в сцене.
  function furniture() {
    const boxes = [
      0.0, 0.47, 0, 0.2, 0.012, 0.19, 0.018, 0,                                             // сиденье
      -0.25, 0.78, 0, 0.012, 0.22, 0.17, 0.016, 9 * deg,                                     // спинка
      0.66, 0.735, 0, 0.36, 0.008, 0.4, 0.008, 0,                                           // столешница
      1.0, 0.37, 0.36, 0.015, 0.36, 0.015, 0.008, 0,                                        // ножки стола
      1.0, 0.37, -0.36, 0.015, 0.36, 0.015, 0.008, 0,
    ];
    const caps = [
      0, 0.45, 0, 0, 0.1, 0, 0.022, 0.022,                                                  // стойка стула
      -0.24, 0.05, 0, 0.24, 0.05, 0, 0.018, 0.018,                                          // крестовина
      0, 0.05, -0.24, 0, 0.05, 0.24, 0.018, 0.018,
    ];
    return { boxes: new Float64Array(boxes), caps: new Float64Array(caps) };
  }

  // Ноутбук — отдельным тёмным материалом, чтобы читался на светлом столе.
  const LAPTOP = new Float64Array([
    0.58, 0.755, 0, 0.156, 0.008, 0.206, 0.004, 0,                                         // корпус
    HINGE[0] + Math.sin(SCREEN_TILT) * 0.125, HINGE[1] + Math.cos(SCREEN_TILT) * 0.125, 0,
    0.006, 0.121, 0.206, 0.004, -SCREEN_TILT,                                            // крышка
  ]);
  const SCREEN_TOP = [HINGE[0] + Math.sin(SCREEN_TILT) * 0.25, HINGE[1] + Math.cos(SCREEN_TILT) * 0.25];

  // Ноги и корпус — статичны в пределах позы.
  function body(cfg) {
    if (cfg.forward) {
      return {
        caps: new Float64Array([
          0.0, 0.56, 0.1, 0.0, 0.56, -0.1, 0.11, 0.11,              // таз
          0.0, 0.6, 0.06, 0.19, 0.95, 0.06, 0.13, 0.145,            // корпус, наклон вперёд
          0.0, 0.6, -0.06, 0.19, 0.95, -0.06, 0.13, 0.145,
          0.2, 0.975, 0.16, 0.2, 0.975, -0.16, 0.07, 0.07,          // плечи
          0.02, 0.55, 0.1, 0.44, 0.56, 0.11, 0.078, 0.064,          // бёдра
          0.02, 0.55, -0.1, 0.44, 0.56, -0.11, 0.078, 0.064,
          0.44, 0.56, 0.11, 0.47, 0.09, 0.12, 0.056, 0.044,         // голени
          0.44, 0.56, -0.11, 0.47, 0.09, -0.12, 0.056, 0.044,
          0.47, 0.06, 0.12, 0.6, 0.04, 0.12, 0.042, 0.036,          // стопы
          0.47, 0.06, -0.12, 0.6, 0.04, -0.12, 0.042, 0.036,
        ]),
        shoulder: [0.2, 0.975], neck: [0.22, 1.0], head: [0.31, 1.165], headTilt: -0.3,
      };
    }
    if (cfg.lean) {
      return {
        caps: new Float64Array([
          0.03, 0.56, 0.1, 0.03, 0.56, -0.1, 0.11, 0.11,          // таз
          0.03, 0.6, 0.06, -0.06, 0.96, 0.06, 0.13, 0.145,        // корпус, откинут назад
          0.03, 0.6, -0.06, -0.06, 0.96, -0.06, 0.13, 0.145,
          -0.055, 0.975, 0.16, -0.055, 0.975, -0.16, 0.07, 0.07,  // плечи
          0.05, 0.55, 0.1, 0.47, 0.53, 0.11, 0.078, 0.064,        // бёдра
          0.05, 0.55, -0.1, 0.47, 0.53, -0.11, 0.078, 0.064,
          0.47, 0.53, 0.11, 0.7, 0.09, 0.12, 0.056, 0.044,        // голени вытянуты
          0.47, 0.53, -0.11, 0.7, 0.09, -0.12, 0.056, 0.044,
          0.7, 0.06, 0.12, 0.82, 0.045, 0.12, 0.042, 0.036,       // стопы
          0.7, 0.06, -0.12, 0.82, 0.045, -0.12, 0.042, 0.036,
        ]),
        shoulder: [-0.055, 0.975], neck: [-0.04, 1.0], head: [0.02, 1.205], headTilt: -0.02,
      };
    }
    return {
      caps: new Float64Array([
        0.0, 0.56, 0.1, 0.0, 0.56, -0.1, 0.11, 0.11,              // таз
        0.0, 0.6, 0.06, 0.07, 0.97, 0.06, 0.13, 0.145,            // корпус
        0.0, 0.6, -0.06, 0.07, 0.97, -0.06, 0.13, 0.145,
        0.08, 0.99, 0.16, 0.08, 0.99, -0.16, 0.07, 0.07,          // плечи
        0.02, 0.55, 0.1, 0.44, 0.56, 0.11, 0.078, 0.064,          // бёдра
        0.02, 0.55, -0.1, 0.44, 0.56, -0.11, 0.078, 0.064,
        0.44, 0.56, 0.11, 0.47, 0.09, 0.12, 0.056, 0.044,         // голени
        0.44, 0.56, -0.11, 0.47, 0.09, -0.12, 0.056, 0.044,
        0.47, 0.06, 0.12, 0.6, 0.04, 0.12, 0.042, 0.036,          // стопы
        0.47, 0.06, -0.12, 0.6, 0.04, -0.12, 0.042, 0.036,
      ]),
      shoulder: [0.085, 0.985], neck: [0.1, 1.02], head: [0.175, 1.215], headTilt: -0.12,
    };
  }

  const TOKENS = ["{", "}", ";", "()", "=>", "</>", "01", "if", "fn()", "[]", "&&", "++", "<>", "//"];
  const STEAM = ["~", "(", ")", "~", "'", "."];

  function coderScene(canvas) {
    const mirror = "mirror" in canvas.dataset;
    const headphones = "headphones" in canvas.dataset;
    const seed = Number(canvas.dataset.seed) || 0;
    const variant = POSES[canvas.dataset.pose] ? canvas.dataset.pose : "type";
    const cfg = POSES[variant];
    const furn = furniture();
    // Корпус, ноги и спинка стула плавно переходят: −1 — наклон вперёд, 0 — прямо, 1 — откинулся.
    const bodyUp = body({}), bodyBack = body({ lean: true }), bodyFwd = body({ forward: true });
    const bod = { caps: new Float64Array(bodyUp.caps.length), shoulder: [0, 0], neck: [0, 0], head: [0, 0], headTilt: 0 };
    let leanNow = -1;
    function setLean(L) {
      if (L === leanNow) return;
      leanNow = L;
      const to = L < 0 ? bodyFwd : bodyBack, m = Math.abs(L);
      for (let i = 0; i < bod.caps.length; i++) bod.caps[i] = bodyUp.caps[i] + (to.caps[i] - bodyUp.caps[i]) * m;
      for (const k of ["shoulder", "neck", "head"]) {
        for (let a = 0; a < 2; a++) bod[k][a] = bodyUp[k][a] + (to[k][a] - bodyUp[k][a]) * m;
      }
      bod.headTilt = bodyUp.headTilt + (to.headTilt - bodyUp.headTilt) * m;
      const back = (9 + 11 * Math.max(0, L)) * deg;
      furn.boxes[8] = -0.25 - (Math.sin(back) - Math.sin(9 * deg)) * 0.22;
      furn.boxes[15] = back;
    }
    setLean(cfg.lean ? 1 : 0);
    const arms = new Float64Array(6 * 8);   // плечо, предплечье, кисть × 2
    const head = new Float64Array(5 * 8);   // шея, голова, затылок/волосы, челюсть, нос
    let H = [0, 0, 0];                      // центр головы
    let yawC = 1, yawS = 0;                 // поворот головы к зрителю (вокруг вертикали)
    // Взгляд за курсором: точка в мире сцены и плавные доли поворота.
    const look = { active: false, x: 0, y: 0, amt: 0, pitch: 0, yaw: 0 };
    let lastPoseT = -1;
    // Фирменная красная кружка; тот, кто только печатает, держит её подальше от клавиатуры.
    const mugRest = variant === "type" ? MUG_FAR : variant === "cycle" ? MUG_REACH : MUG_NEAR;
    const mug = { c: mugRest.slice(), tilt: 0 };
    let typing = 1, sipping = 0;
    let grid = null;
    const particles = [];
    let lastT = 0, codeAcc = 0, steamAcc = 0;

    // Камера почти в профиль, чуть сверху и спереди. Свет — сверху-спереди + отсвет экрана.
    const DIR = norm3([-0.16, -0.2, -1]);
    const RIGHT = norm3([-DIR[2], 0, DIR[0]]);
    const UP = cross3(RIGHT, DIR);
    const LIGHT = norm3([0.3, 0.75, 0.6]);
    const GLOW = [0.76, 0.89, 0];
    const VIEW_C = [0.3, 0.8, 0], VIEW_W = 1.58;
    const BOX_MIN = [-0.5, 0, -0.45], BOX_MAX = [1.12, 1.42, 0.45];

    const setCap = (arr, i, a, b, ra, rb) => {
      const o = i * 8;
      arr[o] = a[0]; arr[o + 1] = a[1]; arr[o + 2] = a[2];
      arr[o + 3] = b[0]; arr[o + 4] = b[1]; arr[o + 5] = b[2];
      arr[o + 6] = ra; arr[o + 7] = rb;
    };

    // Двухзвенная IK: локоть уходит вниз-назад-наружу.
    function elbow(S, W, side) {
      const L1 = 0.3, L2 = 0.29;
      let dx = W[0] - S[0], dy = W[1] - S[1], dz = W[2] - S[2];
      const d = Math.min(L1 + L2 - 1e-3, Math.hypot(dx, dy, dz));
      dx /= d; dy /= d; dz /= d;
      const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
      const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
      const pole = [-0.35, -1, 0.35 * side];
      const pd = pole[0] * dx + pole[1] * dy + pole[2] * dz;
      const q = norm3([pole[0] - dx * pd, pole[1] - dy * pd, pole[2] - dz * pd]);
      return [S[0] + dx * a + q[0] * h, S[1] + dy * a + q[1] * h, S[2] + dz * a + q[2] * h];
    }

    // Глотки по расписанию: up — кружка поднята к губам, sip — сам глоток (голова запрокинута).
    function sipCurve(local, starts, dur) {
      let up = 0, sip = 0;
      for (const s of starts) {
        up = Math.max(up, smooth(s, s + 0.6, local) * (1 - smooth(s + dur - 0.6, s + dur, local)));
        sip = Math.max(sip, smooth(s + 0.5, s + 0.9, local) * (1 - smooth(s + dur - 0.9, s + dur - 0.5, local)));
      }
      return { up, sip };
    }

    // «Рабочий день», p — секунда цикла 0…60. Кружка стоит за ноутбуком — за ней наклоняются.
    function dayCycle(p, t, keys) {
      const GRIP = [0.055, 0.025, 0];   // кружка чуть впереди ладони
      const grab = [mugRest[0] - GRIP[0], mugRest[1] - GRIP[1], mugRest[2] - GRIP[2]];
      const chest = [0.33, 0.99 + 0.01 * Math.sin(t * 1.1), 0.12];
      const mouth = [0.25, 1.1, 0.1];
      const relax = (i) => [0.17, 0.93 + 0.006 * Math.sin(t * 1.2), 0.055 * (i === 0 ? 1 : -1)];
      const relaxSip = (i) => [0.1, 1.08, 0.055 * (i === 0 ? 1 : -1)];
      let w0, w1, hold = [0, 0], lean = 0, inHand = false, both = 0, think = 0;

      if (p < 17) {
        // Работа: печатает, дважды замирает «подумать».
        think = smooth(6.9, 7.4, p) * (1 - smooth(8.4, 8.9, p)) + smooth(12.4, 12.9, p) * (1 - smooth(13.9, 14.4, p));
        typing = 1 - think;
        w0 = keys(0, typing); w1 = keys(1, typing);
        w0[0] -= think * 0.04; w0[1] += think * 0.025;
        w1[0] -= think * 0.04; w1[1] += think * 0.025;
      } else if (p < 18.5) {
        // Наклоняется к кружке за ноутбуком.
        const k = smooth(17, 18.2, p);
        lean = -k; typing = 1 - 0.6 * k;
        w0 = lerp3(keys(0, 1 - k), grab, k); w1 = keys(1, 0.4);
        hold = [smooth(17.6, 18.2, p), 0]; inHand = p >= 18.3;
      } else if (p < 20) {
        // Берёт её и садится ровно — кружка у груди.
        const k = smooth(18.5, 20, p);
        lean = -(1 - k); typing = 0.4;
        w0 = lerp3(grab, chest, k); w1 = keys(1, 0.4 + 0.2 * k);
        hold = [1, 0]; inHand = true;
      } else if (p < 38) {
        // Кофе: глотки, другой рукой печатает.
        const s = sipCurve(p - 20, [3, 9, 14.5], 2.2);
        sipping = s.sip; typing = 0.5;
        w0 = lerp3(chest, mouth, s.up); w1 = keys(1, 1);
        hold = [1, 0]; inHand = true;
      } else if (p < 40) {
        // Откидывается на спинку, вторая рука перехватывает кружку.
        const k = smooth(38, 40, p);
        lean = k; typing = 0.5 * (1 - k);
        w0 = lerp3(chest, relax(0), k); w1 = lerp3(keys(1, 1 - k), relax(1), k);
        hold = [1, k]; inHand = true; both = k;
      } else if (p < 56.5) {
        // Отдыхает с кофе.
        const s = sipCurve(p - 40, [4, 11], 2.4);
        sipping = s.sip; typing = 0; lean = 1;
        w0 = lerp3(relax(0), relaxSip(0), s.up); w1 = lerp3(relax(1), relaxSip(1), s.up);
        hold = [1, 1]; inHand = true; both = 1;
      } else if (p < 57.8) {
        // Садится ровно, кружка снова у груди.
        const k = smooth(56.5, 57.8, p);
        lean = 1 - k; typing = 0;
        w0 = lerp3(relax(0), chest, k); w1 = lerp3(relax(1), keys(1, 0), k);
        hold = [1, 1 - k]; inHand = true; both = 1 - k;
      } else if (p < 59.2) {
        // Наклоняется и ставит кружку на место.
        const k = smooth(57.8, 59, p);
        lean = -k; typing = 0;
        w0 = lerp3(chest, grab, k); w1 = keys(1, 0);
        hold = [1, 0]; inHand = p < 59.1;
      } else {
        // Садится ровно — руки снова на клавиатуре.
        const k = smooth(59.2, 60, p);
        lean = -(1 - k); typing = k;
        w0 = lerp3(grab, keys(0, k), k); w1 = keys(1, k);
        hold = [1 - k, 0];
      }

      if (inHand) {
        const one = [w0[0] + GRIP[0], w0[1] + GRIP[1], w0[2] + GRIP[2]];
        const two = [(w0[0] + w1[0]) / 2 + 0.035, (w0[1] + w1[1]) / 2 + 0.035, 0];
        mug.c = lerp3(one, two, both);
        mug.tilt = sipping * 0.72;
      } else {
        mug.c = mugRest.slice();
        mug.tilt = 0;
      }
      return { w: [w0, w1], hold, think, lean };
    }

    // Запястья и кружка по сценарию позы. Возвращает цели кистей и долю «держит кружку» для каждой.
    function script(t) {
      const tap = (i) => Math.pow(Math.max(0, Math.sin(t * (12.7 + i * 1.9) + seed * 5 + i)), 4)
        * (0.55 + 0.45 * Math.sin(t * 3.1 + i * 2 + seed));
      const keys = (i, amount) => [
        0.5 + 0.025 * Math.sin(t * 0.6 + i * 1.7 + seed),
        0.8 - 0.014 * tap(i) * amount,
        0.09 * (i === 0 ? 1 : -1),
      ];
      const ph = (period) => (t + seed * 3.3) % period;
      let think = 0;
      sipping = 0;

      if (variant === "cycle") return dayCycle(ph(60), t, keys);

      if (variant === "sip") {
        // ~11 с: печатает → тянется к кружке → отпивает → ставит обратно.
        const p = ph(11);
        const grab = [mugRest[0] - MUG_GRIP[0], mugRest[1] - MUG_GRIP[1], mugRest[2] - MUG_GRIP[2]];
        const mouth = [0.28, 1.11, 0.08];
        const reach = smooth(6.0, 6.8, p) * (1 - smooth(9.6, 10.3, p));
        const lift = smooth(6.8, 7.6, p) * (1 - smooth(8.8, 9.6, p));
        sipping = smooth(7.5, 7.9, p) * (1 - smooth(8.5, 8.9, p));
        typing = 1 - reach;
        const w0 = lerp3(keys(0, typing), lerp3(grab, mouth, lift), reach);
        const held = p >= 6.8 && p <= 9.6;
        mug.c = held ? [w0[0] + MUG_GRIP[0], w0[1] + MUG_GRIP[1], w0[2] + MUG_GRIP[2]] : mugRest.slice();
        mug.tilt = sipping * 0.75;
        return { w: [w0, keys(1, 0.35 + 0.65 * typing)], hold: [reach, 0], think };
      }

      if (variant === "hold") {
        // Кружка в руке у груди, другой рукой печатает; раз в ~7 с — глоток.
        const p = ph(7);
        const up = smooth(3.2, 3.8, p) * (1 - smooth(5.4, 6.0, p));
        sipping = smooth(3.7, 4.1, p) * (1 - smooth(5.2, 5.6, p));
        typing = 0.5;
        const w0 = lerp3([0.33, 0.98 + 0.01 * Math.sin(t * 1.1), 0.12], [0.28, 1.11, 0.08], up);
        mug.c = [w0[0] + MUG_GRIP[0], w0[1] + MUG_GRIP[1], w0[2] + MUG_GRIP[2]];
        mug.tilt = 0.05 + sipping * 0.75;
        return { w: [w0, keys(1, 1)], hold: [1, 0], think };
      }

      if (variant === "lean") {
        // Откинулся, кружка в обеих руках у груди; раз в ~8 с — глоток.
        const p = ph(8);
        const up = smooth(4.2, 4.9, p) * (1 - smooth(6.3, 7.0, p));
        sipping = smooth(4.8, 5.2, p) * (1 - smooth(6.0, 6.4, p));
        typing = 0;
        const w = [0, 1].map((i) => {
          const z = 0.055 * (i === 0 ? 1 : -1);
          return lerp3([0.17, 0.93 + 0.006 * Math.sin(t * 1.2), z], [0.1, 1.08, z], up);
        });
        mug.c = [(w[0][0] + w[1][0]) / 2 + 0.035, (w[0][1] + w[1][1]) / 2 + 0.035, 0];
        mug.tilt = sipping * 0.7;
        return { w, hold: [1, 1], think };
      }

      // type: печатает, каждые ~9 с — пауза «подумать»; кружка стоит на столе.
      mug.c = mugRest.slice();
      mug.tilt = 0;
      const p = ph(9);
      think = smooth(6.9, 7.4, p) * (1 - smooth(8.4, 8.9, p));
      typing = 1 - think;
      const w = [0, 1].map((i) => {
        const k = keys(i, typing);
        return [k[0] - think * 0.04, k[1] + think * 0.025, k[2]];
      });
      return { w, hold: [0, 0], think };
    }

    function pose(t) {
      const breath = 0.005 * Math.sin(t * 1.5 + seed);
      const { w, hold, think, lean } = script(t);
      setLean(lean === undefined ? (cfg.lean ? 1 : 0) : lean);

      for (let i = 0; i < 2; i++) {
        const side = i === 0 ? 1 : -1;
        const W = w[i];
        const S = [bod.shoulder[0], bod.shoulder[1] + breath, 0.165 * side];
        const E = elbow(S, W, side);
        // Пальцы: на клавиатуре — вперёд и вниз, на кружке — обхватывают её.
        const tip = lerp3(
          [W[0] + 0.075, W[1] - 0.014 + think * 0.01, W[2] - 0.008 * side],
          [W[0] + 0.05, W[1] + 0.03, W[2] - 0.035 * side],
          hold[i],
        );
        setCap(arms, i * 3, S, E, 0.052, 0.046);
        setCap(arms, i * 3 + 1, E, W, 0.044, 0.034);
        setCap(arms, i * 3 + 2, W, tip, 0.034, 0.026);
      }

      // Курсор за рамкой: голова плавно поворачивается к нему, руки продолжают работать.
      // Курсор позади — лицо разворачивается к зрителю; на глотке кофе голова сперва пьёт.
      const dt = lastPoseT < 0 ? 0 : Math.min(0.2, Math.max(0, t - lastPoseT));
      lastPoseT = t;
      look.amt += ((look.active ? 1 : 0) - look.amt) * (1 - Math.exp(-dt * 4));
      const toward = [0, 0];
      if (look.active) {
        const dx = look.x - bod.head[0], dy = look.y - bod.head[1];
        const k = 1 - Math.exp(-dt * 6);
        look.pitch += (Math.max(-0.6, Math.min(0.7, Math.atan2(dy, Math.abs(dx) + 0.25))) - look.pitch) * k;
        look.yaw += (0.45 + Math.max(0, Math.min(0.8, -dx * 0.9)) - look.yaw) * k;
      }
      const watch = look.amt * (1 - sipping);
      if (watch > 0) {
        // Голова чуть подаётся к курсору.
        const dx = look.x - bod.head[0], dy = look.y - bod.head[1], l = Math.hypot(dx, dy) || 1;
        toward[0] = (dx / l) * 0.018 * watch; toward[1] = (dy / l) * 0.014 * watch;
      }

      // Голова чуть покачивается в такт; в паузе и на глотке запрокидывается.
      const nod = 0.012 * Math.sin(t * 2.3 + seed) * typing;
      const own = bod.headTilt + think * 0.32 + sipping * 0.22 + nod * 4;
      const tilt = own * (1 - watch) + (look.pitch + nod * 2) * watch;
      const yaw = look.yaw * watch;
      yawC = Math.cos(yaw); yawS = Math.sin(yaw);
      H = [
        bod.head[0] + 0.008 * Math.sin(t * 0.9 + seed) - think * 0.02 - sipping * 0.015 + toward[0],
        bod.head[1] + breath + nod + think * 0.015 + sipping * 0.01 + toward[1],
        0,
      ];
      const ct = Math.cos(tilt), st = Math.sin(tilt);
      const rel = (x, y) => {
        const X = x * ct - y * st;
        return [H[0] + X * yawC, H[1] + x * st + y * ct, X * yawS];
      };
      setCap(head, 0, [bod.neck[0], bod.neck[1] + breath, 0], [H[0] - 0.035, H[1] - 0.07, 0], 0.05, 0.045);
      setCap(head, 1, rel(-0.005, 0.0), rel(0.02, -0.01), 0.098, 0.094);
      setCap(head, 2, rel(-0.035, 0.03), rel(-0.01, 0.045), 0.096, 0.09);        // волосы
      setCap(head, 3, rel(0.03, -0.055), rel(0.07, -0.07), 0.05, 0.035);         // челюсть
      setCap(head, 4, rel(0.1, 0.0), rel(0.122, -0.025), 0.017, 0.014);          // нос
    }

    function sdFurniture(px, py, pz) {
      let d = 1e9;
      for (let o = 0; o < furn.boxes.length; o += 8) d = Math.min(d, sdBox(px, py, pz, furn.boxes, o));
      for (let o = 0; o < furn.caps.length; o += 8) d = Math.min(d, sdCapsule(px, py, pz, furn.caps, o));
      return d;
    }

    function sdBody(px, py, pz) {
      let b = 1e9;
      for (let o = 0; o < bod.caps.length; o += 8) b = smin(b, sdCapsule(px, py, pz, bod.caps, o), 0.05);
      return b;
    }

    // Руки и голова.
    function sdLimbs(px, py, pz) {
      let b = 1e9;
      for (let o = 0; o < arms.length; o += 8) b = smin(b, sdCapsule(px, py, pz, arms, o), 0.035);
      let hd = 1e9;
      for (let o = 0; o < head.length; o += 8) hd = smin(hd, sdCapsule(px, py, pz, head, o), 0.03);
      if (headphones) {
        // Дуга поверх головы и амбушюры.
        // Считаем в системе головы, чтобы наушники поворачивались вместе с ней.
        const dx = px - H[0], dz = pz - H[2];
        const lx = dx * yawC + dz * yawS, lz = -dx * yawS + dz * yawC, ly = py - H[1];
        const ring = Math.hypot(Math.hypot(ly, lz) - 0.118, lx + 0.01) - 0.014;
        hd = Math.min(hd, Math.max(ring, -ly + 0.01));
        for (const s of [1, -1]) hd = Math.min(hd, Math.hypot(lx + 0.01, ly + 0.005, Math.max(0, Math.abs(lz - s * 0.1) - 0.02)) - 0.042);
      }
      return smin(b, hd, 0.03);
    }

    // Кружка в руке: наклоняется на глотке, ручка с дальней от лица стороны.
    const mugBox = new Float64Array(8), mugHandle = new Float64Array(8);
    function placeMug() {
      const ca = Math.cos(mug.tilt), sa = Math.sin(mug.tilt);
      const at = (x, y) => [mug.c[0] + x * ca - y * sa, mug.c[1] + x * sa + y * ca, mug.c[2]];
      mugBox.set([mug.c[0], mug.c[1], mug.c[2], MUG_HALF[0], MUG_HALF[1], MUG_HALF[2], 0.008, mug.tilt]);
      mugHandle.set([...at(0.03, 0.035), ...at(0.05, -0.005), 0.012, 0.012]);
    }
    const sdMug = (px, py, pz) => Math.min(sdBox(px, py, pz, mugBox, 0), sdCapsule(px, py, pz, mugHandle, 0));

    const sdLaptop = (px, py, pz) => Math.min(sdBox(px, py, pz, LAPTOP, 0), sdBox(px, py, pz, LAPTOP, 8));

    const sdMoving = (px, py, pz) => Math.min(sdLimbs(px, py, pz), sdMug(px, py, pz));
    const sdStatic = (px, py, pz) => Math.min(sdFurniture(px, py, pz), sdLaptop(px, py, pz), sdBody(px, py, pz));
    const sdf = (px, py, pz) => Math.min(
      sdFurniture(px, py, pz),
      sdLaptop(px, py, pz),
      sdMug(px, py, pz),
      smin(sdBody(px, py, pz), sdLimbs(px, py, pz), 0.035),
    );

    function project(x, y, z) {
      const dx = x - VIEW_C[0], dy = y - VIEW_C[1], dz = z - VIEW_C[2];
      const u = (dx * RIGHT[0] + dy * RIGHT[1] + dz * RIGHT[2]) * (mirror ? -1 : 1);
      const v = dx * UP[0] + dy * UP[1] + dz * UP[2];
      return [(u / VIEW_W + 0.5) * grid.cols, (0.5 - v / grid.viewH) * grid.rows];
    }

    // Ортографический луч из ячейки.
    function rayOrigin(c, r) {
      const u = ((c + 0.5) / grid.cols - 0.5) * VIEW_W * (mirror ? -1 : 1);
      const v = (0.5 - (r + 0.5) / grid.rows) * grid.viewH;
      return [
        VIEW_C[0] + RIGHT[0] * u + UP[0] * v - DIR[0] * 4,
        VIEW_C[1] + RIGHT[1] * u + UP[1] * v - DIR[1] * 4,
        VIEW_C[2] + RIGHT[2] * u + UP[2] * v - DIR[2] * 4,
      ];
    }

    // Отрезок луча внутри AABB или null.
    function slab(o, lo, hi) {
      let t0 = 0, t1 = 1e9;
      for (let a = 0; a < 3; a++) {
        let ta = (lo[a] - o[a]) / DIR[a], tb = (hi[a] - o[a]) / DIR[a];
        if (ta > tb) { const s = ta; ta = tb; tb = s; }
        if (ta > t0) t0 = ta;
        if (tb < t1) t1 = tb;
      }
      return t0 > t1 ? null : [t0, t1];
    }

    function march(fn, o, t0, t1) {
      let t = t0;
      for (let i = 0; i < 70 && t <= t1; i++) {
        const d = fn(o[0] + DIR[0] * t, o[1] + DIR[1] * t, o[2] + DIR[2] * t);
        if (d < 0.0025) return t;
        t += d * 0.9;
      }
      return -1;
    }

    // Свет: сверху-спереди + отсвет экрана. Материал: человек — плотными символами,
    // ноутбук — тёмным, мебель и кружка — светлыми.
    function shade(fn, o, t, kind) {
      const px = o[0] + DIR[0] * t, py = o[1] + DIR[1] * t, pz = o[2] + DIR[2] * t;
      const e = 0.002;
      const a1 = fn(px + e, py - e, pz - e), a2 = fn(px - e, py - e, pz + e);
      const a3 = fn(px - e, py + e, pz - e), a4 = fn(px + e, py + e, pz + e);
      const n = norm3([a1 - a2 - a3 + a4, -a1 - a2 + a3 + a4, -a1 + a2 - a3 + a4]);
      const facing = -(n[0] * DIR[0] + n[1] * DIR[1] + n[2] * DIR[2]);
      const key = Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
      const gx = GLOW[0] - px, gy = GLOW[1] - py, gz = GLOW[2] - pz, gl = Math.hypot(gx, gy, gz);
      const glow = Math.max(0, (n[0] * gx + n[1] * gy + n[2] * gz) / gl) * clamp01(1 - gl / 0.55) * 0.5;
      const diff = Math.min(1, key * 0.85 + glow + 0.18 * Math.max(0, facing));
      const ao = clamp01(fn(px + n[0] * 0.06, py + n[1] * 0.06, pz + n[2] * 0.06) / 0.06);
      let dark = 0.05 + 0.68 * (1 - diff) + 0.3 * (1 - ao) + 0.1 * (1 - Math.abs(facing));
      if (kind === undefined) {
        const f = sdFurniture(px, py, pz), l = sdLaptop(px, py, pz), b = sdBody(px, py, pz);
        kind = l <= f && l <= b ? "laptop" : b < f ? "person" : "furniture";
      }
      if (kind === "person") dark = 0.12 + dark * 0.95;
      else if (kind === "laptop") dark = 0.42 + dark * 0.55;
      else dark *= 0.55;
      return dark > 0.999 ? 0.999 : dark;
    }

    // Неподвижная часть сцены (мебель, ноги, корпус, тень): кэш на «наклон», «прямо» и «откинулся».
    // Пока человек откидывается или садится ровно, она пересчитывается целиком — это пара секунд за цикл.
    let caches = {}, scratch = null, lastFill = -1;
    let tint = null;   // 1 — ячейка кружки, рисуется акцентным цветом

    function renderStatic(T, D) {
      const { cols, rows } = grid;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const j = r * cols + c, o = rayOrigin(c, r);
          const span = slab(o, BOX_MIN, BOX_MAX);
          const t = span ? march(sdStatic, o, span[0], span[1]) : -1;
          T[j] = t < 0 ? Infinity : t;
          D[j] = -1;
          if (t >= 0) { D[j] = shade(sdStatic, o, t); continue; }
          // Пол: только мягкая тень под стулом и столом.
          const tf = -o[1] / DIR[1];
          const fx = o[0] + DIR[0] * tf, fz = o[2] + DIR[2] * tf;
          const rr = Math.hypot((fx - 0.3) / 0.85, fz / 0.5);
          if (rr < 1) {
            const sh = 0.34 * (1 - clamp01(sdStatic(fx, 0.14, fz) / 0.14)) * (1 - rr * rr);
            if (sh > 0.05) D[j] = sh;
          }
        }
      }
    }

    function staticLayer() {
      if (leanNow === 0 || leanNow === 1 || leanNow === -1) {
        if (!caches[leanNow]) {
          const n = grid.cols * grid.rows;
          caches[leanNow] = { T: new Float32Array(n), D: new Float32Array(n) };
          renderStatic(caches[leanNow].T, caches[leanNow].D);
        }
        return caches[leanNow];
      }
      renderStatic(scratch.T, scratch.D);
      return scratch;
    }

    function emit(kind, x, y, z) {
      const [c, r] = project(x, y, z);
      const steam = kind === "steam";
      particles.push({
        c, r, life: 0, steam,
        vc: (Math.random() - 0.3) * (steam ? 0.8 : 1.6) * (mirror ? -1 : 1),
        vr: steam ? -(1.4 + Math.random() * 0.9) : -(3.2 + Math.random() * 2.4),
        token: steam ? STEAM[(Math.random() * STEAM.length) | 0] : TOKENS[(Math.random() * TOKENS.length) | 0],
        red: !steam && Math.random() < 0.2,
        phase: Math.random() * 6.28,
      });
    }

    return {
      async load() {},

      get tint() { return tint; },

      // Курсор в пикселях холста (или null): переводим в точку на плоскости сцены.
      look(p) {
        if (!p || !grid) { look.active = false; return; }
        const u = (p.x / grid.cw / grid.cols - 0.5) * VIEW_W * (mirror ? -1 : 1);
        const v = (0.5 - p.y / grid.ch / grid.rows) * grid.viewH;
        look.x = VIEW_C[0] + RIGHT[0] * u + UP[0] * v;
        look.y = VIEW_C[1] + RIGHT[1] * u + UP[1] * v;
        look.active = true;
      },

      layout(cols, rows, w, h, cw, ch) {
        grid = { cols, rows, cw, ch, viewH: (VIEW_W * h) / w };
        particles.length = 0;
        lastFill = -1;
        caches = {};
        tint = new Uint8Array(cols * rows);
        scratch = { T: new Float32Array(cols * rows), D: new Float32Array(cols * rows) };
      },

      // Каждый кадр пересчитываем только руки, голову и кружку — в их прямоугольнике на сетке.
      fill(t, out) {
        if (lastFill >= 0 && t - lastFill < 1 / 14) return;
        lastFill = t;
        pose(reduceMotion ? 3 : t);
        placeMug();
        const { T: staticT, D: staticD } = staticLayer();
        out.set(staticD);
        tint.fill(0);

        const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
        const grow = (x, y, z, m) => {
          const p = [x, y, z];
          for (let a = 0; a < 3; a++) {
            if (p[a] - m < lo[a]) lo[a] = p[a] - m;
            if (p[a] + m > hi[a]) hi[a] = p[a] + m;
          }
        };
        for (const arr of [arms, head]) {
          for (let o = 0; o < arr.length; o += 8) {
            grow(arr[o], arr[o + 1], arr[o + 2], 0.16);
            grow(arr[o + 3], arr[o + 4], arr[o + 5], 0.16);
          }
        }
        grow(mug.c[0], mug.c[1], mug.c[2], 0.1);

        let c0 = Infinity, c1 = -Infinity, r0 = Infinity, r1 = -Infinity;
        for (let k = 0; k < 8; k++) {
          const [c, r] = project(k & 1 ? hi[0] : lo[0], k & 2 ? hi[1] : lo[1], k & 4 ? hi[2] : lo[2]);
          c0 = Math.min(c0, c); c1 = Math.max(c1, c); r0 = Math.min(r0, r); r1 = Math.max(r1, r);
        }
        const { cols, rows } = grid;
        c0 = Math.max(0, Math.floor(c0)); c1 = Math.min(cols - 1, Math.ceil(c1));
        r0 = Math.max(0, Math.floor(r0)); r1 = Math.min(rows - 1, Math.ceil(r1));

        for (let r = r0; r <= r1; r++) {
          for (let c = c0; c <= c1; c++) {
            const j = r * cols + c, o = rayOrigin(c, r);
            const span = slab(o, lo, hi);
            if (!span) continue;
            const tm = march(sdMoving, o, span[0], Math.min(span[1], staticT[j]));
            if (tm < 0) continue;
            const px = o[0] + DIR[0] * tm, py = o[1] + DIR[1] * tm, pz = o[2] + DIR[2] * tm;
            const limb = sdLimbs(px, py, pz) <= sdMug(px, py, pz);
            const d = shade(sdf, o, tm, limb ? "person" : "mug");
            if (limb) out[j] = d;
            else { tint[j] = 1; out[j] = Math.min(0.999, 0.5 + d); }
          }
        }
      },

      // Из ноутбука поднимаются токены кода, из кружки — пар.
      overlay(ctx, t, s) {
        const dt = lastT ? Math.min(0.1, t - lastT) : 0;
        lastT = t;
        if (reduceMotion) return;

        codeAcc += dt * 3.2 * Math.max(0, typing - 0.3);
        while (codeAcc >= 1) {
          codeAcc -= 1;
          emit("code", SCREEN_TOP[0] - Math.random() * 0.04, SCREEN_TOP[1] + Math.random() * 0.03, (Math.random() - 0.5) * 0.3);
        }
        steamAcc += dt * 1.6 * (1 - sipping);
        while (steamAcc >= 1) {
          steamAcc -= 1;
          const top = [mug.c[0] - Math.sin(mug.tilt) * 0.055, mug.c[1] + Math.cos(mug.tilt) * 0.055, mug.c[2]];
          emit("steam", top[0] + (Math.random() - 0.5) * 0.03, top[1], top[2]);
        }

        ctx.textAlign = "left";
        for (let i = particles.length - 1; i >= 0; i--) {
          const p = particles[i];
          p.life += dt / (p.steam ? 2.1 : 2.8);
          if (p.life >= 1) { particles.splice(i, 1); continue; }
          p.c += (p.vc + Math.sin(t * 2 + p.phase) * (p.steam ? 1.3 : 0.8)) * dt;
          p.r += p.vr * dt;
          ctx.font = `500 ${Math.round(s.ch * (p.steam ? 1.15 : 1.35))}px "Roboto Mono", monospace`;
          ctx.globalAlpha = Math.min(1, p.life * 8) * (1 - p.life) * (p.steam ? 0.45 : 0.9);
          ctx.fillStyle = p.red ? "#ff280f" : "#000";
          ctx.fillText(p.token, p.c * s.cw, p.r * s.ch + s.ch / 2);
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#000";
      },
    };
  }

  const SCENES = { coder: coderScene, horse: horseScene, planet: planetScene };

  function createLayer(canvas) {
    const scene = SCENES[canvas.dataset.scene](canvas);
    const ctx = canvas.getContext("2d");
    let state = null;

    function setup() {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) { state = null; return; }
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      const cw = Math.max(4, Math.round(w / (Number(canvas.dataset.cols) || 60)));
      const ch = Math.round(cw * 1.32);
      const cols = Math.floor(w / cw), rows = Math.floor(h / ch);
      scene.layout(cols, rows, w, h, cw, ch);
      state = {
        w, h, dpr, cw, ch, cols, rows,
        density: new Float32Array(cols * rows),
        alt: new Uint8Array(cols * rows).map(() => (Math.random() * 2) | 0),
      };
      draw(performance.now() / 1000);
    }

    function draw(t) {
      if (!state) return;
      const { w, h, dpr, cw, ch, cols, rows, density, alt } = state;
      scene.fill(t, density);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.font = `500 ${ch}px "Roboto Mono", monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#000";
      const tint = scene.tint;
      let red = false;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const j = r * cols + c;
          const d = density[j];
          if (d < 0) continue;
          const isRed = tint !== undefined && tint !== null && tint[j] === 1;
          if (isRed !== red) { ctx.fillStyle = isRed ? "#ff280f" : "#000"; red = isRed; }
          const level = (d * RAMP.length) | 0;
          const set = RAMP[level];
          let char;
          if (!reduceMotion && Math.random() < 0.004) char = GLITCH[(Math.random() * GLITCH.length) | 0];
          else {
            if (!reduceMotion && Math.random() < 0.03) alt[j] ^= 1;
            char = set[alt[j] % set.length];
          }
          ctx.globalAlpha = ALPHA[level];
          ctx.fillText(char, c * cw + cw / 2, r * ch + ch / 2);
        }
      }
      ctx.globalAlpha = 1;
      if (scene.overlay) scene.overlay(ctx, t, state);
    }

    return { canvas, scene, setup, draw };
  }

  const layers = canvases.map(createLayer);

  // Персонажи следят за курсором, когда он заходит за линию рамки на их сторону (только мышь, десктоп).
  const followers = layers.filter((layer) => layer.scene.look && "follow" in layer.canvas.dataset);
  const guide = document.querySelector(".frame-guide--left");
  if (guide && followers.length && window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
    window.addEventListener("pointermove", (e) => {
      const w = window.innerWidth;
      const frame = w / 2 - guide.getBoundingClientRect().left; // --frame страницы, по линии рамки
      for (const layer of followers) {
        const right = layer.canvas.classList.contains("ascii-right");
        const inside = w >= 820 && (right ? e.clientX > w / 2 + frame : e.clientX < w / 2 - frame);
        if (!inside) { layer.scene.look(null); continue; }
        const rect = layer.canvas.getBoundingClientRect();
        layer.scene.look({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      }
    }, { passive: true });
    document.documentElement.addEventListener("pointerleave", () => followers.forEach((layer) => layer.scene.look(null)));
  }
  const visible = new Set();
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) e.isIntersecting ? visible.add(e.target) : visible.delete(e.target);
  });
  let resizeTimer;
  const ro = new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => layers.forEach((layer) => layer.setup()), 120);
  });

  const fontReady = Promise.race([
    document.fonts.load('500 12px "Roboto Mono"'),
    new Promise((resolve) => setTimeout(resolve, 1500)),
  ]);

  Promise.all([fontReady, ...layers.map((layer) => layer.scene.load())]).then(() => {
    layers.forEach((layer) => { layer.setup(); io.observe(layer.canvas); ro.observe(layer.canvas); });
    if (reduceMotion) return;

    const FRAME_MS = 1000 / 24;
    let last = 0;
    const loop = (now) => {
      requestAnimationFrame(loop);
      if (document.hidden || now - last < FRAME_MS) return;
      last = now;
      layers.forEach((layer) => { if (visible.has(layer.canvas)) layer.draw(now / 1000); });
    };
    requestAnimationFrame(loop);
  });
})();
