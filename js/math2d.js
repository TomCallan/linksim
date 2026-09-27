/**
 * Zero-allocation 2D vector and geometry utilities for Linksim.
 */
(function(root, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = factory();
  } else {
    root.Math2D = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  var Math2D = {
    distSq: function(x1, y1, x2, y2) {
      var dx = x2 - x1;
      var dy = y2 - y1;
      return dx * dx + dy * dy;
    },

    dist: function(x1, y1, x2, y2) {
      return Math.sqrt(Math2D.distSq(x1, y1, x2, y2));
    },

    dot: function(x1, y1, x2, y2) {
      return x1 * x2 + y1 * y2;
    },

    cross: function(x1, y1, x2, y2) {
      return x1 * y2 - y1 * x2;
    },

    normalize: function(x, y, out) {
      var len = Math.hypot(x, y);
      if (len > 1e-12) {
        out[0] = x / len;
        out[1] = y / len;
      } else {
        out[0] = 0;
        out[1] = 0;
      }
      return out;
    },

    rotate: function(x, y, angle, out) {
      var cos = Math.cos(angle);
      var sin = Math.sin(angle);
      out[0] = x * cos - y * sin;
      out[1] = x * sin + y * cos;
      return out;
    },

    projectPointOnLine: function(px, py, ax, ay, bx, by, out) {
      var abx = bx - ax;
      var aby = by - ay;
      var lenSq = abx * abx + aby * aby;
      if (lenSq < 1e-12) {
        out[0] = ax;
        out[1] = ay;
        out[2] = 0;
        return out;
      }
      var apx = px - ax;
      var apy = py - ay;
      var t = (apx * abx + apy * aby) / lenSq;
      out[0] = ax + t * abx;
      out[1] = ay + t * aby;
      out[2] = t; // parameter along AB
      return out;
    },

    clamp: function(val, min, max) {
      return val < min ? min : (val > max ? max : val);
    },

    normalizeAngle: function(a) {
      var twoPi = Math.PI * 2;
      a = a % twoPi;
      if (a > Math.PI) a -= twoPi;
      if (a < -Math.PI) a += twoPi;
      return a;
    },

    /**
     * Compute exact meshing angle of gear 2 given gear 1 and their centers.
     * The tooth of gear 1 meshes into the tooth root space of gear 2.
     */
    calcMeshedAngle: function(c1x, c1y, teeth1, angle1, c2x, c2y, teeth2) {
      // Angle of line of centers from gear 1 to gear 2
      var phi = Math.atan2(c2y - c1y, c2x - c1x);
      // Tooth pitch for gear 2
      var pitch2 = (Math.PI * 2) / teeth2;
      // Ratio
      var ratio = -teeth1 / teeth2;
      // Phase at contact point
      var relAngle1 = angle1 - phi;
      var targetAngle2 = ratio * relAngle1 + (phi + Math.PI) + (pitch2 * 0.5);
      return Math2D.normalizeAngle(targetAngle2);
    },

    /**
     * Compute common external (open belt) or internal (crossed belt) tangents between two circles.
     * Returns { p1a: [x,y], p2a: [x,y], p1b: [x,y], p2b: [x,y], arc1Start, arc1End, arc2Start, arc2End }
     */
    circleTangents: function(c1x, c1y, r1, c2x, c2y, r2, crossed) {
      var dx = c2x - c1x;
      var dy = c2y - c1y;
      var d = Math.hypot(dx, dy);
      if (d < 1e-6) return null;

      var centerAngle = Math.atan2(dy, dx);

      if (!crossed) {
        // Open belt: external tangents
        var dr = r1 - r2;
        if (d <= Math.abs(dr)) return null; // One circle inside other

        var beta = Math.acos(dr / d);
        var a1 = centerAngle + beta;
        var a2 = centerAngle - beta;

        return {
          p1a: [c1x + r1 * Math.cos(a1), c1y + r1 * Math.sin(a1)],
          p2a: [c2x + r2 * Math.cos(a1), c2y + r2 * Math.sin(a1)],
          p1b: [c1x + r1 * Math.cos(a2), c1y + r1 * Math.sin(a2)],
          p2b: [c2x + r2 * Math.cos(a2), c2y + r2 * Math.sin(a2)],
          a1: a1,
          a2: a2,
          crossed: false
        };
      } else {
        // Crossed belt: internal tangents
        var sr = r1 + r2;
        if (d <= sr) return null; // Overlapping circles

        var beta = Math.acos(sr / d);
        var a1 = centerAngle + beta;
        var a2 = centerAngle - beta;

        return {
          p1a: [c1x + r1 * Math.cos(a1), c1y + r1 * Math.sin(a1)],
          p2a: [c2x + r2 * Math.cos(a1 + Math.PI), c2y + r2 * Math.sin(a1 + Math.PI)],
          p1b: [c1x + r1 * Math.cos(a2), c1y + r1 * Math.sin(a2)],
          p2b: [c2x + r2 * Math.cos(a2 - Math.PI), c2y + r2 * Math.sin(a2 - Math.PI)],
          a1: a1,
          a2: a2,
          crossed: true
        };
      }
    },

    /**
     * Compute cam profile radius at local angle theta (radians, 0 = apex).
     */
    getCamRadius: function(profileType, theta, baseRadius, lift, options) {
      theta = Math2D.normalizeAngle(theta);
      baseRadius = baseRadius || 30;
      lift = lift || 20;
      options = options || {};

      switch (profileType) {
        case 'eccentric':
          var e = lift * 0.5;
          var R = baseRadius + e;
          var sinT = Math.sin(theta);
          var discr = R * R - e * e * sinT * sinT;
          return e * Math.cos(theta) + Math.sqrt(Math.max(0, discr));

        case 'pear':
          // Standard engineering teardrop / valve cam
          // Lobe span is typically 120 degrees (+/- 60 degrees from apex)
          var lobeHalf = (options.lobeAngle || 65) * (Math.PI / 180);
          var absT = Math.abs(theta);
          if (absT >= lobeHalf) {
            return baseRadius;
          }
          // Cycloidal harmonic rise
          var u = absT / lobeHalf;
          var lobeProfile = 0.5 * (1 + Math.cos(Math.PI * u));
          return baseRadius + lift * lobeProfile;

        case 'snail':
          // Archimedean spiral with sudden drop at theta = 0 / 2pi
          var phi = theta;
          if (phi < 0) phi += Math.PI * 2;
          return baseRadius + lift * (phi / (Math.PI * 2));

        case 'heart':
          // Uniform velocity cardioid cam
          var absT2 = Math.abs(theta);
          return baseRadius + lift * (1.0 - absT2 / Math.PI);

        case 'custom':
          // Custom vector polygon profile defined by points [[x, y], ...]
          var pts = options.points;
          if (!pts || pts.length < 3) return baseRadius;
          var dx = Math.cos(theta);
          var dy = Math.sin(theta);
          var maxDist = 0;
          var nPts = pts.length;
          for (var i = 0; i < nPts; i++) {
            var j = (i + 1) % nPts;
            var x1 = pts[i][0], y1 = pts[i][1];
            var x2 = pts[j][0], y2 = pts[j][1];
            var ex = x2 - x1, ey = y2 - y1;
            // Solve: [dx -ex; dy -ey] * [s; t] = [x1; y1]
            var det = dx * (-ey) - dy * (-ex);
            if (Math.abs(det) > 1e-9) {
              var s = (x1 * (-ey) - y1 * (-ex)) / det;
              var t = (dx * y1 - dy * x1) / det;
              if (s > 0 && t >= 0 && t <= 1) {
                if (s > maxDist) maxDist = s;
              }
            }
          }
          return maxDist > 0 ? maxDist : baseRadius;

        case 'geneva':
          var gSlots = options.slots || 4;
          var gCenterDist = options.centerDistance || (baseRadius * Math.SQRT2);
          var gSlotWidth = options.slotWidth || (baseRadius * 0.13);
          var genevaPts = Math2D.getGenevaPoints(gSlots, baseRadius, gCenterDist, gSlotWidth, options);
          return Math2D.getCamRadius('custom', theta, baseRadius, lift, { points: genevaPts });

        case 'circle':
        default:
          return baseRadius;
      }
    },

    /**
     * Compute mathematically exact 2D vector polygon of a Maltese cross / Geneva wheel.
     */
    getGenevaPoints: function(slots, radius, centerDistance, slotWidth, options) {
      slots = slots || 4;
      radius = radius || 84.85;
      centerDistance = centerDistance || (radius * Math.SQRT2);
      slotWidth = slotWidth || 11;
      options = options || {};

      var halfW = slotWidth * 0.5;
      var dTheta = (Math.PI * 2) / slots;

      var crankRadius = centerDistance * Math.sin(Math.PI / slots);
      var slotDepth = crankRadius + radius - centerDistance;
      if (slotDepth <= 0) slotDepth = radius * 0.55;
      var slotBottomR = Math.max(radius * 0.25, radius - slotDepth);

      var pts = [];

      for (var k = 0; k < slots; k++) {
        var phi = k * dTheta;
        var ux = Math.cos(phi), uy = Math.sin(phi);
        var nx = -uy, ny = ux;

        // 1. Enter slot at trailing wall
        pts.push([Math.round((radius * ux - halfW * nx) * 10) / 10, Math.round((radius * uy - halfW * ny) * 10) / 10]);

        // 2. Down to bottom of slot
        pts.push([Math.round((slotBottomR * ux - halfW * nx) * 10) / 10, Math.round((slotBottomR * uy - halfW * ny) * 10) / 10]);

        // 3. Semicircular bottom arc
        var numArcSteps = 6;
        for (var a = 1; a < numArcSteps; a++) {
          var alpha = -Math.PI / 2 + (a / numArcSteps) * Math.PI;
          var du = -halfW * Math.cos(alpha);
          var dn = halfW * Math.sin(alpha);
          var bx = slotBottomR * ux + du * ux + dn * nx;
          var by = slotBottomR * uy + du * uy + dn * ny;
          pts.push([Math.round(bx * 10) / 10, Math.round(by * 10) / 10]);
        }

        // 4. Up leading wall to exit
        pts.push([Math.round((slotBottomR * ux + halfW * nx) * 10) / 10, Math.round((slotBottomR * uy + halfW * ny) * 10) / 10]);
        pts.push([Math.round((radius * ux + halfW * nx) * 10) / 10, Math.round((radius * uy + halfW * ny) * 10) / 10]);

        // 5. Exact concave circular locking cutout between slot k and slot k+1
        var midA = phi + dTheta * 0.5;
        var arcCx = centerDistance * Math.cos(midA);
        var arcCy = centerDistance * Math.sin(midA);
        var pExitX = radius * ux + halfW * nx;
        var pExitY = radius * uy + halfW * ny;
        var rCutout = Math.hypot(pExitX - arcCx, pExitY - arcCy);

        var nextPhi = (k + 1) * dTheta;
        var nextUx = Math.cos(nextPhi), nextUy = Math.sin(nextPhi);
        var nextNx = -nextUy, nextNy = nextUx;
        var pNextEnterX = radius * nextUx - halfW * nextNx;
        var pNextEnterY = radius * nextUy - halfW * nextNy;

        var aStart = Math.atan2(pExitY - arcCy, pExitX - arcCx);
        var aEnd = Math.atan2(pNextEnterY - arcCy, pNextEnterX - arcCx);
        var dArc = aEnd - aStart;
        while (dArc < -Math.PI) dArc += Math.PI * 2;
        while (dArc > Math.PI) dArc -= Math.PI * 2;

        var numCutoutSteps = 8;
        for (var c = 1; c < numCutoutSteps; c++) {
          var curA = aStart + dArc * (c / numCutoutSteps);
          var px = arcCx + rCutout * Math.cos(curA);
          var py = arcCy + rCutout * Math.sin(curA);
          pts.push([Math.round(px * 10) / 10, Math.round(py * 10) / 10]);
        }
      }
      return pts;
    },

    /**
     * Generate 2D contour points of a cam profile in local coordinates.
     */
    getCamPoints: function(profileType, baseRadius, lift, numPoints, options) {
      options = options || {};
      if (profileType === 'custom' && options.points && options.points.length >= 3) {
        return options.points;
      }
      if (profileType === 'geneva') {
        var gSlots = options.slots || 4;
        var gCenterDist = options.centerDistance || (baseRadius * Math.SQRT2);
        var gSlotWidth = options.slotWidth || (baseRadius * 0.13);
        return Math2D.getGenevaPoints(gSlots, baseRadius, gCenterDist, gSlotWidth, options);
      }
      numPoints = numPoints || 72;
      var pts = [];
      var dTheta = (Math.PI * 2) / numPoints;
      for (var i = 0; i < numPoints; i++) {
        var a = i * dTheta - Math.PI;
        var r = Math2D.getCamRadius(profileType, a, baseRadius, lift, options);
        pts.push([r * Math.cos(a), r * Math.sin(a)]);
      }
      return pts;
    }
  };

  return Math2D;
});
