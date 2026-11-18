# AIM-120D MOMENT STUDY — 工程契约 / CONTRACT

Project root: `C:\Users\HUAWEI\Documents\deepseek-harness\default-workspace\aim120d-moments`

## 0. 项目定位

一个**纯静态、无构建**的 Three.js 单页应用：以 AIM-120D 为对象，展示弹体三轴气动力矩
（俯仰 My、偏航 Mz、滚转 Mx），UI 为瑞士国际主义（International Typographic Style）风格。
所有脚本以经典 `<script>` 顺序加载，不使用 ES module / 打包器 / 外网 CDN。
页面必须能从 `file://` 与 GitHub Pages 静态托管两种方式运行。

加载顺序（index.html）：

```html
<script src="js/three.min.js"></script>
<script src="js/missile.mesh.js"></script>
<script src="js/aero.js"></script>
<script src="js/charts.js"></script>
<script src="js/scene.js"></script>
<script src="js/app.js"></script>
```

## 1. 坐标系与符号约定（必须统一）

弹体坐标系 O-xyz，右手系：

- `+x`：指向弹头（前）
- `+y`：指向弹体右侧（右翼方向）
- `+z`：指向弹体下方

三轴力矩按右手定则取正：

- `Mx`（滚转 / roll）：绕 +x，正方向 = 右翼下沉（右滚）
- `My`（俯仰 / pitch）：绕 +y，正方向 = 抬头（nose-up）
- `Mz`（偏航 / yaw）：绕 +z，正方向 = 机头右偏（nose-right）

角度：α 迎角（+ = 来流从下方，抬头），β 侧滑角（+ = 来流从左侧，机头相对速度偏左）。
舵偏：δe 升降舵（+ = 后缘下偏，产生抬头力矩），δr 方向舵（+ = 后缘右偏，产生右偏力矩），
δa 副翼（+ = 右滚）。

参考量：`S = π d²/4`，俯仰/偏航参考长度 `d`，滚转参考展长 `b`。

## 2. `js/aero.js` —— 气动力矩模型（交给 aero 队友）

UMD 包装，浏览器挂 `window.Aero`，Node 可 `require`（供 tests 使用）：

```js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Aero = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // ...
  return { CONST, atmosphere, compute, stallFactor, DERIVATIVES };
});
```

### 2.1 常量 `Aero.CONST`

| key | value | 说明 |
|---|---|---|
| length | 3.66 | m |
| diameter | 0.178 | m |
| refArea | Math.PI*diameter²/4 | m² |
| refSpan | 0.526 | m |
| refLength | 0.178 | m（= diameter） |
| mass | 152 | kg |
| Ixx | 0.45 | kg·m² |
| Iyy | 155 | kg·m² |
| Izz | 155 | kg·m² |

### 2.2 气动导数 `Aero.DERIVATIVES`（单位 1/rad）

```
CN_alpha  14.0     // 法向力系数斜率
CD0        0.16    // 零升阻力
Cm0        0.004   // 零升俯仰力矩（配平偏置）
Cm_alpha  -2.20    // 俯仰静稳定（负 = 稳定）
Cm_q     -1200     // 俯仰阻尼
Cm_de     +3.20    // 俯仰操纵效率（+δe 指令 = 抬头，见下方符号约定）
Cn_beta   +2.20    // 航向静稳定
Cn_r     -1200     // 偏航阻尼
Cn_dr     +3.20    // 偏航操纵效率（+δr 指令 = 右偏）
Cl_da     +0.030   // 副翼滚转效率
Cl_p      -2.00    // 滚转阻尼
Cl_beta   -0.010   // 上反/侧滑滚转耦合
Cl_dr     +0.012
```

> 符号约定（与本演示的控件一致，务必照此实现）：
> 三个舵偏输入是**控制指令角**，正方向**直接产生同号力矩** —— δe>0 ⇒ My>0（抬头），
> δr>0 ⇒ Mz>0（右偏），δa>0 ⇒ Mx>0（右滚）。因此：
>
> ```
> Cm = Cm0 + Cm_alpha*alpha + Cm_de*deltaE + Cm_q*(pitchRate*refLength/(2V))
> Cn =         Cn_beta*beta   + Cn_dr*deltaR   + Cn_r*(yawRate*refSpan/(2V))
> Cl =         Cl_beta*beta   + Cl_da*deltaA   + Cl_p *(rollRate*refSpan/(2V)) + Cl_dr*deltaR
> ```
>
> 舵偏输入单位为**度**，计算前转弧度。物理上"抬头指令"对应升降舵后缘上偏；文档里注明即可，
> 代码无需处理。测试会检查：δe=+10° 时 My>0，δr=+10° 时 Mz>0，δa=+10° 时 Mx>0。

### 2.3 大气 `Aero.atmosphere(altitudeM)`

ISA，0–20 km：T、p、rho、a（m/s）。返回 `{h, T, p, rho, a}`。

### 2.4 计算 `Aero.compute(input)`

input:
```js
{ mach, altitude, alphaDeg, betaDeg, deltaEDeg, deltaRDeg, deltaADeg,
  rollRate = 0, pitchRate = 0, yawRate = 0 }   // 角速度 rad/s，可选
```

