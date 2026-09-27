# Linksim Roadmap & TODO

## Completed Milestones
- [x] Complete UI modernization with single-window canvas layout.
- [x] Sub-stepped XPBD physics solver with zero-stretch rigid rods.
- [x] Full kinematic consistency: active motor cranks and gear pins treated as infinite mass during constraint solve.
- [x] Non-destructive mouse dragging with pre-solve target attraction.
- [x] Radial context menu centered on mouse cursor.
- [x] Interactive vector cam profile designer with freehand sculpting and handle editing.
- [x] 14 rebuilt, Grashof-compliant mechanical presets with on-canvas explanatory annotations.
- [x] Dynamic gear meshing on sliders for manual transmissions.
- [x] Intermittent motion Geneva mechanism with locking dwell arcs.
- [x] Clock anchor escapement with ratchet profile and physical stepping.
- [x] Over-center toggle clamp with bistable snap-action lock.
- [x] Deterministic 1800-frame cyclic snapshot buffer and periodic loop caching.
- [x] Programmatic API (`window.LinksimAPI`) for automated testing and AI agent operation.
- [x] Automated test suite with 63 tests covering physics, rigidity, presets, API, and responsive UI.
- [x] Automated deployment via GitHub Pages.
- [x] Reactive multi-tier layout for top and bottom bars across all viewport widths with zero horizontal scrollbars.
- [x] Clean browser-scope script loading with complete UMD compatibility.

## Upcoming Roadmap

### 1. Fixed Terrain & Collision Obstacles for Walkers
- [ ] Add static line segments, rectangular platforms, and terrain polyline obstacles.
- [ ] Implement non-penetration point-to-segment contact constraints with friction.
- [ ] Enable walking mechanisms (Klann walker, Theo Jansen Strandbeest) to walk across physical ground surfaces.
- [ ] Add ground reaction force telemetry and visual contact normals.

### 2. Multi-Leg Articulation & Kinematic Bodies
- [ ] Support multi-leg frames (e.g. 4-leg or 6-leg paired walkers with 180-degree or 120-degree crank phase offsets).
- [ ] Chassis body node with aggregate center of mass and gravity stabilization.

### 3. Dynamic Belt Tensioners & Belt Compliance
- [ ] Add optional elastic compliance for rubber belts with stretch under heavy load.
- [ ] Implement spring-loaded idler pulley tensioner arms.

### 4. CAD Export & Digital Fabrication
- [ ] Export mechanism geometry to standard 2D DXF vector format for laser cutting and CNC machining.
- [ ] Export SVG blueprint sheets with dimension annotations and pin hole tolerances.
- [ ] Export 3D printable STL pin and link components.

### 5. Advanced Analysis & Engineering Graphics
- [ ] Live strain energy and stress heatmaps overlaid directly onto links.
- [ ] Real-time kinematic velocity / acceleration hodographs.
- [ ] Torque vs. angle and mechanical advantage indicator charts.
