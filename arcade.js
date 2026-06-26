// ══════════════════════════════════════════════════════════════════
//  SNAKE ARCADE  —  arcade.js
//
//  This file is the top-level coordinator.
//  It runs AFTER game.js and puzzle.js are both loaded.
//
//  Responsibilities:
//    1. Owns the showScreen() function used by both games
//    2. Wires the Game Select screen (card clicks)
//    3. Initialises Classic Snake menu wiring
//    4. Initialises Puzzle level-select wiring
//    5. Patches the classic snake's "back" button to go to game select
// ══════════════════════════════════════════════════════════════════


// ── SCREEN MANAGER ────────────────────────────────────────────────
// Single source of truth for which screen is visible.
// Both game.js and puzzle.js call this function.
// It's declared here (overriding the one in game.js if any).

window.showScreen = function(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(`screen-${name}`);
  if (target) target.classList.add('active');
};


// ── GAME SELECT SCREEN ────────────────────────────────────────────
// The first screen the player sees — two game cards.

document.getElementById('card-classic').querySelector('.card-btn')
  .addEventListener('click', () => {
    refreshMenuHS();       // reload high scores from game.js
    showScreen('menu');    // go to classic snake menu
  });

document.getElementById('card-puzzle').querySelector('.card-btn')
  .addEventListener('click', () => {
    initPuzzleLevelSelect();   // from puzzle.js — wires level buttons
    showScreen('puzzle-select');
  });

// Clicking the card body itself (not just the button) also works
document.getElementById('card-classic').addEventListener('click', e => {
  if (!e.target.closest('.card-btn')) {
    refreshMenuHS();
    showScreen('menu');
  }
});
document.getElementById('card-puzzle').addEventListener('click', e => {
  if (!e.target.closest('.card-btn')) {
    initPuzzleLevelSelect();
    showScreen('puzzle-select');
  }
});


// ── CLASSIC SNAKE WIRING ──────────────────────────────────────────
// Re-run the button wiring from game.js (which targeted elements that
// now exist in the new index.html). Also patch "back to game select".

document.getElementById('btn-back-select').addEventListener('click', () => {
  showScreen('select');
});

// btn-start, btn-instructions, btn-back, btn-restart, btn-mainmenu
// are all already wired in game.js — they still work because
// showScreen() is the same function.

// Difficulty buttons (already wired in game.js, safe to leave).


// ── CLASSIC SNAKE: btn-mainmenu goes to game select if desired ────
// Override: after game over, "Main Menu" takes player back to classic menu.
// If you want it to go to the arcade select instead, change 'menu' → 'select' below.
document.getElementById('btn-mainmenu').addEventListener('click', () => {
  refreshMenuHS();
  showScreen('menu');
}, { capture: true });  // runs before game.js listener


// ── INIT ──────────────────────────────────────────────────────────
(function init() {
  // Start on the game select screen
  showScreen('select');
})();