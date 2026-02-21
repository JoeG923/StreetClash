/*
  Mini Street Clash game logic, explained in plain language:
  1. Read controls from keyboard and gamepads.
  2. Update each player (move, jump, attack, take damage).
  3. Decide if someone won the round.
  4. Draw everything (background, fighters, life bars, effects).
  5. Repeat this 60-ish times per second.
*/
import { createRetroAudioEngine } from "./audio.js";

const canvas = document.getElementById("game-canvas");
const ctx = canvas.getContext("2d");
const startOverlay = document.getElementById("start-overlay");
const startBtn = document.getElementById("start-btn");
const arenaWrap = document.getElementById("arena-wrap");

// "WORLD" is the stage size and where the floor is.
const WORLD = {
  width: canvas.width,
  height: canvas.height,
  groundY: 452,
};

const STEP_MS = 1000 / 60;
const STEP_DT = 1 / 60;
const PLAYER_SPEED = 250;
const PLAYER_WIDTH = 136;
const PLAYER_HEIGHT = 170;
const JUMP_VELOCITY = 640;
const JUMP_GRAVITY = 1800;
const FLOOR_LEFT = 74;
const FLOOR_RIGHT = WORLD.width - 74;
const COLLISION_GAP = 112;
const GAMEPAD_AXIS_DEADZONE = 0.35;

// Attack presets: timing + damage + visuals/sound flavor.
const ATTACKS = {
  punch: {
    duration: 0.22,
    activeStart: 0.08,
    activeEnd: 0.14,
    range: 132,
    damage: 8,
    cooldown: 0.3,
    sparkColor: "#ffe95f",
  },
  kick: {
    duration: 0.32,
    activeStart: 0.1,
    activeEnd: 0.2,
    range: 154,
    damage: 13,
    cooldown: 0.44,
    sparkColor: "#90f2ff",
  },
  jumpKick: {
    duration: 0.34,
    activeStart: 0.1,
    activeEnd: 0.24,
    range: 168,
    damage: 16,
    cooldown: 0.5,
    sparkColor: "#8af6ff",
  },
};

const ATTACK_HITBOXES = {
  punch: [
    { start: 0, end: 0.52, forward: 20, width: 46, height: 26, bottom: 92 },
    { start: 0.52, end: 1, forward: 34, width: 70, height: 24, bottom: 96 },
  ],
  kick: [
    { start: 0, end: 0.54, forward: 30, width: 78, height: 30, bottom: 72 },
    { start: 0.54, end: 1, forward: 44, width: 90, height: 28, bottom: 74 },
  ],
  jumpKick: [
    { start: 0, end: 0.54, forward: 36, width: 84, height: 34, bottom: 86 },
    { start: 0.54, end: 1, forward: 50, width: 98, height: 30, bottom: 92 },
  ],
};

const HURTBOX_PROFILES = {
  stand: [
    { width: 44, height: 88, bottom: 28, offsetX: 0 },
    { width: 34, height: 30, bottom: 126, offsetX: 2 },
  ],
  kick: [
    { width: 42, height: 84, bottom: 26, offsetX: 6 },
    { width: 34, height: 30, bottom: 124, offsetX: 6 },
  ],
  jump: [
    { width: 42, height: 84, bottom: 34, offsetX: 0 },
    { width: 32, height: 28, bottom: 124, offsetX: 0 },
  ],
  jumpKick: [
    { width: 40, height: 78, bottom: 34, offsetX: 8 },
    { width: 32, height: 28, bottom: 120, offsetX: 8 },
  ],
};

// Default controls can be overridden from index.html (window.GAME_CONFIG).
const DEFAULT_CONTROL_CONFIG = {
  keyBindings: {
    p1: { left: "KeyA", right: "KeyD", jump: "KeyW", punch: "KeyC", kick: "KeyV" },
    p2: { left: "ArrowLeft", right: "ArrowRight", jump: "ArrowUp", punch: "Slash", kick: "ArrowDown" },
  },
  gamepadAssignments: {
    p1: 0,
    p2: 1,
  },
  newRoundKey: "KeyR",
};

const controlConfig = resolveControlConfig(window.GAME_CONFIG);
const CONTROLS = [controlConfig.keyBindings.p1, controlConfig.keyBindings.p2];
const GAMEPAD_SLOTS = [controlConfig.gamepadAssignments.p1, controlConfig.gamepadAssignments.p2];
const NEW_ROUND_KEY = controlConfig.newRoundKey;
const ACTION_NAMES = ["left", "right", "jump", "punch", "kick"];
const ACTION_KEY_ALIASES = [{}, {}];
const preventedKeyCodes = new Set(["KeyF", NEW_ROUND_KEY]);
for (let playerIndex = 0; playerIndex < CONTROLS.length; playerIndex++) {
  for (const action of ACTION_NAMES) {
    for (const code of actionKeyCodes(playerIndex, action)) {
      preventedKeyCodes.add(code);
    }
  }
}

const art = {
  background: loadImage("assets/background.png"),
  winnerBanner: loadImage("assets/win_banner.png"),
};

const ANIMATION_POSE_NAMES = [
  "idle",
  "walk1",
  "walk2",
  "punch1",
  "punch2",
  "kick1",
  "kick2",
  "jump_up",
  "jump_down",
  "jumpkick1",
  "jumpkick2",
  "victory1",
  "victory2",
  "hurt",
];

