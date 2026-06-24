// ══════════════════════════════════════════════════════════════════
//  SNAKE GAME v2 — game.js
//
//  SECTIONS
//  ─────────────────────────────────────────────────────────────────
//  1.  CONFIG & TUNING          ← change speeds, jump rates, etc. here
//  2.  STATE VARIABLES
//  3.  SOUND  (Web Audio API — no audio files needed)
//  4.  HIGH SCORE  (localStorage, separate per difficulty)
//  5.  DAY / NIGHT CYCLE
//  6.  FROG logic  (spawn, jump scheduling, jump execution)
//  7.  GUARD SNAKES  (hard mode only, vertical patrol)
//  8.  SNAKE logic  (movement, collision, growth)
//  9.  RENDERING  (grid, frog, guards, snake, night fog)
//  10. GAME LOOP
//  11. INPUT  (keyboard)
//  12. SCREEN MANAGEMENT
//  13. BUTTON WIRING
//  14. INIT
// ══════════════════════════════════════════════════════════════════


// ── 1. CONFIG & TUNING ────────────────────────────────────────────
//    All numbers you might want to tweak are here at the top.
const CFG = {
  // Grid
  CELL : 20,          // px per cell
  COLS : 30,          // 600 / 20
  ROWS : 30,

  // Snake speeds (ms per tick — lower = faster)
  SPEED: { easy: 130, medium: 85, hard: 52 },

  // Frog jump rules per difficulty:
  //   jumpEvery  — eat this many static frogs, then next frog can jump
  //   maxJumps   — how many times that frog can jump before settling
  //   jumpChance — probability (0–1) frog actually jumps each tick it CAN jump
  //   jumpTick   — ms between possible jumps
  FROG: {
    easy:   { jumpEvery: 4, maxJumps: 1, jumpChance: 0.3,  jumpTick: 1200 },
    medium: { jumpEvery: 3, maxJumps: 2, jumpChance: 0.45, jumpTick: 900  },
    hard:   { jumpEvery: 2, maxJumps: 3, jumpChance: 0.6,  jumpTick: 650  },
  },

  // Day / Night cycle (ms per phase)
  DAY_PHASE_MS: 30_000,    // 30 s per phase  → tweak to taste

  // Night visibility: radius in grid cells around snake head
  NIGHT_RADIUS: 6,

  // Guard snakes (hard mode)
  GUARD: {
    count      : 2,     // number of guards
    length     : 4,     // cells long each guard
    speed      : 400,   // ms between guard moves (independent of snake speed)
    guardRadius: 3,     // grid cells away from frog guards try to stay
  },

  // Colours — change any hex here to retheme the game
  COLOR: {
    bg        : '#0d1117',
    bgEvening : '#12091e',
    bgNight   : '#05080f',
    grid      : 'rgba(255,255,255,0.032)',
    gridEve   : 'rgba(255,200,100,0.04)',
    gridNight : 'rgba(100,150,255,0.03)',
    snakeHead : '#58e06f',
    snakeBody : '#3fb950',
    snakeAlt  : '#2ea043',
    frogStatic: '#4ade80',   // frog sitting still
    frogJump  : '#facc15',   // frog that can jump (yellow warning)
    guardHead : '#fb923c',
    guardBody : '#f97316',
    guardAlt  : '#ea580c',
    nightFog  : 'rgba(5, 8, 15, 0.88)',  // colour of the darkness mask
  },
};


// ── 2. STATE VARIABLES ────────────────────────────────────────────
let snake      = [];       // array of {x,y} — head first
let dir        = {};       // current direction vector
let nextDir    = {};       // buffered next direction
let frog       = {};       // {x, y, jumpsLeft, canJump}
let frogsEaten = 0;        // total frogs eaten this game
let score      = 0;
let highScore  = 0;
let difficulty = 'easy';

let gameRunning = false;
let paused      = false;
let loopTimer   = null;

// Frog jump state
let frogJumpTimer = null;  // interval handle for jump ticks

