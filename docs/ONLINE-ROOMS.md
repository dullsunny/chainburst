# 联机房间维护

线上是 2–6 位真人通过房间码对战。`app/api/online/route.ts` 接收 `POST /api/online` 的 JSON，服务端用 `lib/match-engine.ts` 的 `resolveTurn` 判定合法性、连锁、换手和胜负；`components/online-play.tsx` 负责席位会话、轮询、预览和动画。`lib/online-types.ts` 定义房间视图和落子事件。本地人机不进入联机房间。

## 房间与操作

邀请链接的 `?room=…` 只携带 6 位房间码。`create` / `join` 返回席位凭证；浏览器在 `chainburst-online-session` 保存 `{code, token}`，刷新时凭它请求 `snapshot`。数据库只存席位凭证的 SHA-256 摘要，房间视图也不返回摘要。测试两个席位请用独立浏览器配置或普通窗口加隐私窗口，避免共用同源存储。

| `action` | 生效条件及结果 |
| --- | --- |
| `create` / `join` | 建房时指定昵称、人数、地图和模式，房主占首席。新玩家仅在等待且未满员时加入；客户端可重用同一次加入的 `claimToken` 以恢复同一席位。 |
| `snapshot` | 用房间码和席位凭证获取当前权威快照。读请求不延长房间寿命。 |
| `configure` / `ready` / `start` | 等待室里房主可换地图、调整人数、设置落子预览；人数不可低于已入座数，应用后全员重新准备。模式在建房时确定。每人控制自己的准备状态；满员且全员就绪后，由房主开局，服务端随机决定先手。 |
| `move` | 只有行动席位可以提交。请求带 `cellIndex`、`expectedRevision` 和本次操作唯一的 `commandId`。成功返回结算后的棋局及该步动画事件。 |
| `proposeAbort` / `voteAbort` / `cancelAbort` | 进行中任何玩家可在动画结束后提议结束本局，发起人自动赞成。表决期间暂停落子；全员同意则保留席位回等待室。反对、发起人或房主取消、90 秒过期均恢复原局。投票和取消须带 `proposalId`。 |
| `returnToRoom`（旧名 `rematch`） | 胜负或平局结算并过动画门槛后，任一席位可带全员回等待室，清除棋局、动画和准备状态，保留地图设置和席位。 |
| `leave` | 等待室或终局可释放席位；终局须先过动画门槛，进行中须先表决结束。剩余玩家回等待室、席位重排；房主离开时由首位剩余玩家接任，最后一席离开则删除房间。 |

除建房和新加入外，其余操作须携带 `code` 和 `token`。除 `snapshot` 和 `leave` 外，已认证操作须带当前 `expectedRevision`。当前网页仅修改落子预览时，“应用房间设置”仍会禁用；API 支持单独修改，网页可在修改人数或地图时一并应用。

双脉冲模式每回合分两次合法落子，每次 1 点、独立结算，第二次不可选首格。首步获胜或无合法第二格时不再落第二次。`turnNumber` 统计回合，`moves` 统计实际落子；刷新从 `turnStep` 和 `firstMoveIndex` 恢复。旧 `rulesVersion: 1` 快照读取时补成 v2，从当前回合边界开始适用双步，历史动画事件的 `amount` 保持原值。

疆域赛在开局时将占领比例写到 `match.dominionPercent`。新开局为 65%，按启用格数向上取整；早期无此字段的快照按 60% 恢复，已经开打或结束的棋局保留原规则。API、预览和结果说明都读取本局阈值，无需 SQL 迁移。

## D1、地图与并发

