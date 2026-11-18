/* AIM-120D MOMENT STUDY — 3D scene
   body frame: +X nose, +Y up, +Z right; moments Mx(+X), My(+Z), Mz(-Y) */
(function () {
  'use strict';
  var THREE = window.THREE;
  var UP = new THREE.Vector3(0, 1, 0);

  var PALETTE = {
    pitch: 0xD92B1F,
    yaw: 0x1B3FA8,
    roll: 0xDE9E0A,
    ink: 0x141414
  };
  var RANGES = { x: 8, y: 130, z: 130 }; // N·m, per-axis normalisation

  function makeEnv(renderer) {
    var c = document.createElement('canvas');
    c.width = 1024; c.height = 512;
    var ctx = c.getContext('2d');
    var g = ctx.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.40, '#eeece6');
    g.addColorStop(0.58, '#a9a599');
    g.addColorStop(1, '#4c4a44');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 1024, 512);
    var lg = ctx.createLinearGradient(0, 30, 0, 250);
    lg.addColorStop(0, 'rgba(255,255,255,0)');
    lg.addColorStop(0.5, 'rgba(255,255,255,0.95)');
    lg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = lg;
    ctx.fillRect(0, 30, 1024, 220);
    var tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.encoding = THREE.sRGBEncoding;
    var pmrem = new THREE.PMREMGenerator(renderer);
    var env = pmrem.fromEquirectangular(tex).texture;
    tex.dispose();
    pmrem.dispose();
    return env;
  }

  function makeShadowTexture() {
    var c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    var ctx = c.getContext('2d');
    var g = ctx.createRadialGradient(128, 128, 8, 128, 128, 124);
    g.addColorStop(0, 'rgba(20,20,20,0.40)');
    g.addColorStop(0.45, 'rgba(20,20,20,0.16)');
    g.addColorStop(1, 'rgba(20,20,20,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(c);
  }

  function makeArrow(color) {
    var g = new THREE.Group();
    var mat = new THREE.MeshBasicMaterial({ color: color, depthTest: false, depthWrite: false, toneMapped: false });
    var shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0125, 0.0125, 1, 10, 1, false), mat);
    var head = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.15, 20), mat);
    shaft.renderOrder = 20;
    head.renderOrder = 20;
    g.add(shaft);
    g.add(head);
    g.userData = { shaft: shaft, head: head, mat: mat, len: 0 };
    g.visible = false;
    g.renderOrder = 20;
    return g;
  }

  function setArrow(g, dir, len) {
    if (len < 0.025) { g.visible = false; return; }
    g.visible = true;
    var q = new THREE.Quaternion().setFromUnitVectors(UP, dir);
    g.quaternion.copy(q);
    var shaftLen = Math.max(0.02, len - 0.09);
    g.userData.shaft.scale.y = shaftLen;
    g.userData.shaft.position.y = shaftLen / 2;
    g.userData.head.position.y = shaftLen + 0.075;
    g.userData.len = len;
  }

  function MissileScene(canvas, labelsEl) {
    var self = this;
    this.canvas = canvas;
    this.labelsEl = labelsEl;
    this.values = {};
    this.autoRotate = false;
    this.lastInput = 0;
    this.pointer = null;
    this.spherical = { r: 4.2, theta: 0.82, phi: 0.24 };
    this.targetSpherical = { r: 4.2, theta: 0.82, phi: 0.24 };

    var renderer = new THREE.WebGLRenderer({
      canvas: canvas, antialias: true, alpha: true, powerPreference: 'high-performance'
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    this.renderer = renderer;

    var scene = new THREE.Scene();
    scene.environment = makeEnv(renderer);
    this.scene = scene;

    var camera = new THREE.PerspectiveCamera(30, 1, 0.1, 120);
    this.camera = camera;

    // ---- lights
    scene.add(new THREE.HemisphereLight(0xffffff, 0x9b978a, 0.5));
    var key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(4.2, 7.2, 3.8);
    scene.add(key);
    var fill = new THREE.DirectionalLight(0xf0ece1, 0.5);
    fill.position.set(-6, 2.2, -5);
    scene.add(fill);
    var rim = new THREE.DirectionalLight(0xffffff, 0.9);
    rim.position.set(-2.5, 3.2, -7);
    scene.add(rim);

    var mesh = window.AIM120D_MESH;
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(mesh.positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(mesh.normals, 3));
    geo.setIndex(mesh.indices);
    geo.computeBoundingSphere();

    function radiusAt(x) {
      var p = mesh.positions, r = 0, best = 0;
      for (var i = 0; i < p.length; i += 3) {
        if (Math.abs(p[i] - x) < 0.03) {
          var rr = Math.sqrt(p[i + 1] * p[i + 1] + p[i + 2] * p[i + 2]);
          if (rr > r) r = rr;
        }
      }
      return r || 0.1;
    }
    this.radiusAt = radiusAt;

    // ---- missile
    var group = new THREE.Group();
    scene.add(group);
    this.group = group;

    var bodyMat = new THREE.MeshStandardMaterial({
      color: 0x93907F, metalness: 0.58, roughness: 0.4, envMapIntensity: 0.75
    });
    var body = new THREE.Mesh(geo, bodyMat);
    group.add(body);

    // painted markings hugging the hull
    function band(x, width, color) {
      var r = radiusAt(x) + 0.0012;
      var m = new THREE.Mesh(
        new THREE.CylinderGeometry(r, r, width, 56, 1, true),
        new THREE.MeshStandardMaterial({ color: color, metalness: 0.05, roughness: 0.72, envMapIntensity: 0.15 })
      );
      m.rotation.z = Math.PI / 2;
      m.position.x = x;
      group.add(m);
      return m;
    }
    band(0.92, 0.045, PALETTE.pitch);
    band(-1.28, 0.012, 0x1C1C1A);

    // seeker window + exhaust nozzle
    var seeker = new THREE.Mesh(
      new THREE.CircleGeometry(radiusAt(1.828) * 0.66, 28),
      new THREE.MeshStandardMaterial({ color: 0x3B3E44, metalness: 0.9, roughness: 0.2 })
    );
    seeker.rotation.y = Math.PI / 2;
    seeker.position.x = 1.832;
    group.add(seeker);

    var nozzle = new THREE.Mesh(
      new THREE.CircleGeometry(radiusAt(-1.828) * 0.84, 24),
      new THREE.MeshStandardMaterial({ color: 0x171715, metalness: 0.4, roughness: 0.65 })
    );
    nozzle.rotation.y = -Math.PI / 2;
    nozzle.position.x = -1.836;
    group.add(nozzle);

    // ---- body axes
    var axisMat = new THREE.LineBasicMaterial({ color: PALETTE.ink, transparent: true, opacity: 0.38 });
    var axisPts = [
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(1.02, 0, 0),
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 1.02),
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -1.02, 0)
    ];
    group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(axisPts), axisMat));

    // CG marker
    var cgMat = new THREE.MeshBasicMaterial({ color: PALETTE.ink, depthTest: false, toneMapped: false });
    var cgDot = new THREE.Mesh(new THREE.SphereGeometry(0.017, 12, 10), cgMat);
    cgDot.renderOrder = 21;
    group.add(cgDot);
    var cgRing = new THREE.Mesh(new THREE.RingGeometry(0.055, 0.062, 40),
      new THREE.MeshBasicMaterial({ color: PALETTE.ink, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthTest: false, toneMapped: false }));
    cgRing.renderOrder = 21;
    group.add(cgRing);

    // ---- moment arrows (body frame, always drawn on top)
    var arrows = {
      x: makeArrow(PALETTE.roll),
      y: makeArrow(PALETTE.pitch),
      z: makeArrow(PALETTE.yaw)
    };
    group.add(arrows.x); group.add(arrows.y); group.add(arrows.z);
    this.arrows = arrows;

    // ---- ground grid
    var groundY = -1.15;
    var minorPts = [], majorPts = [];
    for (var i = -9; i <= 9; i++) {
      var v = i * 0.5;
      var arr = (i % 2 === 0) ? majorPts : minorPts;
      arr.push(new THREE.Vector3(v, groundY, -4.5), new THREE.Vector3(v, groundY, 4.5));
      arr.push(new THREE.Vector3(-4.5, groundY, v), new THREE.Vector3(4.5, groundY, v));
    }
    scene.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(minorPts),
      new THREE.LineBasicMaterial({ color: 0x141414, transparent: true, opacity: 0.07 })));
    scene.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(majorPts),
      new THREE.LineBasicMaterial({ color: 0x141414, transparent: true, opacity: 0.13 })));

    // soft contact shadow (drawn as a gradient, not a shadow map)
    var shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(4.6, 1.7),
      new THREE.MeshBasicMaterial({ map: makeShadowTexture(), transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(0.05, groundY + 0.004, 0.1);
    scene.add(shadow);

    // ---- dimension line
    var dimY = -0.66;
    var dimPts = [
      new THREE.Vector3(-1.83, dimY, 0), new THREE.Vector3(1.83, dimY, 0),
      new THREE.Vector3(-1.83, dimY - 0.06, 0), new THREE.Vector3(-1.83, dimY + 0.06, 0),
      new THREE.Vector3(1.83, dimY - 0.06, 0), new THREE.Vector3(1.83, dimY + 0.06, 0)
    ];
    scene.add(new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(dimPts),
      new THREE.LineBasicMaterial({ color: 0x8A887D, transparent: true, opacity: 0.85 })
    ));

    // ---- velocity reference
    var velY = 0.82;
    var velPts = [];
    for (var s = -1.15; s < 1.95; s += 0.105) {
      velPts.push(new THREE.Vector3(s, velY, 0), new THREE.Vector3(s + 0.052, velY, 0));
    }
    scene.add(new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(velPts),
      new THREE.LineBasicMaterial({ color: 0x4A4943, transparent: true, opacity: 0.5 })
    ));
    var velHead = new THREE.Mesh(
      new THREE.ConeGeometry(0.024, 0.1, 12),
      new THREE.MeshBasicMaterial({ color: 0x4A4943 })
    );
    velHead.rotation.z = -Math.PI / 2;
    velHead.position.set(2.0, velY, 0);
    scene.add(velHead);

    // ---- labels
    function label(cls, html, dx, dy) {
      var el = document.createElement('div');
      el.className = 'lbl ' + cls;
      el.innerHTML = html;
      labelsEl.appendChild(el);
      return { el: el, dx: dx, dy: dy, visible: true };
    }
    this.labels = {
      mx: label('c-roll', '<span class="dot"></span>M<sub>x</sub> <b data-v>0.0</b><span class="u">N·m</span>', 22, -8),
      my: label('c-pitch', '<span class="dot"></span>M<sub>y</sub> <b data-v>0.0</b><span class="u">N·m</span>', 24, 4),
      mz: label('c-yaw', '<span class="dot"></span>M<sub>z</sub> <b data-v>0.0</b><span class="u">N·m</span>', 20, 16),
      cg: label('ink', '<span class="dot"></span>CG', -6, 17),
      vinf: label('ink', 'V<sub>∞</sub> <b data-v>—</b><span class="u">m/s</span>', 0, -24),
      dim: label('dim', 'L 3.66 m', 0, -13),
      ax: label('ink', 'x', 12, -2),
      ay: label('ink', 'y', 12, -2),
      az: label('ink', 'z', 12, -2)
    };

    this.bindEvents();
    this.resize();
  }

  MissileScene.prototype.bindEvents = function () {
    var self = this;
    var c = this.canvas;

    c.addEventListener('pointerdown', function (e) {
      self.pointer = { id: e.pointerId, x: e.clientX, y: e.clientY };
      try { c.setPointerCapture(e.pointerId); } catch (err) {}
      self.lastInput = performance.now();
      self.canvas.parentNode.classList.add('dragging');
    });
    c.addEventListener('pointermove', function (e) {
      if (!self.pointer || self.pointer.id !== e.pointerId) return;
      var dx = e.clientX - self.pointer.x;
      var dy = e.clientY - self.pointer.y;
      self.pointer.x = e.clientX;
      self.pointer.y = e.clientY;
      self.targetSpherical.theta -= dx * 0.0068;
      self.targetSpherical.phi += dy * 0.0055;
      self.targetSpherical.phi = Math.max(-0.24, Math.min(1.12, self.targetSpherical.phi));
      self.lastInput = performance.now();
    });
    function end(e) {
      if (!self.pointer || self.pointer.id !== e.pointerId) return;
      self.pointer = null;
      self.lastInput = performance.now();
      self.canvas.parentNode.classList.remove('dragging');
    }
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('wheel', function (e) {
      e.preventDefault();
      self.targetSpherical.r *= Math.exp(e.deltaY * 0.0009);
      self.targetSpherical.r = Math.max(3.2, Math.min(10, self.targetSpherical.r));
      self.lastInput = performance.now();
    }, { passive: false });
  };

  MissileScene.prototype.setView = function (name) {
    var t = this.targetSpherical;
    if (name === 'front') { t.theta = 1.5; t.phi = 0.10; t.r = 4.7; }
    else if (name === 'side') { t.theta = 0.07; t.phi = 0.10; t.r = 5.5; }
    else { t.theta = 0.82; t.phi = 0.24; t.r = 4.2; }
    this.lastInput = performance.now();
  };

  MissileScene.prototype.resize = function () {
    var w = this.canvas.clientWidth || 1;
    var h = this.canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // keep the full 3.66 m airframe inside narrow viewports (phones)

  };

  MissileScene.prototype.setState = function (s) {
    var qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.beta * Math.PI / 180);
    var qPitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), s.alpha * Math.PI / 180);
    var qRoll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), s.rollAngle);
    this.group.quaternion.copy(qYaw).multiply(qPitch).multiply(qRoll);

    var sx = s.Mx >= 0 ? 1 : -1;
    var sy = s.My >= 0 ? 1 : -1;
    var sz = s.Mz >= 0 ? 1 : -1;
    var lx = 0.2 + 0.92 * Math.min(1, Math.abs(s.Mx) / RANGES.x);
    var ly = 0.2 + 0.92 * Math.min(1, Math.abs(s.My) / RANGES.y);
    var lz = 0.2 + 0.92 * Math.min(1, Math.abs(s.Mz) / RANGES.z);
    var dirX = new THREE.Vector3(sx, 0, 0);
    var dirY = new THREE.Vector3(0, 0, sy);
    var dirZ = new THREE.Vector3(0, -sz, 0); // body z = -Y
    setArrow(this.arrows.x, dirX, Math.abs(s.Mx) < 0.12 ? 0 : lx);
    setArrow(this.arrows.y, dirY, Math.abs(s.My) < 0.12 ? 0 : ly);
    setArrow(this.arrows.z, dirZ, Math.abs(s.Mz) < 0.12 ? 0 : lz);

    this._tips = {
      mx: dirX.clone().multiplyScalar(lx),
      my: dirY.clone().multiplyScalar(ly),
      mz: dirZ.clone().multiplyScalar(lz)
    };

    var f = function (v) { return (v >= 0 ? '' : '\u2212') + Math.abs(v).toFixed(1); };
    this.labels.mx.el.querySelector('[data-v]').textContent = f(s.Mx);
    this.labels.my.el.querySelector('[data-v]').textContent = f(s.My);
    this.labels.mz.el.querySelector('[data-v]').textContent = f(s.Mz);
    this.labels.vinf.el.querySelector('[data-v]').textContent = Math.round(s.vInf);
    this.labels.mx.visible = Math.abs(s.Mx) > 0.12;
    this.labels.my.visible = Math.abs(s.My) > 0.12;
    this.labels.mz.visible = Math.abs(s.Mz) > 0.12;
  };

  MissileScene.prototype.project = function (p) {
    var w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    var v = p.clone().project(this.camera);
    return {
      x: (v.x * 0.5 + 0.5) * w,
      y: (-v.y * 0.5 + 0.5) * h,
      visible: v.z < 1 && v.z > -1
    };
  };

  MissileScene.prototype.updateLabels = function () {
    var g = this.group;
    g.updateMatrixWorld();
    var tipWorld = function (v) { return v.clone().applyMatrix4(g.matrixWorld); };
    var cgS = this.project(new THREE.Vector3(0, 0, 0));
    var list = [
      [this.labels.mx, tipWorld(this._tips.mx), true],
      [this.labels.my, tipWorld(this._tips.my), true],
      [this.labels.mz, tipWorld(this._tips.mz), true],
      [this.labels.cg, new THREE.Vector3(0, 0, 0), false],
      [this.labels.vinf, new THREE.Vector3(1.42, 0.82, 0), false],
      [this.labels.dim, new THREE.Vector3(0, -0.66, 0), false],
      [this.labels.ax, tipWorld(new THREE.Vector3(1.02, 0, 0)), false],
      [this.labels.ay, tipWorld(new THREE.Vector3(0, 0, 1.02)), false],
      [this.labels.az, tipWorld(new THREE.Vector3(0, -1.02, 0)), false]
    ];
    for (var i = 0; i < list.length; i++) {
      var lab = list[i][0], p = list[i][1], radial = list[i][2];
      var s = this.project(p);
      var on = s.visible && lab.visible;
      lab.el.style.display = on ? 'flex' : 'none';
      if (!on) continue;
      var px = s.x, py = s.y;
      if (radial) {
        var vx = s.x - cgS.x, vy = s.y - cgS.y;
        var vm = Math.hypot(vx, vy);
        if (vm > 1) { px += vx / vm * 30; py += vy / vm * 30; }
        else { px += lab.dx; py += lab.dy; }
      } else { px += lab.dx; py += lab.dy; }
      lab.el.style.transform = 'translate3d(' + px + 'px,' + py + 'px,0) translate(-50%,-50%)';
    }
  };

  MissileScene.prototype.render = function (dt) {
    var t = this.targetSpherical;
    var k = 1 - Math.exp(-8 * dt);
    this.spherical.r += (t.r - this.spherical.r) * k;
    this.spherical.theta += (t.theta - this.spherical.theta) * k;
    this.spherical.phi += (t.phi - this.spherical.phi) * k;

    // keep the 3.66 m airframe inside the frame at every orbit angle / aspect
    var th = this.spherical.theta, ph = this.spherical.phi;
    var halfFov = this.camera.fov * Math.PI / 360;
    var projHalf = 1.83 * Math.abs(Math.cos(th)) + 0.62;
    var fitR = projHalf / (Math.tan(halfFov) * Math.max(0.4, this.camera.aspect));
    var r = Math.max(this.spherical.r, Math.max(3.4, fitR));
    this.camera.position.set(
      r * Math.cos(ph) * Math.sin(th),
      r * Math.sin(ph),
      r * Math.cos(ph) * Math.cos(th)
    );
    this.camera.lookAt(0, 0.02, 0);
    this.camera.updateMatrixWorld();

    this.updateLabels();
    this.renderer.render(this.scene, this.camera);
  };

  window.MissileScene = MissileScene;
})();
