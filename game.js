// ══════════════════════════════════════════════════════════════════
//  CLASSIC SNAKE — game.js   (fixed version)
//
//  BUGS FIXED:
//   • Medium/Hard not starting — difficulty variable wasn't being
//     read correctly when startGame() was called from arcade.js
//   • Restart button after game-over was re-adding event listeners
//     each game causing double-fires; now uses onclick assignment
//   • Instructions "Back" button was firing showScreen('menu') but
//     arcade.js had already overridden showScreen — now uses window.showScreen
//   • Snake auto-hitting wall — guardTimer interval wasn't being
//     cleared before re-spawn, causing old guards to run alongside new ones
//   • btn-mainmenu double-listener conflict with arcade.js resolved
//
//  SECTIONS
//   1.  CONFIG & TUNING
//   2.  STATE
//   3.  SOUND
//   4.  HIGH SCORE
//   5.  DAY/NIGHT CYCLE
//   6.  FROG LOGIC
//   7.  GUARD SNAKES
//   8.  SNAKE LOGIC
//   9.  RENDERING
//   10. GAME LOOP
//   11. INPUT
//   12. SCREEN (stub — arcade.js overrides window.showScreen)
//   13. BUTTON WIRING
//   14. INIT
// ══════════════════════════════════════════════════════════════════


// ── 1. CONFIG ─────────────────────────────────────────────────────
const CFG = {
  CELL : 20, COLS : 30, ROWS : 30,

  // ms per tick — lower = faster snake
  SPEED: { easy: 130, medium: 85, hard: 52 },

  // Frog jump config per difficulty
  FROG: {
    easy:   { jumpEvery: 4, maxJumps: 1, jumpChance: 0.3,  jumpTick: 1200 },
    medium: { jumpEvery: 3, maxJumps: 2, jumpChance: 0.45, jumpTick: 900  },
    hard:   { jumpEvery: 2, maxJumps: 3, jumpChance: 0.6,  jumpTick: 650  },
  },

  DAY_PHASE_MS : 30000,   // ms per day phase
  NIGHT_RADIUS : 6,       // cells of visibility at night

  GUARD: { count:2, length:4, speed:400, guardRadius:3 },

  COLOR: {
    bg:'#0d1117', bgEvening:'#12091e', bgNight:'#05080f',
    grid:'rgba(255,255,255,0.032)',
    gridEve:'rgba(255,200,100,0.04)',
    gridNight:'rgba(100,150,255,0.03)',
    snakeHead:'#58e06f', snakeBody:'#3fb950', snakeAlt:'#2ea043',
    frogStatic:'#4ade80', frogJump:'#facc15',
    guardHead:'#fb923c', guardBody:'#f97316', guardAlt:'#ea580c',
    nightFog:'rgba(5,8,15,0.88)',
  },
};


// ── 2. STATE ──────────────────────────────────────────────────────
let snake, dir, nextDir, frog, frogsEaten, score, highScore;
let gameRunning = false;
let paused      = false;
let loopTimer   = null;
let frogJumpTimer = null;
let difficulty  = 'easy';   // ← set by difficulty buttons; startGame() reads this
let guards      = [];
let guardTimer  = null;
let dayPhase    = 0;
let dayTimer    = null;

const PHASE_NAMES   = ['☀️ Day', '🌆 Evening', '🌙 Night'];
const PHASE_CLASSES = ['', 'evening', 'night'];


// ── 3. SOUND ──────────────────────────────────────────────────────
let audioCtx = null;
function getAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}
function playSound(type) {
  try {
    const ctx = getAudio();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    if (type === 'eat') {
      osc.type = 'square';
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.14, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
      osc.start(); osc.stop(ctx.currentTime + 0.12);
    } else if (type === 'jump') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.08);
      osc.frequency.exponentialRampToValueAtTime(500, ctx.currentTime + 0.18);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
      osc.start(); osc.stop(ctx.currentTime + 0.2);
    } else {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(300, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(55, ctx.currentTime + 0.45);
      gain.gain.setValueAtTime(0.16, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
      osc.start(); osc.stop(ctx.currentTime + 0.45);
    }
  } catch (_) {}
}


