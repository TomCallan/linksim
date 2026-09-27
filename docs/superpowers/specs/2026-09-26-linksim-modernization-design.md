# Linksim Modernization & Physics Simulator Design Specification

## 1. Overview
Linksim is upgraded from a 30 FPS geometric circle-intersection prototype into a high-performance 2D mechanical linkage and physics simulator running at 60+ FPS via Extended Position-Based Dynamics (XPBD). The architecture supports fixed pins, rigid rods, prismatic sliders, meshed gears, angular motors, interactive editing, time-stepping playback with scrubbable history, and procedural data-driven mechanical sprites.

## 2. Architecture & Performance
### 2.1 Solver & Simulation Loop
* **Engine Type:** XPBD (Extended Position-Based Dynamics) with Symplectic Euler integration.
* **Rendering & Execution:** Driven by `window.requestAnimationFrame()`. Decoupled fixed timestep ($\Delta t = 1/60$ s) with $N = 10 \sim 15$ sub-steps per frame ($h = \Delta t / N$).
* **Zero-Allocation Hot Loop:** Particle coordinates ($x, y$), previous coordinates ($x_0, y_0$), velocities ($v_x, v_y$), and inverse masses ($w$) are maintained in flat typed arrays or continuous buffers, eliminating garbage collection pauses.
* **Singularity & Deadlock Immunity:** XPBD gracefully relaxes impossible geometry under stress without throwing `NaN` or crashing.

### 2.2 Mechanical Constraints
1. **Distance Constraint (Rods / Rigid Bars):**
   Maintains distance $L$ between node pairs with zero compliance ($\alpha = 0$):
   $$C(p_1, p_2) = |p_1 - p_2| - L = 0$$
2. **Anchor Constraint (Fixed Ground Pins):**
   Fixed nodes have inverse mass $w = 0$, holding them static in world space while transmitting reactions.
3. **Prismatic / Slider Constraint (Pistons / Linear Rails):**
   Constrains a slider node to translate along a guide axis defined by two anchor/rail nodes $(A, B)$, projecting deviation perpendicular to the axis to zero:
   $$C_{\text{slider}}(p_s) = (p_s - A) \times \hat{u}_{AB} = 0$$
   Optional min/max stops clamp displacement along the rail vector.
4. **Gear Ratio Constraint:**
   Couples rotational angles $\theta_1, \theta_2$ of two gears centered at pivot nodes $p_1, p_2$ with pitch radii $R_1, R_2$:
   $$\Delta \theta_2 = -\frac{R_1}{R_2} \Delta \theta_1$$
5. **Rotational Motor:**
   Actuates a designated crank node at target angular velocity $\omega$ around an anchor pin:
   $$\theta_{k+1} = \theta_k + \omega \Delta t$$
   $$p_{\text{crank}} = p_{\text{center}} + R (\cos\theta_{k+1}, \sin\theta_{k+1})$$

### 2.3 Time-Stepping Playback & History Ring Buffer
* **State Snapshotting:** The simulator records states into a cyclic ring buffer (storing up to 1,800 frames / 30 seconds at 60 FPS).
* **Playback Controls:**
  * **Play / Pause:** Toggle live physics simulation vs frozen state.
  * **Step Forward / Step Backward:** Advance or rewind simulation by single discrete timesteps ($h$).
  * **Time Scrubber Slider:** Scrub continuously back and forth across recorded history.
  * **Simulation Speed:** Adjust simulation rate (0.25x, 0.5x, 1x, 2x).
  * **Reset:** Restore initial assembly state.

## 3. UI Layout & Tooling
The dual-canvas layout is preserved:
* **Left Canvas (Editor Blueprint):**
  * Interactive canvas for building, modifying, and assembling mechanisms.
  * Toolbar above editor:
    * `Select / Move`: Drag existing nodes, pins, sliders, and gears.
    * `Add Pin`: Place anchored pivot.
    * `Add Node`: Place free joint.
    * `Add Rod`: Connect two nodes with a rigid link.
    * `Add Slider`: Place linear rail and sliding carriage/piston.
    * `Add Gear`: Place gear wheel with radius and tooth pitch.
    * `Add Motor`: Attach rotational drive to a pin and crank node.
    * `Delete`: Remove selected item.
    * `Clear`: Reset workspace.
    * `Examples`: Dropdown with curated mechanisms:
      1. Chebyshev & Peaucellier straight-line linkages
      2. Slider-Crank (Piston Engine)
      3. Klann 6-bar walking mechanism
      4. Jansen Strandbeest leg linkage
      5. Compound & Epicyclic Gear Train
* **Right Canvas (Live Simulation & Viewer):**
  * Displays running XPBD simulation with real-time physics, dynamic inertia, and smooth motion.
  * Interactive live dragging: users can grab and pull any node in real-time while the simulation runs.
  * Playback controls bar positioned immediately beneath the simulation canvas (Play/Pause, Step Back, Step Forward, Time Slider, Speed selector).

## 4. 2D Dynamic Data-Driven Sprites
Visual rendering separates schematic geometry from rendered presentation:
* **Capsule Linkages:** Rigid rods rendered as rounded structural links with circular metallic bushings and centerlines.
* **Piston & Cylinders:** Sliders render as hollow guide cylinders/sleeves with a dynamic rectangular piston block sliding inside.
* **Toothed Gears:** Procedurally drawn involute/trapezoidal teeth rotating in real time with mesh alignment, pitch circle guides, and center keyway spokes.
* **Pivot Ground Brackets:** Grounded pins render with diagonal hatching/truss anchor stands indicating mechanical earth.
* **Dynamic State Feedback:** Visual stress shading (color shift from neutral steel blue to amber/red under high constraint loads) and motion trajectory trails.

## 5. Modern Data Schema (JSON)
```json
{
  "version": "2.0",
  "nodes": [
    {"id": 0, "x": 0, "y": 0, "fixed": true, "type": "pin"},
    {"id": 1, "x": 50, "y": 0, "fixed": false, "type": "joint"}
  ],
  "links": [
    {"type": "rod", "from": 0, "to": 1, "length": 50, "style": {"width": 10, "color": "#4a90e2"}}
  ],
  "sliders": [
    {"node": 2, "railFrom": [0, -100], "railTo": [200, -100], "min": 0, "max": 200}
  ],
  "gears": [
    {"center": 0, "radius": 40, "teeth": 16, "meshWith": [1]}
  ],
  "motors": [
    {"center": 0, "crank": 1, "speed": 2.0}
  ]
}
```

## 6. Testing & Verification Strategy
1. **Constraint Invariance:** Distance constraints hold within $0.01\%$ tolerance under dynamic rotation.
2. **Slider Invariance:** Slider node remains colinear with rail axis under heavy loads.
3. **Gear Meshing:** Gear angular displacement ratios match pitch radii without drift.
4. **Playback Determinism:** Scrubbing backward and stepping forward restores identical coordinates.
5. **Frame Rate Benchmark:** 60 FPS verified across mechanisms with 50+ nodes in `requestAnimationFrame`.
