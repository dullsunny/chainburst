# 爆炸棋 · Chainburst

《爆炸棋》是一款 2–6 人的连锁棋类游戏，支持本地同屏、四档人机和私人房间联机。提供 26 张官图、三种规则模式、分章节教程和四槽位地图工坊。

**第一次玩**从下方的快速上手开始，也可以直接打开游戏右上角的「教程」。想查完整规则、地图特点和对局操作，请看[分章游戏手册](docs/GAME-GUIDE.md)。

**接手维护**请先看 [AGENTS.md](AGENTS.md)，再按 [Agent 部署与发布指南](docs/AGENT-DEPLOYMENT.md) 选择本地验证、离线打包、自托管部署或 GitHub 发布流程。

## 下载

| 版本 | 下载 | 用法 |
| --- | --- | --- |
| 单机版 | [chainburst-offline-v1.0.0.zip](https://github.com/dullsunny/chainburst/releases/download/v1.0.0/chainburst-offline-v1.0.0.zip) | 解压后用浏览器打开 `chainburst-offline.html`。支持同屏、人机、教程和地图工坊，完全离线。 |
| 自托管联机版 | [chainburst-selfhost-v1.0.0.zip](https://github.com/dullsunny/chainburst/releases/download/v1.0.0/chainburst-selfhost-v1.0.0.zip) | 附带已构建的 Worker、数据库迁移和中文说明。部署到自己的 Cloudflare Workers 与 D1 后，朋友可以通过房间码加入。[自托管部署](docs/SELF-HOST.md) |

可直接打开 [在线演示](https://baozhaqi-arena.flowy-chair-7964.chatgpt.site/)，也可在 [GitHub Releases](https://github.com/dullsunny/chainburst/releases) 查看其他版本。

## 第一章　快速上手

1. 第一次建议选「经典竞技场」6×6 方阵、2 人和经典模式。独自玩时点「人机对战」，也可以在席位设置中调难度。
2. 每次落子给一个格子加 1 点能量。你可以选完全空的中立格，或者给自己的格子继续蓄能。空中立格获得能量后会变成你的颜色。
3. 能量槽一满，格子就会爆炸。经典方阵的角落只要 2 点，边缘要 3 点，内部要 4 点。给一个已有 1 点的己方角格再加 1 点，它炸空后，会给两个共边格各送 1 点，并夺下收到能量的格子。
4. 被送满的格子会在下一波接着炸，可能跨过几格扭转局势。等整段连锁结算完，才能继续下一步。

游戏内「教程」有 10 课，从第一步落子到亲手赢下一场残局。「规则书」支持按关键词查阅，还能逐帧查看连锁。[分章游戏手册](docs/GAME-GUIDE.md)

## 第二章　三种玩法

| 模式 | 每回合 | 获胜目标 |
| --- | --- | --- |
| 经典模式 | 加 1 点 | 成为棋盘上唯一有领地的一方，且占领超过一半有效格 |
| 双脉冲 | 依次给两个不同的格子各加 1 点，每步独立结算 | 同经典。首步获胜立即结束，若无合法第二步则交回合 |
| 疆域赛 | 加 1 点 | 新局率先占至少 65% 的有效格，向上取整。6×6 棋盘需要 24 格，其他玩家可以仍有领地 |

只要棋局未结束，失去全部领地的玩家有可用的空中立格便能再入场。空洞不计入胜利所需格数。特殊终局和双脉冲的细节见[完整规则](docs/GAME-GUIDE.md)。

## 第三章　地图、特殊格和自制地图

- **经典方阵**适合练边角和连锁。**三角与六边密铺**会改变分支数量。**混合地图**常有桥口、空洞和需要先点燃的机关。只有实际共用一整条边的有效格才相邻。
- **预充能中立格**只能靠爆炸传能占领。**被动格**的容量低于邻居数，只能通过传能触发，爆炸仍给每个邻居送 1 点。**强化格**容量高于邻居数，特定边可能获得额外能量。
- **地图工坊**有 4 个本地槽位，可切换密铺、挖空、调整容量或预充能、选择强化边。支持撤销、重做、导入及导出 JSON。换设备前可导出地图。联机建房采用选中自制图的单独快照。

[地图玩法示例](docs/GAME-GUIDE.md) · [密铺和地图维护](docs/MAPS-AND-TILINGS.md)

## 第四章　和朋友联机

双方打开同一套联机站点，房主创建房间，朋友通过邀请链接或房间码加入。所有人准备后由房主开始。刷新或短暂断线后，原浏览器会尝试恢复席位。想使用自己的地址，按自托管指南部署联机包。[自托管联机指南](docs/SELF-HOST.md)

## 从源码构建

使用 Node.js **22.13.0 或以上版本**，在仓库根目录运行：

```powershell
npm ci
npm run db:migrate:local
npm run dev
```

打开终端显示的本地地址，通常为 `http://localhost:3000/`。单独运行 `npm run build:offline` 可生成 `outputs/offline/chainburst-offline.html`。

要复现发布包，保持数据库配置为占位值，依次运行 `npm run build:offline`、`npm run build` 和 `npm run package:release`。生成的 ZIP 与 SHA-256 校验清单位于 `outputs/release/`。Windows 使用系统的 `tar.exe`，其他系统需安装 `zip`。

## 代码导航

| 任务 | 从这里进入 | 对应验证 |
| --- | --- | --- |
| 棋局规则、回合、胜负 | [结算引擎](lib/match-engine.ts)、[规则和棋盘](lib/explosion-game.ts)、[模式](lib/game-modes.ts) | [引擎测试](tests/engine.test.mjs)、[AI 与引擎差分](tests/ai.test.mjs) |
| 疆域赛比例评估 | [配对试玩记录与结论](docs/DOMINION-PLAYTEST.md) | [模拟复跑脚本](scripts/benchmark-dominion.mjs) |
| 官图、密铺、加强边和工坊 | [地图与密铺维护](docs/MAPS-AND-TILINGS.md)、[工坊](components/map-editor.tsx) | [密铺](tests/mixed-tilings.test.mjs)、[加强边几何](tests/board-geometry.test.mjs)、[棋子布局](tests/energy-layout.test.mjs) |
| 棋盘缩放、预览和动画 | [棋盘交互说明](docs/BOARD-INTERACTIONS.md)、[共用棋盘](components/game-board.tsx)、[预览 hook](hooks/use-move-preview.ts) | [落子预览](tests/move-preview.test.mjs)、[Worker 通信](tests/worker-transport.test.mjs) |
| 人机策略和搜索 | [AI 策略](docs/AI-STRATEGY.md)、[模拟与搜索](lib/game-ai.ts)、[AI Worker](workers/game-ai.worker.ts) | [人机测试](tests/ai.test.mjs)、[强度基准](scripts/benchmark-ai.mjs) |
| 房间协议和 D1 | [联机房间维护](docs/ONLINE-ROOMS.md)、[API](app/api/online/route.ts)、[联机界面](components/online-play.tsx) | [本地 API 冒烟](scripts/check-online-double-step.mjs) |
| 规则书、教程与练习 | [教学界面](components/learning-center.tsx)、[练习局面](lib/learning-scenarios.ts) | [教学测试](tests/learning-scenarios.test.mjs) |

[页面入口](app/page.tsx)负责在大厅、本地对局、工坊和联机之间切换，并管理本地对局、玩家设置及自制地图槽位。

人机提供入门、标准、困难、大师四档，每步计算预算分别为 18 / 120 / 700 / 2200 毫秒。[人机策略和测试记录](docs/AI-UPGRADE-2026-11-14.md)

## 验证改动

```powershell
npm test
node node_modules/typescript/bin/tsc --noEmit --incremental false
git diff --check
```

可单独运行 `node --experimental-strip-types --test tests/mixed-tilings.test.mjs`。涉及房间状态的变更，可按 [联机维护说明](docs/ONLINE-ROOMS.md) 在本地 D1 验证。

人机基准直接对照本次修改前的 v14 AI，包含当前双脉冲规则；历史 v8 fixture 仅保留追溯用途。

```powershell
npm run test:ai-benchmark -- --time=200
npm run test:ai-benchmark -- --production --scale=0.1
npm run test:ai-benchmark -- --levels --scale=0.1 --map=classic-6
npm run test:ai-benchmark -- --multiplayer --time=100
npm run test:ai-latency
```

`--levels` 测试相邻档位；`--production` 使用双方各自默认预算；`--scale` 等比缩短这些预算（搜索有 10ms 下限）。默认同预算基准不受 scale 影响。`--output=work/result.jsonl` 追加逐局机器可读结果，请为每次运行选择新文件。缩小预算的结果不能等同于完整默认预算胜率，延迟测试始终使用完整默认预算。

## Agent 接手

[AGENTS.md](AGENTS.md) 记录跨模块约束和交接内容。[Agent 部署与发布指南](docs/AGENT-DEPLOYMENT.md) 提供环境配置、构建命令、D1 迁移、联机验证、GitHub 发布前检查和回退指引。

## 许可证

项目源码使用 [MIT 许可证](LICENSE)。下载包随附所打包的第三方组件许可。
