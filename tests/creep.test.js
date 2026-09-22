'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../public/foldEngine.js');

// 1×4 平行对折（line2 左瓣右折，line3 右瓣左折）：书帖为 4 叶平行嵌套，书脊沿横向
const STEPS_1x4 = [
  { axis: 'v', line: 2, dir: 'r' },
  { axis: 'v', line: 3, dir: 'l' }
];
const STEPS_1x2 = [{ axis: 'v', line: 1, dir: 'r' }];
const STEPS_2x2 = [
  { axis: 'v', line: 1, dir: 'r' },
  { axis: 'h', line: 1, dir: 'd' }
];

test('爬移补偿：前置条件与自动拼版一致（合法单叠可用）', () => {
  const elig = E.creepCompEligibility(1, 4, {}, STEPS_1x4);
  assert.equal(elig.ok, true);
  assert.equal(elig.capacity, 8);
});

test('爬移补偿：非法折叠 / 非单叠 / 网格非法时禁用并给出原因', () => {
  const bad = [
    { axis: 'v', line: 1, dir: 'r' },
    { axis: 'v', line: 2, dir: 'l' }
  ];
  let r = E.computeCreepComp(1, 3, {}, bad, 0.1, 3);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'thickness');
  assert.equal(r.stepIndex, 1);

  r = E.computeCreepComp(2, 3, {}, [{ axis: 'v', line: 1, dir: 'r' }], 0.1, 3);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'not_single_stack');
  assert.equal(r.stackCount, 4);

  r = E.computeCreepComp(0, 2, {}, [], 0.1, 3);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'bad_grid');

  assert.equal(E.creepCompEligibility(1, 3, {}, bad).ok, false);
});

test('爬移补偿：非法纸厚/出血返回对应错误码', () => {
  assert.equal(E.computeCreepComp(1, 4, {}, STEPS_1x4, -1, 3).code, 'bad_thickness');
  assert.equal(E.computeCreepComp(1, 4, {}, STEPS_1x4, NaN, 3).code, 'bad_thickness');
  assert.equal(E.computeCreepComp(1, 4, {}, STEPS_1x4, 0.1, -2).code, 'bad_bleed');
  assert.equal(E.computeCreepComp(1, 4, {}, STEPS_1x4, 0.1).code, 'bad_bleed');
  // 0 合法（出血为 0 时任何非零偏移都超出血）
  assert.equal(E.computeCreepComp(1, 2, {}, STEPS_1x2, 0, 0).ok, true);
});

test('爬移补偿：以叠顶为第 0 层，补偿量=纸厚×外侧叶数', () => {
  const r = E.computeCreepComp(1, 4, {}, STEPS_1x4, 0.1, 3);
  assert.equal(r.ok, true);
  assert.equal(r.leafCount, 4);
  assert.deepEqual(r.leaves.map((l) => [l.layer, l.outerLeaves]),
    [[0, 0], [1, 1], [2, 2], [3, 3]]);
  assert.deepEqual(r.leaves.map((l) => l.compensation), [0, 0.1, 0.2, 0.3]);
  assert.equal(r.maxCompensation, 0.3);
  // 叠顶即末态叠的最上面片（1×4 末叠格 (3,0) 顶层为原格 3,0）
  assert.equal(r.leaves[0].origin, '3,0');
});

test('爬移补偿：最末折决定书脊与前口→书脊方向', () => {
  // 1×4 最末步 dir=l（右瓣向左落，折口在终叠右侧）→ 内容向 +x 移动
  const r = E.computeCreepComp(1, 4, {}, STEPS_1x4, 0.1, 3);
  assert.equal(r.spineAxis, 'x');
  assert.deepEqual(r.dir, { x: 1, y: 0 });
  assert.deepEqual(r.lastStep, { axis: 'v', line: 3, dir: 'l' });
  assert.deepEqual(r.leaves.map((l) => l.dx), [0, 0.1, 0.2, 0.3]);
  assert.deepEqual(r.leaves.map((l) => l.dy), [0, 0, 0, 0]);
  // 反向最末折 dir=r（左瓣向右落）→ 内容向 -x 移动
  const stepsR = [
    { axis: 'v', line: 2, dir: 'l' },
    { axis: 'v', line: 1, dir: 'r' }
  ];
  assert.equal(E.replay(1, 4, {}, stepsR).error, null);
  const r2 = E.computeCreepComp(1, 4, {}, stepsR, 0.1, 3);
  assert.deepEqual(r2.dir, { x: -1, y: 0 });
  assert.equal(r2.leaves.find((l) => l.origin === '1,0').dx, -0.3);
});