- `wrangler.jsonc` 将 D1 绑定为 `DB`，同时用于本地模拟和部署构建。实际部署时填写自己的 D1 数据库名称与 ID，见 [联机版部署](SELF-HOST.md)。`db/schema.ts` 是 Drizzle 表定义，初始 SQL 为 `drizzle/0000_simple_thunderbird.sql`。表结构变更时更新 schema 并用 `npm run db:generate` 生成、审查迁移。旧房间缺少 `previewEnabled` 时按开启读取，上述快照升级只涉及 JSON，无需 SQL 迁移。
- `online_rooms` 按房间码保存 `revision`、`state_json`、时间和最近落子的幂等字段。状态包含席位、房主、地图、棋局、最近一步和表决。创建及成功写入将有效期设为自该次写入起 24 小时；读请求视过期房间为不存在，后续建房时清理过期记录。`online_commands` 以 `(room_code, command_id)` 存请求摘要和已提交结果，随房间删除级联清理。
- 自制图由 `serializeCustomMap` 打包为版本化稀疏快照（尺寸、拓扑及空洞/容量/预充能/强化边覆盖项）；服务器重新生成几何和邻接，经 `validateMap` 验证连通性、可入场格和特殊规则，并限制生成后总格数为 2400、整个请求体为 256 KiB。房间保有独立快照，房主后续编辑或删除本地槽位不会改变已创建的房间；换图须在等待室重新应用。内置图通过 `mapId` 查 `MAP_LIBRARY`，若更新布局或索引，须考虑旧局快照的兼容性。
- 写操作用 `WHERE code = ? AND revision = ?` 做条件更新。进行中若表决操作推进了房间版本，必须同时推进 `match.revision`，否则取消或拒绝后下一手会被判 `STALE_REVISION`。自然到期不写数据库；客户端也比较提议是否存在，因此同一版本能解除表决状态。
- 落子以 D1 批次提交房间更新和命令记录；进行中且未暂停表决时，可用相同 `commandId` 和相同参数取回已提交响应，不重复注能。不要把同一 ID 用在不同格子或版本上。遇到 `STALE_REVISION`、`ROOM_CHANGED` 或不确定最后一手是否已结束对局时，先拉快照再由用户确认。`TURN_NOT_READY`（HTTP 425）携带 `retryAt`，表示服务端的连锁播放窗口尚未结束。

## 同步与动画

客户端正常每秒请求 `snapshot`，持续离线时每 3 秒重试。旧版本响应不覆盖新状态；会话切换后忽略旧请求。仅在收到相邻版本且 `lastTurn.revision` 与新版本相符时，用上一份快照及本步的 `actor`、`amount`、`waves` 重播；刷新、错过版本或切换房间时直接恢复最新棋盘。房间不保存完整录像，深层联机连锁最多重播前 24 波，再应用权威终态。服务端记录 `readyAt`，在此之前禁止下一手，并阻止会中断最终动画的离开或回房操作。客户端预览只计算假设结果，不发落子请求，不能取代服务端检查。

## 本地验证

已安装依赖时，以下步骤使用独立的本地 D1 目录。迁移命令会跳过已经应用的 SQL 文件。

```powershell
npm run build
npx wrangler d1 migrations apply DB --local --config dist/server/wrangler.json --persist-to .wrangler/online-smoke
npm run start -- --port 3000 --persist-to .wrangler/online-smoke
```

另开终端运行 `node --experimental-strip-types scripts/check-online-double-step.mjs`。脚本固定访问 `http://localhost:3000/api/online`，验证自制图、房主权限、预览设置、准备重置、双步与同格拒绝、重连、幂等和退出清理。`npm test` 验证纯引擎及预览规则。人工回归可再用两个独立会话检查表决拒绝后能继续落子，以及终局回房后两边均能再次准备。若本地提示数据库不可用或缺表，先核对运行中的 Wrangler 配置、`DB` 绑定和 `--persist-to` 是否与迁移时一致。

在受限的 Windows 工作区，若 Wrangler 的默认日志或注册目录不可写，可在运行上述命令的 PowerShell 中设置 `$env:WRANGLER_WRITE_LOGS='false'`、`$env:WRANGLER_LOG_PATH='.wrangler/logs'` 和 `$env:MINIFLARE_REGISTRY_PATH='.wrangler/registry'`。这些值只影响当前终端。
