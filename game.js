"use strict";

// ═══════════════════════════════════════════════════════
//  SUPABASE
// ═══════════════════════════════════════════════════════
const SUPA_URL = "https://oyxymvhfafbegqnwvmpz.supabase.co";
const SUPA_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im95eHltdmhmYWZiZWdxbnd2bXB6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0MTAxMzIsImV4cCI6MjA4ODk4NjEzMn0.8IdZBZOR4Kt-TvDpBSmztU4wJpQNs7mGq8CIGuTNIsI";

const SUPA = {
  h: {
    "Content-Type": "application/json",
    apikey: SUPA_KEY,
    Authorization: "Bearer " + SUPA_KEY,
  },
  async getUser(u) {
    try {
      const r = await fetch(
        `${SUPA_URL}/rest/v1/saves?username=eq.${encodeURIComponent(u)}&select=*`,
        { headers: this.h },
      );
      const d = await r.json();
      return d && d.length ? d[0] : null;
    } catch {
      return null;
    }
  },
  async createUser(u, p) {
    try {
      await fetch(`${SUPA_URL}/rest/v1/saves`, {
        method: "POST",
        headers: { ...this.h, Prefer: "return=minimal" },
        body: JSON.stringify({
          username: u,
          password: p,
          progress: {},
          lives: 3,
          last_life_lost_at: [],
          updated_at: new Date().toISOString(),
        }),
      });
    } catch (e) {
      console.error(e);
    }
  },
  async patch(u, fields) {
    try {
      await fetch(
        `${SUPA_URL}/rest/v1/saves?username=eq.${encodeURIComponent(u)}`,
        {
          method: "PATCH",
          headers: { ...this.h, Prefer: "return=minimal" },
          body: JSON.stringify({
            ...fields,
            updated_at: new Date().toISOString(),
          }),
        },
      );
    } catch (e) {
      console.error(e);
    }
  },
};

// ═══════════════════════════════════════════════════════
//  DB
// ═══════════════════════════════════════════════════════
const MAX_LIVES = 3,
  REGEN_MIN = 2;
const DB = {
  _c: {},
  async load(u) {
    const row = await SUPA.getUser(u);
    if (row) {
      this._c[u] = {
        password: row.password,
        progress: row.progress || {},
        lives: row.lives ?? 3,
        lla: row.last_life_lost_at || [],
      };
      return this._c[u];
    }
    return null;
  },
  _sync(u) {
    const d = this._c[u];
    if (!d) return;
    SUPA.patch(u, {
      progress: d.progress,
      lives: d.lives,
      last_life_lost_at: d.lla,
    });
  },
  user(u) {
    return this._c[u] || null;
  },
  async create(u, p) {
    this._c[u] = { password: p, progress: {}, lives: 3, lla: [] };
    await SUPA.createUser(u, p);
  },
  getProgress(u) {
    return (this.user(u) || {}).progress || {};
  },
  saveProgress(u, idx, sc) {
    const d = this.user(u);
    if (!d) return;
    if (!(idx in d.progress) || d.progress[idx] < sc) d.progress[idx] = sc;
    this._sync(u);
  },
  getLives(u) {
    const d = this.user(u);
    if (!d) return 0;
    this._regen(u);
    return d.lives;
  },
  loseLife(u) {
    const d = this.user(u);
    if (!d) return;
    this._regen(u);
    if (d.lives > 0) {
      d.lives--;
      d.lla.push(Date.now());
      this._sync(u);
    }
  },
  _regen(u) {
    const d = this.user(u);
    if (!d) return;
    const now = Date.now(),
      MS = REGEN_MIN * 60000;
    d.lla = d.lla.filter((t) => now - t < MS * MAX_LIVES);
    const rec = [];
    for (let i = d.lla.length - 1; i >= 0; i--)
      if (now - d.lla[i] >= MS) rec.push(i);
    for (const i of rec) {
      d.lla.splice(i, 1);
      if (d.lives < MAX_LIVES) d.lives++;
    }
    if (rec.length) this._sync(u);
  },
  nextLifeIn(u) {
    const d = this.user(u);
    if (!d) return 0;
    this._regen(u);
    if (d.lives >= MAX_LIVES || !d.lla.length) return 0;
    return Math.max(0, REGEN_MIN * 60000 - (Date.now() - Math.min(...d.lla)));
  },
};

// ═══════════════════════════════════════════════════════
//  CONSTANTS
// ═══════════════════════════════════════════════════════
const CHAPTERS = 10,
  LEVELS_PER = 50,
  TOTAL = 500,
  TILE = 16,
  LW = 480,
  LH = 256;

// ═══════════════════════════════════════════════════════
//  CHARACTERS
// ═══════════════════════════════════════════════════════
const CHARACTERS = [
  {
    id: "jake",
    name: "JAKE",
    class: "Runner",
    color: "#ff6b35",
    skin: "#f4a261",
    hair: "#2d3436",
    shirt: "#e63946",
    pants: "#2d3436",
    shoe: "#fff",
    speed: 1.1,
    jump: 1.0,
    hp: 100,
    stats: ["⚡ Fast", "💪 Strong", "❤️ Average"],
    unlockAt: 0,
  },
  {
    id: "zara",
    name: "ZARA",
    class: "Ninja",
    color: "#7209b7",
    skin: "#f4a261",
    hair: "#000",
    shirt: "#7209b7",
    pants: "#240046",
    shoe: "#7209b7",
    speed: 1.3,
    jump: 1.2,
    hp: 80,
    stats: ["⚡⚡ Fastest", "🦘 High Jump", "❤️ Fragile"],
    unlockAt: 0,
  },
  {
    id: "rex",
    name: "REX",
    class: "Brawler",
    color: "#06d6a0",
    skin: "#8d5524",
    hair: "#1a0a00",
    shirt: "#06d6a0",
    pants: "#023e2b",
    shoe: "#000",
    speed: 0.85,
    jump: 0.9,
    hp: 150,
    stats: ["🐌 Slower", "💪💪 Tank", "❤️❤️ Tanky"],
    unlockAt: 0,
  },
  {
    id: "luna",
    name: "LUNA",
    class: "Ghost",
    color: "#4cc9f0",
    skin: "#dfe6e9",
    hair: "#74b9ff",
    shirt: "#4cc9f0",
    pants: "#0984e3",
    shoe: "#4cc9f0",
    speed: 1.0,
    jump: 1.15,
    hp: 90,
    stats: ["🌙 Balanced", "🌊 Floaty", "✨ Special"],
    unlockAt: 100,
  },
];

// ═══════════════════════════════════════════════════════
//  WEAPONS
// ═══════════════════════════════════════════════════════
const WEAPONS = [
  {
    id: "sword",
    name: "SWORD",
    icon: "🗡️",
    color: "#aaa",
    damage: 35,
    range: 40,
    speed: 12,
    desc: "Fast & reliable",
    unlockAt: 0,
  },
  {
    id: "hammer",
    name: "HAMMER",
    icon: "🔨",
    color: "#cd853f",
    damage: 80,
    range: 35,
    speed: 22,
    desc: "Slow but crushing",
    unlockAt: 0,
  },
  {
    id: "boomerang",
    name: "BOOMERANG",
    icon: "🪃",
    color: "#e67e22",
    damage: 25,
    range: 90,
    speed: 8,
    desc: "Ranged, returns",
    unlockAt: 50,
  },
  {
    id: "blade",
    name: "E-BLADE",
    icon: "⚡",
    color: "#4cc9f0",
    damage: 45,
    range: 60,
    speed: 10,
    desc: "Electric pulse",
    unlockAt: 150,
  },
];

// ═══════════════════════════════════════════════════════
//  CHAPTER THEMES
// ═══════════════════════════════════════════════════════
const CHAPTERS_DEF = [
  {
    name: "GRASS LAND",
    icon: "🌿",
    accent: "#4ab04a",
    sky1: "#5ab4f0",
    sky2: "#a8d8f0",
    ground: "#4a8a2a",
    dirt: "#8B5e3c",
    plat: "#7a5a3a",
    platTop: "#9a7a5a",
  },
  {
    name: "DESERT DUNES",
    icon: "🏜️",
    accent: "#e8a020",
    sky1: "#e8c060",
    sky2: "#f0d090",
    ground: "#c8a040",
    dirt: "#9a6820",
    plat: "#b08030",
    platTop: "#d0a850",
  },
  {
    name: "ICE PEAKS",
    icon: "❄️",
    accent: "#88ddff",
    sky1: "#c8e8ff",
    sky2: "#e8f8ff",
    ground: "#d8f0ff",
    dirt: "#a0c8e8",
    plat: "#e0f4ff",
    platTop: "#ffffff",
  },
  {
    name: "LAVA LAND",
    icon: "🌋",
    accent: "#ff4411",
    sky1: "#1a0800",
    sky2: "#3a1200",
    ground: "#8a2a00",
    dirt: "#5a1800",
    plat: "#6a2000",
    platTop: "#9a4000",
  },
  {
    name: "DEEP CAVE",
    icon: "🕳️",
    accent: "#9977cc",
    sky1: "#060610",
    sky2: "#0c0c20",
    ground: "#3a3a55",
    dirt: "#282838",
    plat: "#4a4a65",
    platTop: "#5a5a75",
  },
  {
    name: "SKY REALM",
    icon: "☁️",
    accent: "#aaddff",
    sky1: "#66aaff",
    sky2: "#cceeff",
    ground: "#e0e8ff",
    dirt: "#b8c8ff",
    plat: "#fffce8",
    platTop: "#ffffff",
  },
  {
    name: "HAUNTED MARSH",
    icon: "👻",
    accent: "#88ff88",
    sky1: "#0a1a0a",
    sky2: "#102010",
    ground: "#1a3a1a",
    dirt: "#102010",
    plat: "#204020",
    platTop: "#308030",
  },
  {
    name: "CRYSTAL MINES",
    icon: "💎",
    accent: "#ff88ff",
    sky1: "#100520",
    sky2: "#200840",
    ground: "#3a0a5a",
    dirt: "#280840",
    plat: "#4a1070",
    platTop: "#8030b0",
  },
  {
    name: "STORM PEAKS",
    icon: "⚡",
    accent: "#ffee22",
    sky1: "#1a1a2a",
    sky2: "#0a0a18",
    ground: "#2a2a3a",
    dirt: "#1a1a28",
    plat: "#3a3a50",
    platTop: "#5a5a70",
  },
  {
    name: "PIXEL VOID",
    icon: "✨",
    accent: "#ff44ff",
    sky1: "#000000",
    sky2: "#0a000a",
    ground: "#1a001a",
    dirt: "#0a000a",
    plat: "#200020",
    platTop: "#400040",
  },
];