const POSE_SOURCE_FACING_OVERRIDES = {
  p1: {
    punch1: -1,
    punch2: -1,
  },
  p2: {
    punch1: -1,
    punch2: -1,
  },
};

const fighterSpriteSets = {
  1: loadFighterSpriteSet("p1", "assets/fighter_red.png", POSE_SOURCE_FACING_OVERRIDES.p1),
  2: loadFighterSpriteSet("p2", "assets/fighter_blue.png", POSE_SOURCE_FACING_OVERRIDES.p2),
};
const audio = createRetroAudioEngine();

const alphaKeyCache = new WeakMap();
const visibleBoundsCache = new WeakMap();

// Global game state. Most functions read/write this object.
const state = {
  mode: "menu",
  winnerId: null,
  koTimer: 0,
  confettiTick: 0,
  animClock: 0,
  players: [
    createPlayer(1, 256, 1),
    createPlayer(2, 704, 1),
  ],
  particles: [],
  sparks: [],
};

const keysHeld = new Set();
const keysPressed = new Set();
const gamepadInputs = [
  createGamepadInputState(),
  createGamepadInputState(),
];
const previousGamepadButtons = new Map();

function loadImage(src) {
  const image = new Image();
  image.src = src;
  return image;
}

function loadFighterSpriteSet(prefix, fallbackPath, sourceFacingByPose = null) {
  const poses = {};
  for (const pose of ANIMATION_POSE_NAMES) {
    poses[pose] = loadImage(`assets/anim/${prefix}_${pose}.png`);
  }
  const poseSourceFacing = {};
  for (const pose of ANIMATION_POSE_NAMES) {
    const candidate = sourceFacingByPose?.[pose];
    poseSourceFacing[pose] = candidate === -1 ? -1 : 1;
  }
  return {
    fallback: loadImage(fallbackPath),
    poses,
    poseSourceFacing,
    poseScaleCache: Object.create(null),
  };
}

function resolveControlConfig(rawConfig) {
  const keyBindings = rawConfig?.keyBindings ?? {};
  const gamepadAssignments = rawConfig?.gamepadAssignments ?? {};
  return {
    keyBindings: {
      p1: sanitizeKeyBinding(keyBindings.p1, DEFAULT_CONTROL_CONFIG.keyBindings.p1),
      p2: sanitizeKeyBinding(keyBindings.p2, DEFAULT_CONTROL_CONFIG.keyBindings.p2),
    },
    gamepadAssignments: {
      p1: sanitizeGamepadSlot(gamepadAssignments.p1, DEFAULT_CONTROL_CONFIG.gamepadAssignments.p1),
      p2: sanitizeGamepadSlot(gamepadAssignments.p2, DEFAULT_CONTROL_CONFIG.gamepadAssignments.p2),
    },
    newRoundKey: sanitizeCode(rawConfig?.newRoundKey, DEFAULT_CONTROL_CONFIG.newRoundKey),
  };
}

function sanitizeKeyBinding(candidate, fallback) {
  const source = candidate && typeof candidate === "object" ? candidate : {};
  return {
    left: sanitizeCode(source.left, fallback.left),
    right: sanitizeCode(source.right, fallback.right),
    jump: sanitizeCode(source.jump, fallback.jump),
    punch: sanitizeCode(source.punch, fallback.punch),
    kick: sanitizeCode(source.kick, fallback.kick),
  };
}

