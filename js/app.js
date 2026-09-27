/**
 * Main Application Orchestrator for Linksim Modernization.
 * Coordinates Editor, Physics Solver, Timeline Playback, and requestAnimationFrame Loop.
 */
(function() {
  'use strict';

  var incanvas, outcanvas;
  var inctx, outctx;
  var editor;
  var physics;
  var timeline;
  var renderer;

  // Sim canvas view state
  var simPanX = 300;
  var simPanY = 300;
  var simZoom = 1.0;
  var simDraggingNode = -1;
  var simIsPanning = false;
  var simDragStartX = 0;
  var simDragStartY = 0;

  // FPS tracking
  var lastFrameTime = performance.now();
  var frameCount = 0;
  var fpsDisplayTimer = 0;
  var currentFPS = 60;

  function init() {
    incanvas = document.getElementById('incanvas');
    outcanvas = document.getElementById('outcanvas');
    inctx = incanvas.getContext('2d');
    outctx = outcanvas.getContext('2d');

    physics = new PhysicsSystem();
    timeline = new Timeline(physics);
    renderer = new SpriteRenderer();

    editor = new MechanismEditor(incanvas, function(modelJSON) {
      loadModelIntoPhysics(modelJSON);
    });

    // Resize handling
    window.addEventListener('resize', handleResize);
    handleResize();

    // Bind Sim Canvas Interactions
    bindSimCanvasEvents();

    // Bind UI controls
    bindToolbarControls();
    bindPlaybackControls();

    // Load initial preset (Klann Walker)
    loadPreset('klann');

    // Start requestAnimationFrame loop
    requestAnimationFrame(loop);
  }

  function handleResize() {
    var panel = incanvas.parentElement;
    var panelWidth = panel ? (panel.clientWidth - 26) : 500;
    var maxH = window.innerHeight - 260;
    var size = Math.max(280, Math.min(panelWidth, maxH, 700));

    incanvas.width = size;
    incanvas.height = size;
    outcanvas.width = size;
    outcanvas.height = size;

    if (editor) {
      editor.panX = size / 2;
      editor.panY = size / 2;
      editor.render();
    }
    simPanX = size / 2;
    simPanY = size / 2;
  }

  function loadModelIntoPhysics(model) {
    physics.clear();
    renderer.clearTraces();

    // Add nodes
    for (var i = 0; i < model.nodes.length; i++) {
      var n = model.nodes[i];
      physics.addNode(n.x, n.y, n.fixed, n.mass);
    }

    // Add rods
    for (var r = 0; r < model.rods.length; r++) {
      var rod = model.rods[r];
      physics.addRod(rod.a, rod.b, rod.length, { width: rod.width, color: rod.color });
    }

    // Add sliders
    for (var s = 0; s < model.sliders.length; s++) {
      var sl = model.sliders[s];
      physics.addSlider(sl.node, sl.aNode, sl.bNode, sl.minT, sl.maxT);
    }

    // Add gears
    for (var g = 0; g < model.gears.length; g++) {
      var gear = model.gears[g];
      var gObj = physics.addGear(gear.centerNode, gear.radius, gear.teeth);
      if (gear.meshWith) {
        gObj.meshWith = gear.meshWith.slice();
      }
    }

    // Add motors
    for (var m = 0; m < model.motors.length; m++) {
      var mot = model.motors[m];
      physics.addMotor(mot.centerNode, mot.crankNode, mot.speed);
    }

    timeline.reset();
  }

  function loadPreset(name) {
    var preset = MechanismEditor.Presets[name];
    if (preset) {
      editor.loadJSON(preset);
      document.getElementById('presetSelect').value = name;
    }
  }

  function bindToolbarControls() {
    var toolButtons = document.querySelectorAll('[data-tool]');
    toolButtons.forEach(function(btn) {
      btn.addEventListener('click', function() {
        toolButtons.forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        editor.setTool(btn.getAttribute('data-tool'));
      });
    });

    document.getElementById('btnClear').addEventListener('click', function() {
      if (confirm('Clear workspace?')) {
        editor.clear();
      }
    });

    document.getElementById('presetSelect').addEventListener('change', function(e) {
      loadPreset(e.target.value);
    });

    // Checkbox toggles
    var stressToggle = document.getElementById('toggleStress');
    if (stressToggle) {
      stressToggle.addEventListener('change', function(e) {
        renderer.showStress = e.target.checked;
      });
    }

    var traceToggle = document.getElementById('toggleTraces');
    if (traceToggle) {
      traceToggle.addEventListener('change', function(e) {
        renderer.showTraces = e.target.checked;
      });
    }
  }

  function bindPlaybackControls() {
    var btnPlay = document.getElementById('btnPlay');
    var btnStepBack = document.getElementById('btnStepBack');
    var btnStepForward = document.getElementById('btnStepForward');
    var btnReset = document.getElementById('btnReset');
    var timeSlider = document.getElementById('timeSlider');
    var speedSelect = document.getElementById('speedSelect');
    var frameInfo = document.getElementById('frameInfo');

    btnPlay.addEventListener('click', function() {
      timeline.togglePlay();
      btnPlay.textContent = timeline.isPlaying ? 'Pause' : 'Play';
    });

    btnStepBack.addEventListener('click', function() {
      timeline.stepBackward();
      btnPlay.textContent = 'Play';
    });

    btnStepForward.addEventListener('click', function() {
      timeline.stepForward();
      btnPlay.textContent = 'Play';
    });

    btnReset.addEventListener('click', function() {
      timeline.reset();
      renderer.clearTraces();
      btnPlay.textContent = timeline.isPlaying ? 'Pause' : 'Play';
    });

    timeSlider.addEventListener('input', function(e) {
      var val = parseInt(e.target.value, 10);
      timeline.scrubTo(val);
      btnPlay.textContent = 'Play';
    });

    speedSelect.addEventListener('change', function(e) {
      timeline.setSpeed(parseFloat(e.target.value));
    });

    timeline.onFrameChanged = function(curr, total, isPlaying) {
      timeSlider.max = Math.max(0, total - 1);
      timeSlider.value = curr;
      if (frameInfo) {
        frameInfo.textContent = 'Frame: ' + (curr + 1) + ' / ' + total;
      }
      if (btnPlay) {
        btnPlay.textContent = isPlaying ? 'Pause' : 'Play';
      }
    };
  }

  function bindSimCanvasEvents() {
    outcanvas.addEventListener('mousedown', function(e) {
      var rect = outcanvas.getBoundingClientRect();
      var sx = e.clientX - rect.left;
      var sy = e.clientY - rect.top;
      var wx = (sx - simPanX) / simZoom;
      var wy = (sy - simPanY) / simZoom;

      if (e.button === 1 || e.button === 2) {
        simIsPanning = true;
        simDragStartX = sx - simPanX;
        simDragStartY = sy - simPanY;
        e.preventDefault();
        return;
      }

      // Check for node under cursor to drag interactively
      var bestId = -1;
      var bestDistSq = 20 * 20 / (simZoom * simZoom);
      for (var i = 0; i < physics.numNodes; i++) {
        var dSq = Math2D.distSq(wx, wy, physics.x[i], physics.y[i]);
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          bestId = i;
        }
      }

      if (bestId !== -1 && !physics.isFixed[bestId]) {
        simDraggingNode = bestId;
      } else {
        simIsPanning = true;
        simDragStartX = sx - simPanX;
        simDragStartY = sy - simPanY;
      }
    });

    outcanvas.addEventListener('mousemove', function(e) {
      var rect = outcanvas.getBoundingClientRect();
      var sx = e.clientX - rect.left;
      var sy = e.clientY - rect.top;

      if (simIsPanning) {
        simPanX = sx - simDragStartX;
        simPanY = sy - simDragStartY;
        return;
      }

      if (simDraggingNode !== -1) {
        var wx = (sx - simPanX) / simZoom;
        var wy = (sy - simPanY) / simZoom;
        physics.x[simDraggingNode] = wx;
        physics.y[simDraggingNode] = wy;
        physics.vx[simDraggingNode] = 0;
        physics.vy[simDraggingNode] = 0;
      }
    });

    window.addEventListener('mouseup', function() {
      simDraggingNode = -1;
      simIsPanning = false;
    });

    outcanvas.addEventListener('wheel', function(e) {
      e.preventDefault();
      var rect = outcanvas.getBoundingClientRect();
      var sx = e.clientX - rect.left;
      var sy = e.clientY - rect.top;
      var wx = (sx - simPanX) / simZoom;
      var wy = (sy - simPanY) / simZoom;

      var factor = e.deltaY < 0 ? 1.1 : 0.9;
      simZoom = Math.max(0.2, Math.min(5.0, simZoom * factor));
      simPanX = sx - wx * simZoom;
      simPanY = sy - wy * simZoom;
    });

    outcanvas.addEventListener('contextmenu', function(e) {
      e.preventDefault();
    });
  }

  function loop(timestamp) {
    var dt = (timestamp - lastFrameTime) / 1000;
    lastFrameTime = timestamp;

    // Clamp dt to avoid explosion on background tab
    if (dt > 0.1) dt = 0.1;

    // Track FPS
    frameCount++;
    fpsDisplayTimer += dt;
    if (fpsDisplayTimer >= 0.5) {
      currentFPS = Math.round(frameCount / fpsDisplayTimer);
      frameCount = 0;
      fpsDisplayTimer = 0;
      var fpsEl = document.getElementById('fpsMeter');
      if (fpsEl) fpsEl.textContent = currentFPS + ' FPS';
    }

    // Step physics & timeline
    timeline.update(dt);

    // Record motion trace for foot or end-effector nodes
    if (physics.numNodes > 0 && timeline.isPlaying) {
      var trackNode = physics.numNodes - 1; // Last node by default (e.g. foot / coupler tip)
      renderer.recordTrace(trackNode, physics.x[trackNode], physics.y[trackNode]);
    }

    // Render simulation canvas
    renderSimulation();

    requestAnimationFrame(loop);
  }

  function renderSimulation() {
    outctx.clearRect(0, 0, outcanvas.width, outcanvas.height);

    // Grid lines
    drawGrid(outctx, outcanvas, simPanX, simPanY, simZoom);

    outctx.save();
    outctx.translate(simPanX, simPanY);
    outctx.scale(simZoom, simZoom);

    // Render trace paths
    renderer.drawTracePaths(outctx);

    // Render Sliders
    for (var sl = 0; sl < physics.sliders.length; sl++) {
      var s = physics.sliders[sl];
      var ax = physics.x[s.aNode], ay = physics.y[s.aNode];
      var bx = physics.x[s.bNode], by = physics.y[s.bNode];
      var px = physics.x[s.node],  py = physics.y[s.node];
      renderer.drawSlider(outctx, ax, ay, bx, by, px, py);
    }

    // Render Gears
    for (var gi = 0; gi < physics.gears.length; gi++) {
      var gear = physics.gears[gi];
      var cx = physics.x[gear.centerNode];
      var cy = physics.y[gear.centerNode];
      renderer.drawGear(outctx, cx, cy, gear.radius, gear.teeth, gear.angle);
    }

    // Render Rods
    for (var r = 0; r < physics.rods.length; r++) {
      var rod = physics.rods[r];
      var x1 = physics.x[rod.a], y1 = physics.y[rod.a];
      var x2 = physics.x[rod.b], y2 = physics.y[rod.b];
      renderer.drawCapsuleLink(outctx, x1, y1, x2, y2, rod.width, rod.stress, rod.color);
    }

    // Render Motors
    for (var m = 0; m < physics.motors.length; m++) {
      var motor = physics.motors[m];
      var cx = physics.x[motor.centerNode];
      var cy = physics.y[motor.centerNode];
      renderer.drawMotorIndicator(outctx, cx, cy, motor.radius, motor.speed);
    }

    // Render Nodes and Ground Pins
    for (var i = 0; i < physics.numNodes; i++) {
      var nx = physics.x[i];
      var ny = physics.y[i];
      if (physics.isFixed[i]) {
        renderer.drawGroundAnchor(outctx, nx, ny, 16);
      } else {
        outctx.beginPath();
        outctx.arc(nx, ny, 7, 0, Math.PI * 2);
        outctx.fillStyle = (i === simDraggingNode) ? '#f59e0b' : '#0f172a';
        outctx.fill();
        outctx.lineWidth = 2;
        outctx.strokeStyle = '#ffffff';
        outctx.stroke();
      }
    }

    outctx.restore();
  }

  function drawGrid(ctx, canvas, panX, panY, zoom) {
    var w = canvas.width;
    var h = canvas.height;
    var gridSize = 40 * zoom;
    var offsetX = panX % gridSize;
    var offsetY = panY % gridSize;

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
    ctx.moveTo(panX, 0);
    ctx.lineTo(panX, h);
    ctx.moveTo(0, panY);
    ctx.lineTo(w, panY);
    ctx.stroke();

    ctx.restore();
  }

  window.addEventListener('DOMContentLoaded', init);
})();
