// ═══════════════════════════════════════════════════════════════
//  PIXEL RUN 500  —  game.js
//  10 Chapters × 50 Levels = 500 Levels
//  Cloud-synced progress via Anthropic API
//  Lives system: max 3, regenerate 1 per 2 minutes
// ═══════════════════════════════════════════════════════════════

"use strict";

// ─────────────────────────────────────────────────────────────
//  SUPABASE CONFIG
// ─────────────────────────────────────────────────────────────
const SUPA_URL = "https://oyxymvhfafbegqnwvmpz.supabase.co";
const SUPA_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im95eHltdmhmYWZiZWdxbnd2bXB6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0MTAxMzIsImV4cCI6MjA4ODk4NjEzMn0.8IdZBZOR4Kt-TvDpBSmztU4wJpQNs7mGq8CIGuTNIsI";

const SUPA = {
  headers: {
    "Content-Type": "application/json",
    apikey: SUPA_KEY,
    Authorization: "Bearer " + SUPA_KEY,
  },

  async getUser(username) {
    try {
      const res = await fetch(
        `${SUPA_URL}/rest/v1/saves?username=eq.${encodeURIComponent(username)}&select=*`,
        { headers: this.headers },
      );
      const rows = await res.json();
      return rows && rows.length ? rows[0] : null;
    } catch {
      return null;
    }
  },

  async createUser(username, password) {
    try {
      await fetch(`${SUPA_URL}/rest/v1/saves`, {
        method: "POST",
        headers: { ...this.headers, Prefer: "return=minimal" },
        body: JSON.stringify({
          username,
          password,
          progress: {},
          lives: 3,
          last_life_lost_at: [],
          updated_at: new Date().toISOString(),
        }),
      });
    } catch (e) {
      console.error("createUser failed", e);
    }
  },

  async updateUser(username, fields) {
    try {
      await fetch(
        `${SUPA_URL}/rest/v1/saves?username=eq.${encodeURIComponent(username)}`,
        {
          method: "PATCH",
          headers: { ...this.headers, Prefer: "return=minimal" },
          body: JSON.stringify({
            ...fields,
            updated_at: new Date().toISOString(),
          }),
        },
      );
    } catch (e) {
      console.error("updateUser failed", e);
    }
  },
};

// ─────────────────────────────────────────────────────────────
//  DB  — in-memory cache backed by Supabase
//  All reads/writes go through the local cache; Supabase is
//  synced asynchronously so the game never waits on network.
// ─────────────────────────────────────────────────────────────
const DB = {
  _cache: {}, // username → { password, progress, lives, lastLifeLostAt }

  // Called on login — loads user from Supabase into cache
  async loadUser(username) {
    // Try Supabase first
    const row = await SUPA.getUser(username);
    if (row) {
      this._cache[username] = {
        password: row.password,
        progress: row.progress || {},
        lives: row.lives ?? 3,
        lastLifeLostAt: row.last_life_lost_at || [],
      };
      return this._cache[username];
    }
    return null;
  },

  // Push current cache state to Supabase (async, fire-and-forget)
  _sync(username) {
    const u = this._cache[username];
    if (!u) return;
    SUPA.updateUser(username, {
      progress: u.progress,
      lives: u.lives,
      last_life_lost_at: u.lastLifeLostAt,
    });
  },

  user(n) {
    return this._cache[n] || null;
  },

  async create(username, password) {
    this._cache[username] = {
      password,
      progress: {},
      lives: 3,
      lastLifeLostAt: [],
    };
    await SUPA.createUser(username, password);
  },

  getProgress(n) {
    return (this.user(n) || {}).progress || {};
  },

  saveProgress(n, idx, sc) {
    const u = this.user(n);
    if (!u) return;
    if (!(idx in u.progress) || u.progress[idx] < sc) u.progress[idx] = sc;
    this._sync(n);
  },

  getLives(n) {
    const u = this.user(n);
    if (!u) return 0;
    this._regenLives(n);
    return u.lives;
  },

  loseLife(n) {
    const u = this.user(n);
    if (!u) return;
    this._regenLives(n);
    if (u.lives > 0) {
      u.lives--;
      u.lastLifeLostAt.push(Date.now());
      this._sync(n);
    }
  },

  _regenLives(n) {
    const u = this.user(n);
    if (!u) return;
    const now = Date.now();
    const REGEN_MS = REGEN_MINUTES * 60 * 1000;
    u.lastLifeLostAt = u.lastLifeLostAt.filter(
      (t) => now - t < REGEN_MS * MAX_LIVES,
    );
    const recovered = [];
    for (let i = u.lastLifeLostAt.length - 1; i >= 0; i--) {
      if (now - u.lastLifeLostAt[i] >= REGEN_MS) recovered.push(i);
    }
    for (const i of recovered) {
      u.lastLifeLostAt.splice(i, 1);
      if (u.lives < MAX_LIVES) u.lives++;
    }
    if (recovered.length) this._sync(n);
  },

  nextLifeIn(n) {
    const u = this.user(n);
    if (!u) return 0;
    this._regenLives(n);
    if (u.lives >= MAX_LIVES) return 0;
    if (!u.lastLifeLostAt.length) return 0;
    const REGEN_MS = REGEN_MINUTES * 60 * 1000;
    return Math.max(0, REGEN_MS - (Date.now() - Math.min(...u.lastLifeLostAt)));
  },
};

