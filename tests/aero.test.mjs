// tests/aero.test.mjs - acceptance tests for js/aero.js (SPEC section 2.5).
//
// Run from the project root:  node tests/aero.test.mjs
// Exit code 0 = every check passed. No external dependencies, no npm packages.
//
// The shipped model is a UMD file, so the test exercises the load paths that
// matter: an explicit CommonJS sandbox (module.exports) and a browser-like
// sandbox (window/globalThis gets Aero from a classic <script> tag).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const here = path.dirname(fileURLToPath(import.meta.url));
const aeroPath = path.join(here, '..', 'js', 'aero.js');
const source = readFileSync(aeroPath, 'utf8');

// Evaluate the shipped source inside a sandbox that mimics one loader.
function loadInSandbox(src, mode) {
  const sandbox = { console };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  if (mode === 'commonjs') {
    sandbox.module = { exports: {} };
    sandbox.exports = sandbox.module.exports;
  }
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'js/aero.js' });
  return mode === 'commonjs' ? sandbox.module.exports : sandbox.Aero;
}

function loadAero() {
  // 1) Plain require (works when Node resolves the file as CommonJS).
  try {
    const req = createRequire(import.meta.url);
    const mod = req('../js/aero.js');
    if (mod && typeof mod.compute === 'function') {
      return { aero: mod, via: 'require()' };
    }
  } catch (err) {
    // Node may refuse to require an ES module; fall through.
  }
  // 2) UMD global side effect, the same branch a browser <script> takes.
  if (typeof globalThis.Aero === 'object' && globalThis.Aero &&
      typeof globalThis.Aero.compute === 'function') {
    return { aero: globalThis.Aero, via: 'UMD global globalThis.Aero' };
  }
  // 3) Explicit CommonJS sandbox: deterministic regardless of ambient config.
  return { aero: loadInSandbox(source, 'commonjs'), via: 'CommonJS sandbox (vm)' };
}

const loaded = loadAero();
const Aero = loaded.aero;
const { CONST, DERIVATIVES, atmosphere, compute, stallFactor } = Aero;
const browserAero = loadInSandbox(source, 'browser');
const cjsAero = loadInSandbox(source, 'commonjs');

let passed = 0;
let failed = 0;

function run(label, fn) {
  try {
    fn();
    passed++;
    console.log('PASS  ' + label);
  } catch (err) {
    failed++;
    console.log('FAIL  ' + label);
    console.log('      ' + String(err.message).replace(/\n/g, '\n      '));
  }
}

function near(actual, expected, relTol, label) {
  assert.ok(Number.isFinite(actual), label + ': not finite (' + actual + ')');
  const err = Math.abs(actual - expected) / Math.abs(expected);
  assert.ok(
    err <= relTol,
    label + ': ' + actual + ' vs ' + expected +
    ' (' + (err * 100).toFixed(2) + '% > ' + (relTol * 100) + '%)'
  );
}

function nearAbs(actual, expected, absTol, label) {
  assert.ok(Number.isFinite(actual), label + ': not finite (' + actual + ')');
  assert.ok(
    Math.abs(actual - expected) <= absTol,
    label + ': ' + actual + ' vs ' + expected + ' (tol ' + absTol + ')'
  );
}

// Shared flight condition for sign checks: M 0.8, 5 km, no body rates.
const BASE = { mach: 0.8, altitude: 5000 };

console.log('aero.test -- AIM-120D moment model (SPEC 2.5)');
console.log('loaded via: ' + loaded.via + '\n');

