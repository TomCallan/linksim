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

console.log('All API & Material tests passed successfully!');
