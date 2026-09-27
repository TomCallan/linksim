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
    this.rods = [];          // { a, b, length, width, color, stress }
    this.sliders = [];       // { node, aNode, bNode, minT, maxT, railLength }
    this.gears = [];         // { centerNode, radius, teeth, angle, meshWith: [...] }
    this.motors = [];        // { centerNode, crankNode, speed, radius, angle, active }
    this.brackets = [];      // { a, b, c, width, color }
    this.attachedNodes = []; // { nodeId, gearIdx, radius, angleOffset }

    // Direct user interaction
    this.mouseDragNode = -1;
    this.mouseDragX = 0;
    this.mouseDragY = 0;

    // Simulation settings
    this.gravityX = 0;
    this.gravityY = 0; // Linkages typically operate in horizontal plane by default
    this.substeps = 15;
    this.damping = 0.002;
    this.time = 0;

    // Reusable scratch variables to avoid GC allocations
    this._scratch = new Float64Array(8);
  }

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
    this.mouseDragNode = -1;
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

  PhysicsSystem.prototype.addRod = function(a, b, length, style) {
    if (length === undefined || length <= 0) {
      length = Math2D.dist(this.x[a], this.y[a], this.x[b], this.y[b]);
    }
    var rod = {
      a: a,
      b: b,
      length: length,
      width: (style && style.width) || 8,
      color: (style && style.color) || '#3b82f6',
      stress: 0
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

  PhysicsSystem.prototype.addSlider = function(node, aNode, bNode, minT, maxT) {
    var ax = this.x[aNode], ay = this.y[aNode];
    var bx = this.x[bNode], by = this.y[bNode];
    var railLen = Math2D.dist(ax, ay, bx, by);
    var slider = {
      node: node,
      aNode: aNode,
      bNode: bNode,
      minT: minT !== undefined ? minT : -1000,
      maxT: maxT !== undefined ? maxT : 1000,
      railLength: railLen
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

  PhysicsSystem.prototype.addMotor = function(centerNode, crankNode, speed) {
    var r = Math2D.dist(this.x[centerNode], this.y[centerNode], this.x[crankNode], this.y[crankNode]);
    var angle = Math.atan2(this.y[crankNode] - this.y[centerNode], this.x[crankNode] - this.x[centerNode]);
    var motor = {
      centerNode: centerNode,
      crankNode: crankNode,
      speed: speed !== undefined ? speed : 2.0, // rad/s
      radius: r,
      angle: angle,
      active: true
    };
    this.motors.push(motor);
    return motor;
  };

  PhysicsSystem.prototype.setMouseDrag = function(nodeId, x, y) {
    this.mouseDragNode = nodeId;
    this.mouseDragX = x;
    this.mouseDragY = y;
  };

  PhysicsSystem.prototype.clearMouseDrag = function() {
    this.mouseDragNode = -1;
  };

  PhysicsSystem.prototype.rotateGearManual = function(gearIdx, deltaAngle) {
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
    var numSubsteps = this.substeps;
    var h = dt / numSubsteps;
    var hSq = h * h;
    var invH = 1.0 / h;
    var dampingFactor = Math.pow(1.0 - this.damping, h * 60);

    for (var s = 0; s < numSubsteps; s++) {
      // 1. Advance motors
      for (var m = 0; m < this.motors.length; m++) {
        var motor = this.motors[m];
        if (!motor.active) continue;
        motor.angle += motor.speed * h;
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
            gear.angle += motor.speed * h;
            this.propagateGearAngles(gi);
          }
        }
      }

      // Update attached nodes on gears before integration
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

      // 2. Symplectic Euler integration
      for (var i = 0; i < this.numNodes; i++) {
        if (this.isFixed[i]) {
          this.x[i] = this.fixedX[i];
          this.y[i] = this.fixedY[i];
          this.vx[i] = 0;
          this.vy[i] = 0;
          continue;
        }

        // Apply external acceleration
        this.vx[i] += this.gravityX * h;
        this.vy[i] += this.gravityY * h;
        this.vx[i] *= dampingFactor;
        this.vy[i] *= dampingFactor;

        this.x0[i] = this.x[i];
        this.y0[i] = this.y[i];

        this.x[i] += this.vx[i] * h;
        this.y[i] += this.vy[i] * h;
      }

      // Apply mouse dragging target
      if (this.mouseDragNode !== -1 && !this.isFixed[this.mouseDragNode]) {
        this.x[this.mouseDragNode] = this.mouseDragX;
        this.y[this.mouseDragNode] = this.mouseDragY;
      }

      // 3. Project constraints
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

        var factor = deltaC / (dist * wSum);
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
      }

      // Prismatic / Slider constraints
      for (var sl = 0; sl < this.sliders.length; sl++) {
        var s = this.sliders[sl];
        var sNode = s.node;
        if (this.isFixed[sNode]) continue;

        var aNode = s.aNode;
        var bNode = s.bNode;
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

        // Clamp to stroke limits if configured
        if (s.minT !== undefined && proj < s.minT) proj = s.minT;
        if (s.maxT !== undefined && proj > s.maxT) proj = s.maxT;

        this.x[sNode] = ax + proj * ux;
        this.y[sNode] = ay + proj * uy;
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
        this.x[motor.crankNode] = cx + motor.radius * Math.cos(motor.angle);
        this.y[motor.crankNode] = cy + motor.radius * Math.sin(motor.angle);
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
      if (this.mouseDragNode !== -1 && !this.isFixed[this.mouseDragNode]) {
        this.x[this.mouseDragNode] = this.mouseDragX;
        this.y[this.mouseDragNode] = this.mouseDragY;
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
    this.time = snap.time;
  };

  return PhysicsSystem;
});
