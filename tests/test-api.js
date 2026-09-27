const assert = require('assert');
const Math2D = require('../js/math2d.js');
const PhysicsSystem = require('../js/physics.js');
const Timeline = require('../js/timeline.js');
const LinksimAPI = require('../js/api.js');

console.log('Running Linksim Programmatic API & Materials Test Suite...');

// Test 1: Programmatic API construction
{
  const sim = new PhysicsSystem();
  const tl = new Timeline(sim);
  const api = LinksimAPI.init(null, sim, tl, null);

  api.build({
    nodes: [
      { x: 0, y: 0, fixed: true },
      { x: 100, y: 0, fixed: false }
    ],
    rods: [
      { a: 0, b: 1, length: 100, material: 'steel' }
    ],
    motors: [
      { centerNode: 0, crankNode: 1, speed: 4.0 }
    ]
  });

  const state = api.getState();
  assert.strictEqual(state.nodes.length, 2);
  assert.strictEqual(state.rods.length, 1);
  assert.strictEqual(state.motors.length, 1);
  console.log('PASS: Programmatic API build() from spec');
}

// Test 2: Diamond Rigid Steel (Zero-Stretch Verification)
{
  const sim = new PhysicsSystem();
  const tl = new Timeline(sim);
  const api = LinksimAPI.init(null, sim, tl, null);

  const n0 = api.addNode(0, 0, true);
  const n1 = api.addNode(120, 0, false);
  api.addRod(n0, n1, 120, 'steel');

  // Apply heavy angular velocity and linear momentum
  sim.vy[n1] = 200;

  for (let s = 0; s < 100; s++) {
    api.step(1 / 60);
    const d = Math2D.dist(sim.x[n0], sim.y[n0], sim.x[n1], sim.y[n1]);
    const stretchPct = Math.abs(d - 120) / 120;
    assert(stretchPct < 0.0001, `Rigid steel stretched! Expected 120, got ${d} (err: ${(stretchPct * 100).toFixed(4)}%)`);
  }
  console.log('PASS: Rigid steel zero-stretch invariance under heavy momentum');
}

// Test 3: Elastic Rubber Material (Compliance verification)
{
  const sim = new PhysicsSystem();
  const tl = new Timeline(sim);
  const api = LinksimAPI.init(null, sim, tl, null);

  const n0 = api.addNode(0, 0, true);
  const n1 = api.addNode(0, 100, false);
  api.addRod(n0, n1, 100, 'rubber');

  // Enable vertical gravity pulling down
  api.setGravity(0, 980);

  for (let s = 0; s < 60; s++) {
    api.step(1 / 60);
  }

  // Under downward gravity, rubber should visibly stretch beyond rest length 100
  const d = Math2D.dist(sim.x[n0], sim.y[n0], sim.x[n1], sim.y[n1]);
  assert(d > 100.5, `Rubber link did not stretch under gravity: length is ${d}`);
  console.log('PASS: Elastic rubber compliance stretches under gravity as expected');
}

// Test 4: getState extraction for AI agents
{
  const sim = new PhysicsSystem();
  const tl = new Timeline(sim);
  const api = LinksimAPI.init(null, sim, tl, null);

  api.addNode(10, 20, true);
  api.addNode(30, 40, false);
  const state = api.getState();

  assert.strictEqual(state.nodes[0].x, 10);
  assert.strictEqual(state.nodes[0].y, 20);
  assert.strictEqual(state.nodes[0].fixed, true);
  assert.strictEqual(state.nodes[1].fixed, false);
  console.log('PASS: getState() returns full telemetry data');
}