// Guard snakes  [{cells:[{x,y}...], dir:1|-1}]
let guards     = [];
let guardTimer = null;

// Day/night
let dayPhase   = 0;        // 0=day, 1=evening, 2=night
let dayTimer   = null;

const PHASE_NAMES = ['☀️ Day', '🌆 Evening', '🌙 Night'];
const PHASE_CLASSES = ['', 'evening', 'night'];


// ── 3. SOUND ──────────────────────────────────────────────────────
//    Uses Web Audio API — no external files. Lazy-init on first gesture.
let audioCtx = null;

function getAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

// type: 'eat' | 'jump' | 'die'
function playSound(type) {
  try {
    const ctx  = getAudio();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === 'eat') {
      // Short upward chirp
      osc.type = 'square';
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.14, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.12);

    } else if (type === 'jump') {
      // Boing — descend then rise
      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.08);
      osc.frequency.exponentialRampToValueAtTime(500, ctx.currentTime + 0.18);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.2);

    } else if (type === 'die') {
      // Descending wail
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(300, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(55, ctx.currentTime + 0.45);
      gain.gain.setValueAtTime(0.16, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.45);
    }
  } catch (_) { /* audio blocked — silent fallback */ }
}


// ── 4. HIGH SCORE ─────────────────────────────────────────────────
//    Three separate localStorage keys, one per difficulty.
const HS_KEYS = { easy: 'hs_easy', medium: 'hs_medium', hard: 'hs_hard' };

function loadHS(diff) {
  return parseInt(localStorage.getItem(HS_KEYS[diff]) || '0', 10);
}

function saveHS(diff, val) {
  localStorage.setItem(HS_KEYS[diff], String(val));
}

// Refresh the three scores shown on the main menu
function refreshMenuHS() {
  ['easy','medium','hard'].forEach(d => {
    document.getElementById(`hs-${d}`).textContent = loadHS(d);
  });
}


// ── 5. DAY / NIGHT CYCLE ──────────────────────────────────────────
//    Cycles through 3 phases every CFG.DAY_PHASE_MS milliseconds.
//    Changes body CSS class so the canvas background colour transitions.

function startDayCycle() {
  dayPhase = 0;
  applyDayPhase();
  clearInterval(dayTimer);
  dayTimer = setInterval(() => {
    dayPhase = (dayPhase + 1) % 3;
    applyDayPhase();
  }, CFG.DAY_PHASE_MS);
}

function applyDayPhase() {
  // Remove old phase classes, add current
  document.body.classList.remove('evening', 'night');
  if (PHASE_CLASSES[dayPhase]) document.body.classList.add(PHASE_CLASSES[dayPhase]);
  document.getElementById('hud-timeofday').textContent = PHASE_NAMES[dayPhase];
}

function stopDayCycle() {
  clearInterval(dayTimer);
  document.body.classList.remove('evening', 'night');
}


// ── 6. FROG LOGIC ─────────────────────────────────────────────────
//    Frog is the "food". After eating CFG.FROG[diff].jumpEvery frogs,
//    the next frog is a "jumper" — it may teleport before being eaten.

// Return a random cell not occupied by the snake or guards
function randomEmptyCell() {
  const occupied = new Set(snake.map(s => `${s.x},${s.y}`));
  guards.forEach(g => g.cells.forEach(c => occupied.add(`${c.x},${c.y}`)));
  let pos;
  do {
    pos = { x: Math.floor(Math.random() * CFG.COLS),
            y: Math.floor(Math.random() * CFG.ROWS) };
  } while (occupied.has(`${pos.x},${pos.y}`));
  return pos;
}

