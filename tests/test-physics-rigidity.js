const assert = require('assert');
const Math2D = require('../js/math2d.js');
const PhysicsSystem = require('../js/physics.js');

console.log('Running Linksim Physics Rigidity Test Suite...');

// Test 1: Four-bar linkage driven by high speed motor
{
  const sim = new PhysicsSystem();
  const n0 = sim.addNode(100, 200, true);
  const n1 = sim.addNode(140, 200, false);
  const n2 = sim.addNode(300, 200, true);
  const n3 = sim.addNode(287.5, 50.52174, false);

  sim.addRod(n1, n3, 210);
  sim.addRod(n2, n3, 150);
  sim.addMotor(n0, n1, 10.0); // 10 rad/s high speed

  let maxCouplerStretch = 0;
  let maxRockerStretch = 0;

  for (let frame = 0; frame < 300; frame++) {
    sim.step(1 / 60);

    const dCoupler = Math2D.dist(sim.x[n1], sim.y[n1], sim.x[n3], sim.y[n3]);
    const dRocker = Math2D.dist(sim.x[n2], sim.y[n2], sim.x[n3], sim.y[n3]);

    const sCoupler = Math.abs(dCoupler - 210);
    const sRocker = Math.abs(dRocker - 150);

    if (sCoupler > maxCouplerStretch) maxCouplerStretch = sCoupler;
    if (sRocker > maxRockerStretch) maxRockerStretch = sRocker;
  }

  assert(
    maxCouplerStretch < 0.1,
    `Four-bar coupler rod stretched too much: ${maxCouplerStretch} px (expected < 0.1 px)`
  );
  assert(
    maxRockerStretch < 0.1,
    `Four-bar rocker rod stretched too much: ${maxRockerStretch} px (expected < 0.1 px)`
  );
  console.log('PASS: Four-bar linkage high-speed motor rigidity (max stretch < 0.1 px)');
}

// Test 2: Mouse dragging a free node connected to an anchored rod
{
  const sim = new PhysicsSystem();
  const n0 = sim.addNode(100, 100, true);
  const n1 = sim.addNode(200, 100, false);
  sim.addRod(n0, n1, 100);

  // Mouse drag pulling node n1 far away to (350, 100)
  sim.setMouseDrag(n1, 350, 100);

  for (let frame = 0; frame < 60; frame++) {
    sim.step(1 / 60);

    const d = Math2D.dist(sim.x[n0], sim.y[n0], sim.x[n1], sim.y[n1]);
    const stretch = Math.abs(d - 100);

    assert(
      stretch < 0.01,
      `Anchored rod stretched under mouse drag at frame ${frame}: length ${d}, stretch ${stretch} px (expected < 0.01 px)`
    );
  }

  // Release mouse drag and step again to verify stability
  sim.clearMouseDrag();
  sim.step(1 / 60);
  const dAfter = Math2D.dist(sim.x[n0], sim.y[n0], sim.x[n1], sim.y[n1]);
  assert(
    Math.abs(dAfter - 100) < 0.01,
    `Anchored rod stretched after mouse release: length ${dAfter} px (expected < 0.01 px)`
  );

  console.log('PASS: Mouse drag rod length invariance (stretch < 0.01 px)');
}

// Test 3: Attached pin on rotating gear connected to slider
{
  const sim = new PhysicsSystem();
  const gc = sim.addNode(100, 100, true);
  const gear = sim.addGear(gc, 40, 16);
  const motCrank = sim.addNode(140, 100, false);
  sim.addMotor(gc, motCrank, 10.0);

  const pin = sim.addNode(130, 100, false);
  sim.attachNodeToGear(pin, 0, 30, 0);

  const railA = sim.addNode(0, 200, true);
  const railB = sim.addNode(400, 200, true);
  const slider = sim.addNode(241.8034, 200, false);
  sim.addSlider(slider, railA, railB);

  sim.addRod(pin, slider, 150);

  let maxStretch = 0;
  for (let frame = 0; frame < 300; frame++) {
    sim.step(1 / 60);

    const d = Math2D.dist(sim.x[pin], sim.y[pin], sim.x[slider], sim.y[slider]);
    const stretch = Math.abs(d - 150);
    if (stretch > maxStretch) maxStretch = stretch;
  }

  assert(
    maxStretch < 0.1,
    `Gear-slider rod stretched too much: ${maxStretch} px (expected < 0.1 px)`
  );
  console.log('PASS: Gear attached pin connected to slider rod rigidity (max stretch < 0.1 px)');
}

console.log('All physics rigidity tests passed successfully!');
