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

  // Verify playback bar and context menu exist with balanced braces between them
  const optionsBarToRadial = htmlContent.match(/\.playback-bar[\s\S]*?#radialMenu/);
  assert(optionsBarToRadial, 'Expected .playback-bar and #radialMenu in index.html');

  const snippet = optionsBarToRadial[0];
  const openCount = (snippet.match(/\{/g) || []).length;
  const closeCount = (snippet.match(/\}/g) || []).length;
  assert.strictEqual(openCount, closeCount, `Mismatched braces between .options-bar and #radialMenu: { count is ${openCount}, } count is ${closeCount}`);

  console.log('PASS: index.html CSS has balanced braces without orphan closing braces');
}

// Test 2: Structured context menu rendering and edge-clamped positioning
{
  const appJsPath = path.join(__dirname, '../js/app.js');
  const appJsContent = fs.readFileSync(appJsPath, 'utf8');

  // Verify the old radial over-clamp is gone
  assert(!appJsContent.includes('rMax + 10'), 'showContextMenu should not clamp using rMax + 10');

  // Verify structured grouped menu markup is generated
  assert(appJsContent.includes("className = 'context-group-title'"), 'Expected grouped context menu titles');
  assert(appJsContent.includes("className = 'context-header'"), 'Expected context menu header');
  assert(appJsContent.includes("' active-opt'"), 'Expected active-option styling hook');

  // Verify cursor placement with edge clamping against the measured menu size
  assert(appJsContent.includes('Math.max(8, Math.min(window.innerWidth - menuW - 8, clientX))'), 'Missing left edge clamping for context menu');
  assert(appJsContent.includes('Math.max(8, Math.min(window.innerHeight - menuH - 8, clientY))'), 'Missing top edge clamping for context menu');
  assert(appJsContent.includes("contextMenuEl.style.display = 'block'"), 'Context menu must be shown before measuring');

  // Verify the empty-space ADD menu exposes every placeable element type
  ['Joint (free node)', 'Pin (ground anchor)', 'Beam', 'Spring', 'Slider', 'Lever', 'Gear', 'Pulley', 'Cam', 'Motor (pin + crank)', 'Text Label']
    .forEach(function(label) {
      assert(appJsContent.includes(label), 'Empty-space add menu is missing: ' + label);
    });

  console.log('PASS: Structured context menu with grouped sections and edge-clamped positioning');
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
  assert.strictEqual(Object.keys(fakeWindow.MechanismEditor.Presets).length, 1, 'MechanismEditor.Presets must contain the single sandbox preset');

  console.log('PASS: All scripts evaluate cleanly in browser scope without module/exports');
}

// Test 4: Reactive Top Bar and Bottom Bar CSS & Structure Sanity
{
  const htmlPath = path.join(__dirname, '../index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  // Verify responsive media queries exist for header and playback-bar
  assert(html.includes('@media (max-width: 1150px)'), 'Missing 1150px media query for editTools toolbar wrap');
  assert(html.includes('@media (max-width: 1060px)'), 'Missing 1060px media query for options-bar wrap');
  assert(html.includes('@media (max-width: 680px)'), 'Missing 680px media query for mobile playback-bar layout');
  assert(html.includes('@media (max-width: 480px)'), 'Missing 480px media query for ultra-narrow screens');

  // Verify responsive classes and elements
  assert(html.includes('class="preset-label"'), 'Expected .preset-label in header for responsive display');
  assert(html.includes('class="speed-label"'), 'Expected .speed-label in playback controls for responsive display');
  assert(html.includes('class="btn-text-full"'), 'Expected .btn-text-full for responsive step button labels');
  assert(html.includes('.context-item.active-opt'), 'Expected context menu active-option styling');
  assert(!html.includes('id="toggleGravity"'), 'Bottom-bar option toggles must be removed');
  assert(!html.includes('class="options-bar"'), 'Bottom options bar must be removed');

  // Verify flex wrapping is enabled on both bars to prevent horizontal overflow clipping
  assert(html.includes('flex-wrap: wrap'), 'Expected flex-wrap: wrap on responsive bars');

  console.log('PASS: Reactive top bar and bottom bar rules and markup verified');
}

console.log('All UI context menu and browser loading tests passed!');


