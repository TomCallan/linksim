# Linksim Modernization Implementation Plan

## Overview
Rebuild Linksim into a high-performance 2D mechanical linkage and physics simulator with 60+ FPS Extended Position-Based Dynamics (XPBD), pins, sliders, gears, motors, timeline playback (play, pause, step, scrub), interactive dual-canvas editor, and procedural data-driven mechanical sprites.

## File Structure & Responsibilities
- `js/math2d.js`: Fast vector math utilities and matrix/rotation helpers designed for zero-allocation performance.
- `js/physics.js`: High-performance XPBD physics solver with sub-stepping, distance rods, fixed pins, prismatic slider rails, gear ratio constraints, motors, and collision-free relaxation.
- `js/timeline.js`: Playback engine with ring buffer snapshotting, play/pause, step forward/backward, scrub timeline, and speed multiplier.
- `js/sprites.js`: Data-driven 2D procedural mechanical renderer: capsule linkages with bushings, sliding piston sleeves, toothed gear disks, mounting brackets, and dynamic stress/speed visual indicators.
- `js/editor.js`: Interactive canvas controller for placing nodes, pins, rods, sliders, gears, and motors, with dragging, snapping, selection, and mechanism presets.
- `js/app.js`: Main application entry point uniting dual canvases, requestAnimationFrame game loop, and UI controls.
- `index.html`: Modernized UI with dual canvas layout, toolbar buttons, playback scrubber, speed controls, and preset mechanisms.
- `tests/test-physics.js`: Node.js test suite verifying constraint invariance, slider colinearity, gear ratio coupling, and playback history determinism.

## Implementation Tasks

### Task 1: Zero-Allocation 2D Math & Geometry (`js/math2d.js`)
- Implement 2D vector primitives, dot product, cross product, projection, distance, line segment projection, and rotation helpers.
- Test in Node.js.

### Task 2: XPBD Physics Engine (`js/physics.js`)
- Implement particle state arrays ($x, y, x_0, y_0, v_x, v_y, w$).
- Implement constraints:
  - DistanceConstraint (rigid rods)
  - PinConstraint (fixed ground anchors)
  - SliderConstraint (prismatic rails with stroke limits)
  - GearConstraint (angular coupling between rotating wheels)
  - MotorDriver (constant/variable angular velocity driver)
- Implement XPBD sub-step loop with Symplectic Euler integration and velocity damping.
- Test in Node.js test runner (`tests/test-physics.js`).

### Task 3: Timeline & Playback Engine (`js/timeline.js`)
- Implement cyclic ring buffer storing full state snapshots (positions, velocities, angles).
- Implement playback controller: Play, Pause, StepForward, StepBackward, ScrubTo(index), Reset.
- Verify deterministic scrubbing in `tests/test-physics.js`.

### Task 4: Dynamic 2D Mechanical Sprites (`js/sprites.js`)
- Procedural capsule links with metallic bushings and stress coloring.
- Prismatic slider sleeves, guides, and dynamic sliding piston heads.
- Toothed gear disks with pitch circles, teeth count, hub, and animated meshing.
- Ground mounting brackets and anchor stands with diagonal mechanical hatching.

### Task 5: Editor & Interaction Engine (`js/editor.js`)
- Left canvas blueprint editor: Select, Add Pin, Add Node, Add Rod, Add Slider, Add Gear, Add Motor, Delete.
- Interactive dragging, hover snapping to joints/nodes.
- Mechanism presets: Chebyshev straight-line, Slider-Crank / Piston Engine, 4-bar linkage, Klann walker, and Gear Train.

### Task 6: UI, Application Integration & requestAnimationFrame Loop (`js/app.js`, `index.html`)
- Integrate dual canvases with `requestAnimationFrame`.
- Wire playback timeline slider and controls.
- Wire preset selector, tool buttons, speed slider, and status indicators.
- Verification and end-to-end testing.
