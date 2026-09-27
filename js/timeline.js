/**
 * Playback & Timeline Scrubber Engine for Linksim.
 * Manages simulation state history, frame scrubbing, stepping, speed,
 * and automatic periodic cycle loop detection & frame buffer playback caching.
 */
(function(root, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = factory();
  } else {
    root.Timeline = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  var MAX_HISTORY_FRAMES = 1800; // 30 seconds @ 60fps

  function Timeline(physics) {
    this.physics = physics;
    this.history = [];
    this.currentIndex = -1;
    this.isPlaying = true;
    this.speed = 1.0;
    this.maxFrames = MAX_HISTORY_FRAMES;
    this.onFrameChanged = null; // callback(currentIndex, totalFrames, isPlaying)

    // Loop detection & playback cache
    this.loopDetectionEnabled = true;
    this.loopCacheEnabled = true;
    this.loopDetected = false;
    this.loopStart = -1;
    this.loopEnd = -1;
    this.loopPeriod = 0;
    this.loopDuration = 0;
    this.isLoopPlayingFromCache = false;
    this.onLoopStatusChanged = null; // callback(loopInfo)
  }

  Timeline.prototype.reset = function() {
    this.history = [];
    this.currentIndex = -1;
    this.invalidateLoop();
    this.recordInitialFrame();
    if (this.onFrameChanged) {
      this.onFrameChanged(this.currentIndex, this.history.length, this.isPlaying);
    }
  };

  Timeline.prototype.invalidateLoop = function() {
    this.loopDetected = false;
    this.loopStart = -1;
    this.loopEnd = -1;
    this.loopPeriod = 0;
    this.loopDuration = 0;
    this.isLoopPlayingFromCache = false;
    if (this.onLoopStatusChanged) {
      this.onLoopStatusChanged(this.getLoopInfo());
    }
  };

  Timeline.prototype.getLoopInfo = function() {
    return {
      enabled: this.loopDetectionEnabled,
      caching: this.loopCacheEnabled,
      detected: this.loopDetected,
      startFrame: this.loopStart,
      endFrame: this.loopEnd,
      period: this.loopPeriod,
      duration: this.loopDuration,
      isPlayingFromCache: this.isLoopPlayingFromCache
    };
  };

  Timeline.prototype.setLoopCacheEnabled = function(enabled) {
    this.loopCacheEnabled = !!enabled;
    if (!this.loopCacheEnabled) {
      this.isLoopPlayingFromCache = false;
    }
    if (this.onLoopStatusChanged) {
      this.onLoopStatusChanged(this.getLoopInfo());
    }
  };

  Timeline.prototype.recordInitialFrame = function() {
    var snap = this.physics.getSnapshot();
    this.history = [snap];
    this.currentIndex = 0;
  };

  Timeline.prototype._checkLoop = function() {
    if (!this.loopDetectionEnabled || this.loopDetected) return;
    if (this.history.length < 30) return;

    var k = this.history.length - 1;
    var sk = this.history[k];
    var numNodes = sk.numNodes;
    if (numNodes === 0) return;

    // Verify system has real dynamic motion (not equilibrium/static)
    var isMoving = false;
    for (var i = 0; i < numNodes; i++) {
      if (Math.hypot(sk.vx[i], sk.vy[i]) > 0.8) {
        isMoving = true;
        break;
      }
    }
    if (!isMoving && this.physics && this.physics.motors) {
      for (var m = 0; m < this.physics.motors.length; m++) {
        if (this.physics.motors[m].active && Math.abs(this.physics.motors[m].speed) > 0.01) {
          isMoving = true;
          break;
        }
      }
    }
    if (!isMoving) return;

    var minPeriod = 20;
    var tolerance = 1.2; // Maximum node position displacement in pixels

    // Compare newest frame k with earlier frames j
    for (var j = 0; j <= k - minPeriod; j++) {
      var sj = this.history[j];
      if (sj.numNodes !== numNodes) continue;

      // 1. Spatial distance between all nodes
      var maxDist = 0;
      for (var i = 0; i < numNodes; i++) {
        var d = Math.hypot(sk.x[i] - sj.x[i], sk.y[i] - sj.y[i]);
        if (d > maxDist) {
          maxDist = d;
          if (maxDist > tolerance) break;
        }
      }
      if (maxDist > tolerance) continue;

      // 2. Velocity vector alignment check (ensures direction of travel matches and prevents self-intersecting false positives)
      var velocityAligned = true;
      for (var i = 0; i < numNodes; i++) {
        var spdK = Math.hypot(sk.vx[i], sk.vy[i]);
        var spdJ = Math.hypot(sj.vx[i], sj.vy[i]);
        if (spdK > 5 && spdJ > 5) {
          var dot = sk.vx[i] * sj.vx[i] + sk.vy[i] * sj.vy[i];
          var cosTheta = dot / (spdK * spdJ);
          if (cosTheta < 0.7) {
            velocityAligned = false;
            break;
          }
        }
      }
      if (!velocityAligned) continue;

      // 3. Motor angles (if any) must be in phase modulo 2*PI
      if (sk.motorAngles && sj.motorAngles) {
        var motorMatch = true;
        for (var m = 0; m < sk.motorAngles.length; m++) {
          var dAngle = Math.abs(sk.motorAngles[m] - sj.motorAngles[m]);
          var pAngle = Math.min(dAngle % (2 * Math.PI), (2 * Math.PI) - (dAngle % (2 * Math.PI)));
          if (pAngle > 0.08) {
            motorMatch = false;
            break;
          }
        }
        if (!motorMatch) continue;
      }

      // 4. Geneva wheel angles (if any) must be in phase modulo 2*PI
      if (sk.genevaAngles && sj.genevaAngles) {
        var genevaMatch = true;
        for (var gi = 0; gi < sk.genevaAngles.length; gi++) {
          var dGAngle = Math.abs(sk.genevaAngles[gi].angle - sj.genevaAngles[gi].angle);
          var pGAngle = Math.min(dGAngle % (2 * Math.PI), (2 * Math.PI) - (dGAngle % (2 * Math.PI)));
          if (pGAngle > 0.08) {
            genevaMatch = false;
            break;
          }
        }
        if (!genevaMatch) continue;
      }

      // Loop verified!
      this.loopDetected = true;
      this.loopStart = j;
      this.loopEnd = k;
      this.loopPeriod = k - j;
      this.loopDuration = (sk.time !== undefined && sj.time !== undefined) ? (sk.time - sj.time) : (this.loopPeriod / 60);

      if (this.onLoopStatusChanged) {
        this.onLoopStatusChanged(this.getLoopInfo());
      }
      break;
    }
  };

  Timeline.prototype.update = function(dt) {
    if (!this.isPlaying) return;

    // If loop is detected and loop caching is enabled, play directly from buffer!
    if (this.loopDetected && this.loopCacheEnabled && this.loopPeriod > 0) {
      this.isLoopPlayingFromCache = true;

      // Advance currentIndex inside the closed loop
      if (this.currentIndex < this.loopStart || this.currentIndex >= this.loopEnd - 1) {
        this.currentIndex = this.loopStart;
      } else {
        this.currentIndex++;
      }

      // Restore cached physics snapshot without computing XPBD sub-steps
      this.physics.restoreSnapshot(this.history[this.currentIndex]);

      if (this.onFrameChanged) {
        this.onFrameChanged(this.currentIndex, this.history.length, this.isPlaying);
      }
      return;
    }

    this.isLoopPlayingFromCache = false;
    var actualDt = dt * this.speed;

    // If we scrubbed back into the past and pressed play, we can branch or truncate future
    if (this.currentIndex < this.history.length - 1) {
      this.history.length = this.currentIndex + 1;
      this.invalidateLoop();
    }

    // Step physics
    this.physics.step(actualDt);

    // Save snapshot
    var snap = this.physics.getSnapshot();
    if (this.history.length >= this.maxFrames) {
      this.history.shift();
      if (this.loopDetected) {
        this.loopStart = Math.max(0, this.loopStart - 1);
        this.loopEnd = Math.max(0, this.loopEnd - 1);
      }
    }
    this.history.push(snap);
    this.currentIndex = this.history.length - 1;

    // Check for loop completion
    this._checkLoop();

    if (this.onFrameChanged) {
      this.onFrameChanged(this.currentIndex, this.history.length, this.isPlaying);
    }
  };

  Timeline.prototype.play = function() {
    this.isPlaying = true;
    if (this.onFrameChanged) {
      this.onFrameChanged(this.currentIndex, this.history.length, this.isPlaying);
    }
  };

  Timeline.prototype.pause = function() {
    this.isPlaying = false;
    if (this.onFrameChanged) {
      this.onFrameChanged(this.currentIndex, this.history.length, this.isPlaying);
    }
  };

  Timeline.prototype.togglePlay = function() {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  };

  Timeline.prototype.stepForward = function(dt) {
    dt = dt || (1 / 60);
    this.pause();

    if (this.loopDetected && this.loopCacheEnabled && this.loopPeriod > 0) {
      if (this.currentIndex < this.loopStart || this.currentIndex >= this.loopEnd - 1) {
        this.currentIndex = this.loopStart;
      } else {
        this.currentIndex++;
      }
      this.physics.restoreSnapshot(this.history[this.currentIndex]);
    } else if (this.currentIndex < this.history.length - 1) {
      this.currentIndex++;
      this.physics.restoreSnapshot(this.history[this.currentIndex]);
    } else {
      // Step new frame
      this.physics.step(dt * this.speed);
      var snap = this.physics.getSnapshot();
      if (this.history.length >= this.maxFrames) {
        this.history.shift();
      }
      this.history.push(snap);
      this.currentIndex = this.history.length - 1;
      this._checkLoop();
    }

    if (this.onFrameChanged) {
      this.onFrameChanged(this.currentIndex, this.history.length, this.isPlaying);
    }
  };

  Timeline.prototype.stepBackward = function() {
    this.pause();
    if (this.loopDetected && this.loopCacheEnabled && this.loopPeriod > 0) {
      if (this.currentIndex <= this.loopStart) {
        this.currentIndex = this.loopEnd - 1;
      } else {
        this.currentIndex--;
      }
      this.physics.restoreSnapshot(this.history[this.currentIndex]);
    } else if (this.currentIndex > 0) {
      this.currentIndex--;
      this.physics.restoreSnapshot(this.history[this.currentIndex]);
    }
    if (this.onFrameChanged) {
      this.onFrameChanged(this.currentIndex, this.history.length, this.isPlaying);
    }
  };

  Timeline.prototype.scrubTo = function(index) {
    if (this.history.length === 0) return;
    this.pause();
    index = Math.max(0, Math.min(this.history.length - 1, Math.round(index)));
    this.currentIndex = index;
    this.physics.restoreSnapshot(this.history[this.currentIndex]);

    if (this.onFrameChanged) {
      this.onFrameChanged(this.currentIndex, this.history.length, this.isPlaying);
    }
  };

  Timeline.prototype.setSpeed = function(multiplier) {
    this.speed = Math.max(0.1, Math.min(5.0, multiplier));
  };

  return Timeline;
});