function sanitizeCode(value, fallback) {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function sanitizeGamepadSlot(value, fallback) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

// Keeps gamepad input in the same shape as keyboard input.
function createGamepadInputState() {
  return {
    connected: false,
    id: null,
    left: false,
    right: false,
    jump: false,
    punch: false,
    kick: false,
    start: false,
    jumpPressed: false,
    punchPressed: false,
    kickPressed: false,
    startPressed: false,
  };
}

function imageReady(image) {
  return Boolean(image && image.complete && image.naturalWidth > 0);
}

function gamepadButtonDown(gamepad, index) {
  const button = gamepad?.buttons?.[index];
  if (!button) return false;
  if (typeof button === "number") return button > 0.5;
  return Boolean(button.pressed || button.value > 0.5);
}

function scanGamepads() {
  for (const input of gamepadInputs) {
    input.connected = false;
    input.id = null;
    input.left = false;
    input.right = false;
    input.jump = false;
    input.punch = false;
    input.kick = false;
    input.start = false;
    input.jumpPressed = false;
    input.punchPressed = false;
    input.kickPressed = false;
    input.startPressed = false;
  }

  if (typeof navigator.getGamepads !== "function") return;

  const pads = Array.from(navigator.getGamepads() || [])
    .filter((pad) => pad && pad.connected)
    .sort((a, b) => a.index - b.index);

  for (let playerIndex = 0; playerIndex < gamepadInputs.length; playerIndex++) {
    const assignedSlot = GAMEPAD_SLOTS[playerIndex];
    const pad = pads[assignedSlot];
    if (!pad) continue;

    const input = gamepadInputs[playerIndex];
    input.connected = true;
    input.id = pad.id || `Gamepad ${pad.index}`;

    const axisX = typeof pad.axes?.[0] === "number" ? pad.axes[0] : 0;
    input.left = gamepadButtonDown(pad, 14) || axisX <= -GAMEPAD_AXIS_DEADZONE;
    input.right = gamepadButtonDown(pad, 15) || axisX >= GAMEPAD_AXIS_DEADZONE;

    const jumpDown = gamepadButtonDown(pad, 3) || gamepadButtonDown(pad, 12);
    const punchDown = gamepadButtonDown(pad, 0) || gamepadButtonDown(pad, 2);
    const kickDown = gamepadButtonDown(pad, 1);
    const startDown = gamepadButtonDown(pad, 9) || gamepadButtonDown(pad, 16);
    const previous = previousGamepadButtons.get(pad.index) || {
      jump: false,
      punch: false,
      kick: false,
      start: false,
    };

    input.jump = jumpDown;
    input.punch = punchDown;
    input.kick = kickDown;
    input.start = startDown;
    input.jumpPressed = jumpDown && !previous.jump;
    input.punchPressed = punchDown && !previous.punch;
    input.kickPressed = kickDown && !previous.kick;
    input.startPressed = startDown && !previous.start;

    previousGamepadButtons.set(pad.index, {
      jump: jumpDown,
      punch: punchDown,
      kick: kickDown,
      start: startDown,
    });
  }

  const connected = new Set(pads.map((pad) => pad.index));
  for (const index of previousGamepadButtons.keys()) {
    if (!connected.has(index)) previousGamepadButtons.delete(index);
  }
}

// Unified input helpers so gameplay code does not care about keyboard vs gamepad.
function actionHeld(playerIndex, action) {
  const keyboardDown = actionKeyCodes(playerIndex, action).some((code) => keysHeld.has(code));
  return keyboardDown || gamepadInputs[playerIndex][action];
}

function actionPressed(playerIndex, action) {
  const keyboardPressed = actionKeyCodes(playerIndex, action).some((code) => keysPressed.has(code));
  const gamepadKey = `${action}Pressed`;
  return keyboardPressed || gamepadInputs[playerIndex][gamepadKey];
}

function anyStartPressed() {
  if (keysPressed.has(NEW_ROUND_KEY)) return true;
  return gamepadInputs.some((input) => input.startPressed);
}

function actionKeyCodes(playerIndex, action) {
  const primary = CONTROLS[playerIndex]?.[action];
  const aliases = ACTION_KEY_ALIASES[playerIndex]?.[action] ?? [];
  const seen = new Set();
  const result = [];
  for (const code of [primary, ...aliases]) {
    if (typeof code !== "string" || !code.length || seen.has(code)) continue;
    seen.add(code);
    result.push(code);
  }
  return result;
}

// Removes flat-color sprite backgrounds by converting matching edge pixels to alpha.
function getAlphaKeyedImage(image) {
  if (!imageReady(image)) return null;
  if (alphaKeyCache.has(image)) return alphaKeyCache.get(image);

  const offscreen = document.createElement("canvas");
  offscreen.width = image.naturalWidth || image.width;
  offscreen.height = image.naturalHeight || image.height;
  const offCtx = offscreen.getContext("2d");
  offCtx.drawImage(image, 0, 0, offscreen.width, offscreen.height);

  const frame = offCtx.getImageData(0, 0, offscreen.width, offscreen.height);
  const data = frame.data;
  const w = offscreen.width;
  const h = offscreen.height;

  const cornerSamples = [
    [0, 0],
    [w - 1, 0],
    [0, h - 1],
    [w - 1, h - 1],
    [Math.floor(w * 0.5), 0],
    [Math.floor(w * 0.5), h - 1],
  ];
  const cornerColors = [];
  for (const [sx, sy] of cornerSamples) {
    const idx = (sy * w + sx) * 4;
    cornerColors.push([data[idx], data[idx + 1], data[idx + 2]]);
  }
  const bgColor = cornerColors.reduce(
    (sum, [r, g, b]) => [sum[0] + r, sum[1] + g, sum[2] + b],
    [0, 0, 0]
  );
  bgColor[0] /= cornerColors.length;
  bgColor[1] /= cornerColors.length;
  bgColor[2] /= cornerColors.length;

  const visited = new Uint8Array(w * h);
  const queueX = [];
  const queueY = [];
  const bgThreshold = 52;
  const edgeSimilarityThreshold = 58;

  function colorDistance(r, g, b, c) {
    const dr = r - c[0];
    const dg = g - c[1];
    const db = b - c[2];
    return Math.sqrt(dr * dr + dg * dg + db * db);
  }

  function enqueue(x, y) {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const pos = y * w + x;
    if (visited[pos]) return;
    const idx = pos * 4;
    if (data[idx + 3] === 0) {
      visited[pos] = 1;
      return;
    }
    const dist = colorDistance(data[idx], data[idx + 1], data[idx + 2], bgColor);
    if (dist > edgeSimilarityThreshold) return;
    visited[pos] = 1;
    queueX.push(x);
    queueY.push(y);
  }

  for (let x = 0; x < w; x++) {
    enqueue(x, 0);
    enqueue(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    enqueue(0, y);
    enqueue(w - 1, y);
  }

  for (let qi = 0; qi < queueX.length; qi++) {
    const x = queueX[qi];
    const y = queueY[qi];
    const pos = y * w + x;
    const idx = pos * 4;
    const dist = colorDistance(data[idx], data[idx + 1], data[idx + 2], bgColor);
    if (dist <= bgThreshold) {
      data[idx + 3] = 0;
      enqueue(x + 1, y);
      enqueue(x - 1, y);
      enqueue(x, y + 1);
      enqueue(x, y - 1);
    }
  }

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (a === 0) continue;
    const nearGray = Math.abs(r - g) < 12 && Math.abs(g - b) < 12;
    const bright = r > 170 && g > 170 && b > 170;
    if (nearGray && bright) {
      data[i + 3] = 0;
    }
  }
  offCtx.putImageData(frame, 0, 0);

  alphaKeyCache.set(image, offscreen);
  return offscreen;
}

// Measures how much non-transparent sprite area exists.
function getVisibleBounds(imageLike) {
  if (!imageLike) return null;
  if (visibleBoundsCache.has(imageLike)) return visibleBoundsCache.get(imageLike);

  let width = imageLike.naturalWidth || imageLike.videoWidth || imageLike.width || 0;
  let height = imageLike.naturalHeight || imageLike.videoHeight || imageLike.height || 0;
  if (!width || !height) {
    visibleBoundsCache.set(imageLike, null);
    return null;
  }

  const probe = document.createElement("canvas");
  probe.width = width;
  probe.height = height;
  const probeCtx = probe.getContext("2d");
  probeCtx.drawImage(imageLike, 0, 0, width, height);
  const frame = probeCtx.getImageData(0, 0, width, height);
  const data = frame.data;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha <= 8) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < minX || maxY < minY) {
    visibleBoundsCache.set(imageLike, null);
    return null;
  }

  const bounds = {
    w: maxX - minX + 1,
    h: maxY - minY + 1,
  };
  visibleBoundsCache.set(imageLike, bounds);
  return bounds;
}

