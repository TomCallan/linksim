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
    }
  };

  return Math2D;
});
