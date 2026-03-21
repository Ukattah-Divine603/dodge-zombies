"use strict";

// ═══════════════════════════════════════════════════════
//  SUPABASE
// ═══════════════════════════════════════════════════════
const SUPA_URL = "https://oyxymvhfafbegqnwvmpz.supabase.co";
const SUPA_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im95eHltdmhmYWZiZWdxbnd2bXB6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0MTAxMzIsImV4cCI6MjA4ODk4NjEzMn0.8IdZBZOR4Kt-TvDpBSmztU4wJpQNs7mGq8CIGuTNIsI";
const SUPA_H = {
  "Content-Type": "application/json",
  apikey: SUPA_KEY,
  Authorization: "Bearer " + SUPA_KEY,
};

function fetchWithTimeout(url, opts, ms = 6000) {
  return Promise.race([
    fetch(url, opts),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), ms),
    ),
  ]);
}

const SUPA = {
  h: SUPA_H,
  async getUser(u) {
    try {
      const r = await fetchWithTimeout(
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
      await fetchWithTimeout(
        `${SUPA_URL}/rest/v1/saves`,
        {
          method: "POST",
          headers: { ...this.h, Prefer: "return=minimal" },
          body: JSON.stringify({
            username: u,
            password: p,
            progress: {},
            lives: 5,
            last_life_lost_at: [],
            coins: 0,
            owned: { chars: [], weapons: [] },
            updated_at: new Date().toISOString(),
          }),
        },
        8000,
      );
    } catch (e) {
      console.error(e);
    }
  },
  async patch(u, fields) {
    try {
      fetch(`${SUPA_URL}/rest/v1/saves?username=eq.${encodeURIComponent(u)}`, {
        method: "PATCH",
        headers: { ...this.h, Prefer: "return=minimal" },
        body: JSON.stringify({
          ...fields,
          updated_at: new Date().toISOString(),
        }),
      });
    } catch (e) {}
  },
};

const LOCAL = {
  key(u) {
    return "prz_" + u;
  },
  save(u, data) {
    try {
      localStorage.setItem(this.key(u), JSON.stringify(data));
    } catch {}
  },
  load(u) {
    try {
      const s = localStorage.getItem(this.key(u));
      return s ? JSON.parse(s) : null;
    } catch {
      return null;
    }
  },
  clear(u) {
    try {
      localStorage.removeItem(this.key(u));
    } catch {}
  },
};

const MAX_LIVES = 5,
  REGEN_MIN = 2;
const DB = {
  _c: {},

  async load(u) {
    // Always hit Supabase — source of truth for lives
    const row = await SUPA.getUser(u);
    if (row) {
      const now = Date.now();
      const MS = REGEN_MIN * 60000;
      // Clean lla: must be valid numbers, in the past, not impossibly old
      const rawLla = (row.last_life_lost_at || [])
        .map(Number)
        .filter(
          (n) => !isNaN(n) && n > 0 && n <= now && now - n < MS * MAX_LIVES * 3,
        );
      // Recompute lives from lla directly — ignore stored lives value
      // (stored lives can be wrong if the app crashed mid-sync)
      const unregenerated = rawLla.filter((t) => now - t < MS);
      const correctLives = Math.max(
        0,
        Math.min(MAX_LIVES, MAX_LIVES - unregenerated.length),
      );

      const cloudData = {
        password: row.password,
        progress: row.progress || {},
        lives: correctLives,
        lla: rawLla,
        coins: row.coins || 0,
        owned: row.owned || { chars: [], weapons: [] },
      };

      // Merge progress/coins from local if better
      const cached = LOCAL.load(u);
      if (cached) {
        if (
          Object.keys(cached.progress || {}).length >
          Object.keys(cloudData.progress || {}).length
        ) {
          cloudData.progress = cached.progress;
        }
        cloudData.coins = Math.max(cloudData.coins, cached.coins || 0);
      }

      // If lives were wrong in Supabase, fix them now
      if (row.lives !== correctLives) {
        SUPA.patch(u, { lives: correctLives, last_life_lost_at: rawLla });
      }

      this._c[u] = cloudData;
      LOCAL.save(u, cloudData);
      return cloudData;
    }
    // Offline fallback
    const cached = LOCAL.load(u);
    if (cached) {
      this._c[u] = cached;
      return cached;
    }
    return null;
  },

  async _refreshFromCloud(u) {
    const row = await SUPA.getUser(u);
    if (row && this._c[u]) {
      const cloud = {
        password: row.password,
        progress: row.progress || {},
        lives: Math.min(row.lives ?? 5, MAX_LIVES),
        lla: (row.last_life_lost_at || []).map(Number).filter(Boolean),
        coins: row.coins || 0,
        owned: row.owned || { chars: [], weapons: [] },
      };
      const local = this._c[u];
      if (
        Object.keys(cloud.progress).length >= Object.keys(local.progress).length
      ) {
        // Keep whichever has more coins
        cloud.coins = Math.max(cloud.coins, local.coins || 0);
        this._c[u] = cloud;
        LOCAL.save(u, cloud);
      }
    }
  },

  _sync(u) {
    const d = this._c[u];
    if (!d) return;
    // Recompute lives before every save so Supabase always has correct value
    d.lives = this._computeLives(d);
    LOCAL.save(u, d);
    SUPA.patch(u, {
      progress: d.progress,
      lives: d.lives,
      last_life_lost_at: d.lla,
      coins: d.coins || 0,
      owned: d.owned || { chars: [], weapons: [] },
    });
  },

  getCoins(u) {
    return (this.user(u) || {}).coins || 0;
  },
  addCoins(u, n) {
    const d = this.user(u);
    if (!d) return;
    d.coins = (d.coins || 0) + n;
    this._sync(u);
    // Always update all coin displays immediately
    const mc = document.getElementById("mapCoins");
    if (mc) mc.textContent = d.coins;
    const cb = document.getElementById("charCoinBalance");
    if (cb) cb.textContent = `🪙 ${d.coins} coins`;
  },
  spendCoins(u, n) {
    const d = this.user(u);
    if (!d) return false;
    if ((d.coins || 0) < n) return false;
    d.coins -= n;
    this._sync(u);
    return true;
  },
  owns(u, type, id) {
    const d = this.user(u);
    if (!d) return false;
    return ((d.owned && d.owned[type]) || []).includes(id);
  },
  buy(u, type, id, cost) {
    if (!this.spendCoins(u, cost)) return false;
    const d = this.user(u);
    if (!d.owned) d.owned = { chars: [], weapons: [] };
    if (!d.owned[type]) d.owned[type] = [];
    d.owned[type].push(id);
    this._sync(u);
    return true;
  },

  user(u) {
    return this._c[u] || null;
  },

  async create(u, p) {
    const data = {
      password: p,
      progress: {},
      lives: 5,
      lla: [],
      coins: 0,
      owned: { chars: [], weapons: [] },
    };
    this._c[u] = data;
    LOCAL.save(u, data);
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

  // ── LIVES SYSTEM ──────────────────────────────────────
  // lla = array of timestamps when a life was LOST
  // Every REGEN_MIN minutes, one timestamp expires = +1 life
  // ─────────────────────────────────────────────────────

  _computeLives(d) {
    // Recompute lives from scratch based on lla timestamps
    // This avoids any state drift between regen calls
    if (!d) return MAX_LIVES;
    const now = Date.now();
    const MS = REGEN_MIN * 60000;
    // Clean lla: numbers only, not in the future, not too old
    d.lla = (d.lla || [])
      .map(Number)
      .filter((n) => !isNaN(n) && n > 0 && n <= now);
    // Count how many losses have NOT yet regenerated
    const unregenerated = d.lla.filter((t) => now - t < MS);
    // lives = max - unregenerated losses
    const computed = MAX_LIVES - unregenerated.length;
    return Math.max(0, Math.min(MAX_LIVES, computed));
  },

  getLives(u) {
    const d = this.user(u);
    if (!d) return 0;
    const lives = this._computeLives(d);
    // Update d.lives if it drifted (but don't sync for just a read)
    d.lives = lives;
    return lives;
  },

  loseLife(u) {
    const d = this.user(u);
    if (!d) return;
    const currentLives = this.getLives(u);
    if (currentLives > 0) {
      d.lla.push(Date.now());
      d.lives = this._computeLives(d);
      this._sync(u);
    }
  },

  nextLifeIn(u) {
    const d = this.user(u);
    if (!d) return 0;
    const lives = this.getLives(u);
    if (lives >= MAX_LIVES) return 0;
    const now = Date.now();
    const MS = REGEN_MIN * 60000;
    // Find the oldest unregenerated loss — it expires soonest
    const unregenerated = (d.lla || [])
      .map(Number)
      .filter((t) => !isNaN(t) && now - t < MS)
      .sort((a, b) => a - b);
    if (!unregenerated.length) return 0;
    return Math.max(0, MS - (now - unregenerated[0]));
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
    shoe: "#ffffff",
    speed: 1.1,
    jump: 1.0,
    hp: 100,
    coinCost: 0,
    unlockAt: 0,
    stats: ["⚡ Fast", "💪 Balanced", "❤️ 100 HP"],
  },
  {
    id: "zara",
    name: "ZARA",
    class: "Ninja",
    color: "#7209b7",
    skin: "#f4a261",
    hair: "#111",
    shirt: "#7209b7",
    pants: "#240046",
    shoe: "#7209b7",
    speed: 1.35,
    jump: 1.2,
    hp: 75,
    coinCost: 0,
    unlockAt: 0,
    stats: ["⚡⚡ Fastest", "🦘 High Jump", "❤️ 75 HP"],
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
    shoe: "#111",
    speed: 0.8,
    jump: 0.88,
    hp: 180,
    coinCost: 0,
    unlockAt: 0,
    stats: ["🐌 Slow", "🛡️ Tank", "❤️❤️ 180 HP"],
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
    jump: 1.2,
    hp: 90,
    coinCost: 0,
    unlockAt: 100,
    stats: ["🌙 Floaty", "🌊 Wide Jump", "✨ 90 HP"],
  },
  {
    id: "blaze",
    name: "BLAZE",
    class: "Firestarter",
    color: "#ff4800",
    skin: "#c0783c",
    hair: "#ff2200",
    shirt: "#ff4800",
    pants: "#4a1800",
    shoe: "#222",
    speed: 1.2,
    jump: 1.0,
    hp: 95,
    coinCost: 300,
    unlockAt: 0,
    stats: ["🔥 Attack +20%", "⚡ Fast", "❤️ 95 HP"],
  },
  {
    id: "nova",
    name: "NOVA",
    class: "Cyborg",
    color: "#00d4ff",
    skin: "#b0c8e0",
    hair: "#00ffff",
    shirt: "#0088aa",
    pants: "#003344",
    shoe: "#00d4ff",
    speed: 1.0,
    jump: 1.05,
    hp: 120,
    coinCost: 500,
    unlockAt: 0,
    stats: ["🤖 Cyber", "💙 120 HP", "⚡ Balanced"],
  },
  {
    id: "shadow",
    name: "SHADOW",
    class: "Phantom",
    color: "#aa44ff",
    skin: "#1a1a2e",
    hair: "#aa44ff",
    shirt: "#220033",
    pants: "#110022",
    shoe: "#aa44ff",
    speed: 1.25,
    jump: 1.15,
    hp: 80,
    coinCost: 750,
    unlockAt: 0,
    stats: ["👻 Phase Run", "🦘 Great Jump", "❤️ 80 HP"],
  },
  {
    id: "titan",
    name: "TITAN",
    class: "Warlord",
    color: "#ffd700",
    skin: "#c8a060",
    hair: "#8b6914",
    shirt: "#b8860b",
    pants: "#5a3800",
    shoe: "#ffd700",
    speed: 0.75,
    jump: 0.85,
    hp: 250,
    coinCost: 1200,
    unlockAt: 0,
    stats: ["👑 Legend", "🛡️🛡️ 250 HP", "💥 +40% DMG"],
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
    color: "#cccccc",
    damage: 35,
    range: 40,
    speed: 12,
    coinCost: 0,
    unlockAt: 0,
    desc: "Fast & reliable. Great starter.",
  },
  {
    id: "hammer",
    name: "HAMMER",
    icon: "🔨",
    color: "#cd853f",
    damage: 80,
    range: 35,
    speed: 22,
    coinCost: 0,
    unlockAt: 0,
    desc: "Slow but devastating. Crushes armoured.",
  },
  {
    id: "boomerang",
    name: "BOOMERANG",
    icon: "🪃",
    color: "#e67e22",
    damage: 25,
    range: 90,
    speed: 8,
    coinCost: 0,
    unlockAt: 50,
    desc: "Ranged, returns to you.",
  },
  {
    id: "blade",
    name: "E-BLADE",
    icon: "⚡",
    color: "#4cc9f0",
    damage: 45,
    range: 60,
    speed: 10,
    coinCost: 0,
    unlockAt: 150,
    desc: "Electric pulse. Long reach.",
  },
  {
    id: "axe",
    name: "FIRE AXE",
    icon: "🪓",
    color: "#ff4400",
    damage: 65,
    range: 45,
    speed: 16,
    coinCost: 200,
    unlockAt: 0,
    desc: "Burns on hit. Medium speed.",
  },
  {
    id: "spear",
    name: "SPEAR",
    icon: "🏹",
    color: "#88aaff",
    damage: 40,
    range: 80,
    speed: 10,
    coinCost: 350,
    unlockAt: 0,
    desc: "Long reach melee thrust.",
  },
  {
    id: "scythe",
    name: "SCYTHE",
    icon: "⚔️",
    color: "#8844ff",
    damage: 55,
    range: 55,
    speed: 14,
    coinCost: 500,
    unlockAt: 0,
    desc: "Wide arc — hits multiple zombies.",
  },
  {
    id: "cannon",
    name: "Z-CANNON",
    icon: "💣",
    color: "#ff6b35",
    damage: 120,
    range: 70,
    speed: 30,
    coinCost: 800,
    unlockAt: 0,
    desc: "Massive blast. Very slow reload.",
  },
  {
    id: "dagger",
    name: "TWIN DAGGERS",
    icon: "🔪",
    color: "#ffd700",
    damage: 25,
    range: 30,
    speed: 5,
    coinCost: 600,
    unlockAt: 0,
    desc: "Ultra-fast. Low damage, high DPS.",
  },
  {
    id: "laser",
    name: "LASER GUN",
    icon: "🔫",
    color: "#00ff88",
    damage: 50,
    range: 100,
    speed: 9,
    coinCost: 1000,
    unlockAt: 0,
    desc: "Longest range. Pierces enemies.",
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
  const fb =
    document.getElementById("forgotBtn") ||
    document.querySelector(".px-btn-forgot");
  if (fb) fb.style.display = L ? "block" : "none";
}

function showForgotPassword() {
  let el = document.getElementById("forgotOverlay");
  if (!el) {
    el = document.createElement("div");
    el.id = "forgotOverlay";
    el.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,0.88);display:flex;align-items:center;justify-content:center;z-index:999;font-family:'Press Start 2P',monospace;";
    el.innerHTML = `
      <div style="background:#0a0a1c;border:2px solid #1e1e3a;padding:28px 24px;width:min(340px,92vw);display:flex;flex-direction:column;gap:12px;">
        <div style="font-size:10px;color:#4ab04a;text-align:center;letter-spacing:2px;">RESET PASSWORD</div>
        <div style="font-size:7px;color:#6060a0;text-align:center;line-height:1.6;">Enter your username and choose a new password</div>
        <div style="display:flex;flex-direction:column;gap:5px;">
          <label style="font-size:7px;color:#6060a0;letter-spacing:2px;">USERNAME</label>
          <input id="fpUser" type="text" placeholder="your username" style="background:#06060f;border:2px solid #1e1e3a;color:#f0f0ff;padding:11px 10px;font-family:inherit;font-size:9px;outline:none;">
        </div>
        <div style="display:flex;flex-direction:column;gap:5px;">
          <label style="font-size:7px;color:#6060a0;letter-spacing:2px;">NEW PASSWORD</label>
          <input id="fpNew" type="password" placeholder="new password (min 3)" style="background:#06060f;border:2px solid #1e1e3a;color:#f0f0ff;padding:11px 10px;font-family:inherit;font-size:9px;outline:none;">
        </div>
        <div style="display:flex;flex-direction:column;gap:5px;">
          <label style="font-size:7px;color:#6060a0;letter-spacing:2px;">CONFIRM PASSWORD</label>
          <input id="fpConfirm" type="password" placeholder="confirm new password" style="background:#06060f;border:2px solid #1e1e3a;color:#f0f0ff;padding:11px 10px;font-family:inherit;font-size:9px;outline:none;">
        </div>
        <div id="fpMsg" style="font-size:7px;color:#e8331a;text-align:center;min-height:12px;"></div>
        <button onclick="submitForgotPassword()" style="background:#4ab04a;color:#fff;border:2px solid #2d7d2d;padding:12px;font-family:inherit;font-size:9px;cursor:pointer;letter-spacing:1px;">RESET PASSWORD</button>
        <button onclick="document.getElementById('forgotOverlay').remove()" style="background:transparent;color:#6060a0;border:2px solid #1e1e3a;padding:10px;font-family:inherit;font-size:9px;cursor:pointer;">CANCEL</button>
      </div>
    `;
    document.body.appendChild(el);
  }
  el.style.display = "flex";
}

async function submitForgotPassword() {
  const user = document.getElementById("fpUser").value.trim().toLowerCase();
  const np = document.getElementById("fpNew").value;
  const nc = document.getElementById("fpConfirm").value;
  const msg = document.getElementById("fpMsg");
  msg.style.color = "#e8331a";
  if (!user || !np || !nc) {
    msg.textContent = "FILL IN ALL FIELDS!";
    return;
  }
  if (np.length < 3) {
    msg.textContent = "PASSWORD TOO SHORT";
    return;
  }
  if (np !== nc) {
    msg.textContent = "PASSWORDS DON'T MATCH";
    return;
  }
  msg.style.color = "#6060a0";
  msg.textContent = "CHECKING...";
  const row = await SUPA.getUser(user);
  if (!row) {
    msg.style.color = "#e8331a";
    msg.textContent = "USERNAME NOT FOUND";
    return;
  }
  try {
    await fetchWithTimeout(
      `${SUPA_URL}/rest/v1/saves?username=eq.${encodeURIComponent(user)}`,
      {
        method: "PATCH",
        headers: { ...SUPA_H, Prefer: "return=minimal" },
        body: JSON.stringify({
          password: np,
          updated_at: new Date().toISOString(),
        }),
      },
      8000,
    );
    if (DB._c[user]) DB._c[user].password = np;
    LOCAL.save(user, { ...LOCAL.load(user), password: np });
    msg.style.color = "#4ab04a";
    msg.textContent = "PASSWORD RESET! ✓";
    setTimeout(() => document.getElementById("forgotOverlay").remove(), 1200);
  } catch (e) {
    msg.style.color = "#e8331a";
    msg.textContent = "NETWORK ERROR. TRY AGAIN.";
  }
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

  const origText = btn.textContent;
  btn.textContent = "...";
  btn.disabled = true;

  try {
    if (authMode === "register") {
      if (pass.length < 3) {
        msg.textContent = "PASSWORD TOO SHORT";
        return;
      }
      const localEx = LOCAL.load(name);
      if (localEx) {
        msg.textContent = "USERNAME TAKEN!";
        return;
      }
      msg.style.color = "rgba(255,255,255,0.5)";
      msg.textContent = "CHECKING...";
      const ex = await SUPA.getUser(name);
      if (ex) {
        msg.textContent = "USERNAME TAKEN!";
        msg.style.color = "var(--red)";
        return;
      }
      msg.textContent = "CREATING ACCOUNT...";
      await DB.create(name, pass);
      msg.style.color = "var(--green)";
      msg.textContent = "ACCOUNT CREATED! ✓";
      setTimeout(() => loginAs(name), 600);
    } else {
      // Always load from Supabase — never trust cached lives data
      msg.style.color = "rgba(255,255,255,0.5)";
      msg.textContent = "LOADING SAVE...";
      const row = await DB.load(name);
      if (!row) {
        msg.textContent = "USER NOT FOUND — REGISTER FIRST";
        msg.style.color = "var(--red)";
        return;
      }
      if (row.password !== pass) {
        msg.textContent = "WRONG USERNAME OR PASSWORD";
        msg.style.color = "var(--red)";
        return;
      }
      loginAs(name);
    }
  } finally {
    btn.textContent = origText;
    btn.disabled = false;
  }
}

function loginAs(name) {
  currentUser = name;
  document.getElementById("playerName").textContent = name.toUpperCase();
  startLifeTimer();
  const seenKey = "prz_seen_instructions_" + name;
  if (!localStorage.getItem(seenKey)) {
    localStorage.setItem(seenKey, "1");
    const el = document.getElementById("instructionsOverlay");
    if (el) el.style.display = "flex";
  } else {
    showCharSelect();
  }
}

function closeInstructions() {
  const el = document.getElementById("instructionsOverlay");
  if (el) el.style.display = "none";
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
  function checkOrientation() {
    const isMobile = window.matchMedia("(pointer: coarse)").matches;
    const isPortrait = window.innerHeight > window.innerWidth;
    const prompt = document.getElementById("rotatePrompt");
    if (prompt) prompt.style.display = isMobile && isPortrait ? "flex" : "none";
  }
  window.addEventListener("resize", checkOrientation);
  window.addEventListener("orientationchange", checkOrientation);
  checkOrientation();
  try {
    screen.orientation.lock("landscape").catch(() => {});
  } catch (e) {}
});

function togglePassword() {
  const inp = document.getElementById("passwordInput");
  const btn = document.getElementById("passToggle");
  const isHidden = inp.type === "password";
  inp.type = isHidden ? "text" : "password";
  btn.textContent = isHidden ? "🙈" : "👁";
}

function updateWeaponBtn() {
  const btn = document.getElementById("mcAtkBtn");
  if (btn) btn.textContent = selectedWeapon.icon;
}

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
  // Always hide all overlays before switching screens
  document
    .querySelectorAll(".game-overlay")
    .forEach((o) => o.classList.remove("active"));
  // Hide game canvas background when not on game screen
  const gameScreen = document.getElementById("gameScreen");
  if (id !== "gameScreen") {
    gameScreen.style.display = "none";
  }
  document
    .querySelectorAll(".screen")
    .forEach((s) => s.classList.remove("active"));
  const target = document.getElementById(id);
  target.classList.add("active");
  if (id === "gameScreen") {
    gameScreen.style.display = "";
  }
}

