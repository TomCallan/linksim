const assert = require('assert');
const Math2D = require('../js/math2d.js');
const PhysicsSystem = require('../js/physics.js');
const MechanismEditor = require('../js/editor.js');

console.log('Running Linksim Preset Geometries & Rigidity Test Suite...');

function findRod(sim, a, b) {
  for (let i = 0; i < sim.rods.length; i++) {
    const r = sim.rods[i];
    if ((r.a === a && r.b === b) || (r.a === b && r.b === a)) return r;
  }
  return null;
}

function simulatePreset(preset, name, frames) {
  const sim = new PhysicsSystem();
  sim.substeps = 30;
  sim.solverIterations = 16;

  for (let i = 0; i < (preset.nodes || []).length; i++) {
    const n = preset.nodes[i];
    sim.addNode(n.x, n.y, n.fixed, n.mass);
  }

  const presetRodIndices = [];
  for (let r = 0; r < (preset.rods || []).length; r++) {
    const rod = preset.rods[r];
    const rodObj = sim.addRod(rod.a, rod.b, rod.length, {
      width: rod.width,
      color: rod.color,
      angleLock: rod.angleLock,
      lockedAngle: rod.lockedAngle
    }, rod.material);
    presetRodIndices.push(sim.rods.indexOf(rodObj));
  }

  if (preset.springs) {
    for (let s = 0; s < preset.springs.length; s++) {
      const spr = preset.springs[s];
      sim.addSpring(spr.a, spr.b, spr.restLength, spr.stiffness, spr);
    }
  }

  if (preset.brackets) {
    for (let b = 0; b < preset.brackets.length; b++) {
      const br = preset.brackets[b];
      const r1 = findRod(sim, br.a, br.b) || sim.addRod(br.a, br.b, undefined, { width: br.width, color: br.color });
      const r2 = findRod(sim, br.b, br.c) || sim.addRod(br.b, br.c, undefined, { width: br.width, color: br.color });
      const crossLen = Math2D.dist(sim.x[br.a], sim.y[br.a], sim.x[br.c], sim.y[br.c]);
      const brace = sim.addRod(br.a, br.c, crossLen, { width: 4, color: 'rgba(99, 102, 241, 0.2)' });
      sim.brackets.push({ a: br.a, b: br.b, c: br.c, braceRod: brace });
    }
  }

  if (preset.sliders) {
    for (let s = 0; s < preset.sliders.length; s++) {
      const sl = preset.sliders[s];
      sim.addSlider(sl.node, sl.aNode, sl.bNode, sl.minT, sl.maxT, sl);
    }
  }

  if (preset.gears) {
    for (let g = 0; g < preset.gears.length; g++) {
      const gear = preset.gears[g];
      const gObj = sim.addGear(gear.centerNode, gear.radius, gear.teeth);
      if (gear.meshWith) gObj.meshWith = gear.meshWith.slice();
    }
  }

  if (preset.genevas) {
    for (let gi = 0; gi < preset.genevas.length; gi++) {
      const gen = preset.genevas[gi];
      sim.addGeneva(gen.driverCenterNode, gen.driverPinNode, gen.genevaCenterNode, gen.slots, {
        initialAngle: gen.angle !== undefined ? gen.angle : 0,
        slotWidth: gen.slotWidth
      });
    }
  }

  if (preset.pulleys) {
    for (let pi = 0; pi < preset.pulleys.length; pi++) {
      const pul = preset.pulleys[pi];
      sim.addPulley(pul.nodeId, pul.radius, pul);
    }
  }

  if (preset.belts) {
    for (let bi = 0; bi < preset.belts.length; bi++) {
      const blt = preset.belts[bi];
      sim.addBelt(blt.pulleyA, blt.pulleyB, blt);
    }
  }

  if (preset.cams) {
    for (let ci = 0; ci < preset.cams.length; ci++) {
      const cam = preset.cams[ci];
      sim.addCam(cam.centerNode, cam.profileType, cam.baseRadius, cam.lift, cam.options);
    }
  }

  if (preset.camContacts) {
    for (let cci = 0; cci < preset.camContacts.length; cci++) {
      const cc = preset.camContacts[cci];
      sim.addCamContact(cc.camIdx, cc.followerNode, cc.rollerRadius, cc);
    }
  }

  if (preset.axles) {
    for (let axi = 0; axi < preset.axles.length; axi++) {
      const ax = preset.axles[axi];
      sim.addAxle(ax.targetA, ax.targetB, ax);
    }
  }

  for (let i = 0; i < (preset.nodes || []).length; i++) {
    const n = preset.nodes[i];
    if (n.parentGear) {
      sim.attachNodeToGear(n.id, n.parentGear.gearIdx, n.parentGear.radius, n.parentGear.angleOffset);
    }
    if (n.parentPulley) {
      sim.attachNodeToPulley(n.id, n.parentPulley.pulleyIdx, n.parentPulley.radius, n.parentPulley.angleOffset);
    }
    if (n.parentCam) {
      sim.attachNodeToCam(n.id, n.parentCam.camIdx, n.parentCam.radius, n.parentCam.angleOffset);
    }
  }

  if (preset.motors) {
    for (let m = 0; m < preset.motors.length; m++) {
      const mot = preset.motors[m];
      sim.addMotor(mot.centerNode, mot.crankNode, mot.speed, mot);
    }
  }

  const numFrames = frames || 300;
  let maxStretch = 0;
  let worstRodInfo = '';

  for (let f = 0; f < numFrames; f++) {
    sim.step(1 / 60);
    for (let r = 0; r < presetRodIndices.length; r++) {
      const rIdx = presetRodIndices[r];
      const rod = sim.rods[rIdx];
      if (rod.compliance > 0) continue;
      const d = Math2D.dist(sim.x[rod.a], sim.y[rod.a], sim.x[rod.b], sim.y[rod.b]);
      const s = Math.abs(d - rod.length);
      if (s > maxStretch) {
        maxStretch = s;
        worstRodInfo = `rod ${r} (${rod.a}->${rod.b}, target ${rod.length.toFixed(1)} px, actual ${d.toFixed(1)} px at frame ${f})`;
      }
    }
  }

  return { maxStretch, worstRodInfo };
}

const presets = [
  'sandbox'
];

let failedCount = 0;

for (const name of presets) {
  const preset = MechanismEditor.Presets[name];
  assert(preset, `Preset ${name} must exist in MechanismEditor.Presets`);
  const result = simulatePreset(preset, name, 300);
  const passed = result.maxStretch < 0.5;
  if (passed) {
    console.log(`PASS: ${name} preset max rod stretch < 0.5 px (${result.maxStretch.toFixed(4)} px)`);
  } else {
    console.log(`FAIL: ${name} preset max rod stretch >= 0.5 px (${result.maxStretch.toFixed(4)} px, ${result.worstRodInfo})`);
    failedCount++;
  }
}

if (failedCount > 0) {
  assert.fail(`${failedCount} presets failed rigidity test with stretch >= 0.5 px`);
} else {
  console.log('All preset rigidity tests passed successfully!');
}