// --- API / constants -------------------------------------------------------
run('0. UMD loads via require, UMD global and CommonJS; constants match SPEC', () => {
  for (const a of [Aero, browserAero, cjsAero]) {
    assert.equal(typeof a, 'object');
    for (const key of ['CONST', 'atmosphere', 'compute', 'stallFactor', 'DERIVATIVES']) {
      assert.ok(a[key] !== undefined, 'missing export: ' + key);
    }
  }
  // The browser branch must publish exactly one global, like a <script> tag.
  assert.equal(typeof browserAero.compute, 'function');
  // No ES module syntax may leak into the shipped classic script.
  assert.ok(!/^\s*(import|export)\b/m.test(source), 'aero.js must not use ES module syntax');

  near(CONST.length, 3.66, 1e-12, 'CONST.length');
  near(CONST.diameter, 0.178, 1e-12, 'CONST.diameter');
  near(CONST.refArea, Math.PI * 0.178 * 0.178 / 4, 1e-12, 'CONST.refArea');
  near(CONST.refSpan, 0.526, 1e-12, 'CONST.refSpan');
  near(CONST.refLength, 0.178, 1e-12, 'CONST.refLength');
  near(CONST.mass, 152, 1e-12, 'CONST.mass');
  near(CONST.Ixx, 0.45, 1e-12, 'CONST.Ixx');
  near(CONST.Iyy, 155, 1e-12, 'CONST.Iyy');
  near(CONST.Izz, 155, 1e-12, 'CONST.Izz');
  const expected = {
    CN_alpha: 14.0, CD0: 0.16, Cm0: 0.004, Cm_alpha: -2.20, Cm_q: -1200,
    Cm_de: 3.20, Cn_beta: 2.20, Cn_r: -1200, Cn_dr: 3.20, Cl_da: 0.030,
    Cl_p: -2.00, Cl_beta: -0.010, Cl_dr: 0.012
  };
  for (const [k, v] of Object.entries(expected)) {
    assert.equal(DERIVATIVES[k], v, 'DERIVATIVES.' + k);
  }
});

// --- 1. Sea level, M = 1 ---------------------------------------------------
run('1. sea level M=1: q ~ 70 kPa, V ~ 340 m/s', () => {
  const atm = atmosphere(0);
  near(atm.T, 288.15, 0.001, 'sea-level T');
  near(atm.p, 101325, 0.001, 'sea-level p');
  near(atm.rho, 1.225, 0.001, 'sea-level rho');
  const V = atm.a; // M = 1
  const q = 0.5 * atm.rho * V * V;
  near(q, 70000, 0.02, 'dynamic pressure q');
  nearAbs(V, 340, 2.0, 'speed of sound V');
});

// --- 2. 11 km ISA ----------------------------------------------------------
run('2. 11 km: T ~ 216.65 K, rho ~ 0.364 kg/m^3', () => {
  const atm = atmosphere(11000);
  near(atm.T, 216.65, 0.005, 'T at 11 km');
  near(atm.rho, 0.364, 0.05, 'rho at 11 km');
  near(atm.a, 295.07, 0.01, 'a at 11 km');
});

// --- 3. Trim / all-zero case ----------------------------------------------
run('3. alpha=beta=delta=0: Mx=My=Mz=0 (|My| < 1 N*m from Cm0)', () => {
  const out = compute({ ...BASE, alphaDeg: 0, betaDeg: 0 });
  nearAbs(out.Mx, 0, 1e-12, 'Mx');
  nearAbs(out.Mz, 0, 1e-12, 'Mz');
  assert.ok(Math.abs(out.My) < 1, 'My = ' + out.My + ' N*m, expected |My| < 1');
});

// --- 4. Control sign convention ------------------------------------------
run('4. +10 deg commands produce positive moments (dE->My, dR->Mz, dA->Mx)', () => {
  const e = compute({ ...BASE, deltaEDeg: 10 });
  assert.ok(e.My > 0, 'deltaE=+10 -> My=' + e.My + ', expected > 0');
  const r = compute({ ...BASE, deltaRDeg: 10 });
  assert.ok(r.Mz > 0, 'deltaR=+10 -> Mz=' + r.Mz + ', expected > 0');
  const a = compute({ ...BASE, deltaADeg: 10 });
  assert.ok(a.Mx > 0, 'deltaA=+10 -> Mx=' + a.Mx + ', expected > 0');
  assert.ok(compute({ ...BASE, deltaEDeg: -10 }).My < 0, 'deltaE=-10 -> My < 0');
  assert.ok(compute({ ...BASE, deltaRDeg: -10 }).Mz < 0, 'deltaR=-10 -> Mz < 0');
  assert.ok(compute({ ...BASE, deltaADeg: -10 }).Mx < 0, 'deltaA=-10 -> Mx < 0');
});

