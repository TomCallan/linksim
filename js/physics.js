/**
 * XPBD (Extended Position-Based Dynamics) 2D Physics & Linkage Solver.
 * High-performance, zero-allocation per frame execution.
 */
(function(root, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    var Math2D = require('./math2d.js');
    module.exports = factory(Math2D);
  } else {
    var cls = factory(root.Math2D);
    root.PhysicsSystem = cls;
    root.Physics = cls;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function(Math2D) {
  'use strict';

  var MAX_NODES = 256;

  var Materials = {
    steel: { key: 'steel', name: 'Rigid Steel', compliance: 0.0, density: 7.8, color: '#3b82f6', width: 12 },
    aluminum: { key: 'aluminum', name: 'Aluminum', compliance: 0.0, density: 2.7, color: '#60a5fa', width: 10 },
    carbon: { key: 'carbon', name: 'Carbon Fiber', compliance: 0.0, density: 1.6, color: '#334155', width: 10 },
    wood: { key: 'wood', name: 'Composite Wood', compliance: 0.0001, density: 0.7, color: '#d97706', width: 14 },
    rubber: { key: 'rubber', name: 'Rubber / Elastic', compliance: 0.008, density: 1.1, color: '#ec4899', width: 8 },
    spring: { key: 'spring', name: 'Coil Spring', compliance: 0.02, density: 1.0, color: '#10b981', width: 8 }
  };

  function PhysicsSystem() {
    this.numNodes = 0;

    // Node state buffers (flat typed arrays for speed & zero GC)
    this.x = new Float64Array(MAX_NODES);
    this.y = new Float64Array(MAX_NODES);
    this.x0 = new Float64Array(MAX_NODES);
    this.y0 = new Float64Array(MAX_NODES);
    this.vx = new Float64Array(MAX_NODES);
    this.vy = new Float64Array(MAX_NODES);
    this.invMass = new Float64Array(MAX_NODES);
    this.isFixed = new Uint8Array(MAX_NODES);
    this.fixedX = new Float64Array(MAX_NODES);
    this.fixedY = new Float64Array(MAX_NODES);

    // Constraints collections
    this.rods = [];          // { a, b, length, width, color, stress, compliance, material }
    this.sliders = [];       // { node, aNode, bNode, minT, maxT, railLength, friction }
    this.gears = [];         // { centerNode, radius, teeth, angle, meshWith: [...] }
    this.motors = [];        // { centerNode, crankNode, speed, radius, angle, active }
    this.brackets = [];      // { a, b, c, width, color }
    this.attachedNodes = []; // { nodeId, gearIdx, radius, angleOffset }
    this.genevas = [];       // { driverCenterNode, driverPinNode, genevaCenterNode, slots, radius, pinRadius, lockRadius, angle, dwellAngle, isEngaged, slotWidth, angularVelocity, contactForce }
    this.attachedGenevaNodes = []; // { nodeId, genevaIdx, radius, angleOffset }

    // Power transmission & Physical Camming
    this.pulleys = [];       // { nodeId, radius, angle, angularVelocity }
    this.belts = [];         // { pulleyA, pulleyB, crossed, compliance, width }
    this.axles = [];         // { targetA: { type, index }, targetB: { type, index } }
    this.cams = [];          // { centerNode, profileType, baseRadius, lift, angle, angularVelocity, options }
    this.camContacts = [];   // { camIdx, followerNode, rollerRadius, compliance, normalForce }
    this.attachedPulleyNodes = []; // { nodeId, pulleyIdx, radius, angleOffset }
    this.attachedCamNodes = [];    // { nodeId, camIdx, radius, angleOffset }
    this.springs = [];             // { a, b, restLength, stiffness, damping, width, color, force }

    // Direct user interaction
    this.mouseDragNode = -1;
    this.mouseDragX = 0;
    this.mouseDragY = 0;
    this.isManualInteracting = false;

    // Simulation settings
    this.gravityX = 0;
    this.gravityY = 0; // Linkages typically operate in horizontal plane by default (set to 980 for vertical)
    this.substeps = 30;
    this.solverIterations = 8;
    this.damping = 0.002;
    this.time = 0;

    // Reusable scratch variables to avoid GC allocations
    this._scratch = new Float64Array(8);
  }

  PhysicsSystem.Materials = Materials;

  PhysicsSystem.prototype.clear = function() {
    this.numNodes = 0;
    this.x.fill(0);
    this.y.fill(0);
    this.x0.fill(0);
    this.y0.fill(0);
    this.vx.fill(0);
    this.vy.fill(0);
    this.invMass.fill(0);
    this.isFixed.fill(0);
    this.fixedX.fill(0);
    this.fixedY.fill(0);

    this.rods = [];
    this.sliders = [];
    this.gears = [];
    this.motors = [];
    this.brackets = [];
    this.attachedNodes = [];
    this.genevas = [];
    this.attachedGenevaNodes = [];
    this.pulleys = [];
    this.belts = [];
    this.axles = [];
    this.cams = [];
    this.camContacts = [];
    this.attachedPulleyNodes = [];
    this.attachedCamNodes = [];
    this.springs = [];
    this.mouseDragNode = -1;
    this.isManualInteracting = false;
    this.time = 0;
  };

  PhysicsSystem.prototype.addNode = function(x, y, fixed, mass) {
    if (this.numNodes >= MAX_NODES) {
      throw new Error('Maximum node limit reached (' + MAX_NODES + ')');
    }
    var id = this.numNodes++;
    this.x[id] = x;
    this.y[id] = y;
    this.x0[id] = x;
    this.y0[id] = y;
    this.vx[id] = 0;
    this.vy[id] = 0;
    this.isFixed[id] = fixed ? 1 : 0;
    this.fixedX[id] = x;
    this.fixedY[id] = y;
    var m = mass || 1.0;
    this.invMass[id] = fixed ? 0.0 : (1.0 / m);
    return id;
  };

  PhysicsSystem.prototype.setFixed = function(id, fixed) {
    this.isFixed[id] = fixed ? 1 : 0;
    this.invMass[id] = fixed ? 0.0 : 1.0;
    this.fixedX[id] = this.x[id];
    this.fixedY[id] = this.y[id];
  };

  PhysicsSystem.prototype.addRod = function(a, b, length, style, materialKey) {
    if (length === undefined || length <= 0) {
      length = Math2D.dist(this.x[a], this.y[a], this.x[b], this.y[b]);
    }
    var mat = Materials[materialKey] || Materials.steel;
    var angleLock = (style && style.angleLock) || 'none';
    var lockedAngle = (style && style.lockedAngle !== undefined) ? style.lockedAngle :
                      (angleLock === 'fixed' ? Math.atan2(this.y[b] - this.y[a], this.x[b] - this.x[a]) : 0);
    var rod = {
      a: a,
      b: b,
      length: length,
      width: (style && style.width) || mat.width || 10,
      color: (style && style.color) || mat.color || '#3b82f6',
      material: materialKey || 'steel',
      compliance: (style && style.compliance !== undefined) ? style.compliance : mat.compliance,
      stress: 0,
      angleLock: angleLock,
      lockedAngle: lockedAngle
    };
    this.rods.push(rod);
    return rod;
  };

  PhysicsSystem.prototype.addRigidBracket = function(a, b, c, width, color) {
    // Rigid triangle with B as pivot apex.
    // Adds rods AB, BC, and internal locking cross-brace AC
    var r1 = this.addRod(a, b, undefined, { width: width || 12, color: color || '#6366f1' });
    var r2 = this.addRod(b, c, undefined, { width: width || 12, color: color || '#6366f1' });
    var crossLen = Math2D.dist(this.x[a], this.y[a], this.x[c], this.y[c]);
    var brace = this.addRod(a, c, crossLen, { width: 4, color: 'rgba(99, 102, 241, 0.2)' });
    var bracket = { a: a, b: b, c: c, width: width || 12, color: color || '#6366f1', braceRod: brace };
    this.brackets.push(bracket);
    return bracket;
  };

  PhysicsSystem.prototype.attachNodeToGear = function(nodeId, gearIdx, radius, angleOffset) {
    var gear = this.gears[gearIdx];
    if (!gear) return;
    var cx = this.x[gear.centerNode];
    var cy = this.y[gear.centerNode];
    if (radius === undefined) {
      radius = Math2D.dist(cx, cy, this.x[nodeId], this.y[nodeId]);
    }
    if (angleOffset === undefined) {
      angleOffset = Math.atan2(this.y[nodeId] - cy, this.x[nodeId] - cx) - gear.angle;
    }
    this.attachedNodes.push({
      nodeId: nodeId,
      gearIdx: gearIdx,
      radius: radius,
      angleOffset: angleOffset
    });
    // Constrain attached node kinematically
    this.invMass[nodeId] = 0.0;
  };

  PhysicsSystem.prototype.addPulley = function(nodeId, radius, options) {
    options = options || {};
    var pulley = {
      nodeId: nodeId,
      radius: radius || 30,
      angle: options.angle || 0,
      angularVelocity: 0,
      width: options.width || 8,
      grooveDepth: options.grooveDepth || 4
    };
    this.pulleys.push(pulley);
    return pulley;
  };

  PhysicsSystem.prototype.addBelt = function(pulleyA, pulleyB, options) {
    options = options || {};
    var belt = {
      pulleyA: pulleyA,
      pulleyB: pulleyB,
      crossed: !!options.crossed,
      compliance: options.compliance !== undefined ? options.compliance : 0.0,
      width: options.width || 6
    };
    this.belts.push(belt);
    return belt;
  };

  PhysicsSystem.prototype.addAxle = function(targetA, targetB, options) {
    options = options || {};
    // targetA & targetB: { type: 'gear'|'pulley'|'cam'|'motor', index: number }
    var axle = {
      targetA: targetA,
      targetB: targetB,
      ratio: options.ratio || 1.0,
      shaftNodeA: options.shaftNodeA,
      shaftNodeB: options.shaftNodeB
    };
    this.axles.push(axle);
    return axle;
  };

  PhysicsSystem.prototype.addCam = function(centerNode, profileType, baseRadius, lift, options) {
    options = options || {};
    var cam = {
      centerNode: centerNode,
      profileType: profileType || 'pear',
      baseRadius: baseRadius || 35,
      lift: lift !== undefined ? lift : 20,
      angle: options.initialAngle || 0,
      angularVelocity: 0,
      options: options
    };
    this.cams.push(cam);
    return cam;
  };

  PhysicsSystem.prototype.addCamContact = function(camIdx, followerNode, rollerRadius, options) {
    options = options || {};
    var contact = {
      camIdx: camIdx,
      followerNode: followerNode,
      rollerRadius: rollerRadius !== undefined ? rollerRadius : 8,
      compliance: options.compliance || 0.0,
      normalForce: 0
    };
    this.camContacts.push(contact);
    return contact;
  };

  PhysicsSystem.prototype.addSpring = function(a, b, restLength, stiffness, options) {
    options = options || {};
    if (restLength === undefined || restLength <= 0) {
      restLength = Math2D.dist(this.x[a], this.y[a], this.x[b], this.y[b]);
    }
    var spring = {
      a: a,
      b: b,
      restLength: restLength,
      stiffness: stiffness !== undefined ? stiffness : 150.0,
      damping: options.damping !== undefined ? options.damping : 0.05,
      width: options.width || 14,
      color: options.color || '#10b981',
      solidLength: (options.solidLength !== undefined && options.solidLength !== null)
        ? options.solidLength
        : Math.max(4, restLength * 0.35),
      currentLength: restLength,
      force: 0
    };
    this.springs.push(spring);
    return spring;
  };

  PhysicsSystem.prototype.attachNodeToPulley = function(nodeId, pulleyIdx, radius, angleOffset) {
    var p = this.pulleys[pulleyIdx];
    if (!p) return;
    var cx = this.x[p.nodeId];
    var cy = this.y[p.nodeId];
    if (radius === undefined) {
      radius = Math2D.dist(cx, cy, this.x[nodeId], this.y[nodeId]);
    }
    if (angleOffset === undefined) {
      angleOffset = Math.atan2(this.y[nodeId] - cy, this.x[nodeId] - cx) - p.angle;
    }
    this.attachedPulleyNodes.push({
      nodeId: nodeId,
      pulleyIdx: pulleyIdx,
      radius: radius,
      angleOffset: angleOffset
    });
    this.invMass[nodeId] = 0.0;
  };

  PhysicsSystem.prototype.attachNodeToCam = function(nodeId, camIdx, radius, angleOffset) {
    var c = this.cams[camIdx];
    if (!c) return;
    var cx = this.x[c.centerNode];
    var cy = this.y[c.centerNode];
    if (radius === undefined) {
      radius = Math2D.dist(cx, cy, this.x[nodeId], this.y[nodeId]);
    }
    if (angleOffset === undefined) {
      angleOffset = Math.atan2(this.y[nodeId] - cy, this.x[nodeId] - cx) - c.angle;
    }
    this.attachedCamNodes.push({
      nodeId: nodeId,
      camIdx: camIdx,
      radius: radius,
      angleOffset: angleOffset
    });
    this.invMass[nodeId] = 0.0;
  };

  PhysicsSystem.prototype.addGeneva = function(driverCenterNode, driverPinNode, genevaCenterNode, slots, options) {
    options = options || {};
    var numSlots = slots || 4;
    var c1x = this.x[driverCenterNode], c1y = this.y[driverCenterNode];
    var c2x = this.x[genevaCenterNode], c2y = this.y[genevaCenterNode];
    var D = Math2D.dist(c1x, c1y, c2x, c2y);
    if (D < 1e-4) D = 100;

    var beta = Math.PI / numSlots;
    var pinRadius = D * Math.sin(beta);
    var wheelRadius = D * Math.cos(beta);
    var lockRadius = Math.max(10, D - pinRadius);

    var initAngle = options.initialAngle !== undefined ? options.initialAngle : (options.angle || 0);
    var geneva = {
      driverCenterNode: driverCenterNode,
      driverPinNode: driverPinNode,
      genevaCenterNode: genevaCenterNode,
      slots: numSlots,
      centerDist: D,
      pinRadius: pinRadius,
      radius: wheelRadius,
      lockRadius: lockRadius,
      initialDwellAngle: initAngle,
      angle: initAngle,
      dwellAngle: initAngle,
      engagedSlot: 0,
      angularVelocity: 0,
      isEngaged: false,
      slotWidth: options.slotWidth || 10,
      contactForce: 0
    };
    this.genevas.push(geneva);
    return geneva;
  };

  PhysicsSystem.prototype.attachNodeToGeneva = function(nodeId, genevaIdx, radius, angleOffset) {
    var g = this.genevas[genevaIdx];
    if (!g) return;
    var cx = this.x[g.genevaCenterNode];
    var cy = this.y[g.genevaCenterNode];
    if (radius === undefined) {
      radius = Math2D.dist(cx, cy, this.x[nodeId], this.y[nodeId]);
    }
    if (angleOffset === undefined) {
      angleOffset = Math.atan2(this.y[nodeId] - cy, this.x[nodeId] - cx) - g.angle;
    }
    this.attachedGenevaNodes.push({
      nodeId: nodeId,
      genevaIdx: genevaIdx,
      radius: radius,
      angleOffset: angleOffset
    });
    this.invMass[nodeId] = 0.0;
  };

  PhysicsSystem.prototype.getRotaryAngle = function(target) {
    if (!target) return 0;
    if (target.type === 'gear' && this.gears[target.index]) return this.gears[target.index].angle;
    if (target.type === 'pulley' && this.pulleys[target.index]) return this.pulleys[target.index].angle;
    if (target.type === 'cam' && this.cams[target.index]) return this.cams[target.index].angle;
    if (target.type === 'motor' && this.motors[target.index]) return this.motors[target.index].angle;
    return 0;
  };

  PhysicsSystem.prototype.setRotaryAngle = function(target, angle) {
    if (!target) return;
    if (target.type === 'gear' && this.gears[target.index]) {
      this.gears[target.index].angle = angle;
      this.propagateGearAngles(target.index);
    } else if (target.type === 'pulley' && this.pulleys[target.index]) {
      this.pulleys[target.index].angle = angle;
      this.propagateBeltAngles(target.index);
    } else if (target.type === 'cam' && this.cams[target.index]) {
      this.cams[target.index].angle = angle;
    }
  };

  PhysicsSystem.prototype.propagateBeltAngles = function(sourcePulleyIdx) {
    var visited = new Set();
    var queue = [sourcePulleyIdx];
    visited.add(sourcePulleyIdx);

    while (queue.length > 0) {
      var currIdx = queue.shift();
      var p1 = this.pulleys[currIdx];
      if (!p1) continue;

      for (var bi = 0; bi < this.belts.length; bi++) {
        var belt = this.belts[bi];
        var otherIdx = -1;
        var forward = true;
        if (belt.pulleyA === currIdx) {
          otherIdx = belt.pulleyB;
          forward = true;
        } else if (belt.pulleyB === currIdx) {
          otherIdx = belt.pulleyA;
          forward = false;
        }
        if (otherIdx !== -1 && !visited.has(otherIdx)) {
          visited.add(otherIdx);
          var p2 = this.pulleys[otherIdx];
          if (p2) {
            var sign = belt.crossed ? -1 : 1;
            var ratio = forward ? (p1.radius / p2.radius) : (p2.radius / p1.radius);
            p2.angle = p1.angle * ratio * sign;
            queue.push(otherIdx);
          }
        }
      }
    }
  };

  PhysicsSystem.prototype.addSlider = function(node, aNode, bNode, minT, maxT, options) {
    options = options || {};
    var ax = this.x[aNode], ay = this.y[aNode];
    var bx = this.x[bNode], by = this.y[bNode];
    var railLen = Math2D.dist(ax, ay, bx, by);
    var minVal = (minT !== undefined && minT !== null && isFinite(minT)) ? Math.max(0, Math.min(railLen, minT)) : undefined;
    var maxVal = (maxT !== undefined && maxT !== null && isFinite(maxT)) ? Math.max(0, Math.min(railLen, maxT)) : undefined;
    if (minVal !== undefined && maxVal !== undefined && minVal > maxVal) {
      var swap = minVal;
      minVal = maxVal;
      maxVal = swap;
    }
    var slider = {
      node: node,
      aNode: aNode,
      bNode: bNode,
      minT: minVal,
      maxT: maxVal,
      railLength: railLen,
      friction: (options.friction !== undefined) ? options.friction : 0
    };
    this.sliders.push(slider);
    return slider;
  };

  PhysicsSystem.prototype.addGear = function(centerNode, radius, teeth) {
    var gear = {
      centerNode: centerNode,
      radius: radius || 30,
      teeth: teeth || Math.max(8, Math.round((radius || 30) / 3)),
      angle: 0,
      meshWith: []
    };
    this.gears.push(gear);
    return gear;
  };

  PhysicsSystem.prototype.connectGears = function(gearIndex1, gearIndex2) {
    var g1 = this.gears[gearIndex1];
    var g2 = this.gears[gearIndex2];
    if (g1 && g2) {
      if (!g1.meshWith.includes(gearIndex2)) g1.meshWith.push(gearIndex2);
      if (!g2.meshWith.includes(gearIndex1)) g2.meshWith.push(gearIndex1);
    }
  };

  PhysicsSystem.prototype.addMotor = function(centerNode, crankNode, speed, options) {
    options = options || {};
    var r = Math2D.dist(this.x[centerNode], this.y[centerNode], this.x[crankNode], this.y[crankNode]);
    var angle = Math.atan2(this.y[crankNode] - this.y[centerNode], this.x[crankNode] - this.x[centerNode]);
    var rawTorque = (options.maxTorque !== undefined) ? options.maxTorque : options.torque;
    var maxTorque = (rawTorque === undefined || rawTorque === null || !isFinite(rawTorque)) ? Infinity : rawTorque;
    var motor = {
      centerNode: centerNode,
      crankNode: crankNode,
      speed: speed !== undefined ? speed : 2.0, // rad/s
      targetSpeed: speed !== undefined ? speed : 2.0,
      radius: r,
      angle: angle,
      active: true,
      maxTorque: maxTorque,
      currentTorque: 0,
      actualSpeed: speed !== undefined ? speed : 2.0,
      stalled: false
    };
    this.motors.push(motor);
    this.invMass[crankNode] = 0.0;
    return motor;
  };

  PhysicsSystem.prototype.isUnderHumanInput = function() {
    return this.mouseDragNode !== -1 || !!this.isManualInteracting;
  };

  PhysicsSystem.prototype.setMouseDrag = function(nodeId, x, y) {
    this.mouseDragNode = nodeId;
    this.mouseDragX = x;
    this.mouseDragY = y;
    this.isManualInteracting = true;
  };

  PhysicsSystem.prototype.clearMouseDrag = function() {
    this.mouseDragNode = -1;
    this.isManualInteracting = false;
  };

  PhysicsSystem.prototype.rotateGearManual = function(gearIdx, deltaAngle) {
    this.isManualInteracting = true;
    var gear = this.gears[gearIdx];
    if (!gear) return;
    gear.angle += deltaAngle;
    this.propagateGearAngles(gearIdx);
  };

  PhysicsSystem.prototype.propagateGearAngles = function(sourceGearIdx) {
    var visited = new Set();
    var queue = [sourceGearIdx];
    visited.add(sourceGearIdx);

    while (queue.length > 0) {
      var currIdx = queue.shift();
      var g1 = this.gears[currIdx];
      var c1x = this.x[g1.centerNode];
      var c1y = this.y[g1.centerNode];

      for (var mi = 0; mi < g1.meshWith.length; mi++) {
        var nextIdx = g1.meshWith[mi];
        if (!visited.has(nextIdx)) {
          visited.add(nextIdx);
          var g2 = this.gears[nextIdx];
          var c2x = this.x[g2.centerNode];
          var c2y = this.y[g2.centerNode];
          g2.angle = Math2D.calcMeshedAngle(c1x, c1y, g1.teeth, g1.angle, c2x, c2y, g2.teeth);
          queue.push(nextIdx);
        }
      }
    }
  };

  /**
   * Run one simulation step with dt (default 1/60s).
   * Sub-stepped XPBD handles rigidity and high angular velocities gracefully.
   */
  PhysicsSystem.prototype.step = function(dt) {
    var numSubsteps = this.substeps || 30;
    var solverIters = this.solverIterations || 8;
    var h = dt / numSubsteps;
    var hSq = h * h;
    var invH = 1.0 / h;
    var dampingFactor = Math.pow(1.0 - this.damping, h * 60);

    // Ensure all kinematic nodes have invMass = 0.0
    for (var ki = 0; ki < this.numNodes; ki++) {
      if (this.isFixed[ki]) {
        this.invMass[ki] = 0.0;
      }
    }
    for (var km = 0; km < this.motors.length; km++) {
      if (this.motors[km].active) {
        this.invMass[this.motors[km].crankNode] = 0.0;
      }
    }
    for (var kai = 0; kai < this.attachedNodes.length; kai++) {
      this.invMass[this.attachedNodes[kai].nodeId] = 0.0;
    }
    for (var kapi = 0; kapi < this.attachedPulleyNodes.length; kapi++) {
      this.invMass[this.attachedPulleyNodes[kapi].nodeId] = 0.0;
    }
    for (var kaci = 0; kaci < this.attachedCamNodes.length; kaci++) {
      this.invMass[this.attachedCamNodes[kaci].nodeId] = 0.0;
    }
    for (var kagi = 0; kagi < this.attachedGenevaNodes.length; kagi++) {
      this.invMass[this.attachedGenevaNodes[kagi].nodeId] = 0.0;
    }

    for (var s = 0; s < numSubsteps; s++) {
      // 1. Save previous positions for velocity updates
      for (var i = 0; i < this.numNodes; i++) {
        this.x0[i] = this.x[i];
        this.y0[i] = this.y[i];
      }

      // 1.5 Dynamic Proximity Gear Meshing (e.g. Shifting Gears on Sliders)
      for (var gi = 0; gi < this.gears.length; gi++) {
        var g1 = this.gears[gi];
        var isG1Movable = !this.isFixed[g1.centerNode];

        for (var gj = gi + 1; gj < this.gears.length; gj++) {
          var g2 = this.gears[gj];
          var isG2Movable = !this.isFixed[g2.centerNode];
          if (!isG1Movable && !isG2Movable) continue; // Both fixed gears have static mesh

          var c1x = this.x[g1.centerNode];
          var c1y = this.y[g1.centerNode];
          var c2x = this.x[g2.centerNode];
          var c2y = this.y[g2.centerNode];
          var dist = Math2D.dist(c1x, c1y, c2x, c2y);
          var pitchDist = g1.radius + g2.radius;
          var tol = 4.0; // Meshing engagement window

          var mIdx1 = g1.meshWith.indexOf(gj);
          var mIdx2 = g2.meshWith.indexOf(gi);
          var isMeshed = (mIdx1 !== -1);

          if (Math.abs(dist - pitchDist) <= tol) {
            if (!isMeshed) {
              g1.meshWith.push(gj);
              if (mIdx2 === -1) g2.meshWith.push(gi);
            }
          } else if (isMeshed && Math.abs(dist - pitchDist) > tol + 3.0) {
            // Disengage when shifted out of contact
            g1.meshWith.splice(mIdx1, 1);
            if (mIdx2 !== -1) g2.meshWith.splice(mIdx2, 1);
          }
        }
      }

      // 2. Advance motors using actual speed (accounting for load torque & stall limits)
      for (var m = 0; m < this.motors.length; m++) {
        var motor = this.motors[m];
        if (!motor.active) continue;
        var effSpeed = motor.stalled ? 0 : (motor.actualSpeed !== undefined ? motor.actualSpeed : motor.speed);
        motor.angle += effSpeed * h;
        if (motor.angle > Math.PI * 2) motor.angle -= Math.PI * 2;
        if (motor.angle < -Math.PI * 2) motor.angle += Math.PI * 2;

        var cx = this.x[motor.centerNode];
        var cy = this.y[motor.centerNode];
        var targetX = cx + motor.radius * Math.cos(motor.angle);
        var targetY = cy + motor.radius * Math.sin(motor.angle);

        // Update crank node kinematic position
        this.x[motor.crankNode] = targetX;
        this.y[motor.crankNode] = targetY;

        // Drive gear rotation if center or crank is connected to a gear
        for (var gi = 0; gi < this.gears.length; gi++) {
          var gear = this.gears[gi];
          if (gear.centerNode === motor.centerNode) {
            gear.angle += effSpeed * h;
            this.propagateGearAngles(gi);
          }
        }

        // Drive pulley rotation if center is connected to a pulley
        for (var pi = 0; pi < this.pulleys.length; pi++) {
          if (this.pulleys[pi].nodeId === motor.centerNode) {
            this.pulleys[pi].angle += effSpeed * h;
            this.propagateBeltAngles(pi);
          }
        }

        // Drive cam rotation if center is connected to a cam
        for (var ci = 0; ci < this.cams.length; ci++) {
          if (this.cams[ci].centerNode === motor.centerNode) {
            this.cams[ci].angle += effSpeed * h;
          }
        }
      }

      // 2.5 Propagate Axles (Concentric & Drive Shafts)
      for (var axi = 0; axi < this.axles.length; axi++) {
        var axle = this.axles[axi];
        var angleA = this.getRotaryAngle(axle.targetA);
        this.setRotaryAngle(axle.targetB, angleA * (axle.ratio || 1.0));
      }

      // Update attached nodes on gears, pulleys, and cams before integration
      for (var ai = 0; ai < this.attachedNodes.length; ai++) {
        var att = this.attachedNodes[ai];
        var ag = this.gears[att.gearIdx];
        if (ag) {
          var acx = this.x[ag.centerNode];
          var acy = this.y[ag.centerNode];
          var totA = ag.angle + att.angleOffset;
          this.x[att.nodeId] = acx + att.radius * Math.cos(totA);
          this.y[att.nodeId] = acy + att.radius * Math.sin(totA);
        }
      }
      for (var api = 0; api < this.attachedPulleyNodes.length; api++) {
        var attP = this.attachedPulleyNodes[api];
        var ap = this.pulleys[attP.pulleyIdx];
        if (ap) {
          var pcx = this.x[ap.nodeId];
          var pcy = this.y[ap.nodeId];
          var totPA = ap.angle + attP.angleOffset;
          this.x[attP.nodeId] = pcx + attP.radius * Math.cos(totPA);
          this.y[attP.nodeId] = pcy + attP.radius * Math.sin(totPA);
        }
      }
      for (var aci = 0; aci < this.attachedCamNodes.length; aci++) {
        var attC = this.attachedCamNodes[aci];
        var ac = this.cams[attC.camIdx];
        if (ac) {
          var ccx = this.x[ac.centerNode];
          var ccy = this.y[ac.centerNode];
          var totCA = ac.angle + attC.angleOffset;
          this.x[attC.nodeId] = ccx + attC.radius * Math.cos(totCA);
          this.y[attC.nodeId] = ccy + attC.radius * Math.sin(totCA);
        }
      }

      // 2.7 Advance Geneva mechanism with Physical Contact & Dwell Locking
      for (var gi = 0; gi < this.genevas.length; gi++) {
        var g = this.genevas[gi];
        var c1x = this.x[g.driverCenterNode], c1y = this.y[g.driverCenterNode];
        var c2x = this.x[g.genevaCenterNode], c2y = this.y[g.genevaCenterNode];
        var px = this.x[g.driverPinNode], py = this.y[g.driverPinNode];

        var centerAngle = Math.atan2(c1y - c2y, c1x - c2x);
        var beta = Math.PI / g.slots;
        var dTheta = (2 * Math.PI) / g.slots;
        var dirC1toC2 = centerAngle + Math.PI;

        var crankAngle = Math.atan2(py - c1y, px - c1x);
        var phiRel = Math2D.normalizeAngle(crankAngle - dirC1toC2);

        var rx = px - c2x;
        var ry = py - c2y;
        var rDist = Math.hypot(rx, ry);

        var inSlot = (Math.abs(phiRel) <= beta + 0.03) && (rDist <= g.radius + 6);

        if (inSlot) {
          var thetaPin = Math.atan2(ry, rx);
          if (!g.isEngaged) {
            g.isEngaged = true;
            // Identify which slot k is engaged with the drive pin
            var minDiff = Infinity;
            var bestSlot = 0;
            for (var k = 0; k < g.slots; k++) {
              var slotWorldA = g.dwellAngle + k * dTheta;
              var diffK = Math.abs(Math2D.normalizeAngle(thetaPin - slotWorldA));
              if (diffK < minDiff) {
                minDiff = diffK;
                bestSlot = k;
              }
            }
            g.engagedSlot = bestSlot;
            // Reset entry angle so the first-frame-after-engagement logic captures it fresh
            g.angleAtEngagementEntry = undefined;
          }
          var targetAngle = thetaPin - g.engagedSlot * dTheta;
          var angleDiff = Math2D.normalizeAngle(targetAngle - g.dwellAngle);
          var prevAngle = g.angle;
          g.angle = g.dwellAngle + angleDiff;
          // Record the true entry angle on the first engaged frame (after first computation)
          if (g.angleAtEngagementEntry === undefined) {
            g.angleAtEngagementEntry = g.angle;
          }
          g.angularVelocity = (g.angle - prevAngle) / h;
          g.contactForce = Math.abs(g.angularVelocity) * 25;
        } else {
          if (g.isEngaged) {
            // entryAngle: first-frame Geneva angle when the pin entered the slot
            // g.angle:    current (exit) angle
            // Measure how many dwell-steps (dTheta each) elapsed during this engagement.
            // Apply that step-count to the PRE-STROKE dwell, not to entryAngle,
            // because entryAngle is an instantaneous tracking position, not a dwell position.
            var priorDwell = g.dwellAngle;
            var entryAngle = (g.angleAtEngagementEntry !== undefined) ? g.angleAtEngagementEntry : g.angle;
            var totalChange = g.angle - entryAngle;
            var numSteps = Math.round(totalChange / dTheta);
            g.dwellAngle = priorDwell + numSteps * dTheta;
            g.isEngaged = false;
          }
          g.angle = g.dwellAngle;
          g.angularVelocity = 0;
          g.contactForce = 0;
        }
      }

      // Update attached nodes on Geneva wheels before integration
      for (var agi = 0; agi < this.attachedGenevaNodes.length; agi++) {
        var attG = this.attachedGenevaNodes[agi];
        var gObj = this.genevas[attG.genevaIdx];
        if (gObj) {
          var c2x = this.x[gObj.genevaCenterNode];
          var c2y = this.y[gObj.genevaCenterNode];
          var totAG = gObj.angle + attG.angleOffset;
          this.x[attG.nodeId] = c2x + attG.radius * Math.cos(totAG);
          this.y[attG.nodeId] = c2y + attG.radius * Math.sin(totAG);
        }
      }

      // 3. Symplectic Euler integration
      for (var i = 0; i < this.numNodes; i++) {
        if (this.isFixed[i]) {
          this.x[i] = this.fixedX[i];
          this.y[i] = this.fixedY[i];
          this.vx[i] = 0;
          this.vy[i] = 0;
          continue;
        }

        // Kinematic nodes (e.g. active motor cranks, gear/geneva attached nodes):
        // Positions are strictly governed by kinematic trajectories; skip Euler integration.
        if (this.invMass[i] === 0.0) {
          continue;
        }

        // Apply external acceleration
        this.vx[i] += this.gravityX * h;
        this.vy[i] += this.gravityY * h;
        this.vx[i] *= dampingFactor;
        this.vy[i] *= dampingFactor;

        this.x[i] += this.vx[i] * h;
        this.y[i] += this.vy[i] * h;
      }

      // Apply mouse dragging target attraction
      if (this.mouseDragNode !== -1 && !this.isFixed[this.mouseDragNode]) {
        var dragAlpha = 0.5;
        this.x[this.mouseDragNode] += (this.mouseDragX - this.x[this.mouseDragNode]) * dragAlpha;
        this.y[this.mouseDragNode] += (this.mouseDragY - this.y[this.mouseDragNode]) * dragAlpha;
      }

      // 3. Project constraints (Multi-pass Gauss-Seidel XPBD)
      for (var iter = 0; iter < solverIters; iter++) {
        // Distance constraints (Rods)
        for (var r = 0; r < this.rods.length; r++) {
          var rod = this.rods[r];
          var a = rod.a;
          var b = rod.b;
          var wA = this.invMass[a];
          var wB = this.invMass[b];
          var wSum = wA + wB;
          if (wSum === 0) continue;

          var dx = this.x[b] - this.x[a];
          var dy = this.y[b] - this.y[a];
          var dist = Math.hypot(dx, dy);
          if (dist === 0) continue;

          var deltaC = dist - rod.length;
          rod.stress = Math.abs(deltaC) / rod.length;

          var compliance = rod.compliance || 0.0;
          var factor = (compliance === 0.0)
            ? deltaC / (dist * wSum)
            : deltaC / (dist * (wSum + compliance / hSq));
          var corrX = dx * factor;
          var corrY = dy * factor;

          if (wA > 0) {
            this.x[a] += wA * corrX;
            this.y[a] += wA * corrY;
          }
          if (wB > 0) {
            this.x[b] -= wB * corrX;
            this.y[b] -= wB * corrY;
          }

          // Beam Orientation / Angle Locking Constraint (Horizontal, Vertical, or Fixed Angle)
          if (rod.angleLock && rod.angleLock !== 'none') {
            if (rod.angleLock === 'horizontal') {
              var dyH = this.y[b] - this.y[a];
              var corrYH = dyH / wSum;
              if (wA > 0) this.y[a] += wA * corrYH;
              if (wB > 0) this.y[b] -= wB * corrYH;
            } else if (rod.angleLock === 'vertical') {
              var dxV = this.x[b] - this.x[a];
              var corrXV = dxV / wSum;
              if (wA > 0) this.x[a] += wA * corrXV;
              if (wB > 0) this.x[b] -= wB * corrXV;
            } else if (rod.angleLock === 'fixed') {
              var theta = rod.lockedAngle || 0;
              var nx = -Math.sin(theta);
              var ny = Math.cos(theta);
              var err = (this.x[b] - this.x[a]) * nx + (this.y[b] - this.y[a]) * ny;
              var corr = err / wSum;
              if (wA > 0) {
                this.x[a] += wA * corr * nx;
                this.y[a] += wA * corr * ny;
              }
              if (wB > 0) {
                this.x[b] -= wB * corr * nx;
                this.y[b] -= wB * corr * ny;
              }
            }
          }
        }

        // Prismatic / Slider constraints
        for (var sl = 0; sl < this.sliders.length; sl++) {
          var sliderObj = this.sliders[sl];
          var sNode = sliderObj.node;
          if (this.isFixed[sNode]) continue;

          var aNode = sliderObj.aNode;
          var bNode = sliderObj.bNode;
          var ax = this.x[aNode], ay = this.y[aNode];
          var bx = this.x[bNode], by = this.y[bNode];

          var abx = bx - ax;
          var aby = by - ay;
          var lenSq = abx * abx + aby * aby;
          if (lenSq < 1e-12) continue;
          var len = Math.sqrt(lenSq);
          var ux = abx / len;
          var uy = aby / len;

          // Project sNode onto line
          var px = this.x[sNode] - ax;
          var py = this.y[sNode] - ay;
          var proj = px * ux + py * uy;

          // Clamp to stroke limits only if explicitly configured
          if (sliderObj.minT !== undefined && sliderObj.minT !== null && isFinite(sliderObj.minT) && proj < sliderObj.minT) {
            proj = sliderObj.minT;
          }
          if (sliderObj.maxT !== undefined && sliderObj.maxT !== null && isFinite(sliderObj.maxT) && proj > sliderObj.maxT) {
            proj = sliderObj.maxT;
          }

          this.x[sNode] = ax + proj * ux;
          this.y[sNode] = ay + proj * uy;

          // Slider friction
          if (sliderObj.friction && sliderObj.friction > 0) {
            this.vx[sNode] *= Math.max(0, 1.0 - sliderObj.friction * h * 10);
            this.vy[sNode] *= Math.max(0, 1.0 - sliderObj.friction * h * 10);
          }
        }

        // Helical Springs (XPBD Elastic Potential)
        for (var sp = 0; sp < this.springs.length; sp++) {
          var spr = this.springs[sp];
          var sa = spr.a, sb = spr.b;
          var wSa = this.invMass[sa];
          var wSb = this.invMass[sb];
          var wSumS = wSa + wSb;
          if (wSumS === 0) continue;

          var sdx = this.x[sb] - this.x[sa];
          var sdy = this.y[sb] - this.y[sa];
          var sDist = Math.hypot(sdx, sdy);
          if (sDist === 0) continue;

          spr.currentLength = sDist;
          var sDeltaC = sDist - spr.restLength;
          // XPBD compliance alpha = 1 / stiffness
          var springCompliance = 1.0 / Math.max(1e-3, spr.stiffness);
          var sFactor = sDeltaC / (sDist * (wSumS + springCompliance / hSq));
          var sCorrX = sdx * sFactor;
          var sCorrY = sdy * sFactor;

          if (wSa > 0) {
            this.x[sa] += wSa * sCorrX;
            this.y[sa] += wSa * sCorrY;
          }
          if (wSb > 0) {
            this.x[sb] -= wSb * sCorrX;
            this.y[sb] -= wSb * sCorrY;
          }
          spr.force = Math.abs(sDeltaC) * spr.stiffness;

          // Solid-height limit: a real coil spring cannot compress through itself.
          var minL = spr.solidLength;
          if (minL > 0 && sDist < minL) {
            var uxs = sdx / sDist;
            var uys = sdy / sDist;
            var push = minL - sDist;
            if (wSa > 0) {
              this.x[sa] -= (wSa / wSumS) * push * uxs;
              this.y[sa] -= (wSa / wSumS) * push * uys;
            }
            if (wSb > 0) {
              this.x[sb] += (wSb / wSumS) * push * uxs;
              this.y[sb] += (wSb / wSumS) * push * uys;
            }
          }
        }

        // Physical Cam-Follower Contact Non-Penetration Constraint
        for (var cci = 0; cci < this.camContacts.length; cci++) {
          var cc = this.camContacts[cci];
          var cam = this.cams[cc.camIdx];
          var fn = cc.followerNode;
          if (!cam) continue;

          var cx = this.x[cam.centerNode], cy = this.y[cam.centerNode];
          var fx = this.x[fn], fy = this.y[fn];
          var dx = fx - cx, dy = fy - cy;
          var dist = Math.hypot(dx, dy);
          if (dist < 1e-4) continue;

          var phi = Math.atan2(dy, dx);
          var relAngle = Math2D.normalizeAngle(phi - cam.angle);
          var camR = Math2D.getCamRadius(cam.profileType, relAngle, cam.baseRadius, cam.lift, cam.options);
          var rollerR = cc.rollerRadius || 8;
          var reqDist = camR + rollerR;
          var penetration = reqDist - dist;

          if (penetration > 0) {
            var nx = dx / dist;
            var ny = dy / dist;
            var wFn = this.invMass[fn];
            if (wFn > 0) {
              this.x[fn] += nx * penetration;
              this.y[fn] += ny * penetration;
              cc.normalForce = penetration / hSq;
            }
          } else {
            cc.normalForce = 0;
          }
        }
      }

      // Re-assert fixed pins, motor crank positions, and gear attached nodes
      for (var i = 0; i < this.numNodes; i++) {
        if (this.isFixed[i]) {
          this.x[i] = this.fixedX[i];
          this.y[i] = this.fixedY[i];
        }
      }
      for (var m = 0; m < this.motors.length; m++) {
        var motor = this.motors[m];
        if (!motor.active) continue;
        var cx = this.x[motor.centerNode];
        var cy = this.y[motor.centerNode];
        var idealX = cx + motor.radius * Math.cos(motor.angle);
        var idealY = cy + motor.radius * Math.sin(motor.angle);

        var rx = idealX - cx;
        var ry = idealY - cy;
        // Displacement vector caused by connected linkages/springs on crank pin
        var dispX = this.x[motor.crankNode] - idealX;
        var dispY = this.y[motor.crankNode] - idealY;
        // Reaction force F = -disp / hSq
        var fReactX = -dispX / hSq;
        var fReactY = -dispY / hSq;

        // Direct reaction force from connected springs
        for (var spi = 0; spi < this.springs.length; spi++) {
          var spr = this.springs[spi];
          if (spr.a === motor.crankNode || spr.b === motor.crankNode) {
            var other = (spr.a === motor.crankNode) ? spr.b : spr.a;
            var sdx = this.x[other] - idealX;
            var sdy = this.y[other] - idealY;
            var sDist = Math.hypot(sdx, sdy);
            if (sDist > 1e-4) {
              var sDeltaC = sDist - spr.restLength;
              var sprF = (spr.stiffness !== undefined ? spr.stiffness : 30) * sDeltaC;
              fReactX += sprF * (sdx / sDist);
              fReactY += sprF * (sdy / sDist);
            }
          }
        }

        var tauCrank = rx * fReactY - ry * fReactX;
        var tauLoad = (motor.speed * tauCrank < 0) ? Math.abs(tauCrank) : 0;

        // Also add cam follower reaction torque if motor drives a cam
        for (var cci = 0; cci < this.camContacts.length; cci++) {
          var cc = this.camContacts[cci];
          var cam = this.cams[cc.camIdx];
          if (cam && cam.centerNode === motor.centerNode && cc.normalForce > 0) {
            var fn = cc.followerNode;
            var fdx = this.x[fn] - cx;
            var fdy = this.y[fn] - cy;
            var fdist = Math.hypot(fdx, fdy);
            if (fdist > 1e-4) {
              var fnx = fdx / fdist;
              var fny = fdy / fdist;
              var camFx = cc.normalForce * fnx;
              var camFy = cc.normalForce * fny;
              var tauCam = fdx * camFy - fdy * camFx;
              if (motor.speed * tauCam < 0) {
                tauLoad += Math.abs(tauCam);
              }
            }
          }
        }

        // Exponential smoothing on motor load torque
        motor.currentTorque = motor.currentTorque * 0.85 + tauLoad * 0.15;

        // Check stall condition against maxTorque
        if (motor.maxTorque !== undefined && motor.maxTorque < Infinity) {
          if (motor.currentTorque >= motor.maxTorque - 0.5) {
            motor.stalled = true;
            motor.actualSpeed = 0;
            motor.currentTorque = Math.max(motor.currentTorque, motor.maxTorque);
          } else {
            motor.stalled = false;
            var sf = Math.max(0, 1.0 - (motor.currentTorque / motor.maxTorque));
            motor.actualSpeed = motor.speed * sf;
          }
        } else {
          motor.stalled = false;
          motor.actualSpeed = motor.speed;
        }

        this.x[motor.crankNode] = idealX;
        this.y[motor.crankNode] = idealY;
      }
      for (var ai = 0; ai < this.attachedNodes.length; ai++) {
        var att = this.attachedNodes[ai];
        var ag = this.gears[att.gearIdx];
        if (ag) {
          var acx = this.x[ag.centerNode];
          var acy = this.y[ag.centerNode];
          var totA = ag.angle + att.angleOffset;
          this.x[att.nodeId] = acx + att.radius * Math.cos(totA);
          this.y[att.nodeId] = acy + att.radius * Math.sin(totA);
        }
      }
      for (var api = 0; api < this.attachedPulleyNodes.length; api++) {
        var attP = this.attachedPulleyNodes[api];
        var ap = this.pulleys[attP.pulleyIdx];
        if (ap) {
          var pcx = this.x[ap.nodeId];
          var pcy = this.y[ap.nodeId];
          var totPA = ap.angle + attP.angleOffset;
          this.x[attP.nodeId] = pcx + attP.radius * Math.cos(totPA);
          this.y[attP.nodeId] = pcy + attP.radius * Math.sin(totPA);
        }
      }
      for (var aci = 0; aci < this.attachedCamNodes.length; aci++) {
        var attC = this.attachedCamNodes[aci];
        var ac = this.cams[attC.camIdx];
        if (ac) {
          var ccx = this.x[ac.centerNode];
          var ccy = this.y[ac.centerNode];
          var totCA = ac.angle + attC.angleOffset;
          this.x[attC.nodeId] = ccx + attC.radius * Math.cos(totCA);
          this.y[attC.nodeId] = ccy + attC.radius * Math.sin(totCA);
        }
      }
      for (var agi = 0; agi < this.attachedGenevaNodes.length; agi++) {
        var attG = this.attachedGenevaNodes[agi];
        var gObj = this.genevas[attG.genevaIdx];
        if (gObj) {
          var c2x = this.x[gObj.genevaCenterNode];
          var c2y = this.y[gObj.genevaCenterNode];
          var totAG = gObj.angle + attG.angleOffset;
          this.x[attG.nodeId] = c2x + attG.radius * Math.cos(totAG);
          this.y[attG.nodeId] = c2y + attG.radius * Math.sin(totAG);
        }
      }

      // 4. Velocity update
      for (var i = 0; i < this.numNodes; i++) {
        if (this.isFixed[i]) {
          this.vx[i] = 0;
          this.vy[i] = 0;
        } else {
          this.vx[i] = (this.x[i] - this.x0[i]) * invH;
          this.vy[i] = (this.y[i] - this.y0[i]) * invH;
        }
      }
    }

    this.time += dt;
  };

  /**
   * Export compact snapshot of state for history buffer or serialization.
   */
  PhysicsSystem.prototype.getSnapshot = function() {
    var snap = {
      numNodes: this.numNodes,
      x: Array.from(this.x.subarray(0, this.numNodes)),
      y: Array.from(this.y.subarray(0, this.numNodes)),
      vx: Array.from(this.vx.subarray(0, this.numNodes)),
      vy: Array.from(this.vy.subarray(0, this.numNodes)),
      motorAngles: this.motors.map(function(m) { return m.angle; }),
      gearAngles: this.gears.map(function(g) { return g.angle; }),
      pulleyAngles: this.pulleys.map(function(p) { return p.angle; }),
      camAngles: this.cams.map(function(c) { return c.angle; }),
      genevaAngles: this.genevas.map(function(g) {
        return { angle: g.angle, dwellAngle: g.dwellAngle, isEngaged: g.isEngaged, angularVelocity: g.angularVelocity };
      }),
      time: this.time
    };
    return snap;
  };

  /**
   * Restore state from a snapshot.
   */
  PhysicsSystem.prototype.restoreSnapshot = function(snap) {
    if (!snap) return;
    var n = Math.min(this.numNodes, snap.numNodes);
    for (var i = 0; i < n; i++) {
      this.x[i] = snap.x[i];
      this.y[i] = snap.y[i];
      this.x0[i] = snap.x[i];
      this.y0[i] = snap.y[i];
      this.vx[i] = snap.vx[i];
      this.vy[i] = snap.vy[i];
    }
    if (snap.motorAngles) {
      for (var m = 0; m < this.motors.length && m < snap.motorAngles.length; m++) {
        this.motors[m].angle = snap.motorAngles[m];
      }
    }
    if (snap.gearAngles) {
      for (var g = 0; g < this.gears.length && g < snap.gearAngles.length; g++) {
        this.gears[g].angle = snap.gearAngles[g];
      }
    }
    if (snap.pulleyAngles) {
      for (var p = 0; p < this.pulleys.length && p < snap.pulleyAngles.length; p++) {
        this.pulleys[p].angle = snap.pulleyAngles[p];
      }
    }
    if (snap.camAngles) {
      for (var c = 0; c < this.cams.length && c < snap.camAngles.length; c++) {
        this.cams[c].angle = snap.camAngles[c];
      }
    }
    if (snap.genevaAngles) {
      for (var gi = 0; gi < this.genevas.length && gi < snap.genevaAngles.length; gi++) {
        this.genevas[gi].angle = snap.genevaAngles[gi].angle;
        this.genevas[gi].dwellAngle = snap.genevaAngles[gi].dwellAngle;
        this.genevas[gi].isEngaged = snap.genevaAngles[gi].isEngaged;
        if (snap.genevaAngles[gi].angularVelocity !== undefined) {
          this.genevas[gi].angularVelocity = snap.genevaAngles[gi].angularVelocity;
        }
      }
    }
    this.time = snap.time;
  };

  return PhysicsSystem;
});