// ── 4. HIGH SCORE ─────────────────────────────────────────────────
// Each difficulty has its own localStorage key
const HS_KEYS = { easy:'hs_easy', medium:'hs_medium', hard:'hs_hard' };
function loadHS(diff)      { return parseInt(localStorage.getItem(HS_KEYS[diff])||'0',10); }
function saveHS(diff, val) { localStorage.setItem(HS_KEYS[diff], String(val)); }
function refreshMenuHS() {
  ['easy','medium','hard'].forEach(d => {
    const el = document.getElementById(`hs-${d}`);
    if (el) el.textContent = loadHS(d);
  });
}


// ── 5. DAY / NIGHT CYCLE ──────────────────────────────────────────
function startDayCycle() {
  dayPhase = 0; applyDayPhase();
  clearInterval(dayTimer);
  dayTimer = setInterval(() => { dayPhase = (dayPhase + 1) % 3; applyDayPhase(); }, CFG.DAY_PHASE_MS);
}
function applyDayPhase() {
  document.body.classList.remove('evening','night');
  if (PHASE_CLASSES[dayPhase]) document.body.classList.add(PHASE_CLASSES[dayPhase]);
  const h = document.getElementById('hud-timeofday');
  if (h) h.textContent = PHASE_NAMES[dayPhase];
}
function stopDayCycle() { clearInterval(dayTimer); document.body.classList.remove('evening','night'); }


// ── 6. FROG LOGIC ─────────────────────────────────────────────────
function randomEmptyCell() {
  const occ = new Set(snake.map(s=>`${s.x},${s.y}`));
  guards.forEach(g => g.cells.forEach(c => occ.add(`${c.x},${c.y}`)));
  let pos;
  do { pos = { x:Math.floor(Math.random()*CFG.COLS), y:Math.floor(Math.random()*CFG.ROWS) }; }
  while (occ.has(`${pos.x},${pos.y}`));
  return pos;
}
function spawnFrog() {
  const cfg = CFG.FROG[difficulty];
  const pos = randomEmptyCell();
  const isJumper = (frogsEaten > 0) && (frogsEaten % cfg.jumpEvery === 0);
  frog = { x:pos.x, y:pos.y, canJump:isJumper, jumpsLeft:isJumper ? cfg.maxJumps : 0 };
  clearInterval(frogJumpTimer);
  if (isJumper) frogJumpTimer = setInterval(maybeFrogJump, cfg.jumpTick);
  if (difficulty === 'hard') positionGuards();
}
function maybeFrogJump() {
  if (!gameRunning || paused) return;
  if (frog.jumpsLeft <= 0) { clearInterval(frogJumpTimer); frog.canJump = false; return; }
  if (Math.random() < CFG.FROG[difficulty].jumpChance) {
    const p = randomEmptyCell();
    frog.x = p.x; frog.y = p.y; frog.jumpsLeft--;
    playSound('jump');
    const fl = document.getElementById('frog-flash');
    if (fl) { fl.classList.remove('hidden'); setTimeout(()=>fl.classList.add('hidden'),350); }
    if (difficulty === 'hard') positionGuards();
    if (frog.jumpsLeft <= 0) { clearInterval(frogJumpTimer); frog.canJump = false; }
  }
}