test('爬移补偿：按面片朝向换算原始纸格正/反面带符号横向偏移', () => {
  const r = E.computeCreepComp(1, 4, {}, STEPS_1x4, 0.1, 3);
  const byOrigin = Object.fromEntries(r.leaves.map((l) => [l.origin, l]));
  // 层1 原格 0,0：一次竖直翻折 frame.x.x=-1
  assert.equal(byOrigin['0,0'].frontShift, 0.1);
  assert.equal(byOrigin['0,0'].backShift, -0.1);
  // 层2 原格 1,0：两次竖直翻折 frame.x.x=+1（静止瓣不翻面，符号仍按其末态朝向）
  assert.equal(byOrigin['1,0'].frontShift, -0.2);
  assert.equal(byOrigin['1,0'].backShift, 0.2);
  // 层3 原格 2,0：末步翻面 frame.x.x=-1
  assert.equal(byOrigin['2,0'].frontShift, 0.3);
  assert.equal(byOrigin['2,0'].backShift, -0.3);
  // 同一格正反面偏移互为相反数（第 0 层两者皆为 0）
  for (const l of r.leaves) assert.equal(Math.abs(l.frontShift + l.backShift) < 1e-12, true);
  assert.equal(r.maxAbsShift, 0.3);
});

test('爬移补偿：faces 逐面列表含原始格、面别、层与偏移，行优先正面在前', () => {
  const r = E.computeCreepComp(1, 4, {}, STEPS_1x4, 0.1, 3);
  assert.equal(r.faces.length, 8);
  assert.deepEqual(r.faces.map((f) => f.origin),
    ['0,0', '0,0', '1,0', '1,0', '2,0', '2,0', '3,0', '3,0']);
  assert.deepEqual(r.faces.map((f) => f.face),
    ['front', 'back', 'front', 'back', 'front', 'back', 'front', 'back']);
  assert.deepEqual(r.faces.map((f) => f.shift),
    [0.1, -0.1, -0.2, 0.2, 0.3, -0.3, 0, 0]);
  assert.ok(r.faces.every((f) => f.overBleed === false));
});

test('爬移补偿：偏移绝对值超过出血时列出超出血面并 canApply=false', () => {
  // 出血 0.05：层1 的 |0.1| 已超出
  const r = E.computeCreepComp(1, 4, {}, STEPS_1x4, 0.1, 0.05);
  assert.equal(r.canApply, false);
  const overKeys = r.overBleed.map((o) => `${o.origin}:${o.face}`).sort();
  assert.deepEqual(overKeys, [
    '0,0:back', '0,0:front',
    '1,0:back', '1,0:front',
    '2,0:back', '2,0:front'
  ]);
  // faces 同步标记
  assert.equal(r.faces.find((f) => f.origin === '2,0' && f.face === 'front').overBleed, true);
  assert.equal(r.faces.find((f) => f.origin === '3,0' && f.face === 'front').overBleed, false);
  // 临界等值不算超出（严格大于）
  const eq = E.computeCreepComp(1, 2, {}, STEPS_1x2, 0.1, 0.1);
  assert.equal(eq.canApply, true);
  assert.deepEqual(eq.overBleed, []);
});

test('爬移补偿：1×2 骑马钉（最末折 dir=r 指向 -x）偏移与叠层顺序', () => {
  const r = E.computeCreepComp(1, 2, {}, STEPS_1x2, 0.1, 3);
  assert.equal(r.leafCount, 2);
  assert.deepEqual(r.dir, { x: -1, y: 0 });
  const byOrigin = Object.fromEntries(r.leaves.map((l) => [l.origin, l]));
  // 叠顶 = 移动过来的原格 0,0（最外叶，0 补偿）；底 = 静止的 1,0（内叶，0.1）
  assert.equal(r.leaves[0].origin, '0,0');
  assert.equal(byOrigin['1,0'].compensation, 0.1);
  assert.equal(byOrigin['1,0'].dx, -0.1);
  assert.equal(byOrigin['1,0'].frontShift, -0.1);
  assert.equal(byOrigin['1,0'].backShift, 0.1);
});

