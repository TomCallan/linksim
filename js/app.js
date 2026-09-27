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

  // Context menu elements
  var contextMenuEl;
  var radialMenuEl;

  function init() {
    canvas = document.getElementById('maincanvas');
    ctx = canvas.getContext('2d');
    contextMenuEl = document.getElementById('contextMenu');
    radialMenuEl = document.getElementById('radialMenu');

    physics = new PhysicsSystem();
    timeline = new Timeline(physics);

    editor = new MechanismEditor(canvas, function(modelJSON) {
      loadModelIntoPhysics(modelJSON);
    });
    renderer = editor.renderer;

    // Wire Direct Physics Interactions
    editor.onHumanInputStart = function(type, id) {
      timeline.onHumanInputStart(type, id);
    };
    editor.onDirectDragNode = function(nodeId, x, y) {
      physics.setMouseDrag(nodeId, x, y);
      timeline.derail('user_drag_node');
    };
    editor.onDirectDragRelease = function() {
      physics.clearMouseDrag();
      timeline.onHumanInputEnd();
      // Persist dragged positions into editor nodes so slider/mechanism doesn't snap back to 0
      for (var i = 0; i < editor.nodes.length; i++) {
        if (i < physics.numNodes && !physics.isFixed[i]) {
          editor.nodes[i].x = Math.round(physics.x[i]);
          editor.nodes[i].y = Math.round(physics.y[i]);
        }
      }
    };
    editor.onManualRotateGear = function(gearIdx, deltaAngle) {
      physics.rotateGearManual(gearIdx, deltaAngle);
      timeline.derail('user_rotate_gear');
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
    var headerH = header ? header.offsetHeight : 48;
    var barH = playbackBar ? playbackBar.offsetHeight : 52;

    var availW = window.innerWidth;
    var availH = Math.max(200, window.innerHeight - headerH - barH);

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
    handleResize();
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
      physics.addRod(rod.a, rod.b, rod.length, {
        width: rod.width,
        color: rod.color,
        angleLock: rod.angleLock,
        lockedAngle: rod.lockedAngle
      });
    }

    // 2.5 Add helical springs
    if (model.springs) {
      for (var sp = 0; sp < model.springs.length; sp++) {
        var spr = model.springs[sp];
        physics.addSpring(spr.a, spr.b, spr.restLength, spr.stiffness, spr);
      }
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
      physics.addSlider(sl.node, sl.aNode, sl.bNode, sl.minT, sl.maxT, sl);
    }

    // 5. Add gears
    for (var g = 0; g < model.gears.length; g++) {
      var gear = model.gears[g];
      var gObj = physics.addGear(gear.centerNode, gear.radius, gear.teeth);
      if (gear.meshWith) {
        gObj.meshWith = gear.meshWith.slice();
      }
    }

    // 5.5 Add Geneva mechanisms
    if (model.genevas) {
      for (var gi = 0; gi < model.genevas.length; gi++) {
        var gen = model.genevas[gi];
        physics.addGeneva(gen.driverCenterNode, gen.driverPinNode, gen.genevaCenterNode, gen.slots, {
          initialAngle: gen.angle || 0,
          slotWidth: gen.slotWidth
        });
      }
    }

    // 5.6 Add Pulleys & Belts
    if (model.pulleys) {
      for (var pi = 0; pi < model.pulleys.length; pi++) {
        var pul = model.pulleys[pi];
        physics.addPulley(pul.nodeId, pul.radius, pul);
      }
    }
    if (model.belts) {
      for (var bi = 0; bi < model.belts.length; bi++) {
        var blt = model.belts[bi];
        physics.addBelt(blt.pulleyA, blt.pulleyB, blt);
      }
    }

    // 5.7 Add Cams & Follower Contacts
    if (model.cams) {
      for (var ci = 0; ci < model.cams.length; ci++) {
        var cam = model.cams[ci];
        physics.addCam(cam.centerNode, cam.profileType, cam.baseRadius, cam.lift, cam.options);
      }
    }
    if (model.camContacts) {
      for (var cci = 0; cci < model.camContacts.length; cci++) {
        var cc = model.camContacts[cci];
        physics.addCamContact(cc.camIdx, cc.followerNode, cc.rollerRadius, cc);
      }
    }

    // 5.8 Add Axles
    if (model.axles) {
      for (var axi = 0; axi < model.axles.length; axi++) {
        var ax = model.axles[axi];
        physics.addAxle(ax.targetA, ax.targetB, ax);
      }
    }

    // 6. Connect parented nodes to gears, Geneva wheels, pulleys, and cams
    for (var i = 0; i < model.nodes.length; i++) {
      var n = model.nodes[i];
      if (n.parentGear) {
        physics.attachNodeToGear(n.id, n.parentGear.gearIdx, n.parentGear.radius, n.parentGear.angleOffset);
      }
      if (n.parentGeneva) {
        physics.attachNodeToGeneva(n.id, n.parentGeneva.genevaIdx, n.parentGeneva.radius, n.parentGeneva.angleOffset);
      }
      if (n.parentPulley) {
        physics.attachNodeToPulley(n.id, n.parentPulley.pulleyIdx, n.parentPulley.radius, n.parentPulley.angleOffset);
      }
      if (n.parentCam) {
        physics.attachNodeToCam(n.id, n.parentCam.camIdx, n.parentCam.radius, n.parentCam.angleOffset);
      }
    }

    // 7. Add motors
    for (var m = 0; m < model.motors.length; m++) {
      var mot = model.motors[m];
      physics.addMotor(mot.centerNode, mot.crankNode, mot.speed, mot);
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
        if (info.isHumanInteracting) {
          loopBadge.style.display = 'inline-block';
          loopBadge.style.background = '#fffbeb';
          loopBadge.style.color = '#b45309';
          loopBadge.style.border = '1px solid #fde68a';
          loopBadge.title = 'User interaction derailed loop cache. Live XPBD physics running.';
          loopBadge.textContent = 'Derailed by User Input (Live Physics)';
        } else if (info.isDerailed && !info.detected) {
          loopBadge.style.display = 'inline-block';
          loopBadge.style.background = '#fef3c7';
          loopBadge.style.color = '#92400e';
          loopBadge.style.border = '1px solid #fcd34d';
          loopBadge.title = 'Mechanism disturbed. Live physics running until new periodic cycle is established.';
          loopBadge.textContent = 'Live Physics (Searching for Loop...)';
        } else if (info.detected && info.caching) {
          loopBadge.style.display = 'inline-block';
          loopBadge.style.background = '#ecfdf5';
          loopBadge.style.color = '#047857';
          loopBadge.style.border = '1px solid #a7f3d0';
          loopBadge.title = 'Periodic loop detected: simulation is running from precomputed frame buffer';
          loopBadge.textContent = 'Loop Cached (' + info.period + 'f / ' + info.duration.toFixed(1) + 's)';
        } else if (info.detected && !info.caching) {
          loopBadge.style.display = 'inline-block';
          loopBadge.style.background = '#eff6ff';
          loopBadge.style.color = '#1d4ed8';
          loopBadge.style.border = '1px solid #bfdbfe';
          loopBadge.title = 'Periodic loop detected, caching disabled';
          loopBadge.textContent = 'Loop Detected (' + info.period + 'f)';
        } else {
          loopBadge.style.display = 'none';
        }
      }
    };

    var hidePinsToggle = document.getElementById('toggleHidePins');
    if (hidePinsToggle) {
      hidePinsToggle.addEventListener('change', function(e) {
        renderer.hidePins = e.target.checked;
        editor.renderer.hidePins = e.target.checked;
        editor.render(physics);
      });
    }

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
      } else if (e.key === 'e' || e.key === 'E') {
        selectTool('add_spring');
      } else if (e.key === 's' || e.key === 'S') {
        selectTool('add_slider');
      } else if (e.key === 'l' || e.key === 'L') {
        selectTool('add_lever');
      } else if (e.key === 'g' || e.key === 'G') {
        selectTool('add_gear');
      } else if (e.key === 'm' || e.key === 'M') {
        selectTool('add_motor');
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (editor.selection) {
          editor.deleteSelection();
        } else if (editor.selectedNodeId !== -1) {
          editor.deleteNode(editor.selectedNodeId);
          editor.selectedNodeId = -1;
        }
      } else if (e.key === 'Escape') {
        hideContextMenu();
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
    if (!radialMenuEl) return;
    radialMenuEl.innerHTML = '';
    radialMenuEl.style.display = 'block';

    // Position radial menu safely inside screen bounds
    var rMax = 140;
    var cx = Math.max(rMax + 10, Math.min(window.innerWidth - rMax - 10, clientX));
    var cy = Math.max(rMax + 10, Math.min(window.innerHeight - rMax - 10, clientY));
    radialMenuEl.style.left = cx + 'px';
    radialMenuEl.style.top = cy + 'px';

    var typeName = (targetType || 'MENU').toUpperCase();
    var subText = 'CLICK';

    var innerItems = [];
    var outerItems = [];

    if (targetType === 'node') {
      var n = targetData.item || targetData;
      subText = '#' + n.id;
      innerItems.push({
        label: 'Props',
        action: function() { openInspector('node', n); }
      });
      innerItems.push({
        label: n.fixed ? 'Free' : 'Anchor',
        action: function() { editor.toggleFixed(n.id); }
      });
      innerItems.push({
        label: 'Beam',
        action: function() {
          selectTool('add_rod');
          editor.connectStartNode = n.id;
          editor.isConnecting = true;
        }
      });
      innerItems.push({
        label: 'Spring',
        action: function() {
          selectTool('add_spring');
          editor.connectStartNode = n.id;
          editor.isConnectingSpring = true;
        }
      });
      innerItems.push({
        label: editor.trackedNodes.has(n.id) ? 'Untrack' : 'Track',
        action: function() { editor.toggleTrackNode(n.id); }
      });
      innerItems.push({
        label: 'Delete',
        danger: true,
        action: function() { editor.deleteNode(n.id); }
      });

      if (n.fixed) {
        outerItems.push({
          label: n.simplified ? 'Stand' : 'Point',
          action: function() {
            editor.saveState();
            n.simplified = !n.simplified;
            editor._notifyChange();
          }
        });
      }
      outerItems.push({
        label: 'Cam',
        action: function() { editor.addCam(n.id, 'pear', 35, 25); }
      });
      outerItems.push({
        label: 'Vector Cam',
        action: function() { openCustomCamModal(n.id); }
      });
      outerItems.push({
        label: 'Pulley',
        action: function() { editor.addPulley(n.id, 35); }
      });
      var nearGear = editor.findGearNear(n.x, n.y);
      if (nearGear !== -1) {
        outerItems.push({
          label: 'Lock Gear',
          action: function() { editor.attachNodeToGear(n.id, nearGear); }
        });
      }
      var slIdx = editor.sliders.findIndex(function(s) { return s.node === n.id; });
      if (slIdx !== -1) {
        outerItems.push({
          label: 'Slider Rail',
          action: function() { openInspector('slider', { index: slIdx, slider: editor.sliders[slIdx] }); }
        });
      }
      var motIdx = editor.motors.findIndex(function(m) { return m.centerNode === n.id || m.crankNode === n.id; });
      if (motIdx !== -1) {
        outerItems.push({
          label: 'Motor',
          action: function() { openInspector('motor', { index: motIdx, motor: editor.motors[motIdx] }); }
        });
      }
    } else if (targetType === 'rod') {
      var rIdx = targetData.index;
      var r = targetData.rod || targetData.item || editor.rods[rIdx];
      typeName = 'BEAM';
      subText = '#' + rIdx;
      innerItems.push({
        label: 'Props',
        action: function() { openInspector('rod', targetData); }
      });
      innerItems.push({
        label: 'Lock Horiz',
        action: function() {
          editor.saveState();
          r.angleLock = 'horizontal';
          editor._notifyChange();
        }
      });
      innerItems.push({
        label: 'Lock Vert',
        action: function() {
          editor.saveState();
          r.angleLock = 'vertical';
          editor._notifyChange();
        }
      });
      innerItems.push({
        label: 'Lock Angle',
        action: function() {
          editor.saveState();
          r.angleLock = 'fixed';
          var na = editor.getNodeById(r.a);
          var nb = editor.getNodeById(r.b);
          if (na && nb) {
            r.lockedAngle = Math.atan2(nb.y - na.y, nb.x - na.x);
          }
          editor._notifyChange();
        }
      });
      innerItems.push({
        label: 'Unlock',
        action: function() {
          editor.saveState();
          r.angleLock = 'none';
          editor._notifyChange();
        }
      });
      innerItems.push({
        label: 'Delete',
        danger: true,
        action: function() {
          editor.saveState();
          editor.rods.splice(rIdx, 1);
          editor.selection = null;
          editor._notifyChange();
        }
      });
    } else if (targetType === 'slider') {
      var slIdx = targetData.index;
      var sl = targetData.slider || targetData.item || editor.sliders[slIdx];
      subText = '#' + slIdx;
      innerItems.push({
        label: 'Props',
        action: function() { openInspector('slider', targetData); }
      });
      innerItems.push({
        label: 'Free Travel',
        action: function() {
          editor.saveState();
          sl.minT = undefined;
          sl.maxT = undefined;
          editor._notifyChange();
        }
      });
      innerItems.push({
        label: (sl.friction && sl.friction > 0) ? 'No Friction' : 'Add Friction',
        action: function() {
          editor.saveState();
          sl.friction = (sl.friction && sl.friction > 0) ? 0 : 0.1;
          editor._notifyChange();
        }
      });
      innerItems.push({
        label: 'Delete',
        danger: true,
        action: function() { editor.deleteSlider(slIdx); }
      });
    } else if (targetType === 'gear') {
      var gIdx = targetData.index;
      var g = targetData.gear || targetData.item || editor.gears[gIdx];
      subText = '#' + gIdx;
      innerItems.push({
        label: 'Props',
        action: function() { openInspector('gear', targetData); }
      });
      innerItems.push({
        label: 'Crankpin',
        action: function() { editor.addCrankpinOnGear(gIdx); }
      });
      innerItems.push({
        label: 'Drive Motor',
        action: function() { editor.addMotor(g.centerNode, g.centerNode, 3.0); }
      });
      innerItems.push({
        label: 'Mount Cam',
        action: function() { editor.addCam(g.centerNode, 'pear', 35, 25); }
      });
      innerItems.push({
        label: 'Delete',
        danger: true,
        action: function() { editor.deleteGear(gIdx); }
      });
    } else if (targetType === 'spring') {
      var spIdx = targetData.index;
      var spr = targetData.spring || targetData.item || editor.springs[spIdx];
      subText = '#' + spIdx;
      innerItems.push({
        label: 'Props',
        action: function() { openInspector('spring', targetData); }
      });
      innerItems.push({
        label: 'Stiffer',
        action: function() {
          editor.saveState();
          spr.stiffness = Math.round((spr.stiffness || 200) * 1.5);
          editor._notifyChange();
        }
      });
      innerItems.push({
        label: 'Softer',
        action: function() {
          editor.saveState();
          spr.stiffness = Math.round((spr.stiffness || 200) * 0.7);
          editor._notifyChange();
        }
      });
      innerItems.push({
        label: 'Delete',
        danger: true,
        action: function() { editor.deleteSpring(spIdx); }
      });
    } else if (targetType === 'pulley') {
      var pIdx = targetData.index;
      var pItem = targetData.pulley || targetData.item || editor.pulleys[pIdx];
      subText = '#' + pIdx;
      innerItems.push({
        label: 'Props',
        action: function() { openInspector('pulley', targetData); }
      });
      innerItems.push({
        label: 'Drive Motor',
        action: function() { editor.addMotor(pItem.nodeId, pItem.nodeId, 3.0); }
      });
      innerItems.push({
        label: 'Delete',
        danger: true,
        action: function() { editor.deletePulley(pIdx); }
      });
    } else if (targetType === 'cam') {
      var cIdx = targetData.index;
      var cItem = targetData.cam || targetData.item || editor.cams[cIdx];
      subText = '#' + cIdx;
      innerItems.push({
        label: 'Props',
        action: function() { openInspector('cam', targetData); }
      });
      innerItems.push({
        label: 'Vector Cam',
        action: function() { openCustomCamModal(cItem.centerNode, cIdx); }
      });
      innerItems.push({
        label: 'Drive Motor',
        action: function() { editor.addMotor(cItem.centerNode, cItem.centerNode, 3.0); }
      });
      innerItems.push({
        label: 'Delete',
        danger: true,
        action: function() { editor.deleteCam(cIdx); }
      });
    } else if (targetType === 'belt') {
      var bIdx = targetData.index;
      var bItem = targetData.belt || targetData.item || editor.belts[bIdx];
      subText = '#' + bIdx;
      innerItems.push({
        label: bItem && bItem.crossed ? 'Uncross' : 'Cross Belt',
        action: function() {
          editor.saveState();
          if (bItem) bItem.crossed = !bItem.crossed;
          editor._notifyChange();
        }
      });
      innerItems.push({
        label: 'Delete',
        danger: true,
        action: function() { editor.deleteBelt(bIdx); }
      });
    } else if (targetType === 'geneva') {
      var genIdx = targetData.index;
      subText = '#' + genIdx;
      innerItems.push({
        label: 'Props',
        action: function() { openInspector('geneva', targetData); }
      });
      innerItems.push({
        label: 'Delete',
        danger: true,
        action: function() {
          editor.saveState();
          editor.genevas.splice(genIdx, 1);
          editor._notifyChange();
        }
      });
    } else {
      // Empty canvas
      var pos = targetData;
      typeName = 'ADD';
      subText = 'TOOL';
      innerItems.push({
        label: 'Joint',
        action: function() { editor.addNode(pos.x, pos.y, false); }
      });
      innerItems.push({
        label: 'Pin',
        action: function() { editor.addNode(pos.x, pos.y, true); }
      });
      innerItems.push({
        label: 'Beam',
        action: function() {
          var a = editor.addNode(pos.x - 40, pos.y, false);
          var b = editor.addNode(pos.x + 40, pos.y, false);
          editor.addRod(a, b);
        }
      });
      innerItems.push({
        label: 'Spring',
        action: function() {
          var a = editor.addNode(pos.x - 35, pos.y, false);
          var b = editor.addNode(pos.x + 35, pos.y, false);
          editor.addSpring(a, b);
        }
      });
      innerItems.push({
        label: 'Slider',
        action: function() {
          var a = editor.addNode(pos.x - 70, pos.y, true);
          var b = editor.addNode(pos.x + 70, pos.y, true);
          var s = editor.addNode(pos.x, pos.y, false);
          editor.addSlider(s, a, b);
        }
      });
      innerItems.push({
        label: 'Lever',
        action: function() { editor.addLever(pos.x, pos.y); }
      });
      innerItems.push({
        label: 'Gear',
        action: function() {
          var cId = editor.addNode(pos.x, pos.y, true);
          editor.addGear(cId, 45, 15);
        }
      });
      innerItems.push({
        label: 'Cam',
        action: function() {
          var cId = editor.addNode(pos.x, pos.y, true);
          editor.addCam(cId, 'pear', 35, 25);
        }
      });
    }

    // Render center hub
    var hub = document.createElement('div');
    hub.className = 'radial-center';
    var hubType = document.createElement('div');
    hubType.className = 'radial-type';
    hubType.textContent = typeName;
    var hubSub = document.createElement('div');
    hubSub.className = 'radial-sub';
    hubSub.textContent = subText;
    hub.appendChild(hubType);
    hub.appendChild(hubSub);
    hub.addEventListener('click', function(e) {
      e.stopPropagation();
      hideContextMenu();
    });
    radialMenuEl.appendChild(hub);

    function renderRing(itemsList, radius) {
      var count = itemsList.length;
      if (count === 0) return;
      var angleStep = (2 * Math.PI) / count;
      var startAngle = -Math.PI / 2;
      for (var i = 0; i < count; i++) {
        (function(it, idx) {
          var angle = startAngle + idx * angleStep;
          var btn = document.createElement('div');
          btn.className = 'radial-item' + (it.danger ? ' danger' : '') + (it.active ? ' active-opt' : '');
          btn.textContent = it.label;
          var px = Math.round(Math.cos(angle) * radius);
          var py = Math.round(Math.sin(angle) * radius);
          btn.style.left = px + 'px';
          btn.style.top = py + 'px';
          btn.addEventListener('click', function(e) {
            e.stopPropagation();
            hideContextMenu();
            it.action();
          });
          radialMenuEl.appendChild(btn);
        })(itemsList[i], i);
      }
    }

    renderRing(innerItems, innerItems.length > 6 ? 85 : 74);
    if (outerItems.length > 0) {
      renderRing(outerItems, 134);
    }
  }

  function hideContextMenu() {
    if (contextMenuEl) contextMenuEl.style.display = 'none';
    if (radialMenuEl) radialMenuEl.style.display = 'none';
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
      var n = data.item || data;
      titleEl.textContent = 'Configure Node #' + n.id;
      bodyEl.innerHTML = 
        '<div class="form-group"><label><input type="checkbox" id="insFixed" ' + (n.fixed ? 'checked' : '') + '> Ground Pin (Fixed Anchor)</label></div>' +
        '<div class="form-group"><label><input type="checkbox" id="insSimplified" ' + (n.simplified ? 'checked' : '') + '> Simplify Pin to Point (Hide Stand)</label></div>' +
        '<div class="form-group"><label>Mass (kg)</label><input type="number" id="insMass" value="' + (n.mass || 1.0) + '" step="0.1" min="0.1"></div>';

      saveHandler = function() {
        editor.saveState();
        n.fixed = document.getElementById('insFixed').checked;
        n.simplified = document.getElementById('insSimplified').checked;
        n.mass = parseFloat(document.getElementById('insMass').value) || 1.0;
        editor._notifyChange();
      };
    } else if (type === 'gear') {
      var g = data.gear || data.item || editor.gears[data.index];
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
      var r = data.rod || data.item || editor.rods[data.index];
      titleEl.textContent = 'Configure Beam / Link';
      bodyEl.innerHTML = 
        '<div class="form-group"><label>Material Preset</label><select id="insMat">' +
        '<option value="steel"' + (r.material === 'steel' ? ' selected' : '') + '>Rigid Steel (Diamond stiff)</option>' +
        '<option value="aluminum"' + (r.material === 'aluminum' ? ' selected' : '') + '>Aluminum</option>' +
        '<option value="carbon"' + (r.material === 'carbon' ? ' selected' : '') + '>Carbon Fiber</option>' +
        '<option value="wood"' + (r.material === 'wood' ? ' selected' : '') + '>Composite Wood</option>' +
        '<option value="rubber"' + (r.material === 'rubber' ? ' selected' : '') + '>Rubber / Elastic Band</option>' +
        '</select></div>' +
        '<div class="form-group"><label>Orientation Lock</label><select id="insAngleLock">' +
        '<option value="none"' + ((!r.angleLock || r.angleLock === 'none') ? ' selected' : '') + '>Free Rotation</option>' +
        '<option value="horizontal"' + (r.angleLock === 'horizontal' ? ' selected' : '') + '>Lock Horizontal (0 deg)</option>' +
        '<option value="vertical"' + (r.angleLock === 'vertical' ? ' selected' : '') + '>Lock Vertical (90 deg)</option>' +
        '<option value="fixed"' + (r.angleLock === 'fixed' ? ' selected' : '') + '>Fixed Angle</option>' +
        '</select></div>' +
        '<div class="form-group" id="insAngleDegWrap" style="display:' + (r.angleLock === 'fixed' ? 'flex' : 'none') + ';"><label>Locked Angle (degrees)</label><input type="number" id="insAngleDeg" value="' + Math.round((r.lockedAngle || 0) * 180 / Math.PI) + '" step="5"></div>' +
        '<div class="form-group"><label>Length</label><input type="number" id="insLen" value="' + Math.round(r.length) + '" step="1" min="5"></div>' +
        '<div class="form-group"><label>Width</label><input type="number" id="insWidth" value="' + (r.width || 12) + '" step="1" min="4"></div>' +
        '<div class="form-group"><label>Color</label><input type="color" id="insColor" value="' + (r.color || '#3b82f6') + '"></div>';

      var lockSelect = document.getElementById('insAngleLock');
      var degWrap = document.getElementById('insAngleDegWrap');
      if (lockSelect && degWrap) {
        lockSelect.addEventListener('change', function() {
          degWrap.style.display = lockSelect.value === 'fixed' ? 'flex' : 'none';
        });
      }

      saveHandler = function() {
        editor.saveState();
        var matKey = document.getElementById('insMat').value;
        var mat = PhysicsSystem.Materials[matKey] || PhysicsSystem.Materials.steel;
        r.material = matKey;
        r.compliance = mat.compliance;
        r.length = Math.max(5, parseFloat(document.getElementById('insLen').value) || r.length);
        r.width = Math.max(4, parseInt(document.getElementById('insWidth').value, 10) || r.width);
        r.color = document.getElementById('insColor').value || mat.color;
        var lockVal = document.getElementById('insAngleLock').value;
        r.angleLock = lockVal;
        if (lockVal === 'fixed') {
          var deg = parseFloat(document.getElementById('insAngleDeg').value) || 0;
          r.lockedAngle = deg * Math.PI / 180;
        }
        editor._notifyChange();
      };
    } else if (type === 'spring') {
      var spr = data.spring || data.item || editor.springs[data.index];
      titleEl.textContent = 'Configure Helical Spring';
      bodyEl.innerHTML = 
        '<div class="form-group"><label>Rest Length</label><input type="number" id="insRestLen" value="' + Math.round(spr.restLength) + '" step="1" min="5"></div>' +
        '<div class="form-group"><label>Stiffness (N/m)</label><input type="number" id="insStiff" value="' + spr.stiffness + '" step="20" min="5"></div>' +
        '<div class="form-group"><label>Damping</label><input type="number" id="insDamp" value="' + (spr.damping || 2.0) + '" step="0.5" min="0"></div>' +
        '<div class="form-group"><label>Coil Width</label><input type="number" id="insWidth" value="' + (spr.width || 14) + '" step="1" min="6"></div>' +
        '<div class="form-group"><label>Color</label><input type="color" id="insColor" value="' + (spr.color || '#10b981') + '"></div>';

      saveHandler = function() {
        editor.saveState();
        spr.restLength = Math.max(5, parseFloat(document.getElementById('insRestLen').value) || spr.restLength);
        spr.stiffness = Math.max(1, parseFloat(document.getElementById('insStiff').value) || 200);
        spr.damping = Math.max(0, parseFloat(document.getElementById('insDamp').value) || 0);
        spr.width = Math.max(6, parseInt(document.getElementById('insWidth').value, 10) || 14);
        spr.color = document.getElementById('insColor').value || '#10b981';
        editor._notifyChange();
      };
    } else if (type === 'pulley') {
      var pul = data.pulley || data.item || editor.pulleys[data.index];
      titleEl.textContent = 'Configure Pulley';
      bodyEl.innerHTML = 
        '<div class="form-group"><label>Radius</label><input type="number" id="insRadius" value="' + pul.radius + '" step="2" min="10"></div>' +
        '<div class="form-group"><label>Width</label><input type="number" id="insWidth" value="' + (pul.width || 8) + '" step="1" min="4"></div>';

      saveHandler = function() {
        editor.saveState();
        pul.radius = Math.max(10, parseFloat(document.getElementById('insRadius').value) || 30);
        pul.width = Math.max(4, parseInt(document.getElementById('insWidth').value, 10) || 8);
        editor._notifyChange();
      };
    } else if (type === 'cam') {
      var cam = data.cam || data.item || editor.cams[data.index];
      titleEl.textContent = 'Configure Cam Profile';
      bodyEl.innerHTML = 
        '<div class="form-group"><label>Profile Type</label><select id="insProfile">' +
        '<option value="pear"' + (cam.profileType === 'pear' ? ' selected' : '') + '>Pear Cam (Harmonic Lobe)</option>' +
        '<option value="eccentric"' + (cam.profileType === 'eccentric' ? ' selected' : '') + '>Eccentric Circular Cam</option>' +
        '<option value="snail"' + (cam.profileType === 'snail' ? ' selected' : '') + '>Snail Drop Cam</option>' +
        '<option value="heart"' + (cam.profileType === 'heart' ? ' selected' : '') + '>Heart / Cardioid Cam</option>' +
        '<option value="custom"' + (cam.profileType === 'custom' ? ' selected' : '') + '>Custom Vector Geometry</option>' +
        '</select></div>' +
        '<div class="form-group"><label>Base Radius</label><input type="number" id="insBaseR" value="' + cam.baseRadius + '" step="2" min="10"></div>' +
        '<div class="form-group"><label>Lift / Stroke</label><input type="number" id="insLift" value="' + (cam.lift || 20) + '" step="2" min="0"></div>';

      saveHandler = function() {
        editor.saveState();
        cam.profileType = document.getElementById('insProfile').value;
        cam.baseRadius = Math.max(10, parseFloat(document.getElementById('insBaseR').value) || 35);
        cam.lift = Math.max(0, parseFloat(document.getElementById('insLift').value) || 0);
        editor._notifyChange();
      };
    } else if (type === 'slider') {
      var sl = data.slider || data.item || editor.sliders[data.index];
      titleEl.textContent = 'Configure Linear Slider Rail';
      var hasMin = (sl.minT !== undefined && sl.minT !== null && isFinite(sl.minT));
      var hasMax = (sl.maxT !== undefined && sl.maxT !== null && isFinite(sl.maxT));
      bodyEl.innerHTML = 
        '<div class="form-group"><label><input type="checkbox" id="insEnableStroke" ' + (hasMin || hasMax ? 'checked' : '') + '> Enforce End-Stop Travel Limits</label></div>' +
        '<div class="form-group"><label>Min Travel Limit</label><input type="number" id="insMinT" value="' + (hasMin ? sl.minT : -100) + '" step="5"></div>' +
        '<div class="form-group"><label>Max Travel Limit</label><input type="number" id="insMaxT" value="' + (hasMax ? sl.maxT : 100) + '" step="5"></div>' +
        '<div class="form-group"><label>Friction Coefficient</label><input type="number" id="insFric" value="' + (sl.friction || 0) + '" step="0.05" min="0"></div>';

      saveHandler = function() {
        editor.saveState();
        var enableStroke = document.getElementById('insEnableStroke').checked;
        if (enableStroke) {
          sl.minT = parseFloat(document.getElementById('insMinT').value) || -100;
          sl.maxT = parseFloat(document.getElementById('insMaxT').value) || 100;
        } else {
          sl.minT = undefined;
          sl.maxT = undefined;
        }
        sl.friction = Math.max(0, parseFloat(document.getElementById('insFric').value) || 0);
        editor._notifyChange();
      };
    } else if (type === 'motor') {
      var mot = data.motor || data.item || editor.motors[data.index];
      titleEl.textContent = 'Configure Motor';
      var isUnlimited = (mot.maxTorque === undefined || mot.maxTorque === null || mot.maxTorque === Infinity);
      var rpm = Math.round((mot.speed || 2.5) * 60 / (2 * Math.PI));
      bodyEl.innerHTML = 
        '<div class="form-group"><label>Speed (rad/s)</label><input type="number" id="insSpeed" value="' + (mot.speed || 2.5) + '" step="0.5"></div>' +
        '<div class="form-group"><label>Speed (RPM)</label><input type="number" id="insRPM" value="' + rpm + '" step="5"></div>' +
        '<div class="form-group"><label><input type="checkbox" id="insUnlimitedTorque" ' + (isUnlimited ? 'checked' : '') + '> Unlimited Torque (Rigid Kinematic)</label></div>' +
        '<div class="form-group"><label>Max Stall Torque (N*m / torque units)</label><input type="number" id="insMaxTorque" value="' + (isUnlimited ? 5000 : mot.maxTorque) + '" step="500" min="10"></div>';

      var speedInput = document.getElementById('insSpeed');
      var rpmInput = document.getElementById('insRPM');
      speedInput.addEventListener('input', function() {
        var spd = parseFloat(speedInput.value) || 0;
        rpmInput.value = Math.round(spd * 60 / (2 * Math.PI));
      });
      rpmInput.addEventListener('input', function() {
        var rVal = parseFloat(rpmInput.value) || 0;
        speedInput.value = (rVal * 2 * Math.PI / 60).toFixed(2);
      });

      saveHandler = function() {
        editor.saveState();
        var unlimited = document.getElementById('insUnlimitedTorque').checked;
        mot.speed = parseFloat(document.getElementById('insSpeed').value) || 2.5;
        mot.maxTorque = unlimited ? Infinity : (parseFloat(document.getElementById('insMaxTorque').value) || 5000);
        editor._notifyChange();
      };
    } else if (type === 'geneva') {
      var gen = data.geneva || data.item || editor.genevas[data.index];
      titleEl.textContent = 'Configure Geneva Indexer';
      bodyEl.innerHTML = 
        '<div class="form-group"><label>Number of Slots</label><input type="number" id="insSlots" value="' + (gen.slots || 4) + '" step="1" min="3" max="12"></div>' +
        '<div class="form-group"><label>Slot Width</label><input type="number" id="insSlotW" value="' + (gen.slotWidth || 10) + '" step="1" min="4"></div>';

      saveHandler = function() {
        editor.saveState();
        gen.slots = Math.max(3, parseInt(document.getElementById('insSlots').value, 10) || 4);
        gen.slotWidth = Math.max(4, parseInt(document.getElementById('insSlotW').value, 10) || 10);
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

  function openCustomCamModal(nodeId, camIdx) {
    var modal = document.getElementById('camDesignerModal');
    var selectPreset = document.getElementById('camPresetSelect');
    var inputBaseR = document.getElementById('camBaseRadius');
    var inputLift = document.getElementById('camLift');
    var textPoints = document.getElementById('camPointsText');
    var previewCanvas = document.getElementById('camPreviewCanvas');
    var btnClose = document.getElementById('btnCamDesignerClose');
    var btnCancel = document.getElementById('btnCamDesignerCancel');
    var btnSave = document.getElementById('btnCamDesignerSave');
    if (!modal || !previewCanvas) return;

    var previewCtx = previewCanvas.getContext('2d');
    var currentCam = (camIdx !== undefined && camIdx !== null && editor.cams[camIdx]) ? editor.cams[camIdx] : null;

    if (currentCam) {
      inputBaseR.value = currentCam.baseRadius || 35;
      inputLift.value = currentCam.lift !== undefined ? currentCam.lift : 25;
      if (currentCam.options && currentCam.options.points) {
        textPoints.value = JSON.stringify(currentCam.options.points);
        selectPreset.value = 'freeform';
      } else {
        selectPreset.value = currentCam.profileType || 'pear';
      }
    } else {
      inputBaseR.value = 35;
      inputLift.value = 25;
      selectPreset.value = 'trochoid';
    }

    function generatePointsForPreset(preset, rBase, lift) {
      rBase = parseFloat(rBase) || 35;
      lift = parseFloat(lift) || 25;
      var pts = [];
      if (preset === 'geneva') {
        pts = Math2D.getGenevaPoints(4, rBase + lift * 0.4, (rBase + lift * 0.4) * Math.SQRT2, 11);
      } else if (preset === 'pear') {
        pts = Math2D.getCamPoints('pear', rBase, lift, 72, { lobeAngle: 65 });
      } else if (preset === 'heart') {
        pts = Math2D.getCamPoints('heart', rBase, lift, 72);
      } else if (preset === 'snail') {
        pts = Math2D.getCamPoints('snail', rBase, lift, 72);
      } else if (preset === 'trochoid') {
        // 3-Lobe Trochoidal Rotor Profile
        for (var i = 0; i < 72; i++) {
          var a = (i / 72) * Math.PI * 2;
          var r = rBase + lift * 0.5 * (1 + Math.cos(3 * a));
          pts.push([Math.round(r * Math.cos(a) * 10) / 10, Math.round(r * Math.sin(a) * 10) / 10]);
        }
      } else if (preset === 'clover') {
        // 4-Leaf Clover
        for (var i = 0; i < 72; i++) {
          var a = (i / 72) * Math.PI * 2;
          var r = rBase + lift * 0.5 * (1 + Math.cos(4 * a));
          pts.push([Math.round(r * Math.cos(a) * 10) / 10, Math.round(r * Math.sin(a) * 10) / 10]);
        }
      } else if (preset === 'hexagon') {
        for (var i = 0; i < 6; i++) {
          var a = (i / 6) * Math.PI * 2;
          var r = rBase + lift;
          pts.push([Math.round(r * Math.cos(a)), Math.round(r * Math.sin(a))]);
        }
      } else if (preset === 'star') {
        for (var i = 0; i < 10; i++) {
          var a = (i / 10) * Math.PI * 2;
          var r = (i % 2 === 0) ? (rBase + lift) : rBase;
          pts.push([Math.round(r * Math.cos(a)), Math.round(r * Math.sin(a))]);
        }
      } else {
        try {
          pts = JSON.parse(textPoints.value);
        } catch(e) {
          pts = Math2D.getCamPoints('pear', rBase, lift, 36);
        }
      }
      return pts;
    }

    function updatePreview() {
      var pts = [];
      var preset = selectPreset.value;
      if (preset === 'freeform') {
        try {
          pts = JSON.parse(textPoints.value);
        } catch(e) {
          pts = [];
        }
      } else {
        pts = generatePointsForPreset(preset, inputBaseR.value, inputLift.value);
        textPoints.value = JSON.stringify(pts);
      }

      previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
      var cx = previewCanvas.width / 2;
      var cy = previewCanvas.height / 2;

      // Draw grid
      previewCtx.strokeStyle = '#f1f5f9';
      previewCtx.lineWidth = 1;
      previewCtx.beginPath();
      previewCtx.moveTo(cx, 0); previewCtx.lineTo(cx, previewCanvas.height);
      previewCtx.moveTo(0, cy); previewCtx.lineTo(previewCanvas.width, cy);
      previewCtx.stroke();

      if (pts && pts.length >= 3) {
        previewCtx.save();
        previewCtx.translate(cx, cy);

        // Draw cam contour
        previewCtx.beginPath();
        previewCtx.moveTo(pts[0][0], pts[0][1]);
        for (var i = 1; i < pts.length; i++) {
          previewCtx.lineTo(pts[i][0], pts[i][1]);
        }
        previewCtx.closePath();
        previewCtx.fillStyle = '#cbd5e1';
        previewCtx.fill();
        previewCtx.lineWidth = 2;
        previewCtx.strokeStyle = '#334155';
        previewCtx.stroke();

        // Hub & bore
        previewCtx.beginPath();
        previewCtx.arc(0, 0, 10, 0, Math.PI * 2);
        previewCtx.fillStyle = '#64748b';
        previewCtx.fill();
        previewCtx.stroke();

        previewCtx.beginPath();
        previewCtx.arc(0, 0, 4, 0, Math.PI * 2);
        previewCtx.fillStyle = '#0f172a';
        previewCtx.fill();

        previewCtx.restore();
      }
    }

    selectPreset.onchange = updatePreview;
    inputBaseR.oninput = updatePreview;
    inputLift.oninput = updatePreview;
    textPoints.oninput = function() {
      selectPreset.value = 'freeform';
      updatePreview();
    };

    updatePreview();
    modal.style.display = 'flex';

    function closeCamModal() {
      modal.style.display = 'none';
    }

    btnClose.onclick = closeCamModal;
    btnCancel.onclick = closeCamModal;

    btnSave.onclick = function() {
      var pts = [];
      try {
        pts = JSON.parse(textPoints.value);
      } catch(e) {
        pts = generatePointsForPreset(selectPreset.value, inputBaseR.value, inputLift.value);
      }
      var bRadius = parseFloat(inputBaseR.value) || 35;
      var cLift = parseFloat(inputLift.value) || 25;

      editor.saveState();
      if (currentCam) {
        currentCam.profileType = 'custom';
        currentCam.baseRadius = bRadius;
        currentCam.lift = cLift;
        currentCam.options = { points: pts };
      } else {
        var targetNode = nodeId;
        if (targetNode === null || targetNode === undefined) {
          targetNode = editor.addNode(0, 0, true);
        }
        editor.addCam(targetNode, 'custom', bRadius, cLift, { points: pts });
      }
      editor._notifyChange();
      closeCamModal();
    };
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
