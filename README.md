# 爆炸棋 · Chainburst

《爆炸棋》是一款 2–6 人的连锁棋类游戏，支持本地同屏、四档人机和私人房间联机。提供 26 张官图、三种规则模式、分章节教程和四槽位地图工坊。

## 下载

| 版本 | 下载 | 用法 |
| --- | --- | --- |
| 单机版 | [chainburst-offline-v1.0.0.zip](https://github.com/dullsunny/chainburst/releases/latest/download/chainburst-offline-v1.0.0.zip) | 解压后用浏览器打开 `chainburst-offline.html`。支持同屏、人机、教程和地图工坊，完全离线。 |
| 自托管联机版 | [chainburst-selfhost-v1.0.0.zip](https://github.com/dullsunny/chainburst/releases/latest/download/chainburst-selfhost-v1.0.0.zip) | 附带已构建的 Worker、数据库迁移和中文说明。部署到自己的 Cloudflare Workers 与 D1 后，朋友可以通过房间码加入。见 [自托管部署](docs/SELF-HOST.md)。 |

想先试一局，可以打开 [在线演示](https://baozhaqi-arena.flowy-chair-7964.chatgpt.site/)。

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

[AGENTS.md](AGENTS.md) 记录跨模块约束、并行分工与交接内容。开发从 Git 工作副本开始，仓库旁的历史构建归档仅用于对应版本的发布追溯。

## 许可证

项目源码使用 [MIT 许可证](LICENSE)。下载包随附所打包的第三方组件许可。