// --- 5. Pitch / yaw static stability -------------------------------------
run('5. alpha=+10 -> My < 0; alpha=-10 -> My > 0 (static stability)', () => {
  const up = compute({ ...BASE, alphaDeg: 10 });
  assert.ok(up.My < 0, 'alpha=+10 -> My=' + up.My + ', expected < 0');
  const down = compute({ ...BASE, alphaDeg: -10 });
  assert.ok(down.My > 0, 'alpha=-10 -> My=' + down.My + ', expected > 0');
  // SPEC 2.2: +beta (flow from the left, nose left of the velocity) gives
  // +Cn and therefore +Mz, i.e. a nose-right moment that restores alignment.
  assert.ok(compute({ ...BASE, betaDeg: 10 }).Mz > 0, 'beta=+10 -> Mz > 0 (weathercock, nose right)');
  assert.ok(compute({ ...BASE, betaDeg: -10 }).Mz < 0, 'beta=-10 -> Mz < 0');
});

// --- 6. Linearity in the attached-flow region ----------------------------
run('6. linear region: My(10 deg) ~ 2 x My(5 deg), within 10%', () => {
  const m5 = compute({ ...BASE, alphaDeg: 5 }).My;
  const m10 = compute({ ...BASE, alphaDeg: 10 }).My;
  const ratio = m10 / m5;
  assert.ok(m5 < 0 && m10 < 0, 'both moments should be negative');
  assert.ok(
    Math.abs(ratio - 2) <= 0.2,
    'ratio My(10)/My(5) = ' + ratio.toFixed(3) + ', expected 2 +/- 10%'
  );
});

// --- 7. Stall attenuation -------------------------------------------------
run('7. stall: alpha=30 moment is smaller than the linear extrapolation', () => {
  const out = compute({ ...BASE, alphaDeg: 30 });
  const linear10 = compute({ ...BASE, alphaDeg: 10 }).My;
  const linearAt30 = linear10 * 3; // pure linear extrapolation from 10 deg
  assert.ok(
    Math.abs(out.My) < Math.abs(linearAt30),
    '|My(30)|=' + Math.abs(out.My).toFixed(2) +
    ' should be < linear ' + Math.abs(linearAt30).toFixed(2)
  );
  near(stallFactor(0), 1, 1e-12, 'stallFactor(0)');
  near(stallFactor(18), 1, 1e-12, 'stallFactor(18)');
  near(stallFactor(26), 0.5, 1e-9, 'stallFactor(26)');
  near(stallFactor(34), 0.2, 1e-9, 'stallFactor(34)');
  near(stallFactor(-26), 0.5, 1e-9, 'stallFactor(-26)');
});

// --- Body-rate damping ----------------------------------------------------
run('8. body rates damp: pitchRate>0 lowers My, yawRate>0 lowers Mz, rollRate>0 lowers Mx', () => {
  const p = compute({ ...BASE, pitchRate: 1 });
  const r = compute({ ...BASE, yawRate: 1 });
  const qq = compute({ ...BASE, rollRate: 1 });
  assert.ok(p.My < compute(BASE).My, 'pitch damping: My with q=1 should be lower');
  assert.ok(r.Mz < compute(BASE).Mz, 'yaw damping: Mz with r=1 should be lower');
  assert.ok(qq.Mx < compute(BASE).Mx, 'roll damping: Mx with p=1 should be lower');
});

// --- 9. Finite outputs / input robustness --------------------------------
const OUTPUT_KEYS = [
  'mach', 'altitude', 'V', 'q', 'rho', 'a', 'alphaDeg', 'betaDeg',
  'CL', 'CD', 'CN', 'Cl', 'Cm', 'Cn', 'Mx', 'My', 'Mz',
  'pDot', 'qDot', 'rDot', 'stall'
];

run('9a. every output field is a finite number (envelope grid)', () => {
  const machs = [0, 0.3, 0.9, 2, 6];
  const alts = [0, 5000, 11000, 20000, 25000];
  const angles = [-40, -19, -10, 0, 10, 19, 26, 40];
  const deltas = [-30, -10, 0, 10, 30];
  const rates = [-3, 0, 3];
  let count = 0;
  for (const mach of machs) {
    for (const altitude of alts) {
      for (const alphaDeg of angles) {
        for (const deltaEDeg of deltas) {
          for (const pitchRate of rates) {
            const out = compute({
              mach, altitude, alphaDeg, betaDeg: -alphaDeg,
              deltaEDeg, deltaRDeg: -deltaEDeg, deltaADeg: deltaEDeg / 2,
              rollRate: pitchRate, pitchRate, yawRate: -pitchRate
            });
            for (const key of OUTPUT_KEYS) {
              assert.ok(Number.isFinite(out[key]),
                key + ' is not finite at mach=' + mach + ' alt=' + altitude +
                ' alpha=' + alphaDeg + ' dE=' + deltaEDeg + ' rate=' + pitchRate);
            }
            assert.ok(out.stall >= 0 && out.stall <= 1, 'stall out of [0,1]');
            count++;
          }
        }
      }
    }
  }
  assert.ok(count > 1000, 'grid too small: ' + count);
});