// ═══════════════════════════════════════════════════════
//  CHARACTER SELECT
// ═══════════════════════════════════════════════════════
function showCharSelect() {
  stopGame();
  const prog = DB.getProgress(currentUser),
    done = Object.keys(prog).length;
  const coinBal = document.getElementById("charCoinBalance");
  if (coinBal) coinBal.textContent = `🪙 ${DB.getCoins(currentUser)} coins`;

  const cg = document.getElementById("charGrid");
  cg.innerHTML = "";
  CHARACTERS.forEach((ch, i) => {
    const levelLocked = done < ch.unlockAt;
    const coinLocked = ch.coinCost > 0 && !DB.owns(currentUser, "chars", ch.id);
    const locked = levelLocked || coinLocked;
    const card = document.createElement("div");
    card.className =
      "char-card" +
      (selectedChar.id === ch.id ? " selected" : "") +
      (locked ? " locked" : "");
    card.style.setProperty("--char-color", ch.color);
    const lockBtnHtml = coinLocked
      ? `<div class="char-locked" onclick="event.stopPropagation();buyChar('${ch.id}')"><div class="char-locked-btn">🪙 ${ch.coinCost} coins</div><div class="char-locked-label">tap to unlock</div></div>`
      : levelLocked
        ? `<div class="char-locked"><div class="char-locked-btn" style="background:rgba(255,255,255,0.15);box-shadow:none">🔒 ${ch.unlockAt} levels</div><div class="char-locked-label">complete more levels</div></div>`
        : "";
    card.innerHTML = `
      <div class="char-avatar"><canvas class="char-canvas" width="72" height="72" id="cp_${ch.id}"></canvas></div>
      <div class="char-name">${ch.name}</div>
      <div class="char-class">${ch.class}</div>
      <div class="char-stats">${ch.stats.map((s) => `<span class="stat-pip">${s}</span>`).join("")}</div>
      ${lockBtnHtml}
    `;
    if (!locked) card.onclick = () => selectChar(ch.id);
    else if (coinLocked) card.onclick = () => buyChar(ch.id);
    cg.appendChild(card);
    setTimeout(() => {
      const cv = document.getElementById(`cp_${ch.id}`);
      if (cv) {
        const cx = cv.getContext("2d");
        cx.imageSmoothingEnabled = true;
        drawCharPreview(cx, ch, 72);
      }
    }, 20);
  });

  // Update NEXT button state
  updateNextBtn();
  showScreen("charScreen");
}

function updateNextBtn() {
  const btn = document.getElementById("charNextBtn");
  if (btn) btn.disabled = false; // always enabled since a char is always selected
}

