# Physics Rigidity and Context Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix right-click context menu positioning so it appears exactly at the mouse location, and eliminate rod stretching across the physics engine and presets while maintaining 60+ FPS performance.

**Architecture:** 
1. Fix CSS syntax error and coordinate clamping in `index.html` and `js/app.js` so the radial context menu centers directly at `(clientX, clientY)`.
2. Overhaul kinematic nodes and mouse dragging in `js/physics.js` XPBD solver: treat motor cranks, gear pins, and user-dragged nodes with strict physical consistency (zero inverse mass during constraint solve, soft spring/attraction target for mouse dragging instead of end-of-frame destructive coordinate snapping).
3. Fix preset linkage dimensions in `js/editor.js` (`gearedBellCrank` and `showcase`) to satisfy Grashof conditions so they do not jam against geometric singularities.
4. Tune XPBD substeps and Gauss-Seidel iterations for max speed and zero stretch.

**Tech Stack:** Vanilla JavaScript (ES5/ES6), HTML5 Canvas, XPBD (Extended Position-Based Dynamics), Node.js for test execution.

**Spec:** User bug report:
- "the right click menu doesnt show up at the mouse location any more."
- "and the physics still seems questionable (especially because rods keep fucking stretching)."
- "the most important thing is that the physics, and interaction between things are accurate, and the physics engine is fast. plan first"

## Global Constraints
- Absolute NO emojis anywhere (code, UI, comments, commits, messages).
- Pure vanilla JavaScript, zero external runtime dependencies.
- All existing tests in `tests/test-physics.js` and `tests/test-api.js` must pass.
- Linkable file references must use `file://` scheme.

---

### Task 1: Fix Right-Click Context Menu Positioning

**Files:**
- Modify: `index.html:250-265`
- Modify: `js/app.js:532-545`
- Test: `tests/test-ui-menu.js`

**Interfaces:**
- Consumes: `editor.onShowContextMenu(clientX, clientY, targetType, targetData)`
- Produces: Correctly positioned `#radialMenu` centered on mouse click.

- [ ] **Step 1: Write test verifying radial menu coordinate assignment and CSS sanity**
Create `tests/test-ui-menu.js` checking that CSS in `index.html` has balanced braces and that `showContextMenu` coordinates place the menu directly at `(clientX, clientY)`.

- [ ] **Step 2: Run test to verify it fails on current codebase**
Run: `node tests/test-ui-menu.js`
Expected: FAIL due to extra closing brace in `index.html` and/or over-clamping.

- [ ] **Step 3: Remove extraneous CSS brace and fix coordinate positioning**
In `index.html`, remove the orphan `}` at line 252.
In `js/app.js`, update `showContextMenu` so `cx = clientX` and `cy = clientY` with minimal padding (e.g. 30px) so it does not jump 150px away from the mouse.

- [ ] **Step 4: Run test to verify it passes**
Run: `node tests/test-ui-menu.js`
Expected: PASS.

- [ ] **Step 5: Commit**
Run: `git add index.html js/app.js tests/test-ui-menu.js && git commit -m "fix: restore right-click radial menu positioning at mouse cursor"`

---

### Task 2: Eliminate Rod Stretching in XPBD Physics Engine

**Files:**
- Modify: `js/physics.js:481-515, 770-835, 1035-1090`
- Test: `tests/test-physics-rigidity.js`

**Interfaces:**
- Consumes: `PhysicsSystem.prototype.step(dt)`
- Produces: Stiff, non-stretching rods under motor drive and mouse drag (`stress < 0.005`).

- [ ] **Step 1: Write test for rod rigidity under motor load and mouse drag**
Create `tests/test-physics-rigidity.js` testing:
1. Four-bar linkage driven by high speed motor: rod stretch must be < 0.1 px.
2. Mouse dragging a free node connected to an anchored rod: rod length must remain invariant (stretch < 0.01 px).
3. Attached pin on rotating gear connected to slider: rod stretch must remain < 0.1 px.

