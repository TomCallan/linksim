/**
 * Interactive Mechanism Blueprint Editor & Preset Library for Linksim.
 * Manages placement of nodes, pins, rods, sliders, gears, and motors on the left canvas.
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
    this.nodes = [];     // [{ id, x, y, fixed, mass }]
    this.rods = [];      // [{ a, b, length, width, color }]
    this.sliders = [];   // [{ node, aNode, bNode, minT, maxT }]
    this.gears = [];     // [{ centerNode, radius, teeth, meshWith: [] }]
    this.motors = [];    // [{ centerNode, crankNode, speed }]

    // Viewport pan/zoom
    this.panX = canvas.width / 2;
    this.panY = canvas.height / 2;
    this.zoom = 1.0;

    // Interaction state
    this.activeTool = 'select'; // 'select', 'add_node', 'add_pin', 'add_rod', 'add_slider', 'add_gear', 'add_motor', 'delete'
    this.selectedNodeId = -1;
    this.pendingAction = null; // { tool, step, data }
    this.hoverNodeId = -1;
    this.isDragging = false;
    this.isPanning = false;
    this.dragStartX = 0;
    this.dragStartY = 0;

    this._bindEvents();
  }

  MechanismEditor.prototype.screenToWorld = function(sx, sy) {
    return {
      x: (sx - this.panX) / this.zoom,
      y: (sy - this.panY) / this.zoom
    };
  };

  MechanismEditor.prototype.worldToScreen = function(wx, wy) {
    return {
      x: wx * this.zoom + this.panX,
      y: wy * this.zoom + this.panY
    };
  };

  MechanismEditor.prototype.findNodeNear = function(wx, wy, threshold) {
    threshold = (threshold || 15) / this.zoom;
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

  MechanismEditor.prototype.setTool = function(tool) {
    this.activeTool = tool;
    this.pendingAction = null;
    this.selectedNodeId = -1;
    this.render();
  };

  MechanismEditor.prototype.addNode = function(wx, wy, fixed) {
    var id = this.nodes.length;
    this.nodes.push({
      id: id,
      x: Math.round(wx),
      y: Math.round(wy),
      fixed: !!fixed,
      mass: 1.0
    });
    this._notifyChange();
    return id;
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

    var len = Math2D.dist(na.x, na.y, nb.x, nb.y);
    this.rods.push({
      a: aId,
      b: bId,
      length: len,
      width: (style && style.width) || 10,
      color: (style && style.color) || '#3b82f6'
    });
    this._notifyChange();
  };

  MechanismEditor.prototype.addSlider = function(nodeId, aNodeId, bNodeId) {
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
    var gear = {
      centerNode: centerId,
      radius: radius || 40,
      teeth: teeth || 16,
      meshWith: []
    };
    // Auto mesh with nearby gears if pitch circles touch
    var cNode = this.getNodeById(centerId);
    for (var i = 0; i < this.gears.length; i++) {
      var other = this.gears[i];
      var oNode = this.getNodeById(other.centerNode);
      if (cNode && oNode) {
        var d = Math2D.dist(cNode.x, cNode.y, oNode.x, oNode.y);
        if (Math.abs(d - (gear.radius + other.radius)) < 15) {
          gear.meshWith.push(i);
          other.meshWith.push(this.gears.length);
        }
      }
    }
    this.gears.push(gear);
    this._notifyChange();
  };

  MechanismEditor.prototype.addMotor = function(centerId, crankId, speed) {
    this.motors.push({
      centerNode: centerId,
      crankNode: crankId,
      speed: speed !== undefined ? speed : 2.5
    });
    this._notifyChange();
  };

  MechanismEditor.prototype.getNodeById = function(id) {
    for (var i = 0; i < this.nodes.length; i++) {
      if (this.nodes[i].id === id) return this.nodes[i];
    }
    return null;
  };

  MechanismEditor.prototype.clear = function() {
    this.nodes = [];
    this.rods = [];
    this.sliders = [];
    this.gears = [];
    this.motors = [];
    this.selectedNodeId = -1;
    this.pendingAction = null;
    this._notifyChange();
  };

  MechanismEditor.prototype.deleteElementAt = function(wx, wy) {
    var nearNode = this.findNodeNear(wx, wy, 15);
    if (nearNode !== -1) {
      this.deleteNode(nearNode);
      return;
    }
    // Delete rod if clicked near line
    for (var r = this.rods.length - 1; r >= 0; r--) {
      var rod = this.rods[r];
      var na = this.getNodeById(rod.a);
      var nb = this.getNodeById(rod.b);
      if (na && nb) {
        var proj = [];
        Math2D.projectPointOnLine(wx, wy, na.x, na.y, nb.x, nb.y, proj);
        if (proj[2] >= 0 && proj[2] <= 1) {
          var dist = Math2D.dist(wx, wy, proj[0], proj[1]);
          if (dist < 10 / this.zoom) {
            this.rods.splice(r, 1);
            this._notifyChange();
            return;
          }
        }
      }
    }
  };

  MechanismEditor.prototype.deleteNode = function(id) {
    // Remove attached rods
    this.rods = this.rods.filter(function(r) { return r.a !== id && r.b !== id; });
    // Remove attached sliders
    this.sliders = this.sliders.filter(function(s) { return s.node !== id && s.aNode !== id && s.bNode !== id; });
    // Remove gears
    this.gears = this.gears.filter(function(g) { return g.centerNode !== id; });
    // Remove motors
    this.motors = this.motors.filter(function(m) { return m.centerNode !== id && m.crankNode !== id; });
    // Remove node
    this.nodes = this.nodes.filter(function(n) { return n.id !== id; });
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
      motors: JSON.parse(JSON.stringify(this.motors))
    };
  };

  MechanismEditor.prototype.loadJSON = function(data) {
    this.clear();
    if (!data) return;
    this.nodes = data.nodes || [];
    this.rods = data.rods || [];
    this.sliders = data.sliders || [];
    this.gears = data.gears || [];
    this.motors = data.motors || [];
    this._notifyChange();
  };

  MechanismEditor.prototype._bindEvents = function() {
    var self = this;
    var canvas = this.canvas;

    canvas.addEventListener('mousedown', function(e) {
      var rect = canvas.getBoundingClientRect();
      var sx = e.clientX - rect.left;
      var sy = e.clientY - rect.top;
      var w = self.screenToWorld(sx, sy);

      // Middle button or right button = pan
      if (e.button === 1 || e.button === 2) {
        self.isPanning = true;
        self.dragStartX = sx - self.panX;
        self.dragStartY = sy - self.panY;
        e.preventDefault();
        return;
      }

      var nearNode = self.findNodeNear(w.x, w.y);

      switch (self.activeTool) {
        case 'select':
          if (nearNode !== -1) {
            self.selectedNodeId = nearNode;
            self.isDragging = true;
          } else {
            // Drag background to pan
            self.isPanning = true;
            self.dragStartX = sx - self.panX;
            self.dragStartY = sy - self.panY;
          }
          break;

        case 'add_node':
          self.addNode(w.x, w.y, false);
          break;

        case 'add_pin':
          self.addNode(w.x, w.y, true);
          break;

        case 'add_rod':
          if (nearNode !== -1) {
            if (!self.pendingAction) {
              self.pendingAction = { tool: 'add_rod', fromNode: nearNode };
            } else if (self.pendingAction.fromNode !== nearNode) {
              self.addRod(self.pendingAction.fromNode, nearNode);
              self.pendingAction = null;
            }
          }
          break;

        case 'add_slider':
          if (!self.pendingAction) {
            if (nearNode !== -1) {
              self.pendingAction = { tool: 'add_slider', step: 1, aNode: nearNode };
            }
          } else if (self.pendingAction.step === 1 && nearNode !== -1 && nearNode !== self.pendingAction.aNode) {
            self.pendingAction.bNode = nearNode;
            self.pendingAction.step = 2;
          } else if (self.pendingAction.step === 2) {
            var sNode = nearNode !== -1 ? nearNode : self.addNode(w.x, w.y, false);
            self.addSlider(sNode, self.pendingAction.aNode, self.pendingAction.bNode);
            self.pendingAction = null;
          }
          break;

        case 'add_gear':
          if (nearNode !== -1) {
            self.addGear(nearNode, 40, 16);
          }
          break;

        case 'add_motor':
          if (!self.pendingAction) {
            if (nearNode !== -1) {
              self.pendingAction = { tool: 'add_motor', centerNode: nearNode };
            }
          } else if (nearNode !== -1 && nearNode !== self.pendingAction.centerNode) {
            self.addMotor(self.pendingAction.centerNode, nearNode);
            self.pendingAction = null;
          }
          break;

        case 'delete':
          self.deleteElementAt(w.x, w.y);
          break;
      }
      self.render();
    });

    canvas.addEventListener('mousemove', function(e) {
      var rect = canvas.getBoundingClientRect();
      var sx = e.clientX - rect.left;
      var sy = e.clientY - rect.top;

      if (self.isPanning) {
        self.panX = sx - self.dragStartX;
        self.panY = sy - self.dragStartY;
        self.render();
        return;
      }

      var w = self.screenToWorld(sx, sy);
      self.hoverNodeId = self.findNodeNear(w.x, w.y);

      if (self.isDragging && self.selectedNodeId !== -1) {
        var node = self.getNodeById(self.selectedNodeId);
        if (node) {
          node.x = Math.round(w.x);
          node.y = Math.round(w.y);
          // Update connected rod lengths in editor
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
      self.render();
    });

    window.addEventListener('mouseup', function() {
      self.isDragging = false;
      self.isPanning = false;
      self.render();
    });

    canvas.addEventListener('wheel', function(e) {
      e.preventDefault();
      var rect = canvas.getBoundingClientRect();
      var sx = e.clientX - rect.left;
      var sy = e.clientY - rect.top;
      var wBefore = self.screenToWorld(sx, sy);

      var zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      self.zoom = Math.max(0.2, Math.min(5.0, self.zoom * zoomFactor));

      self.panX = sx - wBefore.x * self.zoom;
      self.panY = sy - wBefore.y * self.zoom;
      self.render();
    });

    canvas.addEventListener('contextmenu', function(e) {
      e.preventDefault();
    });
  };

  MechanismEditor.prototype.render = function() {
    var ctx = this.ctx;
    var canvas = this.canvas;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background grid
    this._drawGrid(ctx);

    ctx.save();
    ctx.translate(this.panX, this.panY);
    ctx.scale(this.zoom, this.zoom);

    // Draw Sliders
    for (var sl = 0; sl < this.sliders.length; sl++) {
      var s = this.sliders[sl];
      var na = this.getNodeById(s.aNode);
      var nb = this.getNodeById(s.bNode);
      var ns = this.getNodeById(s.node);
      if (na && nb && ns) {
        this.renderer.drawSlider(ctx, na.x, na.y, nb.x, nb.y, ns.x, ns.y);
      }
    }

    // Draw Gears
    for (var gi = 0; gi < this.gears.length; gi++) {
      var gear = this.gears[gi];
      var cNode = this.getNodeById(gear.centerNode);
      if (cNode) {
        this.renderer.drawGear(ctx, cNode.x, cNode.y, gear.radius, gear.teeth, 0);
      }
    }

    // Draw Rods
    for (var r = 0; r < this.rods.length; r++) {
      var rod = this.rods[r];
      var a = this.getNodeById(rod.a);
      var b = this.getNodeById(rod.b);
      if (a && b) {
        this.renderer.drawCapsuleLink(ctx, a.x, a.y, b.x, b.y, rod.width, 0, rod.color);
      }
    }

    // Draw Motors
    for (var m = 0; m < this.motors.length; m++) {
      var motor = this.motors[m];
      var cNode = this.getNodeById(motor.centerNode);
      var crNode = this.getNodeById(motor.crankNode);
      if (cNode && crNode) {
        var r = Math2D.dist(cNode.x, cNode.y, crNode.x, crNode.y);
        this.renderer.drawMotorIndicator(ctx, cNode.x, cNode.y, r, motor.speed);
      }
    }

    // Draw Nodes and Pins
    for (var i = 0; i < this.nodes.length; i++) {
      var n = this.nodes[i];
      if (n.fixed) {
        this.renderer.drawGroundAnchor(ctx, n.x, n.y, 16);
      } else {
        ctx.beginPath();
        ctx.arc(n.x, n.y, 7, 0, Math.PI * 2);
        ctx.fillStyle = (n.id === this.selectedNodeId) ? '#f59e0b' : '#0f172a';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      }

      // Hover highlight
      if (n.id === this.hoverNodeId) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, 11, 0, Math.PI * 2);
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Pending action line indicator
      if (this.pendingAction) {
        var pFrom = null;
        if (this.pendingAction.fromNode !== undefined) pFrom = this.getNodeById(this.pendingAction.fromNode);
        if (this.pendingAction.centerNode !== undefined) pFrom = this.getNodeById(this.pendingAction.centerNode);
        if (this.pendingAction.aNode !== undefined) pFrom = this.getNodeById(this.pendingAction.aNode);

        if (pFrom) {
          ctx.beginPath();
          ctx.arc(pFrom.x, pFrom.y, 13, 0, Math.PI * 2);
          ctx.strokeStyle = '#22c55e';
          ctx.lineWidth = 2.5;
          ctx.stroke();
        }
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

    // Axis lines at world (0, 0)
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

  /**
   * Presets library for quick mechanism testing and demonstration.
   */
  MechanismEditor.Presets = {
    // 1. Classic Klann 6-Bar Walking Mechanism
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
      ]
    },

    // 2. Slider-Crank (Piston Engine)
    sliderCrank: {
      version: '2.0',
      nodes: [
        { id: 0, x: -100, y: 0, fixed: true, mass: 1 },   // Crankshaft journal
        { id: 1, x: -60, y: 0, fixed: false, mass: 1 },    // Crankpin
        { id: 2, x: 70, y: 0, fixed: false, mass: 1 },     // Wrist pin (piston)
        { id: 3, x: 0, y: 0, fixed: true, mass: 1 },      // Rail start
        { id: 4, x: 180, y: 0, fixed: true, mass: 1 }      // Rail end
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
      ]
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
      ]
    },

    // 4. Compound Gear Train
    gearTrain: {
      version: '2.0',
      nodes: [
        { id: 0, x: -70, y: 0, fixed: true, mass: 1 },
        { id: 1, x: -70, y: 35, fixed: false, mass: 1 },
        { id: 2, x: 0, y: 0, fixed: true, mass: 1 },
        { id: 3, x: 90, y: 0, fixed: true, mass: 1 }
      ],
      rods: [],
      sliders: [],
      gears: [
        { centerNode: 0, radius: 35, teeth: 14, meshWith: [1] },
        { centerNode: 2, radius: 35, teeth: 14, meshWith: [0, 2] },
        { centerNode: 3, radius: 55, teeth: 22, meshWith: [1] }
      ],
      motors: [
        { centerNode: 0, crankNode: 1, speed: 2.0 }
      ]
    }
  };

  return MechanismEditor;
});