function goToWeaponSelect() {
  // Build weapon screen with selected char info
  const prog = DB.getProgress(currentUser),
    done = Object.keys(prog).length;
  const ch = selectedChar;

  // Update weapon screen char info
  const wsName = document.getElementById("wsCharName");
  const wsStats = document.getElementById("wsCharStats");
  const wsCanvas = document.getElementById("wsCharCanvas");
  const wsCoins = document.getElementById("wsCoinsBalance");

  if (wsName) wsName.textContent = ch.name;
  if (wsStats)
    wsStats.innerHTML = ch.stats
      .map((s) => `<span class="stat-pip">${s}</span>`)
      .join("");
  if (wsCoins) wsCoins.textContent = `🪙 ${DB.getCoins(currentUser)} coins`;
  if (wsCanvas) {
    const cx = wsCanvas.getContext("2d");
    cx.imageSmoothingEnabled = true;
    updateCharPreviewOnCanvas(cx, ch, 120, 160);
  }

  // Build weapon grid on weapon screen
  const wg = document.getElementById("weaponGrid");
  wg.innerHTML = "";
  WEAPONS.forEach((w) => {
    const levelLocked = w.unlockAt > 0 && done < w.unlockAt;
    const coinLocked = w.coinCost > 0 && !DB.owns(currentUser, "weapons", w.id);
    const wLocked = levelLocked || coinLocked;
    const card = document.createElement("div");
    card.className =
      "weapon-card-big" +
      (selectedWeapon.id === w.id ? " selected" : "") +
      (wLocked ? " locked" : "");
    const wLockMsg = levelLocked
      ? `🔒 ${w.unlockAt} lvls`
      : coinLocked
        ? `🪙 ${w.coinCost}`
        : "";
    card.innerHTML = `
      <div class="wcb-icon">${w.icon}</div>
      <div class="wcb-name">${w.name}</div>
      <div class="wcb-stats">DMG ${w.damage} · RNG ${w.range}</div>
      ${wLockMsg ? `<div class="wcb-lock">${wLockMsg}</div>` : ""}
    `;
    if (!wLocked) card.onclick = () => selectWeaponAndUpdate(w.id);
    else if (coinLocked) card.onclick = () => buyWeapon(w.id);
    wg.appendChild(card);
  });

  updateLetsGoBtn();
  showScreen("weaponScreen");
}

function selectWeaponAndUpdate(id) {
  selectWeapon(id);
  // Refresh selected state on weapon cards
  document.querySelectorAll(".weapon-card-big").forEach((c, i) => {
    c.classList.toggle("selected", WEAPONS[i]?.id === id);
    if (WEAPONS[i]?.id === id) {
      c.style.transition = "transform 0.15s, box-shadow 0.15s";
      c.style.transform = "scale(1.1)";
      c.style.boxShadow =
        "0 0 30px " +
        (selectedWeapon.color || "#ffd23f") +
        ", 0 0 60px " +
        (selectedWeapon.color || "#ffd23f") +
        "66";
    } else {
      c.style.opacity = "0.4";
      c.style.transform = "scale(0.95)";
    }
  });
  setTimeout(showMap, 1500);
}

function updateLetsGoBtn() {
  const btn = document.getElementById("letsGoBtn");
  if (btn) btn.disabled = false;
}

function updateCharPreviewOnCanvas(px, ch, w, h) {
  px.clearRect(0, 0, w, h);
  px.imageSmoothingEnabled = true;
  px.fillStyle = ch.color + "22";
  px.fillRect(0, 0, w, h);
  // Shadow
  px.fillStyle = "rgba(0,0,0,0.2)";
  px.beginPath();
  px.ellipse(w / 2, h * 0.97, w * 0.28, h * 0.04, 0, 0, Math.PI * 2);
  px.fill();
  // Shoes
  px.fillStyle = ch.shoe || "#333";
  px.beginPath();
  px.ellipse(w * 0.38, h * 0.9, w * 0.14, h * 0.05, 0, 0, Math.PI * 2);
  px.fill();
  px.beginPath();
  px.ellipse(w * 0.62, h * 0.9, w * 0.14, h * 0.05, 0, 0, Math.PI * 2);
  px.fill();
  // Pants
  px.fillStyle = ch.pants;
  px.beginPath();
  if (px.roundRect) px.roundRect(w * 0.32, h * 0.65, w * 0.15, h * 0.25, 3);
  else px.rect(w * 0.32, h * 0.65, w * 0.15, h * 0.25);
  px.fill();
  px.beginPath();
  if (px.roundRect) px.roundRect(w * 0.53, h * 0.65, w * 0.15, h * 0.25, 3);
  else px.rect(w * 0.53, h * 0.65, w * 0.15, h * 0.25);
  px.fill();
  // Body
  px.fillStyle = ch.shirt;
  px.beginPath();
  if (px.roundRect) px.roundRect(w * 0.27, h * 0.38, w * 0.46, h * 0.29, 6);
  else px.rect(w * 0.27, h * 0.38, w * 0.46, h * 0.29);
  px.fill();
  // Arms
  px.fillStyle = ch.shirt;
  px.beginPath();
  if (px.roundRect) px.roundRect(w * 0.15, h * 0.4, w * 0.13, h * 0.18, 5);
  else px.rect(w * 0.15, h * 0.4, w * 0.13, h * 0.18);
  px.fill();
  px.beginPath();
  if (px.roundRect) px.roundRect(w * 0.72, h * 0.4, w * 0.13, h * 0.18, 5);
  else px.rect(w * 0.72, h * 0.4, w * 0.13, h * 0.18);
  px.fill();
  // Hands
  px.fillStyle = ch.skin;
  px.beginPath();
  px.arc(w * 0.215, h * 0.6, w * 0.06, 0, Math.PI * 2);
  px.fill();
  px.beginPath();
  px.arc(w * 0.785, h * 0.6, w * 0.06, 0, Math.PI * 2);
  px.fill();
  // Neck
  px.fillStyle = ch.skin;
  px.beginPath();
  if (px.roundRect) px.roundRect(w * 0.43, h * 0.29, w * 0.13, h * 0.12, 3);
  else px.rect(w * 0.43, h * 0.29, w * 0.13, h * 0.12);
  px.fill();
  // Head
  px.fillStyle = ch.skin;
  px.beginPath();
  if (px.roundRect) px.roundRect(w * 0.3, h * 0.1, w * 0.38, h * 0.25, 12);
  else px.rect(w * 0.3, h * 0.1, w * 0.38, h * 0.25);
  px.fill();
  // Hair
  px.fillStyle = ch.hair;
  px.beginPath();
  if (px.roundRect) px.roundRect(w * 0.3, h * 0.08, w * 0.38, h * 0.11, 10);
  else px.rect(w * 0.3, h * 0.08, w * 0.38, h * 0.11);
  px.fill();
  // Eyes
  px.fillStyle = "#fff";
  px.beginPath();
  px.ellipse(w * 0.41, h * 0.19, w * 0.06, h * 0.04, 0, 0, Math.PI * 2);
  px.fill();
  px.beginPath();
  px.ellipse(w * 0.57, h * 0.19, w * 0.06, h * 0.04, 0, 0, Math.PI * 2);
  px.fill();
  px.fillStyle = "#1a1a2e";
  px.beginPath();
  px.arc(w * 0.42, h * 0.19, w * 0.03, 0, Math.PI * 2);
  px.fill();
  px.beginPath();
  px.arc(w * 0.58, h * 0.19, w * 0.03, 0, Math.PI * 2);
  px.fill();
  // Smile
  px.strokeStyle = "#8B3A3A";
  px.lineWidth = 2;
  px.beginPath();
  px.arc(w * 0.5, h * 0.25, w * 0.07, 0.2, Math.PI - 0.2);
  px.stroke();
  // Name badge
  px.fillStyle = ch.color;
  px.beginPath();
  if (px.roundRect) px.roundRect(w * 0.15, h * 0.93, w * 0.7, h * 0.06, 3);
  else px.rect(w * 0.15, h * 0.93, w * 0.7, h * 0.06);
  px.fill();
  px.fillStyle = "#fff";
  px.font = `bold ${Math.round(w * 0.09)}px sans-serif`;
  px.textAlign = "center";
  px.fillText(ch.name, w * 0.5, h * 0.97);
}

function getPlayerCoins() {
  return DB.getCoins(currentUser) || 0;
}

function buyChar(id) {
  const ch = CHARACTERS.find((c) => c.id === id);
  if (!ch || !ch.coinCost) return;
  const coins = getPlayerCoins();
  if (coins < ch.coinCost) {
    showShopMsg(`Need ${ch.coinCost} 🪙 (you have ${coins})`, "#ff4466");
    return;
  }
  if (confirm(`Buy ${ch.name} for ${ch.coinCost} coins?`)) {
    DB.buy(currentUser, "chars", id, ch.coinCost);
    showShopMsg(`${ch.name} unlocked! ✓`, "#06d6a0");
    showCharSelect();
  }
}

function buyWeapon(id) {
  const w = WEAPONS.find((x) => x.id === id);
  if (!w || !w.coinCost) return;
  const coins = getPlayerCoins();
  if (coins < w.coinCost) {
    showShopMsg(`Need ${w.coinCost} 🪙 (you have ${coins})`, "#ff4466");
    return;
  }
  if (confirm(`Buy ${w.name} for ${w.coinCost} coins?`)) {
    DB.buy(currentUser, "weapons", id, w.coinCost);
    showShopMsg(`${w.name} unlocked! ✓`, "#06d6a0");
    showCharSelect();
  }
}

