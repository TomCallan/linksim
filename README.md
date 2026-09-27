# Linksim 2.0 - High-Performance 2D Mechanical Linkage & Physics Simulator

A 60+ FPS 2D mechanical linkage and physics simulator running on Extended Position-Based Dynamics (XPBD). Supports rigid links, physical materials, fixed pins, prismatic linear sliders, authentic meshed gears, rotational motors, rigid bell-crank brackets, timeline scrubbing playback, and procedural mechanical sprites.

## Features

- **High-Performance XPBD Engine:** Sub-stepped multi-pass Gauss-Seidel solver with zero per-frame heap allocations.
- **Physical Materials & Zero Stretch:** Rigid Steel, Aluminum, Carbon Fiber, Composite Wood, Rubber Band, and Coil Spring with true XPBD compliance ($\alpha$).
- **2D Constraints & Mechanisms:**
  - **Rigid Rods / Bars:** Infinitely stiff distance constraints.
  - **Ground Pins:** Fixed mechanical anchors with earth hatching stands.
  - **Prismatic Sliders:** Cylinder guide rails with sliding pistons and friction.
  - **Authentic Toothed Gears:** Involute profile teeth with automatic mathematical phase alignment and pitch circle meshing.
  - **Rotational Motors:** Kinematic and torque-coupled rotational drives.
  - **Bell-Cranks & Orthogonal Levers:** Rigid 2D angle constraints for transferring motion across right angles.
  - **Parenting to Gears:** Attach eccentric crankpins directly to gear bodies.
- **Single-Window Unified Workspace:** Seamlessly toggle between Edit and Simulate modes, or press `Space` to Play/Pause.
- **Fluid Universal Interaction:**
  - Drag from any node to stretch and connect rigid rods.
  - Drag empty space to pan the view in ANY tool mode.
  - Pinch-to-zoom and two-finger pan on touchscreens / trackpads.
  - Long-press or right-click to open the context menu.
  - Double-click any element to open the Property Inspector.
- **Deterministic Timeline Playback:** 1800-frame cyclic snapshot buffer with Play, Pause, Step Back, Step Forward, and bi-directional Time Scrubbing.

## Controls & Shortcuts

| Action | Control / Shortcut |
| :--- | :--- |
| **Play / Pause** | `Space` |
| **Pan Canvas** | Drag empty space, Middle-drag, or Two-finger drag |
| **Zoom** | Mouse wheel or Pinch gesture |
| **Connect Rod** | Click & drag from node to another node (or empty space) |
| **Context Menu** | Right-click or Touch Long-press |
| **Inspect Properties** | Double-click element or Context Menu -> Configure |
| **Select / Move** | `V` |
| **Add Pin** | `P` |
| **Add Joint / Node** | `J` or `N` |
| **Add Rod** | `R` |
| **Add Slider** | `S` |
| **Add Gear** | `G` |
| **Add Motor** | `M` |
| **Delete Element** | `Delete` or `Backspace` |
| **Undo** | `Ctrl + Z` |
| **Step Backward / Forward** | `[` / `]` |

## Programmatic API for AI Agents & Programs

Linksim exposes `window.LinksimAPI` allowing AI agents or scripts to build, simulate, and inspect mechanisms programmatically:

```javascript
// 1. Declaratively build a mechanism
LinksimAPI.build({
  nodes: [
    { x: 0, y: 0, fixed: true },
    { x: 40, y: 0, fixed: false },
    { x: 120, y: 0, fixed: false },
    { x: 0, y: 0, fixed: true },
    { x: 200, y: 0, fixed: true }
  ],
  rods: [
    { a: 0, b: 1, length: 40, material: 'steel' },
    { a: 1, b: 2, length: 110, material: 'aluminum' }
  ],
  sliders: [
    { node: 2, aNode: 3, bNode: 4, minT: 10, maxT: 190, friction: 0.05 }
  ],
  motors: [
    { centerNode: 0, crankNode: 1, speed: 3.0 }
  ],
  gravity: { x: 0, y: 0 }
});

// 2. Control simulation
LinksimAPI.play();
LinksimAPI.step(1 / 60);
LinksimAPI.pause();

// 3. Inspect telemetry
const telemetry = LinksimAPI.getState();
console.log(telemetry.nodes); // [{ id, x, y, vx, vy, fixed }, ...]
console.log(telemetry.rods);  // [{ a, b, length, stress, material }, ...]
```

## Running & Testing

```bash
# Run automated test suites
node tests/test-physics.js
node tests/test-api.js

# Launch local server
npx serve .
```
