# Linksim 2.0 - High-Performance 2D Mechanical Linkage & Physics Simulator

Live Demo: [https://tomcallan.github.io/linksim/](https://tomcallan.github.io/linksim/)

Linksim is a 60+ FPS browser-based 2D mechanical linkage and physics simulator running on Extended Position-Based Dynamics (XPBD). Built with pure vanilla JavaScript and HTML5 Canvas, it features zero runtime dependencies, sub-stepped multi-pass constraint solving, zero rod stretch, physical materials, realistic machine elements, and deep interactive mechanics.

## Key Features

- **Zero-Stretch XPBD Solver**: 30-substep Gauss-Seidel solver ensuring completely rigid linkages without rubbery stretching or numerical drift.
- **Strict Kinematic Consistency**: Motors, gear-attached crankpins, Geneva drivers, and cams act as true kinematic anchors during constraint projection.
- **Deep Physical Interactions**:
  - **Dynamic Shifting Gearbox**: Multi-speed transmission where moving a shift lever on a slider rail dynamically meshes gears in real time.
  - **Over-Center Toggle Clamp**: Bistable mechanism demonstrating mechanical advantage and snap-action locking past dead-center.
  - **Clock Escapement**: Escape wheel with ratchet teeth driving a rocking anchor pallet pendulum, producing authentic tick-tock stepping.
  - **Non-Destructive Mouse Dragging**: Interactive spring attraction allows dragging mechanisms by hand without violating rigid rod constraints.
- **Interactive Vector Cam Designer**:
  - Direct on-canvas freehand sculpting and carving of cam profiles.
  - Draggable control handles to shape lobes and flat spots.
  - Shape presets including Pear, Heart, Snail, Geneva, 3-Lobe Trochoid, 4-Leaf Clover, and Star.
  - Live follower simulation resting directly on the rotating cam profile.
- **Comprehensive Machine Elements**:
  - Involute toothed gears with automatic mathematical phase alignment.
  - Intermittent motion Geneva drives with circular locking dwell arcs.
  - Open and crossed belt and stepped pulley drives.
  - Prismatic linear sliders with arbitrary orientation angles.
  - Helical springs with Hooke's law elastic potential and harmonic oscillation.
  - Rigid orthogonal bell-cranks for right-angle force transmission.
- **Deterministic 1800-Frame Cyclic Timeline**:
  - Frame-by-frame stepping forward and backward.
  - Bidirectional time scrubbing.
  - Automatic periodic loop detection and cached replay.
- **Programmatic API for AI Agents**: Full headless or browser automation via `window.LinksimAPI`.

---

## Example Mechanical Presets

Linksim includes 14 curated, Grashof-compliant mechanical presets:

1. **Four-Bar Linkage**: Fundamental Grashof crank-rocker mechanism demonstrating continuous rotary-to-oscillating motion and coupler curves.
2. **Slider-Crank Engine**: Inline internal combustion engine layout with rotating crankshaft, connecting rod, and crosshead piston.
3. **Chebyshev Straight-Line Linkage**: Cognate linkage generating near-perfect linear motion without guide rails.
4. **Klann Walker Leg**: Mechanical leg linkage mimicking planar insect and animal walking strides with a flat stance phase and high swinging step.
5. **Theo Jansen Strandbeest Leg**: Kinetic 11-rod linkage with exact proportions producing the famous stepping loop.
6. **Geared Bell-Crank**: Motor-driven pinion and gear with eccentric pin driving a 90-degree bell crank and vertical piston.
7. **Compound Gear Train**: Multi-stage speed reduction and torque multiplication using compound intermediate gears.
8. **Geneva Drive (4-Slot)**: Precision intermittent motion indexing mechanism with drive pin and locking dwell arc.
9. **Cam & Valve Follower**: Rotating teardrop cam lifting a roller follower against a stiff helical return spring.
10. **Belt & Pulley Transmission**: Stepped open and crossed belt drives with direction reversal.
11. **Interactive Gearbox**: Multi-speed transmission with a movable shift lever that dynamically meshes 1st gear, Neutral, and 2nd gear.
12. **Clock Escapement**: Rotating ratchet escape wheel driving a rocking pallet anchor and pendulum, stepping one tooth per tick.
13. **Over-Center Toggle Clamp**: Bistable clamp snapping into a rigid locked state when pushed past collinear dead-center.
14. **Mechanism Gallery**: Six independent mechanisms (slider-crank, gear train, cam follower, oscillator, belt drive, and 4-bar) operating synchronously.

---

## Controls and Shortcuts

| Action | Control / Shortcut |
| :--- | :--- |
| **Play / Pause** | `Space` |
| **Pan Canvas** | Drag empty space, Middle-drag, or Two-finger drag |
| **Zoom** | Mouse wheel or Pinch gesture |
| **Connect Rod** | Click & drag from node to another node |
| **Context Menu** | Right-click or Touch Long-press |
| **Inspect Properties** | Double-click element or Context Menu -> Configure |
| **Select / Move** | `V` |
| **Add Pin** | `P` |
| **Add Joint / Node** | `J` or `N` |
| **Add Rod** | `R` |
| **Add Slider** | `S` |
| **Add Gear** | `G` |
| **Add Motor** | `M` |
| **Add Spring** | Context menu on node or toolbar |
| **Custom Cam Designer** | Context menu on node -> Cam Designer |
| **Delete Element** | `Delete` or `Backspace` |
| **Undo** | `Ctrl + Z` |
| **Step Backward / Forward** | `[` / `]` |

---

## Programmatic API (`window.LinksimAPI`)

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

---

## Testing & Local Execution

```bash
# Run all automated test suites
node tests/test-presets-rigidity.js
node tests/test-physics-rigidity.js
node tests/test-physics.js
node tests/test-api.js
node tests/test-ui-menu.js

# Launch local HTTP server
npx serve .
```
