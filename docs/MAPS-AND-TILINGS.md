# 地图与密铺维护

## 生成与接入官图

密铺编号按顺序记录内点周围多边形的边数。例如 `3.4.6.4` 的内点依次接触三角形、正方形、六边形和正方形。有限棋盘的外沿与空洞边缘只保留部分多边形。

| 密铺 | 构造方式 | 官图 |
| --- | --- | --- |
| `3.4.6.4` | 六边形中心沿晶格排布，正方形桥接两条平行的六边形边，三角形填入其间 | 六角织城 `hexweave` |
| `3.3.3.4.4` | 每个重复单元包含一个正方形和两个三角形，排与排之间水平错开半条边 | 长阶回廊 `terrace` |
| `3.3.4.3.4` | 每个重复单元包含两个朝向不同的正方形和四个三角形，沿两条斜向向量平移 | 旋方阵列 `rotor` |
| `3.3.3.3.6` | 在三角晶格上取满足 `(col - 2 * row) % 7 === 0` 的中心，以六边形替换每个中心周围的六个三角形 | 扭棱星环 `star-ring` |

[`lib/mixed-tilings.ts`](../lib/mixed-tilings.ts) 的 `mixedTilingTiles` 返回单位边长的实际顶点和各格的 `row/col`。新增密铺的工坊尺寸表示铺设范围，可选 6–20，每个重复单元可以包含多个格子。两个尺寸设为 20 时，旋方阵列密铺达到 2,400 格。工坊之外的官图可使用更小的铺设范围。

[`lib/explosion-game.ts`](../lib/explosion-game.ts) 的 `createEditorMap` 为这些顶点生成基础格并调用 `compileCells`。新增同类密铺时同步更新 `MIXED_TILINGS`、`BOARD_TOPOLOGY_NAMES`、生成器和测试。地图列表和新房间使用 `MAP_LIBRARY`，已有房间用 `findOfficialMap` 按 ID 恢复原布局。对局地图对象也会发往预览和人机 Worker，构图回调留在工厂内部，返回值须能通过结构化克隆。

## 共边、槽位与强化方向

新增三路竞渡（87 格）和三核共振（66 格）。三路竞渡用单排中桥与双排侧桥区分传播速度和蓄能空间。三核共振用同一三六混合密铺的三处六槽枢纽组成环带，每个枢纽预充两点。

歧湾战场用西侧岬角、东侧长岸和一宽一窄两条通道形成不对称布局，两枚预充能晶体集中在东岸。折光阀阵使用 `3.4.6.4` 密铺。两处五槽方格各沿一条真实共边向二槽被动三角阀传递两点能量，阀门可继续引爆预充至临界的方格。

| 官图 | 格数 | 争夺点 |
| --- | ---: | --- |
| 方寸庭 | 20 | 双人短局，中央空洞迫使攻势从两侧接近 |
| 双环回路 | 108 | 四处接口连接两环，玩家可在环内传播和跨环推进之间选择 |
| 错岸三城 | 85 | 不对称三区，一格被动闸提供北侧捷径，南侧两处连接提供替代路线 |
| 横潮梯 | 59 | `3.3.3.4.4` 的两排五槽方格背向强化，中间三角带可接续另一排 |
| 合流闸室 | 108 | `3.3.4.3.4` 的二槽被动阀累计两点才炸，可利用对手送来的第一点 |
| 偏心炉 | 74 | `3.3.3.3.6` 的八槽主炉预充四点，两条金边同时点燃不同方向的临界三角格 |

三角回廊、棱镜拼图、三角潮汐、脉冲棱镜、长阶回廊、旋方阵列和扭棱星环使用修订布局。官图裁切递归移除只有一条共边连接的边缘格，长阶回廊和旋方阵列同时缩小。四象闸阵保留被动单槽机关。工坊仍可制作自定义布局。七张修订图使用新 ID，联机服务端和客户端可用旧 ID 恢复原布局。

- `compileCells` 将每个边端点量化至百万分之一单位并组合成无向键。某条完整边由恰好两个启用的格子拥有时，双方才互为邻居。仅顶点接触、外沿及空洞边缘均不会传递能量。自动容量根据有效邻居数重算，容量最低为 1，孤立格由 `validateMap` 报告。
- 新密铺的 `neighborEdges` 与 `neighbors` 位置对应，`E1` 表示从该格的第一个顶点到第二个顶点，最后一边接回第一个顶点。编号属于源格。挖空后剩余边保留原编号。旧版方形、三角、六边及三六角混合密铺保留 `U/R/D/L/UL/UR/DL/DR` 格式，`edgeLabel` 的中文方位只用于展示。
- `boostDirections` 保存所选的边 ID，`boosted` 是编译后对应的目标索引，`getTransferPlan` 优先向这些邻居分配余数能量。当手动容量大于有效邻居数且存在余数时，需选满余数对应的边数。容量、空洞或尺寸改动后由 `compileCells` 清理失效边，`validateMap` 提示仍需选择的强化边。
- 同一密铺调整尺寸时，`resizeEditorMap` 用 `row/col` 保留仍存在的格子设置。切换到另一种混合密铺时重新生成格子。修改已发布生成器时，稳定的 `row/col`、同尺寸的输出顺序、每格顶点顺序均涉及存档兼容。需要改动这些顺序时同时设计旧存档迁移。