// Test 5: Analysis tools & Trace options
{
  const SpriteRenderer = require('../js/sprites.js');
  const sim = new PhysicsSystem();
  const tl = new Timeline(sim);
  const renderer = new SpriteRenderer();
  const api = LinksimAPI.init(null, sim, tl, renderer);

  api.setAnalysisOptions({
    dimensions: true,
    velocities: true,
    traces: true,
    unitScale: 2.0
  });

  assert.strictEqual(renderer.showDimensions, true);
  assert.strictEqual(renderer.showVelocities, true);
  assert.strictEqual(renderer.showTraces, true);
  assert.strictEqual(renderer.unitScale, 2.0);

  renderer.recordTrace(1, 10, 20);
  renderer.recordTrace(1, 12, 25);
  const traces = api.getTraces();
  assert.strictEqual(traces[1].length, 2);

  api.clearTraces();
  assert.strictEqual(Object.keys(api.getTraces()).length, 0);

  console.log('PASS: Analysis tools configuration and trace recording via API');
}

// Test 6: Loop detection & caching API controls
{
  const sim = new PhysicsSystem();
  const tl = new Timeline(sim);
  const api = LinksimAPI.init(null, sim, tl, null);

  const c = api.addNode(0, 0, true);
  const cr = api.addNode(40, 0, false);
  api.addMotor(c, cr, 6.0); // T = 2pi / 6 ~= 1.047s -> ~63 frames

  for (let f = 0; f < 80; f++) {
    tl.update(1 / 60);
    if (tl.loopDetected) break;
  }

  const loopInfo = api.getLoopInfo();
  assert.strictEqual(loopInfo.detected, true);
  assert(loopInfo.period >= 60 && loopInfo.period <= 65, `Expected period ~63 frames, got ${loopInfo.period}`);

  api.enableLoopCache(false);
  assert.strictEqual(api.getLoopInfo().caching, false);

  api.invalidateLoop();
  assert.strictEqual(api.getLoopInfo().detected, false);

  console.log('PASS: Loop detection & caching API controls');
}

// Test 7: Geneva Mechanism declarative building and telemetry via LinksimAPI
{
  const sim = new PhysicsSystem();
  const tl = new Timeline(sim);
  const api = LinksimAPI.init(null, sim, tl, null);

  api.build({
    nodes: [
      { x: -60, y: 0, fixed: true },
      { x: 60, y: 0, fixed: true },
      { x: 0, y: -60, fixed: false }
    ],
    genevas: [
      { driverCenterNode: 0, driverPinNode: 2, genevaCenterNode: 1, slots: 4, angle: 0 }
    ],
    motors: [
      { centerNode: 0, crankNode: 2, speed: 4.0 }
    ]
  });

  const state = api.getState();
  assert.strictEqual(state.genevas.length, 1);
  assert.strictEqual(state.genevas[0].slots, 4);
  assert.strictEqual(state.genevas[0].driverCenterNode, 0);
  assert.strictEqual(state.genevas[0].genevaCenterNode, 1);

  console.log('PASS: Geneva mechanism declarative API building and telemetry');
}

// Test 8: Declarative Power Transmission & Cam API
{
  const api = LinksimAPI.init(null, new PhysicsSystem(), null, null);
  api.build({
    nodes: [
      { id: 0, x: -100, y: 0, fixed: true },
      { id: 1, x: 0, y: 0, fixed: true },
      { id: 2, x: 0, y: 50, fixed: false },
      { id: 3, x: 0, y: 10, fixed: true },
      { id: 4, x: 0, y: 120, fixed: true }
    ],
    pulleys: [
      { nodeId: 0, radius: 25 },
      { nodeId: 1, radius: 50 }
    ],
    belts: [
      { pulleyA: 0, pulleyB: 1, crossed: false }
    ],
    cams: [
      { centerNode: 1, profileType: 'pear', baseRadius: 35, lift: 25 }
    ],
    camContacts: [
      { camIdx: 0, followerNode: 2, rollerRadius: 8 }
    ],
    axles: [
      { targetA: { type: 'pulley', index: 1 }, targetB: { type: 'cam', index: 0 }, ratio: 1.0 }
    ],
    sliders: [
      { node: 2, aNode: 3, bNode: 4, minT: 20, maxT: 90 }
    ],
    motors: [
      { centerNode: 0, crankNode: 0, speed: 4.0 }
    ]
  });

  const state = api.getState();
  assert.strictEqual(state.pulleys.length, 2, 'Pulleys count mismatch');
  assert.strictEqual(state.belts.length, 1, 'Belts count mismatch');
  assert.strictEqual(state.cams.length, 1, 'Cams count mismatch');
  assert.strictEqual(state.camContacts.length, 1, 'CamContacts count mismatch');
  assert.strictEqual(state.axles.length, 1, 'Axles count mismatch');

  // Step simulation: motor turns pulley 0 -> belt turns pulley 1 -> axle turns cam -> cam lifts follower!
  api.step(0.5);

  const stateAfter = api.getState();
  assert(stateAfter.pulleys[0].angle > 0, 'Driver pulley did not rotate');
  assert(stateAfter.pulleys[1].angle > 0, 'Driven pulley did not rotate via belt');
  assert(stateAfter.cams[0].angle > 0, 'Cam did not rotate via axle');
  assert(stateAfter.nodes[2].y > 50, 'Follower node was not pushed by cam contact');

  console.log('PASS: Declarative Cams, Belts, Pulleys, and Axles building and telemetry via LinksimAPI');
}

