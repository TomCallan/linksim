const assert = require('assert');
const Math2D = require('../js/math2d.js');
const PhysicsSystem = require('../js/physics.js');
const Timeline = require('../js/timeline.js');

console.log('Running Linksim Physics & Timeline Test Suite...');

// Test 1: Math2D
{
  assert.strictEqual(Math2D.dist(0, 0, 3, 4), 5);
  const out = [];
  Math2D.projectPointOnLine(5, 5, 0, 0, 10, 0, out);
  assert.strictEqual(out[0], 5);
  assert.strictEqual(out[1], 0);
  assert.strictEqual(out[2], 0.5);
  console.log('PASS: Math2D basic operations');
}

// Test 2: Distance constraint rigidity
{
  const sim = new PhysicsSystem();
  const n0 = sim.addNode(0, 0, true);
  const n1 = sim.addNode(100, 0, false);
  sim.addRod(n0, n1, 100);

  // Give n1 initial velocity
  sim.vy[n1] = 50;
  for (let step = 0; step < 60; step++) {
    sim.step(1 / 60);
    const d = Math2D.dist(sim.x[n0], sim.y[n0], sim.x[n1], sim.y[n1]);
    assert(Math.abs(d - 100) < 0.05, `Rod length error: expected 100, got ${d}`);
  }
  console.log('PASS: Distance constraint rigidity under dynamic velocity');
}

// Test 3: Slider / Prismatic constraint
{
  const sim = new PhysicsSystem();
  const a = sim.addNode(0, 50, true);
  const b = sim.addNode(200, 50, true);
  const slider = sim.addNode(50, 50, false);
  sim.addSlider(slider, a, b);

  // Perturb slider off the rail
  sim.y[slider] = 120;
  sim.vy[slider] = 100;
  sim.step(1 / 60);

  assert(Math.abs(sim.y[slider] - 50) < 0.001, `Slider node not constrained to rail y=50: got ${sim.y[slider]}`);
  console.log('PASS: Prismatic slider colinearity constraint');
}

// Test 4: Motor driving crank
{
  const sim = new PhysicsSystem();
  const center = sim.addNode(0, 0, true);
  const crank = sim.addNode(50, 0, false);
  sim.addMotor(center, crank, Math.PI); // 180 deg / sec

  sim.step(1.0); // 1 second = pi radians
  assert(Math.abs(sim.x[crank] - (-50)) < 0.1, `Crank x expected -50, got ${sim.x[crank]}`);
  assert(Math.abs(sim.y[crank] - 0) < 0.1, `Crank y expected 0, got ${sim.y[crank]}`);
  console.log('PASS: Motor kinematics');
}

// Test 5: Gear ratio constraint
{
  const sim = new PhysicsSystem();
  const c1 = sim.addNode(0, 0, true);
  const c2 = sim.addNode(60, 0, true);
  const g1 = sim.addGear(c1, 20, 10);
  const g2 = sim.addGear(c2, 40, 20); // 2:1 ratio
  sim.connectGears(0, 1);

  // Drive gear 1 with a motor
  const crank = sim.addNode(20, 0, false);
  sim.addMotor(c1, crank, Math.PI);

  sim.step(0.5); // Gear 1 turns by pi/2 (90 deg)
  // Gear 2 should rotate by - (20/40) * (pi/2) = -pi/4 (-45 deg)
  const expectedG2Angle = -(20 / 40) * g1.angle;
  assert(Math.abs(g2.angle - expectedG2Angle) < 1e-4, `Gear 2 angle expected ${expectedG2Angle}, got ${g2.angle}`);
  console.log('PASS: Gear ratio constraint');
}

// Test 6: Timeline scrub & restore determinism
{
  const sim = new PhysicsSystem();
  const c = sim.addNode(0, 0, true);
  const p = sim.addNode(50, 0, false);
  sim.addMotor(c, p, 2.0);
  const tl = new Timeline(sim);
  tl.reset();

  // Run 30 steps
  for (let i = 0; i < 30; i++) {
    tl.update(1 / 60);
  }
  const posAt30 = { x: sim.x[p], y: sim.y[p] };

  // Scrub back to frame 10
  tl.scrubTo(10);
  assert(tl.currentIndex === 10);
  assert(Math.abs(sim.x[p] - posAt30.x) > 0.1, 'State did not scrub back to past frame');

  // Scrub forward back to frame 30
  tl.scrubTo(30);
  assert(Math.abs(sim.x[p] - posAt30.x) < 1e-6, 'State restoration at frame 30 failed');
  assert(Math.abs(sim.y[p] - posAt30.y) < 1e-6, 'State restoration at frame 30 failed');
  console.log('PASS: Timeline scrubbing determinism');
}

console.log('All tests passed successfully!');
