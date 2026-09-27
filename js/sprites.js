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

  function SpriteRenderer() {
    this.showStress = true;
    this.showTraces = true;
    this.maxTracePoints = 120;
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
   * Render dynamic capsule linkage with bushings and optional stress tint.
   */
  SpriteRenderer.prototype.drawCapsuleLink = function(ctx, x1, y1, x2, y2, width, stress, customColor) {
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
    if (this.showStress && stress > 0.005) {
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
   * Render motor actuation indicator (rotational arrow).
   */
  SpriteRenderer.prototype.drawMotorIndicator = function(ctx, cx, cy, radius, speed) {
    ctx.save();
    ctx.translate(cx, cy);

    ctx.beginPath();
    var r = radius * 0.7;
    var startAngle = 0;
    var endAngle = Math.PI * 1.5;
    var anticlockwise = speed < 0;
    ctx.arc(0, 0, r, startAngle, endAngle, anticlockwise);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#f59e0b';
    ctx.stroke();

    // Arrowhead
    var tipX = r * Math.cos(endAngle);
    var tipY = r * Math.sin(endAngle);
    var tangent = endAngle + (anticlockwise ? -Math.PI / 2 : Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - 7 * Math.cos(tangent - 0.5), tipY - 7 * Math.sin(tangent - 0.5));
    ctx.lineTo(tipX - 7 * Math.cos(tangent + 0.5), tipY - 7 * Math.sin(tangent + 0.5));
    ctx.closePath();
    ctx.fillStyle = '#f59e0b';
    ctx.fill();

    ctx.restore();
  };

  /**
   * Render coupler curve traces for tracked nodes.
   */
  SpriteRenderer.prototype.drawTracePaths = function(ctx) {
    if (!this.showTraces) return;
    ctx.save();
    for (var id in this.traces) {
      var pts = this.traces[id];
      if (pts.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (var i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.7)';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
    ctx.restore();
  };

  return SpriteRenderer;
});