run('9b. NaN / undefined / garbage inputs are scrubbed, never NaN out', () => {
  const bad = compute({
    mach: NaN, altitude: undefined, alphaDeg: 'x', betaDeg: Infinity,
    deltaEDeg: null, deltaRDeg: -Infinity, deltaADeg: NaN,
    rollRate: NaN, pitchRate: undefined, yawRate: Infinity
  });
  for (const key of OUTPUT_KEYS) {
    assert.ok(Number.isFinite(bad[key]), key + ' is not finite');
  }
  const empty = compute();
  for (const key of OUTPUT_KEYS) {
    assert.ok(Number.isFinite(empty[key]), key + ' is not finite for empty input');
  }
  assert.equal(empty.mach, 0);
  assert.equal(empty.altitude, 0);
});

run('9c. input clamping: alpha/beta +/-40, delta +/-30, mach [0,6], alt [0,25000]', () => {
  assert.equal(compute({ alphaDeg: 100 }).alphaDeg, 40);
  assert.equal(compute({ alphaDeg: -100 }).alphaDeg, -40);
  assert.equal(compute({ betaDeg: 55 }).betaDeg, 40);
  assert.equal(compute({ betaDeg: -55 }).betaDeg, -40);
  // Deflections are not echoed, so clamping is checked through the moment.
  assert.equal(compute({ ...BASE, deltaEDeg: 45 }).My,
    compute({ ...BASE, deltaEDeg: 30 }).My, 'deltaE clamps to 30 deg');
  assert.equal(compute({ mach: 9 }).mach, 6);
  assert.equal(compute({ mach: -1 }).mach, 0);
  assert.equal(compute({ altitude: -500 }).altitude, 0);
  assert.equal(compute({ altitude: 40000 }).altitude, 25000);
});

// --- Sanity table (reported to the Lead) ---------------------------------
console.log('\nSanity table: M 0.9 / 5 km, moments in N*m');
console.log('case                    alpha    beta      dE      dR      dA         Mx         My         Mz');
const tableRows = [
  ['trim (all zero)',      0, 0, 0, 0, 0],
  ['alpha +10',           10, 0, 0, 0, 0],
  ['alpha -10',          -10, 0, 0, 0, 0],
  ['alpha +10, beta +10',  10, 10, 0, 0, 0],
  ['beta +10',             0, 10, 0, 0, 0],
  ['deltaE +10',           0, 0, 10, 0, 0],
  ['deltaE -10',           0, 0, -10, 0, 0],
  ['deltaR +10',           0, 0, 0, 10, 0],
  ['deltaA +10',           0, 0, 0, 0, 10],
  ['alpha +30 (stall)',   30, 0, 0, 0, 0]
];
for (const [name, alphaDeg, betaDeg, deltaEDeg, deltaRDeg, deltaADeg] of tableRows) {
  const o = compute({ mach: 0.9, altitude: 5000, alphaDeg, betaDeg,
    deltaEDeg, deltaRDeg, deltaADeg });
  console.log(
    name.padEnd(24) +
    String(alphaDeg).padStart(6) + String(betaDeg).padStart(8) +
    String(deltaEDeg).padStart(8) + String(deltaRDeg).padStart(8) +
    String(deltaADeg).padStart(8) +
    o.Mx.toFixed(2).padStart(11) + o.My.toFixed(2).padStart(11) + o.Mz.toFixed(2).padStart(11)
  );
}

const q95 = compute({ mach: 0.9, altitude: 5000 }).q;
console.log('\nq(M 0.9, 5 km) = ' + q95.toFixed(1) + ' Pa; My per unit Cm = ' +
  (q95 * CONST.refArea * CONST.refLength).toFixed(2) + ' N*m');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) {
  process.exitCode = 1;
}