输出（全部数字，不得为 NaN）：
```js
{
  mach, altitude, V, q, rho, a, alphaDeg, betaDeg,
  CL, CD, CN,          // 力系数
  Cl, Cm, Cn,          // 力矩系数
  Mx, My, Mz,          // N·m，绕 +x/+y/+z
  pDot, qDot, rDot,    // rad/s²，= M/I
  stall               // 0..1 衰减因子
}
```

实现要求：

- `q = 0.5 * rho * V²`，`V = mach * a`。
- 迎角/侧滑角转弧度；`CN = CN_alpha * alphaRad * stall`。
- 失速平滑：`stallFactor(angleDeg)` —— |angle| ≤ 18° 时为 1，之后按
  `1 / (1 + ((|angle|-18)/8)^2)` 平滑衰减（18°→1，26°→0.5，34°→0.2）。
  对 α、β 分别取因子，施加于 CN 与对应的静稳定力矩项（Cm_alpha*alpha、Cn_beta*beta）。
- 控制力矩不受失速因子影响（简化）。
- 力矩：
  - `Mx = q * S * b * Cl`
  - `My = q * S * d * Cm`
  - `Mz = q * S * d * Cn`
- 角加速度 `pDot = Mx / Ixx` 等。
- 输入做有限值保护（NaN/undefined → 0），范围钳制：|α| ≤ 40°，|β| ≤ 40°，
  |δ| ≤ 30°，mach ∈ [0, 6]，altitude ∈ [0, 25000]。
- 无副作用，不依赖 DOM；性能足够 60 Hz 调用。

### 2.5 测试 `tests/aero.test.mjs`

用 Node 内置 `node:test` 或自写断言，`node tests/aero.test.mjs` 可直接运行且退出码 0。
至少覆盖：

1. 海平面 M=1 时 q ≈ 70 kPa（±2%），V ≈ 340 m/s。
2. 11 km 处 T ≈ 216.65 K、rho ≈ 0.364 kg/m³（±5%）。
3. α=0, β=0, δ=0：Mx=My=Mz=0（Cm0 项除外，允许 |My| < 1 N·m）。
4. δe=+10°（其余 0，M0.8/5km）：My > 0；δr=+10°：Mz > 0；δa=+10°：Mx > 0。
5. α=+10°：My < 0（静稳定），α=−10°：My > 0。
6. 线性区：α 从 5° 到 10°，My 约翻倍（±10%）。
7. 失速：α=30° 时 |My| 小于线性外推值。
8. 所有输出字段均为有限数。

## 3. `js/charts.js` —— 力矩时间历程图（交给 charts 队友）

浏览器端类，无依赖，挂 `window.MomentChart`。

```js
const chart = new MomentChart(canvasEl, {
  color: '#D92B1F',   // 数据线颜色
  minRange: 10,       // 自动量程下限（保证小力矩不放大成噪声）
  maxSamples: 240,    // 历史样本数
  unit: 'N·m'         // 仅用于右上角量程文字
});
chart.push(value);    // 追加一个样本（N·m），触发重绘
chart.setValue(value);// 仅更新当前值标记，不追加
chart.resize();       // 依据 CSS 尺寸与 devicePixelRatio 重设画布
chart.clear();        // 清空历史
chart.draw();
```

视觉规范（瑞典/瑞士国际主义，克制的技术图表）：

- 透明背景（画布本身不填底色），父级为纸色 `#F1EFE9`。
- 无边框、无标题；**只画**：零线、数据线、当前值圆点、极淡的 ±中值辅助线。
- 零线：1px `rgba(20,20,20,0.28)`，贯穿左右。
- 数据线：1.5px 实线，圆角连接，不用阴影；线下方可选 6% 透明度填充。
- 当前值圆点：半径 3.2px，颜色同数据线，外加 1.5px 纸色描边。
- 自动对称量程：`range = max(maxAbs*1.18, minRange)`，量程变化做 0.15 的平滑插值，
  避免跳动；纵轴映射到画布上下各留 6px 内边距。
- 右上角：9px 等宽小字，颜色 `rgba(20,20,20,0.42)`，显示 `±<range>`（整数或一位小数）
  与单位。字体 `"Helvetica Neue", Arial, sans-serif`。
- 左边缘不加文字；不画坐标轴框。
- DPR：`canvas.width = clientWidth * dpr`，`ctx.setTransform(dpr,0,0,dpr,0,0)`。
- 历史点按 x 均布（最近的在最右）；不绘制滚动动画。
- 60Hz 下调用 push 不得导致明显卡顿（每帧一次 draw）。
- 兼容 canvas 2D，无外部库。

## 4. 设计令牌（UI 主控由 Lead 负责，charts 需遵守）

```css
--paper:#F1EFE9;  --panel:#E8E5DC;  --ink:#141414;  --ink-2:#55544D;
--ink-3:#8A887D;  --rule:#CFCBBE;  --red:#D92B1F;  --blue:#1B3FA8;  --yellow:#DE9E0A;
```

字体：`"Helvetica Neue", Helvetica, Arial, "PingFang SC", "Microsoft YaHei UI", sans-serif`；
数字等宽：`font-variant-numeric: tabular-nums`。

## 5. 交付检查

- `node tests/aero.test.mjs` 退出码 0，全部通过。
- 浏览器控制台无报错。
- 手机/桌面都不溢出。
- 不得修改职责范围之外的文件；不得引入外部依赖或 CDN。