## 工坊与存档入口

- [`components/map-editor.tsx`](../components/map-editor.tsx) 从 `BOARD_TOPOLOGY_NAMES` 读取密铺选项，按当前格的实际邻居列出可强化的边。鼠标悬停、键盘聚焦或触屏点选时传给 `GameBoard` 的 `highlightedEdge` 使用同一个边 ID。工坊导出的 JSON 为 `version: 1`、密铺、尺寸与按 `row/col` 标识的格子属性列表。导入时由 `createEditorMap` 重建几何。
- 工坊在画布上方显示选中格编号、类型与精确能量，格内使用与对局相同的分段槽位。恢复画笔可补回空洞并把格子属性恢复为默认。撤销和重做保留当前工坊会话的最近 16 步，适用于逐格编辑、改名、导入、密铺、尺寸和恢复全部。一次滑块拖动记录一步。保存和试玩使用当前编辑结果。
- [`app/page.tsx`](../app/page.tsx) 在浏览器 `localStorage` 的 `chainburst-custom-maps-v2` 键下保存四个槽位，外层为 `version: 2`。每个非空槽位是 `serializeCustomMap` 生成的 `CustomMapSnapshot` v1，仅存按 `index` 标识的非默认格。旧键 `chainburst-custom-map` 经 `migrateLegacyCustomMap` 迁移。
- [`components/online-play.tsx`](../components/online-play.tsx) 创建或配置房间时提交官图 ID 或自制图 ID 与快照。[`app/api/online/route.ts`](../app/api/online/route.ts) 重建并校验快照、ID、目标人数与地图连通性，联机自制图最多 2,400 格，请求正文上限 256 KiB。参战客户端再用 `deserializeCustomMap` 重建地图。工坊导出文件与联机快照都标为 v1，字段结构不同。

## 旋转格的显示与动画

- [`components/game-board.tsx`](../components/game-board.tsx) 与 [`components/game-lobby.tsx`](../components/game-lobby.tsx) 通过 `cellLayoutStyle` 使用同一套实际顶点生成 `clip-path`。棋盘轮廓由 `cellPolygonPoints` 向格中心内缩。旋转格的锁、特殊标记和分段槽位使用 [`lib/energy-layout.ts`](../lib/energy-layout.ts) 中按内切半径计算的位置。能量棋子同样按实际几何缩放，总览、放大和触屏操作见 [棋盘缩放与落子预览](BOARD-INTERACTIONS.md)。
- 强化边和工坊高亮用 `insetSharedEdgeSegment` 绘制，线段向格内缩进并与实际共边平行。爆炸由 `explodeWave` 生成源格、目标格和能量数。动画通过 `normalizedTransferRoute` 经过源格中心、真实共边中点、目标格中心。关键帧和旋转格覆盖层样式在 [`app/globals.css`](../app/globals.css)。

## 回归清单

在项目根目录运行以下命令。第一条涵盖四种密铺的内部顶点顺序、6×7 与 20×20 连通性、单位共边、动画中点、斜向强化边的传递与存档。其余两条覆盖旧密铺、规则、人机和预览，以及 TypeScript 检查。

```powershell
node --experimental-strip-types --test tests/mixed-tilings.test.mjs tests/board-geometry.test.mjs tests/energy-layout.test.mjs tests/worker-transport.test.mjs
npm test
node node_modules/typescript/bin/tsc --noEmit --incremental false
```

浏览器里逐张打开四张官图，确认大厅缩略图与棋盘外形一致。缩放并检查斜边格的点击范围、锁、分段槽位和棋子。工坊内为旋转格设置带余数的手动容量，观察边选项和棋盘高亮是否一致，保存并重新导入后试玩，确认爆炸沿同一边传递额外能量。挖空一个相邻格后重查剩余边。最后用两个会话开一局自制图，检查双方棋盘与结算一致。按 [联机房间维护](ONLINE-ROOMS.md#本地验证) 运行的本地 API 冒烟使用旧三六角自制图，四种新密铺可按上述步骤单独实测。