// ── 7. GUARD SNAKES ───────────────────────────────────────────────
// Hard mode only — two snakes patrol vertically near the frog
function spawnGuards() {
  // FIX: always clear old timer before creating new guards
  clearInterval(guardTimer);
  guards = [];
  const gcfg = CFG.GUARD;
  for (let i = 0; i < gcfg.count; i++) {
    const gx = Math.max(0, Math.min(CFG.COLS-1, frog.x + (i===0 ? -gcfg.guardRadius : gcfg.guardRadius)));
    const cells = [];
    for (let j = 0; j < gcfg.length; j++) {
      cells.push({ x:gx, y:Math.max(0,Math.min(CFG.ROWS-1, frog.y - Math.floor(gcfg.length/2)+j)) });
    }
    guards.push({ cells, dir:1 });
  }
  guardTimer = setInterval(moveGuards, gcfg.speed);
}
function positionGuards() { if (difficulty === 'hard') spawnGuards(); }
function moveGuards() {
  if (!gameRunning || paused) return;
  guards.forEach(g => {
    const newY = g.cells[0].y + g.dir;
    if (newY < 0 || newY >= CFG.ROWS) { g.dir *= -1; return; }
    g.cells.unshift({ x:g.cells[0].x, y:newY });
    g.cells.pop();
  });
}
function stopGuards() { clearInterval(guardTimer); guardTimer = null; guards = []; }
function hitsGuard(pos) { return guards.some(g=>g.cells.some(c=>c.x===pos.x&&c.y===pos.y)); }


// ── 8. SNAKE LOGIC ────────────────────────────────────────────────
function createSnake() {
  const cx=Math.floor(CFG.COLS/2), cy=Math.floor(CFG.ROWS/2);
  return [{x:cx,y:cy},{x:cx-1,y:cy},{x:cx-2,y:cy}];
}
function stepSnake() {
  dir = { ...nextDir };
  const head = { x:snake[0].x+dir.x, y:snake[0].y+dir.y };
  if (head.x<0||head.x>=CFG.COLS||head.y<0||head.y>=CFG.ROWS) return false;
  for (let i=0; i<snake.length-1; i++) {
    if (snake[i].x===head.x && snake[i].y===head.y) return false;
  }
  if (hitsGuard(head)) return false;
  snake.unshift(head);
  if (head.x===frog.x && head.y===frog.y) {
    score+=10; frogsEaten++; playSound('eat'); updateHUD();
    clearInterval(frogJumpTimer); spawnFrog();
  } else { snake.pop(); }
  return true;
}


// ── 9. RENDERING ──────────────────────────────────────────────────
const canvas = document.getElementById('game-canvas');
const ctx    = canvas.getContext('2d');

