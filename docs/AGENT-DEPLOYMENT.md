# Agent 接手与部署手册

这份手册从源码分支开始，覆盖本地验证、单机和联机打包、GitHub Release、自有 Cloudflare 部署及回退。已经下载联机压缩包、只想开服的使用者可直接按 [联机版部署说明](SELF-HOST.md) 操作。

## 1. 确认工作目标与版本

公开仓库是 `dullsunny/chainburst`。GitHub 的源码与 Release 提供下载，站点演示使用单独管理的 Sites 项目。任意自托管实例的 Worker 和 D1 由部署者自己的 Cloudflare 账户管理。开始前先确认本次任务是改源码、做下载包、发布 GitHub Release、更新某个自托管实例，还是更新既有 Sites 演示。它们各自有发布入口和版本记录。 [公开仓库](https://github.com/dullsunny/chainburst) · [在线演示](https://baozhaqi-arena.flowy-chair-7964.chatgpt.site/)

已有工作副本先读 `AGENTS.md`，核对下面的输出，保留已有改动。若要复现已发布的版本，用确切 tag 建分支，避免随 `main` 前进。示例中的 `v1.0.0` 是第一个开源版本，其他版本换成所需 tag。

~~~sh
git status --short --branch
git remote -v
git log -1 --oneline
git fetch origin --tags
git switch -c work/next-release origin/main
~~~

全新工作副本先运行 `git clone https://github.com/dullsunny/chainburst.git`，再进入 `chainburst`。若只核对历史产物，把上面的分支来源换成 `v1.0.0`。本机转交的工作副本可能没有持久远端，按实际仓库地址核对后再运行 fetch、push 等涉及远端的命令。

| 平台 | 本机准备 |
| --- | --- |
| Windows | PowerShell、Git、Node.js ≥ 22.13.0。打包脚本调用系统的 `tar.exe`。若 PowerShell 执行策略拦截 `npm.ps1`，在同一目录用 `npm.cmd` 和 `npx.cmd`，或改在命令提示符运行。 |
| macOS | Git、Node.js ≥ 22.13.0，发布包需要命令行 `zip`，校验可用 `shasum`。 |
| Linux | Git、Node.js ≥ 22.13.0，发布包需要命令行 `zip`，校验可用 `sha256sum`。 |

Node 版本用 `node --version` 核对。GitHub CLI 只在选择 CLI 发布或下载时需要。命令默认在仓库根目录执行，区分终端中多条命令的退出状态。依赖按锁文件安装。

~~~sh
npm ci
~~~

定位实现时，联机 API 位于 `app/api/online/route.ts`，引擎位于 `lib/match-engine.ts`，单机入口在 `offline/` 和 `vite.offline.config.ts`，生产 Worker 构建用 `vite.config.ts` 与 `wrangler.jsonc`。 [代码导航](../README.md#代码导航) · [联机状态与快照](ONLINE-ROOMS.md)

## 2. 本地开发与生产构建验证

日常浏览器开发使用 Vite 与本地模拟 D1。仓库中的 `wrangler.jsonc` 自带占位 UUID `00000000-0000-4000-8000-000000000000`，本地即可使用。打开终端输出的 URL，通常是 `http://localhost:3000/`。

~~~sh
npm run db:migrate:local
npm run dev
~~~

首次应用迁移时，Wrangler 的交互终端可能询问是否继续。核对输出是 `Resource location: local`、迁移清单与你预期一致，再按提示确认。

提交前运行下面的检查。地图邻接、局面结算、AI、预览和教学已有测试，优先用相关测试定位失败。类型检查和 Git 检查应在拟发布的同一提交上运行。

~~~sh
npm test
node node_modules/typescript/bin/tsc --noEmit --incremental false
git diff --check
~~~

验收联机版时，先停止占用 3000 端口的开发服务。构建产物以 `dist/server/wrangler.json` 作为 Wrangler 入口，迁移仍从仓库的 `drizzle/` 读取。使用单独的本地状态目录，把迁移与启动指向同一目录。

~~~sh
npm run build
npx wrangler d1 migrations apply DB --local --config dist/server/wrangler.json --persist-to .wrangler/online-smoke
npm run start -- --port 3000 --persist-to .wrangler/online-smoke
~~~

另开终端执行下方检查。它固定访问本地 3000 端口，会创建并清理测试房间，验证自制图、准备、双脉冲两步、同格拒绝、幂等与重连。浏览器再用普通窗口加隐私窗口走一次建房、加入、准备、开局、落子与退房。规则或快照变更时，额外用该变更前的快照验证恢复和继续落子。

~~~sh
node --experimental-strip-types scripts/check-online-double-step.mjs
~~~

若 Wrangler 在受限 Windows 工作区尝试写入不可写的用户目录，可在当前 PowerShell 进程设定以下路径，再重跑相关本地命令。

~~~powershell
$env:WRANGLER_WRITE_LOGS = 'false'
$env:WRANGLER_LOG_PATH = '.wrangler/logs'
$env:MINIFLARE_REGISTRY_PATH = '.wrangler/registry'
~~~

## 3. 构建并验收两个 GitHub 下载包

在确认基础测试通过、`wrangler.jsonc` 使用仓库默认 D1 名称 `chainburst` 和占位 UUID 的工作副本里执行。若同一机器也负责生产部署，使用另一个工作副本或解压目录存放实例专用配置。

~~~sh
npm run build:offline
npm run build
npm run package:release
~~~

- `outputs/offline/chainburst-offline.html` 是单机网页。双击用 `file://` 打开，在断网条件下检查同屏、人机、落子预览、教程、工坊与导入导出。单机大厅应只显示本地玩法。单机档案由浏览器管理，移动文件前可导出地图 JSON。
- `outputs/release/chainburst-offline-vX.Y.Z.zip` 含单机 HTML、使用说明与许可证。解压后按上一步打开。
- `outputs/release/chainburst-selfhost-vX.Y.Z.zip` 含 `dist/client`、`dist/server`、`drizzle/`、部署说明和许可证。解压到新位置，在其中核对 `dist/server/wrangler.json` 的入口、资产路径与 D1 配置。可用 `npx wrangler@4.92.0 deploy --dry-run --config dist/server/wrangler.json` 验证 Wrangler 能装配该目录。再按第 2 节初始化解压目录的本地 D1 和启动 Wrangler，其中启动命令为 `npx wrangler@4.92.0 dev --config dist/server/wrangler.json --port 3000 --persist-to .wrangler/online-smoke`。
- `outputs/release/SHA256SUMS.txt` 对应这次的两个 ZIP。保留第三方许可，包括 `dist/` 下输出的 `.vite/license.md`。公开包只带 D1 迁移文件与占位配置，检查归档里没有生产配置、会话凭证或本地数据库；打包脚本会过滤其中的本地 Wrangler 目录和 Vinext 预渲染配置。

在 `outputs/release/` 或下载后的目录校验实际要交付的 ZIP。重新打包会产生新的校验值，以最终上传文件为准。

~~~sh
# Linux
sha256sum -c SHA256SUMS.txt
# macOS
shasum -a 256 -c SHA256SUMS.txt
~~~

~~~powershell
Get-Content SHA256SUMS.txt
Get-FileHash -Algorithm SHA256 -Path .\*.zip
~~~

Windows 将 `Get-FileHash` 的结果和清单逐个比对，字母大小写可忽略。

## 4. 发布 GitHub Release

更新 `package.json` 和 `package-lock.json` 的版本，让即将发布的版本、tag、ZIP 文件名和 README 版本链接对应。README 下载区若使用版本专属文件名，更新链接时确认该文件实际会上传。记录拟发布提交的完整 SHA，提交拟发布内容后，从该提交重新打包。若改动还在审查中，仍可将校验过的 ZIP 作为预览交付。

在仓库惯用分支合并流程完成后，从获准发布的准确提交创建并推送 tag。下面以 v1.0.1 为例，须替换为实际版本。若 tag 或 Release 已存在，先核对其 SHA、附件和状态，再恢复操作。说明文件由本次发布准备，包含主要变化、验证范围及兼容信息。

~~~sh
git rev-parse HEAD
git tag -a v1.0.1 -m "Chainburst v1.0.1"
git push origin refs/tags/v1.0.1
gh release create v1.0.1 outputs/release/chainburst-offline-v1.0.1.zip outputs/release/chainburst-selfhost-v1.0.1.zip outputs/release/SHA256SUMS.txt --repo dullsunny/chainburst --verify-tag --draft --title "Chainburst v1.0.1" --notes-file release-notes.md
gh release view v1.0.1 --repo dullsunny/chainburst --json tagName,isDraft,assets,url
gh release edit v1.0.1 --repo dullsunny/chainburst --draft=false
~~~

发布后用实际 tag 访问 Release，核对两个 ZIP 和 SHA 清单均可下载，再对下载版做 SHA-256 比对。交接记录保存 tag、完整 Git SHA、Release URL、两个附件名和实际核对结果。参考 [GitHub CLI Release 命令](https://cli.github.com/manual/gh_release_create)。

当前源码树没有 GitHub Actions 自动发布工作流。若后续引入 Actions，普通 PR 可重复安装、测试和打包，发布任务从具体的 tag 构建并另行授予写 Release 的权限。Cloudflare 生产部署属于单独的运行环境，不应作为普通打包任务的副作用。GitHub Actions 的机密使用该实例专用的仓库或环境 Secret，日志只需回报部署和验证状态。 [GitHub Actions 权限与机密](https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication)

## 5. 自托管实例的首次部署

从 ZIP 部署时，在包含 `dist/`、`drizzle/` 的解压目录运行。先确认 Cloudflare 登录账户，再建库。从源码部署则在根目录填写 `wrangler.jsonc` 并运行 `npm run build`，后续命令同样指向生成的 `dist/server/wrangler.json`。

~~~sh
npx wrangler@4.92.0 login
npx wrangler@4.92.0 whoami
npx wrangler@4.92.0 d1 create chainburst
~~~

打开 `dist/server/wrangler.json`，把 `d1_databases` 中的 `database_name` 和 `database_id` 改为刚创建的实例值，绑定名保留 `DB`。若自定义 Worker 名称，修改 `name`，存在 `topLevelName` 时一并同步。保持 `dist/` 和 `drizzle/` 的相对位置，生成配置中的迁移路径是 `../../drizzle`。Cloudflare 凭据用 CLI 登录状态或环境 Secret 托管。

~~~sh
npx wrangler@4.92.0 deploy --dry-run --config dist/server/wrangler.json
npx wrangler@4.92.0 d1 migrations list DB --remote --config dist/server/wrangler.json
npx wrangler@4.92.0 d1 migrations apply DB --remote --config dist/server/wrangler.json
npx wrangler@4.92.0 deploy --config dist/server/wrangler.json
~~~

以 Wrangler 输出的 HTTPS URL 打开首页，在两个独立浏览器会话用临时测试房间验证建房、邀请、落子与重连。记录 Git tag/SHA、Worker 名称、Cloudflare Worker 版本号、运行网址和已应用的迁移，供同一实例下次更新。 [Wrangler Worker 命令](https://developers.cloudflare.com/workers/wrangler/commands/workers/) · [D1 迁移命令](https://developers.cloudflare.com/workers/wrangler/commands/d1/)

## 6. 升级、回退与常见问题

升级已有实例时，核对目标账户、Worker 名称、D1 ID 和当前线上版本。用相同的 Worker 和数据库换入通过验证的新构建。数据库变更以新增迁移文件表达，先在测试实例验证迁移后的旧数据和新查询，并确认迁移到新版 Worker 生效之间，旧 Worker 仍能工作。需要回退能力时，保留上一份发布资产和相应 Worker 版本 ID。可以用 `npx wrangler@4.92.0 deployments list --config dist/server/wrangler.json` 查部署历史。

如果回退前确认旧 Worker 能读新 SQL 表、D1 房间快照和正在使用的地图 ID，可用 `npx wrangler@4.92.0 rollback PREVIOUS_WORKER_VERSION_ID --config dist/server/wrangler.json` 切回明确的 Worker 版本。Worker 回退只切换代码与运行配置，D1 中最新写入和迁移仍存在。恢复 D1 历史点会影响之后写入的房间，应按实例的恢复计划单独处理。涉及地图移除、JSON 快照版本或玩法阈值变化时，先用真实旧格式样本验证两边兼容。按现有规则，缺少 `dominionPercent` 的旧疆域赛快照恢复为 60%，新局保存 65%，因此回退到早于「每局独立阈值」的代码可能改变已开局的胜利条件。 [Cloudflare Worker 回退](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/) · [D1 恢复](https://developers.cloudflare.com/d1/reference/time-travel/) · [联机规则兼容](ONLINE-ROOMS.md)

| 现象 | 先核对 |
| --- | --- |
| 首页正常，创建房间时报数据库不可用 | `DB` 绑定及 D1 目标，迁移是否已经应用，运行实例的配置是否为刚检查的文件。 |
| 本地房间提示缺表 | Wrangler 迁移与服务是否同时使用 `--local` 对应的状态目录，`--persist-to` 是否一致。真实远程数据库用 `--remote`，普通 `wrangler dev` 默认使用本地模拟 D1。 |
| 端口被占用，联机检查失败 | 停止原服务后在 3000 端口重启验收服务，脚本固定访问 3000。 |
| 已解压，命令找不到资产或迁移 | 从包根目录运行命令，保留 `dist/client`、`dist/server`、`drizzle/` 的原相对位置。 |
| 公共打包脚本提示 D1 配置不符 | 单独使用仓库默认 Wrangler 配置重新构建后打包，生产实例值放在自己的部署目录。 |
| 朋友只能在房主电脑上打开 | 将 Wrangler 远程部署生成的 HTTPS 站点 URL 与房间邀请链接发给朋友。本机 `localhost` 和 `127.0.0.1` 只指向各自设备。 |
