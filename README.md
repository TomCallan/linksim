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
- **Reactive Multi-Tier Responsive UI**:
  - Adaptive header that cleanly wraps the 14 blueprint tools into a centered secondary tier on screens <= 1150px, ensuring every tool remains accessible without clipping.
  - Two-tier responsive playback bar with a wide scrubbing slider; display options live on elements via the right-click menu.
  - Zero horizontal scrollbars with real-time `ResizeObserver` canvas height auto-fitting.
- **Programmatic API for AI Agents**: Full headless or browser automation via `window.LinksimAPI`.

---

## Interaction Sandbox Preset

Linksim ships with a single **Interaction Sandbox**: one canvas containing independent stations, each annotated with its expected result. Press Play, then drag dark joint nodes, pink knobs, and free beam ends to feel how each element behaves. Drag a gear rim in Simulate mode to turn it by hand.

Right-click any element for a grouped menu: per-element overlays (**Trace** / **Velocity** on a node, **Stress** / **Dims** on a beam), attach/connect actions, and a **World** section for Gravity, Loop Cache, and global Clean Pins. Hovering shows a tooltip naming what you are about to select; clicking a motor's motion-arrow ring selects that motor. Build belts with the **Belt** tool (`B`): click pulley A, then pulley B (hold `Shift` for a crossed belt).

1. **Four-Bar Linkage**: crank-rocker, continuous rotary input to oscillating rocker output.
2. **Slider-Crank**: crank rotation becomes back-and-forth piston travel on a rail.
3. **Sliders, Three Directions**: vertical free travel, horizontal travel with end-stops, and a 45-degree rail with friction.
4. **Springs and Mass**: identical stretch with different stiffness (slow vs fast) and different masses (light vs heavy).
5. **Cam and Roller Follower**: rotating pear cam lifts a roller pressed by a return spring.
6. **Gears and Axle**: multi-stage gear train with direction reversal, an orbiting crankpin, and an axle-coupled output gear.
7. **Geneva Indexer**: driver pin advances a 4-slot wheel 90 degrees per turn, then dwells.
8. **Belts and Pulleys**: open belt keeps direction, crossed belt reverses it, radii set the ratio.
9. **Lever / Bell-Crank**: rigid arm swings about a pivot, driven by dragging the pink knob.
10. **Over-Center Toggle**: drag the knee past the center line and the spring snaps it to the opposite side.
11. **Orientation-Locked Beams**: beams hold horizontal, vertical, or a fixed angle under drag.
12. **Motor Torque Limit**: a limited-torque motor slows and can stall against a spring load.

Ground pins render as clean points by default (global **Clean Pins** and per-node simplify live in the right-click menu), and the view auto-fits the whole sandbox on load.

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