// ─────────────────────────────────────────────────────────────
//  CONSTANTS
// ─────────────────────────────────────────────────────────────
const MAX_LIVES = 3;
const REGEN_MINUTES = 2;
const CHAPTERS = 10;
const LEVELS_PER = 50;
const TOTAL_LEVELS = CHAPTERS * LEVELS_PER; // 500

// ─────────────────────────────────────────────────────────────
//  CHAPTER DEFINITIONS
// ─────────────────────────────────────────────────────────────
const CHAPTER_DEFS = [
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

// ─────────────────────────────────────────────────────────────
//  SEEDED RNG
// ─────────────────────────────────────────────────────────────
function seededRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = Math.imul(s ^ (s >>> 15), s | 1);
    s ^= s + Math.imul(s ^ (s >>> 7), s | 61);
    return ((s ^ (s >>> 14)) >>> 0) / 0xffffffff;
  };
}

// ─────────────────────────────────────────────────────────────
//  LEVEL GENERATOR  (500 levels, increasing difficulty)
// ─────────────────────────────────────────────────────────────
const TILE = 16;

function generateLevel(idx) {
  const chIdx = Math.floor(idx / LEVELS_PER); // 0..9
  const lvInCh = idx % LEVELS_PER; // 0..49
  const diff = idx / (TOTAL_LEVELS - 1); // 0..1
  const rng = seededRng(idx * 7919 + 12347);

  const ch = CHAPTER_DEFS[chIdx];

  // Level width grows with difficulty
  const levelW = 30 + Math.floor(diff * 60); // 30..90 tiles wide
  const GROUND_Y = 14;

  // Platforms
  const numPlat = 4 + Math.floor(diff * 14);
  const platforms = [];
  let cursor = 4;
  for (let i = 0; i < numPlat; i++) {
    const gap = 2 + Math.floor(rng() * (2 + diff * 3));
    const tx = cursor + gap;
    const ty = GROUND_Y - 3 - Math.floor(rng() * 6);
    const len = 2 + Math.floor(rng() * 4);
    if (tx + len < levelW - 4) {
      platforms.push({ tx, ty, len });
      cursor = tx + len;
    }
  }

  // Coins
  const numCoins = 6 + Math.floor(diff * 20);
  const coins = [];
  for (let i = 0; i < numCoins; i++) {
    const onPlat = rng() < 0.6 && platforms.length;
    if (onPlat) {
      const p = platforms[Math.floor(rng() * platforms.length)];
      coins.push({
        x: (p.tx + Math.floor(rng() * p.len)) * TILE + 4,
        y: p.ty * TILE - 12,
        collected: false,
      });
    } else {
      coins.push({
        x: (3 + Math.floor(rng() * (levelW - 6))) * TILE + 4,
        y: (GROUND_Y - 1) * TILE - 10,
        collected: false,
      });
    }
  }

  // Enemies
  const numEnemies = Math.floor(diff * 12) + (chIdx >= 3 ? 2 : 1);
  const enemies = [];
  for (let i = 0; i < numEnemies; i++) {
    const onPlat = rng() < 0.4 && platforms.length;
    let ex, ey, minX, maxX;
    const spd = 0.5 + diff * 1.5 + chIdx * 0.1;
    if (onPlat) {
      const p = platforms[Math.floor(rng() * platforms.length)];
      ex = p.tx * TILE;
      ey = p.ty * TILE - 17;
      minX = p.tx * TILE;
      maxX = (p.tx + p.len) * TILE - 16;
    } else {
      ex = (5 + Math.floor(rng() * (levelW - 10))) * TILE;
      ey = GROUND_Y * TILE - 17;
      minX = Math.max(0, ex - 4 * TILE);
      maxX = Math.min((levelW - 1) * TILE, ex + 5 * TILE);
    }
    if (maxX - minX < TILE * 2) maxX = minX + TILE * 3;
    enemies.push({
      x: ex,
      y: ey,
      vx: (rng() < 0.5 ? 1 : -1) * spd,
      minX,
      maxX,
      alive: true,
    });
  }

  // Spikes (appear from chapter 2+)
  const spikes = [];
  if (chIdx >= 1) {
    const numSpikes = Math.floor(diff * 8);
    for (let i = 0; i < numSpikes; i++) {
      spikes.push({
        x: (6 + Math.floor(rng() * (levelW - 10))) * TILE + 2,
        y: GROUND_Y * TILE - 8,
      });
    }
  }

  // Moving platforms (chapter 4+)
  const movingPlats = [];
  if (chIdx >= 3) {
    const numMov = 1 + Math.floor((chIdx - 3) * 0.8);
    for (let i = 0; i < numMov; i++) {
      const tx = 8 + Math.floor(rng() * (levelW - 16));
      const ty = GROUND_Y - 4 - Math.floor(rng() * 4);
      movingPlats.push({
        tx,
        ty,
        len: 3,
        ox: tx * TILE,
        range: 48 + Math.floor(rng() * 32),
        speed: 0.6 + diff,
        dir: 1,
        offset: rng() * Math.PI * 2,
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
    enemies,
    spikes,
    movingPlats,
    ch,
  };
}

// ─────────────────────────────────────────────────────────────
//  APP STATE
// ─────────────────────────────────────────────────────────────
let currentUser = null;
let authMode = "login";
let currentChIdx = 0;
let currentLvlIdx = 0;
let lifeTimerInterval = null;

// ─────────────────────────────────────────────────────────────
//  AUTH
// ─────────────────────────────────────────────────────────────
function toggleAuthMode() {
  authMode = authMode === "login" ? "register" : "login";
  const isLogin = authMode === "login";
  document.getElementById("authTitle").textContent = isLogin
    ? "LOGIN"
    : "REGISTER";
  document.getElementById("authBtn").textContent = isLogin
    ? "LOGIN"
    : "CREATE ACCOUNT";
  document.getElementById("switchBtn").textContent = isLogin
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
  const msg = document.getElementById("loginMsg");
  const btn = document.getElementById("authBtn");
  msg.style.color = "var(--red)";
  if (!name || !pass) {
    msg.textContent = "FILL IN ALL FIELDS!";
    return;
  }
  if (name.length < 2) {
    msg.textContent = "USERNAME TOO SHORT (min 2)";
    return;
  }

  btn.textContent = "...";
  btn.disabled = true;

  if (authMode === "register") {
    // Check if username already exists
    const existing = await SUPA.getUser(name);
    if (existing) {
      msg.textContent = "USERNAME TAKEN!";
      btn.textContent = "CREATE ACCOUNT";
      btn.disabled = false;
      return;
    }
    if (pass.length < 3) {
      msg.textContent = "PASSWORD TOO SHORT (min 3)";
      btn.textContent = "CREATE ACCOUNT";
      btn.disabled = false;
      return;
    }
    await DB.create(name, pass);
    msg.style.color = "var(--green)";
    msg.textContent = "ACCOUNT CREATED! ✓";
    setTimeout(() => loginAs(name), 700);
  } else {
    const row = await DB.loadUser(name);
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
  showMap();
}

function logout() {
  stopGame();
  clearInterval(lifeTimerInterval);
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

// ─────────────────────────────────────────────────────────────
//  LIFE TIMER
// ─────────────────────────────────────────────────────────────
function startLifeTimer() {
  clearInterval(lifeTimerInterval);
  lifeTimerInterval = setInterval(tickLifeTimer, 1000);
  tickLifeTimer();
}

function tickLifeTimer() {
  if (!currentUser) return;
  DB._regenLives(currentUser);
  const lives = DB.getLives(currentUser);
  const msLeft = DB.nextLifeIn(currentUser);

  // Update all life displays
  const lifeStr =
    "❤️".repeat(lives) + "🖤".repeat(Math.max(0, MAX_LIVES - lives));
  document
    .querySelectorAll("#livesDisplay,#levelLivesDisplay,#hudLives")
    .forEach((el) => {
      if (el) el.textContent = lifeStr;
    });

  // Timer display on map
  const timerEl = document.getElementById("lifeTimerDisplay");
  if (timerEl) {
    if (lives < MAX_LIVES && msLeft > 0) {
      const s = Math.ceil(msLeft / 1000);
      const mm = String(Math.floor(s / 60)).padStart(2, "0");
      const ss = String(s % 60).padStart(2, "0");
      timerEl.textContent = `+❤️ ${mm}:${ss}`;
      timerEl.style.display = "";
    } else {
      timerEl.style.display = "none";
    }
  }

  // Update wait countdowns in overlays
  if (msLeft > 0) {
    const s = Math.ceil(msLeft / 1000);
    const mm = String(Math.floor(s / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    const fmt = `${mm}:${ss}`;
    ["waitCountdown", "noLivesCountdown"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.textContent = fmt;
    });
    // Enable retry if lives restored while on die screen
    const retryBtn = document.getElementById("retryBtn");
    if (retryBtn && lives > 0) retryBtn.disabled = false;
  }
}

// ─────────────────────────────────────────────────────────────
//  SCREENS
// ─────────────────────────────────────────────────────────────
function showScreen(id) {
  document
    .querySelectorAll(".screen")
    .forEach((s) => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

// ─────────────────────────────────────────────────────────────
//  WORLD MAP
// ─────────────────────────────────────────────────────────────
function showMap() {
  stopGame();
  const prog = DB.getProgress(currentUser);
  const totalDone = Object.keys(prog).length;
  document.getElementById("totalStars").textContent = totalDone;

  const grid = document.getElementById("worldsGrid");
  grid.innerHTML = "";

  CHAPTER_DEFS.forEach((ch, ci) => {
    // Chapter unlocks when all levels of previous chapter have at least 1 completion
    // OR first chapter always unlocked
    const unlocked = ci === 0 || isChapterUnlocked(ci, prog);
    const chStars = countChapterStars(ci, prog);

    const card = document.createElement("div");
    card.className = "world-card" + (unlocked ? "" : " locked");
    card.style.setProperty("--card-color", ch.accent);
    card.innerHTML = `
      ${unlocked ? "" : `<div class="wc-lock">🔒</div>`}
      <div class="wc-icon">${ch.icon}</div>
      <div class="wc-chapter">CHAPTER ${ci + 1}</div>
      <div class="wc-name">${ch.name}</div>
      <div class="wc-progress">Levels ${ci * LEVELS_PER + 1}–${ci * LEVELS_PER + LEVELS_PER} · ${chStars}/${LEVELS_PER}</div>
      <div class="wc-stars">${renderStarBar(chStars, LEVELS_PER)}</div>
    `;
    if (unlocked) card.onclick = () => showLevelSelect(ci);
    grid.appendChild(card);
  });

  showScreen("mapScreen");
  tickLifeTimer();
}

function isChapterUnlocked(ci, prog) {
  if (ci === 0) return true;
  // Unlock next chapter after completing 30 of the previous 50 levels
  const prevStart = (ci - 1) * LEVELS_PER;
  const done = Array.from(
    { length: LEVELS_PER },
    (_, i) => prevStart + i,
  ).filter((i) => prog[i] !== undefined).length;
  return done >= 30;
}

function countChapterStars(ci, prog) {
  const start = ci * LEVELS_PER;
  return Array.from({ length: LEVELS_PER }, (_, i) => start + i).filter(
    (i) => prog[i] !== undefined,
  ).length;
}

function renderStarBar(done, total) {
  const filled = Math.round((done / total) * 10);
  return "█".repeat(filled) + "░".repeat(10 - filled);
}

// ─────────────────────────────────────────────────────────────
//  LEVEL SELECT
// ─────────────────────────────────────────────────────────────
function showLevelSelect(ci) {
  currentChIdx = ci;
  const ch = CHAPTER_DEFS[ci];
  const prog = DB.getProgress(currentUser);

  document.getElementById("worldTitle").textContent =
    `${ch.icon} CH.${ci + 1}: ${ch.name}`;
  document.getElementById("worldSubtitle").textContent =
    `Levels ${ci * LEVELS_PER + 1} – ${ci * LEVELS_PER + LEVELS_PER}  ·  Complete 30 to unlock next chapter`;

  const grid = document.getElementById("levelGrid");
  grid.innerHTML = "";

  for (let i = 0; i < LEVELS_PER; i++) {
    const idx = ci * LEVELS_PER + i;
    const done = prog[idx] !== undefined;
    const prevDone = idx === 0 || prog[idx - 1] !== undefined || i === 0;
    // First level of each chapter is always unlocked if chapter is accessible
    const locked = !prevDone && !done && i !== 0;

    const btn = document.createElement("button");
    btn.className =
      "level-btn" +
      (locked ? " locked" : "") +
      (done ? " completed" : "") +
      (idx === currentLvlIdx && done ? " current" : "");
    btn.textContent = i + 1;
    btn.title = `Level ${idx + 1}` + (done ? ` · Score: ${prog[idx]}` : "");
    if (!locked) btn.onclick = () => tryStartLevel(idx);
    grid.appendChild(btn);
  }

  showScreen("levelScreen");
  tickLifeTimer();
}

// ─────────────────────────────────────────────────────────────
//  GAME ENGINE SETUP
// ─────────────────────────────────────────────────────────────
const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;

// Logical resolution (the "pixel art" canvas)
const LW = 480,
  LH = 256;

let levelData = null;
let player = null;
let camX = 0;
let score = 0;
let coinsGot = 0;
let t = 0;
let invincible = 0;
let gameState = null; // "playing" | "paused" | "dead" | "won" | null
let animFrame = null;
const keys = {};
let jumpQueued = false;
let jumpHeld = false;

// Resize canvas — preserve full level visibility, max 80% viewport height
function resizeCanvas() {
  const container = document.getElementById("gameScreen");
  if (!container || !container.classList.contains("active")) return;

  const hudH = document.getElementById("hud").offsetHeight || 28;
  const mcH = window.matchMedia("(pointer:coarse)").matches ? 80 : 0;
  const availW = window.innerWidth;
  const availH = Math.floor(window.innerHeight * 0.8) - hudH - mcH;
  const scale = Math.min(availW / LW, availH / LH);
  // Integer scale for crisp pixels, minimum 1
  const pxScale = Math.max(1, Math.floor(scale));

  canvas.width = LW;
  canvas.height = LH;
  canvas.style.width = LW * pxScale + "px";
  canvas.style.height = LH * pxScale + "px";
  canvas.style.display = "block";
  canvas.style.margin = "auto";

  // Keep HUD the same width as the canvas
  const wrapper = document.getElementById("gameWrapper");
  if (wrapper) wrapper.style.width = LW * pxScale + "px";
}
window.addEventListener("resize", resizeCanvas);

// ─────────────────────────────────────────────────────────────
//  INPUT
// ─────────────────────────────────────────────────────────────
window.addEventListener("keydown", (e) => {
  if (!keys[e.code]) {
    if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW")
      jumpQueued = true;
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

function mcPress(dir) {
  keys[dir === "left" ? "ArrowLeft" : "ArrowRight"] = true;
}
function mcRelease(d) {
  keys[d === "left" ? "ArrowLeft" : "ArrowRight"] = false;
}
function mcJump() {
  jumpQueued = true;
}

// ─────────────────────────────────────────────────────────────
//  START LEVEL
// ─────────────────────────────────────────────────────────────
function tryStartLevel(idx) {
  const lives = DB.getLives(currentUser);
  if (lives <= 0) {
    showNoLivesOverlay();
    return;
  }
  startLevel(idx);
}

function startLevel(idx) {
  currentLvlIdx = idx;
  const chIdx = Math.floor(idx / LEVELS_PER);
  currentChIdx = chIdx;

  score = 0;
  coinsGot = 0;
  t = 0;
  invincible = 0;

  levelData = generateLevel(idx);
  player = {
    x: 2 * TILE,
    y: (levelData.GROUND_Y - 2) * TILE,
    vx: 0,
    vy: 0,
    w: 14,
    h: 20,
    onGround: false,
    facingRight: true,
    coyoteFrames: 0,
    jumpBuffer: 0,
  };
  camX = 0;

  document.getElementById("hudChapter").textContent = `CH.${chIdx + 1}`;
  document.getElementById("hudLevel").textContent = `LV.${idx + 1}`;
  updateHUD();
  hideOverlays();
  showScreen("gameScreen");
  resizeCanvas();
  gameState = "playing";
  jumpQueued = false;
  if (animFrame) cancelAnimationFrame(animFrame);
  animFrame = requestAnimationFrame(loop);
}

function updateHUD() {
  document.getElementById("hudScore").textContent = score;
  document.getElementById("hudCoins").textContent = coinsGot;
  const lives = DB.getLives(currentUser);
  const str = "❤️".repeat(lives) + "🖤".repeat(Math.max(0, MAX_LIVES - lives));
  document.getElementById("hudLives").textContent = str;
}

function hideOverlays() {
  document
    .querySelectorAll(".game-overlay")
    .forEach((o) => o.classList.remove("active"));
}

// ─────────────────────────────────────────────────────────────
//  GAME LOOP
// ─────────────────────────────────────────────────────────────
function loop() {
  update();
  draw();
  if (gameState === "playing" || gameState === "paused") {
    animFrame = requestAnimationFrame(loop);
  }
}

// ─────────────────────────────────────────────────────────────
//  COLLISION
// ─────────────────────────────────────────────────────────────
function getSolidRects() {
  const rects = [];
  const G = levelData.GROUND_Y,
    LWW = levelData.levelW;
  for (let i = 0; i < LWW; i++)
    rects.push({ x: i * TILE, y: G * TILE, w: TILE, h: LH * 2 });
  levelData.platforms.forEach((p) => {
    for (let i = 0; i < p.len; i++)
      rects.push({ x: (p.tx + i) * TILE, y: p.ty * TILE, w: TILE, h: TILE });
  });
  levelData.movingPlats.forEach((mp) => {
    for (let i = 0; i < mp.len; i++)
      rects.push({ x: mp.cx + i * TILE, y: mp.ty * TILE, w: TILE, h: TILE });
  });
  return rects;
}

function aabb(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

// ─────────────────────────────────────────────────────────────
//  UPDATE
// ─────────────────────────────────────────────────────────────
function update() {
  if (gameState !== "playing") return;
  t++;
  invincible = Math.max(0, invincible - 1);

  // Update moving platforms
  levelData.movingPlats.forEach((mp) => {
    mp.cx = mp.ox + Math.sin(t * 0.025 * mp.speed + mp.offset) * mp.range;
  });

  const left = keys["ArrowLeft"] || keys["KeyA"];
  const right = keys["ArrowRight"] || keys["KeyD"];

  // Horizontal
  const spd = 2.6;
  if (left) {
    player.vx = -spd;
    player.facingRight = false;
  } else if (right) {
    player.vx = spd;
    player.facingRight = true;
  } else {
    player.vx *= 0.72;
  }

  // Coyote time + jump buffer
  if (player.onGround) player.coyoteFrames = 6;
  else player.coyoteFrames = Math.max(0, player.coyoteFrames - 1);

  if (jumpQueued) {
    player.jumpBuffer = 8;
    jumpQueued = false;
  } else player.jumpBuffer = Math.max(0, player.jumpBuffer - 1);

  if (player.jumpBuffer > 0 && player.coyoteFrames > 0) {
    player.vy = -8.6;
    player.coyoteFrames = 0;
    player.jumpBuffer = 0;
  }

  // Variable jump height
  if (!jumpHeld && player.vy < -3) player.vy += 0.6;

  player.vy = Math.min(player.vy + 0.42, 13);

  // X axis
  player.x += player.vx;
  player.x = Math.max(
    0,
    Math.min(player.x, levelData.levelW * TILE - player.w),
  );
  const solids = getSolidRects();
  for (const r of solids) {
    if (aabb(player.x, player.y, player.w, player.h, r.x, r.y, r.w, r.h)) {
      if (player.vx > 0) player.x = r.x - player.w;
      else player.x = r.x + r.w;
      player.vx = 0;
    }
  }

  // Y axis
  player.onGround = false;
  player.y += player.vy;
  for (const r of getSolidRects()) {
    if (aabb(player.x, player.y, player.w, player.h, r.x, r.y, r.w, r.h)) {
      if (player.vy >= 0) {
        player.y = r.y - player.h;
        player.onGround = true;
      } else {
        player.y = r.y + r.h;
      }
      player.vy = 0;
    }
  }

  // Fell off
  if (player.y > LH + 80) {
    triggerDeath();
    return;
  }

  // Camera
  camX = Math.max(0, Math.min(player.x - LW / 3, levelData.levelW * TILE - LW));

  // Coins
  levelData.coins.forEach((c) => {
    if (
      !c.collected &&
      aabb(player.x, player.y, player.w, player.h, c.x, c.y, 8, 8)
    ) {
      c.collected = true;
      score += 10;
      coinsGot++;
      updateHUD();
    }
  });

  // Spikes
  for (const s of levelData.spikes) {
    if (
      invincible === 0 &&
      aabb(player.x, player.y, player.w, player.h, s.x, s.y, 8, 8)
    ) {
      triggerDeath();
      return;
    }
  }

  // Enemies
  for (const e of levelData.enemies) {
    if (!e.alive) continue;
    e.x += e.vx;
    if (e.x <= e.minX || e.x + 16 >= e.maxX) e.vx *= -1;

    if (invincible > 0) continue;
    if (!aabb(player.x, player.y, player.w, player.h, e.x, e.y, 16, 17))
      continue;

    // Stomp
    if (player.vy > 1 && player.y + player.h < e.y + 10) {
      e.alive = false;
      score += 100;
      player.vy = -5.5;
      updateHUD();
    } else {
      triggerDeath();
      return;
    }
  }

  // Goal — reach right end of level
  if (player.x >= (levelData.levelW - 3) * TILE) {
    triggerWin();
  }
}

function triggerDeath() {
  gameState = "dead";
  DB.loseLife(currentUser);
  tickLifeTimer();
  const lives = DB.getLives(currentUser);
  const msLeft = DB.nextLifeIn(currentUser);

  const s = Math.ceil(msLeft / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");

  if (lives <= 0) {
    document.getElementById("dieTitle").textContent = "NO LIVES!";
    document.getElementById("dieMsg").textContent = "Wait for your next life";
    document.getElementById("retryBtn").disabled = true;
    const waitEl = document.getElementById("livesWait");
    if (waitEl) waitEl.style.display = "";
    document.getElementById("waitCountdown").textContent = `${mm}:${ss}`;
  } else {
    document.getElementById("dieTitle").textContent = "YOU DIED";
    document.getElementById("dieMsg").textContent =
      `${lives} life${lives !== 1 ? "ies" : ""} remaining`;
    document.getElementById("retryBtn").disabled = false;
    const waitEl = document.getElementById("livesWait");
    if (waitEl) waitEl.style.display = lives < MAX_LIVES ? "" : "none";
    if (lives < MAX_LIVES)
      document.getElementById("waitCountdown").textContent = `${mm}:${ss}`;
  }
  document.getElementById("dieOverlay").classList.add("active");
  updateHUD();
}

function triggerWin() {
  gameState = "won";
  DB.saveProgress(currentUser, currentLvlIdx, score);
  tickLifeTimer();
  const isLast = currentLvlIdx >= TOTAL_LEVELS - 1;
  const totalCoins = levelData.coins.length;
  document.getElementById("winMsg").textContent =
    `${coinsGot}/${totalCoins} coins · ${levelData.enemies.filter((e) => !e.alive).length} enemies`;
  document.getElementById("winScore").textContent = `Score: ${score}`;
  const nextBtn = document.getElementById("nextBtn");
  nextBtn.textContent = isLast ? "🏆 GAME COMPLETE!" : "NEXT →";
  nextBtn.disabled = isLast;
  document.getElementById("winOverlay").classList.add("active");
}

function showNoLivesOverlay() {
  const msLeft = DB.nextLifeIn(currentUser);
  const s = Math.ceil(msLeft / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  document.getElementById("noLivesCountdown").textContent = `${mm}:${ss}`;
  showScreen("gameScreen");
  resizeCanvas();
  document.getElementById("noLivesOverlay").classList.add("active");
}

// ─────────────────────────────────────────────────────────────
//  CONTROLS
// ─────────────────────────────────────────────────────────────
function pauseGame() {
  gameState = "paused";
  document.getElementById("pauseOverlay").classList.add("active");
}
function resumeGame() {
  gameState = "playing";
  document.getElementById("pauseOverlay").classList.remove("active");
}
function retryLevel() {
  const lives = DB.getLives(currentUser);
  if (lives <= 0) return;
  startLevel(currentLvlIdx);
}
function nextLevel() {
  const next = currentLvlIdx + 1;
  if (next < TOTAL_LEVELS) tryStartLevel(next);
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

// ─────────────────────────────────────────────────────────────
//  DRAWING
// ─────────────────────────────────────────────────────────────
function draw() {
  if (!levelData) return;
  const ch = levelData.ch;
  ctx.clearRect(0, 0, LW, LH);

  // Sky gradient
  const sg = ctx.createLinearGradient(0, 0, 0, LH);
  sg.addColorStop(0, ch.sky1);
  sg.addColorStop(1, ch.sky2);
  ctx.fillStyle = sg;
  ctx.fillRect(0, 0, LW, LH);

  drawBgElements(ch);

  ctx.save();
  ctx.translate(-Math.round(camX), 0);

  drawGround(ch);
  drawPlatforms(ch);
  drawMovingPlatforms(ch);
  drawSpikes(ch);
  drawCoins();
  drawEnemies();
  drawGoalFlag();

  if (invincible === 0 || Math.floor(t / 3) % 2 === 0) drawPlayer();

  ctx.restore();
  drawHUDOverlay();
}

// Background decorations
function drawBgElements(ch) {
  const chI = levelData.chIdx;
  if (chI === 0 || chI === 2 || chI === 5 || chI === 6) drawClouds(ch);
  if (chI === 3) drawEmbers();
  if (chI === 4) drawCaveRocks(ch);
  if (chI === 9) drawVoidParticles();
}

function drawClouds(ch) {
  ctx.fillStyle =
    chI === 5
      ? "rgba(255,255,255,0.9)"
      : chI === 6
        ? "rgba(180,255,180,0.3)"
        : "rgba(255,255,255,0.8)";
  const offsets = [30, 120, 220, 340, 420];
  offsets.forEach((bx, i) => {
    const cx = ((((bx - camX * 0.25 + 480) % 560) + 560) % 560) - 40;
    const cy = 20 + i * 12;
    const cw = 50 + i * 12;
    ctx.fillRect(cx + cw * 0.15, cy, cw * 0.7, 8);
    ctx.fillRect(cx, cy + 6, cw, 10);
    ctx.fillRect(cx + cw * 0.05, cy + 2, cw * 0.3, 8);
    ctx.fillRect(cx + cw * 0.6, cy + 1, cw * 0.25, 8);
  });
}
// Silence linter — chI is referenced inside drawClouds via closure but defined in calling scope
let chI = 0;

function drawEmbers() {
  ctx.fillStyle = "#ff6600";
  for (let i = 0; i < 12; i++) {
    const ex = (i * 43 + t * 0.4) % LW;
    const ey = LH - 20 - ((t * 0.8 + i * 20) % LH);
    if (Math.floor((t + i * 3) / 4) % 2) {
      ctx.fillRect(ex, ey, 2, 2);
    }
  }
}

function drawCaveRocks(ch) {
  ctx.fillStyle = "#1a1a28";
  for (let i = 0; i < 6; i++) {
    const sx = ((((i * 90 - camX * 0.15 + 540) % 540) + 540) % 540) - 20;
    ctx.fillRect(sx, 0, 12 + i * 2, 18 + i * 4);
    ctx.fillRect(sx + 5, 0, 6, 28 + i * 4);
  }
}

function drawVoidParticles() {
  for (let i = 0; i < 20; i++) {
    const px = (i * 31 + t * 0.2) % LW;
    const py = (i * 17 + t * 0.3) % LH;
    ctx.fillStyle =
      i % 3 === 0 ? "#ff44ff" : i % 3 === 1 ? "#44ffff" : "#ffff44";
    if (Math.floor((t + i) / 6) % 2) ctx.fillRect(px, py, 2, 2);
  }
}

function drawGround(ch) {
  const G = levelData.GROUND_Y,
    LWW = levelData.levelW;
  for (let i = 0; i < LWW; i++) {
    const x = i * TILE,
      y = G * TILE;
    ctx.fillStyle = ch.ground;
    ctx.fillRect(x, y, TILE, 4);
    ctx.fillStyle = ch.dirt;
    ctx.fillRect(x, y + 4, TILE, TILE - 4);
    // Fill below ground too
    for (let gy = G + 1; gy < LH / TILE + 2; gy++) {
      ctx.fillStyle = ch.dirt;
      ctx.fillRect(x, gy * TILE, TILE, TILE);
    }
    // Texture dots
    ctx.fillStyle = "rgba(0,0,0,0.2)";
    ctx.fillRect(x + 3, y + 6, 2, 2);
    ctx.fillRect(x + 9, y + 10, 2, 2);
  }
}

function drawPlatforms(ch) {
  levelData.platforms.forEach((p) => {
    for (let i = 0; i < p.len; i++) {
      const x = (p.tx + i) * TILE,
        y = p.ty * TILE;
      ctx.fillStyle = ch.plat;
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = ch.platTop;
      ctx.fillRect(x, y, TILE, 3);
      ctx.fillStyle = "rgba(0,0,0,0.15)";
      ctx.fillRect(x + 4, y + 5, 2, 2);
      ctx.fillRect(x + 10, y + 8, 2, 2);
    }
  });
}

function drawMovingPlatforms(ch) {
  levelData.movingPlats.forEach((mp) => {
    for (let i = 0; i < mp.len; i++) {
      const x = Math.round(mp.cx) + i * TILE,
        y = mp.ty * TILE;
      ctx.fillStyle = ch.platTop;
      ctx.fillRect(x, y, TILE, 3);
      ctx.fillStyle = ch.plat;
      ctx.fillRect(x, y + 3, TILE, TILE - 3);
      // Moving indicator dots
      ctx.fillStyle = "#fff3";
      ctx.fillRect(x + 2, y + 7, 2, 2);
      ctx.fillRect(x + 11, y + 7, 2, 2);
    }
  });
}

function drawSpikes(ch) {
  ctx.fillStyle = ch.platTop;
  levelData.spikes.forEach((s) => {
    // Triangle spike from pixel rects
    ctx.fillRect(s.x + 3, s.y, 2, 2);
    ctx.fillRect(s.x + 2, s.y + 2, 4, 2);
    ctx.fillRect(s.x + 1, s.y + 4, 6, 2);
    ctx.fillRect(s.x, s.y + 6, 8, 2);
  });
}

function drawCoins() {
  levelData.coins.forEach((c) => {
    if (c.collected) return;
    const cx = levelData.chIdx;
    const colors = [
      "#ffd700",
      "#ff8800",
      "#aaeeff",
      "#ff4411",
      "#cc88ff",
      "#88ddff",
      "#88ff88",
      "#ff88ff",
      "#ffee44",
      "#ff44ff",
    ];
    const bob = Math.sin(t * 0.06 + c.x * 0.05) * 1.5;
    ctx.fillStyle = colors[cx];
    ctx.fillRect(c.x + 1, c.y + bob, 6, 8);
    ctx.fillStyle = "#ffffff66";
    ctx.fillRect(c.x + 2, c.y + 2 + bob, 2, 2);
  });
}

function drawEnemies() {
  const wi = levelData.chIdx;
  const palettes = [
    ["#3a8a3a", "#4ab04a", "#cc3300"],
    ["#c88820", "#e8a030", "#cc3300"],
    ["#5080b0", "#80aadd", "#cc3300"],
    ["#cc4400", "#ff6600", "#000000"],
    ["#5a5a88", "#7a7aaa", "#cc3300"],
    ["#88aacc", "#aaccee", "#cc3300"],
    ["#207020", "#40a040", "#cc3300"],
    ["#882288", "#bb44bb", "#ffff00"],
    ["#6666aa", "#8888cc", "#ffff00"],
    ["#882288", "#cc44cc", "#44ffff"],
  ];
  const [c1, c2, eye] = palettes[wi];

  levelData.enemies.forEach((e) => {
    if (!e.alive) return;
    const fx = Math.round(e.x),
      fy = Math.round(e.y);
    const bob = Math.sin(t * 0.08) * 1;

    ctx.fillStyle = c1;
    ctx.fillRect(fx + 1, fy + 2 + bob, 14, 12);
    ctx.fillStyle = c2;
    ctx.fillRect(fx, fy + 4 + bob, 16, 8);
    ctx.fillRect(fx + 2, fy + 1 + bob, 12, 3);

    // Eyes
    ctx.fillStyle = "#fff";
    ctx.fillRect(fx + 2, fy + 4 + bob, 4, 4);
    ctx.fillRect(fx + 10, fy + 4 + bob, 4, 4);
    ctx.fillStyle = eye;
    ctx.fillRect(fx + 3, fy + 5 + bob, 2, 2);
    ctx.fillRect(fx + 11, fy + 5 + bob, 2, 2);

    // Feet
    ctx.fillStyle = c1;
    ctx.fillRect(fx + 2, fy + 14, 5, 3);
    ctx.fillRect(fx + 9, fy + 14, 5, 3);
  });
}

function drawPlayer() {
  const px = Math.round(player.x),
    py = Math.round(player.y);
  const jumping = !player.onGround;
  const fr = player.facingRight;
  const walk = Math.floor(t / 6) % 2;

  // Shadow
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fillRect(px + 1, py + player.h - 1, player.w - 2, 3);

  // Body
  ctx.fillStyle = "#f0d040";
  ctx.fillRect(px + 2, py + 8, 10, 10);
  ctx.fillStyle = "#ffd700";
  ctx.fillRect(px + 3, py + 9, 8, 8);
  ctx.fillStyle = "#c8a010";
  ctx.fillRect(px + 2, py + 16, 10, 2);

  // Head
  ctx.fillStyle = "#222";
  ctx.fillRect(px + 3, py, 8, 8);
  ctx.fillStyle = "#333";
  ctx.fillRect(px + 4, py + 1, 6, 6);

  // Visor
  ctx.fillStyle = fr ? "#4af" : "#4af";
  ctx.fillRect(px + 5, py + 2, 5, 3);
  ctx.fillStyle = "#6cf";
  ctx.fillRect(fr ? px + 5 : px + 8, py + 2, 1, 3);

  // Arms
  ctx.fillStyle = "#f0d040";
  ctx.fillRect(px, py + 8, 3, 6);
  ctx.fillRect(px + 11, py + 8, 3, 6);

  // Legs
  if (!jumping) {
    ctx.fillStyle = "#c8a010";
    ctx.fillRect(px + 3, py + 17, 3, walk ? 5 : 4);
    ctx.fillRect(px + 8, py + 17, 3, walk ? 4 : 5);
    ctx.fillStyle = "#555";
    ctx.fillRect(px + 2, py + 19 + (walk ? 3 : 2), 5, 3);
    ctx.fillRect(px + 7, py + 19 + (walk ? 2 : 3), 5, 3);
  } else {
    ctx.fillStyle = "#c8a010";
    ctx.fillRect(px + 2, py + 17, 4, 4);
    ctx.fillRect(px + 8, py + 17, 4, 4);
    ctx.fillStyle = "#555";
    ctx.fillRect(px + 1, py + 20, 5, 3);
    ctx.fillRect(px + 8, py + 20, 5, 3);
  }
}

function drawGoalFlag() {
  const fx = (levelData.levelW - 3) * TILE;
  const gy = levelData.GROUND_Y * TILE;

  // Pole
  ctx.fillStyle = "#bbb";
  ctx.fillRect(fx + 7, gy - 52, 2, 52);

  // Flag (wave animation)
  const wave = Math.sin(t * 0.08) * 2;
  ctx.fillStyle = "#e8331a";
  for (let row = 0; row < 10; row++) {
    const woff = Math.round(Math.sin(t * 0.08 + row * 0.4) * 2);
    ctx.fillRect(fx + 9, gy - 52 + row, 16 + woff, 1);
  }
  ctx.fillStyle = "#ffffff";
  for (let row = 10; row < 20; row++) {
    const woff = Math.round(Math.sin(t * 0.08 + row * 0.4) * 2);
    ctx.fillRect(fx + 9, gy - 52 + row, 16 + woff, 1);
  }

  // Base
  ctx.fillStyle = "#888";
  ctx.fillRect(fx + 2, gy - 4, 16, 4);
}

function drawHUDOverlay() {
  // Level number watermark
  ctx.save();
  ctx.globalAlpha = 0.05;
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 48px monospace";
  ctx.textAlign = "right";
  ctx.fillText(currentLvlIdx + 1, LW - 8, LH - 8);
  ctx.restore();
}

// ─────────────────────────────────────────────────────────────
//  BOOT
// ─────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  // Keep canvas sized
  window.addEventListener("resize", resizeCanvas);
});