function showShopMsg(msg, color) {
  let el = document.getElementById("shopMsg");
  if (!el) {
    el = document.createElement("div");
    el.id = "shopMsg";
    el.style.cssText =
      "position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#0f0c29;border-radius:50px;padding:10px 24px;font-family:'Nunito',sans-serif;font-weight:900;font-size:14px;z-index:9999;border:2px solid;box-shadow:0 4px 20px rgba(0,0,0,0.5);";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.color = color;
  el.style.borderColor = color;
  el.style.display = "block";
  clearTimeout(el._t);
  el._t = setTimeout(() => (el.style.display = "none"), 2500);
}

function updateCharPreview() {
  const cvs = document.getElementById("charPreviewCanvas");
  if (!cvs) return;
  const px = cvs.getContext("2d");
  const ch = selectedChar;
  px.clearRect(0, 0, 120, 160);
  px.imageSmoothingEnabled = true;
  px.fillStyle = ch.color + "22";
  px.fillRect(0, 0, 120, 160);
  px.fillStyle = "rgba(0,0,0,0.2)";
  px.beginPath();
  px.ellipse(60, 148, 28, 8, 0, 0, Math.PI * 2);
  px.fill();
  px.fillStyle = ch.shoe || "#333";
  px.beginPath();
  px.ellipse(44, 138, 14, 7, 0, 0, Math.PI * 2);
  px.fill();
  px.beginPath();
  px.ellipse(76, 138, 14, 7, 0, 0, Math.PI * 2);
  px.fill();
  px.fillStyle = ch.pants;
  px.beginPath();
  if (px.roundRect) px.roundRect(38, 100, 18, 38, 4);
  else px.rect(38, 100, 18, 38);
  px.fill();
  px.beginPath();
  if (px.roundRect) px.roundRect(64, 100, 18, 38, 4);
  else px.rect(64, 100, 18, 38);
  px.fill();
  px.fillStyle = ch.shirt;
  px.beginPath();
  if (px.roundRect) px.roundRect(32, 60, 56, 44, 8);
  else px.rect(32, 60, 56, 44);
  px.fill();
  px.fillStyle = "rgba(255,255,255,0.18)";
  px.beginPath();
  if (px.roundRect) px.roundRect(36, 63, 44, 10, 4);
  else px.rect(36, 63, 44, 10);
  px.fill();
  px.fillStyle = ch.shirt;
  px.beginPath();
  if (px.roundRect) px.roundRect(18, 62, 16, 28, 6);
  else px.rect(18, 62, 16, 28);
  px.fill();
  px.beginPath();
  if (px.roundRect) px.roundRect(86, 62, 16, 28, 6);
  else px.rect(86, 62, 16, 28);
  px.fill();
  px.fillStyle = ch.skin;
  px.beginPath();
  px.arc(26, 92, 7, 0, Math.PI * 2);
  px.fill();
  px.beginPath();
  px.arc(94, 92, 7, 0, Math.PI * 2);
  px.fill();
  px.fillStyle = ch.skin;
  px.beginPath();
  if (px.roundRect) px.roundRect(52, 46, 16, 18, 4);
  else px.rect(52, 46, 16, 18);
  px.fill();
  px.fillStyle = ch.skin;
  px.beginPath();
  if (px.roundRect) px.roundRect(38, 18, 44, 38, 14);
  else px.rect(38, 18, 44, 38);
  px.fill();
  px.fillStyle = ch.hair;
  px.beginPath();
  if (px.roundRect) px.roundRect(38, 14, 44, 16, 10);
  else px.rect(38, 14, 44, 16);
  px.fill();
  px.fillStyle = "#fff";
  px.beginPath();
  px.ellipse(52, 30, 6, 5, 0, 0, Math.PI * 2);
  px.fill();
  px.beginPath();
  px.ellipse(68, 30, 6, 5, 0, 0, Math.PI * 2);
  px.fill();
  px.fillStyle = "#1a1a2e";
  px.beginPath();
  px.arc(53, 30, 3, 0, Math.PI * 2);
  px.fill();
  px.beginPath();
  px.arc(69, 30, 3, 0, Math.PI * 2);
  px.fill();
  px.fillStyle = "#fff";
  px.beginPath();
  px.arc(54, 28, 1.2, 0, Math.PI * 2);
  px.fill();
  px.beginPath();
  px.arc(70, 28, 1.2, 0, Math.PI * 2);
  px.fill();
  px.strokeStyle = "#8B3A3A";
  px.lineWidth = 2;
  px.beginPath();
  px.arc(60, 38, 6, 0.2, Math.PI - 0.2);
  px.stroke();
  px.fillStyle = ch.color;
  px.beginPath();
  if (px.roundRect) px.roundRect(20, 148, 80, 14, 4);
  else px.rect(20, 148, 80, 14);
  px.fill();
  px.fillStyle = "#fff";
  px.font = "bold 9px sans-serif";
  px.textAlign = "center";
  px.fillText(ch.name, 60, 158);
  document.getElementById("previewName").textContent = ch.name;
  document.getElementById("previewStats").innerHTML = ch.stats.join("<br>");
}

function selectChar(id) {
  selectedChar = CHARACTERS.find((c) => c.id === id) || selectedChar;
  document.querySelectorAll(".char-card").forEach((c, i) => {
    c.classList.toggle("selected", CHARACTERS[i]?.id === id);
  });
  updateCharPreview();
  // Flash selected card then navigate after 1.5s
  const cards = document.querySelectorAll(".char-card");
  cards.forEach((c, i) => {
    if (CHARACTERS[i]?.id === id) {
      c.style.transition = "transform 0.15s, box-shadow 0.15s";
      c.style.transform = "scale(1.08)";
      c.style.boxShadow =
        "0 0 30px " +
        (selectedChar.color || "#ff6b35") +
        ", 0 0 60px " +
        (selectedChar.color || "#ff6b35") +
        "66";
    } else {
      c.style.opacity = "0.4";
      c.style.transform = "scale(0.95)";
    }
  });
  setTimeout(goToWeaponSelect, 1500);
}

function selectWeapon(id) {
  selectedWeapon = WEAPONS.find((w) => w.id === id) || selectedWeapon;
  document.querySelectorAll(".weapon-card-small").forEach((c, i) => {
    c.classList.toggle("selected", WEAPONS[i]?.id === id);
  });
  updateWeaponBtn();
}

function confirmCharWeapon() {
  showMap();
}
function letsGo() {
  showMap();
}

function drawCharPreview(previewCtx, ch, size) {
  previewCtx.clearRect(0, 0, size, size);
  previewCtx.fillStyle = ch.shirt;
  previewCtx.beginPath();
  previewCtx.arc(size / 2, size * 0.4, size * 0.22, 0, Math.PI * 2);
  previewCtx.fill();
  previewCtx.fillStyle = ch.skin;
  previewCtx.beginPath();
  previewCtx.arc(size / 2, size * 0.22, size * 0.18, 0, Math.PI * 2);
  previewCtx.fill();
  previewCtx.fillStyle = ch.hair;
  previewCtx.beginPath();
  previewCtx.arc(size / 2, size * 0.18, size * 0.18, Math.PI, Math.PI * 2);
  previewCtx.fill();
  previewCtx.fillStyle = ch.pants;
  previewCtx.fillRect(size * 0.3, size * 0.58, size * 0.16, size * 0.28);
  previewCtx.fillRect(size * 0.54, size * 0.58, size * 0.16, size * 0.28);
}

// ═══════════════════════════════════════════════════════
//  WORLD MAP
// ═══════════════════════════════════════════════════════
function showMap() {
  stopGame();
  const prog = DB.getProgress(currentUser);
  document.getElementById("totalStars").textContent = Object.keys(prog).length;
  const mc = document.getElementById("mapCoins");
  if (mc) mc.textContent = DB.getCoins(currentUser);
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

function getObjective(idx, rng, numZombies, numCoins) {
  const li = idx % LEVELS_PER;
  const chIdx = Math.floor(idx / LEVELS_PER);
  // First 5 levels of every chapter = just reach the exit
  if (li < 5) return { type: "reach", desc: "Reach the exit!" };
  // Levels 5-10: kill a small number
  if (li < 10)
    return {
      type: "kill_n",
      count: Math.max(1, Math.min(numZombies, 1 + Math.floor(rng() * 2))),
      desc: "",
    };
  const roll = rng();
  // kill_all only on later chapters and only if zombies are manageable
  if (roll < 0.3) {
    if (chIdx >= 3 && numZombies <= 12)
      return { type: "kill_all", desc: "Kill all zombies!" };
    // fallback to kill_n if kill_all would be too hard
    return {
      type: "kill_n",
      count: Math.max(1, Math.floor(numZombies * 0.4)),
      desc: "",
    };
  }
  // kill_n: max 40% of zombies, always achievable
  if (roll < 0.55)
    return {
      type: "kill_n",
      count: Math.max(
        1,
        Math.min(numZombies - 1, Math.floor(numZombies * 0.4)),
      ),
      desc: "",
    };
  // survive: max 20 seconds — never more
  if (roll < 0.7)
    return { type: "survive", seconds: 8 + Math.floor(rng() * 12), desc: "" };
  // coins: max 50% of coins on the level
  if (roll < 0.85)
    return {
      type: "coins",
      count: Math.max(3, Math.min(Math.floor(numCoins * 0.5), numCoins - 2)),
      desc: "",
    };
  return { type: "reach", desc: "Reach the exit!" };
}

function generateLevel(idx) {
  const chIdx = Math.floor(idx / LEVELS_PER),
    diff = idx / (TOTAL - 1),
    rng = seededRng(idx * 7919 + 12347);
  const ch = CHAPTERS_DEF[chIdx],
    levelW = 35 + Math.floor(diff * 80),
    GROUND_Y = 14;
  const platforms = [],
    spikes = [],
    movingPlats = [],
    crumblePlats = [];
  let cursor = 4;

  for (let i = 0, n = 5 + Math.floor(diff * 16); i < n; i++) {
    const gap = 2 + Math.floor(rng() * (3 + diff * 4 + chIdx * 0.3)),
      tx = cursor + gap;
    const ty = GROUND_Y - 3 - Math.floor(rng() * 7),
      len = 2 + Math.floor(rng() * 4);
    if (tx + len < levelW - 4) {
      platforms.push({ tx, ty, len });
      cursor = tx + len;
    }
  }

  if (chIdx >= 0) {
    const numCrumble = 2 + Math.floor(diff * 6);
    for (let i = 0; i < numCrumble; i++) {
      const tx = 5 + Math.floor(rng() * (levelW - 14));
      const ty = GROUND_Y - 3 - Math.floor(rng() * 5);
      crumblePlats.push({
        tx,
        ty,
        len: 2 + Math.floor(rng() * 3),
        state: "solid",
        timer: 0,
      });
    }
  }

  const coins = [];
  const numCoins = 10 + Math.floor(diff * 24);
  for (let i = 0; i < numCoins; i++) {
    if (rng() < 0.6 && platforms.length) {
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

  const zombies = [];
  const numZ =
    3 +
    Math.floor(diff * 18) +
    (chIdx >= 2 ? 3 : 0) +
    (chIdx >= 5 ? 3 : 0) +
    (chIdx >= 8 ? 3 : 0);
  for (let i = 0; i < numZ; i++) {
    const onP = rng() < 0.4 && platforms.length;
    let ex, ey, minX, maxX;
    const baseSpd = 0.7 + diff * 2.0 + chIdx * 0.14;
    const maxHp = 30 + Math.floor(diff * 120) + chIdx * 15;
    let type = 0;
    if (chIdx >= 1 && rng() < 0.3) type = 1;
    if (chIdx >= 1 && rng() < 0.25) type = 2;
    if (chIdx >= 2 && rng() < 0.25) type = 3;
    const spd =
      type === 1 ? baseSpd * 2.2 : type === 2 ? baseSpd * 0.65 : baseSpd;
    const hp = type === 2 ? maxHp * 2.8 : maxHp;
    const aggroRange = type === 3 ? 160 : type === 1 ? 130 : 100;
    if (onP) {
      const p = platforms[Math.floor(rng() * platforms.length)];
      ex = p.tx * TILE;
      ey = p.ty * TILE - 20;
      minX = p.tx * TILE;
      maxX = (p.tx + p.len) * TILE - 16;
    } else {
      ex = (4 + Math.floor(rng() * (levelW - 10))) * TILE;
      ey = GROUND_Y * TILE - 20;
      minX = Math.max(0, ex - 6 * TILE);
      maxX = Math.min((levelW - 1) * TILE, ex + 7 * TILE);
    }
    if (maxX - minX < TILE * 2) maxX = minX + TILE * 3;
    zombies.push({
      x: ex,
      y: ey,
      vx: (rng() < 0.5 ? 1 : -1) * spd,
      baseSpd: spd,
      minX,
      maxX,
      hp: Math.round(hp),
      maxHp: Math.round(hp),
      alive: true,
      hitFlash: 0,
      facingRight: true,
      attackCooldown: 0,
      type,
      variant: Math.floor(rng() * 3),
      aggroRange,
      throwTimer: 0,
      staggerTimer: 0,
    });
  }

  for (let i = 0, n = 1 + Math.floor(diff * 10) + chIdx; i < n; i++)
    spikes.push({
      x: (5 + Math.floor(rng() * (levelW - 10))) * TILE + 2,
      y: GROUND_Y * TILE - 8,
    });

  if (chIdx >= 2) {
    for (let i = 0, n = 1 + Math.floor((chIdx - 2) * 1.0); i < n; i++) {
      const tx = 8 + Math.floor(rng() * (levelW - 16)),
        ty = GROUND_Y - 4 - Math.floor(rng() * 4);
      movingPlats.push({
        tx,
        ty,
        len: 3,
        ox: tx * TILE,
        range: 48 + Math.floor(rng() * 48),
        speed: 0.8 + diff,
        offset: rng() * Math.PI * 2,
        cx: tx * TILE,
      });
    }
  }

  const objective = getObjective(idx, rng, numZ, numCoins);
  if (objective.type === "kill_n")
    objective.desc = `Kill ${objective.count} zombies!`;
  if (objective.type === "survive")
    objective.desc = `Survive ${objective.seconds}s!`;
  if (objective.type === "coins")
    objective.desc = `Collect ${objective.count} coins!`;

  // Every 10th level = boss level
  const isBossLevel = (idx + 1) % 10 === 0;
  if (isBossLevel) {
    const bossHp = 500 + Math.floor(diff * 1000);
    zombies.push({
      x: (levelW - 8) * TILE,
      y: GROUND_Y * TILE - 40,
      vx: 1,
      baseSpd: 1.2 + diff * 1.5,
      minX: 4 * TILE,
      maxX: (levelW - 4) * TILE,
      hp: bossHp,
      maxHp: bossHp,
      alive: true,
      hitFlash: 0,
      facingRight: false,
      attackCooldown: 0,
      type: 4,
      variant: 0,
      aggroRange: 999,
      throwTimer: 0,
      staggerTimer: 0,
      phase: 1,
      phaseTimer: 0,
      chargeFrames: 0,
      chargeVx: 0,
    });
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
    crumblePlats,
    ch,
    objective,
    exitLocked: objective.type !== "reach" && objective.type !== "survive",
    surviveTimer: 0,
    isBossLevel,
  };
}

// ═══════════════════════════════════════════════════════
//  GAME ENGINE
// ═══════════════════════════════════════════════════════
const canvas = document.getElementById("c"),
  ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = true;
ctx.imageSmoothingQuality = "high";

const DPR = Math.min(window.devicePixelRatio || 1, 3);

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
  floatTexts = [],
  particles = [];
let screenShake = 0;

// ═══════════════════════════════════════════════════════
//  RESIZE CANVAS — FIXED FULLSCREEN
// ═══════════════════════════════════════════════════════
function resizeCanvas() {
  const wrap = document.getElementById("gameWrapper");
  if (
    !wrap ||
    !document.getElementById("gameScreen").classList.contains("active")
  )
    return;
  const hudH = document.getElementById("hud").offsetHeight || 36;
  const isMobile = window.matchMedia("(pointer: coarse)").matches;
  const mcH = isMobile ? 110 : 0;

  if (!isMobile) {
    // Desktop: scale game world (LW x LH) up to fill the full window
    const cssW = window.innerWidth;
    const cssH = window.innerHeight - hudH;
    // Scale factors so the game world fills the screen
    const scaleX = cssW / LW;
    const scaleY = cssH / LH;
    canvas.width = Math.round(cssW * DPR);
    canvas.height = Math.round(cssH * DPR);
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    wrap.style.width = "100vw";
    wrap.style.height = "100vh";
    // Apply both DPR and game-world scale
    ctx.setTransform(scaleX * DPR, 0, 0, scaleY * DPR, 0, 0);
  } else {
    // Mobile: integer scale
    const availW = window.innerWidth,
      availH = window.innerHeight - hudH - mcH;
    const cssScale = Math.max(
      1,
      Math.floor(Math.min(availW / LW, availH / LH)),
    );
    const cssW = LW * cssScale,
      cssH = LH * cssScale;
    canvas.width = Math.round(cssW * DPR);
    canvas.height = Math.round(cssH * DPR);
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    wrap.style.width = cssW + "px";
    wrap.style.height = availH + hudH + "px";
    ctx.setTransform(cssScale * DPR, 0, 0, cssScale * DPR, 0, 0);
  }
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
  combo = 0;
  comboTimer = 0;
  screenShake = 0;
  projectiles = [];
  hitEffects = [];
  floatTexts = [];
  particles = [];
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
  updateWeaponBtn();
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
  hideOverlays();
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
    s = Math.ceil(ms / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, "0"),
    ss2 = String(s % 60).padStart(2, "0");
  document.getElementById("noLivesCountdown").textContent = `${mm}:${ss2}`;
  showScreen("gameScreen");
  resizeCanvas();
  document.getElementById("noLivesOverlay").classList.add("active");
}

function loop() {
  update();
  try {
    draw();
  } catch (e) {
    console.error("Draw error:", e);
  }
  if (gameState === "playing" || gameState === "paused")
    animFrame = requestAnimationFrame(loop);
}

let combo = 0,
  comboTimer = 0;

function checkObjective() {
  const obj = levelData.objective;
  const dead = levelData.zombies.filter((z) => !z.alive).length;
  if (obj.type === "kill_all")
    return levelData.zombies.filter((z) => z.alive).length === 0;
  if (obj.type === "kill_n") return dead >= obj.count;
  if (obj.type === "coins") return coinsGot >= obj.count;
  if (obj.type === "survive") return levelData.surviveTimer >= obj.seconds * 60;
  return true;
}

function getObjectiveHUD() {
  const obj = levelData.objective;
  const dead = levelData.zombies.filter((z) => !z.alive).length;
  if (obj.type === "kill_all")
    return `Kill all: ${dead}/${levelData.zombies.length}`;
  if (obj.type === "kill_n")
    return `Kill: ${Math.min(dead, obj.count)}/${obj.count}`;
  if (obj.type === "coins")
    return `Coins: ${Math.min(coinsGot, obj.count)}/${obj.count}`;
  if (obj.type === "survive") {
    const s = Math.max(
      0,
      obj.seconds - Math.floor((levelData.surviveTimer || 0) / 60),
    );
    return `Survive: ${s}s`;
  }
  return levelData.exitLocked ? "Complete objective!" : "Reach the exit!";
}

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
  if (levelData.crumblePlats) {
    levelData.crumblePlats.forEach((cp) => {
      if (cp.state === "solid" || cp.state === "shaking") {
        for (let i = 0; i < cp.len; i++)
          R.push({ x: (cp.tx + i) * TILE, y: cp.ty * TILE, w: TILE, h: TILE });
      }
    });
  }
  return R;
}
function aabb(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function update() {
  if (gameState !== "playing") return;
  t++;
  invincible = Math.max(0, invincible - 1);
  comboTimer = Math.max(0, comboTimer - 1);
  screenShake = Math.max(0, screenShake - 1);
  if (comboTimer === 0 && combo > 0) combo = 0;

  if (levelData.objective && levelData.objective.type === "survive") {
    levelData.surviveTimer = (levelData.surviveTimer || 0) + 1;
  }

  if (levelData.exitLocked && checkObjective()) {
    levelData.exitLocked = false;
    floatTexts.push({
      x: player.x,
      y: player.y - 20,
      text: "EXIT UNLOCKED! →",
      color: "#06d6a0",
      life: 90,
    });
  }

  levelData.movingPlats.forEach((mp) => {
    mp.cx = mp.ox + Math.sin(t * 0.025 * mp.speed + mp.offset) * mp.range;
  });

  if (levelData.crumblePlats) {
    levelData.crumblePlats.forEach((cp) => {
      if (cp.state === "solid") {
        const onTop = aabb(
          player.x,
          player.y + player.h - 2,
          player.w,
          4,
          cp.tx * TILE,
          cp.ty * TILE,
          cp.len * TILE,
          4,
        );
        if (onTop) {
          cp.state = "shaking";
          cp.timer = 40;
        }
      } else if (cp.state === "shaking") {
        cp.timer--;
        if (cp.timer <= 0) {
          cp.state = "broken";
          cp.timer = 180;
        }
      } else if (cp.state === "broken") {
        cp.timer--;
        if (cp.timer <= 0) cp.state = "solid";
      }
    });
  }

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
    SFX.jump();
  }
  if (!jumpHeld && player.vy < -3) player.vy += 0.6;
  player.vy = Math.min(player.vy + 0.42, 13);

  player.attackCooldown = Math.max(0, player.attackCooldown - 1);
  if (player.attacking) {
    player.attackFrame++;
    if (player.attackFrame > 8) player.attacking = false;
  }
  if (attackQueued) {
    if (player.attackCooldown === 0) {
      doAttack();
      attackQueued = false;
      player.attackCooldown = selectedWeapon.speed;
      player.attacking = true;
      player.attackFrame = 0;
    }
  }

  player.x += player.vx;
  player.x = Math.max(
    0,
    Math.min(player.x, levelData.levelW * TILE - player.w),
  );
  const solids = getSolids();
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
      SFX.coin();
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
    z.staggerTimer = Math.max(0, (z.staggerTimer || 0) - 1);
    z.throwTimer = Math.max(0, (z.throwTimer || 0) - 1);

    if (z.staggerTimer > 0) {
      z.x += z.vx * 0.1;
    } else {
      const dx = player.x - z.x,
        dist = Math.abs(dx);
      const aggro = z.aggroRange || 70;
      const inAggro = dist < aggro;
      if (z.type === 4) {
        z.phaseTimer = (z.phaseTimer || 0) + 1;
        const hp_pct = z.hp / z.maxHp;
        if (hp_pct < 0.5 && z.phase === 1) {
          z.phase = 2;
          screenShake = 16;
          floatTexts.push({
            x: z.x,
            y: z.y - 20,
            text: "ENRAGED!",
            color: "#ff0000",
            life: 80,
          });
        }
        const spd2 = z.baseSpd * (z.phase === 2 ? 1.6 : 1);
        if (z.phaseTimer % 180 === 0) {
          z.chargeVx = Math.sign(dx) * spd2 * 4;
          z.chargeFrames = 30;
          SFX.bossRoar();
        }
        if (z.chargeFrames > 0) {
          z.x += z.chargeVx;
          z.chargeFrames--;
          z.facingRight = z.chargeVx > 0;
        } else {
          z.vx = Math.sign(dx) * spd2;
          z.x += z.vx;
          z.facingRight = z.vx > 0;
        }
        if (z.phase === 2 && z.throwTimer === 0) {
          [-1, 0, 1].forEach((off) => {
            projectiles.push({
              x: z.x + 9,
              y: z.y,
              vx: Math.sign(dx) * (2 + Math.abs(off)),
              vy: -3 + off,
              damage: 25,
              type: "rock",
              life: 70,
              maxLife: 70,
              color: "#ff4400",
              returning: false,
            });
          });
          z.throwTimer = 90;
          SFX.bossThrow();
        }
      } else if (z.type === 3) {
        if (dist < 60) z.vx = -Math.sign(dx) * z.baseSpd;
        else if (!inAggro) z.vx = Math.sign(dx) * z.baseSpd * 0.5;
        else z.vx *= 0.8;
        if (inAggro && z.throwTimer === 0) {
          projectiles.push({
            x: z.x + 8,
            y: z.y + 4,
            vx: Math.sign(dx) * (3 + dist / 40),
            vy: -2,
            damage: 18,
            type: "rock",
            life: 60,
            maxLife: 60,
            color: "#888",
            returning: false,
          });
          z.throwTimer = 90;
        }
      } else if (inAggro) {
        z.vx = Math.sign(dx) * (z.baseSpd || z.vx) * (z.type === 1 ? 1.8 : 1);
      } else {
        if (z.x <= z.minX || z.x + 16 >= z.maxX) z.vx *= -1;
      }
      z.facingRight = z.vx > 0;
      z.x += z.vx;
      if (!inAggro) z.x = Math.max(z.minX, Math.min(z.x, z.maxX - 16));
    }

    if (
      invincible === 0 &&
      aabb(player.x, player.y, player.w, player.h, z.x, z.y, 18, 22)
    ) {
      if (player.vy > 1 && player.y + player.h < z.y + 10) {
        damageZombie(z, 40 + combo * 10, true);
        player.vy = -5.5;
      } else if (z.attackCooldown === 0) {
        z.attackCooldown = z.type === 1 ? 35 : 50;
        playerTakeDamage(z.type === 2 ? 35 : 20);
      }
    }
  }

  projectiles = projectiles.filter((p) => {
    p.x += p.vx;
    p.y += p.vy;
    if (p.type === "rock") p.vy += 0.15;
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
    if (p.type === "rock") {
      if (
        invincible === 0 &&
        aabb(p.x, p.y, 8, 8, player.x, player.y, player.w, player.h)
      ) {
        playerTakeDamage(12);
        return false;
      }
    } else {
      for (const z of levelData.zombies) {
        if (!z.alive) continue;
        if (aabb(p.x, p.y, 10, 10, z.x, z.y, 18, 22)) {
          damageZombie(z, p.damage, false);
          if (p.type !== "boomerang") return false;
        }
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

  const atFlag = player.x >= (levelData.levelW - 3) * TILE;
  if (atFlag && !levelData.exitLocked) triggerWin();
  else if (atFlag && levelData.exitLocked && t % 30 === 0) {
    floatTexts.push({
      x: player.x,
      y: player.y - 16,
      text: "⚠ " + levelData.objective.desc,
      color: "#ff4466",
      life: 32,
    });
  }
  if (
    levelData.objective &&
    levelData.objective.type === "survive" &&
    checkObjective()
  )
    triggerWin();
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
    let hits = 0;
    const dmgMult =
      selectedChar.id === "titan" ? 1.4 : selectedChar.id === "blaze" ? 1.2 : 1;
    for (const z of levelData.zombies) {
      if (z.alive && aabb(ax, ay, w.range, player.h - 4, z.x, z.y, 18, 22)) {
        damageZombie(z, Math.round(w.damage * dmgMult), false);
        hits++;
      }
    }
    hitEffects.push({
      x: ax,
      y: ay,
      w: w.range,
      h: player.h,
      life: 8,
      color: w.color,
    });
    if (hits > 1)
      floatTexts.push({
        x: player.x,
        y: player.y - 14,
        text: `${hits}x HIT!`,
        color: "#ff6b35",
        life: 40,
      });
  }
}

function damageZombie(z, dmg, isStomp) {
  const isArmoured = z.type === 2;
  if (isArmoured) dmg = Math.max(1, Math.floor(dmg * 0.4));
  z.hp -= dmg;
  z.hitFlash = 10;
  z.staggerTimer = isStomp ? 0 : 8;
  spawnParticles(
    z.x + 9,
    z.y + 10,
    isArmoured ? "#ff9900" : "#ff4466",
    isStomp ? 10 : 6,
  );
  SFX.hit(isArmoured);
  haptic(30);
  floatTexts.push({
    x: z.x + 4,
    y: z.y - 4,
    text: `-${dmg}`,
    color: isArmoured ? "#ff9900" : "#ff4466",
    life: 35,
  });
  if (z.hp <= 0) {
    z.alive = false;
    combo++;
    comboTimer = 120;
    const isBoss = z.type === 4;
    const base = isBoss ? 1000 : isArmoured ? 200 : z.type === 1 ? 150 : 100;
    const earned = base + (combo > 1 ? combo * 20 : 0);
    score += earned;
    updateHUD();
    spawnParticles(
      z.x + 9,
      z.y + 8,
      isBoss ? "#ffd700" : "#ff6b35",
      isBoss ? 30 : 16,
    );
    SFX.kill(isBoss);
    haptic(isBoss ? 200 : 60);
    floatTexts.push({
      x: z.x,
      y: z.y - 10,
      text: combo > 2 ? `${combo}x COMBO! +${earned}` : `+${earned}`,
      color: combo > 2 ? "#ff6b35" : "#ffd23f",
      life: 60,
    });
    if (isBoss)
      floatTexts.push({
        x: z.x - 10,
        y: z.y - 26,
        text: "BOSS DEFEATED!",
        color: "#ffd700",
        life: 120,
      });
  }
}

function playerTakeDamage(dmg) {
  player.hp -= dmg;
  invincible = 90;
  combo = 0;
  comboTimer = 0;
  screenShake = 8;
  SFX.hurt();
  haptic(80);
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
  SFX.death();
  document.getElementById("dieOverlay").classList.add("active");
  updateHUD();
}

function triggerWin() {
  gameState = "won";
  DB.saveProgress(currentUser, currentLvlIdx, score);
  // Add coins to wallet and update all displays immediately
  DB.addCoins(currentUser, coinsGot);
  tickLifeTimer();
  const isLast = currentLvlIdx >= TOTAL - 1;
  const killed = levelData.zombies.filter((z) => !z.alive).length;
  document.getElementById("winMsg").textContent =
    `${coinsGot} coins · ${killed} zombies · ${combo}x best combo`;
  document.getElementById("winScore").textContent = `Score: ${score}`;
  const nb = document.getElementById("nextBtn");
  nb.textContent = isLast ? "🏆 GAME COMPLETE!" : "NEXT →";
  nb.disabled = isLast;
  SFX.win();
  document.getElementById("winOverlay").classList.add("active");
  setTimeout(() => showLeaderboardBtn(currentLvlIdx), 300);
}

// ═══════════════════════════════════════════════════════
//  DRAWING
// ═══════════════════════════════════════════════════════
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

function draw() {
  if (!levelData) return;
  const ch = levelData.ch;
  const isMobile = window.matchMedia("(pointer: coarse)").matches;
  if (!isMobile) {
    const hudH = document.getElementById("hud").offsetHeight || 36;
    const scaleX = window.innerWidth / LW;
    const scaleY = (window.innerHeight - hudH) / LH;
    ctx.setTransform(scaleX * DPR, 0, 0, scaleY * DPR, 0, 0);
  }
  ctx.clearRect(0, 0, LW, LH);

  const sg = ctx.createLinearGradient(0, 0, 0, LH);
  sg.addColorStop(0, ch.sky1);
  sg.addColorStop(0.6, ch.sky2);
  sg.addColorStop(1, shadeColor(ch.sky2, -30));
  ctx.fillStyle = sg;
  ctx.fillRect(0, 0, LW, LH);

  drawBgDecor();

  // Screen shake
  const shakeX =
    screenShake > 0 ? (Math.random() - 0.5) * screenShake * 0.5 : 0;
  const shakeY =
    screenShake > 0 ? (Math.random() - 0.5) * screenShake * 0.5 : 0;

  ctx.save();
  ctx.translate(-Math.round(camX) + shakeX, shakeY);
  drawGround(ch);
  drawPlatforms(ch);
  drawMovingPlatforms(ch);
  drawCrumblePlatforms(ch);
  drawSpikes(ch);
  drawCoins();
  drawZombies();
  drawProjectiles();
  drawHitEffects();
  if (invincible === 0 || Math.floor(t / 3) % 2 === 0) drawPlayer();
  drawGoalFlag();
  drawParticles();
  ctx.restore();
  drawFloatTexts();
  drawPlayerHPBar();
  drawObjectiveHUD();
  drawComboMeter();
  drawBossBar();
}

function drawBgDecor() {
  const ci = levelData.chIdx;
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
      const grad = ctx.createLinearGradient(sx, LH - bh, sx + bw, LH);
      grad.addColorStop(0, bc2);
      grad.addColorStop(1, bc);
      ctx.fillStyle = grad;
      rr(sx, LH - bh - 10, bw, bh + 10, 3);
      ctx.fill();
      for (let wy = LH - bh + 4; wy < LH - 12; wy += 9)
        for (let wx = sx + 4; wx < sx + bw - 4; wx += 7)
          if ((wx + wy + ci) % 3 !== 0) {
            ctx.fillStyle = `rgba(255,220,100,${0.4 + Math.sin(t * 0.02 + wx + wy) * 0.15})`;
            ctx.fillRect(wx, wy, 3, 4);
          }
    });
  }
  if ([0, 2, 5, 6].includes(ci)) {
    [40, 150, 260, 370, 470].forEach((bx, i) => {
      const cx2 = ((((bx - camX * 0.18 + 620) % 640) + 640) % 640) - 60;
      const cy = 18 + i * 8,
        cr = ci === 5 ? 0.95 : 0.75;
      drawCloud(cx2, cy, 55 + i * 8, cr);
    });
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

function drawGround(ch) {
  const G = levelData.GROUND_Y,
    LWW = levelData.levelW;
  const gw = LWW * TILE,
    gy = G * TILE;
  const gg = ctx.createLinearGradient(0, gy, 0, gy + TILE * 3);
  gg.addColorStop(0, ch.ground);
  gg.addColorStop(0.15, ch.platTop || ch.ground);
  gg.addColorStop(1, ch.dirt);
  ctx.fillStyle = gg;
  ctx.fillRect(0, gy, gw, TILE * 4);
  const shine = ctx.createLinearGradient(0, gy, 0, gy + 5);
  shine.addColorStop(0, "rgba(255,255,255,0.35)");
  shine.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = shine;
  ctx.fillRect(0, gy, gw, 5);
}

function drawPlatforms(ch) {
  levelData.platforms.forEach((p) => {
    drawPlatBlock(p.tx * TILE, p.ty * TILE, p.len * TILE, TILE, ch, false);
  });
}

function drawMovingPlatforms(ch) {
  levelData.movingPlats.forEach((mp) => {
    drawPlatBlock(
      Math.round(mp.cx),
      mp.ty * TILE,
      mp.len * TILE,
      TILE,
      ch,
      true,
    );
  });
}

function drawCrumblePlatforms(ch) {
  if (!levelData.crumblePlats) return;
  levelData.crumblePlats.forEach((cp) => {
    if (cp.state === "broken") return;
    const x = cp.tx * TILE,
      y = cp.ty * TILE,
      w = cp.len * TILE,
      h = TILE;
    const shake = cp.state === "shaking" ? Math.sin(t * 0.8) * 3 : 0;
    ctx.save();
    ctx.translate(shake, 0);
    const pg = ctx.createLinearGradient(x, y, x, y + h);
    pg.addColorStop(0, "#ff9500");
    pg.addColorStop(1, "#cc5500");
    ctx.fillStyle = pg;
    rr(x, y, w, h, 4);
    ctx.fill();
    ctx.fillStyle =
      cp.state === "shaking" ? "rgba(255,50,0,0.6)" : "rgba(255,200,0,0.5)";
    for (let i = 0; i < cp.len; i++) {
      if (i % 2 === 0) ctx.fillRect(x + i * TILE, y, TILE, 3);
    }
    if (cp.state === "shaking") {
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + w * 0.2, y + 2);
      ctx.lineTo(x + w * 0.3, y + h - 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + w * 0.6, y + 2);
      ctx.lineTo(x + w * 0.55, y + h - 2);
      ctx.stroke();
      const pct = cp.timer / 40;
      ctx.fillStyle = `rgba(255,${Math.floor(pct * 200)},0,0.8)`;
      ctx.fillRect(x, y - 3, w * pct, 2);
    }
    ctx.restore();
  });
}

function drawPlatBlock(x, y, w, h, ch, moving) {
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  rr(x + 3, y + h + 1, w - 6, 5, 3);
  ctx.fill();
  const pg = ctx.createLinearGradient(x, y, x, y + h);
  pg.addColorStop(0, ch.platTop || lightenColor(ch.plat, 30));
  pg.addColorStop(0.3, ch.plat);
  pg.addColorStop(1, shadeColor(ch.plat, -25));
  ctx.fillStyle = pg;
  rr(x, y, w, h, 4);
  ctx.fill();
  const sg = ctx.createLinearGradient(x, y, x, y + 6);
  sg.addColorStop(0, "rgba(255,255,255,0.4)");
  sg.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = sg;
  rr(x + 1, y + 1, w - 2, 6, 3);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.lineWidth = 1.5;
  rr(x, y, w, h, 4);
  ctx.stroke();
  if (moving) {
    ctx.strokeStyle = "rgba(0,220,255,0.5)";
    ctx.lineWidth = 1;
    rr(x, y, w, h, 4);
    ctx.stroke();
  }
}

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
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.beginPath();
    ctx.moveTo(s.x + 4, s.y + 1);
    ctx.lineTo(s.x + 2, s.y + 5);
    ctx.lineTo(s.x + 4, s.y + 4);
    ctx.closePath();
    ctx.fill();
  });
}