function roundRect(x,y,w,h,r){
  ctx.beginPath(); ctx.moveTo(x+r,y);
  ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r);
  ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y); ctx.closePath();
}
function drawGrid(){
  const gc=dayPhase===2?CFG.COLOR.gridNight:dayPhase===1?CFG.COLOR.gridEve:CFG.COLOR.grid;
  ctx.strokeStyle=gc; ctx.lineWidth=0.5;
  for(let x=0;x<=CFG.COLS;x++){ctx.beginPath();ctx.moveTo(x*CFG.CELL,0);ctx.lineTo(x*CFG.CELL,CFG.ROWS*CFG.CELL);ctx.stroke();}
  for(let y=0;y<=CFG.ROWS;y++){ctx.beginPath();ctx.moveTo(0,y*CFG.CELL);ctx.lineTo(CFG.COLS*CFG.CELL,y*CFG.CELL);ctx.stroke();}
}
function drawFrog(){
  const px=frog.x*CFG.CELL,py=frog.y*CFG.CELL,pad=2;
  const col=frog.canJump?CFG.COLOR.frogJump:CFG.COLOR.frogStatic;
  ctx.shadowColor=col; ctx.shadowBlur=frog.canJump?18:10; ctx.fillStyle=col;
  roundRect(px+pad,py+pad,CFG.CELL-pad*2,CFG.CELL-pad*2,6); ctx.fill();
  ctx.shadowBlur=0; ctx.fillStyle='#0d1117';
  ctx.beginPath();ctx.arc(px+6,py+6,2.5,0,Math.PI*2);ctx.fill();
  ctx.beginPath();ctx.arc(px+13,py+6,2.5,0,Math.PI*2);ctx.fill();
  ctx.strokeStyle=col; ctx.lineWidth=1.5;
  ctx.beginPath();ctx.moveTo(px+4,py+15);ctx.lineTo(px+1,py+19);ctx.stroke();
  ctx.beginPath();ctx.moveTo(px+16,py+15);ctx.lineTo(px+19,py+19);ctx.stroke();
  if(frog.canJump){
    ctx.strokeStyle='rgba(250,204,21,0.4)';ctx.lineWidth=1.5;
    ctx.beginPath();ctx.arc(px+CFG.CELL/2,py+CFG.CELL/2,CFG.CELL/2+3,0,Math.PI*2);ctx.stroke();
  }
}
function drawGuards(){
  guards.forEach(g=>{
    g.cells.forEach((cell,i)=>{
      const px=cell.x*CFG.CELL,py=cell.y*CFG.CELL,pad=i===0?1:2;
      ctx.fillStyle=i===0?CFG.COLOR.guardHead:i%2===0?CFG.COLOR.guardBody:CFG.COLOR.guardAlt;
      roundRect(px+pad,py+pad,CFG.CELL-pad*2,CFG.CELL-pad*2,i===0?6:4); ctx.fill();
    });
  });
}
function drawSnake(){
  snake.forEach((seg,i)=>{
    const px=seg.x*CFG.CELL,py=seg.y*CFG.CELL,pad=i===0?1:2,r=i===0?7:4;
    ctx.fillStyle=i===0?CFG.COLOR.snakeHead:i%2===0?CFG.COLOR.snakeBody:CFG.COLOR.snakeAlt;
    roundRect(px+pad,py+pad,CFG.CELL-pad*2,CFG.CELL-pad*2,r); ctx.fill();
    if(i===0){
      ctx.fillStyle='#0d1117';
      const ex=dir.x===1?px+CFG.CELL-6:dir.x===-1?px+4:px+5;
      const ey=dir.y===1?py+CFG.CELL-6:dir.y===-1?py+4:py+5;
      const ex2=dir.x!==0?ex:px+CFG.CELL-6, ey2=dir.y!==0?ey:py+CFG.CELL-6;
      ctx.beginPath();ctx.arc(ex,ey,2.5,0,Math.PI*2);ctx.fill();
      ctx.beginPath();ctx.arc(ex2,ey2,2.5,0,Math.PI*2);ctx.fill();
    }
  });
}
function drawNightFog(){
  if(dayPhase!==2) return;
  const hx=(snake[0].x+0.5)*CFG.CELL, hy=(snake[0].y+0.5)*CFG.CELL, r=CFG.NIGHT_RADIUS*CFG.CELL;
  const grad=ctx.createRadialGradient(hx,hy,r*0.3,hx,hy,r);
  grad.addColorStop(0,'rgba(5,8,15,0)'); grad.addColorStop(1,CFG.COLOR.nightFog);
  ctx.fillStyle=CFG.COLOR.nightFog; ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.globalCompositeOperation='destination-out';
  ctx.fillStyle=grad; ctx.beginPath(); ctx.arc(hx,hy,r,0,Math.PI*2); ctx.fill();
  ctx.globalCompositeOperation='source-over';
}
function render(){
  const bg=dayPhase===2?CFG.COLOR.bgNight:dayPhase===1?CFG.COLOR.bgEvening:CFG.COLOR.bg;
  ctx.fillStyle=bg; ctx.fillRect(0,0,canvas.width,canvas.height);
  drawGrid(); drawFrog(); drawGuards(); drawSnake(); drawNightFog();
}
function updateHUD(){
  const hs=document.getElementById('hud-score'),hh=document.getElementById('hud-highscore');
  if(hs) hs.textContent=score;
  if(hh) hh.textContent=highScore;
}


// ── 10. GAME LOOP ─────────────────────────────────────────────────
function tick(){
  if(!gameRunning||paused) return;
  const alive=stepSnake(); render();
  if(!alive){ endGame(); return; }
  loopTimer=setTimeout(tick, CFG.SPEED[difficulty]);
}