- [ ] **Step 2: Run test to verify failures**
Run: `node tests/test-physics-rigidity.js`
Expected: FAIL (mouse drag stretches rod to 50+ px, motor crank introduces stretch).

- [ ] **Step 3: Implement kinematic constraints and non-destructive mouse attraction in physics.js**
1. Set `this.invMass[motor.crankNode] = 0.0` for active motors so the constraint solver treats the crank pin as a rigid kinematic anchor.
2. In `step()` Symplectic Euler integration, skip position updates for all kinematic nodes (fixed pins, active motor cranks, gear/geneva attached nodes).
3. In `step()` mouse drag handling, replace the post-solve position overwrite (`this.x[mouseDragNode] = this.mouseDragX`) with a pre-solve target attraction displacement. Let the constraint solver enforce rod lengths and sliders.
4. In `PhysicsSystem.prototype.addRod` and `step()`, ensure zero compliance uses direct projection `deltaC / (dist * wSum)` with `solverIterations = 8` and `substeps = 30`.

- [ ] **Step 4: Run tests to verify passing**
Run: `node tests/test-physics-rigidity.js && node tests/test-physics.js`
Expected: All tests PASS.

- [ ] **Step 5: Commit**
Run: `git add js/physics.js tests/test-physics-rigidity.js && git commit -m "fix: overhaul kinematic nodes and mouse dragging to eliminate rod stretching"`

---

### Task 3: Fix Preset Geometries for Seamless Rotation

**Files:**
- Modify: `js/editor.js:2298-2330, 2564-2635`
- Test: `tests/test-presets-rigidity.js`

**Interfaces:**
- Consumes: `MechanismEditor.Presets`
- Produces: Grashof-compliant mechanisms without geometric locking.

- [ ] **Step 1: Write automated preset stretch test**
Create `tests/test-presets-rigidity.js` simulating 300 frames of every preset in `MechanismEditor.Presets` and asserting that max rod stretch on all rigid rods is < 0.5 px.

- [ ] **Step 2: Run test to identify failing presets**
Run: `node tests/test-presets-rigidity.js`
Expected: FAIL on `gearedBellCrank` (diff ~21 px) and `showcase` (diff ~23 px).

- [ ] **Step 3: Update preset dimensions in editor.js**
1. `gearedBellCrank`: Update rod 0 (`2 -> 3`) length from 90 to 115 px so it can span the gear rotation circle (max distance 155.4 px). Adjust slider rail range so the piston does not bottom out.
2. `showcase`: Update 4-bar linkage (nodes 17-20) to satisfy Grashof condition (crank radius 45, coupler 95, rocker 80, ground 130).

- [ ] **Step 4: Run test to verify all presets pass**
Run: `node tests/test-presets-rigidity.js`
Expected: PASS for all presets.

- [ ] **Step 5: Commit**
Run: `git add js/editor.js tests/test-presets-rigidity.js && git commit -m "fix: update gearedBellCrank and showcase presets to Grashof-compliant dimensions"`

---

### Task 4: Comprehensive Verification and Push

**Files:**
- Verify: all test files in `tests/`
- Test: `tests/test-physics.js`, `tests/test-api.js`, `tests/test-presets-rigidity.js`, `tests/test-physics-rigidity.js`, `tests/test-ui-menu.js`

- [ ] **Step 1: Run complete test suite**
Run: `node tests/test-physics.js && node tests/test-api.js && node tests/test-physics-rigidity.js && node tests/test-presets-rigidity.js && node tests/test-ui-menu.js`
Expected: 100% PASS with 0 failures.

- [ ] **Step 2: Verify git status and check for no emojis**
Run: `git status` and verify no emojis exist in commit history or modified code.

- [ ] **Step 3: Push to GitHub**
Run: `git push origin master`
Expected: Successfully pushed to GitHub.