// ═══════════════════════════════════════════════════════
//  APP STATE
// ═══════════════════════════════════════════════════════
let currentUser = null,
  authMode = "login",
  currentChIdx = 0,
  currentLvlIdx = 0;
let selectedChar = CHARACTERS[0],
  selectedWeapon = WEAPONS[0];
let lifeTimer = null;

// ═══════════════════════════════════════════════════════
//  AUTH
// ═══════════════════════════════════════════════════════
function toggleAuthMode() {
  authMode = authMode === "login" ? "register" : "login";
  const L = authMode === "login";
  document.getElementById("authTitle").textContent = L ? "LOGIN" : "REGISTER";
  document.getElementById("authBtn").textContent = L
    ? "LOGIN"
    : "CREATE ACCOUNT";
  document.getElementById("switchBtn").textContent = L
    ? "NEW PLAYER? REGISTER"
    : "HAVE ACCOUNT? LOGIN";
  document.getElementById("loginMsg").textContent = "";
}

async function handleAuth() {
  const name = document
    .getElementById("usernameInput")
    .value.trim()
    .toLowerCase();
  const pass = document.getElementById("passwordInput").value;
  const msg = document.getElementById("loginMsg"),
    btn = document.getElementById("authBtn");
  msg.style.color = "var(--red)";
  if (!name || !pass) {
    msg.textContent = "FILL IN ALL FIELDS!";
    return;
  }
  if (name.length < 2) {
    msg.textContent = "USERNAME TOO SHORT";
    return;
  }
  btn.textContent = "...";
  btn.disabled = true;
  if (authMode === "register") {
    const ex = await SUPA.getUser(name);
    if (ex) {
      msg.textContent = "USERNAME TAKEN!";
      btn.textContent = "CREATE ACCOUNT";
      btn.disabled = false;
      return;
    }
    if (pass.length < 3) {
      msg.textContent = "PASSWORD TOO SHORT";
      btn.textContent = "CREATE ACCOUNT";
      btn.disabled = false;
      return;
    }
    await DB.create(name, pass);
    msg.style.color = "var(--green)";
    msg.textContent = "ACCOUNT CREATED! ✓";
    setTimeout(() => loginAs(name), 700);
  } else {
    const row = await DB.load(name);
    if (!row || row.password !== pass) {
      msg.textContent = "WRONG USERNAME OR PASSWORD";
      btn.textContent = "LOGIN";
      btn.disabled = false;
      return;
    }
    loginAs(name);
  }
  btn.textContent = authMode === "login" ? "LOGIN" : "CREATE ACCOUNT";
  btn.disabled = false;
}

function loginAs(name) {
  currentUser = name;
  document.getElementById("playerName").textContent = name.toUpperCase();
  startLifeTimer();
  showCharSelect();
}

function logout() {
  stopGame();
  clearInterval(lifeTimer);
  currentUser = null;
  document.getElementById("loginMsg").textContent = "";
  document.getElementById("usernameInput").value = "";
  document.getElementById("passwordInput").value = "";
  showScreen("loginScreen");
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("passwordInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleAuth();
  });
});

// ═══════════════════════════════════════════════════════
//  LIFE TIMER
// ═══════════════════════════════════════════════════════
function startLifeTimer() {
  clearInterval(lifeTimer);
  lifeTimer = setInterval(tickLifeTimer, 1000);
  tickLifeTimer();
}
function tickLifeTimer() {
  if (!currentUser) return;
  DB._regen(currentUser);
  const lives = DB.getLives(currentUser),
    msLeft = DB.nextLifeIn(currentUser);
  const str = "❤️".repeat(lives) + "🖤".repeat(Math.max(0, MAX_LIVES - lives));
  document
    .querySelectorAll("#livesDisplay,#levelLivesDisplay,#hudLives")
    .forEach((el) => {
      if (el) el.textContent = str;
    });
  const tel = document.getElementById("lifeTimerDisplay");
  if (tel) {
    if (lives < MAX_LIVES && msLeft > 0) {
      const s = Math.ceil(msLeft / 1000),
        mm = String(Math.floor(s / 60)).padStart(2, "0"),
        ss = String(s % 60).padStart(2, "0");
      tel.textContent = `+❤️ ${mm}:${ss}`;
      tel.style.display = "";
    } else tel.style.display = "none";
  }
  if (msLeft > 0) {
    const s = Math.ceil(msLeft / 1000),
      mm = String(Math.floor(s / 60)).padStart(2, "0"),
      ss = String(s % 60).padStart(2, "0"),
      fmt = `${mm}:${ss}`;
    ["waitCountdown", "noLivesCountdown"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.textContent = fmt;
    });
  }
  const rb = document.getElementById("retryBtn");
  if (rb && DB.getLives(currentUser) > 0) rb.disabled = false;
}

// ═══════════════════════════════════════════════════════
//  SCREENS
// ═══════════════════════════════════════════════════════
function showScreen(id) {
  document
    .querySelectorAll(".screen")
    .forEach((s) => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

// ═══════════════════════════════════════════════════════
//  CHARACTER SELECT
// ═══════════════════════════════════════════════════════
function showCharSelect() {
  stopGame();
  const prog = DB.getProgress(currentUser),
    done = Object.keys(prog).length;
  const cg = document.getElementById("charGrid");
  cg.innerHTML = "";
  CHARACTERS.forEach((ch, i) => {
    const locked = done < ch.unlockAt;
    const card = document.createElement("div");
    card.className =
      "char-card" + (selectedChar.id === ch.id ? " selected" : "");
    card.style.setProperty("--char-color", ch.color);
    card.innerHTML = `<div class="char-avatar"><canvas class="char-canvas" width="72" height="72" id="cp_${ch.id}"></canvas></div><div class="char-name">${ch.name}</div><div class="char-class">${ch.class}</div><div class="char-stats">${ch.stats.map((s) => `<span class="stat-pip">${s}</span>`).join("")}</div>${locked ? `<div class="char-locked">🔒<span>Complete ${ch.unlockAt} levels</span></div>` : ""}`;
    if (!locked) card.onclick = () => selectChar(ch.id);
    cg.appendChild(card);
    setTimeout(() => {
      const cv = document.getElementById(`cp_${ch.id}`);
      if (cv) {
        const cx = cv.getContext("2d");
        cx.imageSmoothingEnabled = false;
        drawCharPreview(cx, ch, 72);
      }
    }, 20);
  });
  const wg = document.getElementById("weaponGrid");
  wg.innerHTML = "";
  WEAPONS.forEach((w) => {
    const locked = done < w.unlockAt;
    const card = document.createElement("div");
    card.className =
      "weapon-card" +
      (selectedWeapon.id === w.id ? " selected" : "") +
      (locked ? " locked" : "");
    card.innerHTML = `<div class="weapon-icon">${w.icon}</div><div class="weapon-name">${w.name}</div><div class="weapon-desc">${w.desc}</div>${locked ? `<div class="weapon-lock">🔒</div>` : ""}`;
    if (!locked) card.onclick = () => selectWeapon(w.id);
    wg.appendChild(card);
  });
  showScreen("charScreen");
}

function selectChar(id) {
  selectedChar = CHARACTERS.find((c) => c.id === id) || selectedChar;
  document.querySelectorAll(".char-card").forEach((c, i) => {
    c.classList.toggle("selected", CHARACTERS[i]?.id === id);
  });
}
function selectWeapon(id) {
  selectedWeapon = WEAPONS.find((w) => w.id === id) || selectedWeapon;
  document.querySelectorAll(".weapon-card").forEach((c, i) => {
    c.classList.toggle("selected", WEAPONS[i]?.id === id);
  });
}
function confirmCharWeapon() {
  showMap();
}

function drawCharPreview(cx, ch, size) {
  cx.clearRect(0, 0, size, size);
  const s = size / 40;
  drawCharSprite(cx, ((size / 2 - 8 * s) / s) | 0, 4, ch, true, false, 0, s);
}

// ═══════════════════════════════════════════════════════
//  WORLD MAP
// ═══════════════════════════════════════════════════════
function showMap() {
  stopGame();
  const prog = DB.getProgress(currentUser);
  document.getElementById("totalStars").textContent = Object.keys(prog).length;
  const grid = document.getElementById("worldsGrid");
  grid.innerHTML = "";
  CHAPTERS_DEF.forEach((ch, ci) => {
    const unlocked = ci === 0 || isChUnlocked(ci, prog);
    const stars = countStars(ci, prog),
      pct = Math.round((stars / LEVELS_PER) * 100);
    const card = document.createElement("div");
    card.className = "world-card" + (unlocked ? "" : " locked");
    card.style.setProperty("--card-color", ch.accent);
    card.innerHTML = `${unlocked ? "" : "<div class='wc-lock'>🔒</div>"}<div class="wc-icon">${ch.icon}</div><div class="wc-chapter">CHAPTER ${ci + 1}</div><div class="wc-name">${ch.name}</div><div class="wc-progress">${stars}/${LEVELS_PER} · ${pct}%</div><div class="wc-bar"><div class="wc-bar-fill" style="width:${pct}%"></div></div>`;
    if (unlocked) card.onclick = () => showLevelSelect(ci);
    grid.appendChild(card);
  });
  showScreen("mapScreen");
  tickLifeTimer();
}

function isChUnlocked(ci, prog) {
  if (ci === 0) return true;
  const prev = (ci - 1) * LEVELS_PER;
  return (
    Array.from({ length: LEVELS_PER }, (_, i) => prev + i).filter(
      (i) => prog[i] !== undefined,
    ).length >= 30
  );
}
function countStars(ci, prog) {
  const s = ci * LEVELS_PER;
  return Array.from({ length: LEVELS_PER }, (_, i) => s + i).filter(
    (i) => prog[i] !== undefined,
  ).length;
}

// ═══════════════════════════════════════════════════════
//  LEVEL SELECT
// ═══════════════════════════════════════════════════════
function showLevelSelect(ci) {
  currentChIdx = ci;
  const ch = CHAPTERS_DEF[ci],
    prog = DB.getProgress(currentUser);
  document.getElementById("worldTitle").textContent =
    `${ch.icon} CH.${ci + 1}: ${ch.name}`;
  document.getElementById("worldSubtitle").textContent =
    `Levels ${ci * LEVELS_PER + 1}–${ci * LEVELS_PER + LEVELS_PER} · Complete 30 to unlock next chapter`;
  const grid = document.getElementById("levelGrid");
  grid.innerHTML = "";
  for (let i = 0; i < LEVELS_PER; i++) {
    const idx = ci * LEVELS_PER + i,
      done = prog[idx] !== undefined;
    const locked = !done && i !== 0 && prog[idx - 1] === undefined;
    const btn = document.createElement("button");
    btn.className =
      "level-btn" + (locked ? " locked" : "") + (done ? " completed" : "");
    btn.textContent = i + 1;
    btn.title = `Level ${idx + 1}` + (done ? ` · Score:${prog[idx]}` : "");
    if (!locked) btn.onclick = () => tryStartLevel(idx);
    grid.appendChild(btn);
  }
  showScreen("levelScreen");
  tickLifeTimer();
}

// ═══════════════════════════════════════════════════════
//  LEVEL GENERATOR
// ═══════════════════════════════════════════════════════
function seededRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = Math.imul(s ^ (s >>> 15), s | 1);
    s ^= s + Math.imul(s ^ (s >>> 7), s | 61);
    return ((s ^ (s >>> 14)) >>> 0) / 0xffffffff;
  };
}

