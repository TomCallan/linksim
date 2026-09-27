/**
 * Programmatic API for Linksim.
 * Allows AI agents, external scripts, and developers to construct, simulate,
 * query, and automate mechanical simulations cleanly.
 */
(function(root, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = factory();
  } else {
    root.LinksimAPI = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  function createAPI(editor, physics, timeline, renderer) {
    var API = {
      version: '2.0',

      /**
       * Declaratively build a full simulation mechanism from a configuration object.
       */
      build: function(spec) {
        if (!spec) return;
        if (editor) {
          editor.loadJSON(spec);
        } else if (physics) {
          physics.clear();
          if (spec.nodes) {
            for (var i = 0; i < spec.nodes.length; i++) {
              var n = spec.nodes[i];
              physics.addNode(n.x, n.y, n.fixed, n.mass);
            }
          }
          if (spec.rods) {
            for (var r = 0; r < spec.rods.length; r++) {
              var rod = spec.rods[r];
              physics.addRod(rod.a, rod.b, rod.length, { width: rod.width, color: rod.color }, rod.material);
            }
          }
          if (spec.brackets) {
            for (var b = 0; b < spec.brackets.length; b++) {
              var br = spec.brackets[b];
              physics.addRigidBracket(br.a, br.b, br.c, br.width, br.color);
            }
          }
          if (spec.sliders) {
            for (var s = 0; s < spec.sliders.length; s++) {
              var sl = spec.sliders[s];
              var sObj = physics.addSlider(sl.node, sl.aNode, sl.bNode, sl.minT, sl.maxT);
              if (sl.friction) sObj.friction = sl.friction;
            }
          }
          if (spec.gears) {
            for (var g = 0; g < spec.gears.length; g++) {
              var gear = spec.gears[g];
              var gObj = physics.addGear(gear.centerNode, gear.radius, gear.teeth);
              if (gear.meshWith) gObj.meshWith = gear.meshWith.slice();
            }
          }
          if (spec.motors) {
            for (var m = 0; m < spec.motors.length; m++) {
              var mot = spec.motors[m];
              physics.addMotor(mot.centerNode, mot.crankNode, mot.speed);
            }
          }
          if (spec.gravity) {
            physics.gravityX = spec.gravity.x || 0;
            physics.gravityY = spec.gravity.y || 0;
          }
          if (timeline) timeline.reset();
        }
        return API;
      },

      addNode: function(x, y, fixed, mass) {
        if (editor) return editor.addNode(x, y, fixed);
        if (physics) return physics.addNode(x, y, fixed, mass);
        return -1;
      },

      addRod: function(a, b, length, materialKey, style) {
        if (editor) {
          editor.addRod(a, b, style);
          var lastRod = editor.rods[editor.rods.length - 1];
          if (lastRod && materialKey) lastRod.material = materialKey;
          return lastRod;
        }
        if (physics) return physics.addRod(a, b, length, style, materialKey);
        return null;
      },

      addSlider: function(node, aNode, bNode, minT, maxT, friction) {
        if (editor) return editor.addSlider(node, aNode, bNode);
        if (physics) {
          var s = physics.addSlider(node, aNode, bNode, minT, maxT);
          if (friction) s.friction = friction;
          return s;
        }
        return null;
      },

      addGear: function(centerNode, radius, teeth) {
        if (editor) return editor.addGear(centerNode, radius, teeth);
        if (physics) return physics.addGear(centerNode, radius, teeth);
        return null;
      },

      addMotor: function(centerNode, crankNode, speed) {
        if (editor) return editor.addMotor(centerNode, crankNode, speed);
        if (physics) return physics.addMotor(centerNode, crankNode, speed);
        return null;
      },

      addBracket: function(a, b, c, width, color) {
        if (editor) return editor.addRigidBracket(a, b, c);
        if (physics) return physics.addRigidBracket(a, b, c, width, color);
        return null;
      },

      setGravity: function(gx, gy) {
        if (physics) {
          physics.gravityX = gx;
          physics.gravityY = gy;
        }
      },

      step: function(dt) {
        dt = dt || (1 / 60);
        if (timeline) timeline.stepForward(dt);
        else if (physics) physics.step(dt);
      },

      play: function() {
        if (timeline) timeline.play();
      },

      pause: function() {
        if (timeline) timeline.pause();
      },

      reset: function() {
        if (timeline) timeline.reset();
      },

      setSpeed: function(speed) {
        if (timeline) timeline.setSpeed(speed);
      },

      clear: function() {
        if (editor) editor.clear();
        else if (physics) physics.clear();
      },

      getState: function() {
        if (!physics) return null;
        var nodes = [];
        for (var i = 0; i < physics.numNodes; i++) {
          nodes.push({
            id: i,
            x: physics.x[i],
            y: physics.y[i],
            vx: physics.vx[i],
            vy: physics.vy[i],
            fixed: !!physics.isFixed[i]
          });
        }
        var rods = physics.rods.map(function(r) {
          return { a: r.a, b: r.b, length: r.length, stress: r.stress, material: r.material };
        });
        var gears = physics.gears.map(function(g) {
          return { centerNode: g.centerNode, radius: g.radius, teeth: g.teeth, angle: g.angle };
        });
        var motors = physics.motors.map(function(m) {
          return { centerNode: m.centerNode, crankNode: m.crankNode, speed: m.speed, angle: m.angle, active: m.active };
        });
        return {
          time: physics.time,
          nodes: nodes,
          rods: rods,
          gears: gears,
          motors: motors
        };
      },

      getJSON: function() {
        if (editor) return editor.exportJSON();
        return null;
      },

      loadJSON: function(data) {
        if (editor) editor.loadJSON(data);
      },

      getMaterials: function() {
        return (physics && physics.constructor.Materials) || {};
      },

      trackNode: function(nodeId) {
        if (editor) editor.toggleTrackNode(nodeId);
      },

      untrackNode: function(nodeId) {
        if (editor && editor.trackedNodes.has(nodeId)) {
          editor.toggleTrackNode(nodeId);
        }
      },

      clearTraces: function() {
        if (renderer) renderer.clearTraces();
        if (editor && editor.renderer) editor.renderer.clearTraces();
      },

      getTraces: function() {
        if (renderer) return renderer.traces;
        if (editor && editor.renderer) return editor.renderer.traces;
        return {};
      },

      setAnalysisOptions: function(opts) {
        if (!opts) return;
        var r = renderer || (editor && editor.renderer);
        if (r) {
          if (typeof opts.dimensions === 'boolean') r.showDimensions = opts.dimensions;
          if (typeof opts.velocities === 'boolean') r.showVelocities = opts.velocities;
          if (typeof opts.stress === 'boolean') r.showStress = opts.stress;
          if (typeof opts.traces === 'boolean') r.showTraces = opts.traces;
          if (typeof opts.unitScale === 'number') r.unitScale = opts.unitScale;
        }
        if (editor) editor.render(physics);
      },

      getLoopInfo: function() {
        if (timeline) return timeline.getLoopInfo();
        return null;
      },

      enableLoopCache: function(enabled) {
        if (timeline) timeline.setLoopCacheEnabled(enabled);
      },

      invalidateLoop: function() {
        if (timeline) timeline.invalidateLoop();
      }
    };

    return API;
  }

  return {
    init: createAPI
  };
});