test('爬移补偿：直角折 2×2 书脊沿原始纵向，横向偏移恒为 0（爬移走 dy）', () => {
  const r = E.computeCreepComp(2, 2, {}, STEPS_2x2, 0.1, 3);
  assert.equal(r.spineAxis, 'y');
  assert.deepEqual(r.dir, { x: 0, y: -1 });
  assert.equal(r.maxAbsShift, 0);
  assert.equal(r.maxCompensation, 0.3);
  assert.ok(r.faces.every((f) => f.shift === 0));
  assert.deepEqual(r.leaves.map((l) => l.dx), [0, 0, 0, 0]);
  assert.deepEqual(r.leaves.map((l) => l.dy), [0, -0.1, -0.2, -0.3]);
  assert.equal(r.canApply, true);
});

test('爬移补偿：单格无折叠（唯一叶）时补偿为 0、lastStep 为 null', () => {
  const r = E.computeCreepComp(1, 1, {}, [], 0.1, 3);
  assert.equal(r.ok, true);
  assert.equal(r.leafCount, 1);
  assert.equal(r.lastStep, null);
  assert.equal(r.maxCompensation, 0);
  assert.deepEqual(r.faces.map((f) => f.shift), [0, 0]);
  assert.equal(r.canApply, true);
});

test('爬移补偿：纸厚为 0 时全部偏移为 0，恒可应用', () => {  const r = E.computeCreepComp(1, 4, {}, STEPS_1x4, 0, 0);
  assert.equal(r.canApply, true);
  assert.equal(r.maxCompensation, 0);
  assert.equal(r.maxAbsShift, 0);
  assert.deepEqual(r.overBleed, []);
});

test('爬移补偿：与标签无关，且为纯函数不改写方案', () => {
  const labels = { '0,0': { front: '4', back: '1' } };
  const steps = STEPS_1x4.map((s) => ({ ...s }));
  const snapL = JSON.stringify(labels);
  const snapS = JSON.stringify(steps);
  const r = E.computeCreepComp(1, 4, labels, steps, 0.25, 2);
  assert.equal(r.ok, true);
  assert.equal(JSON.stringify(labels), snapL);
  assert.equal(JSON.stringify(steps), snapS);
});

test('爬移补偿：结果可经 normalizePlan 作为 creepComp 字段往返', () => {
  const r = E.computeCreepComp(1, 4, {}, STEPS_1x4, 0.1, 3);
  const comp = {
    thickness: r.thickness, bleed: r.bleed, spineAxis: r.spineAxis,
    leaves: r.leaves.map((l) => ({
      layer: l.layer, origin: l.origin, outerLeaves: l.outerLeaves,
      compensation: l.compensation, frontShift: l.frontShift, backShift: l.backShift
    })),
    faces: r.faces.map((f) => ({ origin: f.origin, face: f.face, layer: f.layer, shift: f.shift }))
  };
  const plan = E.normalizePlan({ name: '爬移', rows: 1, cols: 4, labels: {}, steps: STEPS_1x4, creepComp: comp });
  assert.ok(plan.creepComp);
  assert.equal(plan.creepComp.thickness, 0.1);
  assert.equal(plan.creepComp.bleed, 3);
  assert.equal(plan.creepComp.spineAxis, 'x');
  assert.deepEqual(plan.creepComp.faces, comp.faces);
  // 不含该字段时为 null
  assert.equal(E.normalizePlan({ rows: 1, cols: 1 }).creepComp, null);
});

test('爬移补偿：creepComp 字段结构非法时 normalizePlan 抛错', () => {
  assert.throws(() => E.normalizePlan({ rows: 1, cols: 1, creepComp: { thickness: -1, bleed: 3 } }),
    /thickness/);
  assert.throws(() => E.normalizePlan({ rows: 1, cols: 1, creepComp: { thickness: 1, bleed: 'x' } }),
    /bleed/);
  assert.throws(() => E.normalizePlan({ rows: 1, cols: 1, creepComp: { thickness: 1, bleed: 1, faces: [{ origin: 'bad', face: 'front', layer: 0, shift: 0 }] } }),
    /origin/);
  assert.throws(() => E.normalizePlan({ rows: 1, cols: 1, creepComp: { thickness: 1, bleed: 1, faces: [{ origin: '0,0', face: 'side', layer: 0, shift: 0 }] } }),
    /face/);
});