function generateLevel(idx) {
  const chIdx = Math.floor(idx / LEVELS_PER),
    diff = idx / (TOTAL - 1),
    rng = seededRng(idx * 7919 + 12347);
  const ch = CHAPTERS_DEF[chIdx],
    levelW = 30 + Math.floor(diff * 70),
    GROUND_Y = 14;
  const platforms = [],
    spikes = [],
    movingPlats = [];
  let cursor = 4;
  for (let i = 0, n = 4 + Math.floor(diff * 14); i < n; i++) {
    const gap = 2 + Math.floor(rng() * (2 + diff * 3)),
      tx = cursor + gap,
      ty = GROUND_Y - 3 - Math.floor(rng() * 6),
      len = 2 + Math.floor(rng() * 4);
    if (tx + len < levelW - 4) {
      platforms.push({ tx, ty, len });
      cursor = tx + len;
    }
  }
  const coins = [];
  for (let i = 0, n = 8 + Math.floor(diff * 20); i < n; i++) {
    if (rng() < 0.6 && platforms.length) {
      const p = platforms[Math.floor(rng() * platforms.length)];
      coins.push({
        x: (p.tx + Math.floor(rng() * p.len)) * TILE + 4,
        y: p.ty * TILE - 12,
        collected: false,
      });
    } else
      coins.push({
        x: (3 + Math.floor(rng() * (levelW - 6))) * TILE + 4,
        y: (GROUND_Y - 1) * TILE - 10,
        collected: false,
      });
  }
  const zombies = [];
  for (
    let i = 0, n = Math.floor(diff * 10) + (chIdx >= 3 ? 2 : 1);
    i < n;
    i++
  ) {
    const onP = rng() < 0.4 && platforms.length;
    let ex, ey, minX, maxX;
    const spd = 0.4 + diff * 1.2 + chIdx * 0.08,
      maxHp = 40 + Math.floor(diff * 80) + chIdx * 10;
    if (onP) {
      const p = platforms[Math.floor(rng() * platforms.length)];
      ex = p.tx * TILE;
      ey = p.ty * TILE - 20;
      minX = p.tx * TILE;
      maxX = (p.tx + p.len) * TILE - 16;
    } else {
      ex = (6 + Math.floor(rng() * (levelW - 12))) * TILE;
      ey = GROUND_Y * TILE - 20;
      minX = Math.max(0, ex - 5 * TILE);
      maxX = Math.min((levelW - 1) * TILE, ex + 5 * TILE);
    }
    if (maxX - minX < TILE * 2) maxX = minX + TILE * 3;
    zombies.push({
      x: ex,
      y: ey,
      vx: (rng() < 0.5 ? 1 : -1) * spd,
      minX,
      maxX,
      hp: maxHp,
      maxHp,
      alive: true,
      hitFlash: 0,
      facingRight: true,
      attackCooldown: 0,
      variant: Math.floor(rng() * 3),
    });
  }
  if (chIdx >= 1) {
    for (let i = 0, n = Math.floor(diff * 6); i < n; i++)
      spikes.push({
        x: (6 + Math.floor(rng() * (levelW - 10))) * TILE + 2,
        y: GROUND_Y * TILE - 8,
      });
  }
  if (chIdx >= 3) {
    for (let i = 0, n = 1 + Math.floor((chIdx - 3) * 0.7); i < n; i++) {
      const tx = 8 + Math.floor(rng() * (levelW - 16)),
        ty = GROUND_Y - 4 - Math.floor(rng() * 4);
      movingPlats.push({
        tx,
        ty,
        len: 3,
        ox: tx * TILE,
        range: 48 + Math.floor(rng() * 32),
        speed: 0.6 + diff,
        offset: rng() * Math.PI * 2,
        cx: tx * TILE,
      });
    }
  }
  return {
    idx,
    chIdx,
    levelW,
    GROUND_Y,
    platforms,
    coins,
    zombies,
    spikes,
    movingPlats,
    ch,
  };
}

// ═══════════════════════════════════════════════════════
//  GAME ENGINE
// ═══════════════════════════════════════════════════════
const canvas = document.getElementById("c"),
  ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = true;
ctx.imageSmoothingQuality = "high";
let levelData = null,
  player = null,
  camX = 0,
  score = 0,
  coinsGot = 0,
  t = 0,
  invincible = 0;
let gameState = null,
  animFrame = null;
const keys = {};
let jumpQueued = false,
  jumpHeld = false,
  attackQueued = false;
let projectiles = [],
  hitEffects = [],
  floatTexts = [];

function resizeCanvas() {
  const wrap = document.getElementById("gameWrapper");
  if (
    !wrap ||
    !document.getElementById("gameScreen").classList.contains("active")
  )
    return;
  const hudH = document.getElementById("hud").offsetHeight || 28;
  const availW = window.innerWidth,
    availH = Math.floor(window.innerHeight * 0.82) - hudH;
  const ps = Math.max(1, Math.floor(Math.min(availW / LW, availH / LH)));
  canvas.width = LW;
  canvas.height = LH;
  canvas.style.width = LW * ps + "px";
  canvas.style.height = LH * ps + "px";
  wrap.style.width = LW * ps + "px";
}
window.addEventListener("resize", resizeCanvas);

window.addEventListener("keydown", (e) => {
  if (!keys[e.code]) {
    if (["Space", "ArrowUp", "KeyW"].includes(e.code)) jumpQueued = true;
    if (["KeyZ", "KeyJ", "KeyX"].includes(e.code)) attackQueued = true;
  }
  keys[e.code] = true;
  jumpHeld = !!(keys["Space"] || keys["ArrowUp"] || keys["KeyW"]);
  if (e.code === "Escape") {
    if (gameState === "playing") pauseGame();
    else if (gameState === "paused") resumeGame();
  }
  if (
    ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(
      e.code,
    )
  )
    e.preventDefault();
});
window.addEventListener("keyup", (e) => {
  keys[e.code] = false;
  jumpHeld = !!(keys["Space"] || keys["ArrowUp"] || keys["KeyW"]);
});
function mcPress(d) {
  keys[d === "left" ? "ArrowLeft" : "ArrowRight"] = true;
}
function mcRelease(d) {
  keys[d === "left" ? "ArrowLeft" : "ArrowRight"] = false;
}
function mcJump() {
  jumpQueued = true;
}
function mcAttack() {
  attackQueued = true;
}

function tryStartLevel(idx) {
  if (DB.getLives(currentUser) <= 0) {
    showNoLivesOverlay();
    return;
  }
  startLevel(idx);
}

