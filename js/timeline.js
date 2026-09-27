/**
 * Playback & Timeline Scrubber Engine for Linksim.
 * Manages simulation state history, frame scrubbing, stepping, and speed.
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
  }

  Timeline.prototype.reset = function() {
    this.history = [];
    this.currentIndex = -1;
    this.recordInitialFrame();
    if (this.onFrameChanged) {
      this.onFrameChanged(this.currentIndex, this.history.length, this.isPlaying);
    }
  };

  Timeline.prototype.recordInitialFrame = function() {
    var snap = this.physics.getSnapshot();
    this.history = [snap];
    this.currentIndex = 0;
  };

  Timeline.prototype.update = function(dt) {
    if (!this.isPlaying) return;

    var actualDt = dt * this.speed;

    // If we scrubbed back into the past and pressed play, we can branch or truncate future
    if (this.currentIndex < this.history.length - 1) {
      this.history.length = this.currentIndex + 1;
    }

    // Step physics
    this.physics.step(actualDt);

    // Save snapshot
    var snap = this.physics.getSnapshot();
    if (this.history.length >= this.maxFrames) {
      this.history.shift();
    }
    this.history.push(snap);
    this.currentIndex = this.history.length - 1;

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
    if (this.currentIndex < this.history.length - 1) {
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
    }

    if (this.onFrameChanged) {
      this.onFrameChanged(this.currentIndex, this.history.length, this.isPlaying);
    }
  };

  Timeline.prototype.stepBackward = function() {
    this.pause();
    if (this.currentIndex > 0) {
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