function startGame(){
  // FIX: read difficulty from the currently-active diff-btn if nothing set
  const activeBtn = document.querySelector('.diff-btn.active');
  if (activeBtn) difficulty = activeBtn.dataset.diff;

  snake=createSnake(); dir={x:1,y:0}; nextDir={x:1,y:0};
  score=0; frogsEaten=0; paused=false; gameRunning=true;
  highScore=loadHS(difficulty);

  clearTimeout(loopTimer);
  clearInterval(frogJumpTimer);
  stopGuards();       // FIX: always stop old guards/timer before new game
  stopDayCycle();

  const hd=document.getElementById('hud-diff');
  if(hd) hd.textContent=difficulty.charAt(0).toUpperCase()+difficulty.slice(1);
  updateHUD(); spawnFrog();
  if(difficulty==='hard') spawnGuards();
  startDayCycle(); render();
  loopTimer=setTimeout(tick, CFG.SPEED[difficulty]);
  window.showScreen('game');
}

function endGame(){
  gameRunning=false;
  clearTimeout(loopTimer);
  clearInterval(frogJumpTimer);
  stopGuards(); stopDayCycle(); playSound('die');
  if(score>highScore){ highScore=score; saveHS(difficulty,highScore); refreshMenuHS(); }
  const gs=document.getElementById('go-score'),gh=document.getElementById('go-highscore'),gd=document.getElementById('go-diff');
  if(gs) gs.textContent=score;
  if(gh) gh.textContent=highScore;
  if(gd) gd.textContent=difficulty.charAt(0).toUpperCase()+difficulty.slice(1);
  setTimeout(()=>window.showScreen('gameover'),350);
}

function togglePause(){
  if(!gameRunning) return;
  paused=!paused;
  const po=document.getElementById('pause-overlay');
  if(po) po.classList.toggle('hidden',!paused);
  if(!paused) loopTimer=setTimeout(tick,CFG.SPEED[difficulty]);
}


// ── 11. INPUT ─────────────────────────────────────────────────────
const KEY_MAP={
  ArrowUp:{x:0,y:-1},ArrowDown:{x:0,y:1},
  ArrowLeft:{x:-1,y:0},ArrowRight:{x:1,y:0},
  w:{x:0,y:-1},s:{x:0,y:1},a:{x:-1,y:0},d:{x:1,y:0}
};
document.addEventListener('keydown',e=>{
  if(e.key==='p'||e.key==='P'){ togglePause(); return; }
  const newDir=KEY_MAP[e.key]; if(!newDir) return; e.preventDefault();
  // FIX: ignore OS auto-repeat keydowns. Without this, if the player is still
  // physically holding the previous direction key while tapping a new one,
  // the browser keeps re-firing the OLD key's keydown (key-repeat). Since
  // every keydown overwrites nextDir unconditionally, one of those repeats
  // can land right after the new key and silently snap the snake back onto
  // its old heading — which looks exactly like the snake "auto-driving"
  // into a wall, since the player's real turn never got applied.
  if(e.repeat) return;
  // FIX: only block reversal, otherwise always commit
  if(newDir.x!==-dir.x||newDir.y!==-dir.y) nextDir=newDir;
});


// ── 12. SCREEN (stub) ─────────────────────────────────────────────
// Defined here as fallback; arcade.js assigns window.showScreen
function showScreen(name){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  const t=document.getElementById(`screen-${name}`); if(t) t.classList.add('active');
}
window.showScreen = showScreen;


// ── 13. BUTTON WIRING ─────────────────────────────────────────────
// FIX: use onclick (not addEventListener) so re-running startGame()
// doesn't stack duplicate listeners.

document.getElementById('btn-start').onclick = () => { getAudio(); startGame(); };

// FIX: instructions back button — use window.showScreen so arcade.js override applies
document.getElementById('btn-instructions').onclick = () => window.showScreen('instructions');
document.getElementById('btn-back').onclick          = () => window.showScreen('menu');

// FIX: restart and main-menu use onclick to avoid duplicate listeners
document.getElementById('btn-restart').onclick  = () => startGame();
document.getElementById('btn-mainmenu').onclick = () => { refreshMenuHS(); window.showScreen('menu'); };

// Difficulty buttons
document.querySelectorAll('.diff-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.diff-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    difficulty = btn.dataset.diff;   // FIX: assign to module-level variable immediately
  });
});


// ── 14. INIT ──────────────────────────────────────────────────────
(function init(){ refreshMenuHS(); })();