function startLevel(idx) {
  currentLvlIdx = idx;
  currentChIdx = Math.floor(idx / LEVELS_PER);
  score = 0;
  coinsGot = 0;
  t = 0;
  invincible = 0;
  projectiles = [];
  hitEffects = [];
  floatTexts = [];
  levelData = generateLevel(idx);
  player = {
    x: 2 * TILE,
    y: (levelData.GROUND_Y - 2) * TILE,
    vx: 0,
    vy: 0,
    w: 16,
    h: 24,
    onGround: false,
    facingRight: true,
    coyoteFrames: 0,
    jumpBuffer: 0,
    hp: selectedChar.hp,
    maxHp: selectedChar.hp,
    attackCooldown: 0,
    attacking: false,
    attackFrame: 0,
  };
  camX = 0;
  document.getElementById("hudChapter").textContent = `CH.${currentChIdx + 1}`;
  document.getElementById("hudLevel").textContent = `LV.${idx + 1}`;
  document.getElementById("hudWeapon").textContent = selectedWeapon.icon;
  updateHUD();
  hideOverlays();
  showScreen("gameScreen");
  resizeCanvas();
  gameState = "playing";
  jumpQueued = false;
  attackQueued = false;
  if (animFrame) cancelAnimationFrame(animFrame);
  animFrame = requestAnimationFrame(loop);
}

function updateHUD() {
  document.getElementById("hudScore").textContent = score;
  document.getElementById("hudCoins").textContent = coinsGot;
  const lives = DB.getLives(currentUser);
  document.getElementById("hudLives").textContent =
    "❤️".repeat(lives) + "🖤".repeat(Math.max(0, MAX_LIVES - lives));
}
function hideOverlays() {
  document
    .querySelectorAll(".game-overlay")
    .forEach((o) => o.classList.remove("active"));
}
function pauseGame() {
  gameState = "paused";
  document.getElementById("pauseOverlay").classList.add("active");
}
function resumeGame() {
  gameState = "playing";
  document.getElementById("pauseOverlay").classList.remove("active");
}
function retryLevel() {
  if (DB.getLives(currentUser) <= 0) return;
  startLevel(currentLvlIdx);
}
function nextLevel() {
  const n = currentLvlIdx + 1;
  if (n < TOTAL) tryStartLevel(n);
  else showMap();
}
function quitToMap() {
  stopGame();
  showLevelSelect(currentChIdx);
}
function stopGame() {
  gameState = null;
  if (animFrame) {
    cancelAnimationFrame(animFrame);
    animFrame = null;
  }
}

function showNoLivesOverlay() {
  const ms = DB.nextLifeIn(currentUser),
    s = Math.ceil(ms / 1000),
    mm = String(Math.floor(s / 60)).padStart(2, "0"),
    ss2 = String(s % 60).padStart(2, "0");
  document.getElementById("noLivesCountdown").textContent = `${mm}:${ss2}`;
  showScreen("gameScreen");
  resizeCanvas();
  document.getElementById("noLivesOverlay").classList.add("active");
}

function loop() {
  update();
  draw();
  if (gameState === "playing" || gameState === "paused")
    animFrame = requestAnimationFrame(loop);
}

