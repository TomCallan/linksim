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

// Test 11: Physical Cam-Follower Contact Simulation
{
  const sim = new PhysicsSystem();
  // Cam center at (0, 0), Follower starts above cam at (0, 38)
  const camCenter = sim.addNode(0, 0, true);
  const folNode = sim.addNode(0, 38, false, 1.0);
  const guideA = sim.addNode(0, 10, true);
  const guideB = sim.addNode(0, 120, true);

  // Vertical slider rail for follower
  sim.addSlider(folNode, guideA, guideB, 20, 100);

  // Pear cam: baseRadius 30, lift 20, apex at 0 rad. Follower roller radius 8
  const cam = sim.addCam(camCenter, 'pear', 30, 20, { lobeAngle: 60 });
  const contact = sim.addCamContact(0, folNode, 8);

  // Gravity pulls follower downward onto cam
  sim.gravityY = 500;

  // Motor drives cam at 3.0 rad/s
  sim.addMotor(camCenter, camCenter, 3.0);

  // 1. Initial position check: at angle 0, lobe apex is pointing along +x axis (0 rad).
  // Follower is at angle +pi/2 (90 deg) relative to cam center, which is in the dwell base circle (baseRadius = 30)
  // Distance should be baseRadius + rollerRadius = 30 + 8 = 38
  sim.step(1 / 60);
  assert(Math.abs(sim.y[folNode] - 38) < 0.5, `Follower not at base circle: expected 38, got ${sim.y[folNode]}`);

  // 2. Rotate cam so apex aligns with follower at +pi/2 (quarter turn = pi / (2 * 3.0) s = 0.5236s -> ~32 frames)
  let maxLift = 0;
  for (let f = 0; f < 35; f++) {
    sim.step(1 / 60);
    if (sim.y[folNode] > maxLift) maxLift = sim.y[folNode];
  }

  // Peak lift should reach baseRadius + lift + rollerRadius = 30 + 20 + 8 = 58
  assert(maxLift >= 57.5, `Cam did not physically push follower to peak lift: expected >= 57.5, got ${maxLift}`);
  assert(contact.normalForce >= 0, 'Cam contact normal force should be positive');

  console.log('PASS: Physical cam-follower XPBD contact & lift transmission');
}

// Test 12: Belts & Pulleys Speed Reduction & Rotation Reversal
{
  const sim = new PhysicsSystem();
  const n0 = sim.addNode(0, 0, true);
  const n1 = sim.addNode(100, 0, true);
  const n2 = sim.addNode(200, 0, true);
  const n3 = sim.addNode(300, 0, true);

  // Open belt: Pulley 0 (r=20) to Pulley 1 (r=40) -> 2:1 reduction, same direction
  const p0 = sim.addPulley(n0, 20);
  const p1 = sim.addPulley(n1, 40);
  sim.addBelt(0, 1, { crossed: false });

  // Crossed belt: Pulley 2 (r=30) to Pulley 3 (r=30) -> 1:1, opposite direction
  const p2 = sim.addPulley(n2, 30);
  const p3 = sim.addPulley(n3, 30);
  sim.addBelt(2, 3, { crossed: true });

  // Motor drives Pulley 0 at 4.0 rad/s and Pulley 2 at 2.0 rad/s
  sim.addMotor(n0, n0, 4.0);
  sim.addMotor(n2, n2, 2.0);

  sim.step(1.0); // 1 second

  // Open belt check: p1 should have rotated by 4.0 * 1.0 * (20 / 40) = 2.0 rad
  assert(Math.abs(p1.angle - 2.0) < 0.05, `Open belt speed error: expected 2.0, got ${p1.angle}`);

  // Crossed belt check: p3 should have rotated by 2.0 * 1.0 * (-1.0) = -2.0 rad
  assert(Math.abs(p3.angle - (-2.0)) < 0.05, `Crossed belt reversal error: expected -2.0, got ${p3.angle}`);

  console.log('PASS: Belts & Pulleys velocity ratio & crossed belt reversal');
}

