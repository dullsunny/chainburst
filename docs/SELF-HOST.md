# 在自己的 Cloudflare 账户部署联机版

联机版适合 2–6 人通过房间码一起游玩。它使用一个 Cloudflare Worker 提供网页和联机接口，用一个 D1 数据库保存房间。部署需要 Cloudflare 账户及 Worker、D1 的创建权限，操作电脑需要 Node.js 22.13 或以上版本。

## 从联机发布包部署

解压联机发布包，在包含 `dist` 和 `drizzle` 的目录打开终端。

1. 登录 Wrangler 并创建一个空数据库。可以把 `chainburst` 改成你账户里合适的数据库名称。

   ```sh
   npx wrangler@4.92.0 login
   npx wrangler@4.92.0 d1 create chainburst
   ```

2. 打开 `dist/server/wrangler.json`。在 `d1_databases` 中填入上一步输出的 `database_name` 与 `database_id`，保留绑定名 `DB`。若要更改站点名称，首发前可编辑顶层 `name`，并在文件有 `topLevelName` 时把它改为同名。
3. 初始化数据库并部署网页。

   ```sh
   npx wrangler@4.92.0 d1 migrations apply DB --remote --config dist/server/wrangler.json
   npx wrangler@4.92.0 deploy --config dist/server/wrangler.json
   ```

4. 打开 Wrangler 输出的 `workers.dev` HTTPS 网址。点击「线上联机」创建房间，把邀请链接发给朋友。自测两个席位时，用普通窗口和隐私窗口分别加入，以隔离各自的浏览器存储。

## 从源码构建并部署

在仓库根目录运行 `npm ci`。完成上面的登录和建库步骤后，把数据库名称和 ID 填到根目录 `wrangler.jsonc`。`npm run build` 会将该配置写到构建目录。

```sh
npm ci
npm run build
npx wrangler d1 migrations apply DB --remote --config dist/server/wrangler.json
npx wrangler deploy --config dist/server/wrangler.json
```

升级时使用同一个 Worker 名称和 D1 数据库 ID，再执行迁移与部署。用发布包升级时，将这些值填入新包的配置。请通过 Wrangler 登录或为 CI 配置凭据，把账户访问令牌放在 Git 之外。命令及数据库绑定的参数见 [Cloudflare D1 命令文档](https://developers.cloudflare.com/workers/wrangler/commands/d1/) 和 [Wrangler 配置文档](https://developers.cloudflare.com/workers/wrangler/configuration/)。

## 在本机试跑联机版

从源码构建后运行以下命令。带 `--local` 的迁移用于本机 D1，源配置的占位 UUID 可以直接用于这项检查。

```sh
npx wrangler d1 migrations apply DB --local --config dist/server/wrangler.json --persist-to .wrangler/online-smoke
npm run start -- --port 3000 --persist-to .wrangler/online-smoke
```

打开 `http://localhost:3000/`，从两个独立浏览器会话建房、加入、准备、开局和落子。也可以在第二个终端运行仓库提供的联机检查。

```sh
node --experimental-strip-types scripts/check-online-double-step.mjs
```

房间长时间无写入会到期，默认 24 小时。自制地图的原稿存在创建者的浏览器里，可在地图工坊导出 JSON。服务器在建房时保留该局使用的独立地图副本。

若网页能打开而房间创建提示数据库不可用，核对 Worker 的 `DB` 绑定及迁移目标。Wrangler 本机预览时，迁移和服务要使用同一个 `--persist-to` 目录。若同一账户有多个项目，请在数据库迁移或部署前检查所选 Cloudflare 账户与 Worker 名称。
