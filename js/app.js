/* AIM-120D MOMENT STUDY — app wiring, state, animation loop */
(function () {
  'use strict';
  var Aero = window.Aero;
  var MomentChart = window.MomentChart;
  var MissileScene = window.MissileScene;
  var $ = function (id) { return document.getElementById(id); };
  var DEG = Math.PI / 180;

  if (!Aero || !MomentChart || !MissileScene) {
    console.error('Missing dependency', { Aero: !!Aero, MomentChart: !!MomentChart, MissileScene: !!MissileScene });
    return;
  }

  var state = {
    mach: 0.85,
    altitude: 5000,
    alpha: 6,
    beta: 0,
    deltaE: 0,
    deltaR: 0,
    deltaA: 0
  };

  var PRESETS = {
    level: { alpha: 0, beta: 0, deltaE: 0, deltaR: 0, deltaA: 0 },
    pull: { alpha: 8, beta: 0, deltaE: 10, deltaR: 0, deltaA: 0 },
    yaw: { alpha: 2, beta: 12, deltaE: 0, deltaR: 8, deltaA: 0 },
    roll: { alpha: 2, beta: 0, deltaE: 0, deltaR: 0, deltaA: 12 },
    combo: { alpha: 8, beta: 8, deltaE: 6, deltaR: 5, deltaA: 8 }
  };
  var AUTO_ORDER = ['pull', 'yaw', 'roll', 'combo'];

  var rollAngle = 0;
  var tween = null;
  var auto = { on: false, idx: -1, next: 0 };
  var last = performance.now();
  var hudAcc = 0;
  var chartAcc = 0;
  var charts = null;
  var scene = null;
  var lastRes = null;

  // ---------- formatting
  function fmt(v, digits) {
    var s = Math.abs(v).toFixed(digits);
    if (parseFloat(s) === 0) return s;
    return (v < 0 ? '\u2212' : '') + s;
  }
  function fmtRate(v) {
    var s = Math.abs(v).toFixed(1);
    if (parseFloat(s) === 0) return s;
    return (v < 0 ? '\u2212' : '') + s;
  }

  // ---------- sliders
  var CTRL = [
    { id: 'mach', key: 'mach', out: 'mach-v', fmt: function (v) { return v.toFixed(2); } },
    { id: 'altitude', key: 'altitude', out: 'altitude-v', fmt: function (v) { return (v / 1000).toFixed(1); } },
    { id: 'alpha', key: 'alpha', out: 'alpha-v', fmt: function (v) { return v.toFixed(1); } },
    { id: 'beta', key: 'beta', out: 'beta-v', fmt: function (v) { return v.toFixed(1); } },
    { id: 'deltaE', key: 'deltaE', out: 'deltaE-v', fmt: function (v) { return v.toFixed(1); } },
    { id: 'deltaR', key: 'deltaR', out: 'deltaR-v', fmt: function (v) { return v.toFixed(1); } },
    { id: 'deltaA', key: 'deltaA', out: 'deltaA-v', fmt: function (v) { return v.toFixed(1); } }
  ];
  var els = {};

  function paintSlider(el) {
    var min = parseFloat(el.min), max = parseFloat(el.max), v = parseFloat(el.value);
    el.style.setProperty('--p', ((v - min) / (max - min) * 100).toFixed(2) + '%');
  }
  function syncSlider(c) {
    var el = els[c.id];
    el.value = state[c.key];
    els[c.out].textContent = c.fmt(state[c.key]);
    paintSlider(el);
  }
  function setStateValue(key, value) {
    state[key] = value;
    for (var i = 0; i < CTRL.length; i++) {
      if (CTRL[i].key === key) { syncSlider(CTRL[i]); break; }
    }
  }

  function stopAuto() {
    if (!auto.on) return;
    auto.on = false;
    $('auto-btn').classList.remove('on');
    var pb = document.querySelectorAll('.presets button[data-preset]:not([data-preset="auto"])');
    for (var i = 0; i < pb.length; i++) pb[i].classList.remove('on');
  }

  function setPreset(name, instant) {
    var p = PRESETS[name];
    if (!p) return;
    if (instant) {
      tween = null;
      for (var k in p) setStateValue(k, p[k]);
    } else {
      var from = {};
      for (var k2 in p) from[k2] = state[k2];
      tween = { from: from, to: p, t0: performance.now(), dur: 780 };
    }
    var pb = document.querySelectorAll('.presets button[data-preset]:not([data-preset="auto"])');
    for (var i = 0; i < pb.length; i++) pb[i].classList.toggle('on', pb[i].getAttribute('data-preset') === name);
  }

  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

  function applyTween(now) {
    if (!tween) return;
    var k = Math.min(1, (now - tween.t0) / tween.dur);
    var e = easeOutCubic(k);
    for (var key in tween.to) {
      setStateValue(key, tween.from[key] + (tween.to[key] - tween.from[key]) * e);
    }
    if (k >= 1) tween = null;
  }

  function startAuto() {
    auto.on = true;
    auto.idx = -1;
    auto.next = 0;
    $('auto-btn').classList.add('on');
  }

  // ---------- quasi-static moments + damping-balanced steady rates
  function computeRates(res) {
    var D = Aero.DERIVATIVES, C = Aero.CONST, V = res.V;
    var a = state.alpha * DEG, b = state.beta * DEG;
    var de = state.deltaE * DEG, dr = state.deltaR * DEG, da = state.deltaA * DEG;
    var Cl0 = D.Cl_beta * b + D.Cl_da * da + D.Cl_dr * dr;
    var Cm0 = D.Cm0 + D.Cm_alpha * a + D.Cm_de * de;
    var Cn0 = D.Cn_beta * b + D.Cn_dr * dr;
    return {
      p: V > 1 ? -Cl0 * 2 * V / (D.Cl_p * C.refSpan) : 0,
      q: V > 1 ? -Cm0 * 2 * V / (D.Cm_q * C.refLength) : 0,
      r: V > 1 ? -Cn0 * 2 * V / (D.Cn_r * C.refSpan) : 0
    };
  }

  // ---------- HUD
  function updateHUD(res, rates) {
    $('mx').textContent = fmt(res.Mx, 1);
    $('my').textContent = fmt(res.My, 1);
    $('mz').textContent = fmt(res.Mz, 1);
    $('cl').textContent = fmt(res.Cl, 4);
    $('cm').textContent = fmt(res.Cm, 4);
    $('cn').textContent = fmt(res.Cn, 4);
    $('vinf').textContent = Math.round(res.V);
    $('qinf').textContent = (res.q / 1000).toFixed(1);

    $('wx').textContent = fmt(rates.p / DEG, 1);
    $('wy').textContent = fmt(rates.q / DEG, 1);
    $('wz').textContent = fmt(rates.r / DEG, 1);
  }

  // ---------- init
  function init() {
    // masthead height -> stage height
    function measure() {
      var m = document.querySelector('.masthead');
      document.documentElement.style.setProperty('--mast-h', m.offsetHeight + 'px');
    }
    measure();

    scene = new MissileScene($('gl'), $('labels'));
    charts = {
      x: new MomentChart($('chart-x'), { color: '#DE9E0A', minRange: 3, maxSamples: 220, unit: 'N\u00b7m' }),
      y: new MomentChart($('chart-y'), { color: '#D92B1F', minRange: 60, maxSamples: 220, unit: 'N\u00b7m' }),
      z: new MomentChart($('chart-z'), { color: '#1B3FA8', minRange: 60, maxSamples: 220, unit: 'N\u00b7m' })
    };

    // bind sliders
    for (var i = 0; i < CTRL.length; i++) {
      (function (c) {
        var el = $(c.id);
        els[c.id] = el;
        els[c.out] = $(c.out);
        state[c.key] = parseFloat(el.value);
        el.addEventListener('input', function () {
          stopAuto();
          tween = null;
          state[c.key] = parseFloat(el.value);
          els[c.out].textContent = c.fmt(state[c.key]);
          paintSlider(el);
        });
        paintSlider(el);
        els[c.out].textContent = c.fmt(state[c.key]);
      })(CTRL[i]);
    }

    // preset buttons
    var pb = document.querySelectorAll('.presets button[data-preset]');
    for (var j = 0; j < pb.length; j++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          var name = btn.getAttribute('data-preset');
          if (name === 'auto') {
            if (auto.on) stopAuto(); else startAuto();
          } else {
            stopAuto();
            setPreset(name, false);
          }
        });
      })(pb[j]);
    }

    // views
    var vb = document.querySelectorAll('.vp-views button[data-view]');
    for (var k = 0; k < vb.length; k++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          var name = btn.getAttribute('data-view');
          scene.setView(name);
          for (var m = 0; m < vb.length; m++) vb[m].classList.toggle('on', vb[m] === btn);
        });
      })(vb[k]);
    }

    // query params (deterministic screenshots / deep links)
    var qs = new URLSearchParams(location.search);
    if (qs.get('alpha') !== null) setStateValue('alpha', parseFloat(qs.get('alpha')));
    if (qs.get('beta') !== null) setStateValue('beta', parseFloat(qs.get('beta')));
    if (qs.get('de') !== null) setStateValue('deltaE', parseFloat(qs.get('de')));
    if (qs.get('dr') !== null) setStateValue('deltaR', parseFloat(qs.get('dr')));
    if (qs.get('da') !== null) setStateValue('deltaA', parseFloat(qs.get('da')));
    if (qs.get('mach') !== null) setStateValue('mach', parseFloat(qs.get('mach')));
    if (qs.get('alt') !== null) setStateValue('altitude', parseFloat(qs.get('alt')));
    if (qs.get('roll') !== null) rollAngle = parseFloat(qs.get('roll')) * DEG;
    if (qs.get('preset')) setPreset(qs.get('preset'), true);
    if (qs.get('view')) scene.setView(qs.get('view'));
    if (qs.get('static') === '1') {
      stopAuto();
    }

    // resize
    var resizeTimer = 0;
    function onResize() {
      measure();
      scene.resize();
      charts.x.resize(); charts.y.resize(); charts.z.resize();
    }
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(onResize, 80);
    });
    onResize();

    last = performance.now();
    window.__APP = { scene: scene, charts: charts, state: state, aero: Aero, getLast: function () { return lastRes; } };
    requestAnimationFrame(tick);
  }

  // ---------- loop
  function tick(now) {
    requestAnimationFrame(tick);
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (dt < 0) dt = 0;

    applyTween(now);

    if (auto.on && now >= auto.next) {
      auto.idx = (auto.idx + 1) % AUTO_ORDER.length;
      setPreset(AUTO_ORDER[auto.idx], false);
      auto.next = now + 5400;
    }

    var res = Aero.compute({
      mach: state.mach,
      altitude: state.altitude,
      alphaDeg: state.alpha,
      betaDeg: state.beta,
      deltaEDeg: state.deltaE,
      deltaRDeg: state.deltaR,
      deltaADeg: state.deltaA
    });
    var rates = computeRates(res);

    // roll is the only axis free to rotate without changing alpha/beta:
    // animate it at the damping-balanced steady rate implied by Mx.
    rollAngle += Math.max(-6, Math.min(6, rates.p)) * dt;
    if (rollAngle > Math.PI * 2) rollAngle -= Math.PI * 2;
    if (rollAngle < -Math.PI * 2) rollAngle += Math.PI * 2;

    scene.setState({
      Mx: res.Mx, My: res.My, Mz: res.Mz,
      alpha: state.alpha, beta: state.beta,
      rollAngle: rollAngle,
      vInf: res.V
    });
    scene.render(dt);

    hudAcc += dt;
    if (hudAcc > 1 / 30) { updateHUD(res, rates); hudAcc = 0; }
    lastRes = res;
    chartAcc += dt;
    if (chartAcc > 0.05) {
      charts.x.push(res.Mx);
      charts.y.push(res.My);
      charts.z.push(res.Mz);
      chartAcc = 0;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