// Spawn a new frog. Decides if it's a jumper based on frogsEaten count.
function spawnFrog() {
  const cfg = CFG.FROG[difficulty];
  const pos = randomEmptyCell();
  const isJumper = (frogsEaten > 0) && (frogsEaten % cfg.jumpEvery === 0);

  frog = {
    x        : pos.x,
    y        : pos.y,
    canJump  : isJumper,
    jumpsLeft: isJumper ? cfg.maxJumps : 0,
  };

  // Start the jump interval only for jumper frogs
  clearInterval(frogJumpTimer);
  if (isJumper) {
    frogJumpTimer = setInterval(maybeFrogJump, cfg.jumpTick);
  }

  // Reposition guards near new frog (hard only)
  if (difficulty === 'hard') positionGuards();
}

// Called every jumpTick ms for a jumper frog — may or may not jump
function maybeFrogJump() {
  if (!gameRunning || paused) return;
  if (frog.jumpsLeft <= 0) {
    clearInterval(frogJumpTimer);
    frog.canJump = false;
    return;
  }

  const cfg = CFG.FROG[difficulty];
  if (Math.random() < cfg.jumpChance) {
    // Actually jump!
    const newPos = randomEmptyCell();
    frog.x = newPos.x;
    frog.y = newPos.y;
    frog.jumpsLeft--;
    playSound('jump');
    triggerFrogFlash();

    // Reposition guards to new frog location
    if (difficulty === 'hard') positionGuards();

    if (frog.jumpsLeft <= 0) {
      clearInterval(frogJumpTimer);
      frog.canJump = false;
    }
  }
}

// Brief yellow flash on canvas to signal frog jump
function triggerFrogFlash() {
  const el = document.getElementById('frog-flash');
  el.classList.remove('hidden');
  // Re-trigger CSS animation by cloning trick
  void el.offsetWidth;
  setTimeout(() => el.classList.add('hidden'), 350);
}


// ── 7. GUARD SNAKES ───────────────────────────────────────────────
//    Hard mode only. Two short snakes patrol vertically near the frog.
//    They only move up/down. Touching them = game over.

function spawnGuards() {
  guards = [];
  if (difficulty !== 'hard') return;

  const gcfg = CFG.GUARD;
  for (let i = 0; i < gcfg.count; i++) {
    // Place guards to left and right of frog at guardRadius distance
    const gx = frog.x + (i === 0 ? -gcfg.guardRadius : gcfg.guardRadius);
    const clampedX = Math.max(0, Math.min(CFG.COLS - 1, gx));
    const cells = [];
    for (let j = 0; j < gcfg.length; j++) {
      const gy = Math.max(0, Math.min(CFG.ROWS - 1, frog.y - Math.floor(gcfg.length / 2) + j));
      cells.push({ x: clampedX, y: gy });
    }
    guards.push({ cells, dir: 1 }); // dir 1 = down, -1 = up
  }

  clearInterval(guardTimer);
  guardTimer = setInterval(moveGuards, CFG.GUARD.speed);
}

// Reposition guards when frog moves/jumps
function positionGuards() {
  if (difficulty !== 'hard') return;
  spawnGuards();
}

// Each tick: move guards up or down, bounce at walls
function moveGuards() {
  if (!gameRunning || paused) return;
  guards.forEach(g => {
    const head = g.cells[0];
    const newY = head.y + g.dir;

    // Bounce off top/bottom
    if (newY < 0 || newY >= CFG.ROWS) {
      g.dir *= -1;
      return;
    }

    // Shift all cells down / up
    g.cells.unshift({ x: head.x, y: newY });
    g.cells.pop();
  });
}

function stopGuards() {
  clearInterval(guardTimer);
  guards = [];
}

// Check if a point {x,y} overlaps any guard cell
function hitsGuard(pos) {
  return guards.some(g => g.cells.some(c => c.x === pos.x && c.y === pos.y));
}


// ── 8. SNAKE LOGIC ────────────────────────────────────────────────
//    Standard snake: move head, check collisions, eat frog or shrink tail.

function createSnake() {
  const cx = Math.floor(CFG.COLS / 2);
  const cy = Math.floor(CFG.ROWS / 2);
  return [
    { x: cx,     y: cy },
    { x: cx - 1, y: cy },
    { x: cx - 2, y: cy },
  ];
}