// Makes P2 sprite scale match P1 when source images have different proportions.
function getPoseRenderScale(player, pose) {
  if (player.id !== 2) return 1;

  const cache = player.spriteSet?.poseScaleCache;
  if (!cache) return 1;
  if (typeof cache[pose] === "number") return cache[pose];

  const p1Set = fighterSpriteSets[1];
  const p2Set = fighterSpriteSets[2];
  const p1Base = p1Set?.poses?.[pose];
  const p2Base = p2Set?.poses?.[pose];
  const p1Image = imageReady(p1Base) ? p1Base : p1Set?.fallback;
  const p2Image = imageReady(p2Base) ? p2Base : p2Set?.fallback;
  const p1Keyed = getAlphaKeyedImage(p1Image) || p1Image;
  const p2Keyed = getAlphaKeyedImage(p2Image) || p2Image;
  const p1Bounds = getVisibleBounds(p1Keyed);
  const p2Bounds = getVisibleBounds(p2Keyed);
  if (!p1Bounds || !p2Bounds || p1Bounds.h < 2 || p2Bounds.h < 2) return 1;

  const ratio = p1Bounds.h / p2Bounds.h;
  const clamped = Math.max(0.88, Math.min(1.35, ratio));
  cache[pose] = clamped;
  return clamped;
}

// Creates one fighter object with position, movement, health, and animation state.
function createPlayer(id, x, spriteFacingSign) {
  const spriteSet = fighterSpriteSets[id];
  return {
    id,
    x,
    y: WORLD.groundY,
    vx: 0,
    z: 0,
    vz: 0,
    width: PLAYER_WIDTH,
    height: PLAYER_HEIGHT,
    facing: id === 1 ? 1 : -1,
    spriteFacingSign,
    life: 100,
    maxLife: 100,
    cooldown: 0,
    attack: null,
    hurtTimer: 0,
    celebrate: 0,
    spriteSet,
  };
}

// Resets fighters so every round starts from the same state.
function resetPlayers() {
  state.players[0].x = 256;
  state.players[0].y = WORLD.groundY;
  state.players[0].vx = 0;
  state.players[0].z = 0;
  state.players[0].vz = 0;
  state.players[0].facing = 1;
  state.players[0].life = 100;
  state.players[0].cooldown = 0;
  state.players[0].attack = null;
  state.players[0].hurtTimer = 0;
  state.players[0].celebrate = 0;

  state.players[1].x = 704;
  state.players[1].y = WORLD.groundY;
  state.players[1].vx = 0;
  state.players[1].z = 0;
  state.players[1].vz = 0;
  state.players[1].facing = -1;
  state.players[1].life = 100;
  state.players[1].cooldown = 0;
  state.players[1].attack = null;
  state.players[1].hurtTimer = 0;
  state.players[1].celebrate = 0;
}

// Called when the round starts or restarts.
function beginFight() {
  resetPlayers();
  state.mode = "fight";
  state.winnerId = null;
  state.koTimer = 0;
  state.confettiTick = 0;
  state.particles.length = 0;
  state.sparks.length = 0;
  audio.startMusic();
  audio.playRoundStart();
  syncOverlay();
}

function beginAttack(player, kind) {
  const profile = ATTACKS[kind];
  if (!profile) return;
  audio.playAttack(kind);
  player.attack = {
    kind,
    elapsed: 0,
    landed: false,
    ...profile,
  };
}