function drawCoins() {
  levelData.coins.forEach((c) => {
    if (c.collected) return;
    const bob = Math.sin(t * 0.08 + c.x * 0.03) * 2.5;
    const cx2 = c.x + 4,
      cy = c.y + 4 + bob;
    const spin = Math.abs(Math.sin(t * 0.04 + c.x * 0.02));
    const cw = 8 * spin + 2;
    glow(cx2, cy, 14, "rgba(255,210,40,0.2)");
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
    ctx.strokeStyle = "#b8860b";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(0, 0, cw, 7, 0, 0, Math.PI * 2);
    ctx.stroke();
    if (spin > 0.5) {
      ctx.fillStyle = "#a06000";
      ctx.font = "bold 7px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Z", 0, 0.5);
    }
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.beginPath();
    ctx.ellipse(-cw * 0.2, -2, cw * 0.3, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

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
    if (z.type === 4) {
      drawBossSprite(z);
      return;
    }
    drawZombieSprite(z);
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
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(x + 9, y + 24, 9, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  const legG = ctx.createLinearGradient(x, y + 16, x, y + 26);
  legG.addColorStop(0, flash ? "#ff3355" : pal.pants);
  legG.addColorStop(1, flash ? "#ff1133" : shadeColor(pal.pants, -20));
  ctx.fillStyle = legG;
  rr(x + 2, y + 15 + bob, 6, 8 + (walk ? 2 : 0), 3);
  ctx.fill();
  rr(x + 9, y + 15 + bob, 6, 8 + (walk ? 0 : 2), 3);
  ctx.fill();
  ctx.fillStyle = flash ? "#ff4455" : "#1a1a1a";
  rr(x + (walk ? 1 : 2), y + 22 + bob, 7, 4, 2);
  ctx.fill();
  rr(x + (walk ? 9 : 8), y + 22 + bob, 7, 4, 2);
  ctx.fill();
  const bodyG = ctx.createLinearGradient(x, y + 7, x + 18, y + 17);
  bodyG.addColorStop(0, flash ? "#ff4466" : lightenColor(pal.shirt, 15));
  bodyG.addColorStop(1, flash ? "#cc2244" : pal.shirt);
  ctx.fillStyle = bodyG;
  rr(x + 1, y + 7 + bob, 16, 10, 4);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  rr(x + 3, y + 8 + bob, 12, 3, 2);
  ctx.fill();
  const armG = ctx.createLinearGradient(x, y + 7, x, y + 14);
  armG.addColorStop(0, flash ? "#ff4466" : pal.skin);
  armG.addColorStop(1, flash ? "#cc2244" : pal.skinD);
  ctx.fillStyle = armG;
  if (fr) {
    rr(x + 15, y + 6 + bob - armSway, 8, 5, 3);
    ctx.fill();
    rr(x - 5, y + 9 + bob, 6, 4, 3);
    ctx.fill();
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
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.ellipse(x + 5.5, y + 3.5 + bob, 2.5, 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x + 11.5, y + 3.5 + bob, 2.5, 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = flash ? "#ff8888" : "#cc0000";
  ctx.beginPath();
  ctx.arc(x + 5.5, y + 3.5 + bob, 1.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + 11.5, y + 3.5 + bob, 1.3, 0, Math.PI * 2);
  ctx.fill();
  if (!flash) {
    glow(x + 5.5, y + 3.5 + bob, 5, "rgba(255,0,0,0.25)");
    glow(x + 11.5, y + 3.5 + bob, 5, "rgba(255,0,0,0.25)");
  }
  ctx.fillStyle = flash ? "#ff2244" : "#2a0a0a";
  ctx.beginPath();
  ctx.ellipse(x + 9, y + 7.5 + bob, 4, 2, 0, 0, Math.PI * 2);
  ctx.fill();
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

function drawBossSprite(z) {
  const x = z.x - 16,
    y = z.y - 16;
  const flash = z.hitFlash > 0;
  const bob = Math.sin(t * 0.08) * 2;
  const enraged = z.phase === 2;
  if (enraged) {
    glow(x + 25, y + 22, 30, "rgba(255,0,0,0.2)");
  } else {
    glow(x + 25, y + 22, 24, "rgba(255,100,0,0.15)");
  }
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.beginPath();
  ctx.ellipse(x + 25, y + 46, 18, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  const walk = Math.floor(t * 0.1) % 2;
  ctx.fillStyle = flash ? "#ff3333" : enraged ? "#5a0000" : "#2a1a0a";
  rr(x + 8, y + 32 + bob, 10, 14 + (walk ? 3 : 0), 4);
  ctx.fill();
  rr(x + 22, y + 32 + bob, 10, 14 + (walk ? 0 : 3), 4);
  ctx.fill();
  ctx.fillStyle = flash ? "#ff2222" : "#111";
  rr(x + 6, y + 44 + bob + (walk ? 3 : 0), 12, 6, 3);
  ctx.fill();
  rr(x + 22, y + 44 + bob + (walk ? 0 : 3), 12, 6, 3);
  ctx.fill();
  const bodyG = ctx.createLinearGradient(x, y + 16, x + 50, y + 34);
  bodyG.addColorStop(0, flash ? "#ff4444" : enraged ? "#8a1010" : "#4a2010");
  bodyG.addColorStop(1, flash ? "#cc2222" : enraged ? "#5a0808" : "#2a1008");
  ctx.fillStyle = bodyG;
  rr(x + 4, y + 14 + bob, 42, 20, 8);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.1)";
  rr(x + 8, y + 16 + bob, 34, 6, 4);
  ctx.fill();
  const armSway = Math.sin(t * 0.07) * 4;
  ctx.fillStyle = flash ? "#ff4444" : enraged ? "#7a0808" : "#3a1808";
  if (z.facingRight) {
    rr(x + 38, y + 10 + bob - armSway, 16, 8, 5);
    ctx.fill();
    rr(x - 8, y + 18 + bob, 12, 6, 4);
    ctx.fill();
    ctx.fillStyle = "#111";
    [0, 4, 8].forEach((off) => {
      ctx.beginPath();
      ctx.moveTo(x + 54, y + 8 + bob - armSway + off);
      ctx.lineTo(x + 60, y + 6 + bob - armSway + off);
      ctx.lineTo(x + 58, y + 12 + bob - armSway + off);
      ctx.closePath();
      ctx.fill();
    });
  } else {
    rr(x - 8, y + 10 + bob - armSway, 16, 8, 5);
    ctx.fill();
    rr(x + 38, y + 18 + bob, 12, 6, 4);
    ctx.fill();
    ctx.fillStyle = "#111";
    [0, 4, 8].forEach((off) => {
      ctx.beginPath();
      ctx.moveTo(x - 8, y + 8 + bob - armSway + off);
      ctx.lineTo(x - 14, y + 6 + bob - armSway + off);
      ctx.lineTo(x - 12, y + 12 + bob - armSway + off);
      ctx.closePath();
      ctx.fill();
    });
  }
  const hg = ctx.createRadialGradient(
    x + 22,
    y + 6 + bob,
    2,
    x + 24,
    y + 8 + bob,
    18,
  );
  hg.addColorStop(0, flash ? "#ff8888" : enraged ? "#cc2020" : "#7a4030");
  hg.addColorStop(1, flash ? "#ff3333" : enraged ? "#880000" : "#4a2010");
  ctx.fillStyle = hg;
  rr(x + 6, y - 4 + bob, 36, 22, 10);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.3)";
  ctx.lineWidth = 1.5;
  rr(x + 6, y - 4 + bob, 36, 22, 10);
  ctx.stroke();
  ctx.fillStyle = enraged ? "#ff0000" : "#ff6600";
  [-8, -4, 0, 4, 8].forEach((ox, i) => {
    ctx.beginPath();
    ctx.moveTo(x + 20 + ox, y - 4 + bob);
    ctx.lineTo(x + 23 + ox, y - 12 - (i % 3) * 3 + bob);
    ctx.lineTo(x + 26 + ox, y - 4 + bob);
    ctx.closePath();
    ctx.fill();
  });
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.ellipse(x + 14, y + 4 + bob, 5, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x + 30, y + 4 + bob, 5, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = flash ? "#fff" : enraged ? "#ff0000" : "#cc2200";
  ctx.beginPath();
  ctx.arc(x + 14, y + 4 + bob, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + 30, y + 4 + bob, 3, 0, Math.PI * 2);
  ctx.fill();
  glow(
    x + 14,
    y + 4 + bob,
    8,
    enraged ? "rgba(255,0,0,0.5)" : "rgba(200,50,0,0.3)",
  );
  glow(
    x + 30,
    y + 4 + bob,
    8,
    enraged ? "rgba(255,0,0,0.5)" : "rgba(200,50,0,0.3)",
  );
  ctx.fillStyle = "#2a0000";
  ctx.beginPath();
  ctx.ellipse(x + 22, y + 13 + bob, 8, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#e8e0d0";
  [
    [x + 16, y + 10 + bob],
    [x + 19, y + 9 + bob],
    [x + 22, y + 9 + bob],
    [x + 25, y + 9 + bob],
    [x + 28, y + 10 + bob],
  ].forEach(([tx, ty]) => {
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx + 2, ty + 4);
    ctx.lineTo(tx + 4, ty);
    ctx.closePath();
    ctx.fill();
  });
  ctx.fillStyle = enraged ? "#ff0000" : "#ff6600";
  ctx.font = "bold 7px 'Nunito',sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(enraged ? "⚠ BOSS" : "👑 BOSS", x + 22, y - 16 + bob);
  ctx.textAlign = "left";
}

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
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.2)";
  ctx.beginPath();
  ctx.ellipse(x + 8, y + 24, 7, 2.5, 0, 0, Math.PI * 2);
  ctx.fill();
  const shoeG = ctx.createLinearGradient(x, y + 20, x, y + 25);
  shoeG.addColorStop(0, lightenColor(ch.shoe || "#222", 20));
  shoeG.addColorStop(1, ch.shoe || "#222");
  ctx.fillStyle = shoeG;
  if (!jumping) {
    rr(x + (walk ? 0 : 1), y + 20 + bob, 7, 5, 3);
    ctx.fill();
    rr(x + (walk ? 8 : 9), y + 20 + bob, 7, 5, 3);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.2)";
    ctx.fillRect(x + (walk ? 1 : 2), y + 23 + bob, 5, 1);
    ctx.fillRect(x + (walk ? 9 : 10), y + 23 + bob, 5, 1);
  } else {
    rr(x + 0, y + 19, 6, 5, 3);
    ctx.fill();
    rr(x + 9, y + 19, 6, 5, 3);
    ctx.fill();
  }
  const pantsG = ctx.createLinearGradient(x, y + 13, x + 16, y + 22);
  pantsG.addColorStop(0, lightenColor(ch.pants, 15));
  pantsG.addColorStop(1, ch.pants);
  ctx.fillStyle = pantsG;
  if (!jumping) {
    rr(x + 2, y + 13 + bob, 6, 8 + (walk ? 2 : 0), 3);
    ctx.fill();
    rr(x + 8, y + 13 + bob, 6, 8 + (walk ? 0 : 2), 3);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    ctx.fillRect(x + 3, y + 13 + bob, 3, 5);
  } else {
    rr(x + 2, y + 13, 6, 6, 3);
    ctx.fill();
    rr(x + 8, y + 13, 6, 6, 3);
    ctx.fill();
  }
  ctx.fillStyle = "#222";
  ctx.fillRect(x + 1, y + 12 + bob, 15, 2);
  ctx.fillStyle = "#ffd700";
  ctx.fillRect(x + 6, y + 12 + bob, 5, 2);
  const shirtG = ctx.createLinearGradient(x, y + 6, x + 16, y + 14);
  shirtG.addColorStop(0, lightenColor(ch.shirt, 25));
  shirtG.addColorStop(1, ch.shirt);
  ctx.fillStyle = shirtG;
  rr(x, y + 6 + bob, 16, 8, 3);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.2)";
  rr(x + 2, y + 7 + bob, 12, 2, 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.18)";
  ctx.lineWidth = 1;
  rr(x, y + 6 + bob, 16, 8, 3);
  ctx.stroke();
  ctx.fillStyle = shirtG;
  rr(x - 3, y + 6 + bob, 4, 7, 2);
  ctx.fill();
  rr(x + 15, y + 6 + bob, 4, 7, 2);
  ctx.fill();
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
  ctx.fillStyle = ch.skin;
  rr(x + 5, y + 3 + bob, 6, 5, 2);
  ctx.fill();
  const hg = ctx.createRadialGradient(x + 7, y + bob, 1, x + 8, y + 1 + bob, 8);
  hg.addColorStop(0, lightenColor(ch.skin, 25));
  hg.addColorStop(1, ch.skin);
  ctx.fillStyle = hg;
  rr(x + 1, y + bob, 14, 10, 5);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.15)";
  ctx.beginPath();
  ctx.ellipse(x + 6, y + 2 + bob, 3, 2.5, -0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.15)";
  ctx.lineWidth = 0.8;
  rr(x + 1, y + bob, 14, 10, 5);
  ctx.stroke();
  const hairG = ctx.createLinearGradient(x, y - 2 + bob, x, y + 3 + bob);
  hairG.addColorStop(0, lightenColor(ch.hair, 15));
  hairG.addColorStop(1, ch.hair);
  ctx.fillStyle = hairG;
  rr(x + 1, y - 2 + bob, 14, 5, 4);
  ctx.fill();
  if (ch.id === "blaze") {
    ctx.fillStyle = "#ff6600";
    rr(x + 8, y - 5 + bob, 6, 5, 3);
    ctx.fill();
  }
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
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(ex + 1, y + 3.8 + bob, 0.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(ex + 6, y + 3.8 + bob, 0.7, 0, Math.PI * 2);
  ctx.fill();
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

function drawHitEffects() {
  hitEffects.forEach((e) => {
    ctx.save();
    ctx.globalAlpha = Math.min(1, e.life / 8) * 0.5;
    ctx.fillStyle = e.color || "#ffaa00";
    ctx.fillRect(e.x, e.y, e.w, e.h);
    ctx.restore();
  });
}

function drawFloatTexts() {
  floatTexts.forEach((f) => {
    ctx.save();
    ctx.globalAlpha = Math.min(1, f.life / 20);
    ctx.font = "bold 11px 'Fredoka One',sans-serif";
    ctx.textAlign = "center";
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.lineWidth = 3;
    ctx.strokeText(f.text, f.x - camX + 4, f.y);
    ctx.fillStyle = f.color || "#fff";
    ctx.fillText(f.text, f.x - camX + 4, f.y);
    ctx.restore();
  });
}

function drawPlayerHPBar() {
  if (!player) return;
  const bw = 70,
    bh = 7,
    bx = LW / 2 - 35,
    by = LH - 12;
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  rr(bx - 1, by - 1, bw + 2, bh + 2, 4);
  ctx.fill();
  ctx.fillStyle = "#222";
  rr(bx, by, bw, bh, 3);
  ctx.fill();
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
  ctx.fillStyle = "rgba(255,255,255,0.2)";
  rr(bx, by, bw * pct, bh / 2, 3);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.font = "bold 6px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(`HP ${player.hp}/${player.maxHp}`, LW / 2, by - 2);
}

function drawGoalFlag() {
  const fx = (levelData.levelW - 3) * TILE,
    gy = levelData.GROUND_Y * TILE;
  const baseG = ctx.createLinearGradient(fx, gy - 4, fx + 16, gy);
  baseG.addColorStop(0, "#888");
  baseG.addColorStop(1, "#444");
  ctx.fillStyle = baseG;
  rr(fx + 2, gy - 5, 16, 5, 2);
  ctx.fill();
  const poleG = ctx.createLinearGradient(fx + 7, 0, fx + 9, 0);
  poleG.addColorStop(0, "#ddd");
  poleG.addColorStop(1, "#888");
  ctx.fillStyle = poleG;
  ctx.fillRect(fx + 7, gy - 58, 2, 58);
  ctx.save();
  for (let row = 0; row < 12; row++) {
    const wave = Math.sin(t * 0.1 + row * 0.4) * 4;
    const grad = ctx.createLinearGradient(fx + 9, 0, fx + 28 + wave, 0);
    grad.addColorStop(0, row < 6 ? "#ef233c" : "#ffffff");
    grad.addColorStop(1, row < 6 ? "#c90016" : "#dddddd");
    ctx.fillStyle = grad;
    ctx.fillRect(fx + 9, gy - 58 + row * 2, 20 + wave, 2);
  }
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.font = "bold 9px 'Fredoka One',sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Z", fx + 19, gy - 46);
  glow(fx + 19, gy - 50, 12, "rgba(255,80,80,0.2)");
  ctx.restore();
}

function drawObjectiveHUD() {
  if (!levelData || !levelData.objective) return;
  const txt = getObjectiveHUD();
  const x = 8,
    y = 8,
    pad = 6;
  ctx.font = "bold 9px 'Nunito',sans-serif";
  const tw = ctx.measureText(txt).width;
  ctx.fillStyle = levelData.exitLocked
    ? "rgba(239,35,60,0.85)"
    : "rgba(6,214,160,0.85)";
  rr(x, y, tw + pad * 2, 16, 8);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(txt, x + pad, y + 8);
  ctx.textBaseline = "alphabetic";
}

function drawComboMeter() {
  if (combo < 2) return;
  const x = LW - 70,
    y = 8;
  const alpha = Math.min(1, comboTimer / 30);
  ctx.save();
  ctx.globalAlpha = alpha;
  const scale = 1 + (comboTimer > 100 ? 0.3 : 0);
  ctx.translate(x + 35, y + 10);
  ctx.scale(scale, scale);
  ctx.translate(-(x + 35), -(y + 10));
  ctx.fillStyle = combo >= 5 ? "#ff6b35" : combo >= 3 ? "#ffd23f" : "#fff";
  ctx.font = `bold ${combo >= 5 ? 14 : 11}px 'Nunito',sans-serif`;
  ctx.textAlign = "center";
  ctx.strokeStyle = "rgba(0,0,0,0.5)";
  ctx.lineWidth = 3;
  ctx.strokeText(`${combo}x COMBO!`, x + 35, y + 12);
  ctx.fillText(`${combo}x COMBO!`, x + 35, y + 12);
  ctx.restore();
}

function shadeColor(hex, amt) {
  if (!hex || hex.length < 7) return hex || "#444444";
  let r = parseInt(hex.slice(1, 3), 16),
    g = parseInt(hex.slice(3, 5), 16),
    b = parseInt(hex.slice(5, 7), 16);
  r = Math.max(0, Math.min(255, r + amt));
  g = Math.max(0, Math.min(255, g + amt));
  b = Math.max(0, Math.min(255, b + amt));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}
function lightenColor(hex, amt) {
  return shadeColor(hex, amt);
}

// ═══════════════════════════════════════════════════════
//  SOUND ENGINE
// ═══════════════════════════════════════════════════════
const SFX = (() => {
  let ctx2 = null;
  function ac() {
    if (!ctx2) {
      try {
        ctx2 = new (window.AudioContext || window.webkitAudioContext)();
      } catch {}
    }
    return ctx2;
  }
  function beep(freq, type, vol, dur, decay) {
    try {
      const c = ac();
      if (!c) return;
      const o = c.createOscillator(),
        g = c.createGain();
      o.connect(g);
      g.connect(c.destination);
      o.type = type || "square";
      o.frequency.setValueAtTime(freq, c.currentTime);
      o.frequency.exponentialRampToValueAtTime(
        freq * (decay || 1),
        c.currentTime + dur,
      );
      g.gain.setValueAtTime(vol || 0.15, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
      o.start(c.currentTime);
      o.stop(c.currentTime + dur);
    } catch {}
  }
  function noise(vol, dur) {
    try {
      const c = ac();
      if (!c) return;
      const buf = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const src = c.createBufferSource(),
        g = c.createGain();
      src.buffer = buf;
      src.connect(g);
      g.connect(c.destination);
      g.gain.setValueAtTime(vol, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
      src.start();
      src.stop(c.currentTime + dur);
    } catch {}
  }
  return {
    hit(armoured) {
      beep(armoured ? 180 : 300, "square", 0.12, 0.08, 0.3);
    },
    kill(isBoss) {
      if (isBoss) {
        beep(80, "sawtooth", 0.2, 0.4, 0.1);
        setTimeout(() => beep(120, "square", 0.15, 0.3, 0.2), 100);
      } else {
        beep(440, "square", 0.1, 0.05);
        setTimeout(() => beep(600, "square", 0.08, 0.05), 60);
      }
    },
    hurt() {
      noise(0.18, 0.12);
      beep(150, "sawtooth", 0.12, 0.15, 0.5);
    },
    coin() {
      beep(880, "sine", 0.08, 0.06);
      setTimeout(() => beep(1200, "sine", 0.06, 0.06), 40);
    },
    jump() {
      beep(300, "square", 0.08, 0.1, 2);
    },
    death() {
      beep(200, "sawtooth", 0.2, 0.5, 0.1);
      setTimeout(() => beep(150, "sawtooth", 0.15, 0.4, 0.1), 200);
      setTimeout(() => noise(0.1, 0.3), 400);
    },
    win() {
      [523, 659, 784, 1047].forEach((f, i) =>
        setTimeout(() => beep(f, "sine", 0.12, 0.15), i * 100),
      );
    },
    bossRoar() {
      beep(60, "sawtooth", 0.25, 0.5, 0.2);
      setTimeout(() => noise(0.1, 0.2), 100);
    },
    bossThrow() {
      beep(200, "square", 0.1, 0.08, 0.5);
    },
    unlock() {
      [440, 550, 660].forEach((f, i) =>
        setTimeout(() => beep(f, "sine", 0.1, 0.12), i * 80),
      );
    },
  };
})();

// ═══════════════════════════════════════════════════════
//  HAPTIC FEEDBACK
// ═══════════════════════════════════════════════════════
function haptic(ms) {
  try {
    if (navigator.vibrate) navigator.vibrate(ms);
  } catch {}
}

// ═══════════════════════════════════════════════════════
//  PARTICLES
// ═══════════════════════════════════════════════════════
function spawnParticles(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    const angle = (Math.PI * 2 * i) / n + Math.random() * 0.5;
    const spd = 1.5 + Math.random() * 3;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * spd,
      vy: Math.sin(angle) * spd - 1.5,
      life: 20 + Math.floor(Math.random() * 20),
      maxLife: 40,
      color,
      size: 1.5 + Math.random() * 2.5,
    });
  }
}

function drawParticles() {
  particles = particles.filter((p) => {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.18;
    p.life--;
    if (p.life <= 0) return false;
    ctx.save();
    ctx.globalAlpha = p.life / p.maxLife;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(Math.round(p.x), Math.round(p.y), p.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return true;
  });
}

// ═══════════════════════════════════════════════════════
//  BOSS HP BAR
// ═══════════════════════════════════════════════════════
function drawBossBar() {
  if (!levelData || !levelData.isBossLevel) return;
  const boss = levelData.zombies.find((z) => z.type === 4);
  if (!boss || !boss.alive) return;
  const bw = LW * 0.6,
    bh = 12,
    bx = LW / 2 - bw / 2,
    by = LH - 24;
  const pct = Math.max(0, boss.hp / boss.maxHp);
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  rr(bx - 2, by - 16, bw + 4, bh + 20, 6);
  ctx.fill();
  ctx.fillStyle = "#ff4444";
  ctx.font = "bold 9px 'Nunito',sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(
    `👑 BOSS  HP: ${boss.hp}/${boss.maxHp}${boss.phase === 2 ? " ⚠ ENRAGED" : ""}`,
    LW / 2,
    by - 4,
  );
  ctx.fillStyle = "#333";
  rr(bx, by, bw, bh, 4);
  ctx.fill();
  const barG = ctx.createLinearGradient(bx, by, bx + bw * pct, by);
  barG.addColorStop(0, boss.phase === 2 ? "#ff0000" : "#ff6b35");
  barG.addColorStop(1, boss.phase === 2 ? "#ff6600" : "#ffd23f");
  ctx.fillStyle = barG;
  rr(bx, by, bw * pct, bh, 4);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.2)";
  rr(bx, by, bw * pct, bh / 2, 4);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.4)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(bx + bw * 0.5, by);
  ctx.lineTo(bx + bw * 0.5, by + bh);
  ctx.stroke();
  ctx.textAlign = "left";
}