// ─── COLLISION ───
function getSolids() {
  const R = [];
  const G = levelData.GROUND_Y,
    LWW = levelData.levelW;
  for (let i = 0; i < LWW; i++)
    R.push({ x: i * TILE, y: G * TILE, w: TILE, h: LH * 2 });
  levelData.platforms.forEach((p) => {
    for (let i = 0; i < p.len; i++)
      R.push({ x: (p.tx + i) * TILE, y: p.ty * TILE, w: TILE, h: TILE });
  });
  levelData.movingPlats.forEach((mp) => {
    for (let i = 0; i < mp.len; i++)
      R.push({
        x: Math.round(mp.cx) + i * TILE,
        y: mp.ty * TILE,
        w: TILE,
        h: TILE,
      });
  });
  return R;
}
function aabb(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

// ─── UPDATE ───
function update() {
  if (gameState !== "playing") return;
  t++;
  invincible = Math.max(0, invincible - 1);
  levelData.movingPlats.forEach((mp) => {
    mp.cx = mp.ox + Math.sin(t * 0.025 * mp.speed + mp.offset) * mp.range;
  });

  const left = keys["ArrowLeft"] || keys["KeyA"],
    right = keys["ArrowRight"] || keys["KeyD"];
  const spd = 2.6 * selectedChar.speed;
  if (left) {
    player.vx = -spd;
    player.facingRight = false;
  } else if (right) {
    player.vx = spd;
    player.facingRight = true;
  } else player.vx *= 0.72;

  if (player.onGround) player.coyoteFrames = 6;
  else player.coyoteFrames = Math.max(0, player.coyoteFrames - 1);
  if (jumpQueued) {
    player.jumpBuffer = 8;
    jumpQueued = false;
  } else player.jumpBuffer = Math.max(0, player.jumpBuffer - 1);
  if (player.jumpBuffer > 0 && player.coyoteFrames > 0) {
    player.vy = -8.6 * selectedChar.jump;
    player.coyoteFrames = 0;
    player.jumpBuffer = 0;
  }
  if (!jumpHeld && player.vy < -3) player.vy += 0.6;
  player.vy = Math.min(player.vy + 0.42, 13);

  player.attackCooldown = Math.max(0, player.attackCooldown - 1);
  if (player.attacking) {
    player.attackFrame++;
    if (player.attackFrame > 8) player.attacking = false;
  }
  if (attackQueued && player.attackCooldown === 0) {
    doAttack();
    attackQueued = false;
    player.attackCooldown = selectedWeapon.speed;
    player.attacking = true;
    player.attackFrame = 0;
  } else attackQueued = false;

  player.x += player.vx;
  player.x = Math.max(
    0,
    Math.min(player.x, levelData.levelW * TILE - player.w),
  );
  let solids = getSolids();
  for (const r of solids)
    if (aabb(player.x, player.y, player.w, player.h, r.x, r.y, r.w, r.h)) {
      if (player.vx > 0) player.x = r.x - player.w;
      else player.x = r.x + r.w;
      player.vx = 0;
    }

  player.onGround = false;
  player.y += player.vy;
  for (const r of getSolids())
    if (aabb(player.x, player.y, player.w, player.h, r.x, r.y, r.w, r.h)) {
      if (player.vy >= 0) {
        player.y = r.y - player.h;
        player.onGround = true;
      } else player.y = r.y + r.h;
      player.vy = 0;
    }

  if (player.y > LH + 80) {
    triggerDeath();
    return;
  }
  camX = Math.max(0, Math.min(player.x - LW / 3, levelData.levelW * TILE - LW));

  levelData.coins.forEach((c) => {
    if (
      !c.collected &&
      aabb(player.x, player.y, player.w, player.h, c.x, c.y, 8, 8)
    ) {
      c.collected = true;
      score += 10;
      coinsGot++;
      updateHUD();
      floatTexts.push({
        x: c.x,
        y: c.y,
        text: "+10",
        color: "#ffd23f",
        life: 40,
      });
    }
  });
  for (const s of levelData.spikes)
    if (
      invincible === 0 &&
      aabb(player.x, player.y, player.w, player.h, s.x, s.y, 8, 8)
    ) {
      triggerDeath();
      return;
    }

  for (const z of levelData.zombies) {
    if (!z.alive) continue;
    z.hitFlash = Math.max(0, z.hitFlash - 1);
    z.attackCooldown = Math.max(0, (z.attackCooldown || 0) - 1);
    z.x += z.vx;
    z.facingRight = z.vx > 0;
    if (z.x <= z.minX || z.x + 16 >= z.maxX) z.vx *= -1;
    const dist = Math.abs(player.x - z.x);
    if (dist < 80) {
      const dir = player.x > z.x ? 1 : -1;
      z.vx = Math.abs(z.vx) * dir;
      z.facingRight = dir > 0;
    }
    if (
      invincible === 0 &&
      aabb(player.x, player.y, player.w, player.h, z.x, z.y, 18, 22)
    ) {
      if (player.vy > 1 && player.y + player.h < z.y + 10) {
        damageZombie(z, 50);
        player.vy = -5.5;
      } else if (z.attackCooldown === 0) {
        z.attackCooldown = 60;
        playerTakeDamage(15);
      }
    }
  }

  projectiles = projectiles.filter((p) => {
    p.x += p.vx;
    p.y += p.vy;
    p.life--;
    if (p.type === "boomerang" && p.life < p.maxLife / 2) {
      p.vx *= -1;
      p.returning = true;
    }
    if (
      p.returning &&
      aabb(player.x, player.y, player.w, player.h, p.x, p.y, 10, 10)
    )
      return false;
    for (const z of levelData.zombies) {
      if (!z.alive) continue;
      if (aabb(p.x, p.y, 10, 10, z.x, z.y, 18, 22)) {
        damageZombie(z, p.damage);
        if (p.type !== "boomerang") return false;
      }
    }
    return p.life > 0;
  });
  hitEffects = hitEffects.filter((e) => {
    e.life--;
    return e.life > 0;
  });
  floatTexts = floatTexts.filter((f) => {
    f.y -= 0.5;
    f.life--;
    return f.life > 0;
  });
  if (player.x >= (levelData.levelW - 3) * TILE) triggerWin();
}

function doAttack() {
  const w = selectedWeapon,
    dir = player.facingRight ? 1 : -1;
  if (w.id === "boomerang" || w.id === "blade") {
    projectiles.push({
      x: player.x + player.w / 2,
      y: player.y + player.h / 2 - 4,
      vx: dir * (w.id === "boomerang" ? 4 : 5),
      vy: 0,
      damage: w.damage,
      type: w.id,
      life: w.id === "boomerang" ? 50 : 35,
      maxLife: 50,
      color: w.color,
      returning: false,
    });
  } else {
    const ax = player.facingRight ? player.x + player.w : player.x - w.range,
      ay = player.y + 2;
    for (const z of levelData.zombies) {
      if (z.alive && aabb(ax, ay, w.range, player.h - 4, z.x, z.y, 18, 22))
        damageZombie(z, w.damage);
    }
    hitEffects.push({
      x: ax,
      y: ay,
      w: w.range,
      h: player.h,
      life: 8,
      color: w.color,
    });
  }
}

function damageZombie(z, dmg) {
  z.hp -= dmg;
  z.hitFlash = 10;
  floatTexts.push({
    x: z.x + 4,
    y: z.y - 4,
    text: `-${dmg}`,
    color: "#ff4466",
    life: 35,
  });
  if (z.hp <= 0) {
    z.alive = false;
    score += 100;
    updateHUD();
    floatTexts.push({
      x: z.x,
      y: z.y - 10,
      text: "💀+100",
      color: "#ffd23f",
      life: 50,
    });
  }
}

function playerTakeDamage(dmg) {
  player.hp -= dmg;
  invincible = 90;
  hitEffects.push({
    x: player.x - 4,
    y: player.y,
    w: player.w + 8,
    h: player.h,
    life: 6,
    color: "#ff0000",
  });
  floatTexts.push({
    x: player.x,
    y: player.y - 8,
    text: `-${dmg}`,
    color: "#ff4466",
    life: 30,
  });
  if (player.hp <= 0) triggerDeath();
}

function triggerDeath() {
  gameState = "dead";
  DB.loseLife(currentUser);
  tickLifeTimer();
  const lives = DB.getLives(currentUser),
    ms = DB.nextLifeIn(currentUser);
  const s = Math.ceil(ms / 1000),
    mm = String(Math.floor(s / 60)).padStart(2, "0"),
    ss2 = String(s % 60).padStart(2, "0");
  document.getElementById("dieTitle").textContent =
    lives <= 0 ? "GAME OVER" : "YOU DIED";
  document.getElementById("dieMsg").textContent =
    lives <= 0
      ? "Wait for lives to recharge"
      : `${lives} life${lives !== 1 ? "ies" : ""} remaining`;
  document.getElementById("retryBtn").disabled = lives <= 0;
  const wEl = document.getElementById("livesWait");
  if (wEl) {
    wEl.style.display = lives < MAX_LIVES && ms > 0 ? "" : "none";
    if (ms > 0)
      document.getElementById("waitCountdown").textContent = `${mm}:${ss2}`;
  }
  document.getElementById("dieOverlay").classList.add("active");
  updateHUD();
}

function triggerWin() {
  gameState = "won";
  DB.saveProgress(currentUser, currentLvlIdx, score);
  tickLifeTimer();
  const isLast = currentLvlIdx >= TOTAL - 1;
  document.getElementById("winMsg").textContent =
    `${coinsGot} coins · ${levelData.zombies.filter((z) => !z.alive).length} zombies slain`;
  document.getElementById("winScore").textContent = `Score: ${score}`;
  const nb = document.getElementById("nextBtn");
  nb.textContent = isLast ? "🏆 GAME COMPLETE!" : "NEXT →";
  nb.disabled = isLast;
  document.getElementById("winOverlay").classList.add("active");
}

// ═══════════════════════════════════════════════════════
//  DRAWING  — Subway Surfers–style smooth art
// ═══════════════════════════════════════════════════════

// rounded rect helper
function rr(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function glow(x, y, r, color) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, "transparent");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function outline(color, w = 1.5) {
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.stroke();
}

function draw() {
  if (!levelData) return;
  const ch = levelData.ch;
  ctx.clearRect(0, 0, LW, LH);

  // Rich sky gradient
  const sg = ctx.createLinearGradient(0, 0, 0, LH);
  sg.addColorStop(0, ch.sky1);
  sg.addColorStop(0.6, ch.sky2);
  sg.addColorStop(1, shadeColor(ch.sky2, -30));
  ctx.fillStyle = sg;
  ctx.fillRect(0, 0, LW, LH);

  drawBgDecor();
  ctx.save();
  ctx.translate(-Math.round(camX), 0);
  drawGround(ch);
  drawPlatforms(ch);
  drawMovingPlatforms(ch);
  drawSpikes(ch);
  drawCoins();
  drawZombies();
  drawProjectiles();
  drawHitEffects();
  if (invincible === 0 || Math.floor(t / 3) % 2 === 0) drawPlayer();
  drawGoalFlag();
  ctx.restore();
  drawFloatTexts();
  drawPlayerHPBar();
}

// ── Background ──────────────────────────────────────────────
function drawBgDecor() {
  const ci = levelData.chIdx;
  // Parallax city buildings
  if ([0, 2, 5, 8, 9].includes(ci)) {
    const bDefs = [
      [30, 70, 28],
      [100, 90, 22],
      [190, 55, 34],
      [280, 80, 26],
      [370, 65, 30],
      [460, 85, 20],
    ];
    bDefs.forEach(([bx, bh, bw], i) => {
      const sx = ((((bx - camX * 0.12 + 700) % 720) + 720) % 720) - 40;
      const grad = ctx.createLinearGradient(sx, LH - bh, sx + bw, LH);
      const bc =
        ci === 9
          ? "#1a001a"
          : ci === 5
            ? "#0a1a3a"
            : ci === 8
              ? "#2a1a0a"
              : "#1a2a3a";
      const bc2 =
        ci === 9
          ? "#2a002a"
          : ci === 5
            ? "#0a2a5a"
            : ci === 8
              ? "#3a2a0a"
              : "#1a3a4a";
      grad.addColorStop(0, bc2);
      grad.addColorStop(1, bc);
      ctx.fillStyle = grad;
      rr(sx, LH - bh - 10, bw, bh + 10, 3);
      ctx.fill();
      // windows
      for (let wy = LH - bh + 4; wy < LH - 12; wy += 9)
        for (let wx = sx + 4; wx < sx + bw - 4; wx += 7)
          if ((wx + wy + ci) % 3 !== 0) {
            ctx.fillStyle = `rgba(255,220,100,${0.4 + Math.sin(t * 0.02 + wx + wy) * 0.15})`;
            ctx.fillRect(wx, wy, 3, 4);
          }
    });
  }
  // Subway tunnel walls
  if (ci === 1) {
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.fillRect(0, 0, LW, LH);
    for (let i = 0; i < 5; i++) {
      const bx = (((i * 96 - camX * 0.08 + 500) % 500) + 500) % 500;
      const tg = ctx.createLinearGradient(bx, 0, bx + 6, 0);
      tg.addColorStop(0, "#3a3a55");
      tg.addColorStop(1, "transparent");
      ctx.fillStyle = tg;
      ctx.fillRect(bx, 0, 6, LH);
    }
    for (let i = 0; i < 4; i++) {
      const lx = (((i * 120 - camX * 0.25 + 500) % 500) + 500) % 500;
      ctx.fillStyle = "#ffffc0";
      ctx.fillRect(lx + 50, 2, 10, 5);
      glow(lx + 55, 4, 20, "rgba(255,255,180,0.12)");
    }
  }
  // Sewer drips
  if (ci === 3) {
    for (let i = 0; i < 10; i++) {
      const dx = (i * 50 + t * 0.4) % LW,
        dy = (t * 0.6 + i * 25) % LH;
      const dg = ctx.createLinearGradient(dx, 0, dx, dy);
      dg.addColorStop(0, "transparent");
      dg.addColorStop(1, "rgba(50,200,50,0.6)");
      ctx.strokeStyle = "rgba(50,200,50,0.4)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(dx, 0);
      ctx.lineTo(dx, dy);
      ctx.stroke();
    }
  }
  // Lava embers
  if (ci === 3) {
    for (let i = 0; i < 16; i++) {
      const ex = (i * 47 + t * 0.5) % LW,
        ey = LH - 10 - ((t * 0.8 + i * 18) % LH);
      glow(ex, ey, 4 + Math.sin(t * 0.1 + i) * 2, "rgba(255,120,0,0.3)");
    }
  }
  // Clouds for outdoor chapters
  if ([0, 2, 5, 6].includes(ci)) {
    [40, 150, 260, 370, 470].forEach((bx, i) => {
      const cx2 = ((((bx - camX * 0.18 + 620) % 640) + 640) % 640) - 60;
      const cy = 18 + i * 8,
        cr = ci === 5 ? 0.95 : 0.75;
      drawCloud(cx2, cy, 55 + i * 8, cr);
    });
  }
  // Graveyard fog
  if (ci === 7) {
    for (let i = 0; i < 3; i++) {
      const fx2 = ((((i * 200 - camX * 0.05 + 700) % 700) + 700) % 700) - 100;
      const fg = ctx.createRadialGradient(
        fx2 + 100,
        LH - 20,
        0,
        fx2 + 100,
        LH - 20,
        100,
      );
      fg.addColorStop(0, "rgba(100,120,80,0.18)");
      fg.addColorStop(1, "transparent");
      ctx.fillStyle = fg;
      ctx.fillRect(fx2, LH - 60, 200, 60);
    }
  }
}

function drawCloud(x, y, w, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.ellipse(x + w * 0.3, y + 10, w * 0.22, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x + w * 0.5, y + 6, w * 0.28, 13, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x + w * 0.72, y + 10, w * 0.2, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x + w * 0.5, y + 12, w * 0.45, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ── Ground ──────────────────────────────────────────────────
function drawGround(ch) {
  const G = levelData.GROUND_Y,
    LWW = levelData.levelW;
  const gw = LWW * TILE,
    gy = G * TILE;
  const ci = levelData.chIdx;

  // Main ground fill
  const gg = ctx.createLinearGradient(0, gy, 0, gy + TILE * 3);
  gg.addColorStop(0, ch.ground);
  gg.addColorStop(0.15, ch.platTop || ch.ground);
  gg.addColorStop(1, ch.dirt);
  ctx.fillStyle = gg;
  ctx.fillRect(0, gy, gw, TILE * 4);

  // Surface line with sheen
  const shine = ctx.createLinearGradient(0, gy, 0, gy + 5);
  shine.addColorStop(0, "rgba(255,255,255,0.35)");
  shine.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = shine;
  ctx.fillRect(0, gy, gw, 5);

  // Chapter-specific surface details
  if (ci === 0) {
    // Road: lane markings
    ctx.strokeStyle = "rgba(255,255,180,0.3)";
    ctx.lineWidth = 2;
    ctx.setLineDash([20, 16]);
    ctx.beginPath();
    ctx.moveTo(0, gy + 8);
    ctx.lineTo(gw, gy + 8);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (ci === 1) {
    // Subway rails
    ctx.strokeStyle = "rgba(180,180,220,0.5)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, gy + 4);
    ctx.lineTo(gw, gy + 4);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, gy + 12);
    ctx.lineTo(gw, gy + 12);
    ctx.stroke();
    // rail ties
    for (let i = 0; i < LWW; i += 2) {
      ctx.fillStyle = "rgba(100,80,60,0.4)";
      ctx.fillRect(i * TILE, gy, TILE - 2, TILE);
    }
  }
  if (ci === 3 || ci === 2) {
    // wet ground reflections
    for (let i = 0; i < LWW; i += 3) {
      ctx.fillStyle = `rgba(100,200,100,${0.06 + Math.sin(t * 0.04 + i) * 0.03})`;
      ctx.fillRect(i * TILE, gy, TILE * 2, 4);
    }
  }
}

// ── Platforms ───────────────────────────────────────────────
function drawPlatforms(ch) {
  levelData.platforms.forEach((p) => {
    const x = p.tx * TILE,
      y = p.ty * TILE,
      w = p.len * TILE,
      h = TILE;
    drawPlatBlock(x, y, w, h, ch, false);
  });
}

function drawMovingPlatforms(ch) {
  levelData.movingPlats.forEach((mp) => {
    const x = Math.round(mp.cx),
      y = mp.ty * TILE,
      w = mp.len * TILE,
      h = TILE;
    drawPlatBlock(x, y, w, h, ch, true);
  });
}

function drawPlatBlock(x, y, w, h, ch, moving) {
  // Shadow underneath
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  rr(x + 3, y + h + 1, w - 6, 5, 3);
  ctx.fill();

  // Body gradient
  const pg = ctx.createLinearGradient(x, y, x, y + h);
  pg.addColorStop(0, ch.platTop || lightenColor(ch.plat, 30));
  pg.addColorStop(0.3, ch.plat);
  pg.addColorStop(1, shadeColor(ch.plat, -25));
  ctx.fillStyle = pg;
  rr(x, y, w, h, 4);
  ctx.fill();

  // Top sheen
  const sg = ctx.createLinearGradient(x, y, x, y + 6);
  sg.addColorStop(0, "rgba(255,255,255,0.4)");
  sg.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = sg;
  rr(x + 1, y + 1, w - 2, 6, 3);
  ctx.fill();

  // Outline
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.lineWidth = 1.5;
  rr(x, y, w, h, 4);
  ctx.stroke();

  // Moving glow
  if (moving) {
    ctx.strokeStyle = "rgba(0,220,255,0.5)";
    ctx.lineWidth = 1;
    rr(x, y, w, h, 4);
    ctx.stroke();
  }
}

// ── Spikes ──────────────────────────────────────────────────
function drawSpikes(ch) {
  levelData.spikes.forEach((s) => {
    const sg = ctx.createLinearGradient(s.x + 4, s.y, s.x + 4, s.y + 10);
    sg.addColorStop(0, "#e0e0e0");
    sg.addColorStop(1, "#666");
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.moveTo(s.x + 4, s.y);
    ctx.lineTo(s.x, s.y + 10);
    ctx.lineTo(s.x + 8, s.y + 10);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#999";
    ctx.lineWidth = 0.8;
    ctx.stroke();
    // shine
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.beginPath();
    ctx.moveTo(s.x + 4, s.y + 1);
    ctx.lineTo(s.x + 2, s.y + 5);
    ctx.lineTo(s.x + 4, s.y + 4);
    ctx.closePath();
    ctx.fill();
  });
}

// ── Z-Coins ─────────────────────────────────────────────────
function drawCoins() {
  levelData.coins.forEach((c) => {
    if (c.collected) return;
    const bob = Math.sin(t * 0.08 + c.x * 0.03) * 2.5;
    const cx2 = c.x + 4,
      cy = c.y + 4 + bob;
    const spin = Math.abs(Math.sin(t * 0.04 + c.x * 0.02));
    const cw = 8 * spin + 2;

    // Outer glow
    glow(cx2, cy, 14, "rgba(255,210,40,0.2)");

    // Coin body
    ctx.save();
    ctx.translate(cx2, cy);
    const cg = ctx.createRadialGradient(-cw * 0.2, -3, 0, 0, 0, cw * 0.9);
    cg.addColorStop(0, "#ffe87c");
    cg.addColorStop(0.5, "#ffd23f");
    cg.addColorStop(1, "#e6a800");
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.ellipse(0, 0, cw, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    // rim
    ctx.strokeStyle = "#b8860b";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(0, 0, cw, 7, 0, 0, Math.PI * 2);
    ctx.stroke();
    // Z letter (only when facing front)
    if (spin > 0.5) {
      ctx.fillStyle = "#a06000";
      ctx.font = "bold 7px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Z", 0, 0.5);
    }
    // shine
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.beginPath();
    ctx.ellipse(-cw * 0.2, -2, cw * 0.3, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

// ── Zombies ──────────────────────────────────────────────────
const ZOMBIE_PALETTES = [
  {
    skin: "#5a8c5a",
    skinD: "#3a5c3a",
    shirt: "#2a4a1a",
    pants: "#1a3a1a",
    hair: "#1a1a00",
  },
  {
    skin: "#8a7a3a",
    skinD: "#6a5a2a",
    shirt: "#4a3a10",
    pants: "#2a2a0a",
    hair: "#0a0a00",
  },
  {
    skin: "#6a4a8a",
    skinD: "#4a2a6a",
    shirt: "#3a1a5a",
    pants: "#1a0a3a",
    hair: "#0a000a",
  },
  {
    skin: "#8a4a4a",
    skinD: "#6a2a2a",
    shirt: "#5a1a1a",
    pants: "#3a0a0a",
    hair: "#1a0000",
  },
  {
    skin: "#4a6a8a",
    skinD: "#2a4a6a",
    shirt: "#1a3a5a",
    pants: "#0a1a3a",
    hair: "#000a1a",
  },
  {
    skin: "#6a8a4a",
    skinD: "#4a6a2a",
    shirt: "#3a5a1a",
    pants: "#1a3a0a",
    hair: "#0a1a00",
  },
  {
    skin: "#4a4a6a",
    skinD: "#2a2a4a",
    shirt: "#1a1a4a",
    pants: "#0a0a2a",
    hair: "#00000a",
  },
  {
    skin: "#2a2a3a",
    skinD: "#1a1a2a",
    shirt: "#1a0a2a",
    pants: "#0a0a1a",
    hair: "#000000",
  },
  {
    skin: "#7a5a3a",
    skinD: "#5a3a1a",
    shirt: "#4a3a1a",
    pants: "#2a1a0a",
    hair: "#0a0500",
  },
  {
    skin: "#4a004a",
    skinD: "#2a002a",
    shirt: "#3a003a",
    pants: "#1a001a",
    hair: "#0a000a",
  },
];

function drawZombies() {
  levelData.zombies.forEach((z) => {
    if (!z.alive) return;
    drawZombieSprite(z);
    // HP bar
    if (z.maxHp > 1) {
      const bw = 20,
        bx = z.x - 1,
        by = z.y - 10;
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      rr(bx, by, bw, 4, 2);
      ctx.fill();
      const hpPct = Math.max(0, z.hp / z.maxHp);
      ctx.fillStyle =
        hpPct > 0.5 ? "#00e676" : hpPct > 0.25 ? "#ffd93d" : "#ff4444";
      rr(bx, by, bw * hpPct, 4, 2);
      ctx.fill();
    }
  });
}

function drawZombieSprite(z) {
  const x = z.x,
    y = z.y;
  const flash = z.hitFlash > 0;
  const pal = ZOMBIE_PALETTES[Math.min(levelData.chIdx, 9)];
  const walk = Math.floor(t * 0.14) % 2;
  const bob = Math.sin(t * 0.1) * 1.2;
  const armSway = Math.sin(t * 0.09) * 3;
  const fr = z.facingRight;

  ctx.save();

  // Shadow
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(x + 9, y + 24, 9, 3, 0, 0, Math.PI * 2);
  ctx.fill();

  // LEGS
  const legG = ctx.createLinearGradient(x, y + 16, x, y + 26);
  legG.addColorStop(0, flash ? "#ff3355" : pal.pants);
  legG.addColorStop(1, flash ? "#ff1133" : shadeColor(pal.pants, -20));
  ctx.fillStyle = legG;
  rr(x + 2, y + 15 + bob, 6, 8 + (walk ? 2 : 0), 3);
  ctx.fill();
  rr(x + 9, y + 15 + bob, 6, 8 + (walk ? 0 : 2), 3);
  ctx.fill();
  // shoes
  ctx.fillStyle = flash ? "#ff4455" : "#1a1a1a";
  rr(x + (walk ? 1 : 2), y + 22 + bob, 7, 4, 2);
  ctx.fill();
  rr(x + (walk ? 9 : 8), y + 22 + bob, 7, 4, 2);
  ctx.fill();

  // BODY
  const bodyG = ctx.createLinearGradient(x, y + 7, x + 18, y + 17);
  bodyG.addColorStop(0, flash ? "#ff4466" : lightenColor(pal.shirt, 15));
  bodyG.addColorStop(1, flash ? "#cc2244" : pal.shirt);
  ctx.fillStyle = bodyG;
  rr(x + 1, y + 7 + bob, 16, 10, 4);
  ctx.fill();
  // shirt highlight
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  rr(x + 3, y + 8 + bob, 12, 3, 2);
  ctx.fill();
  // ripped shirt details
  ctx.strokeStyle = "rgba(0,0,0,0.2)";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(x + 6, y + 12 + bob);
  ctx.lineTo(x + 8, y + 16 + bob);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + 12, y + 10 + bob);
  ctx.lineTo(x + 10, y + 15 + bob);
  ctx.stroke();

  // ARMS (outstretched zombie reach)
  const armG = ctx.createLinearGradient(x, y + 7, x, y + 14);
  armG.addColorStop(0, flash ? "#ff4466" : pal.skin);
  armG.addColorStop(1, flash ? "#cc2244" : pal.skinD);
  ctx.fillStyle = armG;
  if (fr) {
    rr(x + 15, y + 6 + bob - armSway, 8, 5, 3);
    ctx.fill(); // front arm reaching
    rr(x - 5, y + 9 + bob, 6, 4, 3);
    ctx.fill(); // back arm
    // claws
    ctx.fillStyle = flash ? "#ff4466" : "#2a2a1a";
    [0, 3, 6].forEach((off) => {
      ctx.beginPath();
      ctx.moveTo(x + 23, y + 5 + bob - armSway + off);
      ctx.lineTo(x + 26, y + 4 + bob - armSway + off);
      ctx.lineTo(x + 25, y + 7 + bob - armSway + off);
      ctx.closePath();
      ctx.fill();
    });
  } else {
    rr(x - 7, y + 6 + bob - armSway, 8, 5, 3);
    ctx.fill();
    rr(x + 17, y + 9 + bob, 6, 4, 3);
    ctx.fill();
    [0, 3, 6].forEach((off) => {
      ctx.beginPath();
      ctx.moveTo(x - 7, y + 5 + bob - armSway + off);
      ctx.lineTo(x - 10, y + 4 + bob - armSway + off);
      ctx.lineTo(x - 9, y + 7 + bob - armSway + off);
      ctx.closePath();
      ctx.fill();
    });
  }

  // HEAD
  const headG = ctx.createRadialGradient(
    x + 9,
    y + 4 + bob,
    1,
    x + 9,
    y + 5 + bob,
    8,
  );
  headG.addColorStop(0, flash ? "#ff8888" : lightenColor(pal.skin, 20));
  headG.addColorStop(1, flash ? "#ff3355" : pal.skinD);
  ctx.fillStyle = headG;
  rr(x + 2, y + bob, 14, 10, 5);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.2)";
  ctx.lineWidth = 1;
  rr(x + 2, y + bob, 14, 10, 5);
  ctx.stroke();

  // Messy hair
  if (!flash) {
    ctx.fillStyle = pal.hair;
    rr(x + 2, y - 2 + bob, 14, 4, 3);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x + 4, y - 3 + bob, 3, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x + 9, y - 4 + bob, 2.5, 3, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x + 13, y - 2 + bob, 2, 2.5, 0.3, 0, Math.PI * 2);
    ctx.fill();
  }

  // GLOWING EYES
  // whites
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.ellipse(x + 5.5, y + 3.5 + bob, 2.5, 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x + 11.5, y + 3.5 + bob, 2.5, 2, 0, 0, Math.PI * 2);
  ctx.fill();
  // red pupils
  ctx.fillStyle = flash ? "#ff8888" : "#cc0000";
  ctx.beginPath();
  ctx.arc(x + 5.5, y + 3.5 + bob, 1.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + 11.5, y + 3.5 + bob, 1.3, 0, Math.PI * 2);
  ctx.fill();
  // glow aura
  if (!flash) {
    glow(x + 5.5, y + 3.5 + bob, 5, "rgba(255,0,0,0.25)");
    glow(x + 11.5, y + 3.5 + bob, 5, "rgba(255,0,0,0.25)");
  }

  // Rotten mouth / teeth
  ctx.fillStyle = flash ? "#ff2244" : "#2a0a0a";
  ctx.beginPath();
  ctx.ellipse(x + 9, y + 7.5 + bob, 4, 2, 0, 0, Math.PI * 2);
  ctx.fill();
  // jagged teeth
  ctx.fillStyle = "#e8e0d0";
  [
    [x + 6, y + 6.5 + bob],
    [x + 8, y + 6 + bob],
    [x + 10, y + 6.5 + bob],
    [x + 12, y + 7 + bob],
  ].forEach(([tx, ty]) => {
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx + 1.5, ty + 2);
    ctx.lineTo(tx + 3, ty);
    ctx.closePath();
    ctx.fill();
  });

  ctx.restore();
}

// ── Player ──────────────────────────────────────────────────
function drawPlayer() {
  const x = Math.round(player.x),
    y = Math.round(player.y);
  drawCharSmooth(x, y, selectedChar, player.facingRight, !player.onGround, t);
  if (player.attacking) {
    const af = player.attackFrame,
      dir = player.facingRight ? 1 : -1;
    const wx = player.x + (player.facingRight ? player.w + 2 : -14);
    const wy = player.y + 4;
    const swing = (af / 8) * Math.PI * 0.85 * dir - Math.PI * 0.1;
    ctx.save();
    ctx.translate(wx, wy);
    ctx.rotate(swing);
    drawWeaponShape(selectedWeapon, dir);
    ctx.restore();
  }
}

function drawWeaponShape(w, dir) {
  ctx.shadowColor = w.color;
  ctx.shadowBlur = 6;
  if (w.id === "hammer") {
    ctx.fillStyle = "#8B5e3c";
    ctx.fillRect(-2, 0, 4, 18);
    const hg = ctx.createLinearGradient(-8, -8, 8, -8);
    hg.addColorStop(0, lightenColor(w.color, 20));
    hg.addColorStop(1, w.color);
    ctx.fillStyle = hg;
    rr(-8, -8, 16, 8, 3);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.3)";
    ctx.lineWidth = 1;
    rr(-8, -8, 16, 8, 3);
    ctx.stroke();
  } else if (w.id === "sword") {
    const sg = ctx.createLinearGradient(-1.5, 0, 1.5, 24);
    sg.addColorStop(0, "#fff");
    sg.addColorStop(1, w.color);
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.moveTo(-1.5, 0);
    ctx.lineTo(1.5, 0);
    ctx.lineTo(0.5, 24);
    ctx.lineTo(-0.5, 24);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = w.color;
    rr(-6, -2, 12, 4, 2);
    ctx.fill();
  } else if (w.id === "boomerang" || w.id === "blade") {
    ctx.fillStyle = w.color;
    ctx.beginPath();
    ctx.ellipse(0, 6, 3, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    glow(0, 6, 8, w.color + "88");
  } else {
    // bat
    const bg = ctx.createLinearGradient(-2, 0, 2, 20);
    bg.addColorStop(0, lightenColor("#c8a060", 20));
    bg.addColorStop(1, "#8B5e3c");
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.moveTo(-2, 0);
    ctx.lineTo(2, 0);
    ctx.lineTo(5, 20);
    ctx.lineTo(-5, 20);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.2)";
    ctx.fillRect(-1, 2, 2, 10);
  }
  ctx.shadowBlur = 0;
}

function drawCharSmooth(x, y, ch, fr, jumping, t2) {
  const walk = Math.floor(t2 * 0.16) % 2;
  const bob = jumping ? 0 : Math.sin(t2 * 0.2) * 0.6;
  const lean = fr ? 2 : -2;

  ctx.save();

  // Shadow
  ctx.fillStyle = "rgba(0,0,0,0.2)";
  ctx.beginPath();
  ctx.ellipse(x + 8, y + 24, 7, 2.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // SHOES
  const shoeG = ctx.createLinearGradient(x, y + 20, x, y + 25);
  shoeG.addColorStop(0, lightenColor(ch.shoes || "#222", 20));
  shoeG.addColorStop(1, ch.shoes || "#222");
  ctx.fillStyle = shoeG;
  if (!jumping) {
    rr(x + (walk ? 0 : 1), y + 20 + bob, 7, 5, 3);
    ctx.fill();
    rr(x + (walk ? 8 : 9), y + 20 + bob, 7, 5, 3);
    ctx.fill();
    // sole
    ctx.fillStyle = "rgba(255,255,255,0.2)";
    ctx.fillRect(x + (walk ? 1 : 2), y + 23 + bob, 5, 1);
    ctx.fillRect(x + (walk ? 9 : 10), y + 23 + bob, 5, 1);
  } else {
    rr(x + 0, y + 19, 6, 5, 3);
    ctx.fill();
    rr(x + 9, y + 19, 6, 5, 3);
    ctx.fill();
  }

  // PANTS
  const pantsG = ctx.createLinearGradient(x, y + 13, x + 16, y + 22);
  pantsG.addColorStop(0, lightenColor(ch.pants, 15));
  pantsG.addColorStop(1, ch.pants);
  ctx.fillStyle = pantsG;
  if (!jumping) {
    rr(x + 2, y + 13 + bob, 6, 8 + (walk ? 2 : 0), 3);
    ctx.fill();
    rr(x + 8, y + 13 + bob, 6, 8 + (walk ? 0 : 2), 3);
    ctx.fill();
    // pants shine
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    ctx.fillRect(x + 3, y + 13 + bob, 3, 5);
  } else {
    rr(x + 2, y + 13, 6, 6, 3);
    ctx.fill();
    rr(x + 8, y + 13, 6, 6, 3);
    ctx.fill();
  }

  // BELT
  ctx.fillStyle = "#222";
  ctx.fillRect(x + 1, y + 12 + bob, 15, 2);
  ctx.fillStyle = "#ffd700";
  ctx.fillRect(x + 6, y + 12 + bob, 5, 2); // buckle

  // SHIRT / BODY
  const shirtG = ctx.createLinearGradient(x, y + 6, x + 16, y + 14);
  shirtG.addColorStop(0, lightenColor(ch.shirt, 25));
  shirtG.addColorStop(1, ch.shirt);
  ctx.fillStyle = shirtG;
  rr(x, y + 6 + bob, 16, 8, 3);
  ctx.fill();
  // shirt highlight
  ctx.fillStyle = "rgba(255,255,255,0.2)";
  rr(x + 2, y + 7 + bob, 12, 2, 2);
  ctx.fill();
  // outline
  ctx.strokeStyle = "rgba(0,0,0,0.18)";
  ctx.lineWidth = 1;
  rr(x, y + 6 + bob, 16, 8, 3);
  ctx.stroke();

  // ARMS
  ctx.fillStyle = shirtG;
  rr(x - 3, y + 6 + bob, 4, 7, 2);
  ctx.fill();
  rr(x + 15, y + 6 + bob, 4, 7, 2);
  ctx.fill();
  // hands
  const skinG = ctx.createRadialGradient(x + 2, y + 12, 0, x + 2, y + 12, 4);
  skinG.addColorStop(0, lightenColor(ch.skin, 20));
  skinG.addColorStop(1, ch.skin);
  ctx.fillStyle = skinG;
  ctx.beginPath();
  ctx.arc(fr ? x - 1 : x + 17, y + 13 + bob, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(fr ? x + 17 : x - 1, y + 13 + bob, 3.5, 0, Math.PI * 2);
  ctx.fill();

  // NECK
  ctx.fillStyle = ch.skin;
  rr(x + 5, y + 3 + bob, 6, 5, 2);
  ctx.fill();

  // HEAD
  const hg = ctx.createRadialGradient(x + 7, y + bob, 1, x + 8, y + 1 + bob, 8);
  hg.addColorStop(0, lightenColor(ch.skin, 25));
  hg.addColorStop(1, ch.skin);
  ctx.fillStyle = hg;
  rr(x + 1, y + bob, 14, 10, 5);
  ctx.fill();
  // face shine
  ctx.fillStyle = "rgba(255,255,255,0.15)";
  ctx.beginPath();
  ctx.ellipse(x + 6, y + 2 + bob, 3, 2.5, -0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.15)";
  ctx.lineWidth = 0.8;
  rr(x + 1, y + bob, 14, 10, 5);
  ctx.stroke();

  // HAIR
  const hairG = ctx.createLinearGradient(x, y - 2 + bob, x, y + 3 + bob);
  hairG.addColorStop(0, lightenColor(ch.hair, 15));
  hairG.addColorStop(1, ch.hair);
  ctx.fillStyle = hairG;
  rr(x + 1, y - 2 + bob, 14, 5, 4);
  ctx.fill();
  // character-specific hair
  if (ch.id === "mia" || ch.id === "nova") {
    ctx.beginPath();
    ctx.ellipse(x + 14, y + 3 + bob, 2, 5, 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  if (ch.id === "blaze") {
    ctx.fillStyle = "#ff6600";
    rr(x + 8, y - 5 + bob, 6, 5, 3);
    ctx.fill();
  }

  // EYES
  ctx.fillStyle = "#fff";
  const ex = fr ? x + 8 : x + 4;
  ctx.beginPath();
  ctx.ellipse(ex, y + 4.5 + bob, 2.5, 2.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(ex + 5, y + 4.5 + bob, 2.5, 2.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#1a1a2e";
  ctx.beginPath();
  ctx.arc(ex + 0.5, y + 4.5 + bob, 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(ex + 5.5, y + 4.5 + bob, 1.5, 0, Math.PI * 2);
  ctx.fill();
  // eye shine
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(ex + 1, y + 3.8 + bob, 0.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(ex + 6, y + 3.8 + bob, 0.7, 0, Math.PI * 2);
  ctx.fill();

  // MOUTH
  ctx.strokeStyle = "#8B3A3A";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  if (jumping) {
    ctx.arc(x + 8, y + 8 + bob, 2.5, 0.2, Math.PI - 0.2);
  } else {
    ctx.arc(x + 8, y + 7.5 + bob, 1.8, -0.3, Math.PI + 0.3, true);
  }
  ctx.stroke();

  ctx.restore();
}

// ── Projectiles ─────────────────────────────────────────────
function drawProjectiles() {
  projectiles.forEach((p) => {
    ctx.save();
    if (p.type === "boomerang") {
      ctx.translate(p.x + 5, p.y + 5);
      ctx.rotate(t * 0.3 * (p.returning ? -1 : 1));
      ctx.fillStyle = "#e67e22";
      ctx.beginPath();
      ctx.ellipse(0, 0, 8, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#f39c12";
      ctx.fillRect(-4, -1, 8, 2);
      glow(0, 0, 6, "rgba(230,126,34,0.4)");
    } else {
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 10;
      const pg = ctx.createLinearGradient(p.x, p.y, p.x + 10, p.y + 4);
      pg.addColorStop(0, "#fff");
      pg.addColorStop(1, p.color);
      ctx.fillStyle = pg;
      rr(p.x, p.y, 10, 4, 2);
      ctx.fill();
      glow(p.x + 5, p.y + 2, 8, p.color + "66");
    }
    ctx.restore();
  });
}

// ── Hit Effects ─────────────────────────────────────────────
function drawHitEffects() {
  hitEffects.forEach((e) => {
    ctx.save();
    ctx.globalAlpha = (e.life / 8) * 0.6;
    glow(
      e.x + e.w / 2,
      e.y + e.h / 2,
      e.w * 0.7,
      (e.color || "#ffaa00") + "aa",
    );
    ctx.restore();
  });
}

// ── Float Texts ─────────────────────────────────────────────
function drawFloatTexts() {
  floatTexts.forEach((f) => {
    ctx.save();
    const alpha = Math.min(1, f.life / 20);
    ctx.globalAlpha = alpha;
    ctx.font = "bold 11px 'Fredoka One',sans-serif";
    ctx.textAlign = "center";
    // outline
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.lineWidth = 3;
    ctx.strokeText(f.text, f.x - camX + 4, f.y);
    ctx.fillStyle = f.color || "#fff";
    ctx.fillText(f.text, f.x - camX + 4, f.y);
    ctx.restore();
  });
}

// ── Player HP bar ───────────────────────────────────────────
function drawPlayerHPBar() {
  if (!player) return;
  const bw = 70,
    bh = 7,
    bx = LW / 2 - 35,
    by = LH - 12;
  // bg
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  rr(bx - 1, by - 1, bw + 2, bh + 2, 4);
  ctx.fill();
  ctx.fillStyle = "#222";
  rr(bx, by, bw, bh, 3);
  ctx.fill();
  // bar
  const pct = Math.max(0, player.hp / player.maxHp);
  const barG = ctx.createLinearGradient(bx, by, bx + bw * pct, by);
  barG.addColorStop(
    0,
    pct > 0.5 ? "#06d6a0" : pct > 0.25 ? "#ffd23f" : "#ef233c",
  );
  barG.addColorStop(
    1,
    pct > 0.5 ? "#00b070" : pct > 0.25 ? "#f9a800" : "#c00020",
  );
  ctx.fillStyle = barG;
  rr(bx, by, bw * pct, bh, 3);
  ctx.fill();
  // sheen
  ctx.fillStyle = "rgba(255,255,255,0.2)";
  rr(bx, by, bw * pct, bh / 2, 3);
  ctx.fill();
  // label
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.font = "bold 6px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(`HP ${player.hp}/${player.maxHp}`, LW / 2, by - 2);
}

// ── Goal Flag ───────────────────────────────────────────────
function drawGoalFlag() {
  const fx = (levelData.levelW - 3) * TILE,
    gy = levelData.GROUND_Y * TILE;
  // Base
  const baseG = ctx.createLinearGradient(fx, gy - 4, fx + 16, gy);
  baseG.addColorStop(0, "#888");
  baseG.addColorStop(1, "#444");
  ctx.fillStyle = baseG;
  rr(fx + 2, gy - 5, 16, 5, 2);
  ctx.fill();
  // Pole
  const poleG = ctx.createLinearGradient(fx + 7, 0, fx + 9, 0);
  poleG.addColorStop(0, "#ddd");
  poleG.addColorStop(1, "#888");
  ctx.fillStyle = poleG;
  ctx.fillRect(fx + 7, gy - 58, 2, 58);
  // Waving flag
  ctx.save();
  for (let row = 0; row < 12; row++) {
    const wave = Math.sin(t * 0.1 + row * 0.4) * 4;
    const grad = ctx.createLinearGradient(fx + 9, 0, fx + 28 + wave, 0);
    grad.addColorStop(0, row < 6 ? "#ef233c" : "#ffffff");
    grad.addColorStop(1, row < 6 ? "#c90016" : "#dddddd");
    ctx.fillStyle = grad;
    ctx.fillRect(fx + 9, gy - 58 + row * 2, 20 + wave, 2);
  }
  // Z on flag
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.font = "bold 9px 'Fredoka One',sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Z", fx + 19, gy - 46);
  // glow on flag
  glow(fx + 19, gy - 50, 12, "rgba(255,80,80,0.2)");
  ctx.restore();
}

// ── Color utils ─────────────────────────────────────────────
function shadeColor(hex, amt) {
  let r = parseInt(hex.slice(1, 3) || "44", 16),
    g = parseInt(hex.slice(3, 5) || "44", 16),
    b = parseInt(hex.slice(5, 7) || "44", 16);
  r = Math.max(0, Math.min(255, r + amt));
  g = Math.max(0, Math.min(255, g + amt));
  b = Math.max(0, Math.min(255, b + amt));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}
function lightenColor(hex, amt) {
  return shadeColor(hex, amt);
}