// Test 13: Axles & Compound Power Transmission (Motor -> Pulley -> Belt -> Pulley -> Axle -> Gear -> Meshed Gear)
{
  const sim = new PhysicsSystem();
  const nDriver = sim.addNode(-100, 0, true);
  const nJackshaft = sim.addNode(0, 0, true);
  const nDriven = sim.addNode(60, 0, true);

  // Motor on driver
  sim.addMotor(nDriver, nDriver, 4.0);

  // Pulley 0 on driver (r=20)
  sim.addPulley(nDriver, 20);
  // Pulley 1 on jackshaft (r=40)
  sim.addPulley(nJackshaft, 40);
  // Belt between them
  sim.addBelt(0, 1);

  // Gear 0 on jackshaft (r=25, 10 teeth)
  sim.addGear(nJackshaft, 25, 10);
  // Gear 1 on driven (r=35, 14 teeth)
  sim.addGear(nDriven, 35, 14);
  sim.connectGears(0, 1);

  // Axle couples Pulley 1 and Gear 0 on the shared jackshaft pin!
  sim.addAxle({ type: 'pulley', index: 1 }, { type: 'gear', index: 0 }, { ratio: 1.0 });

  sim.step(1.0);

  // Pulley 1 should rotate at 4.0 * (20 / 40) = 2.0 rad
  assert(Math.abs(sim.pulleys[1].angle - 2.0) < 0.05, `Jackshaft pulley angle error: expected 2.0, got ${sim.pulleys[1].angle}`);

  // Gear 0 on same axle must match Pulley 1 rotation exactly!
  assert(Math.abs(sim.gears[0].angle - 2.0) < 0.05, `Axle torque transfer error: expected 2.0, got ${sim.gears[0].angle}`);

  // Gear 1 meshed with Gear 0 must be driven by gear ratio!
  assert(sim.gears[1].angle !== 0, 'Driven gear was not rotated through compound transmission');

  console.log('PASS: Axles & Compound Power Transmission (Pulley -> Belt -> Axle -> Gear train)');
}

// Test 14: Helical Spring XPBD Elastic Restoring Force & Dynamic Oscillation
{
  const sim = new PhysicsSystem();
  const n0 = sim.addNode(0, 0, true);
  const n1 = sim.addNode(0, 100, false, 1.0); // 1kg mass
  // Rest length 80, stiffness 200 => stretched by 20px initially
  const spring = sim.addSpring(n0, n1, 80, 200, { damping: 0.1 });

  // In zero gravity, spring must pull node 1 towards rest length (y=80)
  for (let s = 0; s < 30; s++) {
    sim.step(1 / 60);
  }
  assert(sim.y[n1] < 100, `Spring did not pull mass towards rest length: y is ${sim.y[n1]}`);
  assert(spring.force > 0, `Spring force was not computed: force is ${spring.force}`);
  console.log('PASS: Helical Spring XPBD Elastic Restoring Force & Dynamic Oscillation');
}

// Test 15: Custom Vector Polygon Cam Profile & Follower XPBD Push
{
  const sim = new PhysicsSystem();
  const nCam = sim.addNode(0, 0, true);
  const nFollower = sim.addNode(0, 40, false, 1.0); // Follower at y=40

  // Create custom polygon triangle cam: vertex at [0, 60], bottom at [-30, -20], [30, -20]
  const customPoints = [[-30, -20], [0, 60], [30, -20]];
  sim.addCam(nCam, 'custom', 30, 30, { points: customPoints });
  sim.addCamContact(0, nFollower, 6);

  sim.step(1 / 60);
  assert(sim.y[nFollower] >= 45, `Custom cam follower was not pushed: y is ${sim.y[nFollower]}`);
  console.log('PASS: Custom Vector Polygon Cam Profile & Follower XPBD Push');
}

console.log('All tests passed successfully!');