// Called when one fighter reaches 0 life.
function endRound(winnerId) {
  state.mode = "ko";
  state.winnerId = winnerId;
  state.koTimer = 0;
  state.confettiTick = 0;
  for (const player of state.players) {
    player.attack = null;
    player.cooldown = 0;
  }
  audio.playKo();
  const winner = state.players[winnerId - 1];
  spawnConfettiBurst(winner.x, winner.y - winner.z - winner.height * 0.74, 64);
}

function syncOverlay() {
  const show = state.mode === "menu";
  startOverlay.hidden = !show;
}

function clampPlayers() {
  for (const player of state.players) {
    player.x = Math.max(FLOOR_LEFT, Math.min(FLOOR_RIGHT, player.x));
  }

  const p1 = state.players[0];
  const p2 = state.players[1];
  if (p1.x > p2.x - COLLISION_GAP) {
    const middle = (p1.x + p2.x) * 0.5;
    p1.x = Math.max(FLOOR_LEFT, middle - COLLISION_GAP * 0.5);
    p2.x = Math.min(FLOOR_RIGHT, middle + COLLISION_GAP * 0.5);
  }

  if (p1.x <= p2.x) {
    p1.facing = 1;
    p2.facing = -1;
  } else {
    p1.facing = -1;
    p2.facing = 1;
  }
}

function playerOnGround(player) {
  return player.z <= 0.01;
}

function playerFeetY(player) {
  return player.y - player.z;
}

function createAttackHitboxRect(player, spec) {
  const feetY = playerFeetY(player);
  const y = feetY - spec.bottom - spec.height;
  const x = player.facing === 1 ? player.x + spec.forward : player.x - spec.forward - spec.width;
  return {
    x,
    y,
    w: spec.width,
    h: spec.height,
  };
}

function getAttackHitboxRect(player, attack) {
  const specs = ATTACK_HITBOXES[attack.kind];
  if (!specs || specs.length === 0) return null;
  const normalized = Math.max(0, Math.min(1, attack.elapsed / attack.duration));
  const spec = specs.find((candidate) => normalized >= candidate.start && normalized <= candidate.end) || specs[specs.length - 1];
  return createAttackHitboxRect(player, spec);
}

function selectHurtboxProfile(player) {
  if (player.attack?.kind === "jumpKick") return HURTBOX_PROFILES.jumpKick;
  if (player.attack?.kind === "kick") return HURTBOX_PROFILES.kick;
  if (!playerOnGround(player)) return HURTBOX_PROFILES.jump;
  return HURTBOX_PROFILES.stand;
}