// Returns false if the move killed the snake
function stepSnake() {
  dir = { ...nextDir };  // commit buffered direction

  const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };

  // ── Wall collision
  if (head.x < 0 || head.x >= CFG.COLS || head.y < 0 || head.y >= CFG.ROWS) return false;

  // ── Self collision (ignore the very last tail segment — it moves away)
  for (let i = 0; i < snake.length - 1; i++) {
    if (snake[i].x === head.x && snake[i].y === head.y) return false;
  }

  // ── Guard collision
  if (hitsGuard(head)) return false;

  snake.unshift(head);

  // ── Frog eaten
  if (head.x === frog.x && head.y === frog.y) {
    score += 10;
    frogsEaten++;
    playSound('eat');
    updateHUD();
    clearInterval(frogJumpTimer);
    spawnFrog();
    // Tail NOT removed → snake grows
  } else {
    snake.pop();  // normal move — remove tail
  }

  return true;
}


// ── 9. RENDERING ──────────────────────────────────────────────────
//    Canvas drawing: grid → frog → guards → snake → night fog

const canvas = document.getElementById('game-canvas');
const ctx    = canvas.getContext('2d');

// Rounded rectangle helper
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// Draw the subtle background grid
function drawGrid() {
  const gridColor = dayPhase === 2 ? CFG.COLOR.gridNight
                  : dayPhase === 1 ? CFG.COLOR.gridEve
                  : CFG.COLOR.grid;
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 0.5;
  for (let x = 0; x <= CFG.COLS; x++) {
    ctx.beginPath(); ctx.moveTo(x * CFG.CELL, 0); ctx.lineTo(x * CFG.CELL, CFG.ROWS * CFG.CELL); ctx.stroke();
  }
  for (let y = 0; y <= CFG.ROWS; y++) {
    ctx.beginPath(); ctx.moveTo(0, y * CFG.CELL); ctx.lineTo(CFG.COLS * CFG.CELL, y * CFG.CELL); ctx.stroke();
  }
}

