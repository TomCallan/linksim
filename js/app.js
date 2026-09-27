/**
 * Main Application Orchestrator for Linksim Modernization.
 * Coordinates Single-Window Unified Canvas, Mode Switching, Context Menus, and Playback.
 */
(function() {
  'use strict';

  var canvas;
  var ctx;
  var editor;
  var physics;
  var timeline;
  var renderer;

  // FPS tracking
  var lastFrameTime = performance.now();
  var frameCount = 0;
  var fpsDisplayTimer = 0;
  var currentFPS = 60;

  // Context menu element
  var contextMenuEl;

  function init() {
    canvas = document.getElementById('maincanvas');
    ctx = canvas.getContext('2d');
    contextMenuEl = document.getElementById('contextMenu');

    physics = new PhysicsSystem();
    timeline = new Timeline(physics);

    editor = new MechanismEditor(canvas, function(modelJSON) {
      loadModelIntoPhysics(modelJSON);
    });
    renderer = editor.renderer;

    // Wire Direct Physics Interactions
    editor.onDirectDragNode = function(nodeId, x, y) {
      physics.setMouseDrag(nodeId, x, y);
      timeline.invalidateLoop();
    };
    editor.onDirectDragRelease = function() {
      physics.clearMouseDrag();
    };
    editor.onManualRotateGear = function(gearIdx, deltaAngle) {
      physics.rotateGearManual(gearIdx, deltaAngle);
      timeline.invalidateLoop();
    };

    // Wire Context Menu
    editor.onShowContextMenu = function(clientX, clientY, targetType, targetData) {
      showContextMenu(clientX, clientY, targetType, targetData);
    };

    // Wire Element Inspector
    editor.onConfigureElement = function(targetType, targetData) {
      openInspector(targetType, targetData);
    };

    // Initialize Programmatic API on window for AI agents and scripts
    if (typeof LinksimAPI !== 'undefined') {
      window.LinksimAPI = LinksimAPI.init(editor, physics, timeline, renderer);
    }

    // Hide context menu on click elsewhere
    window.addEventListener('click', function() {
      hideContextMenu();
    });

    // Window Resize handling (fit full viewport)
    window.addEventListener('resize', handleResize);
    handleResize();

    // Bind UI & Playback Controls
    bindHeaderControls();
    bindPlaybackControls();
    bindKeyboardShortcuts();

    // Load initial preset (Klann Walker)
    loadPreset('klann');

    // Default to Simulate mode running
    setMode('simulate');

    // Start requestAnimationFrame loop
    requestAnimationFrame(loop);
  }

  function handleResize() {
    var header = document.querySelector('header');
    var playbackBar = document.querySelector('.playback-bar');
    var headerH = header ? header.offsetHeight : 52;
    var barH = playbackBar ? playbackBar.offsetHeight : 56;

    var availW = window.innerWidth;
    var availH = Math.max(300, window.innerHeight - headerH - barH);

    canvas.width = availW;
    canvas.height = availH;

    if (editor) {
      editor.panX = availW / 2;
      editor.panY = availH / 2;
      editor.render(physics);
    }
  }

  function setMode(mode) {
    editor.mode = mode;
    var btnEdit = document.getElementById('btnModeEdit');
    var btnSim = document.getElementById('btnModeSim');
    var toolsPanel = document.getElementById('editTools');

    if (mode === 'edit') {
      if (btnEdit) btnEdit.classList.add('active');
      if (btnSim) btnSim.classList.remove('active');
      if (toolsPanel) toolsPanel.style.display = 'flex';
      timeline.pause();
    } else {
      if (btnSim) btnSim.classList.add('active');
      if (btnEdit) btnEdit.classList.remove('active');
      if (toolsPanel) toolsPanel.style.display = 'none';
      timeline.play();
    }
    hideContextMenu();
    editor.render(physics);
  }

  function loadModelIntoPhysics(model) {
    physics.clear();
    renderer.clearTraces();

    // 1. Add nodes
    for (var i = 0; i < model.nodes.length; i++) {
      var n = model.nodes[i];
      physics.addNode(n.x, n.y, n.fixed, n.mass);
    }

    // 2. Add rods
    for (var r = 0; r < model.rods.length; r++) {
      var rod = model.rods[r];
      physics.addRod(rod.a, rod.b, rod.length, { width: rod.width, color: rod.color });
    }

    // 3. Add brackets (bell cranks)
    if (model.brackets) {
      for (var b = 0; b < model.brackets.length; b++) {
        var br = model.brackets[b];
        physics.addRigidBracket(br.a, br.b, br.c, br.width, br.color);
      }
    }

    // 4. Add sliders
    for (var s = 0; s < model.sliders.length; s++) {
      var sl = model.sliders[s];
      physics.addSlider(sl.node, sl.aNode, sl.bNode, sl.minT, sl.maxT);
    }

    // 5. Add gears
    for (var g = 0; g < model.gears.length; g++) {
      var gear = model.gears[g];
      var gObj = physics.addGear(gear.centerNode, gear.radius, gear.teeth);
      if (gear.meshWith) {
        gObj.meshWith = gear.meshWith.slice();
      }
    }

    // 6. Connect parented nodes to gears
    for (var i = 0; i < model.nodes.length; i++) {
      var n = model.nodes[i];
      if (n.parentGear) {
        physics.attachNodeToGear(n.id, n.parentGear.gearIdx, n.parentGear.radius, n.parentGear.angleOffset);
      }
    }

    // 7. Add motors
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

  function bindHeaderControls() {
    document.getElementById('btnModeEdit').addEventListener('click', function() {
      setMode('edit');
    });
    document.getElementById('btnModeSim').addEventListener('click', function() {
      setMode('simulate');
    });

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

    document.getElementById('btnUndo').addEventListener('click', function() {
      editor.undo();
    });

    document.getElementById('presetSelect').addEventListener('change', function(e) {
      loadPreset(e.target.value);
    });
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
      if (timeline.isPlaying) setMode('simulate');
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

    // Checkboxes
    var gravToggle = document.getElementById('toggleGravity');
    if (gravToggle) {
      gravToggle.addEventListener('change', function(e) {
        physics.gravityY = e.target.checked ? 980 : 0;
        timeline.invalidateLoop();
      });
    }

    var loopToggle = document.getElementById('toggleLoopCache');
    if (loopToggle) {
      loopToggle.addEventListener('change', function(e) {
        timeline.setLoopCacheEnabled(e.target.checked);
      });
    }

    var loopBadge = document.getElementById('loopBadge');
    timeline.onLoopStatusChanged = function(info) {
      if (loopBadge) {
        if (info.detected && info.caching) {
          loopBadge.style.display = 'inline-block';
          loopBadge.textContent = 'Loop Cached (' + info.period + 'f / ' + info.duration.toFixed(1) + 's)';
        } else if (info.detected && !info.caching) {
          loopBadge.style.display = 'inline-block';
          loopBadge.textContent = 'Loop Detected (' + info.period + 'f)';
        } else {
          loopBadge.style.display = 'none';
        }
      }
    };

    var stressToggle = document.getElementById('toggleStress');
    if (stressToggle) {
      stressToggle.addEventListener('change', function(e) {
        renderer.showStress = e.target.checked;
        editor.renderer.showStress = e.target.checked;
      });
    }

    var traceToggle = document.getElementById('toggleTraces');
    if (traceToggle) {
      traceToggle.addEventListener('change', function(e) {
        renderer.showTraces = e.target.checked;
        editor.renderer.showTraces = e.target.checked;
        editor.render(physics);
      });
    }

    var dimToggle = document.getElementById('toggleDimensions');
    if (dimToggle) {
      dimToggle.addEventListener('change', function(e) {
        editor.renderer.showDimensions = e.target.checked;
        editor.render(physics);
      });
    }

    var velToggle = document.getElementById('toggleVelocities');
    if (velToggle) {
      velToggle.addEventListener('change', function(e) {
        editor.renderer.showVelocities = e.target.checked;
        editor.render(physics);
      });
    }

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

  function bindKeyboardShortcuts() {
    window.addEventListener('keydown', function(e) {
      // Don't intercept if user is typing in an input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

      if (e.code === 'Space') {
        e.preventDefault();
        timeline.togglePlay();
        if (timeline.isPlaying) setMode('simulate');
      } else if (e.key === 'v' || e.key === 'V') {
        selectTool('select');
      } else if (e.key === 'p' || e.key === 'P') {
        selectTool('add_pin');
      } else if (e.key === 'j' || e.key === 'J' || e.key === 'n' || e.key === 'N') {
        selectTool('add_node');
      } else if (e.key === 'r' || e.key === 'R') {
        selectTool('add_rod');
      } else if (e.key === 's' || e.key === 'S') {
        selectTool('add_slider');
      } else if (e.key === 'g' || e.key === 'G') {
        selectTool('add_gear');
      } else if (e.key === 'm' || e.key === 'M') {
        selectTool('add_motor');
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (editor.selectedNodeId !== -1) {
          editor.deleteNode(editor.selectedNodeId);
          editor.selectedNodeId = -1;
        }
      } else if (e.ctrlKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        editor.undo();
      } else if (e.key === '[') {
        timeline.stepBackward();
      } else if (e.key === ']') {
        timeline.stepForward();
      }
    });
  }

  function selectTool(tool) {
    setMode('edit');
    var toolButtons = document.querySelectorAll('[data-tool]');
    toolButtons.forEach(function(b) {
      if (b.getAttribute('data-tool') === tool) b.classList.add('active');
      else b.classList.remove('active');
    });
    editor.setTool(tool);
  }

  function showContextMenu(clientX, clientY, targetType, targetData) {
    if (!contextMenuEl) return;
    contextMenuEl.innerHTML = '';
    contextMenuEl.style.display = 'block';

    // Position menu safely inside screen bounds
    var menuW = 200;
    var menuH = 180;
    var x = Math.min(clientX, window.innerWidth - menuW - 10);
    var y = Math.min(clientY, window.innerHeight - menuH - 10);
    contextMenuEl.style.left = x + 'px';
    contextMenuEl.style.top = y + 'px';

    var items = [];

    if (targetType === 'node') {
      var n = targetData;
      items.push({
        label: 'Configure Node...',
        action: function() { openInspector('node', n); }
      });
      items.push({
        label: editor.trackedNodes.has(n.id) ? 'Untrack Motion Trail' : 'Track Motion Path Trail',
        action: function() { editor.toggleTrackNode(n.id); }
      });
      items.push({
        label: n.fixed ? 'Free Joint (Unanchor)' : 'Anchor Ground Pin',
        action: function() { editor.toggleFixed(n.id); }
      });
      items.push({
        label: 'Connect Rod From Here',
        action: function() {
          selectTool('add_rod');
          editor.connectStartNode = n.id;
          editor.isConnecting = true;
        }
      });
      // Check if near gear to attach
      var nearGear = editor.findGearNear(n.x, n.y);
      if (nearGear !== -1) {
        items.push({
          label: 'Lock Node on Gear ' + nearGear,
          action: function() { editor.attachNodeToGear(n.id, nearGear); }
        });
      }
      items.push({
        label: 'Delete Node',
        danger: true,
        action: function() { editor.deleteNode(n.id); }
      });
    } else if (targetType === 'gear') {
      var gIdx = targetData.index;
      items.push({
        label: 'Configure Gear...',
        action: function() { openInspector('gear', targetData); }
      });
      items.push({
        label: 'Add Crankpin on Gear Edge',
        action: function() { editor.addCrankpinOnGear(gIdx); }
      });
      items.push({
        label: 'Drive Gear with Motor',
        action: function() {
          var g = targetData.gear;
          editor.addMotor(g.centerNode, g.centerNode, 3.0);
        }
      });
      items.push({
        label: 'Delete Gear',
        danger: true,
        action: function() { editor.deleteGear(gIdx); }
      });
    } else if (targetType === 'rod') {
      var rIdx = targetData.index;
      items.push({
        label: 'Configure Material & Properties...',
        action: function() { openInspector('rod', targetData); }
      });
      items.push({
        label: 'Delete Rod',
        danger: true,
        action: function() {
          editor.saveState();
          editor.rods.splice(rIdx, 1);
          editor._notifyChange();
        }
      });
    } else {
      // Empty space
      var pos = targetData;
      items.push({
        label: 'Add Ground Pin',
        action: function() { editor.addNode(pos.x, pos.y, true); }
      });
      items.push({
        label: 'Add Free Joint',
        action: function() { editor.addNode(pos.x, pos.y, false); }
      });
      items.push({
        label: 'Add Gear Wheel',
        action: function() {
          var cId = editor.addNode(pos.x, pos.y, true);
          editor.addGear(cId, 45, 15);
        }
      });
      items.push({
        label: 'Add Horizontal Slider Rail',
        action: function() {
          var a = editor.addNode(pos.x - 70, pos.y, true);
          var b = editor.addNode(pos.x + 70, pos.y, true);
          var s = editor.addNode(pos.x, pos.y, false);
          editor.addSlider(s, a, b);
        }
      });
      items.push({
        label: 'Clear All Motion Trails',
        action: function() { editor.renderer.clearTraces(); editor.render(physics); }
      });
    }

    // Render context menu list
    for (var i = 0; i < items.length; i++) {
      (function(item) {
        var div = document.createElement('div');
        div.className = 'context-item' + (item.danger ? ' danger' : '');
        div.textContent = item.label;
        div.addEventListener('click', function(e) {
          e.stopPropagation();
          hideContextMenu();
          item.action();
        });
        contextMenuEl.appendChild(div);
      })(items[i]);
    }
  }

  function hideContextMenu() {
    if (contextMenuEl) {
      contextMenuEl.style.display = 'none';
    }
  }

  function openInspector(type, data) {
    var modal = document.getElementById('inspectorModal');
    var titleEl = document.getElementById('inspectorTitle');
    var bodyEl = document.getElementById('inspectorBody');
    var btnSave = document.getElementById('btnInspectorSave');
    var btnCancel = document.getElementById('btnInspectorCancel');
    var btnClose = document.getElementById('btnInspectorClose');
    if (!modal) return;

    bodyEl.innerHTML = '';
    var saveHandler = null;

    if (type === 'node') {
      var n = data;
      titleEl.textContent = 'Configure Node #' + n.id;
      bodyEl.innerHTML = 
        '<div class="form-group"><label><input type="checkbox" id="insFixed" ' + (n.fixed ? 'checked' : '') + '> Ground Pin (Fixed Anchor)</label></div>' +
        '<div class="form-group"><label>Mass (kg)</label><input type="number" id="insMass" value="' + (n.mass || 1.0) + '" step="0.1" min="0.1"></div>';

      saveHandler = function() {
        editor.saveState();
        n.fixed = document.getElementById('insFixed').checked;
        n.mass = parseFloat(document.getElementById('insMass').value) || 1.0;
        editor._notifyChange();
      };
    } else if (type === 'gear') {
      var g = data.gear;
      titleEl.textContent = 'Configure Gear';
      bodyEl.innerHTML = 
        '<div class="form-group"><label>Pitch Radius</label><input type="number" id="insRadius" value="' + g.radius + '" step="5" min="15"></div>' +
        '<div class="form-group"><label>Tooth Count</label><input type="number" id="insTeeth" value="' + g.teeth + '" step="1" min="6"></div>';

      saveHandler = function() {
        editor.saveState();
        g.radius = Math.max(15, parseFloat(document.getElementById('insRadius').value) || 45);
        g.teeth = Math.max(6, parseInt(document.getElementById('insTeeth').value, 10) || 15);
        editor._notifyChange();
      };
    } else if (type === 'rod') {
      var r = data.rod;
      titleEl.textContent = 'Configure Rod / Link';
      bodyEl.innerHTML = 
        '<div class="form-group"><label>Material Preset</label><select id="insMat">' +
        '<option value="steel"' + (r.material === 'steel' ? ' selected' : '') + '>Rigid Steel (Diamond stiff)</option>' +
        '<option value="aluminum"' + (r.material === 'aluminum' ? ' selected' : '') + '>Aluminum</option>' +
        '<option value="carbon"' + (r.material === 'carbon' ? ' selected' : '') + '>Carbon Fiber</option>' +
        '<option value="wood"' + (r.material === 'wood' ? ' selected' : '') + '>Composite Wood</option>' +
        '<option value="rubber"' + (r.material === 'rubber' ? ' selected' : '') + '>Rubber / Elastic Band</option>' +
        '<option value="spring"' + (r.material === 'spring' ? ' selected' : '') + '>Coil Spring</option>' +
        '</select></div>' +
        '<div class="form-group"><label>Length</label><input type="number" id="insLen" value="' + Math.round(r.length) + '" step="1" min="5"></div>' +
        '<div class="form-group"><label>Width</label><input type="number" id="insWidth" value="' + (r.width || 12) + '" step="1" min="4"></div>' +
        '<div class="form-group"><label>Color</label><input type="color" id="insColor" value="' + (r.color || '#3b82f6') + '"></div>';

      saveHandler = function() {
        editor.saveState();
        var matKey = document.getElementById('insMat').value;
        var mat = PhysicsSystem.Materials[matKey] || PhysicsSystem.Materials.steel;
        r.material = matKey;
        r.compliance = mat.compliance;
        r.length = Math.max(5, parseFloat(document.getElementById('insLen').value) || r.length);
        r.width = Math.max(4, parseInt(document.getElementById('insWidth').value, 10) || r.width);
        r.color = document.getElementById('insColor').value || mat.color;
        editor._notifyChange();
      };
    }

    modal.style.display = 'flex';

    var onApply = function() {
      if (saveHandler) saveHandler();
      closeInspector();
    };
    btnSave.onclick = onApply;
    btnCancel.onclick = closeInspector;
    btnClose.onclick = closeInspector;
  }

  function closeInspector() {
    var modal = document.getElementById('inspectorModal');
    if (modal) modal.style.display = 'none';
  }

  function loop(timestamp) {
    var dt = (timestamp - lastFrameTime) / 1000;
    lastFrameTime = timestamp;

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

    // Step physics & timeline if in simulate mode
    if (editor.mode === 'simulate') {
      timeline.update(dt);

      // Record motion trace
      if (physics.numNodes > 0 && timeline.isPlaying) {
        if (editor.trackedNodes.size > 0) {
          editor.trackedNodes.forEach(function(nodeId) {
            if (nodeId < physics.numNodes) {
              renderer.recordTrace(nodeId, physics.x[nodeId], physics.y[nodeId]);
            }
          });
        } else {
          var trackNode = physics.numNodes - 1;
          renderer.recordTrace(trackNode, physics.x[trackNode], physics.y[trackNode]);
        }
      }
    }

    // Render the unified canvas
    editor.render(physics);

    requestAnimationFrame(loop);
  }

  window.addEventListener('DOMContentLoaded', init);
})();