function getPlayerHurtboxes(player) {
  const feetY = playerFeetY(player);
  const profile = selectHurtboxProfile(player);
  return profile.map((box) => ({
    x: player.x - box.width * 0.5 + box.offsetX * player.facing,
    y: feetY - box.bottom - box.height,
    w: box.width,
    h: box.height,
  }));
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function overlapCenter(a, b) {
  const left = Math.max(a.x, b.x);
  const right = Math.min(a.x + a.w, b.x + b.w);
  const top = Math.max(a.y, b.y);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  if (right <= left || bottom <= top) return null;
  return {
    x: left + (right - left) * 0.5,
    y: top + (bottom - top) * 0.5,
  };
}

function updatePlayer(index, dt) {
  const player = state.players[index];
  const opponent = state.players[1 - index];

  let direction = 0;
  if (actionHeld(index, "left")) direction -= 1;
  if (actionHeld(index, "right")) direction += 1;

  const canMove = state.mode === "fight";
  const moveScale = player.attack ? 0.35 : 1;
  player.vx = canMove ? direction * PLAYER_SPEED * moveScale : 0;
  player.x += player.vx * dt;

  if (player.cooldown > 0) player.cooldown = Math.max(0, player.cooldown - dt);
  if (player.hurtTimer > 0) player.hurtTimer = Math.max(0, player.hurtTimer - dt);

  if (state.mode !== "fight") {
    player.attack = null;
    player.z = 0;
    player.vz = 0;
    return;
  }

  if (playerOnGround(player) && actionPressed(index, "jump")) {
    player.vz = JUMP_VELOCITY;
    audio.playJump();
  }

  if (player.vz !== 0 || player.z > 0) {
    player.z += player.vz * dt;
    player.vz -= JUMP_GRAVITY * dt;
    if (player.z <= 0) {
      player.z = 0;
      player.vz = 0;
    }
  }

  if (!player.attack && player.cooldown <= 0) {
    const inAir = !playerOnGround(player);
    if (inAir && actionPressed(index, "kick")) beginAttack(player, "jumpKick");
    else if (actionPressed(index, "punch")) beginAttack(player, "punch");
    else if (actionPressed(index, "kick")) beginAttack(player, "kick");
  }

  if (!player.attack) return;

  player.attack.elapsed += dt;
  const attack = player.attack;
  const active = attack.elapsed >= attack.activeStart && attack.elapsed <= attack.activeEnd;
  // Active attack frames are the short window where hits are allowed.
  if (active && !attack.landed) {
    const opponentInFront = (opponent.x - player.x) * player.facing >= -14;
    const attackBox = getAttackHitboxRect(player, attack);
    const hurtboxes = getPlayerHurtboxes(opponent);
    let impactPoint = null;
    if (opponentInFront && attackBox) {
      for (const hurtbox of hurtboxes) {
        if (!rectsOverlap(attackBox, hurtbox)) continue;
        impactPoint = overlapCenter(attackBox, hurtbox);
        break;
      }
    }

    if (impactPoint) {
      attack.landed = true;
      opponent.life = Math.max(0, opponent.life - attack.damage);
      opponent.hurtTimer = 0.2;
      audio.playHit();
      spawnSpark(impactPoint.x, impactPoint.y, attack.sparkColor);
      if (opponent.life <= 0) {
        endRound(player.id);
      }
    }
  }

  if (attack.elapsed >= attack.duration) {
    player.cooldown = attack.cooldown;
    player.attack = null;
  }
}

// Confetti and spark particles are visual feedback only.
function spawnConfettiBurst(x, y, count) {
  for (let i = 0; i < count; i++) {
    state.particles.push({
      x,
      y,
      vx: (Math.random() - 0.5) * 420,
      vy: -Math.random() * 280 - 60,
      gravity: 500 + Math.random() * 130,
      life: 1.2 + Math.random() * 1.1,
      maxLife: 1.2 + Math.random() * 1.1,
      size: 3 + Math.random() * 5,
      color: randomChoice(["#ffd95e", "#ff7a6c", "#69d5ff", "#7efe8f", "#f39fff"]),
      rot: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 9,
    });
  }
}

function spawnSpark(x, y, color) {
  for (let i = 0; i < 12; i++) {
    state.sparks.push({
      x,
      y,
      vx: (Math.random() - 0.5) * 240,
      vy: (Math.random() - 0.5) * 200,
      life: 0.22 + Math.random() * 0.12,
      maxLife: 0.22 + Math.random() * 0.12,
      size: 2 + Math.random() * 2,
      color,
    });
  }
}

function randomChoice(list) {
  return list[(Math.random() * list.length) | 0];
}

function updateParticles(dt) {
  for (const particle of state.particles) {
    particle.life -= dt;
    particle.vy += particle.gravity * dt;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.rot += particle.spin * dt;
  }
  state.particles = state.particles.filter((particle) => particle.life > 0);

  for (const spark of state.sparks) {
    spark.life -= dt;
    spark.x += spark.vx * dt;
    spark.y += spark.vy * dt;
  }
  state.sparks = state.sparks.filter((spark) => spark.life > 0);
}

function update(dt) {
  scanGamepads();
  state.animClock += dt;
  if (state.mode === "menu" && anyStartPressed()) beginFight();
  if (state.mode === "ko" && anyStartPressed()) beginFight();

  if (state.mode === "fight") {
    updatePlayer(0, dt);
    updatePlayer(1, dt);
    clampPlayers();
  } else if (state.mode === "ko") {
    const winner = state.players[state.winnerId - 1];
    winner.celebrate += dt;
    state.koTimer += dt;
    state.confettiTick += dt;
    if (state.confettiTick >= 0.11 && state.koTimer < 5) {
      state.confettiTick = 0;
      spawnConfettiBurst(winner.x, winner.y - winner.z - winner.height * 0.8, 7);
    }
  }

  updateParticles(dt);
  keysPressed.clear();
}

// Everything below is drawing to canvas.
function drawBackground() {
  const sky = ctx.createLinearGradient(0, 0, 0, WORLD.height);
  sky.addColorStop(0, "#7ab9ff");
  sky.addColorStop(0.62, "#d8c780");
  sky.addColorStop(1, "#d08953");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, WORLD.width, WORLD.height);

  if (imageReady(art.background)) {
    ctx.globalAlpha = 0.75;
    ctx.drawImage(art.background, 0, 0, WORLD.width, WORLD.height);
    ctx.globalAlpha = 1;
  }

  ctx.fillStyle = "#4f3120";
  ctx.fillRect(0, WORLD.groundY - 12, WORLD.width, WORLD.height - WORLD.groundY + 12);
  ctx.fillStyle = "rgba(0, 0, 0, 0.14)";
  for (let i = 0; i < 20; i++) {
    const w = WORLD.width / 20;
    ctx.fillRect(i * w, WORLD.groundY - 4, w * 0.7, 6);
  }
}

