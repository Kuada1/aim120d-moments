/*!
 * charts.js — MomentChart
 * Dependency-free canvas-2D time-history plot for the AIM-120D moment study.
 * Swiss International Typographic Style: transparent canvas, hairline rules,
 * one accent trace, no chrome, no shadows.
 *
 * API
 *   var chart = new MomentChart(canvasEl, {
 *     color: '#D92B1F',   // data line colour
 *     minRange: 10,       // auto-range floor (N·m)
 *     maxSamples: 240,    // history length
 *     unit: 'N·m'    // only used by the top-right range label
 *   });
 *   chart.push(value);     // append one sample, redraw
 *   chart.setValue(value); // move the current-value marker only
 *   chart.resize();        // CSS size + devicePixelRatio aware
 *   chart.clear();         // drop history
 *   chart.draw();          // repaint
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MomentChart = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var PAPER = '#F1EFE9';
  var INK_GUIDE = 'rgba(20,20,20,0.06)';
  var INK_ZERO = 'rgba(20,20,20,0.28)';
  var INK_LABEL = 'rgba(20,20,20,0.42)';
  var FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

  var PAD_Y = 6;        // 6px air above/below the plot
  var PAD_X = 8;        // keeps the current-value dot inside the canvas
  var SMOOTH = 0.15;    // auto-range easing per paint
  var FILL_ALPHA = 0.06;
  var LINE_WIDTH = 1.5;
  var DOT_R = 3.2;
  var DOT_STROKE = 1.5;

  function finite(v, fallback) {
    var n = Number(v);
    return isFinite(n) ? n : fallback;
  }

  function formatRange(v) {
    // integer above 10 N·m, one decimal below
    return v >= 10 ? String(Math.round(v)) : (Math.round(v * 10) / 10).toFixed(1);
  }

  function MomentChart(canvas, opts) {
    if (!canvas || typeof canvas.getContext !== 'function') {
      throw new Error('MomentChart: a canvas element is required');
    }
    opts = opts || {};
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.color = opts.color || '#141414';
    this.paper = opts.paper || PAPER;
    this.minRange = Math.max(1e-6, finite(opts.minRange, 10));
    this.maxSamples = Math.max(2, Math.round(finite(opts.maxSamples, 240)));
    this.unit = opts.unit == null ? 'N·m' : String(opts.unit);

    this.history = [];
    this.maxAbs = 0;
    this.targetRange = this.minRange;
    this.range = null;      // eased display range
    this.current = 0;       // current-value marker
    this.hasCurrent = false;

    this.width = 0;         // CSS px
    this.height = 0;
    this.dpr = 1;
    this.resize();

    // stay sharp on viewport / zoom / DPR / layout changes; resize() stays public
    if (typeof window !== 'undefined') {
      var self = this;
      this._onResize = function () { self.resize(); };
      if (typeof window.addEventListener === 'function') {
        window.addEventListener('resize', this._onResize);
      }
      if (typeof window.ResizeObserver === 'function') {
        this._ro = new window.ResizeObserver(this._onResize);
        this._ro.observe(canvas);
      }
    }
  }

  /* --- data ------------------------------------------------------------ */

  MomentChart.prototype.push = function (value) {
    var v = finite(value, NaN);
    if (v !== v) return this;   // never poison the trace with NaN/Infinity
    this.history.push(v);
    if (this.history.length > this.maxSamples) this.history.shift();
    this.current = v;
    this.hasCurrent = true;
    this.draw();
    return this;
  };

  MomentChart.prototype.setValue = function (value) {
    this.current = finite(value, this.current);
    this.hasCurrent = true;
    this.draw();
    return this;
  };

  MomentChart.prototype.clear = function () {
    this.history.length = 0;
    this.maxAbs = 0;
    this.current = 0;
    this.hasCurrent = false;
    this.range = null;
    this.targetRange = this.minRange;
    this.draw();
    return this;
  };

  /* --- sizing ---------------------------------------------------------- */

  MomentChart.prototype.resize = function () {
    var c = this.canvas;
    var dpr = 1;
    if (typeof window !== 'undefined' && finite(window.devicePixelRatio, 0) > 0) {
      dpr = window.devicePixelRatio;
    }
    var rect = typeof c.getBoundingClientRect === 'function' ? c.getBoundingClientRect() : null;
    var cw = c.clientWidth || (rect ? rect.width : 0) || 0;
    var ch = c.clientHeight || (rect ? rect.height : 0) || 0;
    if (!(cw > 0)) cw = this.width;
    if (!(ch > 0)) ch = this.height;
    this.dpr = dpr;
    if (!(cw > 0) || !(ch > 0)) return this;  // not laid out yet

    this.width = cw;
    this.height = ch;
    var pw = Math.max(1, Math.round(cw * dpr));
    var ph = Math.max(1, Math.round(ch * dpr));
    if (c.width !== pw) c.width = pw;
    if (c.height !== ph) c.height = ph;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
    return this;
  };

  /* --- painting -------------------------------------------------------- */

  MomentChart.prototype.draw = function () {
    var ctx = this.ctx;
    var w = this.width;
    var h = this.height;
    var dpr = this.dpr;
    if (!ctx) return this;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);   // canvas stays transparent
    if (!(w > 0) || !(h > 0)) return this;

    var hist = this.history;
    var n = hist.length;
    var i, v, abs;

    // auto symmetric range: max(maxAbs * 1.18, minRange), eased
    var maxAbs = 0;
    for (i = 0; i < n; i++) {
      v = hist[i];
      abs = v < 0 ? -v : v;
      if (abs > maxAbs) maxAbs = abs;
    }
    this.maxAbs = maxAbs;
    var target = Math.max(maxAbs * 1.18, this.minRange);
    this.targetRange = target;
    var range;
    if (this.range == null) {
      range = this.range = target;           // first paint snaps
    } else {
      var delta = target - this.range;
      if (Math.abs(delta) <= 1e-6 * Math.max(1, target)) range = this.range = target;
      else range = this.range = this.range + delta * SMOOTH;
    }

    var cy = h / 2;
    var half = Math.max(1, h / 2 - PAD_Y);
    var rightX = Math.max(0.5, w - PAD_X);
    var step = n > 1 ? rightX / (n - 1) : 0;
    var scale = half / range;

    function py(val) { return cy - val * scale; }
    function px(idx) { return rightX - (n - 1 - idx) * step; }
    function hair(y) {
      var t = Math.max(1, Math.round(dpr));   // device px thickness of 1 CSS px
      return (t % 2 ? Math.floor(y * dpr) + 0.5 : Math.round(y * dpr)) / dpr;
    }

    // faint +-half-range guides (drawn first, they are the quietest marks)
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = INK_GUIDE;
    ctx.beginPath();
    var gTop = hair(py(range / 2));
    var gBot = hair(py(-range / 2));
    ctx.moveTo(0, gTop);
    ctx.lineTo(w, gTop);
    ctx.moveTo(0, gBot);
    ctx.lineTo(w, gBot);
    ctx.stroke();

    ctx.restore();

    var clipTop = Math.max(0, PAD_Y - 1);
    function clipPlot() {
      ctx.beginPath();
      ctx.rect(0, clipTop, w, h - clipTop * 2);
      ctx.clip();
    }

    // optional 6% wash between trace and zero rule (beneath the rules)
    if (n > 1) {
      ctx.save();
      clipPlot();
      ctx.beginPath();
      ctx.moveTo(px(0), cy);
      for (i = 0; i < n; i++) ctx.lineTo(px(i), py(hist[i]));
      ctx.lineTo(px(n - 1), cy);
      ctx.closePath();
      ctx.globalAlpha = FILL_ALPHA;
      ctx.fillStyle = this.color;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    // zero rule band: derived from the same hairline snap as the rule itself
    var zy = hair(cy);

    // the wash abuts the rule - punch its 1px band out (background-agnostic)
    // so the rule reads as one ink value instead of half-tinted
    if (n > 1) {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = '#000';
      ctx.fillRect(0, zy - 0.5, w, 1);
      ctx.restore();
    }

    // zero rule, edge to edge, above the wash so it stays crisp
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = INK_ZERO;
    ctx.beginPath();
    ctx.moveTo(0, zy);
    ctx.lineTo(w, zy);
    ctx.stroke();
    ctx.restore();

    // trace
    if (n > 0) {
      ctx.save();
      clipPlot();
      ctx.beginPath();
      for (i = 0; i < n; i++) {
        if (i === 0) ctx.moveTo(px(i), py(hist[i]));
        else ctx.lineTo(px(i), py(hist[i]));
      }
      ctx.lineWidth = LINE_WIDTH;
      ctx.strokeStyle = this.color;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.restore();
    }

    // current-value dot: accent fill with a paper-coloured ring
    if (n > 0 || this.hasCurrent) {
      var dotX = n > 0 ? px(n - 1) : rightX;
      var dotY = py(this.current);
      if (dotY < PAD_Y) dotY = PAD_Y;
      else if (dotY > h - PAD_Y) dotY = h - PAD_Y;
      ctx.beginPath();
      ctx.arc(dotX, dotY, DOT_R, 0, Math.PI * 2);
      ctx.fillStyle = this.color;
      ctx.fill();
      ctx.lineWidth = DOT_STROKE;
      ctx.strokeStyle = this.paper;
      ctx.stroke();
    }

    // top-right range label: 9px, tabular-ish, quiet ink
    ctx.font = '9px ' + FONT;
    ctx.fillStyle = INK_LABEL;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText('±' + formatRange(range) + ' ' + this.unit, w - 1, 1);

    return this;
  };

  return MomentChart;
});