// Test 9: Declarative Springs in LinksimAPI
{
  const sim = new PhysicsSystem();
  const tl = new Timeline(sim);
  const api = LinksimAPI.init(null, sim, tl, null);

  api.build({
    nodes: [
      { x: 0, y: 0, fixed: true },
      { x: 0, y: 100, fixed: false }
    ],
    springs: [
      { a: 0, b: 1, restLength: 70, stiffness: 250, damping: 2.0 }
    ]
  });

  const state = api.getState();
  assert.strictEqual(state.springs.length, 1);
  assert.strictEqual(state.springs[0].restLength, 70);
  assert.strictEqual(state.springs[0].stiffness, 250);

  api.step(1 / 60);
  const after = api.getState();
  assert(after.springs[0].force > 0);
  console.log('PASS: Declarative Springs in LinksimAPI build() and getState()');
}

// Test 10: Pin Simplification and Universal Selection in MechanismEditor
{
  const MechanismEditor = require('../js/editor.js');
  const dummyCtx = new Proxy({}, {
    get: (target, prop) => {
      if (prop === 'measureText') return () => ({ width: 10 });
      return () => {};
    },
    set: () => true
  });
  const dummyCanvas = {
    getContext: () => dummyCtx,
    addEventListener: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    width: 800,
    height: 600
  };

  const editor = new MechanismEditor(dummyCanvas);

  // Add ground pin and free joint
  const n0 = editor.addNode(0, 0, true);
  const n1 = editor.addNode(0, 100, false);
  const pinNode = editor.getNodeById(n0);

  // Pin simplification toggle
  assert.strictEqual(!!pinNode.simplified, false);
  pinNode.simplified = true;
  assert.strictEqual(pinNode.simplified, true);

  // Add elements: gear, pulley, cam
  editor.addGear(n0, 40, 16);
  editor.addPulley(n0, 30);
  editor.addCam(n0, 'pear', 35, 20);

  // Add spring between separate nodes
  const n2 = editor.addNode(200, 0, true);
  const n3 = editor.addNode(200, 100, false);
  editor.addSpring(n2, n3, { restLength: 100, stiffness: 150 });

  // Test findElementNear
  const selNode = editor.findElementNear(0, 0);
  assert.strictEqual(selNode.type, 'node');
  assert.strictEqual(selNode.id, n0);

  const selSpring = editor.findElementNear(200, 50);
  assert(selSpring !== null, 'Spring was not found near line');
  assert.strictEqual(selSpring.type, 'spring');

  // Test universal deletion
  editor.selection = { type: 'spring', index: 0 };
  editor.deleteSelection();
  assert.strictEqual(editor.springs.length, 0, 'Spring was not deleted via deleteSelection');

  console.log('PASS: Pin Simplification toggle and Universal Element Selection/Deletion');
}

console.log('All API & Material tests passed successfully!');