function drawParticles() {
  for (const particle of state.particles) {
    const t = Math.max(0, particle.life / particle.maxLife);
    ctx.save();
    ctx.translate(particle.x, particle.y);
    ctx.rotate(particle.rot);
    ctx.globalAlpha = Math.min(1, t + 0.1);
    ctx.fillStyle = particle.color;
    ctx.fillRect(-particle.size * 0.5, -particle.size * 0.5, particle.size, particle.size);
    ctx.restore();
  }

  for (const spark of state.sparks) {
    const t = Math.max(0, spark.life / spark.maxLife);
    ctx.globalAlpha = t;
    ctx.fillStyle = spark.color;
    ctx.beginPath();
    ctx.arc(spark.x, spark.y, spark.size * t, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function attackProgress(player) {
  if (!player.attack) return 0;
  return Math.max(0, Math.min(1, player.attack.elapsed / player.attack.duration));
}

function choosePoseForPlayer(player) {
  if (state.mode === "ko") {
    if (state.winnerId === player.id) {
      return Math.floor(player.celebrate * 5) % 2 === 0 ? "victory1" : "victory2";
    }
    return "hurt";
  }

  if (player.hurtTimer > 0.05 && !player.attack) {
    return "hurt";
  }

  if (player.attack) {
    const progress = attackProgress(player);
    if (player.attack.kind === "punch") {
      return progress < 0.5 ? "punch1" : "punch2";
    }
    if (player.attack.kind === "kick") {
      return progress < 0.5 ? "kick1" : "kick2";
    }
    if (player.attack.kind === "jumpKick") {
      return progress < 0.5 ? "jumpkick1" : "jumpkick2";
    }
  }

  if (!playerOnGround(player)) {
    return player.vz >= 0 ? "jump_up" : "jump_down";
  }

  if (Math.abs(player.vx) > 8) {
    return Math.floor(state.animClock * 10) % 2 === 0 ? "walk1" : "walk2";
  }

  return "idle";
}

function poseImageForPlayer(player, pose) {
  const image = player.spriteSet?.poses?.[pose];
  if (imageReady(image)) return image;
  const fallback = player.spriteSet?.fallback;
  if (imageReady(fallback)) return fallback;
  return null;
}

function drawFighter(player) {
  const pose = choosePoseForPlayer(player);
  const frame = poseImageForPlayer(player, pose);
  const x = player.x;
  const y = player.y - player.z - player.height;
  const flashing = player.hurtTimer > 0 && Math.floor(player.hurtTimer * 28) % 2 === 0;
  const celebrateScale = state.mode === "ko" && state.winnerId === player.id ? 1 + Math.sin(player.celebrate * 6) * 0.04 : 1;
  const poseRenderScale = getPoseRenderScale(player, pose);
  const finalScale = celebrateScale * poseRenderScale;
  const poseSourceFacing = player.spriteSet?.poseSourceFacing?.[pose] === -1 ? -1 : 1;

  ctx.save();
  ctx.translate(x, y + player.height * 0.5);
  ctx.scale(player.facing * player.spriteFacingSign * poseSourceFacing * finalScale, finalScale);
  if (flashing) ctx.globalAlpha = 0.45;

  if (frame) {
    const keyed = getAlphaKeyedImage(frame) || frame;
    ctx.drawImage(keyed, -player.width * 0.5, -player.height * 0.5, player.width, player.height);
  } else {
    ctx.fillStyle = player.id === 1 ? "#ea4545" : "#2d67da";
    ctx.fillRect(-player.width * 0.35, -player.height * 0.55, player.width * 0.7, player.height * 0.92);
    ctx.fillStyle = "#f2ddbf";
    ctx.beginPath();
    ctx.arc(0, -player.height * 0.58, player.width * 0.16, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  const shadowScale = Math.max(0.4, 1 - player.z / 280);
  ctx.globalAlpha = Math.max(0.12, 0.28 - player.z / 1200);
  ctx.fillStyle = "rgba(0, 0, 0, 0.9)";
  ctx.beginPath();
  ctx.ellipse(x, WORLD.groundY + 6, player.width * 0.32 * shadowScale, 11 * shadowScale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawLifeBars() {
  const barW = 310;
  const barH = 24;
  const top = 20;
  const left = 32;
  const right = WORLD.width - left - barW;

  drawOneLifeBar(left, top, barW, barH, state.players[0], "P1");
  drawOneLifeBar(right, top, barW, barH, state.players[1], "P2");
}

function drawOneLifeBar(x, y, w, h, player, label) {
  ctx.fillStyle = "rgba(12, 18, 31, 0.85)";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  const ratio = Math.max(0, player.life / player.maxLife);
  const fill = ctx.createLinearGradient(x, y, x + w, y);
  fill.addColorStop(0, ratio > 0.3 ? "#79f27f" : "#ff9b4f");
  fill.addColorStop(1, ratio > 0.3 ? "#2fa553" : "#cb3737");
  ctx.fillStyle = fill;
  ctx.fillRect(x + 2, y + 2, (w - 4) * ratio, h - 4);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 15px Trebuchet MS, sans-serif";
  ctx.fillText(`${label} ${player.life}`, x + 8, y + 17);
}

function drawMenuOverlay() {
  ctx.fillStyle = "rgba(8, 15, 33, 0.35)";
  ctx.fillRect(0, 0, WORLD.width, WORLD.height);
}

function codeToLabel(code) {
  if (!code) return "";
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Arrow")) return code.replace("Arrow", "");
  return code;
}

function drawKoBanner() {
  if (!state.winnerId) return;
  const pulse = 1 + Math.sin(state.koTimer * 8) * 0.05;
  const bannerWidth = 520 * pulse;
  const bannerHeight = 128 * pulse;
  const x = WORLD.width * 0.5 - bannerWidth * 0.5;
  const y = 68;

  ctx.save();
  const keyedBanner = getAlphaKeyedImage(art.winnerBanner);
  if (keyedBanner) {
    ctx.globalAlpha = 0.92;
    ctx.drawImage(keyedBanner, x, y, bannerWidth, bannerHeight);
  } else {
    ctx.fillStyle = "rgba(255, 219, 86, 0.9)";
    ctx.fillRect(x, y, bannerWidth, bannerHeight);
  }
  ctx.restore();

  ctx.textAlign = "center";
  ctx.fillStyle = "#1f0d00";
  ctx.font = "900 44px Trebuchet MS, sans-serif";
  ctx.fillText(`PLAYER ${state.winnerId} WINS!`, WORLD.width * 0.5, y + 76);
  ctx.font = "bold 21px Trebuchet MS, sans-serif";
  ctx.fillStyle = "#2f1700";
  ctx.fillText(`Celebration mode: press ${codeToLabel(NEW_ROUND_KEY)} to restart`, WORLD.width * 0.5, y + 114);
  ctx.textAlign = "left";
}

function render() {
  drawBackground();
  drawParticles();
  drawFighter(state.players[0]);
  drawFighter(state.players[1]);
  drawLifeBars();

  if (state.mode === "menu") {
    drawMenuOverlay();
  } else if (state.mode === "ko") {
    drawKoBanner();
  }
}

// Keyboard handlers update the key sets consumed by update().
function handleKeyDown(event) {
  audio.unlock();
  if (preventedKeyCodes.has(event.code)) event.preventDefault();

  if (!keysHeld.has(event.code)) keysPressed.add(event.code);
  keysHeld.add(event.code);

  if (event.code === "KeyF" && !event.repeat) {
    toggleFullscreen().catch(() => {});
  }
}

function handleKeyUp(event) {
  keysHeld.delete(event.code);
}

async function toggleFullscreen() {
  if (!document.fullscreenElement) {
    await arenaWrap.requestFullscreen();
  } else {
    await document.exitFullscreen();
  }
  resizeCanvasForViewport();
}

function resizeCanvasForViewport() {
  const ratio = WORLD.width / WORLD.height;
  const fullscreenElement = document.fullscreenElement;
  const inFullscreen = Boolean(fullscreenElement);
  const boundsW = inFullscreen ? fullscreenElement.clientWidth || window.innerWidth : window.innerWidth * 0.96;
  const boundsH = inFullscreen ? fullscreenElement.clientHeight || window.innerHeight : window.innerHeight * 0.84;

  let drawW = boundsW;
  let drawH = drawW / ratio;
  if (drawH > boundsH) {
    drawH = boundsH;
    drawW = drawH * ratio;
  }
  if (!inFullscreen) {
    drawW = Math.min(drawW, WORLD.width);
    drawH = Math.min(drawH, WORLD.height);
  }
  canvas.style.width = `${drawW}px`;
  canvas.style.height = `${drawH}px`;
}

// Helper for automated tests and debugging: summarize live game state as JSON text.
window.render_game_to_text = () => {
  const payload = {
    mode: state.mode,
    coordinateSystem: "origin=(0,0) at top-left, +x right, +y down",
    players: state.players.map((player) => ({
      id: player.id,
      pose: choosePoseForPlayer(player),
      x: Math.round(player.x),
      y: Math.round(player.y),
      z: Number(player.z.toFixed(1)),
      vx: Math.round(player.vx),
      vz: Number(player.vz.toFixed(1)),
      facing: player.facing === 1 ? "right" : "left",
      life: player.life,
      cooldown: Number(player.cooldown.toFixed(2)),
      attack: player.attack
        ? {
            kind: player.attack.kind,
            elapsed: Number(player.attack.elapsed.toFixed(2)),
            landed: player.attack.landed,
          }
        : null,
    })),
    winnerId: state.winnerId,
    particles: state.particles.length,
    fullscreen: Boolean(document.fullscreenElement),
    gamepads: gamepadInputs.map((input, index) => ({
      player: index + 1,
      connected: input.connected,
      id: input.connected ? input.id : null,
      assignedConnectedSlot: GAMEPAD_SLOTS[index],
    })),
    controls: {
      p1: CONTROLS[0],
      p2: CONTROLS[1],
      startKeyboard: NEW_ROUND_KEY,
      gamepadAssignmentsByConnectedSlot: {
        p1: GAMEPAD_SLOTS[0],
        p2: GAMEPAD_SLOTS[1],
      },
      gamepad:
        "D-pad/left stick move, Y/Triangle jump, A/Cross punch, B/Circle kick, Start begins/restarts",
      fullscreen: "F",
    },
  };
  return JSON.stringify(payload);
};

// Deterministic stepping hook for browser automation tests.
window.advanceTime = (ms) => {
  const steps = Math.max(1, Math.round(ms / STEP_MS));
  for (let i = 0; i < steps; i++) {
    update(STEP_DT);
  }
  render();
  return Promise.resolve();
};

// Main loop: compute elapsed time, update simulation, draw next frame.
function frame(ts) {
  if (!frame.lastTs) frame.lastTs = ts;
  const dt = Math.min(0.05, (ts - frame.lastTs) / 1000 || STEP_DT);
  frame.lastTs = ts;
  update(dt);
  render();
  requestAnimationFrame(frame);
}

// Wire UI + browser events, then boot the game loop.
startBtn.addEventListener("click", beginFight);
window.addEventListener("keydown", handleKeyDown);
window.addEventListener("keyup", handleKeyUp);
window.addEventListener("resize", resizeCanvasForViewport);
window.addEventListener("fullscreenchange", resizeCanvasForViewport);

syncOverlay();
resizeCanvasForViewport();
requestAnimationFrame(frame);
