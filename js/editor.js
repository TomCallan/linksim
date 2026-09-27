/**
 * Interactive Mechanism Blueprint Editor & Unified Canvas Controller for Linksim.
 * Supports fluid drag-to-connect drawing, accurate coordinate mapping,
 * gear parenting, rigid brackets, and right-click context menus.
 */
(function(root, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    var Math2D = require('./math2d.js');
    var SpriteRenderer = require('./sprites.js');
    module.exports = factory(Math2D, SpriteRenderer);
  } else {
    root.MechanismEditor = factory(root.Math2D, root.SpriteRenderer);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function(Math2D, SpriteRenderer) {
  'use strict';

  function MechanismEditor(canvas, onModelChanged) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onModelChanged = onModelChanged;

    this.renderer = new SpriteRenderer();

    // Editor data model
    this.nodes = [];          // [{ id, x, y, fixed, mass, parentGear: { gearIdx, radius, angleOffset } }]
    this.rods = [];           // [{ a, b, length, width, color }]
    this.sliders = [];        // [{ node, aNode, bNode, minT, maxT }]
    this.gears = [];          // [{ centerNode, radius, teeth, meshWith: [] }]
    this.motors = [];         // [{ centerNode, crankNode, speed }]
    this.brackets = [];       // [{ a, b, c, width, color }]
    this.genevas = [];        // [{ driverCenterNode, driverPinNode, genevaCenterNode, slots, radius, pinRadius, lockRadius, slotWidth, angle }]
    this.pulleys = [];        // [{ nodeId, radius, width }]
    this.belts = [];          // [{ pulleyA, pulleyB, crossed, width }]
    this.axles = [];          // [{ targetA, targetB, shaftNodeA, shaftNodeB }]
    this.cams = [];           // [{ centerNode, profileType, baseRadius, lift, options }]
    this.camContacts = [];    // [{ camIdx, followerNode, rollerRadius }]
    this.springs = [];        // [{ a, b, restLength, stiffness, width, color }]
    this.labels = [];          // [{ x, y, text, fontSize, color, bold }]
    this.shapeVertices = [];   // [{ x, y }] in-progress custom vector shape vertices
    this.trackedNodes = new Set(); // Node IDs being tracked for motion paths

    // Selection state for all elements
    this.selection = null;    // { type: 'node'|'gear'|'pulley'|'cam'|'rod'|'spring'|'slider'|'belt'|'geneva', index: number, item: any }

    // Viewport pan/zoom
    this.panX = canvas.width / 2;
    this.panY = canvas.height / 2;
    this.zoom = 1.0;

    // Mode: 'edit' or 'simulate'
    this.mode = 'edit';

    // Tool state
    this.activeTool = 'select'; // 'select', 'add_pin', 'add_node', 'add_rod', 'add_spring', 'add_slider', 'add_gear', 'add_pulley', 'add_belt', 'add_cam', 'add_motor', 'delete'
    this.selectedNodeId = -1;
    this.hoverNodeId = -1;
    this.hoverGearIdx = -1;
    this.hoverRodIdx = -1;
    this.hoverPulleyIdx = -1;
    this.hoverCamIdx = -1;
    this.hoverSpringIdx = -1;

    // Interaction flags
    this.isDragging = false;
    this.isConnecting = false;
    this.isConnectingSpring = false;
    this.connectStartNode = -1;
    this.mouseWorldX = 0;
    this.mouseWorldY = 0;

    this.isPanning = false;
    this.panStartX = 0;
    this.panStartY = 0;

    // Manual gear turning in simulate mode
    this.isTurningGear = false;
    this.turningGearIdx = -1;
    this.prevGearMouseAngle = 0;

    // Undo stack
    this.undoStack = [];

    // Context menu callback: fn(x, y, targetType, targetData)
    this.onShowContextMenu = null;
    this.onHumanInputStart = null;

    this._bindEvents();
  }

  MechanismEditor.prototype.screenToWorld = function(clientX, clientY) {
    var rect = this.canvas.getBoundingClientRect();
    var scaleX = this.canvas.width / rect.width;
    var scaleY = this.canvas.height / rect.height;
    var canvasPx = (clientX - rect.left) * scaleX;
    var canvasPy = (clientY - rect.top) * scaleY;
    return {
      x: (canvasPx - this.panX) / this.zoom,
      y: (canvasPy - this.panY) / this.zoom
    };
  };

  MechanismEditor.prototype.worldToScreen = function(wx, wy) {
    return {
      x: wx * this.zoom + this.panX,
      y: wy * this.zoom + this.panY
    };
  };

  MechanismEditor.prototype.saveState = function() {
    this.undoStack.push(this.exportJSON());
    if (this.undoStack.length > 30) this.undoStack.shift();
  };

  MechanismEditor.prototype.undo = function() {
    if (this.undoStack.length > 0) {
      var prev = this.undoStack.pop();
      this.loadJSON(prev);
    }
  };

  MechanismEditor.prototype.findSnapNode = function(wx, wy, excludeId) {
    var threshold = 14 / this.zoom;
    var threshSq = threshold * threshold;
    var bestId = -1;
    var bestDistSq = Infinity;
    for (var i = 0; i < this.nodes.length; i++) {
      var n = this.nodes[i];
      if (n.id === excludeId) continue;
      var dSq = Math2D.distSq(wx, wy, n.x, n.y);
      if (dSq < threshSq && dSq < bestDistSq) {
        bestDistSq = dSq;
        bestId = n.id;
      }
    }
    return bestId;
  };

  MechanismEditor.prototype.findNodeNear = function(wx, wy, threshold) {
    threshold = (threshold || 16) / this.zoom;
    var threshSq = threshold * threshold;
    var closestId = -1;
    var closestDistSq = Infinity;

    for (var i = 0; i < this.nodes.length; i++) {
      var n = this.nodes[i];
      var dSq = Math2D.distSq(wx, wy, n.x, n.y);
      if (dSq < threshSq && dSq < closestDistSq) {
        closestDistSq = dSq;
        closestId = n.id;
      }
    }
    return closestId;
  };

  MechanismEditor.prototype.findGearNear = function(wx, wy) {
    for (var i = this.gears.length - 1; i >= 0; i--) {
      var g = this.gears[i];
      var cNode = this.getNodeById(g.centerNode);
      if (cNode) {
        var d = Math2D.dist(wx, wy, cNode.x, cNode.y);
        if (d <= g.radius * 1.2) {
          return i;
        }
      }
    }
    return -1;
  };

  MechanismEditor.prototype.findPulleyNear = function(wx, wy) {
    for (var i = this.pulleys.length - 1; i >= 0; i--) {
      var p = this.pulleys[i];
      var cNode = this.getNodeById(p.nodeId);
      if (cNode) {
        var d = Math2D.dist(wx, wy, cNode.x, cNode.y);
        if (d <= p.radius * 1.2) {
          return i;
        }
      }
    }
    return -1;
  };

  MechanismEditor.prototype.findCamNear = function(wx, wy) {
    for (var i = this.cams.length - 1; i >= 0; i--) {
      var c = this.cams[i];
      var cNode = this.getNodeById(c.centerNode);
      if (cNode) {
        var d = Math2D.dist(wx, wy, cNode.x, cNode.y);
        if (d <= (c.baseRadius + (c.lift || 0)) * 1.2) {
          return i;
        }
      }
    }
    return -1;
  };

  MechanismEditor.prototype.findRodNear = function(wx, wy, threshold) {
    threshold = (threshold || 10) / this.zoom;
    for (var i = this.rods.length - 1; i >= 0; i--) {
      var r = this.rods[i];
      var na = this.getNodeById(r.a);
      var nb = this.getNodeById(r.b);
      if (na && nb) {
        var proj = [];
        Math2D.projectPointOnLine(wx, wy, na.x, na.y, nb.x, nb.y, proj);
        if (proj[2] >= 0 && proj[2] <= 1) {
          var d = Math2D.dist(wx, wy, proj[0], proj[1]);
          if (d <= threshold) return i;
        }
      }
    }
    return -1;
  };

  MechanismEditor.prototype.findSpringNear = function(wx, wy, threshold) {
    threshold = (threshold || 12) / this.zoom;
    for (var i = this.springs.length - 1; i >= 0; i--) {
      var s = this.springs[i];
      var na = this.getNodeById(s.a);
      var nb = this.getNodeById(s.b);
      if (na && nb) {
        var proj = [];
        Math2D.projectPointOnLine(wx, wy, na.x, na.y, nb.x, nb.y, proj);
        if (proj[2] >= 0 && proj[2] <= 1) {
          var d = Math2D.dist(wx, wy, proj[0], proj[1]);
          if (d <= threshold) return i;
        }
      }
    }
    return -1;
  };

  MechanismEditor.prototype.findSliderNear = function(wx, wy, threshold) {
    threshold = (threshold || 16) / this.zoom;
    for (var i = this.sliders.length - 1; i >= 0; i--) {
      var s = this.sliders[i];
      var sn = this.getNodeById(s.node);
      if (sn && Math2D.dist(wx, wy, sn.x, sn.y) <= threshold * 1.8) {
        return i;
      }
      var na = this.getNodeById(s.aNode);
      var nb = this.getNodeById(s.bNode);
      if (na && nb) {
        var proj = [];
        Math2D.projectPointOnLine(wx, wy, na.x, na.y, nb.x, nb.y, proj);
        if (proj[2] >= -0.05 && proj[2] <= 1.05) {
          var d = Math2D.dist(wx, wy, proj[0], proj[1]);
          if (d <= Math.max(threshold, 18 / this.zoom)) {
            return i;
          }
        }
      }
    }
    return -1;
  };

  MechanismEditor.prototype.findBeltNear = function(wx, wy, threshold) {
    threshold = (threshold || 10) / this.zoom;
    for (var i = this.belts.length - 1; i >= 0; i--) {
      var b = this.belts[i];
      var pA = this.pulleys[b.pulleyA];
      var pB = this.pulleys[b.pulleyB];
      if (pA && pB) {
        var nA = this.getNodeById(pA.nodeId);
        var nB = this.getNodeById(pB.nodeId);
        if (nA && nB) {
          var proj = [];
          Math2D.projectPointOnLine(wx, wy, nA.x, nA.y, nB.x, nB.y, proj);
          if (proj[2] >= 0 && proj[2] <= 1) {
            var d = Math2D.dist(wx, wy, proj[0], proj[1]);
            if (d <= Math.max(pA.radius, pB.radius) + threshold) return i;
          }
        }
      }
    }
    return -1;
  };

  MechanismEditor.prototype.findGenevaNear = function(wx, wy) {
    for (var i = this.genevas.length - 1; i >= 0; i--) {
      var gen = this.genevas[i];
      var c2 = this.getNodeById(gen.genevaCenterNode);
      if (c2 && Math2D.dist(wx, wy, c2.x, c2.y) <= gen.radius * 1.2) {
        return i;
      }
    }
    return -1;
  };

  MechanismEditor.prototype.findMotorNear = function(wx, wy) {
    var ringTol = 10 / this.zoom;
    for (var i = this.motors.length - 1; i >= 0; i--) {
      var mot = this.motors[i];
      var cNode = this.getNodeById(mot.centerNode);
      if (!cNode) continue;
      var crNode = this.getNodeById(mot.crankNode);
      var rDist = crNode ? Math2D.dist(cNode.x, cNode.y, crNode.x, crNode.y) : 0;
      var arrowR = Math.max(18, rDist * 0.7);
      var d = Math2D.dist(wx, wy, cNode.x, cNode.y);
      if (Math.abs(d - arrowR) <= ringTol) return i;
    }
    return -1;
  };

  MechanismEditor.prototype.findElementNear = function(wx, wy) {
    var nId = this.findNodeNear(wx, wy);
    if (nId !== -1) return { type: 'node', index: nId, id: nId, item: this.getNodeById(nId) };

    var motIdx = this.findMotorNear(wx, wy);
    if (motIdx !== -1) return { type: 'motor', index: motIdx, item: this.motors[motIdx] };

    var camIdx = this.findCamNear(wx, wy);
    if (camIdx !== -1) return { type: 'cam', index: camIdx, item: this.cams[camIdx] };

    var pulIdx = this.findPulleyNear(wx, wy);
    if (pulIdx !== -1) return { type: 'pulley', index: pulIdx, item: this.pulleys[pulIdx] };

    var gearIdx = this.findGearNear(wx, wy);
    if (gearIdx !== -1) return { type: 'gear', index: gearIdx, item: this.gears[gearIdx] };

    var genIdx = this.findGenevaNear(wx, wy);
    if (genIdx !== -1) return { type: 'geneva', index: genIdx, item: this.genevas[genIdx] };

    var slIdx = this.findSliderNear(wx, wy);
    if (slIdx !== -1) return { type: 'slider', index: slIdx, item: this.sliders[slIdx] };

    var spIdx = this.findSpringNear(wx, wy);
    if (spIdx !== -1) return { type: 'spring', index: spIdx, item: this.springs[spIdx] };

    var rodIdx = this.findRodNear(wx, wy);
    if (rodIdx !== -1) return { type: 'rod', index: rodIdx, item: this.rods[rodIdx] };

    var beltIdx = this.findBeltNear(wx, wy);
    if (beltIdx !== -1) return { type: 'belt', index: beltIdx, item: this.belts[beltIdx] };

    return null;
  };

  MechanismEditor.prototype.getNodeById = function(id) {
    for (var i = 0; i < this.nodes.length; i++) {
      if (this.nodes[i].id === id) return this.nodes[i];
    }
    return null;
  };

  MechanismEditor.prototype.setTool = function(tool) {
    this.activeTool = tool;
    this.isConnecting = false;
    this.isConnectingSpring = false;
    this.connectStartNode = -1;
    this._beltStartPulley = undefined;
    this.render();
  };

  MechanismEditor.prototype.addNode = function(wx, wy, fixed) {
    this.saveState();
    var id = this.nodes.length;
    var node = {
      id: id,
      x: Math.round(wx),
      y: Math.round(wy),
      fixed: !!fixed,
      mass: 1.0,
      parentGear: null
    };
    this.nodes.push(node);
    this._notifyChange();
    return id;
  };

  MechanismEditor.prototype.toggleFixed = function(nodeId) {
    var n = this.getNodeById(nodeId);
    if (n) {
      this.saveState();
      n.fixed = !n.fixed;
      this._notifyChange();
    }
  };

  MechanismEditor.prototype.addRod = function(aId, bId, style) {
    if (aId === bId) return;
    for (var i = 0; i < this.rods.length; i++) {
      var r = this.rods[i];
      if ((r.a === aId && r.b === bId) || (r.a === bId && r.b === aId)) return;
    }
    var na = this.getNodeById(aId);
    var nb = this.getNodeById(bId);
    if (!na || !nb) return;

    this.saveState();
    var len = Math2D.dist(na.x, na.y, nb.x, nb.y);
    var angleLock = (style && style.angleLock) || 'none';
    var lockedAngle = (style && style.lockedAngle !== undefined) ? style.lockedAngle :
                      (angleLock === 'fixed' ? Math.atan2(nb.y - na.y, nb.x - na.x) : 0);
    var rod = {
      a: aId,
      b: bId,
      length: len,
      width: (style && style.width) || 12,
      color: (style && style.color) || '#3b82f6',
      angleLock: angleLock,
      lockedAngle: lockedAngle
    };
    this.rods.push(rod);
    this._notifyChange();
    return rod;
  };

  MechanismEditor.prototype.addSpring = function(aId, bId, options) {
    if (aId === bId) return;
    for (var i = 0; i < this.springs.length; i++) {
      var s = this.springs[i];
      if ((s.a === aId && s.b === bId) || (s.a === bId && s.b === aId)) return;
    }
    var na = this.getNodeById(aId);
    var nb = this.getNodeById(bId);
    if (!na || !nb) return;

    this.saveState();
    options = options || {};
    var len = Math2D.dist(na.x, na.y, nb.x, nb.y);
    var spring = {
      a: aId,
      b: bId,
      restLength: options.restLength !== undefined ? options.restLength : len,
      stiffness: options.stiffness !== undefined ? options.stiffness : 200.0,
      damping: options.damping !== undefined ? options.damping : 2.0,
      width: options.width || 14,
      color: options.color || '#10b981'
    };
    this.springs.push(spring);
    this._notifyChange();
    return spring;
  };

  MechanismEditor.prototype.addRigidBracket = function(aId, bId, cId) {
    if (aId === bId || bId === cId || aId === cId) return;
    this.saveState();
    this.addRod(aId, bId);
    this.addRod(bId, cId);
    var na = this.getNodeById(aId);
    var nc = this.getNodeById(cId);
    if (na && nc) {
      this.addRod(aId, cId, { width: 4, color: 'rgba(99, 102, 241, 0.2)' });
    }
    this.brackets.push({ a: aId, b: bId, c: cId, width: 14, color: '#6366f1' });
    this._notifyChange();
  };

  MechanismEditor.prototype.addSlider = function(nodeId, aNodeId, bNodeId, options) {
    options = options || {};
    this.saveState();
    this.sliders.push({
      node: nodeId,
      aNode: aNodeId,
      bNode: bNodeId,
      minT: (options.minT !== undefined) ? options.minT : undefined,
      maxT: (options.maxT !== undefined) ? options.maxT : undefined,
      friction: options.friction || 0
    });
    this._notifyChange();
  };

  MechanismEditor.prototype.addLever = function(pivotX, pivotY, options) {
    this.saveState();
    options = options || {};
    var armLength = options.armLength || 50;
    var handleLength = options.handleLength || 60;
    var angle = options.angle !== undefined ? options.angle : -Math.PI / 2; // Pointing upwards

    // Pivot pin (ground anchor)
    var pId = this.addNode(pivotX, pivotY, true);

    // Handle node (draggable knob, pointing in direction of angle)
    var hX = pivotX + handleLength * Math.cos(angle);
    var hY = pivotY + handleLength * Math.sin(angle);
    var hId = this.addNode(hX, hY, false);
    var hNode = this.getNodeById(hId);
    if (hNode) hNode.isHandle = true;

    // Output arm node (pointing opposite)
    var outAngle = angle + Math.PI;
    var oX = pivotX + armLength * Math.cos(outAngle);
    var oY = pivotY + armLength * Math.sin(outAngle);
    var oId = this.addNode(oX, oY, false);

    // Rigid bracket connecting pivot, handle, and output arm
    this.addRigidBracket(hId, pId, oId);

    this._notifyChange();
    return { pivotNode: pId, handleNode: hId, outputNode: oId };
  };

  MechanismEditor.prototype.addGear = function(centerId, radius, teeth, options) {
    this.saveState();
    var cNode = this.getNodeById(centerId);
    if (!cNode) return;
    options = options || {};
    if (options.fixed !== undefined) {
      cNode.fixed = !!options.fixed;
    } else if (cNode.fixed === undefined) {
      cNode.fixed = true; // Default to fixed unless already specified false (e.g. on a slider)
    }

    radius = radius || 45;
    teeth = teeth || Math.max(8, Math.round(radius / 3));

    var gearIdx = this.gears.length;
    var gear = {
      centerNode: centerId,
      radius: radius,
      teeth: teeth,
      meshWith: []
    };

    // Auto-mesh with existing gears if pitch radii intersect or touch
    for (var i = 0; i < this.gears.length; i++) {
      var other = this.gears[i];
      var oNode = this.getNodeById(other.centerNode);
      if (oNode) {
        var d = Math2D.dist(cNode.x, cNode.y, oNode.x, oNode.y);
        var targetDist = gear.radius + other.radius;
        if (Math.abs(d - targetDist) < 20) {
          gear.meshWith.push(i);
          other.meshWith.push(gearIdx);
        }
      }
    }

    this.gears.push(gear);
    this._notifyChange();
  };

  MechanismEditor.prototype.attachNodeToGear = function(nodeId, gearIdx) {
    var gear = this.gears[gearIdx];
    var node = this.getNodeById(nodeId);
    if (!gear || !node) return;
    var cNode = this.getNodeById(gear.centerNode);
    if (!cNode) return;

    this.saveState();
    var r = Math2D.dist(cNode.x, cNode.y, node.x, node.y);
    var angleOffset = Math.atan2(node.y - cNode.y, node.x - cNode.x);
    node.parentGear = {
      gearIdx: gearIdx,
      radius: r,
      angleOffset: angleOffset
    };
    this._notifyChange();
  };

  MechanismEditor.prototype.addCrankpinOnGear = function(gearIdx) {
    var gear = this.gears[gearIdx];
    if (!gear) return;
    var cNode = this.getNodeById(gear.centerNode);
    if (!cNode) return;

    this.saveState();
    var pinRadius = gear.radius * 0.75;
    var pinX = cNode.x + pinRadius;
    var pinY = cNode.y;
    var pinId = this.addNode(pinX, pinY, false);
    this.attachNodeToGear(pinId, gearIdx);
  };

  MechanismEditor.prototype.attachNodeToPulley = function(nodeId, pulleyIdx) {
    var pul = this.pulleys[pulleyIdx];
    var node = this.getNodeById(nodeId);
    if (!pul || !node) return;
    var cNode = this.getNodeById(pul.nodeId);
    if (!cNode) return;

    this.saveState();
    var r = Math2D.dist(cNode.x, cNode.y, node.x, node.y);
    var angleOffset = Math.atan2(node.y - cNode.y, node.x - cNode.x);
    node.parentPulley = {
      pulleyIdx: pulleyIdx,
      radius: r,
      angleOffset: angleOffset
    };
    this._notifyChange();
  };

  MechanismEditor.prototype.attachNodeToCam = function(nodeId, camIdx) {
    var cam = this.cams[camIdx];
    var node = this.getNodeById(nodeId);
    if (!cam || !node) return;
    var cNode = this.getNodeById(cam.centerNode);
    if (!cNode) return;

    this.saveState();
    var r = Math2D.dist(cNode.x, cNode.y, node.x, node.y);
    var angleOffset = Math.atan2(node.y - cNode.y, node.x - cNode.x);
    node.parentCam = {
      camIdx: camIdx,
      radius: r,
      angleOffset: angleOffset
    };
    this._notifyChange();
  };

  MechanismEditor.prototype.attachNodeToGeneva = function(nodeId, genevaIdx) {
    var gen = this.genevas[genevaIdx];
    var node = this.getNodeById(nodeId);
    if (!gen || !node) return;
    var cNode = this.getNodeById(gen.genevaCenterNode);
    if (!cNode) return;

    this.saveState();
    var r = Math2D.dist(cNode.x, cNode.y, node.x, node.y);
    var angleOffset = Math.atan2(node.y - cNode.y, node.x - cNode.x);
    node.parentGeneva = {
      genevaIdx: genevaIdx,
      radius: r,
      angleOffset: angleOffset
    };
    this._notifyChange();
  };

  MechanismEditor.prototype.createPinOnTarget = function(elem, wx, wy) {
    if (!elem) return -1;
    var pinId = this.addNode(wx, wy, false);
    if (elem.type === 'gear') {
      this.attachNodeToGear(pinId, elem.index);
    } else if (elem.type === 'pulley') {
      this.attachNodeToPulley(pinId, elem.index);
    } else if (elem.type === 'cam') {
      this.attachNodeToCam(pinId, elem.index);
    } else if (elem.type === 'geneva') {
      this.attachNodeToGeneva(pinId, elem.index);
    }
    return pinId;
  };

  MechanismEditor.prototype.rotateSliderRail = function(sliderIdx, angleDeg, railLength) {
    var sl = this.sliders[sliderIdx];
    if (!sl) return;
    var na = this.getNodeById(sl.aNode);
    var nb = this.getNodeById(sl.bNode);
    if (!na || !nb) return;

    this.saveState();
    var cx = (na.x + nb.x) / 2;
    var cy = (na.y + nb.y) / 2;
    var L = (railLength !== undefined && railLength > 10) ? railLength : Math2D.dist(na.x, na.y, nb.x, nb.y);
    if (L < 20) L = 140;

    var rad = (angleDeg || 0) * Math.PI / 180;
    var halfL = L / 2;
    na.x = cx - halfL * Math.cos(rad);
    na.y = cy - halfL * Math.sin(rad);
    nb.x = cx + halfL * Math.cos(rad);
    nb.y = cy + halfL * Math.sin(rad);

    var sNode = this.getNodeById(sl.node);
    if (sNode) {
      var proj = Math2D.projectPointOnLine(sNode.x, sNode.y, na.x, na.y, nb.x, nb.y);
      sNode.x = proj[0];
      sNode.y = proj[1];
    }
    this._notifyChange();
  };

  MechanismEditor.prototype.finishCustomShape = function() {
    var n = this.shapeVertices.length;
    if (n < 3) {
      this.shapeVertices = [];
      this.render();
      return;
    }
    var sumX = 0, sumY = 0;
    for (var i = 0; i < n; i++) {
      sumX += this.shapeVertices[i].x;
      sumY += this.shapeVertices[i].y;
    }
    var cx = sumX / n;
    var cy = sumY / n;
    var maxR = 0;
    var localPts = [];
    for (var i = 0; i < n; i++) {
      var lx = this.shapeVertices[i].x - cx;
      var ly = this.shapeVertices[i].y - cy;
      var dist = Math.hypot(lx, ly);
      if (dist > maxR) maxR = dist;
      localPts.push([Math.round(lx * 10) / 10, Math.round(ly * 10) / 10]);
    }
    this.saveState();
    var cId = this.addNode(cx, cy, true);
    this.addCam(cId, 'custom', Math.max(15, Math.round(maxR)), 0, { points: localPts });
    this.shapeVertices = [];
    this.setTool('select');
    this._notifyChange();
  };

  MechanismEditor.prototype.addMotor = function(centerId, crankId, speed, options) {
    options = options || {};
    this.saveState();
    this.motors.push({
      centerNode: centerId,
      crankNode: crankId,
      speed: speed !== undefined ? speed : 2.5,
      maxTorque: (options.maxTorque !== undefined) ? options.maxTorque : (options.torque !== undefined ? options.torque : Infinity)
    });
    this._notifyChange();
  };

  MechanismEditor.prototype.deleteElementAt = function(wx, wy) {
    var elem = this.findElementNear(wx, wy);
    if (elem) {
      this.selection = elem;
      this.deleteSelection();
      return;
    }
  };

  MechanismEditor.prototype.deleteNode = function(id) {
    this.saveState();
    this.rods = this.rods.filter(function(r) { return r.a !== id && r.b !== id; });
    this.springs = (this.springs || []).filter(function(s) { return s.a !== id && s.b !== id; });
    this.sliders = this.sliders.filter(function(s) { return s.node !== id && s.aNode !== id && s.bNode !== id; });
    this.gears = this.gears.filter(function(g) { return g.centerNode !== id; });
    this.motors = this.motors.filter(function(m) { return m.centerNode !== id && m.crankNode !== id; });
    this.brackets = this.brackets.filter(function(b) { return b.a !== id && b.b !== id && b.c !== id; });
    this.cams = (this.cams || []).filter(function(c) { return c.centerNode !== id; });
    this.camContacts = (this.camContacts || []).filter(function(cc) { return cc.followerNode !== id; });
    this.pulleys = (this.pulleys || []).filter(function(p) { return p.nodeId !== id; });
    this.genevas = (this.genevas || []).filter(function(g) {
      return g.driverCenterNode !== id && g.driverPinNode !== id && g.genevaCenterNode !== id;
    });
    this.nodes = this.nodes.filter(function(n) { return n.id !== id; });
    this.trackedNodes.delete(id);
    if (this.renderer && this.renderer.traces) {
      delete this.renderer.traces[id];
    }
    if (this.selection && this.selection.type === 'node' && (this.selection.id === id || this.selection.index === id)) {
      this.selection = null;
    }
    this._notifyChange();
  };

  MechanismEditor.prototype.deleteGear = function(gearIdx) {
    this.saveState();
    this.gears.splice(gearIdx, 1);
    for (var i = 0; i < this.gears.length; i++) {
      this.gears[i].meshWith = this.gears[i].meshWith
        .filter(function(idx) { return idx !== gearIdx; })
        .map(function(idx) { return idx > gearIdx ? idx - 1 : idx; });
    }
    if (this.selection && this.selection.type === 'gear' && this.selection.index === gearIdx) {
      this.selection = null;
    }
    this._notifyChange();
  };

  MechanismEditor.prototype.deleteSpring = function(springIdx) {
    if (springIdx >= 0 && springIdx < this.springs.length) {
      this.saveState();
      this.springs.splice(springIdx, 1);
      if (this.selection && this.selection.type === 'spring' && this.selection.index === springIdx) {
        this.selection = null;
      }
      this._notifyChange();
    }
  };

  MechanismEditor.prototype.deletePulley = function(pulleyIdx) {
    if (pulleyIdx >= 0 && pulleyIdx < this.pulleys.length) {
      this.saveState();
      this.belts = this.belts.filter(function(b) {
        return b.pulleyA !== pulleyIdx && b.pulleyB !== pulleyIdx;
      }).map(function(b) {
        return {
          pulleyA: b.pulleyA > pulleyIdx ? b.pulleyA - 1 : b.pulleyA,
          pulleyB: b.pulleyB > pulleyIdx ? b.pulleyB - 1 : b.pulleyB,
          crossed: b.crossed,
          width: b.width
        };
      });
      this.pulleys.splice(pulleyIdx, 1);
      if (this.selection && this.selection.type === 'pulley' && this.selection.index === pulleyIdx) {
        this.selection = null;
      }
      this._notifyChange();
    }
  };

  MechanismEditor.prototype.deleteCam = function(camIdx) {
    if (camIdx >= 0 && camIdx < this.cams.length) {
      this.saveState();
      this.camContacts = this.camContacts.filter(function(cc) { return cc.camIdx !== camIdx; })
        .map(function(cc) {
          return {
            camIdx: cc.camIdx > camIdx ? cc.camIdx - 1 : cc.camIdx,
            followerNode: cc.followerNode,
            rollerRadius: cc.rollerRadius
          };
        });
      this.cams.splice(camIdx, 1);
      if (this.selection && this.selection.type === 'cam' && this.selection.index === camIdx) {
        this.selection = null;
      }
      this._notifyChange();
    }
  };

  MechanismEditor.prototype.deleteBelt = function(beltIdx) {
    if (beltIdx >= 0 && beltIdx < this.belts.length) {
      this.saveState();
      this.belts.splice(beltIdx, 1);
      if (this.selection && this.selection.type === 'belt' && this.selection.index === beltIdx) {
        this.selection = null;
      }
      this._notifyChange();
    }
  };

  MechanismEditor.prototype.deleteSlider = function(sliderIdx) {
    if (sliderIdx >= 0 && sliderIdx < this.sliders.length) {
      this.saveState();
      this.sliders.splice(sliderIdx, 1);
      if (this.selection && this.selection.type === 'slider' && this.selection.index === sliderIdx) {
        this.selection = null;
      }
      this._notifyChange();
    }
  };

  MechanismEditor.prototype.deleteSelection = function() {
    if (!this.selection) return;
    var type = this.selection.type;
    var idx = this.selection.index;
    if (type === 'node') {
      this.deleteNode(this.selection.id !== undefined ? this.selection.id : idx);
    } else if (type === 'gear') {
      this.deleteGear(idx);
    } else if (type === 'pulley') {
      this.deletePulley(idx);
    } else if (type === 'cam') {
      this.deleteCam(idx);
    } else if (type === 'rod') {
      this.saveState();
      this.rods.splice(idx, 1);
      this._notifyChange();
    } else if (type === 'spring') {
      this.deleteSpring(idx);
    } else if (type === 'belt') {
      this.deleteBelt(idx);
    } else if (type === 'slider') {
      this.deleteSlider(idx);
    } else if (type === 'geneva') {
      this.saveState();
      this.genevas.splice(idx, 1);
      this._notifyChange();
    } else if (type === 'motor') {
      this.deleteMotor(idx);
    }
    this.selection = null;
  };

  MechanismEditor.prototype.deleteMotor = function(idx) {
    if (idx >= 0 && idx < this.motors.length) {
      this.saveState();
      this.motors.splice(idx, 1);
      if (this.selection && this.selection.type === 'motor' && this.selection.index === idx) {
        this.selection = null;
      }
      this._notifyChange();
    }
  };

  MechanismEditor.prototype.clear = function() {
    this.saveState();
    this.nodes = [];
    this.rods = [];
    this.springs = [];
    this.sliders = [];
    this.gears = [];
    this.motors = [];
    this.brackets = [];
    this.genevas = [];
    this.pulleys = [];
    this.belts = [];
    this.axles = [];
    this.cams = [];
    this.camContacts = [];
    this.labels = [];
    this.shapeVertices = [];
    this.selection = null;
    this.trackedNodes.clear();
    if (this.renderer) {
      this.renderer.clearTraces();
    }
    this.selectedNodeId = -1;
    this.isConnecting = false;
    this.isConnectingSpring = false;
    this._notifyChange();
  };

  MechanismEditor.prototype._notifyChange = function() {
    this.render();
    if (this.onModelChanged) {
      this.onModelChanged(this.exportJSON());
    }
  };

  MechanismEditor.prototype.exportJSON = function() {
    return {
      version: '2.0',
      nodes: JSON.parse(JSON.stringify(this.nodes)),
      rods: JSON.parse(JSON.stringify(this.rods)),
      springs: JSON.parse(JSON.stringify(this.springs || [])),
      sliders: JSON.parse(JSON.stringify(this.sliders)),
      gears: JSON.parse(JSON.stringify(this.gears)),
      motors: JSON.parse(JSON.stringify(this.motors)),
      brackets: JSON.parse(JSON.stringify(this.brackets)),
      genevas: JSON.parse(JSON.stringify(this.genevas)),
      pulleys: JSON.parse(JSON.stringify(this.pulleys)),
      belts: JSON.parse(JSON.stringify(this.belts)),
      axles: JSON.parse(JSON.stringify(this.axles)),
      cams: JSON.parse(JSON.stringify(this.cams)),
      camContacts: JSON.parse(JSON.stringify(this.camContacts)),
      labels: JSON.parse(JSON.stringify(this.labels || []))
    };
  };

  MechanismEditor.prototype.loadJSON = function(data) {
    if (!data) return;
    this.nodes = data.nodes || [];
    this.rods = data.rods || [];
    this.springs = data.springs || [];
    this.sliders = data.sliders || [];
    this.gears = data.gears || [];
    this.motors = data.motors || [];
    this.brackets = data.brackets || [];
    this.genevas = data.genevas || [];
    this.pulleys = data.pulleys || [];
    this.belts = data.belts || [];
    this.axles = data.axles || [];
    this.cams = data.cams || [];
    this.camContacts = data.camContacts || [];
    this.labels = data.labels || [];
    this.selectedNodeId = -1;
    this.selection = null;
    this.isConnecting = false;
    this.isConnectingSpring = false;
    this._notifyChange();
  };

  MechanismEditor.prototype.addPulley = function(nodeId, radius, options) {
    this.saveState();
    options = options || {};
    var pulley = {
      nodeId: nodeId,
      radius: radius || 30,
      width: options.width || 8
    };
    this.pulleys.push(pulley);
    this._notifyChange();
    return pulley;
  };

  MechanismEditor.prototype.addBelt = function(pulleyA, pulleyB, options) {
    this.saveState();
    options = options || {};
    var belt = {
      pulleyA: pulleyA,
      pulleyB: pulleyB,
      crossed: !!options.crossed,
      width: options.width || 6
    };
    this.belts.push(belt);
    this._notifyChange();
    return belt;
  };

  MechanismEditor.prototype.addAxle = function(targetA, targetB, options) {
    this.saveState();
    options = options || {};
    var axle = {
      targetA: targetA,
      targetB: targetB,
      ratio: options.ratio || 1.0,
      shaftNodeA: options.shaftNodeA,
      shaftNodeB: options.shaftNodeB
    };
    this.axles.push(axle);
    this._notifyChange();
    return axle;
  };

  MechanismEditor.prototype.addCam = function(centerNode, profileType, baseRadius, lift, options) {
    this.saveState();
    options = options || {};
    var cam = {
      centerNode: centerNode,
      profileType: profileType || 'pear',
      baseRadius: baseRadius || 35,
      lift: lift !== undefined ? lift : 20,
      options: options
    };
    this.cams.push(cam);
    this._notifyChange();
    return cam;
  };

  MechanismEditor.prototype.addCamContact = function(camIdx, followerNode, rollerRadius) {
    this.saveState();
    var contact = {
      camIdx: camIdx,
      followerNode: followerNode,
      rollerRadius: rollerRadius !== undefined ? rollerRadius : 8
    };
    this.camContacts.push(contact);
    this._notifyChange();
    return contact;
  };

  MechanismEditor.prototype.addGeneva = function(driverCenter, driverPin, genevaCenter, slots, options) {
    this.saveState();
    options = options || {};
    var c1 = this.getNodeById(driverCenter);
    var c2 = this.getNodeById(genevaCenter);
    var D = Math2D.dist(c1.x, c1.y, c2.x, c2.y);
    if (D < 1e-4) D = 100;
    var numSlots = slots || 4;
    var beta = Math.PI / numSlots;
    var pinRadius = D * Math.sin(beta);
    var wheelRadius = D * Math.cos(beta);
    var lockRadius = Math.max(10, D - pinRadius);

    var geneva = {
      driverCenterNode: driverCenter,
      driverPinNode: driverPin,
      genevaCenterNode: genevaCenter,
      slots: numSlots,
      centerDist: D,
      pinRadius: pinRadius,
      radius: wheelRadius,
      lockRadius: lockRadius,
      slotWidth: options.slotWidth || 10,
      angle: options.initialAngle || 0
    };
    this.genevas.push(geneva);
    this._notifyChange();
    return geneva;
  };


  MechanismEditor.prototype.addLabel = function(x, y, text, options) {
    this.saveState();
    options = options || {};
    var label = {
      x: x,
      y: y,
      text: text || 'Label',
      fontSize: options.fontSize || 14,
      color: options.color || '#1e293b',
      bold: !!options.bold
    };
    this.labels.push(label);
    this._notifyChange();
    return label;
  };

  MechanismEditor.prototype.deleteLabel = function(idx) {
    this.saveState();
    this.labels.splice(idx, 1);
    this._notifyChange();
  };

  MechanismEditor.prototype.findLabelNear = function(wx, wy) {
    for (var i = this.labels.length - 1; i >= 0; i--) {
      var lb = this.labels[i];
      var dx = wx - lb.x;
      var dy = wy - lb.y;
      if (Math.abs(dx) < (lb.text.length * lb.fontSize * 0.35) && Math.abs(dy) < lb.fontSize * 1.5) {
        return i;
      }
    }
    return -1;
  };

  MechanismEditor.prototype._bindEvents = function() {
    var self = this;
    var canvas = this.canvas;
    if (!canvas || !canvas.addEventListener) return;

    canvas.addEventListener('mousedown', function(e) {
      var w = self.screenToWorld(e.clientX, e.clientY);
      self.mouseWorldX = w.x;
      self.mouseWorldY = w.y;

      // Right Click = Context Menu
      if (e.button === 2) {
        e.preventDefault();
        var elem = self.findElementNear(w.x, w.y);
        var targetType = 'empty';
        var targetData = { x: w.x, y: w.y };

        if (elem) {
          self.selection = elem;
          targetType = elem.type;
          targetData = elem.item;
          if (elem.type === 'node') {
            self.selectedNodeId = elem.index;
          }
        } else {
          self.selection = null;
        }

        if (self.onShowContextMenu) {
          self.onShowContextMenu(e.clientX, e.clientY, targetType, elem || targetData);
        }
        self.render();
        return;
      }

      // Middle Button = Pan View
      if (e.button === 1) {
        self.isPanning = true;
        self.panStartX = e.clientX - self.panX;
        self.panStartY = e.clientY - self.panY;
        e.preventDefault();
        return;
      }

      // Left Click
      var nearNode = self.findNodeNear(w.x, w.y);
      var nearGear = self.findGearNear(w.x, w.y);

      // In Simulate Mode: Direct Hand Interaction
      if (self.mode === 'simulate') {
        if (nearGear !== -1) {
          var g = self.gears[nearGear];
          var cNode = self.getNodeById(g.centerNode);
          if (cNode) {
            self.isTurningGear = true;
            self.turningGearIdx = nearGear;
            self.prevGearMouseAngle = Math.atan2(w.y - cNode.y, w.x - cNode.x);
            if (self.onHumanInputStart) {
              self.onHumanInputStart('gear', nearGear);
            }
            return;
          }
        }
        if (nearNode !== -1) {
          self.selectedNodeId = nearNode;
          self.isDragging = true;
          if (self.onHumanInputStart) {
            self.onHumanInputStart('node', nearNode);
          }
          if (self.onDirectDragNode) {
            self.onDirectDragNode(nearNode, w.x, w.y);
          }
          return;
        }
        var nearSlider = self.findSliderNear(w.x, w.y);
        if (nearSlider !== -1) {
          var sl = self.sliders[nearSlider];
          self.selectedNodeId = sl.node;
          self.isDragging = true;
          if (self.onHumanInputStart) {
            self.onHumanInputStart('slider', sl.node);
          }
          if (self.onDirectDragNode) {
            self.onDirectDragNode(sl.node, w.x, w.y);
          }
          return;
        }
        self.isPanning = true;
        self.panStartX = e.clientX - self.panX;
        self.panStartY = e.clientY - self.panY;
        return;
      }

      // In Edit Mode: Draw Custom Shape / Polygon
      if (self.activeTool === 'draw_shape') {
        if (self.shapeVertices.length >= 3) {
          var firstV = self.shapeVertices[0];
          if (Math2D.dist(w.x, w.y, firstV.x, firstV.y) < 18 / self.zoom) {
            self.finishCustomShape();
            self.render();
            return;
          }
        }
        self.shapeVertices.push({ x: w.x, y: w.y });
        self.render();
        return;
      }

      // In Edit Mode: Universal Element Selection and Tool Interactions
      var elem = self.findElementNear(w.x, w.y);

      if (elem) {
        if (self.activeTool === 'select') {
          self.selection = elem;
          if (elem.type === 'node') {
            self.selectedNodeId = elem.index;
            self.isDragging = true;
          }
        } else if (self.activeTool === 'delete') {
          self.selection = elem;
          self.deleteSelection();
        } else if ((self.activeTool === 'add_node' || self.activeTool === 'add_pin') &&
                   (elem.type === 'gear' || elem.type === 'pulley' || elem.type === 'cam' || elem.type === 'geneva')) {
          // Direct click on a moving target (gear, pulley, cam, geneva) creates an attached connection pin!
          self.createPinOnTarget(elem, w.x, w.y);
          self.render();
          return;
        } else if (self.activeTool === 'add_rod') {
          if (elem.type === 'node') {
            self.connectStartNode = elem.index;
            self.isConnecting = true;
          } else if (elem.type === 'gear' || elem.type === 'pulley' || elem.type === 'cam' || elem.type === 'geneva') {
            var pinId = self.createPinOnTarget(elem, w.x, w.y);
            self.connectStartNode = pinId;
            self.isConnecting = true;
          }
        } else if (self.activeTool === 'add_spring') {
          if (elem.type === 'node') {
            self.connectStartNode = elem.index;
            self.isConnectingSpring = true;
          } else if (elem.type === 'gear' || elem.type === 'pulley' || elem.type === 'cam' || elem.type === 'geneva') {
            var pinId = self.createPinOnTarget(elem, w.x, w.y);
            self.connectStartNode = pinId;
            self.isConnectingSpring = true;
          }
        } else if (self.activeTool === 'add_gear' && elem.type === 'node') {
          self.addGear(elem.index, 45, 15);
        } else if (self.activeTool === 'add_pulley' && elem.type === 'node') {
          self.addPulley(elem.index, 35);
        } else if (self.activeTool === 'add_cam' && elem.type === 'node') {
          self.addCam(elem.index, 'pear', 35, 25);
        } else if (self.activeTool === 'add_motor' && elem.type === 'node') {
          if (!self._motorCenter) {
            self._motorCenter = elem.index;
          } else if (self._motorCenter !== elem.index) {
            self.addMotor(self._motorCenter, elem.index);
            self._motorCenter = null;
          }
        } else if (self.activeTool === 'add_lever') {
          self.addLever(w.x, w.y);
          self.setTool('select');
          self.render();
          return;
        } else if (self.activeTool === 'add_slider' && elem.type === 'node') {
          if (!self._sliderRailStart) {
            self._sliderRailStart = elem.index;
          } else if (self._sliderRailStart !== elem.index) {
            var sNode = self.addNode((self.getNodeById(self._sliderRailStart).x + self.getNodeById(elem.index).x) / 2,
                                     (self.getNodeById(self._sliderRailStart).y + self.getNodeById(elem.index).y) / 2, false);
            self.addSlider(sNode, self._sliderRailStart, elem.index);
            self._sliderRailStart = null;
          }
        } else if (self.activeTool === 'add_belt' && elem.type === 'pulley') {
          if (self._beltStartPulley === undefined || self._beltStartPulley === null) {
            self._beltStartPulley = elem.index;
          } else if (self._beltStartPulley !== elem.index) {
            self.addBelt(self._beltStartPulley, elem.index, { crossed: !!e.shiftKey });
            self._beltStartPulley = undefined;
          }
        }
        self.render();
        return;
      }

      // If clicking in EMPTY space:
      if (self.activeTool === 'select') {
        self.selection = null;
        self.selectedNodeId = -1;
        self.isPotentialPan = true;
        self.panMouseDownX = e.clientX;
        self.panMouseDownY = e.clientY;
        self.panStartX = e.clientX - self.panX;
        self.panStartY = e.clientY - self.panY;
        self.render();
        return;
      }

      if (self.activeTool === 'add_node') {
        self.addNode(w.x, w.y, false);
        self.render();
        return;
      }
      if (self.activeTool === 'add_pin') {
        self.addNode(w.x, w.y, true);
        self.render();
        return;
      }
      if (self.activeTool === 'add_rod') {
        var startNode = self.addNode(w.x, w.y, false);
        self.connectStartNode = startNode;
        self.isConnecting = true;
        self._startedInEmptySpace = true;
        self._emptySpaceStartCoord = { x: w.x, y: w.y };
        self.render();
        return;
      }
      if (self.activeTool === 'add_spring') {
        var startNode = self.addNode(w.x, w.y, false);
        self.connectStartNode = startNode;
        self.isConnectingSpring = true;
        self._startedInEmptySpace = true;
        self._emptySpaceStartCoord = { x: w.x, y: w.y };
        self.render();
        return;
      }
      if (self.activeTool === 'add_slider') {
        self._isDraggingSliderAssembly = true;
        self._sliderDragStart = { x: w.x, y: w.y };
        self.render();
        return;
      }
      if (self.activeTool === 'add_lever') {
        self.addLever(w.x, w.y);
        self.setTool('select');
        self.render();
        return;
      }
      if (self.activeTool === 'add_gear') {
        var cId = self.addNode(w.x, w.y, true);
        self.addGear(cId, 45, 15);
        self.render();
        return;
      }
      if (self.activeTool === 'add_pulley') {
        var cId = self.addNode(w.x, w.y, true);
        self.addPulley(cId, 35);
        self.render();
        return;
      }
      if (self.activeTool === 'add_cam') {
        var cId = self.addNode(w.x, w.y, true);
        self.addCam(cId, 'pear', 35, 25);
        self.render();
        return;
      }
      if (self.activeTool === 'add_label') {
        var labelText = window.prompt('Label text:', 'Label');
        if (labelText !== null && labelText.trim() !== '') {
          self.addLabel(w.x, w.y, labelText.trim());
        }
        self.render();
        return;
      }
      if (self.activeTool === 'add_belt') {
        self._beltStartPulley = undefined;
        self.render();
        return;
      }

      self.render();
    });

    canvas.addEventListener('mousemove', function(e) {
      var w = self.screenToWorld(e.clientX, e.clientY);
      self.mouseWorldX = w.x;
      self.mouseWorldY = w.y;

      if (self.isPotentialPan) {
        var pdistX = e.clientX - self.panMouseDownX;
        var pdistY = e.clientY - self.panMouseDownY;
        if (pdistX * pdistX + pdistY * pdistY > 25) {
          self.isPanning = true;
        }
      }

      if (self.isPanning) {
        self.panX = e.clientX - self.panStartX;
        self.panY = e.clientY - self.panStartY;
        self.render();
        return;
      }

      // Manual Gear Turning in Simulate Mode
      if (self.isTurningGear && self.turningGearIdx !== -1) {
        var g = self.gears[self.turningGearIdx];
        var cNode = self.getNodeById(g.centerNode);
        if (cNode) {
          var currA = Math.atan2(w.y - cNode.y, w.x - cNode.x);
          var delta = currA - self.prevGearMouseAngle;
          self.prevGearMouseAngle = currA;
          if (Math.abs(delta) < 1.0) {
            // Send direct gear rotation to physics
            if (self.onManualRotateGear) {
              self.onManualRotateGear(self.turningGearIdx, delta);
            }
          }
        }
        return;
      }

      self.hoverNodeId = self.findNodeNear(w.x, w.y);
      self.hoverGearIdx = self.findGearNear(w.x, w.y);

      // Handle hover cursor styling for levers & sliders in simulate mode
      if (self.mode === 'simulate') {
        if (self.isDragging) {
          canvas.style.cursor = 'grabbing';
        } else if (self.hoverNodeId !== -1) {
          var hNode = self.getNodeById(self.hoverNodeId);
          canvas.style.cursor = (hNode && hNode.isHandle) ? 'grab' : 'pointer';
        } else if (self.findSliderNear(w.x, w.y) !== -1 || self.hoverGearIdx !== -1) {
          canvas.style.cursor = 'grab';
        } else {
          canvas.style.cursor = '';
        }
      } else {
        canvas.style.cursor = '';
      }

      // Dragging a node in Edit Mode
      if (self.isDragging && self.selectedNodeId !== -1 && self.mode === 'edit') {
        var node = self.getNodeById(self.selectedNodeId);
        if (node) {
          // If this node is a carriage on a slider, constrain dragging along the rail line
          var slObj = null;
          for (var si = 0; si < self.sliders.length; si++) {
            if (self.sliders[si].node === node.id) { slObj = self.sliders[si]; break; }
          }
          if (slObj) {
            var na = self.getNodeById(slObj.aNode);
            var nb = self.getNodeById(slObj.bNode);
            if (na && nb) {
              var abx = nb.x - na.x;
              var aby = nb.y - na.y;
              var lenSq = abx * abx + aby * aby;
              if (lenSq > 1e-6) {
                var u = ((w.x - na.x) * abx + (w.y - na.y) * aby) / lenSq;
                if (slObj.minT !== undefined && isFinite(slObj.minT)) u = Math.max(slObj.minT / Math.sqrt(lenSq), u);
                if (slObj.maxT !== undefined && isFinite(slObj.maxT)) u = Math.min(slObj.maxT / Math.sqrt(lenSq), u);
                node.x = Math.round(na.x + u * abx);
                node.y = Math.round(na.y + u * aby);
              } else {
                node.x = Math.round(w.x);
                node.y = Math.round(w.y);
              }
            } else {
              node.x = Math.round(w.x);
              node.y = Math.round(w.y);
            }
          } else {
            var snapId = self.findSnapNode(w.x, w.y, node.id);
            if (snapId !== -1) {
              var snapN = self.getNodeById(snapId);
              node.x = Math.round(snapN.x);
              node.y = Math.round(snapN.y);
            } else {
              node.x = Math.round(w.x);
              node.y = Math.round(w.y);
            }
          }

          // Update lengths of connected rods
          for (var i = 0; i < self.rods.length; i++) {
            var r = self.rods[i];
            if (r.a === node.id || r.b === node.id) {
              var rNa = self.getNodeById(r.a);
              var rNb = self.getNodeById(r.b);
              if (rNa && rNb) {
                r.length = Math2D.dist(rNa.x, rNa.y, rNb.x, rNb.y);
              }
            }
          }
          self._notifyChange();
        }
      }

      // Direct Physics Dragging in Simulate Mode
      if (self.isDragging && self.selectedNodeId !== -1 && self.mode === 'simulate') {
        if (self.onDirectDragNode) {
          self.onDirectDragNode(self.selectedNodeId, w.x, w.y);
        }
      }

      self.render();
    });

    if (typeof window !== 'undefined') {
      window.addEventListener('mouseup', function(e) {
        self.isPotentialPan = false;

        if (self._isDraggingSliderAssembly && self._sliderDragStart) {
          var w = self.screenToWorld(e.clientX, e.clientY);
          var sDist = Math2D.dist(self._sliderDragStart.x, self._sliderDragStart.y, w.x, w.y);
          if (sDist > 20) {
            var aId = self.addNode(self._sliderDragStart.x, self._sliderDragStart.y, true);
            var bId = self.addNode(w.x, w.y, true);
            var sId = self.addNode((self._sliderDragStart.x + w.x) / 2, (self._sliderDragStart.y + w.y) / 2, false);
            self.addSlider(sId, aId, bId);
          } else {
            // Single click in empty space: create horizontal slider assembly
            var cx = self._sliderDragStart.x;
            var cy = self._sliderDragStart.y;
            var aId = self.addNode(cx - 70, cy, true);
            var bId = self.addNode(cx + 70, cy, true);
            var sId = self.addNode(cx, cy, false);
            self.addSlider(sId, aId, bId);
          }
          self._isDraggingSliderAssembly = false;
          self._sliderDragStart = null;
        }

        if (self.isConnecting && self.connectStartNode !== -1) {
          var w = self.screenToWorld(e.clientX, e.clientY);
          var nearNode = self.findNodeNear(w.x, w.y);

          if (nearNode !== -1 && nearNode !== self.connectStartNode) {
            // Connect to existing node
            self.addRod(self.connectStartNode, nearNode);
          } else if (nearNode === -1) {
            var elemNear = self.findElementNear(w.x, w.y);
            if (elemNear && (elemNear.type === 'gear' || elemNear.type === 'pulley' || elemNear.type === 'cam' || elemNear.type === 'geneva')) {
              var targetPin = self.createPinOnTarget(elemNear, w.x, w.y);
              self.addRod(self.connectStartNode, targetPin);
            } else {
              var startN = self.getNodeById(self.connectStartNode);
              var distToStart = startN ? Math2D.dist(startN.x, startN.y, w.x, w.y) : 0;
              if (distToStart > 15) {
                var endNode = self.addNode(w.x, w.y, false);
                self.addRod(self.connectStartNode, endNode);
              } else if (self._startedInEmptySpace && startN) {
                // Single click in empty space creates horizontal 80px beam
                var endNode = self.addNode(startN.x + 80, startN.y, false);
                self.addRod(self.connectStartNode, endNode);
              }
            }
          }
        }

        if (self.isConnectingSpring && self.connectStartNode !== -1) {
          var w = self.screenToWorld(e.clientX, e.clientY);
          var nearNode = self.findNodeNear(w.x, w.y);

          if (nearNode !== -1 && nearNode !== self.connectStartNode) {
            self.addSpring(self.connectStartNode, nearNode);
          } else if (nearNode === -1) {
            var elemNear = self.findElementNear(w.x, w.y);
            if (elemNear && (elemNear.type === 'gear' || elemNear.type === 'pulley' || elemNear.type === 'cam' || elemNear.type === 'geneva')) {
              var targetPin = self.createPinOnTarget(elemNear, w.x, w.y);
              self.addSpring(self.connectStartNode, targetPin);
            } else {
              var startN = self.getNodeById(self.connectStartNode);
              var distToStart = startN ? Math2D.dist(startN.x, startN.y, w.x, w.y) : 0;
              if (distToStart > 15) {
                var endNode = self.addNode(w.x, w.y, false);
                self.addSpring(self.connectStartNode, endNode);
              } else if (self._startedInEmptySpace && startN) {
                var endNode = self.addNode(startN.x + 70, startN.y, false);
                self.addSpring(self.connectStartNode, endNode);
              }
            }
          }
        }

        self.isDragging = false;
        self.isConnecting = false;
        self.isConnectingSpring = false;
        self.connectStartNode = -1;
        self._startedInEmptySpace = false;
        self._emptySpaceStartCoord = null;
        self._isDraggingSliderAssembly = false;
        self._sliderDragStart = null;
        self.isPanning = false;
        self.isTurningGear = false;
        self.turningGearIdx = -1;
        self._pendingEmptyClick = null;

        if (self.onDirectDragRelease) {
          self.onDirectDragRelease();
        }

        self.render();
      });

      canvas.addEventListener('dblclick', function(e) {
        if (self.activeTool === 'draw_shape' && self.shapeVertices.length >= 3) {
          self.finishCustomShape();
        }
      });
    }

    // Touch Event Handling (Universal Pinch-to-Zoom, Two-Finger Pan, and Touch Long-Press)
    var touchStartDist = 0;
    var touchStartPanX = 0;
    var touchStartPanY = 0;
    var longPressTimer = null;

    canvas.addEventListener('touchstart', function(e) {
      if (e.touches.length === 1) {
        var t = e.touches[0];
        longPressTimer = setTimeout(function() {
          var w = self.screenToWorld(t.clientX, t.clientY);
          var elem = self.findElementNear(w.x, w.y);
          var type = 'empty', data = { x: w.x, y: w.y };
          if (elem) {
            self.selection = elem;
            type = elem.type;
            data = elem.item;
            if (elem.type === 'node') self.selectedNodeId = elem.index;
          } else {
            self.selection = null;
          }
          if (self.onShowContextMenu) self.onShowContextMenu(t.clientX, t.clientY, type, elem || data);
          self.render();
        }, 500);

        var me = new MouseEvent('mousedown', { clientX: t.clientX, clientY: t.clientY, button: 0 });
        canvas.dispatchEvent(me);
      } else if (e.touches.length === 2) {
        if (longPressTimer) clearTimeout(longPressTimer);
        touchStartDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        touchStartPanX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - self.panX;
        touchStartPanY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - self.panY;
      }
    }, { passive: false });

    canvas.addEventListener('touchmove', function(e) {
      if (longPressTimer) clearTimeout(longPressTimer);
      if (e.touches.length === 1) {
        var t = e.touches[0];
        var me = new MouseEvent('mousemove', { clientX: t.clientX, clientY: t.clientY, button: 0 });
        canvas.dispatchEvent(me);
      } else if (e.touches.length === 2) {
        e.preventDefault();
        var dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        if (touchStartDist > 0) {
          var factor = dist / touchStartDist;
          self.zoom = Math.max(0.2, Math.min(5.0, self.zoom * factor));
          touchStartDist = dist;
        }
        var midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        var midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        self.panX = midX - touchStartPanX;
        self.panY = midY - touchStartPanY;
        self.render();
      }
    }, { passive: false });

    canvas.addEventListener('touchend', function(e) {
      if (longPressTimer) clearTimeout(longPressTimer);
      var me = new MouseEvent('mouseup', { clientX: 0, clientY: 0, button: 0 });
      window.dispatchEvent(me);
    });

    // Double-Click Element to Open Inspector
    canvas.addEventListener('dblclick', function(e) {
      var w = self.screenToWorld(e.clientX, e.clientY);
      var nearNode = self.findNodeNear(w.x, w.y);
      var nearGear = self.findGearNear(w.x, w.y);
      var nearSlider = self.findSliderNear(w.x, w.y);
      var nearRod = self.findRodNear(w.x, w.y);
      var nearSpring = self.findSpringNear(w.x, w.y);
      var nearCam = self.findCamNear(w.x, w.y);
      var nearPulley = self.findPulleyNear(w.x, w.y);
      var nearGeneva = self.findGenevaNear(w.x, w.y);
      var nearMotor = self.findMotorNear(w.x, w.y);

      if (nearNode !== -1 && self.onConfigureElement) {
        self.onConfigureElement('node', self.getNodeById(nearNode));
      } else if (nearMotor !== -1 && self.onConfigureElement) {
        self.onConfigureElement('motor', { index: nearMotor, motor: self.motors[nearMotor] });
      } else if (nearSlider !== -1 && self.onConfigureElement) {
        self.onConfigureElement('slider', { index: nearSlider, slider: self.sliders[nearSlider] });
      } else if (nearGear !== -1 && self.onConfigureElement) {
        self.onConfigureElement('gear', { index: nearGear, gear: self.gears[nearGear] });
      } else if (nearRod !== -1 && self.onConfigureElement) {
        self.onConfigureElement('rod', { index: nearRod, rod: self.rods[nearRod] });
      } else if (nearSpring !== -1 && self.onConfigureElement) {
        self.onConfigureElement('spring', { index: nearSpring, spring: self.springs[nearSpring] });
      } else if (nearCam !== -1 && self.onConfigureElement) {
        self.onConfigureElement('cam', { index: nearCam, cam: self.cams[nearCam] });
      } else if (nearPulley !== -1 && self.onConfigureElement) {
        self.onConfigureElement('pulley', { index: nearPulley, pulley: self.pulleys[nearPulley] });
      } else if (nearGeneva !== -1 && self.onConfigureElement) {
        self.onConfigureElement('geneva', { index: nearGeneva, geneva: self.genevas[nearGeneva] });
      }
    });

    canvas.addEventListener('wheel', function(e) {
      e.preventDefault();
      var wBefore = self.screenToWorld(e.clientX, e.clientY);
      var zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      self.zoom = Math.max(0.2, Math.min(5.0, self.zoom * zoomFactor));

      var rect = self.canvas.getBoundingClientRect();
      var scaleX = self.canvas.width / rect.width;
      var scaleY = self.canvas.height / rect.height;
      var canvasPx = (e.clientX - rect.left) * scaleX;
      var canvasPy = (e.clientY - rect.top) * scaleY;

      self.panX = canvasPx - wBefore.x * self.zoom;
      self.panY = canvasPy - wBefore.y * self.zoom;
      self.render();
    });

    canvas.addEventListener('contextmenu', function(e) {
      e.preventDefault();
    });
  };

  MechanismEditor.prototype.render = function(simPhysics) {
    var ctx = this.ctx;
    var canvas = this.canvas;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    this._drawGrid(ctx);

    ctx.save();
    ctx.translate(this.panX, this.panY);
    ctx.scale(this.zoom, this.zoom);

    // In simulate mode, display live physics positions; in edit mode, display editor positions
    var nodes = this.nodes;
    var nodePositions = {};
    if (simPhysics && this.mode === 'simulate') {
      for (var i = 0; i < simPhysics.numNodes; i++) {
        nodePositions[i] = { x: simPhysics.x[i], y: simPhysics.y[i] };
      }
      this.renderer.drawTracePaths(ctx, this.trackedNodes);
    } else {
      for (var i = 0; i < this.nodes.length; i++) {
        nodePositions[this.nodes[i].id] = { x: this.nodes[i].x, y: this.nodes[i].y };
      }
    }

    // 1. Draw Rigid Brackets (Bell-cranks / Orthogonal Levers)
    for (var b = 0; b < this.brackets.length; b++) {
      var br = this.brackets[b];
      var pa = nodePositions[br.a];
      var pb = nodePositions[br.b];
      var pc = nodePositions[br.c];
      if (pa && pb && pc) {
        this.renderer.drawRigidBracket(ctx, pa.x, pa.y, pb.x, pb.y, pc.x, pc.y, br.width, br.color);
      }
    }

    // 1.2 Draw Belts & Pulleys
    var pulleys = (simPhysics && this.mode === 'simulate') ? simPhysics.pulleys : this.pulleys;
    var belts = (simPhysics && this.mode === 'simulate') ? simPhysics.belts : this.belts;
    for (var bi = 0; bi < belts.length; bi++) {
      var blt = belts[bi];
      var pA = pulleys[blt.pulleyA];
      var pB = pulleys[blt.pulleyB];
      if (pA && pB) {
        var nA = nodePositions[pA.nodeId];
        var nB = nodePositions[pB.nodeId];
        if (nA && nB) {
          var aAngle = (simPhysics && this.mode === 'simulate') ? pA.angle : 0;
          this.renderer.drawBelt(ctx, nA.x, nA.y, pA.radius, nB.x, nB.y, pB.radius, blt.crossed, blt.width || 6, aAngle * 10);
        }
      }
    }

    // 1.4 Draw Axles (Shafts & Concentric Couplings)
    var axles = (simPhysics && this.mode === 'simulate') ? simPhysics.axles : this.axles;
    for (var axi = 0; axi < axles.length; axi++) {
      var ax = axles[axi];
      if (ax.shaftNodeA !== undefined && ax.shaftNodeB !== undefined) {
        var snA = nodePositions[ax.shaftNodeA];
        var snB = nodePositions[ax.shaftNodeB];
        if (snA && snB) {
          this.renderer.drawAxle(ctx, snA.x, snA.y, snB.x, snB.y, ax);
        }
      }
    }

    // 1.6 Draw Pulleys
    for (var pi = 0; pi < pulleys.length; pi++) {
      var pul = pulleys[pi];
      var pp = nodePositions[pul.nodeId];
      if (pp) {
        var pAngle = (simPhysics && this.mode === 'simulate') ? pul.angle : 0;
        this.renderer.drawPulley(ctx, pp.x, pp.y, pul.radius, pAngle, pul);

        if (pi === this.hoverPulleyIdx && this.mode === 'edit') {
          ctx.beginPath();
          ctx.arc(pp.x, pp.y, pul.radius + 5, 0, Math.PI * 2);
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
    }

    // 1.8 Draw Cams & Follower Contacts
    var cams = (simPhysics && this.mode === 'simulate') ? simPhysics.cams : this.cams;
    for (var ci = 0; ci < cams.length; ci++) {
      var cam = cams[ci];
      var cp = nodePositions[cam.centerNode];
      if (cp) {
        var cAngle = (simPhysics && this.mode === 'simulate') ? cam.angle : (cam.angle || 0);
        this.renderer.drawCam(ctx, cp.x, cp.y, cAngle, cam.profileType, cam.baseRadius, cam.lift, cam.options);

        if (ci === this.hoverCamIdx && this.mode === 'edit') {
          ctx.beginPath();
          ctx.arc(cp.x, cp.y, (cam.baseRadius + (cam.lift || 0)) + 6, 0, Math.PI * 2);
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
    }

    var camContacts = (simPhysics && this.mode === 'simulate') ? simPhysics.camContacts : this.camContacts;
    for (var cci = 0; cci < camContacts.length; cci++) {
      var cc = camContacts[cci];
      var fPos = nodePositions[cc.followerNode];
      if (fPos) {
        // Draw follower roller bearing
        ctx.beginPath();
        ctx.arc(fPos.x, fPos.y, cc.rollerRadius || 8, 0, Math.PI * 2);
        ctx.fillStyle = '#f8fafc';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#2563eb';
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(fPos.x, fPos.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#0f172a';
        ctx.fill();
      }
    }

    // 2. Draw Sliders
    var sliders = (simPhysics && this.mode === 'simulate') ? simPhysics.sliders : this.sliders;
    for (var sl = 0; sl < sliders.length; sl++) {
      var s = sliders[sl];
      var pa = nodePositions[s.aNode];
      var pb = nodePositions[s.bNode];
      var ps = nodePositions[s.node];
      if (pa && pb && ps) {
        this.renderer.drawSlider(ctx, pa.x, pa.y, pb.x, pb.y, ps.x, ps.y);
      }
    }

    // 3. Draw Gears
    var gears = (simPhysics && this.mode === 'simulate') ? simPhysics.gears : this.gears;
    for (var gi = 0; gi < gears.length; gi++) {
      var g = gears[gi];
      var pc = nodePositions[g.centerNode];
      if (pc) {
        var angle = (simPhysics && this.mode === 'simulate') ? g.angle : 0;
        this.renderer.drawGear(ctx, pc.x, pc.y, g.radius, g.teeth, angle);

        // Highlight gear on hover
        if (gi === this.hoverGearIdx && this.mode === 'edit') {
          ctx.beginPath();
          ctx.arc(pc.x, pc.y, g.radius + 6, 0, Math.PI * 2);
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
    }

    // 3.5 Draw Geneva Mechanisms
    var genevas = (simPhysics && this.mode === 'simulate') ? simPhysics.genevas : this.genevas;
    for (var gi = 0; gi < genevas.length; gi++) {
      var gen = genevas[gi];
      var c1 = nodePositions[gen.driverCenterNode];
      var c2 = nodePositions[gen.genevaCenterNode];
      var p = nodePositions[gen.driverPinNode];
      if (c1 && c2 && p) {
        var crankA = Math.atan2(p.y - c1.y, p.x - c1.x);
        var genAngle = (simPhysics && this.mode === 'simulate') ? gen.angle : (gen.angle || 0);
        var isEng = (simPhysics && this.mode === 'simulate') ? gen.isEngaged : false;
        var centerDist = Math.hypot(c2.x - c1.x, c2.y - c1.y);
        this.renderer.drawCamDriver(ctx, c1.x, c1.y, gen.pinRadius, gen.lockRadius, crankA, isEng);
        this.renderer.drawGenevaWheel(ctx, c2.x, c2.y, gen.radius, gen.slots, genAngle, gen.lockRadius, gen.slotWidth, centerDist);
      }
    }

    // 4. Draw Rods
    var rods = (simPhysics && this.mode === 'simulate') ? simPhysics.rods : this.rods;
    for (var r = 0; r < rods.length; r++) {
      var rod = rods[r];
      var pa = nodePositions[rod.a];
      var pb = nodePositions[rod.b];
      if (pa && pb) {
        var stress = (simPhysics && this.mode === 'simulate') ? rod.stress : 0;
        this.renderer.drawCapsuleLink(ctx, pa.x, pa.y, pb.x, pb.y, rod.width, stress, rod.color, rod.showStress);
        if (rod.angleLock && rod.angleLock !== 'none') {
          var mx = (pa.x + pb.x) / 2;
          var my = (pa.y + pb.y) / 2;
          ctx.beginPath();
          ctx.arc(mx, my, 8, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.fill();
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = '#2563eb';
          ctx.stroke();
          ctx.fillStyle = '#1e293b';
          ctx.font = 'bold 8px monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          var lkText = rod.angleLock === 'horizontal' ? 'H' : (rod.angleLock === 'vertical' ? 'V' : 'A');
          ctx.fillText(lkText, mx, my);
        }
        if ((rod.showDimensions !== undefined) ? rod.showDimensions : this.renderer.showDimensions) {
          this.renderer.drawDimensionLabel(ctx, pa.x, pa.y, pb.x, pb.y, rod.length);
        }
      }
    }

    // 4.5 Draw Helical Springs
    var springs = (simPhysics && this.mode === 'simulate') ? simPhysics.springs : this.springs;
    if (springs) {
      for (var sp = 0; sp < springs.length; sp++) {
        var spr = springs[sp];
        var spa = nodePositions[spr.a];
        var spb = nodePositions[spr.b];
        if (spa && spb) {
          this.renderer.drawSpring(ctx, spa.x, spa.y, spb.x, spb.y, spr.width || 14, spr.color || '#10b981');
        }
      }
    }

    // 5. Draw Motors
    var motors = (simPhysics && this.mode === 'simulate') ? simPhysics.motors : this.motors;
    for (var m = 0; m < motors.length; m++) {
      var mot = motors[m];
      var pc = nodePositions[mot.centerNode];
      var pcr = nodePositions[mot.crankNode];
      if (pc && pcr) {
        var rDist = Math2D.dist(pc.x, pc.y, pcr.x, pcr.y);
        this.renderer.drawMotorIndicator(ctx, pc.x, pc.y, rDist, mot.speed, { stalled: mot.stalled });
      }
    }

    // 6. Draw Nodes and Pins
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var pos = nodePositions[n.id] || { x: n.x, y: n.y };
      var isFixed = (simPhysics && this.mode === 'simulate') ? simPhysics.isFixed[n.id] : n.fixed;

      if (isFixed) {
        if (this.renderer.hidePins || n.simplified) {
          this.renderer.drawSimplifiedPin(ctx, pos.x, pos.y, 7);
        } else {
          this.renderer.drawGroundAnchor(ctx, pos.x, pos.y, 16);
        }
      } else {
        var isH = !!n.isHandle;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, isH ? 10 : 7, 0, Math.PI * 2);
        ctx.fillStyle = (n.id === this.selectedNodeId) ? '#f59e0b' : (isH ? '#ec4899' : '#0f172a');
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
        if (isH) {
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, 4, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.fill();
        }
      }

      // Tracked node ring indicator
      if (this.trackedNodes.has(n.id)) {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 11, 0, Math.PI * 2);
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // Hover highlight
      if (n.id === this.hoverNodeId && this.mode === 'edit') {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 12, 0, Math.PI * 2);
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }
    }

    // 7. Dynamic velocity vectors in simulate mode
    if (simPhysics && this.mode === 'simulate') {
      var anyNodeVel = this.renderer.showVelocities;
      if (!anyNodeVel) {
        for (var nv = 0; nv < nodes.length; nv++) {
          if (nodes[nv].showVelocity) { anyNodeVel = true; break; }
        }
      }
      if (anyNodeVel) {
        for (var i = 0; i < nodes.length; i++) {
          var n = nodes[i];
          var pos = nodePositions[n.id];
          var isFixed = simPhysics.isFixed[n.id];
          if (!isFixed && pos && (this.renderer.showVelocities || n.showVelocity)) {
            this.renderer.drawVelocityVector(ctx, pos.x, pos.y, simPhysics.vx[n.id], simPhysics.vy[n.id]);
          }
        }
      }
    }

    // 8. Ghost connection line when dragging to connect
    if (this.isConnecting && this.connectStartNode !== -1) {
      var pStart = nodePositions[this.connectStartNode];
      if (pStart) {
        ctx.beginPath();
        ctx.moveTo(pStart.x, pStart.y);
        ctx.lineTo(this.mouseWorldX, this.mouseWorldY);
        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth = 3;
        ctx.setLineDash([5, 5]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Preview target circle
        ctx.beginPath();
        ctx.arc(this.mouseWorldX, this.mouseWorldY, 7, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(34, 197, 94, 0.4)';
        ctx.fill();
      }
    }

    // 8.1 Ghost spring line when dragging to connect spring
    if (this.isConnectingSpring && this.connectStartNode !== -1) {
      var pStartS = nodePositions[this.connectStartNode];
      if (pStartS) {
        this.renderer.drawSpring(ctx, pStartS.x, pStartS.y, this.mouseWorldX, this.mouseWorldY, 14, '#10b981');
        ctx.beginPath();
        ctx.arc(this.mouseWorldX, this.mouseWorldY, 7, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(16, 185, 129, 0.4)';
        ctx.fill();
      }
    }

    // 8.2 Ghost slider rail line when dragging to place slider
    if (this._isDraggingSliderAssembly && this._sliderDragStart) {
      this.renderer.drawSlider(ctx, this._sliderDragStart.x, this._sliderDragStart.y,
                               this.mouseWorldX, this.mouseWorldY,
                               (this._sliderDragStart.x + this.mouseWorldX) / 2,
                               (this._sliderDragStart.y + this.mouseWorldY) / 2);
    }

    // 8.5 Selection outline / halo
    if (this.selection) {
      ctx.save();
      var sel = this.selection;
      if (sel.type === 'node') {
        var sn = nodePositions[sel.id !== undefined ? sel.id : sel.index];
        if (sn) {
          ctx.beginPath();
          ctx.arc(sn.x, sn.y, 14, 0, Math.PI * 2);
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 2.5;
          ctx.setLineDash([4, 3]);
          ctx.stroke();
        }
      } else if (sel.type === 'gear') {
        var sg = this.gears[sel.index];
        if (sg) {
          var sp = nodePositions[sg.centerNode];
          if (sp) {
            ctx.beginPath();
            ctx.arc(sp.x, sp.y, sg.radius + 8, 0, Math.PI * 2);
            ctx.strokeStyle = '#38bdf8';
            ctx.lineWidth = 2.5;
            ctx.setLineDash([5, 4]);
            ctx.stroke();
          }
        }
      } else if (sel.type === 'pulley') {
        var spu = this.pulleys[sel.index];
        if (spu) {
          var spup = nodePositions[spu.nodeId];
          if (spup) {
            ctx.beginPath();
            ctx.arc(spup.x, spup.y, spu.radius + 7, 0, Math.PI * 2);
            ctx.strokeStyle = '#38bdf8';
            ctx.lineWidth = 2.5;
            ctx.setLineDash([5, 4]);
            ctx.stroke();
          }
        }
      } else if (sel.type === 'cam') {
        var sc = this.cams[sel.index];
        if (sc) {
          var scp = nodePositions[sc.centerNode];
          if (scp) {
            ctx.beginPath();
            ctx.arc(scp.x, scp.y, (sc.baseRadius + (sc.lift || 0)) + 8, 0, Math.PI * 2);
            ctx.strokeStyle = '#38bdf8';
            ctx.lineWidth = 2.5;
            ctx.setLineDash([5, 4]);
            ctx.stroke();
          }
        }
      } else if (sel.type === 'rod') {
        var sr = this.rods[sel.index];
        if (sr) {
          var sra = nodePositions[sr.a];
          var srb = nodePositions[sr.b];
          if (sra && srb) {
            ctx.beginPath();
            ctx.moveTo(sra.x, sra.y);
            ctx.lineTo(srb.x, srb.y);
            ctx.strokeStyle = '#38bdf8';
            ctx.lineWidth = (sr.width || 12) + 8;
            ctx.lineCap = 'round';
            ctx.globalAlpha = 0.4;
            ctx.stroke();
            ctx.globalAlpha = 1.0;
          }
        }
      } else if (sel.type === 'spring') {
        var ss = this.springs[sel.index];
        if (ss) {
          var ssa = nodePositions[ss.a];
          var ssb = nodePositions[ss.b];
          if (ssa && ssb) {
            ctx.beginPath();
            ctx.moveTo(ssa.x, ssa.y);
            ctx.lineTo(ssb.x, ssb.y);
            ctx.strokeStyle = '#10b981';
            ctx.lineWidth = (ss.width || 14) + 8;
            ctx.lineCap = 'round';
            ctx.globalAlpha = 0.4;
            ctx.stroke();
            ctx.globalAlpha = 1.0;
          }
        }
      } else if (sel.type === 'slider') {
        var ssl = this.sliders[sel.index];
        if (ssl) {
          var ssnode = nodePositions[ssl.node];
          var ssna = nodePositions[ssl.aNode];
          var ssnb = nodePositions[ssl.bNode];
          if (ssna && ssnb) {
            ctx.beginPath();
            ctx.moveTo(ssna.x, ssna.y);
            ctx.lineTo(ssnb.x, ssnb.y);
            ctx.strokeStyle = '#f59e0b';
            ctx.lineWidth = 26;
            ctx.lineCap = 'round';
            ctx.globalAlpha = 0.35;
            ctx.stroke();
            ctx.globalAlpha = 1.0;
          }
          if (ssnode) {
            ctx.beginPath();
            ctx.arc(ssnode.x, ssnode.y, 18, 0, Math.PI * 2);
            ctx.strokeStyle = '#f59e0b';
            ctx.lineWidth = 2.5;
            ctx.setLineDash([4, 3]);
            ctx.stroke();
          }
        }
      } else if (sel.type === 'geneva') {
        var sgen = this.genevas[sel.index];
        if (sgen) {
          var sgc = nodePositions[sgen.genevaCenterNode];
          if (sgc) {
            ctx.beginPath();
            ctx.arc(sgc.x, sgc.y, sgen.radius + 8, 0, Math.PI * 2);
            ctx.strokeStyle = '#38bdf8';
            ctx.lineWidth = 2.5;
            ctx.setLineDash([5, 4]);
            ctx.stroke();
          }
        }
      } else if (sel.type === 'motor') {
        var smot = this.motors[sel.index];
        if (smot) {
          var smc = nodePositions[smot.centerNode];
          var smk = nodePositions[smot.crankNode];
          if (smc) {
            var smr = Math.max(18, smk ? Math2D.dist(smc.x, smc.y, smk.x, smk.y) * 0.7 : 18);
            ctx.beginPath();
            ctx.arc(smc.x, smc.y, smr + 6, 0, Math.PI * 2);
            ctx.strokeStyle = '#f59e0b';
            ctx.lineWidth = 3;
            ctx.setLineDash([6, 4]);
            ctx.stroke();
          }
        }
      }
      ctx.restore();
    }

    // 8.9 Draw Canvas Text Labels
    if (this.labels && this.labels.length > 0) {
      for (var li = 0; li < this.labels.length; li++) {
        var lbl = this.labels[li];
        if (!lbl.text) continue;
        var fs = (lbl.fontSize || 14);
        ctx.save();
        ctx.font = (lbl.bold ? 'bold ' : '') + fs + 'px system-ui, sans-serif';
        ctx.fillStyle = lbl.color || '#1e293b';
        ctx.textBaseline = 'top';
        // Background pill for readability
        var tw = ctx.measureText(lbl.text).width;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
        ctx.beginPath();
        ctx.roundRect
          ? ctx.roundRect(lbl.x - 3, lbl.y - 2, tw + 6, fs + 6, 4)
          : ctx.rect(lbl.x - 3, lbl.y - 2, tw + 6, fs + 6);
        ctx.fill();
        ctx.fillStyle = lbl.color || '#1e293b';
        ctx.font = (lbl.bold ? 'bold ' : '') + fs + 'px system-ui, sans-serif';
        ctx.fillText(lbl.text, lbl.x, lbl.y);
        // Edit-mode drag handle dot
        if (this.mode === 'edit') {
          ctx.beginPath();
          ctx.arc(lbl.x - 3, lbl.y + fs / 2, 3.5, 0, Math.PI * 2);
          ctx.fillStyle = '#64748b';
          ctx.fill();
        }
        ctx.restore();
      }
    }

    // 8.95 Draw In-Progress Custom Vector Shape / Polygon
    if (this.shapeVertices && this.shapeVertices.length > 0) {
      ctx.save();
      var spts = this.shapeVertices;
      ctx.beginPath();
      ctx.moveTo(spts[0].x, spts[0].y);
      for (var vi = 1; vi < spts.length; vi++) {
        ctx.lineTo(spts[vi].x, spts[vi].y);
      }
      ctx.lineTo(this.mouseWorldX, this.mouseWorldY);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#0284c7';
      ctx.setLineDash([6, 4]);
      ctx.stroke();

      // Return dashed guide to start vertex
      ctx.beginPath();
      ctx.moveTo(this.mouseWorldX, this.mouseWorldY);
      ctx.lineTo(spts[0].x, spts[0].y);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(2, 132, 199, 0.4)';
      ctx.stroke();
      ctx.setLineDash([]);

      // Vertices
      for (var vi = 0; vi < spts.length; vi++) {
        ctx.beginPath();
        ctx.arc(spts[vi].x, spts[vi].y, vi === 0 ? 7 : 5, 0, Math.PI * 2);
        ctx.fillStyle = vi === 0 ? '#10b981' : '#0284c7';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      }
      ctx.restore();
    }

    ctx.restore();

    // 9. Physical SI scale ruler
    this.renderer.drawScaleRuler(ctx, this.canvas.width, this.canvas.height, this.zoom);
  };

  MechanismEditor.prototype.toggleTrackNode = function(nodeId) {
    if (this.trackedNodes.has(nodeId)) {
      this.trackedNodes.delete(nodeId);
      if (this.renderer && this.renderer.traces) {
        delete this.renderer.traces[nodeId];
      }
    } else {
      this.trackedNodes.add(nodeId);
    }
    this.render();
  };

  MechanismEditor.prototype._drawGrid = function(ctx) {
    var w = this.canvas.width;
    var h = this.canvas.height;
    var gridSize = 40 * this.zoom;
    var offsetX = this.panX % gridSize;
    var offsetY = this.panY % gridSize;

    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#f1f5f9';

    ctx.beginPath();
    for (var x = offsetX; x < w; x += gridSize) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    for (var y = offsetY; y < h; y += gridSize) {
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();

    // Axis lines at world origin
    ctx.beginPath();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#e2e8f0';
    ctx.moveTo(this.panX, 0);
    ctx.lineTo(this.panX, h);
    ctx.moveTo(0, this.panY);
    ctx.lineTo(w, this.panY);
    ctx.stroke();

    ctx.restore();
  };

  MechanismEditor.Presets = {
    sandbox: (function() {
      var model = {
        version: '2.0',
        nodes: [],
        rods: [],
        springs: [],
        sliders: [],
        gears: [],
        motors: [],
        brackets: [],
        genevas: [],
        pulleys: [],
        belts: [],
        axles: [],
        cams: [],
        camContacts: [],
        labels: []
      };

      function r2(v) {
        return Math.round(v * 100) / 100;
      }

      function node(x, y, fixed, mass, extra) {
        var n = { id: model.nodes.length, x: r2(x), y: r2(y), fixed: !!fixed, mass: mass || 1 };
        if (extra) {
          for (var k in extra) {
            if (Object.prototype.hasOwnProperty.call(extra, k)) n[k] = extra[k];
          }
        }
        model.nodes.push(n);
        return n.id;
      }

      function rod(a, b, style) {
        style = style || {};
        var na = model.nodes[a];
        var nb = model.nodes[b];
        var obj = {
          a: a,
          b: b,
          length: r2(Math.hypot(nb.x - na.x, nb.y - na.y)),
          width: style.width || 11,
          color: style.color || '#3b82f6'
        };
        if (style.angleLock) {
          obj.angleLock = style.angleLock;
          obj.lockedAngle = style.lockedAngle || 0;
        }
        model.rods.push(obj);
        return obj;
      }

      function spring(a, b, rest, stiffness, extra) {
        var obj = {
          a: a,
          b: b,
          restLength: rest,
          stiffness: stiffness,
          damping: 2.0,
          width: 13,
          color: '#10b981'
        };
        if (extra) {
          for (var k in extra) {
            if (Object.prototype.hasOwnProperty.call(extra, k)) obj[k] = extra[k];
          }
        }
        model.springs.push(obj);
        return obj;
      }

      function slider(n, a, b, minT, maxT, friction) {
        var obj = { node: n, aNode: a, bNode: b };
        if (minT !== undefined && minT !== null) obj.minT = minT;
        if (maxT !== undefined && maxT !== null) obj.maxT = maxT;
        if (friction) obj.friction = friction;
        model.sliders.push(obj);
        return obj;
      }

      function gear(center, radius, teeth, meshWith) {
        model.gears.push({ centerNode: center, radius: radius, teeth: teeth, meshWith: meshWith || [] });
        return model.gears.length - 1;
      }

      function motor(center, crank, speed, extra) {
        var obj = { centerNode: center, crankNode: crank, speed: speed };
        if (extra) {
          for (var k in extra) {
            if (Object.prototype.hasOwnProperty.call(extra, k)) obj[k] = extra[k];
          }
        }
        model.motors.push(obj);
        return obj;
      }

      function cam(center, profile, baseR, lift, angle) {
        model.cams.push({
          centerNode: center,
          profileType: profile,
          baseRadius: baseR,
          lift: lift,
          options: { initialAngle: angle || 0 }
        });
        return model.cams.length - 1;
      }

      function camContact(camIdx, follower, rollerR) {
        model.camContacts.push({ camIdx: camIdx, followerNode: follower, rollerRadius: rollerR });
      }

      function pulley(nodeId, radius, width) {
        model.pulleys.push({ nodeId: nodeId, radius: radius, width: width || 8 });
        return model.pulleys.length - 1;
      }

      function belt(a, b, crossed) {
        model.belts.push({ pulleyA: a, pulleyB: b, crossed: !!crossed, width: 7 });
      }

      function label(x, y, text, size, color, bold) {
        model.labels.push({
          x: r2(x),
          y: r2(y),
          text: text,
          fontSize: size || 12,
          color: color || '#1e293b',
          bold: !!bold
        });
      }

      var COL = [-540, -180, 180, 540];
      var ROW = [-320, 0, 320];

      label(COL[0] - 150, ROW[0] - 195, 'LINKSIM INTERACTION SANDBOX', 20, '#0f172a', true);
      label(COL[0] - 150, ROW[0] - 170, 'Press Play, then drag dark joint nodes, pink knobs, and free beam ends. Drag a gear rim to turn it by hand.', 12, '#475569');
      label(COL[0] - 150, ROW[0] - 152, 'Zoom with the wheel. Each station is independent. Watch the label to know the expected result.', 12, '#475569');

      // 1. Four-bar crank-rocker
      (function() {
        var x = COL[0], y = ROW[0];
        var a = node(x - 50, y + 20, true);
        var k = node(x - 20, y + 20, false);
        var b = node(x + 50, y + 20, true);
        var d = node(x + 38, y - 49, false);
        rod(a, b, { width: 7, color: '#94a3b8' });
        rod(a, k, { width: 11, color: '#f59e0b' });
        rod(k, d, { width: 9, color: '#3b82f6' });
        rod(b, d, { width: 11, color: '#10b981' });
        motor(a, k, 3.0);
        label(x - 150, y - 135, '1. Four-Bar Linkage (crank-rocker)', 15, '#0f172a', true);
        label(x - 150, y - 118, 'Four links: ground bar (grey), crank, coupler, rocker. Crank spins, rocker swings.', 12, '#1d4ed8');
      })();

      // 2. Slider-crank
      (function() {
        var x = COL[1], y = ROW[0];
        var c = node(x - 70, y, true);
        var k = node(x - 30, y, false);
        var p = node(x + 90, y, false, 2);
        var ra = node(x - 20, y, true);
        var rb = node(x + 130, y, true);
        rod(c, k, { width: 12, color: '#f59e0b' });
        rod(k, p, { width: 11, color: '#3b82f6' });
        slider(p, ra, rb, 10, 130);
        motor(c, k, 4.5);
        label(x - 150, y - 135, '2. Slider-Crank', 15, '#0f172a', true);
        label(x - 150, y - 118, 'Crank rotation becomes back-and-forth travel of the piston on the rail.', 12, '#1d4ed8');
      })();

      // 3. Sliders in three directions
      (function() {
        var x = COL[2], y = ROW[0];
        var va = node(x - 90, y - 90, true);
        var vb = node(x - 90, y + 90, true);
        var vc = node(x - 90, y, false, 2);
        slider(vc, va, vb, 16, 164);
        var ha = node(x - 60, y + 55, true);
        var hb = node(x + 60, y + 55, true);
        var hc = node(x, y + 55, false, 2);
        slider(hc, ha, hb, 16, 104);
        var ang = Math.PI / 4;
        var acx = x + 70, acy = y - 60, half = 50;
        var aa = node(acx - half * Math.cos(ang), acy - half * Math.sin(ang), true);
        var ab = node(acx + half * Math.cos(ang), acy + half * Math.sin(ang), true);
        var ac = node(acx, acy, false, 2);
        slider(ac, aa, ab, 16, 84, 0.9);
        label(x - 150, y - 135, '3. Sliders, Three Directions', 15, '#0f172a', true);
        label(x - 150, y - 118, 'Vertical and horizontal rails with end-stops, 45 deg rail with friction. Drag carriages.', 12, '#b45309');
      })();

      // 4. Springs and mass
      (function() {
        var x = COL[3], y = ROW[0];
        var a1 = node(x - 70, y - 70, true);
        var m1 = node(x + 20, y - 70, false, 1);
        spring(a1, m1, 60, 60);
        var a2 = node(x - 70, y, true);
        var m2 = node(x + 20, y, false, 1);
        spring(a2, m2, 60, 300);
        var a3 = node(x - 70, y + 70, true);
        var m3 = node(x + 20, y + 70, false, 3);
        spring(a3, m3, 60, 60);
        label(x - 150, y - 135, '4. Springs and Mass', 15, '#0f172a', true);
        label(x - 150, y - 118, 'Same stretch: stiffer spring (middle) is faster, heavier mass (bottom) is slower.', 12, '#047857');
      })();

      // 5. Cam and roller follower
      (function() {
        var x = COL[0], y = ROW[1];
        var cc = node(x - 90, y, true);
        var f = node(x - 52, y, false, 1);
        var ra = node(x - 70, y, true);
        var rb = node(x + 120, y, true);
        slider(f, ra, rb, 4, 72);
        var anchor = node(x + 140, y, true);
        spring(f, anchor, 260, 2500);
        cam(cc, 'pear', 30, 25, Math.PI);
        camContact(0, f, 8);
        motor(cc, cc, 1.5);
        label(x - 150, y - 135, '5. Cam and Roller Follower', 15, '#0f172a', true);
        label(x - 150, y - 118, 'Pear cam lifts the roller as it turns; the return spring presses the roller back.', 12, '#6d28d9');
      })();

      // 6. Gears and axle
      (function() {
        var x = COL[1], y = ROW[1];
        var g0 = node(x - 110, y, true);
        var g1 = node(x - 30, y, true);
        var g2 = node(x + 66, y, true);
        gear(g0, 24, 12, [1]);
        gear(g1, 56, 28, [0, 2]);
        gear(g2, 40, 20, [1]);
        motor(g0, g0, 4.0);
        node(x + 91, y, false, 1, { parentGear: { gearIdx: 2, radius: 25, angleOffset: 0 } });
        var g3 = node(x + 66, y + 110, true);
        gear(g3, 30, 15, []);
        model.axles.push({
          targetA: { type: 'gear', index: 2 },
          targetB: { type: 'gear', index: 3 },
          ratio: 1.5,
          shaftNodeA: g2,
          shaftNodeB: g3
        });
        label(x - 150, y - 135, '6. Gears and Axle', 15, '#0f172a', true);
        label(x - 150, y - 118, 'Each mesh reverses direction and changes speed. A crankpin orbits the last gear.', 12, '#1d4ed8');
        label(x - 150, y - 101, 'The lower gear is coupled to the output by an axle at ratio 1.5.', 12, '#64748b');
      })();

      // 7. Geneva indexer
      (function() {
        var x = COL[2], y = ROW[1];
        var drv = node(x, y, true);
        var pin = node(x, y + 42.43, false);
        var whl = node(x + 60, y, true);
        rod(drv, pin, { width: 8, color: '#f59e0b' });
        model.genevas.push({
          driverCenterNode: drv,
          driverPinNode: pin,
          genevaCenterNode: whl,
          slots: 4,
          slotWidth: 12,
          angle: Math.PI * 0.75
        });
        motor(drv, pin, 2.0);
        label(x - 150, y - 135, '7. Geneva Indexer', 15, '#0f172a', true);
        label(x - 150, y - 118, 'Wheel advances 90 deg per driver turn, then dwells (locks).', 12, '#4338ca');
      })();

      // 8. Belts and pulleys
      (function() {
        var x = COL[3], y = ROW[1];
        var p0 = node(x - 100, y, true);
        var p1 = node(x + 10, y - 50, true);
        var p2 = node(x + 110, y + 20, true);
        pulley(p0, 40);
        pulley(p1, 22);
        pulley(p2, 30);
        belt(0, 1, false);
        belt(1, 2, true);
        motor(p0, p0, 3.0);
        label(x - 150, y - 135, '8. Belts and Pulleys', 15, '#0f172a', true);
        label(x - 150, y - 118, 'Open belt keeps direction; crossed belt reverses it. Radii set the ratio.', 12, '#0369a1');
        label(x - 150, y - 101, 'Make your own: place Pulleys, pick the Belt tool, click pulley A then B (Shift = crossed).', 12, '#64748b');
      })();

      // 9. Lever / bell-crank (manual)
      (function() {
        var x = COL[0], y = ROW[2];
        var p = node(x, y, true);
        var h = node(x, y - 80, false, 1, { isHandle: true });
        var o = node(x + 80, y, false, 1);
        model.brackets.push({ a: h, b: p, c: o, width: 14, color: '#6366f1' });
        label(x - 150, y - 135, '9. Lever / Bell-Crank (manual)', 15, '#0f172a', true);
        label(x - 150, y - 118, 'Drag the pink knob; the rigid arm swings about its pivot and moves the output.', 12, '#4338ca');
      })();

      // 10. Over-center toggle (manual)
      (function() {
        var x = COL[1], y = ROW[2];
        var p0 = node(x - 80, y, true);
        var knee = node(x, y - 25, false);
        var head = node(x + 75, y, false, 1);
        var ra = node(x + 10, y, true);
        var rb = node(x + 150, y, true);
        node(x, y + 15, true);
        var anchor = node(x, y - 85, true);
        rod(p0, knee, { width: 12, color: '#f59e0b' });
        rod(knee, head, { width: 12, color: '#3b82f6' });
        spring(knee, anchor, 50, 100, { width: 12 });
        slider(head, ra, rb, 0, 130);
        label(x - 150, y - 135, '10. Over-Center Toggle (manual)', 15, '#0f172a', true);
        label(x - 150, y - 118, 'Drag the knee past the center line; the spring snaps it to the other side (locks).', 12, '#2563eb');
      })();

      // 11. Orientation-locked beams
      (function() {
        var x = COL[2], y = ROW[2];
        var h0 = node(x - 100, y - 20, true);
        var h1 = node(x - 20, y - 20, false);
        rod(h0, h1, { width: 11, color: '#3b82f6', angleLock: 'horizontal' });
        var v0 = node(x + 20, y - 80, true);
        var v1 = node(x + 20, y, false);
        rod(v0, v1, { width: 11, color: '#10b981', angleLock: 'vertical' });
        var a0 = node(x - 100, y + 80, true);
        var a1 = node(x - 43.4, y + 136.6, false);
        rod(a0, a1, { width: 11, color: '#f59e0b', angleLock: 'fixed', lockedAngle: Math.PI / 4 });
        label(x - 150, y - 135, '11. Orientation-Locked Beams', 15, '#0f172a', true);
        label(x - 150, y - 118, 'Drag the free ends: beams hold horizontal, vertical, or a fixed 45 deg angle.', 12, '#b45309');
      })();

      // 12. Motor torque limit
      (function() {
        var x = COL[3], y = ROW[2];
        var c = node(x, y - 60, true);
        var k = node(x + 30, y - 60, false);
        var anchor = node(x, y + 90, true);
        spring(k, anchor, 120, 5, { width: 12, color: '#ef4444' });
        motor(c, k, 3.0, { maxTorque: 6000 });
        label(x - 150, y - 135, '12. Motor Torque Limit', 15, '#0f172a', true);
        label(x - 150, y - 118, 'Limited torque slows the motor under spring load. Open its properties and enable Unlimited Torque.', 12, '#b91c1c');
      })();

      return model;
    })()
  };

  return MechanismEditor;
});