// Draw the frog — yellow if it can jump (warning), green if static
function drawFrog() {
  const px  = frog.x * CFG.CELL;
  const py  = frog.y * CFG.CELL;
  const pad = 2;
  const col = frog.canJump ? CFG.COLOR.frogJump : CFG.COLOR.frogStatic;

  // Glow
  ctx.shadowColor = col;
  ctx.shadowBlur  = frog.canJump ? 18 : 10;
  ctx.fillStyle   = col;
  roundRect(px + pad, py + pad, CFG.CELL - pad * 2, CFG.CELL - pad * 2, 6);
  ctx.fill();
  ctx.shadowBlur  = 0;

  // Eyes
  ctx.fillStyle = '#0d1117';
  ctx.beginPath(); ctx.arc(px + 6,  py + 6,  2.5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(px + 13, py + 6,  2.5, 0, Math.PI * 2); ctx.fill();

  // Tiny legs (decorative lines)
  ctx.strokeStyle = col;
  ctx.lineWidth = 1.5;
  // left leg
  ctx.beginPath(); ctx.moveTo(px + 4, py + 15); ctx.lineTo(px + 1, py + 19); ctx.stroke();
  // right leg
  ctx.beginPath(); ctx.moveTo(px + 16, py + 15); ctx.lineTo(px + 19, py + 19); ctx.stroke();

  // Jump indicator — pulsing ring when frog CAN jump
  if (frog.canJump) {
    ctx.strokeStyle = 'rgba(250,204,21,0.4)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(px + CFG.CELL / 2, py + CFG.CELL / 2, CFG.CELL / 2 + 3, 0, Math.PI * 2);
    ctx.stroke();
  }
}

// Draw guard snakes
function drawGuards() {
  guards.forEach(g => {
    g.cells.forEach((cell, i) => {
      const px  = cell.x * CFG.CELL;
      const py  = cell.y * CFG.CELL;
      const pad = i === 0 ? 1 : 2;
      const col = i === 0 ? CFG.COLOR.guardHead
                : i % 2 === 0 ? CFG.COLOR.guardBody : CFG.COLOR.guardAlt;
      ctx.fillStyle = col;
      roundRect(px + pad, py + pad, CFG.CELL - pad * 2, CFG.CELL - pad * 2, i === 0 ? 6 : 4);
      ctx.fill();
    });
  });
}

// Draw the player snake — head distinct from body, eyes on head
function drawSnake() {
  snake.forEach((seg, i) => {
    const px  = seg.x * CFG.CELL;
    const py  = seg.y * CFG.CELL;
    const pad = i === 0 ? 1 : 2;
    const r   = i === 0 ? 7 : 4;
    ctx.fillStyle = i === 0 ? CFG.COLOR.snakeHead
                  : i % 2 === 0 ? CFG.COLOR.snakeBody : CFG.COLOR.snakeAlt;
    roundRect(px + pad, py + pad, CFG.CELL - pad * 2, CFG.CELL - pad * 2, r);
    ctx.fill();

    // Eyes on head
    if (i === 0) {
      ctx.fillStyle = '#0d1117';
      // Position eyes based on direction
      const ex  = dir.x === 1 ? px + CFG.CELL - 6 : dir.x === -1 ? px + 4 : px + 5;
      const ey  = dir.y === 1 ? py + CFG.CELL - 6 : dir.y === -1 ? py + 4 : py + 5;
      const ex2 = dir.x !== 0 ? ex  : px + CFG.CELL - 6;
      const ey2 = dir.y !== 0 ? ey  : py + CFG.CELL - 6;
      ctx.beginPath(); ctx.arc(ex,  ey,  2.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(ex2, ey2, 2.5, 0, Math.PI * 2); ctx.fill();
    }
  });
}

// Night fog: draw darkness everywhere EXCEPT a radius around the snake head
function drawNightFog() {
  if (dayPhase !== 2) return;  // only at night

  const hx  = (snake[0].x + 0.5) * CFG.CELL;
  const hy  = (snake[0].y + 0.5) * CFG.CELL;
  const r   = CFG.NIGHT_RADIUS * CFG.CELL;

  // Radial gradient: transparent in centre, dark at edges
  const grad = ctx.createRadialGradient(hx, hy, r * 0.3, hx, hy, r);
  grad.addColorStop(0, 'rgba(5,8,15,0)');
  grad.addColorStop(1, CFG.COLOR.nightFog);

  // Fill whole canvas then "cut out" the visible circle via gradient
  ctx.fillStyle = CFG.COLOR.nightFog;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Overlay the gradient to soften the fog edge
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(hx, hy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
}

// Master render call — called every game tick
function render() {
  // Background colour shifts with day/night via CSS, but canvas bg is drawn here
  const bgCol = dayPhase === 2 ? CFG.COLOR.bgNight
              : dayPhase === 1 ? CFG.COLOR.bgEvening
              : CFG.COLOR.bg;
  ctx.fillStyle = bgCol;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  drawGrid();
  drawFrog();
  drawGuards();
  drawSnake();
  drawNightFog();   // drawn last — overlays everything in darkness
}

// Update HUD score + highscore display
function updateHUD() {
  document.getElementById('hud-score').textContent     = score;
  document.getElementById('hud-highscore').textContent = highScore;
}


// ── 10. GAME LOOP ──────────────────────────────────────────────────
//     setTimeout-based loop. Speed controlled by CFG.SPEED[difficulty].

function tick() {
  if (!gameRunning || paused) return;

  const alive = stepSnake();
  render();

  if (!alive) {
    endGame();
    return;
  }

  loopTimer = setTimeout(tick, CFG.SPEED[difficulty]);
}

// Start or restart the game
function startGame() {
  // ── Reset everything
  snake      = createSnake();
  dir        = { x: 1, y: 0 };
  nextDir    = { x: 1, y: 0 };
  score      = 0;
  frogsEaten = 0;
  paused     = false;
  gameRunning = true;
  highScore  = loadHS(difficulty);

  clearTimeout(loopTimer);
  clearInterval(frogJumpTimer);
  stopGuards();
  stopDayCycle();

  // Update HUD labels
  document.getElementById('hud-diff').textContent =
    difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
  updateHUD();

  // Spawn first frog (non-jumper since frogsEaten = 0)
  spawnFrog();

  // Spawn guards if hard
  if (difficulty === 'hard') spawnGuards();

  // Start day/night cycle
  startDayCycle();

  render();
  loopTimer = setTimeout(tick, CFG.SPEED[difficulty]);
  showScreen('game');
}

// Called when the snake dies
function endGame() {
  gameRunning = false;
  clearTimeout(loopTimer);
  clearInterval(frogJumpTimer);
  stopGuards();
  stopDayCycle();
  playSound('die');

  // Save high score for this difficulty if beaten
  if (score > highScore) {
    highScore = score;
    saveHS(difficulty, highScore);
    refreshMenuHS();
  }

  // Populate game over screen
  document.getElementById('go-score').textContent     = score;
  document.getElementById('go-highscore').textContent = highScore;
  document.getElementById('go-diff').textContent      =
    difficulty.charAt(0).toUpperCase() + difficulty.slice(1);

  setTimeout(() => showScreen('gameover'), 350);
}

// Toggle pause state
function togglePause() {
  if (!gameRunning) return;
  paused = !paused;
  document.getElementById('pause-overlay').classList.toggle('hidden', !paused);
  if (!paused) loopTimer = setTimeout(tick, CFG.SPEED[difficulty]);
}


// ── 11. INPUT ──────────────────────────────────────────────────────
const KEY_MAP = {
  ArrowUp    : { x: 0,  y: -1 },
  ArrowDown  : { x: 0,  y:  1 },
  ArrowLeft  : { x: -1, y:  0 },
  ArrowRight : { x: 1,  y:  0 },
  w: { x: 0,  y: -1 },
  s: { x: 0,  y:  1 },
  a: { x: -1, y:  0 },
  d: { x: 1,  y:  0 },
};

document.addEventListener('keydown', e => {
  if (e.key === 'p' || e.key === 'P') { togglePause(); return; }

  const newDir = KEY_MAP[e.key];
  if (!newDir) return;
  e.preventDefault();

  // Block 180° reversal
  if (newDir.x !== -dir.x || newDir.y !== -dir.y) nextDir = newDir;
});


// ── 12. SCREEN MANAGEMENT ──────────────────────────────────────────
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(`screen-${name}`).classList.add('active');
}


// ── 13. BUTTON WIRING ──────────────────────────────────────────────
// Unlock audio on first user gesture (required by browsers)
document.getElementById('btn-start').addEventListener('click', () => {
  getAudio();
  startGame();
});

document.getElementById('btn-instructions').addEventListener('click', () => showScreen('instructions'));

document.getElementById('btn-quit').addEventListener('click', () => {
  document.body.innerHTML =
    '<div style="display:flex;height:100vh;align-items:center;justify-content:center;' +
    'color:#3fb950;font-size:22px;font-family:monospace;background:#0d1117">' +
    'Thanks for playing! 🐍🐸</div>';
});

document.getElementById('btn-back').addEventListener('click', () => showScreen('menu'));

document.getElementById('btn-restart').addEventListener('click', startGame);
document.getElementById('btn-mainmenu').addEventListener('click', () => {
  refreshMenuHS();
  showScreen('menu');
});

// Difficulty buttons
document.querySelectorAll('.diff-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    difficulty = btn.dataset.diff;
  });
});


// ── 14. INIT ───────────────────────────────────────────────────────
(function init() {
  refreshMenuHS();   // load and display all 3 high scores on menu
  showScreen('menu');
})();