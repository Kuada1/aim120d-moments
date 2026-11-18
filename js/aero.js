/*
 * aero.js - AIM-120D body-axis aerodynamic force / moment model.
 *
 * Body frame O-xyz (SPEC section 1), right-handed:
 *   +x nose, +y right wing, +z down.
 *   Mx = roll  (+ = right wing down)
 *   My = pitch (+ = nose up)
 *   Mz = yaw   (+ = nose right)
 *
 * Control deflections are command angles in degrees and their positive sign
 * produces a positive moment on the same axis (SPEC section 2.2). Physically a
 * nose-up elevator command is trailing-edge-up; that geometry is not modelled.
 *
 * All moments are taken about the body axes at the centre of mass.
 * UMD: window.Aero in the browser, module.exports in Node (tests).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Aero = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DEG = Math.PI / 180;
  var DIAMETER = 0.178;

  // Reference quantities (SPEC 2.1).
  var CONST = {
    length: 3.66,          // m, overall length
    diameter: DIAMETER,    // m
    refArea: Math.PI * DIAMETER * DIAMETER / 4, // m^2
    refSpan: 0.526,        // m, roll reference length
    refLength: DIAMETER,   // m, pitch/yaw reference length
    mass: 152,             // kg
    Ixx: 0.45,             // kg*m^2
    Iyy: 155,              // kg*m^2
    Izz: 155               // kg*m^2
  };

  // Non-dimensional aerodynamic derivatives, per radian (SPEC 2.2).
  var DERIVATIVES = {
    CN_alpha: 14.0,   // normal-force slope
    CD0: 0.16,        // zero-lift drag
    Cm0: 0.004,       // zero-lift pitching-moment trim offset
    Cm_alpha: -2.20,  // pitch static stability (negative = stable)
    Cm_q: -1200,      // pitch damping
    Cm_de: 3.20,      // elevator effectiveness (+ = nose up)
    Cn_beta: 2.20,    // yaw static stability
    Cn_r: -1200,      // yaw damping
    Cn_dr: 3.20,      // rudder effectiveness (+ = nose right)
    Cl_da: 0.030,     // aileron roll effectiveness
    Cl_p: -2.00,      // roll damping
    Cl_beta: -0.010,  // dihedral / sideslip roll coupling
    Cl_dr: 0.012      // rudder roll coupling
  };

  // ISA constants and layer bases: geopotential altitude (m), base temperature
  // (K), base pressure (Pa), lapse rate (K/m). Valid 0-32 km, clamped to 25 km.
  var G0 = 9.80665;
  var R_AIR = 287.05287;
  var GAMMA = 1.4;
  var ISA_LAYERS = [
    { h: 0,     T: 288.15, p: 101325.0,  L: -0.0065 },
    { h: 11000, T: 216.65, p: 22632.06,  L: 0 },
    { h: 20000, T: 216.65, p: 5474.89,   L: 0.001 },
    { h: 32000, T: 228.65, p: 868.019,   L: 0.0028 }
  ];

  function isFiniteNumber(v) {
    return typeof v === 'number' && Number.isFinite(v);
  }

  // Finite-value guard: NaN / Infinity / non-numbers fall back to fallback.
  function toNumber(value, fallback) {
    return isFiniteNumber(value) ? value : (isFiniteNumber(fallback) ? fallback : 0);
  }

  function clamp(value, lo, hi) {
    return value < lo ? lo : (value > hi ? hi : value);
  }

  /**
   * International Standard Atmosphere, 0-25 km (clamped).
   * @param {number} altitudeM geometric/geopotential altitude, m
   * @returns {{h:number, T:number, p:number, rho:number, a:number}}
   *          h m, T K, p Pa, rho kg/m^3, a m/s (speed of sound)
   */
  function atmosphere(altitudeM) {
    var h = clamp(toNumber(altitudeM, 0), 0, 25000);

    var layer = ISA_LAYERS[0];
    for (var i = 0; i < ISA_LAYERS.length; i++) {
      if (h >= ISA_LAYERS[i].h) layer = ISA_LAYERS[i];
    }

    var dH = h - layer.h;
    var T = layer.T + layer.L * dH;
    var p;
    if (layer.L === 0) {
      p = layer.p * Math.exp(-G0 * dH / (R_AIR * layer.T));
    } else {
      p = layer.p * Math.pow(T / layer.T, -G0 / (layer.L * R_AIR));
    }

    var rho = p / (R_AIR * T);
    var a = Math.sqrt(GAMMA * R_AIR * T);
    return { h: h, T: T, p: p, rho: rho, a: a };
  }

  /**
   * Smooth stall attenuation factor for an incidence angle in degrees.
   * 1 for |angle| <= 18 deg, then 1 / (1 + ((|angle| - 18) / 8)^2):
   * 18 -> 1, 26 -> 0.5, 34 -> 0.2.
   */
  function stallFactor(angleDeg) {
    var angle = Math.abs(toNumber(angleDeg, 0));
    if (angle <= 18) return 1;
    var t = (angle - 18) / 8;
    return 1 / (1 + t * t);
  }

  /**
   * Full aerodynamic state at one point in the flight envelope.
   * @param {{mach?:number, altitude?:number, alphaDeg?:number, betaDeg?:number,
   *          deltaEDeg?:number, deltaRDeg?:number, deltaADeg?:number,
   *          rollRate?:number, pitchRate?:number, yawRate?:number}} input
   *        angles in degrees, body rates in rad/s
   * @returns {object} all numbers, see SPEC 2.4 (moments in N*m, accels rad/s^2)
   */
  function compute(input) {
    var src = (input && typeof input === 'object') ? input : {};

    // Input protection: non-finite -> 0, then clamp to the documented envelope.
    var mach = clamp(toNumber(src.mach, 0), 0, 6);
    var altitude = clamp(toNumber(src.altitude, 0), 0, 25000);
    var alphaDeg = clamp(toNumber(src.alphaDeg, 0), -40, 40);
    var betaDeg = clamp(toNumber(src.betaDeg, 0), -40, 40);
    var deltaEDeg = clamp(toNumber(src.deltaEDeg, 0), -30, 30);
    var deltaRDeg = clamp(toNumber(src.deltaRDeg, 0), -30, 30);
    var deltaADeg = clamp(toNumber(src.deltaADeg, 0), -30, 30);
    var rollRate = toNumber(src.rollRate, 0);   // rad/s
    var pitchRate = toNumber(src.pitchRate, 0); // rad/s
    var yawRate = toNumber(src.yawRate, 0);     // rad/s

    var atm = atmosphere(altitude);
    var V = mach * atm.a;
    var q = 0.5 * atm.rho * V * V;

    var alpha = alphaDeg * DEG;
    var beta = betaDeg * DEG;
    var stallAlpha = stallFactor(alphaDeg);
    var stallBeta = stallFactor(betaDeg);

    // Forces: normal force from alpha, drag held at the zero-lift value, lift
    // obtained by rotating the body-axis force into the wind frame.
    var CN = DERIVATIVES.CN_alpha * alpha * stallAlpha;
    var CD = DERIVATIVES.CD0;
    var CL = CN * Math.cos(alpha) - CD * Math.sin(alpha);

    // Non-dimensional body rates; skipped at V = 0 to avoid division blow-up.
    var hasFlow = V > 1e-3;
    var pitchRateNorm = hasFlow ? pitchRate * CONST.refLength / (2 * V) : 0;
    var yawRateNorm = hasFlow ? yawRate * CONST.refSpan / (2 * V) : 0;
    var rollRateNorm = hasFlow ? rollRate * CONST.refSpan / (2 * V) : 0;

    // Moments (SPEC 2.2 formulas). Static terms are stall-gated, controls are
    // not (simplification mandated by SPEC 2.4).
    var Cm = DERIVATIVES.Cm0
      + DERIVATIVES.Cm_alpha * alpha * stallAlpha
      + DERIVATIVES.Cm_de * deltaEDeg * DEG
      + DERIVATIVES.Cm_q * pitchRateNorm;

    var Cn = DERIVATIVES.Cn_beta * beta * stallBeta
      + DERIVATIVES.Cn_dr * deltaRDeg * DEG
      + DERIVATIVES.Cn_r * yawRateNorm;

    // Cl_beta is a sideslip coupling, not one of the two gated static terms.
    var Cl = DERIVATIVES.Cl_beta * beta
      + DERIVATIVES.Cl_da * deltaADeg * DEG
      + DERIVATIVES.Cl_dr * deltaRDeg * DEG
      + DERIVATIVES.Cl_p * rollRateNorm;

    var qS = q * CONST.refArea;
    var Mx = qS * CONST.refSpan * Cl;
    var My = qS * CONST.refLength * Cm;
    var Mz = qS * CONST.refLength * Cn;

    // Last-resort finite guard so the UI never receives NaN.
    function fin(v) { return Number.isFinite(v) ? v : 0; }

    return {
      mach: fin(mach),
      altitude: fin(altitude),
      V: fin(V),
      q: fin(q),
      rho: fin(atm.rho),
      a: fin(atm.a),
      alphaDeg: fin(alphaDeg),
      betaDeg: fin(betaDeg),
      CL: fin(CL),
      CD: fin(CD),
      CN: fin(CN),
      Cl: fin(Cl),
      Cm: fin(Cm),
      Cn: fin(Cn),
      Mx: fin(Mx),
      My: fin(My),
      Mz: fin(Mz),
      pDot: fin(Mx / CONST.Ixx),
      qDot: fin(My / CONST.Iyy),
      rDot: fin(Mz / CONST.Izz),
      stall: fin(Math.min(stallAlpha, stallBeta))
    };
  }

  return {
    CONST: CONST,
    atmosphere: atmosphere,
    compute: compute,
    stallFactor: stallFactor,
    DERIVATIVES: DERIVATIVES
  };
});
