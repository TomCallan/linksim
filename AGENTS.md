# Agent Guidelines for Linksim

This document outlines key technical guidelines, architectural principles, and constraints for AI coding agents operating on the Linksim codebase.

## Absolute Rules
1. **No Emojis Allowed**: Never use emojis in code, comments, commit messages, responses, UI text, or documentation.
2. **Zero Runtime Dependencies**: The core runtime must remain pure vanilla JavaScript (ES5/ES6) and HTML5 Canvas. Do not introduce npm runtime dependencies or heavy frameworks.
3. **Deterministic Physics**: Physics is governed by Extended Position-Based Dynamics (XPBD). Modifications must preserve zero heap allocation during step loops.
4. **Verification**: Always run the automated test suite before reporting task completion:
   ```bash
   node tests/test-presets-rigidity.js
   node tests/test-physics-rigidity.js
   node tests/test-physics.js
   node tests/test-api.js
   node tests/test-ui-menu.js
   ```

## Repository Architecture

```
linksim/
├── index.html              # Single-page interface, CSS styles, modal dialogs
├── js/
│   ├── math2d.js           # 2D geometry, vector math, cam profile formulas
│   ├── physics.js          # Sub-stepped XPBD solver, kinematic nodes, constraints
│   ├── timeline.js         # 1800-frame cyclic snapshot buffer & loop cache
│   ├── sprites.js          # Procedural canvas sprites (motors, gears, springs)
│   ├── editor.js           # Data model, tools, presets, canvas hit testing
│   ├── app.js              # Application controller, modal wiring, animation loop
│   └── api.js              # window.LinksimAPI programmatic interface
├── tests/                  # Automated Node.js integration tests
├── README.md               # User guide and live demo documentation
├── TODO.md                 # Project roadmap and pending features
└── AGENTS.md               # This file
```

## Physics & Constraint Conventions
- **Kinematic Nodes**: Fixed pins, active motor crank pins, and pins attached to gears/genevas/cams must have `invMass = 0.0`. They are skipped during Symplectic Euler integration because their trajectories are prescribed.
- **Distance Constraints (Rods)**: Infinitely stiff rods (`compliance === 0.0`) must use the direct projection path `factor = deltaC / (dist * wSum)`.
- **Mouse Dragging**: User interactions must apply pre-solve target attraction displacement (`dragAlpha = 0.5`) rather than destructive post-solve coordinate overrides. This allows distance and slider constraints to project the dragged node onto valid kinematic manifolds without stretching rods.
- **Grashof Condition**: When designing 4-bar linkages, ensure link lengths satisfy $S + L \le P + Q$ so continuous rotary motors do not pull against dead-center singularities.

## UI Layout & Reactivity Conventions
- **No Horizontal Scrollbars**: The top bar (header) and bottom bar (playback and options) must be reactive and adapt gracefully across all viewport widths (from desktop down to 360px mobile). Never introduce horizontal scrollbars to top or bottom bars.
- **Header Structure**: Brand and Mode Toggle reside in `.header-left`, Blueprint tools in `#editTools`, and utilities in `.header-right`. When space is constrained (<= 1150px), `#editTools` wraps cleanly into a dedicated centered sub-tier with `flex-basis: 100%`.
- **Playback & Options Bar**: Playback controls and the timeline scrubber occupy the primary row. On viewports <= 1060px, the 7 option toggles wrap into a second tier styled as interactive tactile chips (`:has(input:checked)`), leaving the timeline slider ample width for precise scrubbing.
- **Dynamic Viewport Height**: Canvas sizing is governed by `handleResize()`, which dynamically computes `window.innerHeight - headerH - barH`. A `ResizeObserver` monitors header and playback-bar size changes in real time so the canvas viewport adapts instantly when bars wrap or expand.
- **UMD Compatibility**: Browser global scripts evaluate with `module` and `exports` undefined. Never assign directly to `module.exports` inside factory function scopes.

## Programmatic API (`window.LinksimAPI`)
Agents can script simulations or create custom automated benchmarks via `window.LinksimAPI`:
- `LinksimAPI.build(model)`: Declaratively load nodes, rods, gears, sliders, motors, springs, pulleys, belts, cams.
- `LinksimAPI.play()`, `LinksimAPI.pause()`, `LinksimAPI.step(dt)`: Control simulation state.
- `LinksimAPI.getState()`: Inspect complete node positions, velocities, rod stresses, and motor torques.
- `LinksimAPI.dragNode(id, x, y)` & `LinksimAPI.releaseDrag()`: Simulate manual human input.

