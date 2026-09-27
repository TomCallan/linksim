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
  var hoverTip;

  function init() {
    canvas = document.getElementById('maincanvas');
    ctx = canvas.getContext('2d');
    contextMenuEl = document.getElementById('contextMenu');
    radialMenuEl = document.getElementById('radialMenu');
    hoverTip = document.getElementById('hoverTip');

    physics = new PhysicsSystem();
    timeline = new Timeline(physics);

    editor = new MechanismEditor(canvas, function(modelJSON) {
      loadModelIntoPhysics(modelJSON);
    });
    renderer = editor.renderer;
    renderer.hidePins = true;
    editor.renderer.hidePins = true;

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

    // Automatic reactive observation for header and playback-bar height changes
    if (typeof ResizeObserver !== 'undefined') {
      var ro = new ResizeObserver(function() {
        handleResize();
      });
      var headerEl = document.querySelector('header');
      var barEl = document.querySelector('.playback-bar');
      if (headerEl) ro.observe(headerEl);
      if (barEl) ro.observe(barEl);
    }

    // Bind UI & Playback Controls
    bindHeaderControls();
    bindPlaybackControls();
    bindKeyboardShortcuts();

    // Load initial preset (Interaction Sandbox)
    loadPreset('sandbox');

    // Default to Simulate mode running
    setMode('simulate');

    // Prevent native browser context menu on the canvas
    var mainCanvas = document.getElementById('maincanvas');
    if (mainCanvas) {
      mainCanvas.addEventListener('contextmenu', function(e) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      });
    }

    // Also suppress the native menu over radial menu / context menu / workspace
    document.addEventListener('contextmenu', function(e) {
      var t = e.target;
      if (t && t.closest && (t.closest('#radialMenu') || t.closest('#contextMenu') || t.closest('.workspace'))) {
        e.preventDefault();
      }
    });

    // Hover tooltip: name the element under the cursor before you click
    if (mainCanvas) {
      mainCanvas.addEventListener('mousemove', updateHoverTip);
      mainCanvas.addEventListener('mouseleave', function() {
        if (hoverTip) hoverTip.style.display = 'none';
      });
    }

    // Start requestAnimationFrame loop
    requestAnimationFrame(loop);
  }

  function describeElement(elem) {
    if (!elem) return '';
    var item = elem.item;
    if (elem.type === 'node') {
      return 'Node #' + item.id + (item.fixed ? '  (ground pin)' : '  (joint)  m=' + (item.mass || 1));
    }
    if (elem.type === 'rod') {
      return 'Beam #' + elem.index + '  ' + Math.round(item.length) + ' mm';
    }
    if (elem.type === 'spring') {
      return 'Spring #' + elem.index + '  k=' + Math.round(item.stiffness);
    }
    if (elem.type === 'slider') {
      return 'Slider #' + elem.index + ((item.minT !== undefined && item.maxT !== undefined) ? '  end-stopped' : '  free travel');
    }
    if (elem.type === 'gear') {
      return 'Gear #' + elem.index + '  ' + item.teeth + 'T  r=' + Math.round(item.radius);
    }
    if (elem.type === 'motor') {
      var unlimited = (item.maxTorque === undefined || item.maxTorque === null || !isFinite(item.maxTorque));
      return 'Motor #' + elem.index + '  ' + (item.speed || 0) + ' rad/s  ' + (unlimited ? '(unlimited torque)' : '(max ' + Math.round(item.maxTorque) + ')');
    }
    if (elem.type === 'pulley') {
      return 'Pulley #' + elem.index + '  r=' + Math.round(item.radius);
    }
    if (elem.type === 'cam') {
      return 'Cam #' + elem.index + '  ' + item.profileType;
    }
    if (elem.type === 'belt') {
      return 'Belt #' + elem.index + (item.crossed ? '  (crossed)' : '  (open)');
    }
    if (elem.type === 'geneva') {
      return 'Geneva #' + elem.index + '  ' + item.slots + ' slots';
    }
    return elem.type + ' #' + elem.index;
  }

  function updateHoverTip(e) {
    if (!hoverTip) return;
    if (editor.isPanning || editor.isDragging || editor.isConnecting || editor.isConnectingSpring || editor._isDraggingSliderAssembly) {
      hoverTip.style.display = 'none';
      return;
    }
    var w = editor.screenToWorld(e.clientX, e.clientY);
    var elem = editor.findElementNear(w.x, w.y);
    var text = elem ? describeElement(elem) : '';
    if (!text) {
      var li = editor.findLabelNear(w.x, w.y);
      if (li !== -1) text = 'Label: ' + editor.labels[li].text;
    }
    if (text) {
      hoverTip.textContent = text;
      hoverTip.style.display = 'block';
      hoverTip.style.left = Math.max(4, Math.min(window.innerWidth - 12, e.clientX + 14)) + 'px';
      hoverTip.style.top = Math.max(4, Math.min(window.innerHeight - 12, e.clientY + 16)) + 'px';
    } else {
      hoverTip.style.display = 'none';
    }
  }

  function handleResize() {
    var header = document.querySelector('header');
    var playbackBar = document.querySelector('.playback-bar');
    var headerH = header ? header.offsetHeight : 48;
    var barH = playbackBar ? playbackBar.offsetHeight : 52;

    var availW = window.innerWidth;
    var availH = Math.max(200, window.innerHeight - headerH - barH);

    var prevW = canvas.width || availW;
    var prevH = canvas.height || availH;

    canvas.width = availW;
    canvas.height = availH;

    if (editor) {
      if (!editor.hasInitialPan) {
        editor.panX = availW / 2;
        editor.panY = availH / 2;
        editor.hasInitialPan = true;
      } else {
        editor.panX += (availW - prevW) / 2;
        editor.panY += (availH - prevH) / 2;
      }
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
          initialAngle: gen.angle !== undefined ? gen.angle : 0,
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
      fitViewToModel();
    }
  }

  function fitViewToModel() {
    if (!editor || !editor.nodes || editor.nodes.length === 0) return;
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < editor.nodes.length; i++) {
      var n = editor.nodes[i];
      if (n.x < minX) minX = n.x;
      if (n.x > maxX) maxX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.y > maxY) maxY = n.y;
    }
    if (editor.labels) {
      for (var l = 0; l < editor.labels.length; l++) {
        var lb = editor.labels[l];
        var fs = lb.fontSize || 12;
        var lw = (lb.text ? lb.text.length : 0) * fs * 0.55;
        if (lb.x < minX) minX = lb.x;
        if (lb.y < minY) minY = lb.y;
        if (lb.x + lw > maxX) maxX = lb.x + lw;
        if (lb.y + fs * 1.5 > maxY) maxY = lb.y + fs * 1.5;
      }
    }
    var margin = 40;
    var w = (maxX - minX) + margin * 2;
    var h = (maxY - minY) + margin * 2;
    if (w <= 0 || h <= 0) return;
    var zoom = Math.min(canvas.width / w, canvas.height / h);
    zoom = Math.max(0.2, Math.min(1.0, zoom));
    editor.zoom = zoom;
    editor.panX = canvas.width / 2 - ((minX + maxX) / 2) * zoom;
    editor.panY = canvas.height / 2 - ((minY + maxY) / 2) * zoom;
    editor.hasInitialPan = true;
    editor.render(physics);
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

    var lastUIUpdateFrame = -1;
    timeline.onFrameChanged = function(curr, total, isPlaying) {
      if (!isPlaying || Math.abs(curr - lastUIUpdateFrame) >= 2 || curr === 0 || curr === total - 1) {
        lastUIUpdateFrame = curr;
        timeSlider.max = Math.max(0, total - 1);
        timeSlider.value = curr;
        if (frameInfo) {
          frameInfo.textContent = 'Frame: ' + (curr + 1) + ' / ' + total;
        }
      }
      if (btnPlay) {
        var txt = isPlaying ? 'Pause' : 'Play';
        if (btnPlay.textContent !== txt) btnPlay.textContent = txt;
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
      } else if (e.key === 'b' || e.key === 'B') {
        selectTool('add_belt');
      } else if (e.key === 'm' || e.key === 'M') {
        selectTool('add_motor');
      } else if (e.key === 't' || e.key === 'T') {
        selectTool('add_label');
      } else if (e.key === 'd' || e.key === 'D') {
        selectTool('draw_shape');
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
    if (!contextMenuEl) return;
    if (radialMenuEl) radialMenuEl.style.display = 'none';
    if (hoverTip) hoverTip.style.display = 'none';

    var typeName = (targetType || 'MENU').toUpperCase();
    var subText = '';
    var sections = [];

    function section(title) {
      var s = { title: title, items: [] };
      sections.push(s);
      return s;
    }
    function item(sec, label, action, opts) {
      opts = opts || {};
      sec.items.push({ label: label, action: action, danger: !!opts.danger, active: !!opts.active });
    }

    function selectElement(type, index) {
      setMode('edit');
      selectTool('select');
      var it = null;
      if (type === 'node') {
        it = editor.getNodeById(index);
        editor.selectedNodeId = index;
      } else if (type === 'rod') it = editor.rods[index];
      else if (type === 'spring') it = editor.springs[index];
      else if (type === 'slider') it = editor.sliders[index];
      else if (type === 'gear') it = editor.gears[index];
      else if (type === 'pulley') it = editor.pulleys[index];
      else if (type === 'cam') it = editor.cams[index];
      editor.selection = { type: type, index: index, id: (type === 'node' ? index : undefined), item: it };
      editor.render(physics);
    }

    if (targetType === 'node') {
      var n = targetData.item || targetData;
      subText = '#' + n.id;

      var nodeProps = section('NODE');
      item(nodeProps, 'Properties...', function() { openInspector('node', n); });
      item(nodeProps, n.fixed ? 'Make Free Joint' : 'Anchor as Pin', function() { editor.toggleFixed(n.id); });
      if (n.fixed) {
        item(nodeProps, n.simplified ? 'Show Ground Stand' : 'Simplify to Point', function() {
          editor.saveState();
          n.simplified = !n.simplified;
          editor._notifyChange();
        });
      }

      var nodeView = section('VIEW');
      item(nodeView, editor.trackedNodes.has(n.id) ? 'Untrack Trace' : 'Track Trace', function() { editor.toggleTrackNode(n.id); });
      item(nodeView, n.showVelocity ? 'Hide Velocity' : 'Show Velocity', function() {
        n.showVelocity = !n.showVelocity;
        editor.render(physics);
      });

      var nodeConnect = section('CONNECT');
      item(nodeConnect, 'Beam from here', function() {
        selectTool('add_rod');
        editor.connectStartNode = n.id;
        editor.isConnecting = true;
      });
      item(nodeConnect, 'Spring from here', function() {
        selectTool('add_spring');
        editor.connectStartNode = n.id;
        editor.isConnectingSpring = true;
      });

      var nodeAttach = section('ATTACH');
      item(nodeAttach, 'Cam', function() { editor.addCam(n.id, 'pear', 35, 25); });
      item(nodeAttach, 'Vector Cam...', function() { openCustomCamModal(n.id); });
      item(nodeAttach, 'Pulley', function() { editor.addPulley(n.id, 35); });
      var nearGear = editor.findGearNear(n.x, n.y);
      if (nearGear !== -1) {
        item(nodeAttach, 'Lock to Gear', function() { editor.attachNodeToGear(n.id, nearGear); });
      }
      var slIdx = editor.sliders.findIndex(function(s) { return s.node === n.id; });
      if (slIdx !== -1) {
        item(nodeAttach, 'Slider Rail...', function() { openInspector('slider', { index: slIdx, slider: editor.sliders[slIdx] }); });
      }
      var motIdx = editor.motors.findIndex(function(m) { return m.centerNode === n.id || m.crankNode === n.id; });
      if (motIdx !== -1) {
        item(nodeAttach, 'Motor...', function() { openInspector('motor', { index: motIdx, motor: editor.motors[motIdx] }); });
      }

      item(section('DELETE'), 'Delete Node', function() { editor.deleteNode(n.id); }, { danger: true });

    } else if (targetType === 'rod') {
      var rodIdx = targetData.index;
      var r = targetData.rod || targetData.item || editor.rods[rodIdx];
      typeName = 'BEAM';
      subText = '#' + rodIdx;
      var rodProps = section('BEAM');
      item(rodProps, 'Properties...', function() { openInspector('rod', targetData); });
      item(rodProps, 'Delete Beam', function() {
        editor.saveState();
        editor.rods.splice(rodIdx, 1);
        editor.selection = null;
        editor._notifyChange();
      }, { danger: true });

      var rodOrient = section('ORIENTATION LOCK');
      item(rodOrient, 'Lock Horizontal', function() {
        editor.saveState(); r.angleLock = 'horizontal'; editor._notifyChange();
      }, { active: r.angleLock === 'horizontal' });
      item(rodOrient, 'Lock Vertical', function() {
        editor.saveState(); r.angleLock = 'vertical'; editor._notifyChange();
      }, { active: r.angleLock === 'vertical' });
      item(rodOrient, 'Lock Current Angle', function() {
        editor.saveState();
        r.angleLock = 'fixed';
        var na = editor.getNodeById(r.a), nb = editor.getNodeById(r.b);
        if (na && nb) r.lockedAngle = Math.atan2(nb.y - na.y, nb.x - na.x);
        editor._notifyChange();
      }, { active: r.angleLock === 'fixed' });
      item(rodOrient, 'Unlock', function() {
        editor.saveState(); r.angleLock = 'none'; editor._notifyChange();
      }, { active: !r.angleLock || r.angleLock === 'none' });

      var rodView = section('VIEW');
      item(rodView, ((r.showStress !== undefined) ? r.showStress : renderer.showStress) ? 'Hide Stress' : 'Show Stress', function() {
        r.showStress = !((r.showStress !== undefined) ? r.showStress : renderer.showStress);
        editor.render(physics);
      });
      item(rodView, ((r.showDimensions !== undefined) ? r.showDimensions : renderer.showDimensions) ? 'Hide Dimensions' : 'Show Dimensions', function() {
        r.showDimensions = !((r.showDimensions !== undefined) ? r.showDimensions : renderer.showDimensions);
        editor.render(physics);
      });

    } else if (targetType === 'slider') {
      var slIdx2 = targetData.index;
      var sl = targetData.slider || targetData.item || editor.sliders[slIdx2];
      subText = '#' + slIdx2;
      var slProps = section('SLIDER');
      item(slProps, 'Properties...', function() { openInspector('slider', targetData); });
      item(slProps, 'Delete Slider', function() { editor.deleteSlider(slIdx2); }, { danger: true });
      var slRail = section('RAIL ORIENTATION');
      item(slRail, 'Horizontal (0 deg)', function() { editor.rotateSliderRail(slIdx2, 0); });
      item(slRail, 'Vertical (90 deg)', function() { editor.rotateSliderRail(slIdx2, 90); });
      item(slRail, 'Rotate +45 deg', function() {
        var na = editor.getNodeById(sl.aNode), nb = editor.getNodeById(sl.bNode);
        var curDeg = (na && nb) ? Math.round(Math.atan2(nb.y - na.y, nb.x - na.x) * 180 / Math.PI) : 0;
        editor.rotateSliderRail(slIdx2, curDeg + 45);
      });
      item(slRail, 'Free Travel (no end-stops)', function() {
        editor.saveState();
        sl.minT = undefined;
        sl.maxT = undefined;
        editor._notifyChange();
      }, { active: sl.minT === undefined && sl.maxT === undefined });

    } else if (targetType === 'gear') {
      var gIdx = targetData.index;
      var g = targetData.gear || targetData.item || editor.gears[gIdx];
      subText = '#' + gIdx;
      var gearProps = section('GEAR');
      item(gearProps, 'Properties...', function() { openInspector('gear', targetData); });
      item(gearProps, 'Delete Gear', function() { editor.deleteGear(gIdx); }, { danger: true });
      var gearAct = section('ADD TO GEAR');
      item(gearAct, 'Add Pin Here', function() { editor.createPinOnTarget(targetData, editor.mouseWorldX, editor.mouseWorldY); });
      item(gearAct, 'Add Crankpin', function() { editor.addCrankpinOnGear(gIdx); });
      item(gearAct, 'Drive Motor', function() { editor.addMotor(g.centerNode, g.centerNode, 3.0); });
      item(gearAct, 'Mount Cam', function() { editor.addCam(g.centerNode, 'pear', 35, 25); });

    } else if (targetType === 'spring') {
      var spIdx = targetData.index;
      var spr = targetData.spring || targetData.item || editor.springs[spIdx];
      subText = '#' + spIdx;
      var sprProps = section('SPRING');
      item(sprProps, 'Properties...', function() { openInspector('spring', targetData); });
      item(sprProps, 'Stiffer (x1.5)', function() {
        editor.saveState(); spr.stiffness = Math.round((spr.stiffness || 200) * 1.5); editor._notifyChange();
      });
      item(sprProps, 'Softer (x0.7)', function() {
        editor.saveState(); spr.stiffness = Math.round((spr.stiffness || 200) * 0.7); editor._notifyChange();
      });
      item(sprProps, 'Delete Spring', function() { editor.deleteSpring(spIdx); }, { danger: true });

    } else if (targetType === 'pulley') {
      var pIdx = targetData.index;
      var pItem = targetData.pulley || targetData.item || editor.pulleys[pIdx];
      subText = '#' + pIdx;
      var pulProps = section('PULLEY');
      item(pulProps, 'Properties...', function() { openInspector('pulley', targetData); });
      item(pulProps, 'Delete Pulley', function() { editor.deletePulley(pIdx); }, { danger: true });
      var pulAct = section('ADD TO PULLEY');
      item(pulAct, 'Add Pin Here', function() { editor.createPinOnTarget(targetData, editor.mouseWorldX, editor.mouseWorldY); });
      item(pulAct, 'Belt to another pulley...', function() {
        selectTool('add_belt');
        editor._beltStartPulley = pIdx;
      });
      item(pulAct, 'Drive Motor', function() { editor.addMotor(pItem.nodeId, pItem.nodeId, 3.0); });

    } else if (targetType === 'cam') {
      var cIdx = targetData.index;
      var cItem = targetData.cam || targetData.item || editor.cams[cIdx];
      subText = '#' + cIdx;
      var camProps = section('CAM');
      item(camProps, 'Properties...', function() { openInspector('cam', targetData); });
      item(camProps, 'Delete Cam', function() { editor.deleteCam(cIdx); }, { danger: true });
      var camAct = section('ADD TO CAM');
      item(camAct, 'Add Pin Here', function() { editor.createPinOnTarget(targetData, editor.mouseWorldX, editor.mouseWorldY); });
      item(camAct, 'Vector Cam...', function() { openCustomCamModal(cItem.centerNode, cIdx); });
      item(camAct, 'Drive Motor', function() { editor.addMotor(cItem.centerNode, cItem.centerNode, 3.0); });

    } else if (targetType === 'belt') {
      var bIdx = targetData.index;
      var bItem = targetData.belt || targetData.item || editor.belts[bIdx];
      subText = '#' + bIdx;
      var beltProps = section('BELT');
      item(beltProps, (bItem && bItem.crossed) ? 'Uncross Belt' : 'Cross Belt', function() {
        editor.saveState();
        if (bItem) bItem.crossed = !bItem.crossed;
        editor._notifyChange();
      }, { active: bItem && bItem.crossed });
      item(beltProps, 'Delete Belt', function() { editor.deleteBelt(bIdx); }, { danger: true });

    } else if (targetType === 'geneva') {
      var genIdx = targetData.index;
      subText = '#' + genIdx;
      var genProps = section('GENEVA');
      item(genProps, 'Properties...', function() { openInspector('geneva', targetData); });
      item(genProps, 'Add Pin Here', function() { editor.createPinOnTarget(targetData, editor.mouseWorldX, editor.mouseWorldY); });
      item(genProps, 'Delete Geneva', function() {
        editor.saveState();
        editor.genevas.splice(genIdx, 1);
        editor._notifyChange();
      }, { danger: true });

    } else if (targetType === 'motor') {
      var mIdx = targetData.index;
      var mItem = targetData.motor || targetData.item || editor.motors[mIdx];
      subText = '#' + mIdx;
      var motSec = section('MOTOR');
      item(motSec, 'Properties...', function() { openInspector('motor', targetData); });
      item(motSec, (mItem.speed >= 0 ? 'Reverse Direction' : 'Run Forward'), function() {
        editor.saveState();
        mItem.speed = -(mItem.speed || 1);
        editor._notifyChange();
      });
      item(motSec, 'Speed: Slow (1.0 rad/s)', function() { editor.saveState(); mItem.speed = 1.0; editor._notifyChange(); });
      item(motSec, 'Speed: Medium (3.0 rad/s)', function() { editor.saveState(); mItem.speed = 3.0; editor._notifyChange(); });
      item(motSec, 'Speed: Fast (6.0 rad/s)', function() { editor.saveState(); mItem.speed = 6.0; editor._notifyChange(); });
      item(motSec, 'Delete Motor', function() { editor.deleteMotor(mIdx); }, { danger: true });

    } else {
      var pos = targetData;
      typeName = 'ADD';
      subText = '';
      var addSec = section('ADD ELEMENT');
      item(addSec, 'Joint (free node)', function() { selectElement('node', editor.addNode(pos.x, pos.y, false)); });
      item(addSec, 'Pin (ground anchor)', function() { selectElement('node', editor.addNode(pos.x, pos.y, true)); });
      item(addSec, 'Beam', function() {
        var a = editor.addNode(pos.x - 40, pos.y, false);
        var b = editor.addNode(pos.x + 40, pos.y, false);
        editor.addRod(a, b);
        selectElement('rod', editor.rods.length - 1);
      });
      item(addSec, 'Spring', function() {
        var a = editor.addNode(pos.x - 35, pos.y, false);
        var b = editor.addNode(pos.x + 35, pos.y, false);
        editor.addSpring(a, b);
        selectElement('spring', editor.springs.length - 1);
      });
      item(addSec, 'Slider', function() {
        var a = editor.addNode(pos.x - 70, pos.y, true);
        var b = editor.addNode(pos.x + 70, pos.y, true);
        var s = editor.addNode(pos.x, pos.y, false);
        editor.addSlider(s, a, b);
        selectElement('node', s);
      });
      item(addSec, 'Lever', function() {
        var lv = editor.addLever(pos.x, pos.y);
        selectElement('node', lv.handleNode);
      });
      item(addSec, 'Gear', function() {
        var cId = editor.addNode(pos.x, pos.y, true);
        editor.addGear(cId, 45, 15);
        selectElement('gear', editor.gears.length - 1);
      });
      item(addSec, 'Pulley', function() {
        var cId = editor.addNode(pos.x, pos.y, true);
        editor.addPulley(cId, 35);
        selectElement('pulley', editor.pulleys.length - 1);
      });
      item(addSec, 'Cam', function() {
        var cId = editor.addNode(pos.x, pos.y, true);
        editor.addCam(cId, 'pear', 35, 25);
        selectElement('cam', editor.cams.length - 1);
      });
      item(addSec, 'Motor (pin + crank)', function() {
        var center = editor.addNode(pos.x - 30, pos.y, true);
        var crank = editor.addNode(pos.x + 30, pos.y, false);
        editor.addMotor(center, crank, 3.0);
        selectElement('node', crank);
      });
      item(addSec, 'Text Label', function() {
        var txt = window.prompt('Label text:', 'Label');
        if (txt === null || txt.trim() === '') return;
        editor.addLabel(pos.x, pos.y, txt.trim());
      });
    }

    var world = section('WORLD');
    item(world, 'Gravity: ' + (physics.gravityY ? 'On' : 'Off'), function() {
      physics.gravityY = physics.gravityY ? 0 : 980;
      timeline.invalidateLoop();
    }, { active: !!physics.gravityY });
    item(world, 'Loop Cache: ' + (timeline.loopCacheEnabled ? 'On' : 'Off'), function() {
      timeline.setLoopCacheEnabled(!timeline.loopCacheEnabled);
    }, { active: timeline.loopCacheEnabled });
    item(world, 'Clean Pins (all): ' + (renderer.hidePins ? 'On' : 'Off'), function() {
      renderer.hidePins = !renderer.hidePins;
      editor.renderer.hidePins = renderer.hidePins;
      editor.render(physics);
    }, { active: renderer.hidePins });

    contextMenuEl.innerHTML = '';

    var header = document.createElement('div');
    header.className = 'context-header';
    header.textContent = typeName + (subText ? '  ' + subText : '');
    contextMenuEl.appendChild(header);

    for (var si = 0; si < sections.length; si++) {
      var sec = sections[si];
      if (sec.items.length === 0) continue;
      var group = document.createElement('div');
      group.className = 'context-group';
      var title = document.createElement('div');
      title.className = 'context-group-title';
      title.textContent = sec.title;
      group.appendChild(title);
      for (var ii = 0; ii < sec.items.length; ii++) {
        (function(it) {
          var row = document.createElement('div');
          row.className = 'context-item' + (it.danger ? ' danger' : '') + (it.active ? ' active-opt' : '');
          row.textContent = it.label;
          row.addEventListener('click', function(e) {
            e.stopPropagation();
            hideContextMenu();
            it.action();
          });
          group.appendChild(row);
        })(sec.items[ii]);
      }
      contextMenuEl.appendChild(group);
    }

    contextMenuEl.style.display = 'block';

    var menuW = contextMenuEl.offsetWidth || 200;
    var menuH = contextMenuEl.offsetHeight || 200;
    var px = Math.max(8, Math.min(window.innerWidth - menuW - 8, clientX));
    var py = Math.max(8, Math.min(window.innerHeight - menuH - 8, clientY));
    contextMenuEl.style.left = px + 'px';
    contextMenuEl.style.top = py + 'px';
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
      var na = editor.getNodeById(sl.aNode), nb = editor.getNodeById(sl.bNode);
      var railLen = (na && nb) ? Math.round(Math.hypot(nb.x - na.x, nb.y - na.y)) : 140;
      var defMin = 16;
      var defMax = Math.max(20, railLen - 16);
      var curAngleDeg = (na && nb) ? Math.round(Math.atan2(nb.y - na.y, nb.x - na.x) * 180 / Math.PI) : 0;
      bodyEl.innerHTML = 
        '<div class="form-group"><label>Rail Orientation Angle (°)</label>' +
        '<div style="display:flex; gap:6px; align-items:center; margin-top:4px;">' +
        '<input type="number" id="insRailAngle" value="' + curAngleDeg + '" step="5" style="width:75px;">' +
        '<button type="button" id="btnAngleHoriz" style="padding:2px 7px; font-size:0.75rem;">0° Horiz</button>' +
        '<button type="button" id="btnAngleVert" style="padding:2px 7px; font-size:0.75rem;">90° Vert</button>' +
        '<button type="button" id="btnAngle45" style="padding:2px 7px; font-size:0.75rem;">45°</button>' +
        '<button type="button" id="btnAngleM45" style="padding:2px 7px; font-size:0.75rem;">-45°</button>' +
        '</div></div>' +
        '<div class="form-group"><label>Rail Length</label><input type="number" value="' + railLen + '" disabled></div>' +
        '<div class="form-group"><label><input type="checkbox" id="insEnableStroke" ' + (hasMin || hasMax ? 'checked' : '') + '> Enforce End-Stop Travel Limits</label>' +
        '<div style="font-size:0.68rem;color:#64748b;margin-top:3px;">Travel is measured in px from the rail start (0) to the rail end (' + railLen + ').</div></div>' +
        '<div class="form-group"><label>Min Travel (px from start)</label><input type="number" id="insMinT" value="' + (hasMin ? sl.minT : defMin) + '" step="5" min="0" max="' + railLen + '"></div>' +
        '<div class="form-group"><label>Max Travel (px from start)</label><input type="number" id="insMaxT" value="' + (hasMax ? sl.maxT : defMax) + '" step="5" min="0" max="' + railLen + '"></div>' +
        '<div class="form-group"><label>Friction Coefficient</label><input type="number" id="insFric" value="' + (sl.friction || 0) + '" step="0.05" min="0"></div>';

      var angleInput = document.getElementById('insRailAngle');
      document.getElementById('btnAngleHoriz').onclick = function() { angleInput.value = 0; };
      document.getElementById('btnAngleVert').onclick = function() { angleInput.value = 90; };
      document.getElementById('btnAngle45').onclick = function() { angleInput.value = 45; };
      document.getElementById('btnAngleM45').onclick = function() { angleInput.value = -45; };

      saveHandler = function() {
        editor.saveState();
        var newAngle = parseFloat(angleInput.value);
        if (!isNaN(newAngle) && newAngle !== curAngleDeg) {
          editor.rotateSliderRail(data.index, newAngle);
        }
        var enableStroke = document.getElementById('insEnableStroke').checked;
        if (enableStroke) {
          var rawMin = parseFloat(document.getElementById('insMinT').value);
          var rawMax = parseFloat(document.getElementById('insMaxT').value);
          if (!isFinite(rawMin)) rawMin = defMin;
          if (!isFinite(rawMax)) rawMax = defMax;
          sl.minT = Math.max(0, Math.min(railLen, rawMin));
          sl.maxT = Math.max(0, Math.min(railLen, rawMax));
          if (sl.minT > sl.maxT) {
            var swapT = sl.minT;
            sl.minT = sl.maxT;
            sl.maxT = swapT;
          }
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
    var vertexCountEl = document.getElementById('camVertexCount');
    var drawHintEl = document.getElementById('camDrawHint');
    var btnDrawMode = document.getElementById('btnCamDrawMode');
    var btnVertexMode = document.getElementById('btnCamVertexMode');
    var btnSmooth = document.getElementById('btnCamSmooth');
    var btnAddLobe = document.getElementById('btnCamAddLobe');
    var btnResetCircle = document.getElementById('btnCamResetCircle');
    var btnClose = document.getElementById('btnCamDesignerClose');
    var btnCancel = document.getElementById('btnCamDesignerCancel');
    var btnSave = document.getElementById('btnCamDesignerSave');
    if (!modal || !previewCanvas) return;

    var previewCtx = previewCanvas.getContext('2d');
    var currentCam = (camIdx !== undefined && camIdx !== null && editor.cams[camIdx]) ? editor.cams[camIdx] : null;

    var NUM_BINS = 72;
    var radii = new Float64Array(NUM_BINS);
    var activeMode = 'draw'; // 'draw' or 'vertex'
    var isInteracting = false;
    var activeHandleIdx = -1;

    function getAngleIndex(theta) {
      var norm = (theta + Math.PI) / (2 * Math.PI);
      var idx = Math.floor(norm * NUM_BINS) % NUM_BINS;
      if (idx < 0) idx += NUM_BINS;
      return idx;
    }

    function indexToAngle(idx) {
      return (idx / NUM_BINS) * Math.PI * 2 - Math.PI;
    }

    function syncRadiiFromPoints(pts) {
      var rBase = parseFloat(inputBaseR.value) || 35;
      radii.fill(rBase);
      if (!pts || pts.length < 3) return;
      for (var i = 0; i < pts.length; i++) {
        var x = pts[i][0];
        var y = pts[i][1];
        var th = Math.atan2(y, x);
        var r = Math.hypot(x, y);
        radii[getAngleIndex(th)] = r;
      }
      // Fill any zero gaps by linear interpolation
      for (var i = 0; i < NUM_BINS; i++) {
        if (radii[i] < 5) radii[i] = rBase;
      }
    }

    function generatePointsFromRadii() {
      var pts = [];
      for (var i = 0; i < NUM_BINS; i++) {
        var th = indexToAngle(i);
        var r = radii[i];
        pts.push([Math.round(r * Math.cos(th) * 10) / 10, Math.round(r * Math.sin(th) * 10) / 10]);
      }
      return pts;
    }

    if (currentCam) {
      inputBaseR.value = currentCam.baseRadius || 35;
      inputLift.value = currentCam.lift !== undefined ? currentCam.lift : 25;
      if (currentCam.options && currentCam.options.points) {
        textPoints.value = JSON.stringify(currentCam.options.points);
        selectPreset.value = 'freeform';
        syncRadiiFromPoints(currentCam.options.points);
      } else {
        selectPreset.value = currentCam.profileType || 'pear';
        var initPts = generatePointsForPreset(selectPreset.value, inputBaseR.value, inputLift.value);
        syncRadiiFromPoints(initPts);
      }
    } else {
      inputBaseR.value = 35;
      inputLift.value = 25;
      selectPreset.value = 'pear';
      var initPts = generatePointsForPreset('pear', 35, 25);
      syncRadiiFromPoints(initPts);
    }

    function generatePointsForPreset(preset, rBase, lift) {
      rBase = parseFloat(rBase) || 35;
      lift = parseFloat(lift) || 25;
      var pts = [];
      if (preset === 'geneva') {
        pts = Math2D.getGenevaPoints(4, rBase + lift * 0.4, (rBase + lift * 0.4) * Math.SQRT2, 11);
      } else if (preset === 'pear') {
        pts = Math2D.getCamPoints('pear', rBase, lift, NUM_BINS, { lobeAngle: 65 });
      } else if (preset === 'heart') {
        pts = Math2D.getCamPoints('heart', rBase, lift, NUM_BINS);
      } else if (preset === 'snail') {
        pts = Math2D.getCamPoints('snail', rBase, lift, NUM_BINS);
      } else if (preset === 'trochoid') {
        for (var i = 0; i < NUM_BINS; i++) {
          var a = indexToAngle(i);
          var r = rBase + lift * 0.5 * (1 + Math.cos(3 * a));
          pts.push([Math.round(r * Math.cos(a) * 10) / 10, Math.round(r * Math.sin(a) * 10) / 10]);
        }
      } else if (preset === 'clover') {
        for (var i = 0; i < NUM_BINS; i++) {
          var a = indexToAngle(i);
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
          pts = Math2D.getCamPoints('pear', rBase, lift, NUM_BINS);
        }
      }
      return pts;
    }

    function applyRadialBrush(mx, my) {
      var cx = previewCanvas.width / 2;
      var cy = previewCanvas.height / 2;
      var dx = mx - cx;
      var dy = my - cy;
      var dist = Math.hypot(dx, dy);
      var angle = Math.atan2(dy, dx);
      var targetR = Math.max(12, Math.min(95, dist));
      var centerIdx = getAngleIndex(angle);

      // Smooth radial influence across neighboring angular bins
      var brushSpan = 6;
      for (var offset = -brushSpan; offset <= brushSpan; offset++) {
        var idx = (centerIdx + offset + NUM_BINS) % NUM_BINS;
        var weight = Math.cos((offset / (brushSpan + 1)) * (Math.PI / 2));
        radii[idx] = radii[idx] * (1 - weight * 0.6) + targetR * (weight * 0.6);
      }
      selectPreset.value = 'freeform';
      updatePreview(true);
    }

    function smoothContour() {
      var smoothed = new Float64Array(NUM_BINS);
      for (var i = 0; i < NUM_BINS; i++) {
        var prev = radii[(i - 1 + NUM_BINS) % NUM_BINS];
        var cur = radii[i];
        var next = radii[(i + 1) % NUM_BINS];
        smoothed[i] = prev * 0.25 + cur * 0.5 + next * 0.25;
      }
      radii.set(smoothed);
      selectPreset.value = 'freeform';
      updatePreview(true);
    }

    function updatePreview(skipPresetGen) {
      var pts = [];
      var preset = selectPreset.value;
      if (!skipPresetGen && preset !== 'freeform') {
        pts = generatePointsForPreset(preset, inputBaseR.value, inputLift.value);
        syncRadiiFromPoints(pts);
      } else {
        pts = generatePointsFromRadii();
      }
      textPoints.value = JSON.stringify(pts);
      if (vertexCountEl) vertexCountEl.textContent = pts.length + ' vertices';

      previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
      var cx = previewCanvas.width / 2;
      var cy = previewCanvas.height / 2;

      // Draw polar reference grid
      previewCtx.strokeStyle = '#f1f5f9';
      previewCtx.lineWidth = 1;
      var gridRadii = [25, 50, 75, 100];
      for (var gr = 0; gr < gridRadii.length; gr++) {
        previewCtx.beginPath();
        previewCtx.arc(cx, cy, gridRadii[gr], 0, Math.PI * 2);
        previewCtx.stroke();
      }
      previewCtx.beginPath();
      previewCtx.moveTo(cx, 0); previewCtx.lineTo(cx, previewCanvas.height);
      previewCtx.moveTo(0, cy); previewCtx.lineTo(previewCanvas.width, cy);
      previewCtx.stroke();

      // Base radius guide circle (dashed blue)
      var baseR = parseFloat(inputBaseR.value) || 35;
      previewCtx.save();
      previewCtx.setLineDash([3, 3]);
      previewCtx.strokeStyle = '#93c5fd';
      previewCtx.beginPath();
      previewCtx.arc(cx, cy, baseR, 0, Math.PI * 2);
      previewCtx.stroke();
      previewCtx.restore();

      if (pts && pts.length >= 3) {
        previewCtx.save();
        previewCtx.translate(cx, cy);

        // Draw cam contour body
        previewCtx.beginPath();
        previewCtx.moveTo(pts[0][0], pts[0][1]);
        for (var i = 1; i < pts.length; i++) {
          previewCtx.lineTo(pts[i][0], pts[i][1]);
        }
        previewCtx.closePath();
        var camGrad = previewCtx.createRadialGradient(0, 0, 10, 0, 0, 80);
        camGrad.addColorStop(0, '#e2e8f0');
        camGrad.addColorStop(1, '#cbd5e1');
        previewCtx.fillStyle = camGrad;
        previewCtx.fill();
        previewCtx.lineWidth = 2;
        previewCtx.strokeStyle = '#2563eb';
        previewCtx.stroke();

        // If in vertex mode, draw handles on key points
        if (activeMode === 'vertex') {
          var step = Math.max(1, Math.floor(pts.length / 16));
          for (var vi = 0; vi < pts.length; vi += step) {
            var vx = pts[vi][0];
            var vy = pts[vi][1];
            previewCtx.beginPath();
            previewCtx.arc(vx, vy, (activeHandleIdx === vi) ? 5 : 3.5, 0, Math.PI * 2);
            previewCtx.fillStyle = (activeHandleIdx === vi) ? '#ef4444' : '#ffffff';
            previewCtx.fill();
            previewCtx.lineWidth = 1.5;
            previewCtx.strokeStyle = '#1d4ed8';
            previewCtx.stroke();
          }
        }

        // Center hub & bore
        previewCtx.beginPath();
        previewCtx.arc(0, 0, 10, 0, Math.PI * 2);
        previewCtx.fillStyle = '#64748b';
        previewCtx.fill();
        previewCtx.lineWidth = 1.5;
        previewCtx.strokeStyle = '#334155';
        previewCtx.stroke();

        previewCtx.beginPath();
        previewCtx.arc(0, 0, 4, 0, Math.PI * 2);
        previewCtx.fillStyle = '#0f172a';
        previewCtx.fill();

        // Follower contact preview resting on top of cam
        var topPt = pts[getAngleIndex(-Math.PI / 2)];
        if (topPt) {
          previewCtx.beginPath();
          previewCtx.arc(0, topPt[1] - 8, 8, 0, Math.PI * 2);
          previewCtx.fillStyle = '#10b981';
          previewCtx.fill();
          previewCtx.lineWidth = 1.5;
          previewCtx.strokeStyle = '#047857';
          previewCtx.stroke();
        }

        previewCtx.restore();
      }
    }

    // Canvas Mouse / Touch Drawing Handlers
    function getCanvasCoords(e) {
      var rect = previewCanvas.getBoundingClientRect();
      var clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
      var clientY = e.clientY !== undefined ? e.clientY : (e.touches && e.touches[0] ? e.touches[0].clientY : 0);
      return {
        x: (clientX - rect.left) * (previewCanvas.width / rect.width),
        y: (clientY - rect.top) * (previewCanvas.height / rect.height)
      };
    }

    previewCanvas.onmousedown = function(e) {
      isInteracting = true;
      var pos = getCanvasCoords(e);
      if (activeMode === 'draw') {
        applyRadialBrush(pos.x, pos.y);
      } else {
        // Find closest handle
        var cx = previewCanvas.width / 2;
        var cy = previewCanvas.height / 2;
        var pts = generatePointsFromRadii();
        var step = Math.max(1, Math.floor(pts.length / 16));
        var bestIdx = -1, bestDist = 18;
        for (var vi = 0; vi < pts.length; vi += step) {
          var hx = cx + pts[vi][0];
          var hy = cy + pts[vi][1];
          var d = Math.hypot(pos.x - hx, pos.y - hy);
          if (d < bestDist) {
            bestDist = d;
            bestIdx = vi;
          }
        }
        activeHandleIdx = bestIdx;
      }
    };

    window.addEventListener('mousemove', function(e) {
      if (!isInteracting || modal.style.display !== 'flex') return;
      var pos = getCanvasCoords(e);
      if (activeMode === 'draw') {
        applyRadialBrush(pos.x, pos.y);
      } else if (activeHandleIdx !== -1) {
        var cx = previewCanvas.width / 2;
        var cy = previewCanvas.height / 2;
        var r = Math.max(12, Math.min(95, Math.hypot(pos.x - cx, pos.y - cy)));
        radii[activeHandleIdx] = r;
        selectPreset.value = 'freeform';
        updatePreview(true);
      }
    });

    window.addEventListener('mouseup', function() {
      if (isInteracting && modal.style.display === 'flex') {
        isInteracting = false;
        activeHandleIdx = -1;
        updatePreview(true);
      }
    });

    // Toolbar mode toggle
    if (btnDrawMode && btnVertexMode) {
      btnDrawMode.onclick = function() {
        activeMode = 'draw';
        btnDrawMode.style.background = '#2563eb'; btnDrawMode.style.color = '#fff'; btnDrawMode.style.borderColor = '#1d4ed8';
        btnVertexMode.style.background = '#fff'; btnVertexMode.style.color = '#1e293b'; btnVertexMode.style.borderColor = '#cbd5e1';
        if (drawHintEl) drawHintEl.textContent = 'Click and drag around the center hub to carve custom profile in real time';
        updatePreview(true);
      };
      btnVertexMode.onclick = function() {
        activeMode = 'vertex';
        btnVertexMode.style.background = '#2563eb'; btnVertexMode.style.color = '#fff'; btnVertexMode.style.borderColor = '#1d4ed8';
        btnDrawMode.style.background = '#fff'; btnDrawMode.style.color = '#1e293b'; btnDrawMode.style.borderColor = '#cbd5e1';
        if (drawHintEl) drawHintEl.textContent = 'Drag circular vertex handles inward/outward to shape cam lobes and flats';
        updatePreview(true);
      };
    }

    if (btnSmooth) btnSmooth.onclick = smoothContour;
    if (btnAddLobe) {
      btnAddLobe.onclick = function() {
        var rBase = parseFloat(inputBaseR.value) || 35;
        var topIdx = getAngleIndex(-Math.PI / 2);
        for (var off = -10; off <= 10; off++) {
          var idx = (topIdx + off + NUM_BINS) % NUM_BINS;
          var w = Math.cos((off / 11) * (Math.PI / 2));
          radii[idx] = Math.max(radii[idx], rBase + 28 * w);
        }
        selectPreset.value = 'freeform';
        updatePreview(true);
      };
    }
    if (btnResetCircle) {
      btnResetCircle.onclick = function() {
        var rBase = parseFloat(inputBaseR.value) || 35;
        radii.fill(rBase);
        selectPreset.value = 'freeform';
        updatePreview(true);
      };
    }

    selectPreset.onchange = function() {
      updatePreview(false);
    };
    inputBaseR.oninput = function() {
      updatePreview(false);
    };
    inputLift.oninput = function() {
      updatePreview(false);
    };
    textPoints.oninput = function() {
      selectPreset.value = 'freeform';
      try {
        var p = JSON.parse(textPoints.value);
        syncRadiiFromPoints(p);
      } catch(e) {}
      updatePreview(true);
    };

    updatePreview(false);
    modal.style.display = 'flex';

    function closeCamModal() {
      modal.style.display = 'none';
    }

    btnClose.onclick = closeCamModal;
    btnCancel.onclick = closeCamModal;

    btnSave.onclick = function() {
      var pts = generatePointsFromRadii();
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

  var lastFrameTime = 0;
  var physicsAccumulator = 0;
  var FIXED_TIMESTEP = 1 / 60;

  function loop(timestamp) {
    if (!lastFrameTime) lastFrameTime = timestamp;
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
      physicsAccumulator += dt;
      if (physicsAccumulator > 0.1) physicsAccumulator = 0.1;
      while (physicsAccumulator >= FIXED_TIMESTEP) {
        timeline.update(FIXED_TIMESTEP);
        physicsAccumulator -= FIXED_TIMESTEP;
      }

      // Record motion traces (only for explicitly tracked nodes)
      if (physics.numNodes > 0 && timeline.isPlaying && editor.trackedNodes.size > 0) {
        editor.trackedNodes.forEach(function(nodeId) {
          if (nodeId < physics.numNodes) {
            renderer.recordTrace(nodeId, physics.x[nodeId], physics.y[nodeId]);
          }
        });
      }
    }

    // Render the unified canvas
    editor.render(physics);

    requestAnimationFrame(loop);
  }

  window.addEventListener('DOMContentLoaded', init);
})();