// ═══════════════════════════════════════════════════════
//  LEADERBOARD
// ═══════════════════════════════════════════════════════
async function showLeaderboard(levelIdx) {
  renderLeaderboard(levelIdx, null);
  try {
    const r = await fetchWithTimeout(
      `${SUPA_URL}/rest/v1/saves?select=username,progress`,
      { headers: SUPA_H },
      8000,
    );
    const rows = await r.json();
    const entries = rows
      .map((row) => ({
        name: row.username,
        score: (row.progress || {})[levelIdx],
      }))
      .filter((e) => e.score !== undefined)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
    renderLeaderboard(levelIdx, entries);
  } catch {
    renderLeaderboard(levelIdx, []);
  }
}

async function showChapterLeaderboard() {
  const ci = currentChIdx;
  const chStart = ci * LEVELS_PER;
  renderLeaderboard(
    null,
    null,
    `Chapter ${ci + 1}: ${CHAPTERS_DEF[ci].name}`,
    true,
  );
  try {
    const r = await fetchWithTimeout(
      `${SUPA_URL}/rest/v1/saves?select=username,progress`,
      { headers: SUPA_H },
      8000,
    );
    const rows = await r.json();
    const entries = rows
      .map((row) => {
        const prog = row.progress || {};
        let total = 0,
          levels = 0;
        for (let i = chStart; i < chStart + LEVELS_PER; i++) {
          if (prog[i] !== undefined) {
            total += prog[i];
            levels++;
          }
        }
        return { name: row.username, score: total, levels };
      })
      .filter((e) => e.levels > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
    renderLeaderboard(
      null,
      entries,
      `Chapter ${ci + 1}: ${CHAPTERS_DEF[ci].name}`,
      false,
    );
  } catch {
    renderLeaderboard(
      null,
      [],
      `Chapter ${ci + 1}: ${CHAPTERS_DEF[ci].name}`,
      false,
    );
  }
}

function renderLeaderboard(levelIdx, entries, title, loading) {
  let el = document.getElementById("leaderboardOverlay");
  if (!el) {
    el = document.createElement("div");
    el.id = "leaderboardOverlay";
    el.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,0.88);display:flex;align-items:center;justify-content:center;z-index:999;font-family:'Nunito',sans-serif;";
    document.body.appendChild(el);
  }
  const displayTitle =
    title || (levelIdx !== null ? `Level ${levelIdx + 1}` : "Leaderboard");
  el.innerHTML = `
    <div style="background:#0f0c29;border:1px solid rgba(255,255,255,0.15);border-radius:20px;padding:28px 24px;min-width:min(340px,90vw);max-width:90vw;max-height:85vh;overflow-y:auto;text-align:center;">
      <div style="font-size:24px;margin-bottom:4px;">🏆</div>
      <div style="font-size:20px;font-weight:900;color:#ffd23f;margin-bottom:4px;letter-spacing:1px;">LEADERBOARD</div>
      <div style="font-size:12px;color:rgba(255,255,255,0.4);margin-bottom:20px;">${displayTitle}</div>
      ${
        loading
          ? '<div style="color:rgba(255,255,255,0.4);font-size:13px;padding:20px;">Loading...</div>'
          : entries && entries.length === 0
            ? '<div style="color:rgba(255,255,255,0.3);font-size:13px;padding:20px;">No scores yet — be the first!</div>'
            : (entries || [])
                .map(
                  (e, i) => `
        <div style="display:flex;align-items:center;gap:10px;padding:9px 12px;background:${e.name === currentUser ? "rgba(255,107,53,0.2)" : "rgba(255,255,255,0.04)"};border-radius:10px;margin-bottom:6px;${e.name === currentUser ? "border:1px solid rgba(255,107,53,0.5)" : "border:1px solid transparent"}">
          <span style="font-size:18px;min-width:30px;">${i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `<span style='color:rgba(255,255,255,0.4);font-size:13px'>#${i + 1}</span>`}</span>
          <span style="flex:1;text-align:left;color:${e.name === currentUser ? "#ff6b35" : "#fff"};font-weight:900;font-size:13px;">${e.name}${e.name === currentUser ? " 👈" : ""}</span>
          ${e.levels !== undefined ? `<span style="color:rgba(255,255,255,0.4);font-size:11px;margin-right:4px">${e.levels}lvl</span>` : ""}
          <span style="color:#ffd23f;font-weight:900;font-size:15px;">${e.score.toLocaleString()}</span>
        </div>`,
                )
                .join("")
      }
      <button onclick="document.getElementById('leaderboardOverlay').remove()" style="margin-top:18px;padding:11px 32px;background:linear-gradient(135deg,#ff6b35,#ff4040);border:none;border-radius:50px;color:#fff;font-family:'Nunito',sans-serif;font-weight:900;font-size:14px;cursor:pointer;letter-spacing:1px;">CLOSE</button>
    </div>
  `;
  el.style.display = "flex";
}

function showLeaderboardBtn(idx) {
  const ob = document.querySelector(".overlay-win");
  if (!ob || ob.querySelector(".lb-btn")) return;
  const btn = document.createElement("button");
  btn.className = "modern-btn modern-btn-ghost lb-btn";
  btn.textContent = "🏆 LEADERBOARD";
  btn.onclick = () => showLeaderboard(idx);
  ob.appendChild(btn);
}
