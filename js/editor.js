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

    // Viewport pan/zoom
    this.panX = canvas.width / 2;
    this.panY = canvas.height / 2;
    this.zoom = 1.0;

    // Mode: 'edit' or 'simulate'
    this.mode = 'edit';

    // Tool state
    this.activeTool = 'select'; // 'select', 'add_pin', 'add_node', 'add_rod', 'add_slider', 'add_gear', 'add_motor', 'add_bracket', 'delete'
    this.selectedNodeId = -1;
    this.hoverNodeId = -1;
    this.hoverGearIdx = -1;
    this.hoverRodIdx = -1;

    // Interaction flags
    this.isDragging = false;
    this.isConnecting = false;
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

  MechanismEditor.prototype.getNodeById = function(id) {
    for (var i = 0; i < this.nodes.length; i++) {
      if (this.nodes[i].id === id) return this.nodes[i];
    }
    return null;
  };

  MechanismEditor.prototype.setTool = function(tool) {
    this.activeTool = tool;
    this.isConnecting = false;
    this.connectStartNode = -1;
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
    this.rods.push({
      a: aId,
      b: bId,
      length: len,
      width: (style && style.width) || 12,
      color: (style && style.color) || '#3b82f6'
    });
    this._notifyChange();
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

  MechanismEditor.prototype.addSlider = function(nodeId, aNodeId, bNodeId) {
    this.saveState();
    this.sliders.push({
      node: nodeId,
      aNode: aNodeId,
      bNode: bNodeId,
      minT: -1000,
      maxT: 1000
    });
    this._notifyChange();
  };

  MechanismEditor.prototype.addGear = function(centerId, radius, teeth) {
    this.saveState();
    var cNode = this.getNodeById(centerId);
    if (!cNode) return;
    cNode.fixed = true; // Gears have fixed shafts

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

  MechanismEditor.prototype.addMotor = function(centerId, crankId, speed) {
    this.saveState();
    this.motors.push({
      centerNode: centerId,
      crankNode: crankId,
      speed: speed !== undefined ? speed : 2.5
    });
    this._notifyChange();
  };

  MechanismEditor.prototype.deleteElementAt = function(wx, wy) {
    var nearNode = this.findNodeNear(wx, wy, 16);
    if (nearNode !== -1) {
      this.deleteNode(nearNode);
      return;
    }
    var nearRod = this.findRodNear(wx, wy, 12);
    if (nearRod !== -1) {
      this.saveState();
      this.rods.splice(nearRod, 1);
      this._notifyChange();
      return;
    }
    var nearGear = this.findGearNear(wx, wy);
    if (nearGear !== -1) {
      this.deleteGear(nearGear);
      return;
    }
  };

  MechanismEditor.prototype.deleteNode = function(id) {
    this.saveState();
    this.rods = this.rods.filter(function(r) { return r.a !== id && r.b !== id; });
    this.sliders = this.sliders.filter(function(s) { return s.node !== id && s.aNode !== id && s.bNode !== id; });
    this.gears = this.gears.filter(function(g) { return g.centerNode !== id; });
    this.motors = this.motors.filter(function(m) { return m.centerNode !== id && m.crankNode !== id; });
    this.brackets = this.brackets.filter(function(b) { return b.a !== id && b.b !== id && b.c !== id; });
    this.nodes = this.nodes.filter(function(n) { return n.id !== id; });
    this._notifyChange();
  };

  MechanismEditor.prototype.deleteGear = function(gearIdx) {
    this.saveState();
    this.gears.splice(gearIdx, 1);
    // Remove mesh connections
    for (var i = 0; i < this.gears.length; i++) {
      this.gears[i].meshWith = this.gears[i].meshWith
        .filter(function(idx) { return idx !== gearIdx; })
        .map(function(idx) { return idx > gearIdx ? idx - 1 : idx; });
    }
    this._notifyChange();
  };

  MechanismEditor.prototype.clear = function() {
    this.saveState();
    this.nodes = [];
    this.rods = [];
    this.sliders = [];
    this.gears = [];
    this.motors = [];
    this.brackets = [];
    this.selectedNodeId = -1;
    this.isConnecting = false;
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
      sliders: JSON.parse(JSON.stringify(this.sliders)),
      gears: JSON.parse(JSON.stringify(this.gears)),
      motors: JSON.parse(JSON.stringify(this.motors)),
      brackets: JSON.parse(JSON.stringify(this.brackets))
    };
  };

  MechanismEditor.prototype.loadJSON = function(data) {
    if (!data) return;
    this.nodes = data.nodes || [];
    this.rods = data.rods || [];
    this.sliders = data.sliders || [];
    this.gears = data.gears || [];
    this.motors = data.motors || [];
    this.brackets = data.brackets || [];
    this.selectedNodeId = -1;
    this.isConnecting = false;
    this._notifyChange();
  };

  MechanismEditor.prototype._bindEvents = function() {
    var self = this;
    var canvas = this.canvas;

    canvas.addEventListener('mousedown', function(e) {
      var w = self.screenToWorld(e.clientX, e.clientY);
      self.mouseWorldX = w.x;
      self.mouseWorldY = w.y;

      // Right Click = Context Menu
      if (e.button === 2) {
        e.preventDefault();
        var nearNode = self.findNodeNear(w.x, w.y);
        var nearRod = self.findRodNear(w.x, w.y);
        var nearGear = self.findGearNear(w.x, w.y);

        var targetType = 'empty';
        var targetData = { x: w.x, y: w.y };

        if (nearNode !== -1) {
          targetType = 'node';
          targetData = self.getNodeById(nearNode);
        } else if (nearGear !== -1) {
          targetType = 'gear';
          targetData = { index: nearGear, gear: self.gears[nearGear] };
        } else if (nearRod !== -1) {
          targetType = 'rod';
          targetData = { index: nearRod, rod: self.rods[nearRod] };
        }

        if (self.onShowContextMenu) {
          self.onShowContextMenu(e.clientX, e.clientY, targetType, targetData);
        }
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
            return;
          }
        }
        if (nearNode !== -1) {
          self.selectedNodeId = nearNode;
          self.isDragging = true;
          return;
        }
        self.isPanning = true;
        self.panStartX = e.clientX - self.panX;
        self.panStartY = e.clientY - self.panY;
        return;
      }

      // In Edit Mode
      switch (self.activeTool) {
        case 'select':
          if (nearNode !== -1) {
            self.selectedNodeId = nearNode;
            self.isDragging = true;
          } else {
            self.isPanning = true;
            self.panStartX = e.clientX - self.panX;
            self.panStartY = e.clientY - self.panY;
          }
          break;

        case 'add_pin':
          self.addNode(w.x, w.y, true);
          break;

        case 'add_node':
          self.addNode(w.x, w.y, false);
          break;

        case 'add_rod':
          // Fluid Drag-to-Connect: Start dragging from node, or create node if clicking empty space
          if (nearNode !== -1) {
            self.connectStartNode = nearNode;
            self.isConnecting = true;
          } else {
            var newId = self.addNode(w.x, w.y, false);
            self.connectStartNode = newId;
            self.isConnecting = true;
          }
          break;

        case 'add_slider':
          if (nearNode !== -1) {
            if (!self._sliderRailStart) {
              self._sliderRailStart = nearNode;
            } else if (self._sliderRailStart !== nearNode) {
              var sNode = self.addNode((self.getNodeById(self._sliderRailStart).x + self.getNodeById(nearNode).x) / 2,
                                       (self.getNodeById(self._sliderRailStart).y + self.getNodeById(nearNode).y) / 2, false);
              self.addSlider(sNode, self._sliderRailStart, nearNode);
              self._sliderRailStart = null;
            }
          }
          break;

        case 'add_gear':
          var gCenter = nearNode !== -1 ? nearNode : self.addNode(w.x, w.y, true);
          self.addGear(gCenter, 45, 15);
          break;

        case 'add_motor':
          if (nearNode !== -1) {
            if (!self._motorCenter) {
              self._motorCenter = nearNode;
            } else if (self._motorCenter !== nearNode) {
              self.addMotor(self._motorCenter, nearNode);
              self._motorCenter = null;
            }
          }
          break;

        case 'delete':
          self.deleteElementAt(w.x, w.y);
          break;
      }
      self.render();
    });

    canvas.addEventListener('mousemove', function(e) {
      var w = self.screenToWorld(e.clientX, e.clientY);
      self.mouseWorldX = w.x;
      self.mouseWorldY = w.y;

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

      // Dragging a node in Edit Mode
      if (self.isDragging && self.selectedNodeId !== -1 && self.mode === 'edit') {
        var node = self.getNodeById(self.selectedNodeId);
        if (node) {
          node.x = Math.round(w.x);
          node.y = Math.round(w.y);

          // Update lengths of connected rods
          for (var i = 0; i < self.rods.length; i++) {
            var r = self.rods[i];
            if (r.a === node.id || r.b === node.id) {
              var na = self.getNodeById(r.a);
              var nb = self.getNodeById(r.b);
              if (na && nb) {
                r.length = Math2D.dist(na.x, na.y, nb.x, nb.y);
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

    window.addEventListener('mouseup', function(e) {
      if (self.isConnecting && self.connectStartNode !== -1) {
        var w = self.screenToWorld(e.clientX, e.clientY);
        var nearNode = self.findNodeNear(w.x, w.y);

        if (nearNode !== -1 && nearNode !== self.connectStartNode) {
          // Connect to existing node
          self.addRod(self.connectStartNode, nearNode);
        } else if (nearNode === -1) {
          // Drop new node in empty space and connect
          var endNode = self.addNode(w.x, w.y, false);
          self.addRod(self.connectStartNode, endNode);
        }
      }

      self.isDragging = false;
      self.isConnecting = false;
      self.connectStartNode = -1;
      self.isPanning = false;
      self.isTurningGear = false;
      self.turningGearIdx = -1;

      if (self.onDirectDragRelease) {
        self.onDirectDragRelease();
      }

      self.render();
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
      this.renderer.drawTracePaths(ctx);
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

    // 4. Draw Rods
    var rods = (simPhysics && this.mode === 'simulate') ? simPhysics.rods : this.rods;
    for (var r = 0; r < rods.length; r++) {
      var rod = rods[r];
      var pa = nodePositions[rod.a];
      var pb = nodePositions[rod.b];
      if (pa && pb) {
        var stress = (simPhysics && this.mode === 'simulate') ? rod.stress : 0;
        this.renderer.drawCapsuleLink(ctx, pa.x, pa.y, pb.x, pb.y, rod.width, stress, rod.color);
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
        this.renderer.drawMotorIndicator(ctx, pc.x, pc.y, rDist, mot.speed);
      }
    }

    // 6. Draw Nodes and Pins
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var pos = nodePositions[n.id] || { x: n.x, y: n.y };
      var isFixed = (simPhysics && this.mode === 'simulate') ? simPhysics.isFixed[n.id] : n.fixed;

      if (isFixed) {
        this.renderer.drawGroundAnchor(ctx, pos.x, pos.y, 16);
      } else {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 7, 0, Math.PI * 2);
        ctx.fillStyle = (n.id === this.selectedNodeId) ? '#f59e0b' : '#0f172a';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#ffffff';
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

    // 7. Ghost connection line when dragging to connect
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

    ctx.restore();
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
    // 1. Klann Walking Mechanism
    klann: {
      version: '2.0',
      nodes: [
        { id: 0, x: 0, y: 0, fixed: true, mass: 1 },
        { id: 1, x: -7, y: 13, fixed: false, mass: 1 },
        { id: 2, x: -60, y: 30, fixed: false, mass: 1 },
        { id: 3, x: -30, y: -50, fixed: false, mass: 1 },
        { id: 4, x: -38, y: -7.8, fixed: true, mass: 1 },
        { id: 5, x: -85, y: -20, fixed: false, mass: 1 },
        { id: 6, x: -70, y: -65, fixed: false, mass: 1 },
        { id: 7, x: 0, y: -100, fixed: false, mass: 1 }
      ],
      rods: [
        { a: 0, b: 1, length: 15.0, width: 8, color: '#f59e0b' },
        { a: 1, b: 2, length: 50.0, width: 9, color: '#3b82f6' },
        { a: 1, b: 3, length: 61.9, width: 9, color: '#3b82f6' },
        { a: 2, b: 4, length: 41.5, width: 9, color: '#64748b' },
        { a: 3, b: 4, length: 39.3, width: 9, color: '#64748b' },
        { a: 4, b: 5, length: 40.1, width: 9, color: '#3b82f6' },
        { a: 2, b: 5, length: 55.8, width: 9, color: '#3b82f6' },
        { a: 3, b: 6, length: 36.7, width: 9, color: '#3b82f6' },
        { a: 5, b: 6, length: 39.4, width: 9, color: '#3b82f6' },
        { a: 3, b: 7, length: 49.0, width: 9, color: '#10b981' },
        { a: 6, b: 7, length: 65.7, width: 9, color: '#10b981' }
      ],
      sliders: [],
      gears: [],
      motors: [
        { centerNode: 0, crankNode: 1, speed: 3.0 }
      ],
      brackets: []
    },

    // 2. Slider-Crank (Piston Engine)
    sliderCrank: {
      version: '2.0',
      nodes: [
        { id: 0, x: -100, y: 0, fixed: true, mass: 1 },
        { id: 1, x: -60, y: 0, fixed: false, mass: 1 },
        { id: 2, x: 70, y: 0, fixed: false, mass: 1 },
        { id: 3, x: 0, y: 0, fixed: true, mass: 1 },
        { id: 4, x: 180, y: 0, fixed: true, mass: 1 }
      ],
      rods: [
        { a: 0, b: 1, length: 40, width: 12, color: '#f59e0b' },
        { a: 1, b: 2, length: 130, width: 10, color: '#3b82f6' }
      ],
      sliders: [
        { node: 2, aNode: 3, bNode: 4, minT: 10, maxT: 170 }
      ],
      gears: [],
      motors: [
        { centerNode: 0, crankNode: 1, speed: 3.5 }
      ],
      brackets: []
    },

    // 3. Chebyshev Straight-Line Linkage
    chebyshev: {
      version: '2.0',
      nodes: [
        { id: 0, x: -50, y: 0, fixed: true, mass: 1 },
        { id: 1, x: 50, y: 0, fixed: true, mass: 1 },
        { id: 2, x: -50, y: 100, fixed: false, mass: 1 },
        { id: 3, x: 50, y: 100, fixed: false, mass: 1 },
        { id: 4, x: 0, y: 100, fixed: false, mass: 1 }
      ],
      rods: [
        { a: 0, b: 2, length: 100, width: 10, color: '#3b82f6' },
        { a: 1, b: 3, length: 100, width: 10, color: '#3b82f6' },
        { a: 2, b: 4, length: 50, width: 10, color: '#10b981' },
        { a: 4, b: 3, length: 50, width: 10, color: '#10b981' }
      ],
      sliders: [],
      gears: [],
      motors: [
        { centerNode: 0, crankNode: 2, speed: 2.0 }
      ],
      brackets: []
    },

    // 4. Geared Piston & Bell-Crank (Orthogonal Transfer & Geared Crank)
    gearedBellCrank: {
      version: '2.0',
      nodes: [
        { id: 0, x: -100, y: 0, fixed: true, mass: 1 },    // Gear 1 center
        { id: 1, x: 0, y: 0, fixed: true, mass: 1 },       // Gear 2 center
        { id: 2, x: 0, y: 35, fixed: false, mass: 1 },     // Pin attached on Gear 2
        { id: 3, x: 90, y: 35, fixed: false, mass: 1 },    // Bell-crank input
        { id: 4, x: 90, y: 80, fixed: true, mass: 1 },     // Bell-crank pivot
        { id: 5, x: 135, y: 80, fixed: false, mass: 1 },   // Bell-crank 90-deg output
        { id: 6, x: 135, y: 160, fixed: false, mass: 1 },  // Piston
        { id: 7, x: 135, y: 120, fixed: true, mass: 1 },   // Slider rail start
        { id: 8, x: 135, y: 220, fixed: true, mass: 1 }    // Slider rail end
      ],
      rods: [
        { a: 2, b: 3, length: 90, width: 10, color: '#3b82f6' },
        { a: 5, b: 6, length: 80, width: 10, color: '#10b981' }
      ],
      sliders: [
        { node: 6, aNode: 7, bNode: 8, minT: 10, maxT: 90 }
      ],
      gears: [
        { centerNode: 0, radius: 50, teeth: 20, meshWith: [1] },
        { centerNode: 1, radius: 50, teeth: 20, meshWith: [0] }
      ],
      motors: [
        { centerNode: 0, crankNode: 0, speed: 2.5 } // Drives gear 0
      ],
      brackets: [
        { a: 3, b: 4, c: 5, width: 14, color: '#6366f1' }
      ]
    },

    // 5. Compound Gear Train
    gearTrain: {
      version: '2.0',
      nodes: [
        { id: 0, x: -70, y: 0, fixed: true, mass: 1 },
        { id: 1, x: 0, y: 0, fixed: true, mass: 1 },
        { id: 2, x: 90, y: 0, fixed: true, mass: 1 }
      ],
      rods: [],
      sliders: [],
      gears: [
        { centerNode: 0, radius: 35, teeth: 14, meshWith: [1] },
        { centerNode: 1, radius: 35, teeth: 14, meshWith: [0, 2] },
        { centerNode: 2, radius: 55, teeth: 22, meshWith: [1] }
      ],
      motors: [
        { centerNode: 0, crankNode: 0, speed: 2.0 }
      ],
      brackets: []
    }
  };

  return MechanismEditor;
});
