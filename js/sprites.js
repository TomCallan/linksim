/**
 * Dynamic 2D Data-Driven Mechanical Sprite Renderer for Linksim.
 * Renders capsule links with bushings, sliding pistons/sleeves, toothed gears,
 * grounded brackets, and dynamic stress/speed visualizations.
 */
(function(root, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = factory();
  } else {
    root.SpriteRenderer = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  var TrackColors = [
    'rgba(239, 68, 68, 0.85)',   // Red
    'rgba(6, 182, 212, 0.85)',   // Cyan
    'rgba(139, 92, 246, 0.85)',  // Purple
    'rgba(16, 185, 129, 0.85)',  // Emerald
    'rgba(245, 158, 11, 0.85)',  // Amber
    'rgba(236, 72, 153, 0.85)',  // Pink
    'rgba(59, 130, 246, 0.85)'   // Blue
  ];

  function SpriteRenderer() {
    this.showStress = true;
    this.showTraces = true;
    this.showDimensions = false;
    this.showVelocities = false;
    this.hidePins = false;
    this.unitScale = 1.0; // 1 pixel = 1 mm
    this.maxTracePoints = 300;
    this.traces = {}; // nodeId -> [{x, y}]
    this.gearPathCache = {}; // key -> Path2D
  }

  SpriteRenderer.prototype.clearTraces = function() {
    this.traces = {};
  };

  SpriteRenderer.prototype.recordTrace = function(nodeId, x, y) {
    if (!this.traces[nodeId]) {
      this.traces[nodeId] = [];
    }
    var list = this.traces[nodeId];
    list.push({ x: x, y: y });
    if (list.length > this.maxTracePoints) {
      list.shift();
    }
  };

  /**
   * Render grounded pin anchor stand (bracket with mechanical earth hatching).
   */
  SpriteRenderer.prototype.drawGroundAnchor = function(ctx, x, y, size) {
    size = size || 16;
    ctx.save();
    ctx.translate(x, y);

    // Ground bracket triangle
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-size, size * 1.2);
    ctx.lineTo(size, size * 1.2);
    ctx.closePath();
    ctx.fillStyle = '#475569';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#1e293b';
    ctx.stroke();

    // Baseline
    ctx.beginPath();
    ctx.moveTo(-size * 1.3, size * 1.2);
    ctx.lineTo(size * 1.3, size * 1.2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#0f172a';
    ctx.stroke();

    // Earth hatching
    ctx.beginPath();
    for (var i = -size * 1.2; i <= size * 1.2; i += 6) {
      ctx.moveTo(i, size * 1.2);
      ctx.lineTo(i - 4, size * 1.2 + 6);
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#64748b';
    ctx.stroke();

    // Pivot bearing center
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = '#f8fafc';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#0f172a';
    ctx.stroke();

    ctx.restore();
  };

  /**
   * Render simplified ground pin (minimalist sleek pivot point with concentric ring).
   */
  SpriteRenderer.prototype.drawSimplifiedPin = function(ctx, x, y, size) {
    size = size || 7;
    ctx.save();
    // Concentric anchor ring
    ctx.beginPath();
    ctx.arc(x, y, size + 4, 0, Math.PI * 2);
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Pivot center dot
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fillStyle = '#0f172a';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    // Core pin hole
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = '#38bdf8';
    ctx.fill();

    ctx.restore();
  };

  /**
   * Render authentic helical coil spring with dynamic extension/compression waveform.
   */
  SpriteRenderer.prototype.drawSpring = function(ctx, x1, y1, x2, y2, width, color) {
    width = width || 14;
    color = color || '#10b981';
    var dx = x2 - x1;
    var dy = y2 - y1;
    var len = Math.hypot(dx, dy);
    if (len < 1e-6) return;

    var angle = Math.atan2(dy, dx);
    ctx.save();
    ctx.translate(x1, y1);
    ctx.rotate(angle);

    var endLeader = 12;
    var coilSpan = Math.max(10, len - endLeader * 2);
    var numCoils = 8;
    var dCoil = coilSpan / numCoils;
    var halfW = width * 0.5;

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(endLeader, 0);

    for (var i = 0; i < numCoils; i++) {
      var xBase = endLeader + i * dCoil;
      ctx.lineTo(xBase + dCoil * 0.25, -halfW);
      ctx.lineTo(xBase + dCoil * 0.75, halfW);
    }
    ctx.lineTo(endLeader + coilSpan, 0);
    ctx.lineTo(len, 0);

    ctx.lineWidth = 3;
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    // End mounting loops
    ctx.beginPath();
    ctx.arc(0, 0, 4, 0, Math.PI * 2);
    ctx.arc(len, 0, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#f8fafc';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#0f172a';
    ctx.stroke();

    ctx.restore();
  };

  /**
   * Render dynamic capsule linkage with bushings and optional stress tint.
   */
  SpriteRenderer.prototype.drawCapsuleLink = function(ctx, x1, y1, x2, y2, width, stress, customColor, showStress) {
    width = width || 12;
    var dx = x2 - x1;
    var dy = y2 - y1;
    var len = Math.hypot(dx, dy);
    if (len < 1e-6) return;

    var angle = Math.atan2(dy, dx);
    var radius = width * 0.8;

    ctx.save();
    ctx.translate(x1, y1);
    ctx.rotate(angle);

    // Determine color based on stress or custom
    var baseColor = customColor || '#2563eb';
    var useStress = (showStress === undefined) ? this.showStress : showStress;
    if (useStress && stress > 0.005) {
      var sNorm = Math.min(1.0, stress * 40);
      var r = Math.round(37 + sNorm * (239 - 37));
      var g = Math.round(99 - sNorm * 40);
      var b = Math.round(235 - sNorm * 180);
      baseColor = 'rgb(' + r + ',' + g + ',' + b + ')';
    }

    // Outer rounded body
    ctx.beginPath();
    ctx.arc(0, 0, radius, Math.PI / 2, -Math.PI / 2);
    ctx.arc(len, 0, radius, -Math.PI / 2, Math.PI / 2);
    ctx.closePath();

    ctx.fillStyle = baseColor;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#0f172a';
    ctx.stroke();

    // Center structural rib / highlight
    ctx.beginPath();
    ctx.moveTo(radius * 0.6, 0);
    ctx.lineTo(len - radius * 0.6, 0);
    ctx.lineWidth = width * 0.25;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineCap = 'round';
    ctx.stroke();

    // Bushing hole at start
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = '#f8fafc';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#0f172a';
    ctx.stroke();

    // Bushing hole at end
    ctx.beginPath();
    ctx.arc(len, 0, radius * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = '#f8fafc';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#0f172a';
    ctx.stroke();

    ctx.restore();
  };

  /**
   * Render prismatic slider rail, sleeve, and moving piston block.
   */
  SpriteRenderer.prototype.drawSlider = function(ctx, ax, ay, bx, by, px, py) {
    var dx = bx - ax;
    var dy = by - ay;
    var len = Math.hypot(dx, dy);
    if (len < 1e-6) return;

    var angle = Math.atan2(dy, dx);
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(angle);

    // Guide rails
    var railOffset = 10;
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#64748b';
    ctx.beginPath();
    ctx.moveTo(-15, -railOffset);
    ctx.lineTo(len + 15, -railOffset);
    ctx.moveTo(-15, railOffset);
    ctx.lineTo(len + 15, railOffset);
    ctx.stroke();

    // Rail end brackets
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#1e293b';
    ctx.strokeRect(-18, -railOffset - 5, 6, railOffset * 2 + 10);
    ctx.strokeRect(len + 12, -railOffset - 5, 6, railOffset * 2 + 10);

    // Compute slider position along rail
    var relX = px - ax;
    var relY = py - ay;
    var cos = Math.cos(-angle);
    var sin = Math.sin(-angle);
    var sliderU = relX * cos - relY * sin;

    // Moving Piston Carriage
    var blockW = 28;
    var blockH = railOffset * 2 + 8;
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(sliderU - blockW / 2, -blockH / 2, blockW, blockH);
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2;
    ctx.strokeRect(sliderU - blockW / 2, -blockH / 2, blockW, blockH);

    // Center pivot hole on the piston carriage
    ctx.beginPath();
    ctx.arc(sliderU, 0, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#38bdf8';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#0f172a';
    ctx.stroke();

    ctx.restore();
  };

  /**
   * Render rigid L-bracket or triangular bell-crank connecting A, B (apex), and C.
   */
  SpriteRenderer.prototype.drawRigidBracket = function(ctx, ax, ay, bx, by, cx, cy, width, color) {
    width = width || 14;
    var rad = width * 0.8;
    ctx.save();

    // Solid plate connecting all three nodes
    ctx.beginPath();
    ctx.arc(bx, by, rad * 1.3, 0, Math.PI * 2);
    ctx.fillStyle = color || '#6366f1';
    ctx.fill();

    // Arm 1 (B to A)
    this.drawCapsuleLink(ctx, bx, by, ax, ay, width, 0, color || '#6366f1');
    // Arm 2 (B to C)
    this.drawCapsuleLink(ctx, bx, by, cx, cy, width, 0, color || '#6366f1');

    // Triangular gusset/web between A, B, C
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + (ax - bx) * 0.6, by + (ay - by) * 0.6);
    ctx.lineTo(bx + (cx - bx) * 0.6, by + (cy - by) * 0.6);
    ctx.closePath();
    ctx.fillStyle = 'rgba(99, 102, 241, 0.4)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#4338ca';
    ctx.stroke();

    // Central apex bushing
    ctx.beginPath();
    ctx.arc(bx, by, rad * 0.6, 0, Math.PI * 2);
    ctx.fillStyle = '#f8fafc';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#0f172a';
    ctx.stroke();

    ctx.restore();
  };

  /**
   * Render toothed mechanical gear with proper addendum/dedendum meshing profile.
   */
  SpriteRenderer.prototype.drawGear = function(ctx, cx, cy, radius, teeth, angle) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);

    var numTeeth = Math.max(6, teeth);
    var pitchR = radius;
    var module = (2 * pitchR) / numTeeth; // gear module m
    var addendum = module;
    var dedendum = 1.25 * module;
    var tipR = pitchR + addendum;
    var rootR = Math.max(pitchR * 0.5, pitchR - dedendum);
    var toothAngle = (Math.PI * 2) / numTeeth;

    var key = Math.round(radius * 10) / 10 + '_' + numTeeth;
    var cachedPath = this.gearPathCache[key];

    if (typeof Path2D !== 'undefined') {
      if (!cachedPath) {
        cachedPath = new Path2D();
        for (var i = 0; i < numTeeth; i++) {
          var baseA = i * toothAngle;
          var a0 = baseA - toothAngle * 0.32;
          var a1 = baseA - toothAngle * 0.24;
          var a2 = baseA - toothAngle * 0.12;
          var a3 = baseA + toothAngle * 0.12;
          var a4 = baseA + toothAngle * 0.24;
          var a5 = baseA + toothAngle * 0.32;

          var x0 = rootR  * Math.cos(a0), y0 = rootR  * Math.sin(a0);
          var x1 = pitchR * Math.cos(a1), y1 = pitchR * Math.sin(a1);
          var x2 = tipR   * Math.cos(a2), y2 = tipR   * Math.sin(a2);
          var x3 = tipR   * Math.cos(a3), y3 = tipR   * Math.sin(a3);
          var x4 = pitchR * Math.cos(a4), y4 = pitchR * Math.sin(a4);
          var x5 = rootR  * Math.cos(a5), y5 = rootR  * Math.sin(a5);

          if (i === 0) cachedPath.moveTo(x0, y0);
          else cachedPath.lineTo(x0, y0);
          cachedPath.lineTo(x1, y1);
          cachedPath.lineTo(x2, y2);
          cachedPath.lineTo(x3, y3);
          cachedPath.lineTo(x4, y4);
          cachedPath.lineTo(x5, y5);
        }
        cachedPath.closePath();
        this.gearPathCache[key] = cachedPath;
      }
      ctx.fillStyle = '#cbd5e1';
      ctx.fill(cachedPath);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#334155';
      ctx.stroke(cachedPath);
    } else {
      // Fallback if Path2D is undefined
      ctx.beginPath();
      for (var i = 0; i < numTeeth; i++) {
        var baseA = i * toothAngle;
        var a0 = baseA - toothAngle * 0.32, a1 = baseA - toothAngle * 0.24;
        var a2 = baseA - toothAngle * 0.12, a3 = baseA + toothAngle * 0.12;
        var a4 = baseA + toothAngle * 0.24, a5 = baseA + toothAngle * 0.32;
        var x0 = rootR * Math.cos(a0), y0 = rootR * Math.sin(a0);
        var x1 = pitchR * Math.cos(a1), y1 = pitchR * Math.sin(a1);
        var x2 = tipR * Math.cos(a2), y2 = tipR * Math.sin(a2);
        var x3 = tipR * Math.cos(a3), y3 = tipR * Math.sin(a3);
        var x4 = pitchR * Math.cos(a4), y4 = pitchR * Math.sin(a4);
        var x5 = rootR * Math.cos(a5), y5 = rootR * Math.sin(a5);
        if (i === 0) ctx.moveTo(x0, y0);
        else ctx.lineTo(x0, y0);
        ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3);
        ctx.lineTo(x4, y4); ctx.lineTo(x5, y5);
      }
      ctx.closePath();
      ctx.fillStyle = '#cbd5e1';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#334155';
      ctx.stroke();
    }

    // Pitch circle guideline (dashed subtle)
    ctx.beginPath();
    ctx.setLineDash([3, 3]);
    ctx.arc(0, 0, pitchR, 0, Math.PI * 2);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(71, 85, 105, 0.4)';
    ctx.stroke();
    ctx.setLineDash([]);

    // Spokes and cutouts
    var numSpokes = Math.min(6, Math.max(3, Math.floor(numTeeth / 4)));
    var spokeAngle = (Math.PI * 2) / numSpokes;
    var holeR = radius * 0.22;
    var holeDist = radius * 0.55;

    for (var s = 0; s < numSpokes; s++) {
      var sa = s * spokeAngle;
      var hx = holeDist * Math.cos(sa);
      var hy = holeDist * Math.sin(sa);
      ctx.beginPath();
      ctx.arc(hx, hy, holeR, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#475569';
      ctx.stroke();
    }

    // Central hub & keyway
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.25, 0, Math.PI * 2);
    ctx.fillStyle = '#94a3b8';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#1e293b';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.12, 0, Math.PI * 2);
    ctx.fillStyle = '#0f172a';
    ctx.fill();

    ctx.restore();
  };

  /**
   * Render Geneva Wheel (Maltese Cross) with radial drive slots and mathematically exact concave locking cutouts.
   */
  SpriteRenderer.prototype.drawGenevaWheel = function(ctx, cx, cy, radius, slots, angle, lockRadius, slotWidth, centerDistance) {
    slots = slots || 4;
    radius = radius || 84.85;
    centerDistance = centerDistance || (radius * Math.SQRT2);
    slotWidth = slotWidth || 11;
    lockRadius = lockRadius || 40;

    var pts = Math2D.getGenevaPoints(slots, radius, centerDistance, slotWidth);
    if (!pts || pts.length < 3) return;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);

    // 1. Draw solid Maltese cross body
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i][0], pts[i][1]);
    }
    ctx.closePath();

    ctx.fillStyle = '#94a3b8';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#334155';
    ctx.stroke();

    // 2. Machined circular cutouts on each Geneva lobe / arm
    var dTheta = (Math.PI * 2) / slots;
    for (var k = 0; k < slots; k++) {
      var lobeA = k * dTheta + dTheta * 0.5;
      var cDist = radius * 0.52;
      var cR = radius * 0.12;
      ctx.beginPath();
      ctx.arc(cDist * Math.cos(lobeA), cDist * Math.sin(lobeA), cR, 0, Math.PI * 2);
      ctx.fillStyle = '#f8fafc';
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = '#475569';
      ctx.stroke();
    }

    // 3. Chamfer highlight
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.94, 0, Math.PI * 2);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.stroke();

    // 4. Central hub, brass bushing, and axle pin
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.28, 0, Math.PI * 2);
    ctx.fillStyle = '#64748b';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#1e293b';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.16, 0, Math.PI * 2);
    ctx.fillStyle = '#d97706';
    ctx.fill();
    ctx.strokeStyle = '#b45309';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.08, 0, Math.PI * 2);
    ctx.fillStyle = '#0f172a';
    ctx.fill();

    ctx.restore();
  };

  /**
   * Render Cam Driver plate with drive crank pin and authentic circular crescent locking collar disc.
   */
  SpriteRenderer.prototype.drawCamDriver = function(ctx, cx, cy, crankRadius, lockRadius, crankAngle, isEngaged) {
    lockRadius = lockRadius || 40;

    ctx.save();
    ctx.translate(cx, cy);

    // 1. Base mounting disc
    ctx.beginPath();
    ctx.arc(0, 0, lockRadius + 6, 0, Math.PI * 2);
    ctx.fillStyle = '#e2e8f0';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#64748b';
    ctx.stroke();

    // 2. Rotating locking collar disc with crescent clearance scallop and crank arm
    ctx.save();
    ctx.rotate(crankAngle);

    // Crescent locking disc (dwell lock collar):
    // Circular disc of radius lockRadius with a circular clearance scallop where crank pin is located
    ctx.beginPath();
    var scallopR = crankRadius * 0.45;
    var scallopDist = crankRadius * 0.65;
    var scallopA = Math.asin(Math.min(0.95, scallopR / lockRadius));
    ctx.arc(0, 0, lockRadius, scallopA, Math.PI * 2 - scallopA, false);
    ctx.arc(scallopDist, 0, scallopR, Math.PI - 0.7, Math.PI + 0.7, true);
    ctx.closePath();

    ctx.fillStyle = '#94a3b8';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#334155';
    ctx.stroke();

    // Crank arm
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(crankRadius, -6);
    ctx.arc(crankRadius, 0, 9, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(0, 9);
    ctx.closePath();
    ctx.fillStyle = '#475569';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#1e293b';
    ctx.stroke();

    // Drive crank pin (roller)
    ctx.beginPath();
    ctx.arc(crankRadius, 0, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = isEngaged ? '#ef4444' : '#f59e0b';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(crankRadius, 0, 2, 0, Math.PI * 2);
    ctx.fillStyle = '#0f172a';
    ctx.fill();

    ctx.restore();

    // Center pivot
    ctx.beginPath();
    ctx.arc(0, 0, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#0f172a';
    ctx.fill();

    ctx.restore();
  };

  /**
   * Render motor actuation indicator (rotational arrow).
   */
  SpriteRenderer.prototype.drawMotorIndicator = function(ctx, cx, cy, radius, speed, options) {
    options = options || {};
    ctx.save();
    ctx.translate(cx, cy);

    var isStalled = !!options.stalled;
    var color = isStalled ? '#ef4444' : '#f59e0b';

    ctx.beginPath();
    var r = Math.max(18, radius * 0.7);
    var startAngle = 0;
    var endAngle = Math.PI * 1.5;
    var anticlockwise = speed < 0;
    ctx.arc(0, 0, r, startAngle, endAngle, anticlockwise);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = color;
    if (isStalled) {
      ctx.setLineDash([4, 3]);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Arrowhead
    var tipX = r * Math.cos(endAngle);
    var tipY = r * Math.sin(endAngle);
    var tangent = endAngle + (anticlockwise ? -Math.PI / 2 : Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - 7 * Math.cos(tangent - 0.5), tipY - 7 * Math.sin(tangent - 0.5));
    ctx.lineTo(tipX - 7 * Math.cos(tangent + 0.5), tipY - 7 * Math.sin(tangent + 0.5));
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();

    if (isStalled) {
      ctx.font = 'bold 9px sans-serif';
      ctx.fillStyle = '#ef4444';
      ctx.textAlign = 'center';
      ctx.fillText('STALL', 0, -r - 4);
    }

    ctx.restore();
  };

  /**
   * Render mechanical pulley with V-belt groove, lightening holes, and keyed brass hub.
   */
  SpriteRenderer.prototype.drawPulley = function(ctx, cx, cy, radius, angle, options) {
    options = options || {};
    radius = radius || 30;
    var rimWidth = 4;
    var hubR = radius * 0.32;

    ctx.save();
    ctx.translate(cx, cy);

    // 1. Outer rim
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#64748b';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#1e293b';
    ctx.stroke();

    // 2. Belt groove recess (concentric ring)
    ctx.beginPath();
    ctx.arc(0, 0, radius - rimWidth, 0, Math.PI * 2);
    ctx.fillStyle = '#475569';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#0f172a';
    ctx.stroke();

    // 3. Rotating spokes / lightening holes
    ctx.save();
    ctx.rotate(angle || 0);

    var numHoles = radius > 35 ? 4 : 3;
    var holeR = (radius - rimWidth - hubR) * 0.32;
    var holeDist = (radius - rimWidth + hubR) * 0.5;

    for (var h = 0; h < numHoles; h++) {
      var a = h * (Math.PI * 2 / numHoles);
      ctx.beginPath();
      ctx.arc(holeDist * Math.cos(a), holeDist * Math.sin(a), holeR, 0, Math.PI * 2);
      ctx.fillStyle = '#cbd5e1';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#334155';
      ctx.stroke();
    }

    // 4. Central brass hub with keyway
    ctx.beginPath();
    ctx.arc(0, 0, hubR, 0, Math.PI * 2);
    ctx.fillStyle = '#d97706';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#92400e';
    ctx.stroke();

    // Keyway shaft notch
    var shaftR = hubR * 0.5;
    ctx.beginPath();
    ctx.arc(0, 0, shaftR, 0, Math.PI * 2);
    ctx.fillStyle = '#0f172a';
    ctx.fill();

    ctx.fillRect(shaftR * 0.5, -2, 3, 4);

    ctx.restore(); // rotate
    ctx.restore(); // translate
  };

  /**
   * Render continuous rubber transmission belt around two pulleys.
   */
  SpriteRenderer.prototype.drawBelt = function(ctx, c1x, c1y, r1, c2x, c2y, r2, crossed, beltWidth, animOffset) {
    beltWidth = beltWidth || 6;
    var Math2D = (typeof window !== 'undefined' && window.Math2D) || (typeof global !== 'undefined' && global.Math2D);
    if (!Math2D) return;

    var tang = Math2D.circleTangents(c1x, c1y, r1, c2x, c2y, r2, crossed);
    if (!tang) return;

    ctx.save();

    // 1. Draw outer belt loop
    ctx.beginPath();
    if (!crossed) {
      // Open belt: wrap around circle 1 from a2 to a1, line to p2a, wrap circle 2 from a1 to a2, line to p1b
      ctx.arc(c1x, c1y, r1, tang.a2, tang.a1, false);
      ctx.lineTo(tang.p2a[0], tang.p2a[1]);
      ctx.arc(c2x, c2y, r2, tang.a1, tang.a2, false);
      ctx.lineTo(tang.p1b[0], tang.p1b[1]);
    } else {
      // Crossed belt
      ctx.arc(c1x, c1y, r1, tang.a2, tang.a1, false);
      ctx.lineTo(tang.p2a[0], tang.p2a[1]);
      ctx.arc(c2x, c2y, r2, tang.a1 + Math.PI, tang.a2 - Math.PI, false);
      ctx.lineTo(tang.p1b[0], tang.p1b[1]);
    }
    ctx.closePath();

    // Industrial neoprene belt band
    ctx.lineWidth = beltWidth;
    ctx.strokeStyle = '#1e293b';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    // 2. Ribbed/toothed timing track texture along belt
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#64748b';
    ctx.setLineDash([5, 4]);
    ctx.lineDashOffset = animOffset || 0;
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.restore();
  };

  /**
   * Render Cam Profile with accurate geometry, apex lobe, and brass mounting hub.
   */
  SpriteRenderer.prototype.drawCam = function(ctx, cx, cy, angle, profileType, baseRadius, lift, options) {
    baseRadius = baseRadius || 35;
    lift = lift !== undefined ? lift : 20;
    options = options || {};

    var Math2D = (typeof window !== 'undefined' && window.Math2D) || (typeof global !== 'undefined' && global.Math2D);
    if (!Math2D) return;

    var pts = Math2D.getCamPoints(profileType, baseRadius, lift, 72, options);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle || 0);

    // 1. Draw cam contour
    ctx.beginPath();
    for (var i = 0; i < pts.length; i++) {
      if (i === 0) ctx.moveTo(pts[i][0], pts[i][1]);
      else ctx.lineTo(pts[i][0], pts[i][1]);
    }
    ctx.closePath();

    // Solid steel body
    ctx.fillStyle = '#64748b';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#1e293b';
    ctx.stroke();

    // 2. Perimeter bevel guideline
    ctx.beginPath();
    for (var j = 0; j < pts.length; j++) {
      var bx = pts[j][0] * 0.90;
      var by = pts[j][1] * 0.90;
      if (j === 0) ctx.moveTo(bx, by);
      else ctx.lineTo(bx, by);
    }
    ctx.closePath();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.stroke();

    // 3. Timing mark at apex (0 deg)
    var apexR = Math2D.getCamRadius(profileType, 0, baseRadius, lift, options);
    ctx.beginPath();
    ctx.moveTo(apexR - 6, 0);
    ctx.lineTo(apexR, 0);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ef4444';
    ctx.stroke();

    // 4. Central mounting hub & keyway
    ctx.beginPath();
    ctx.arc(0, 0, baseRadius * 0.35, 0, Math.PI * 2);
    ctx.fillStyle = '#d97706';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#92400e';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, baseRadius * 0.18, 0, Math.PI * 2);
    ctx.fillStyle = '#0f172a';
    ctx.fill();

    ctx.restore();
  };

  /**
   * Render mechanical axle (concentric collar or drive shaft).
   */
  SpriteRenderer.prototype.drawAxle = function(ctx, x1, y1, x2, y2, options) {
    options = options || {};
    var isConcentric = Math.hypot(x2 - x1, y2 - y1) < 1.0;

    ctx.save();
    if (isConcentric) {
      // Concentric shaft collar with hex bolt
      ctx.beginPath();
      ctx.arc(x1, y1, 14, 0, Math.PI * 2);
      ctx.fillStyle = '#b45309';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#78350f';
      ctx.stroke();

      // Hex set screw
      ctx.beginPath();
      ctx.arc(x1 + 8, y1, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#334155';
      ctx.fill();
    } else {
      // Drive shaft connecting two nodes
      var angle = Math.atan2(y2 - y1, x2 - x1);
      var len = Math.hypot(x2 - x1, y2 - y1);

      ctx.translate(x1, y1);
      ctx.rotate(angle);

      // Shaft tube
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(0, -5, len, 10);
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(0, -5, len, 10);

      // Couplings at ends
      ctx.fillStyle = '#475569';
      ctx.fillRect(-2, -9, 8, 18);
      ctx.fillRect(len - 6, -9, 8, 18);
      ctx.strokeStyle = '#0f172a';
      ctx.strokeRect(-2, -9, 8, 18);
      ctx.strokeRect(len - 6, -9, 8, 18);
    }
    ctx.restore();
  };
  SpriteRenderer.prototype.drawTracePaths = function(ctx, trackedSet) {
    ctx.save();
    for (var id in this.traces) {
      var pts = this.traces[id];
      if (pts.length < 2) continue;
      var isExplicit = trackedSet && trackedSet.has && trackedSet.has(parseInt(id, 10));
      if (!this.showTraces && !isExplicit) continue;
      var color = TrackColors[parseInt(id, 10) % TrackColors.length] || 'rgba(239, 68, 68, 0.85)';
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (var i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = color;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
    ctx.restore();
  };

  /**
   * Render dynamic velocity vector arrow indicating speed and direction.
   */
  SpriteRenderer.prototype.drawVelocityVector = function(ctx, x, y, vx, vy) {
    var speed = Math.hypot(vx, vy);
    if (speed < 1.0) return;

    var scale = 0.15; // arrow scaling
    var arrowLen = Math.min(60, speed * scale);
    var angle = Math.atan2(vy, vx);

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(arrowLen, 0);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#0284c7';
    ctx.stroke();

    // Arrow head
    ctx.beginPath();
    ctx.moveTo(arrowLen, 0);
    ctx.lineTo(arrowLen - 6, -4);
    ctx.lineTo(arrowLen - 6, 4);
    ctx.closePath();
    ctx.fillStyle = '#0284c7';
    ctx.fill();

    // Speed badge (mm/s)
    ctx.rotate(-angle);
    ctx.font = '9px monospace';
    ctx.fillStyle = '#0369a1';
    ctx.fillText(Math.round(speed) + ' mm/s', arrowLen * Math.cos(angle) + 4, arrowLen * Math.sin(angle) - 4);

    ctx.restore();
  };

  /**
   * Render link physical dimension label in SI millimeters.
   */
  SpriteRenderer.prototype.drawDimensionLabel = function(ctx, x1, y1, x2, y2, lengthMm) {
    var midX = (x1 + x2) / 2;
    var midY = (y1 + y2) / 2;
    var text = (lengthMm * this.unitScale).toFixed(1) + ' mm';

    ctx.save();
    ctx.font = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    var textW = ctx.measureText(text).width;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.fillRect(midX - textW / 2 - 3, midY - 7, textW + 6, 14);
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1;
    ctx.strokeRect(midX - textW / 2 - 3, midY - 7, textW + 6, 14);

    ctx.fillStyle = '#1e293b';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, midX, midY);
    ctx.restore();
  };

  /**
   * Render physical SI engineering scale ruler on canvas.
   */
  SpriteRenderer.prototype.drawScaleRuler = function(ctx, canvasWidth, canvasHeight, zoom) {
    // Determine reasonable bar length in mm: 10, 20, 50, 100, 200, 500 mm
    var targetPixelW = 100;
    var rawMm = targetPixelW / (zoom * this.unitScale);
    var stepOptions = [5, 10, 20, 50, 100, 200, 500];
    var bestMm = stepOptions[0];
    for (var i = 0; i < stepOptions.length; i++) {
      if (stepOptions[i] <= rawMm * 1.5) bestMm = stepOptions[i];
    }

    var barPixelW = bestMm * zoom * this.unitScale;
    var marginX = 20;
    var marginY = canvasHeight - 20;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(marginX, marginY - 6);
    ctx.lineTo(marginX, marginY);
    ctx.lineTo(marginX + barPixelW, marginY);
    ctx.lineTo(marginX + barPixelW, marginY - 6);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#475569';
    ctx.stroke();

    ctx.font = '10px monospace';
    ctx.fillStyle = '#334155';
    ctx.textAlign = 'center';
    ctx.fillText(bestMm + ' mm', marginX + barPixelW / 2, marginY - 8);
    ctx.restore();
  };

  return SpriteRenderer;
});
