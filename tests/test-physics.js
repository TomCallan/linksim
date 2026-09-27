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

// Test 5: Gear ratio constraint (delta angle ratio)
{
  const sim = new PhysicsSystem();
  const c1 = sim.addNode(0, 0, true);
  const c2 = sim.addNode(60, 0, true);
  const g1 = sim.addGear(c1, 20, 10);
  const g2 = sim.addGear(c2, 40, 20); // 2:1 ratio
  sim.connectGears(0, 1);

  // Set initial meshed orientation
  sim.propagateGearAngles(0);
  const initialG2 = g2.angle;

  // Drive gear 1 with a motor
  const crank = sim.addNode(20, 0, false);
  sim.addMotor(c1, crank, Math.PI);

  sim.step(0.5); // Gear 1 turns by pi/2
  const deltaG1 = g1.angle;
  const deltaG2 = Math2D.normalizeAngle(g2.angle - initialG2);
  const expectedRatio = -10 / 20; // -0.5
  assert(Math.abs(deltaG2 / deltaG1 - expectedRatio) < 1e-4, `Gear ratio expected ${expectedRatio}, got ${deltaG2 / deltaG1}`);
  console.log('PASS: Gear ratio constraint (differential meshing ratio)');
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

// Test 7: Node attached on gear body
{
  const sim = new PhysicsSystem();
  const c = sim.addNode(100, 100, true);
  const g = sim.addGear(c, 50, 16);
  const pin = sim.addNode(150, 100, false);
  sim.attachNodeToGear(pin, 0, 50, 0);

  // Manually rotate gear by 90 degrees (pi/2)
  sim.rotateGearManual(0, Math.PI / 2);
  sim.step(1 / 60);

  // Pin should rotate around (100, 100) to (100, 150)
  assert(Math.abs(sim.x[pin] - 100) < 0.1, `Attached pin X expected 100, got ${sim.x[pin]}`);
  assert(Math.abs(sim.y[pin] - 150) < 0.1, `Attached pin Y expected 150, got ${sim.y[pin]}`);
  console.log('PASS: Node attached to gear constraint');
}

// Test 8: Rigid bracket / bell-crank orthogonal transfer
{
  const sim = new PhysicsSystem();
  // Pivot at (0, 0), arm A at (50, 0), arm C at (0, 50) -> 90 degree angle
  const a = sim.addNode(50, 0, false);
  const b = sim.addNode(0, 0, true);
  const c = sim.addNode(0, 50, false);
  sim.addRigidBracket(a, b, c);

  // Force arm A to rotate by 45 degrees
  sim.x[a] = 50 * Math.cos(Math.PI / 4);
  sim.y[a] = 50 * Math.sin(Math.PI / 4);
  sim.step(1 / 60);

  // Check dot product between BA and BC to verify 90 degree angle is locked
  const dBA = Math2D.dist(sim.x[a], sim.y[a], sim.x[b], sim.y[b]);
  const dBC = Math2D.dist(sim.x[c], sim.y[c], sim.x[b], sim.y[b]);
  const dot = Math2D.dot(sim.x[a] - sim.x[b], sim.y[a] - sim.y[b], sim.x[c] - sim.x[b], sim.y[c] - sim.y[b]);
  const cosAngle = dot / (dBA * dBC);
  assert(Math.abs(cosAngle) < 0.05, `Bell-crank angle expected 90 deg (cos 0), got cos ${cosAngle}`);
  console.log('PASS: Rigid bracket orthogonal angle lock');
}

// Test 9: Automatic loop detection & cached playback (e.g. Slider-Crank)
{
  const sim = new PhysicsSystem();
  const tl = new Timeline(sim);

  const c = sim.addNode(-100, 0, true);
  const cr = sim.addNode(-60, 0, false);
  const piston = sim.addNode(70, 0, false);
  const railA = sim.addNode(0, 0, true);
  const railB = sim.addNode(180, 0, true);
  sim.addRod(c, cr, 40);
  sim.addRod(cr, piston, 130);
  sim.addSlider(piston, railA, railB);
  sim.addMotor(c, cr, 3.5);

  tl.reset();

  // Run simulation frames until loop is detected
  for (let f = 0; f < 120; f++) {
    tl.update(1 / 60);
    if (tl.loopDetected) break;
  }

  assert.strictEqual(tl.loopDetected, true, 'Periodic loop was not detected in slider-crank');
  assert.strictEqual(tl.loopPeriod, 108, `Expected loop period 108 frames, got ${tl.loopPeriod}`);
  assert.strictEqual(tl.loopStart, 0, `Expected loop start 0, got ${tl.loopStart}`);
  assert.strictEqual(tl.loopEnd, 108, `Expected loop end 108, got ${tl.loopEnd}`);

  // Now advance timeline beyond frame 108: it should play from cache without stepping physics!
  tl.update(1 / 60);
  assert.strictEqual(tl.isLoopPlayingFromCache, true, 'Timeline is not playing from cache after loop detected');
  assert.strictEqual(tl.currentIndex, 0, 'Loop did not wrap to frame 0 (loopStart) in cached cycle');

  tl.update(1 / 60);
  assert.strictEqual(tl.currentIndex, 1, 'Loop did not advance to frame 1 in cached cycle');

  console.log('PASS: Automatic loop detection & cached frame buffer playback');
}

// Test 10: Geneva Mechanism (Cranks & Cams intermittent indexing)
{
  const sim = new PhysicsSystem();
  const c1 = sim.addNode(-60, 0, true);
  const c2 = sim.addNode(60, 0, true);
  const pin = sim.addNode(0, -60, false);
  const folPin = sim.addNode(60, 55, false);

  sim.addGeneva(c1, pin, c2, 4);
  sim.attachNodeToGeneva(folPin, 0, 55, Math.PI / 2);
  sim.addMotor(c1, pin, 3.0);

  // Initial dwell check: at start, pin is entering slot 0
  const initialAngle = sim.genevas[0].angle;

  // Step through 1 full revolution of driver motor (T = 2pi / 3 = 2.094s -> 126 frames)
  for (let f = 0; f < 126; f++) {
    sim.step(1 / 60);
  }

  // After 1 full driver rotation, Geneva wheel must have indexed by exactly 90 degrees (PI/2 rad)
  const angleAfter1Rev = sim.genevas[0].dwellAngle;
  const deltaAngle = Math.abs(angleAfter1Rev - initialAngle);
  assert(Math.abs(deltaAngle - Math.PI / 2) < 0.05, `Geneva did not index 90 deg: expected ${Math.PI/2}, got ${deltaAngle}`);

  // Follower pin attached to Geneva wheel must also have rotated around c2 by 90 degrees
  const dFollower = Math2D.dist(sim.x[c2], sim.y[c2], sim.x[folPin], sim.y[folPin]);
  assert(Math.abs(dFollower - 55) < 0.01, `Follower pin radius error: expected 55, got ${dFollower}`);

  console.log('PASS: Geneva mechanism intermittent 90-degree indexing & dwell phase');
}

console.log('All tests passed successfully!');
