const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('Running UI Context Menu & CSS Sanity Test Suite...');

// Test 1: Balanced braces in index.html CSS and around .options-bar
{
  const htmlPath = path.join(__dirname, '../index.html');
  const htmlContent = fs.readFileSync(htmlPath, 'utf8');

  const styleMatch = htmlContent.match(/<style[^>]*>([\s\S]*?)<\/style>/);
  assert(styleMatch, 'index.html must contain a <style> block');

  const styleContent = styleMatch[1];

  let balance = 0;
  let minBalance = 0;
  let lines = styleContent.split('\n');
  let errorLine = -1;

  for (let i = 0; i < styleContent.length; i++) {
    const ch = styleContent[i];
    if (ch === '{') {
      balance++;
    } else if (ch === '}') {
      balance--;
      if (balance < minBalance) {
        minBalance = balance;
        if (errorLine === -1) {
          errorLine = styleContent.substring(0, i).split('\n').length;
        }
      }
    }
  }

  assert.strictEqual(minBalance, 0, `Unmatched closing brace detected in index.html <style> block near line ${errorLine}`);
  assert.strictEqual(balance, 0, `Unbalanced braces in index.html <style> block (final balance: ${balance})`);

  // Verify options-bar does not have an orphan closing brace before #radialMenu
  const optionsBarToRadial = htmlContent.match(/\.options-bar[\s\S]*?#radialMenu/);
  assert(optionsBarToRadial, 'Expected .options-bar and #radialMenu in index.html');

  const snippet = optionsBarToRadial[0];
  const openCount = (snippet.match(/\{/g) || []).length;
  const closeCount = (snippet.match(/\}/g) || []).length;
  assert.strictEqual(openCount, closeCount, `Mismatched braces between .options-bar and #radialMenu: { count is ${openCount}, } count is ${closeCount}`);

  console.log('PASS: index.html CSS has balanced braces without orphan closing braces');
}

// Test 2: Radial menu positioning at cursor and safe boundary clamping
{
  const appJsPath = path.join(__dirname, '../js/app.js');
  const appJsContent = fs.readFileSync(appJsPath, 'utf8');

  // Verify that over-clamping with rMax + 10 is eliminated
  assert(!appJsContent.includes('rMax + 10'), 'showContextMenu should not clamp using rMax + 10');

  // Extract positioning logic from showContextMenu
  const match = appJsContent.match(/function showContextMenu\([^)]*\)\s*\{([\s\S]*?radialMenuEl\.style\.top\s*=\s*cy\s*\+\s*'px';)/);
  assert(match, 'showContextMenu positioning code must exist in js/app.js');

  const computeCoords = new Function('clientX', 'clientY', 'window', 'radialMenuEl', match[1]);

  const win = { innerWidth: 1024, innerHeight: 768 };

  // Case A: Normal click well inside bounds (e.g., 100, 100) should stay directly at cursor
  {
    const el = { style: {} };
    computeCoords(100, 100, win, el);
    assert.strictEqual(el.style.left, '100px', `Expected left to be 100px, got ${el.style.left}`);
    assert.strictEqual(el.style.top, '100px', `Expected top to be 100px, got ${el.style.top}`);
  }

  // Case B: Center screen click (500, 350)
  {
    const el = { style: {} };
    computeCoords(500, 350, win, el);
    assert.strictEqual(el.style.left, '500px', `Expected left to be 500px, got ${el.style.left}`);
    assert.strictEqual(el.style.top, '350px', `Expected top to be 350px, got ${el.style.top}`);
  }

  // Case C: Near top-left edge (< 30px) clamps to 30px margin
  {
    const el = { style: {} };
    computeCoords(10, 15, win, el);
    assert.strictEqual(el.style.left, '30px', `Expected left clamped to 30px, got ${el.style.left}`);
    assert.strictEqual(el.style.top, '30px', `Expected top clamped to 30px, got ${el.style.top}`);
  }

  // Case D: Near bottom-right edge clamps to window - 30px margin
  {
    const el = { style: {} };
    computeCoords(1020, 760, win, el);
    assert.strictEqual(el.style.left, '994px', `Expected left clamped to 994px, got ${el.style.left}`);
    assert.strictEqual(el.style.top, '738px', `Expected top clamped to 738px, got ${el.style.top}`);
  }

  console.log('PASS: showContextMenu correctly positions radial menu at cursor with 30px edge clamping');
}

// Test 3: Browser global scope script loading without module or exports
{
  const files = ['js/math2d.js', 'js/physics.js', 'js/timeline.js', 'js/sprites.js', 'js/editor.js', 'js/api.js'];
  const fakeWindow = {};

  files.forEach(f => {
    const code = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    const fn = new Function('window', 'globalThis', 'Math2D', 'PhysicsSystem', 'PhysicsTimeline', 'SpriteRenderer', 'MechanismEditor', 'LinksimAPI', 'exports', 'module', code);
    assert.doesNotThrow(() => {
      fn(fakeWindow, fakeWindow, fakeWindow.Math2D, fakeWindow.PhysicsSystem, fakeWindow.PhysicsTimeline, fakeWindow.SpriteRenderer, fakeWindow.MechanismEditor, fakeWindow.LinksimAPI, undefined, undefined);
    }, `Failed to execute ${f} in browser environment where module is undefined`);
  });

  assert(fakeWindow.MechanismEditor, 'MechanismEditor must be exported to window in browser environment');
  assert(fakeWindow.MechanismEditor.Presets, 'MechanismEditor.Presets must be defined');
  assert.strictEqual(Object.keys(fakeWindow.MechanismEditor.Presets).length, 14, 'MechanismEditor.Presets must contain 14 presets');

  console.log('PASS: All scripts evaluate cleanly in browser scope without module/exports');
}

console.log('All UI context menu and browser loading tests passed!');

