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
              physics.addRod(rod.a, rod.b, rod.length, {
                width: rod.width,
                color: rod.color,
                angleLock: rod.angleLock,
                lockedAngle: rod.lockedAngle
              }, rod.material);
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
          if (spec.genevas) {
            for (var gi = 0; gi < spec.genevas.length; gi++) {
              var gen = spec.genevas[gi];
              physics.addGeneva(gen.driverCenterNode, gen.driverPinNode, gen.genevaCenterNode, gen.slots, {
                initialAngle: gen.angle || 0,
                slotWidth: gen.slotWidth
              });
            }
          }
          if (spec.pulleys) {
            for (var pi = 0; pi < spec.pulleys.length; pi++) {
              var pul = spec.pulleys[pi];
              physics.addPulley(pul.nodeId, pul.radius, pul);
            }
          }
          if (spec.belts) {
            for (var bi = 0; bi < spec.belts.length; bi++) {
              var blt = spec.belts[bi];
              physics.addBelt(blt.pulleyA, blt.pulleyB, blt);
            }
          }
          if (spec.cams) {
            for (var ci = 0; ci < spec.cams.length; ci++) {
              var cam = spec.cams[ci];
              physics.addCam(cam.centerNode, cam.profileType, cam.baseRadius, cam.lift, cam.options);
            }
          }
          if (spec.camContacts) {
            for (var cci = 0; cci < spec.camContacts.length; cci++) {
              var cc = spec.camContacts[cci];
              physics.addCamContact(cc.camIdx, cc.followerNode, cc.rollerRadius, cc);
            }
          }
          if (spec.axles) {
            for (var axi = 0; axi < spec.axles.length; axi++) {
              var ax = spec.axles[axi];
              physics.addAxle(ax.targetA, ax.targetB, ax);
            }
          }
          if (spec.springs) {
            for (var sp = 0; sp < spec.springs.length; sp++) {
              var spr = spec.springs[sp];
              physics.addSpring(spr.a, spr.b, spr.restLength, spr.stiffness, spr);
            }
          }
          if (spec.motors) {
            for (var m = 0; m < spec.motors.length; m++) {
              var mot = spec.motors[m];
              physics.addMotor(mot.centerNode, mot.crankNode, mot.speed, mot);
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

      addSpring: function(a, b, restLength, stiffness, options) {
        if (editor) return editor.addSpring(a, b, Object.assign({ restLength: restLength, stiffness: stiffness }, options));
        if (physics) return physics.addSpring(a, b, restLength, stiffness, options);
        return null;
      },

      addSlider: function(node, aNode, bNode, minT, maxT, friction) {
        if (editor) return editor.addSlider(node, aNode, bNode, { minT: minT, maxT: maxT, friction: friction });
        if (physics) {
          var s = physics.addSlider(node, aNode, bNode, minT, maxT, { friction: friction });
          return s;
        }
        return null;
      },

      addLever: function(pivotX, pivotY, options) {
        if (editor) return editor.addLever(pivotX, pivotY, options);
        return null;
      },

      addGear: function(centerNode, radius, teeth, options) {
        if (editor) return editor.addGear(centerNode, radius, teeth, options);
        if (physics) return physics.addGear(centerNode, radius, teeth);
        return null;
      },

      addMotor: function(centerNode, crankNode, speed, options) {
        if (editor) return editor.addMotor(centerNode, crankNode, speed, options);
        if (physics) return physics.addMotor(centerNode, crankNode, speed, options);
        return null;
      },

      addBracket: function(a, b, c, width, color) {
        if (editor) return editor.addRigidBracket(a, b, c);
        if (physics) return physics.addRigidBracket(a, b, c, width, color);
        return null;
      },

      addGeneva: function(driverCenterNode, driverPinNode, genevaCenterNode, slots, options) {
        if (editor) return editor.addGeneva(driverCenterNode, driverPinNode, genevaCenterNode, slots, options);
        if (physics) return physics.addGeneva(driverCenterNode, driverPinNode, genevaCenterNode, slots, options);
        return null;
      },

      attachNodeToGeneva: function(nodeId, genevaIdx, radius, angleOffset) {
        if (physics) physics.attachNodeToGeneva(nodeId, genevaIdx, radius, angleOffset);
        if (editor) {
          var n = editor.getNodeById(nodeId);
          if (n) {
            n.parentGeneva = { genevaIdx: genevaIdx, radius: radius, angleOffset: angleOffset };
            editor._notifyChange();
          }
        }
      },

      addPulley: function(nodeId, radius, options) {
        if (editor) return editor.addPulley(nodeId, radius, options);
        if (physics) return physics.addPulley(nodeId, radius, options);
        return null;
      },

      addBelt: function(pulleyA, pulleyB, options) {
        if (editor) return editor.addBelt(pulleyA, pulleyB, options);
        if (physics) return physics.addBelt(pulleyA, pulleyB, options);
        return null;
      },

      addAxle: function(targetA, targetB, options) {
        if (editor) return editor.addAxle(targetA, targetB, options);
        if (physics) return physics.addAxle(targetA, targetB, options);
        return null;
      },

      addCam: function(centerNode, profileType, baseRadius, lift, options) {
        if (editor) return editor.addCam(centerNode, profileType, baseRadius, lift, options);
        if (physics) return physics.addCam(centerNode, profileType, baseRadius, lift, options);
        return null;
      },

      addCamContact: function(camIdx, followerNode, rollerRadius, options) {
        if (editor) return editor.addCamContact(camIdx, followerNode, rollerRadius);
        if (physics) return physics.addCamContact(camIdx, followerNode, rollerRadius, options);
        return null;
      },

      attachNodeToPulley: function(nodeId, pulleyIdx, radius, angleOffset) {
        if (physics) physics.attachNodeToPulley(nodeId, pulleyIdx, radius, angleOffset);
        if (editor) {
          var n = editor.getNodeById(nodeId);
          if (n) {
            n.parentPulley = { pulleyIdx: pulleyIdx, radius: radius, angleOffset: angleOffset };
            editor._notifyChange();
          }
        }
      },

      attachNodeToCam: function(nodeId, camIdx, radius, angleOffset) {
        if (physics) physics.attachNodeToCam(nodeId, camIdx, radius, angleOffset);
        if (editor) {
          var n = editor.getNodeById(nodeId);
          if (n) {
            n.parentCam = { camIdx: camIdx, radius: radius, angleOffset: angleOffset };
            editor._notifyChange();
          }
        }
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
          return {
            centerNode: m.centerNode,
            crankNode: m.crankNode,
            speed: m.speed,
            actualSpeed: m.actualSpeed !== undefined ? m.actualSpeed : m.speed,
            angle: m.angle,
            active: m.active,
            maxTorque: m.maxTorque,
            currentTorque: m.currentTorque || 0,
            stalled: !!m.stalled
          };
        });
        var sliders = physics.sliders.map(function(s) {
          return {
            node: s.node,
            aNode: s.aNode,
            bNode: s.bNode,
            minT: s.minT,
            maxT: s.maxT,
            friction: s.friction
          };
        });
        var genevas = physics.genevas.map(function(gen) {
          return {
            driverCenterNode: gen.driverCenterNode,
            driverPinNode: gen.driverPinNode,
            genevaCenterNode: gen.genevaCenterNode,
            slots: gen.slots,
            radius: gen.radius,
            angle: gen.angle,
            dwellAngle: gen.dwellAngle,
            isEngaged: gen.isEngaged
          };
        });
        var pulleys = physics.pulleys.map(function(p) {
          return { nodeId: p.nodeId, radius: p.radius, angle: p.angle, angularVelocity: p.angularVelocity };
        });
        var belts = physics.belts.map(function(b) {
          return { pulleyA: b.pulleyA, pulleyB: b.pulleyB, crossed: b.crossed, width: b.width };
        });
        var cams = physics.cams.map(function(c) {
          return { centerNode: c.centerNode, profileType: c.profileType, baseRadius: c.baseRadius, lift: c.lift, angle: c.angle };
        });
        var camContacts = physics.camContacts.map(function(cc) {
          return { camIdx: cc.camIdx, followerNode: cc.followerNode, rollerRadius: cc.rollerRadius, normalForce: cc.normalForce };
        });
        var axles = physics.axles.map(function(ax) {
          return { targetA: ax.targetA, targetB: ax.targetB, ratio: ax.ratio };
        });
        var springs = (physics.springs || []).map(function(s) {
          return { a: s.a, b: s.b, restLength: s.restLength, stiffness: s.stiffness, force: s.force, currentLength: s.currentLength };
        });
        return {
          time: physics.time,
          nodes: nodes,
          rods: rods,
          springs: springs,
          sliders: sliders,
          gears: gears,
          motors: motors,
          genevas: genevas,
          pulleys: pulleys,
          belts: belts,
          cams: cams,
          camContacts: camContacts,
          axles: axles
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
      },

      derailLoop: function(reason) {
        if (timeline) timeline.derail(reason || 'api_derail');
      },

      dragNode: function(nodeId, x, y) {
        if (timeline) timeline.onHumanInputStart('node', nodeId);
        if (physics) physics.setMouseDrag(nodeId, x, y);
      },

      releaseDrag: function() {
        if (physics) physics.clearMouseDrag();
        if (timeline) timeline.onHumanInputEnd();
      },

      setHidePins: function(hide) {
        var r = renderer || (editor && editor.renderer);
        if (r) r.hidePins = !!hide;
        if (editor) editor.render(physics);
      },

      getHidePins: function() {
        var r = renderer || (editor && editor.renderer);
        return r ? !!r.hidePins : false;
      },

      lockRodAngle: function(rodIdx, orientation, angleDeg) {
        var r = null;
        if (editor && editor.rods[rodIdx]) {
          r = editor.rods[rodIdx];
        } else if (physics && physics.rods[rodIdx]) {
          r = physics.rods[rodIdx];
        }
        if (r) {
          r.angleLock = orientation || 'none';
          if (angleDeg !== undefined) {
            r.lockedAngle = angleDeg * Math.PI / 180;
          }
          if (editor) editor._notifyChange();
        }
      },

      // Add a text label at world coordinates (x, y) with given text and style options
      addLabel: function(x, y, text, options) {
        if (!editor) return null;
        return editor.addLabel(x, y, text, options);
      },

      // Remove a label by index
      deleteLabel: function(idx) {
        if (!editor) return;
        editor.deleteLabel(idx);
      },

      // Get all labels
      getLabels: function() {
        if (!editor) return [];
        return (editor.labels || []).map(function(lb) {
          return { x: lb.x, y: lb.y, text: lb.text, fontSize: lb.fontSize, color: lb.color, bold: lb.bold };
        });
      },

      // Rotate a slider rail to specified angle in degrees around its midpoint
      rotateSliderRail: function(sliderIdx, angleDeg, railLength) {
        if (!editor) return;
        editor.rotateSliderRail(sliderIdx, angleDeg, railLength);
      },

      // Add a connection pin attached to a moving target (gear, pulley, cam, geneva)
      createPinOnTarget: function(elem, wx, wy) {
        if (!editor) return -1;
        return editor.createPinOnTarget(elem, wx, wy);
      }
    };

    return API;
  }

  return {
    init: createAPI
  };
});
