# 升级上游 VS Code

Chenille AI IDE 基于 VS Code 源码构建。为了让每次升级可控，我们需要遵守下面的隔离约定：

- Chenille 自有代码全部放在 `src/vs/chenille/**`。
- 上游文件只允许保留少量、带 `Chenille` 注释的挂钩，且必须登记在 `CHENILLE_UPSTREAM.json`。
- 不要直接修改 `src/vs/workbench/contrib/chat/**` 等上游核心代码来接入 Chenille；优先使用官方扩展点（Agent、Tool、Contribution、Action 等）。
- 当前基线记录在 `CHENILLE_UPSTREAM.json` 的 `upstream.commit` / `upstream.tag`。

任何改动都可以用隔离检查验证：

```bash
node scripts/chenille/check-isolation.mjs
```

## 当前基线

| 项目 | 值 |
| --- | --- |
| 上游版本 | 1.144.0 |
| Git 提交 | `b3fceafbb67da0ff86ce6417d371474d08e5a538` |
| 基线标签 | `vendor-1.144.0` |
| 升级分支 | `upgrade/1.144` |
| 升级前备份 | `backup/main-pre-1.144` / 标签 `pre-1.144` |

## 升级步骤

1. 准备环境和备份。

   ```bash
   git status
   git switch main
   git branch backup/main-pre-<version>
   git tag pre-<version>
   git switch -c upgrade/<version>
   ```

2. 下载并解压目标版本的 VS Code 源码，例如 `<downloaded>/vscode-<version>`。

3. 把上游源码覆盖到仓库，但保留 Chenille 目录和 Git 数据。使用 `rsync` 时务必排除 `.git`、`node_modules` 和 `src/vs/chenille`：

   ```bash
   rsync -a --delete \
     --exclude .git --exclude node_modules --exclude src/vs/chenille \
     <downloaded>/vscode-<version>/ ./
   ```

4. 提交基线并打标签。这一步只提交官方代码，便于之后单独审查挂钩改动：

   ```bash
   git add -A
   git commit -m "vendor: import VS Code <version> baseline"
   git tag vendor-<version>
   ```

5. 从旧基线恢复 Chenille 挂钩。先查看旧版本上的挂钩差异：

   ```bash
   git diff vendor-<old-version>..pre-<old-version> -- \
     build/next/resources.ts \
     eslint.config.js \
     package.json \
     product.json \
     src/vs/code/electron-main/app.ts \
     src/vs/workbench/contrib/scm/browser/scmInput.ts \
     src/vs/workbench/workbench.desktop.main.ts
   ```

   逐个人工重新应用。能搬进 `src/vs/chenille/**` 的逻辑一律搬走，上游文件只留注册、导入和最小委托代码。恢复时同步检查：

   - `eslint.config.js`：`src/vs/chenille/~` 的导入白名单、版权头覆盖、必要的 `local/code-amd-node-module` 例外。
   - `build/next/resources.ts`：`vs/chenille/**/media/**` 的静态资源复制规则。
   - `src/vs/code/electron-main/app.ts`：`registerChenilleMainServices` / `registerChenilleMainChannels` 调用。
   - `src/vs/workbench/workbench.desktop.main.ts`：Chenille contribution 导入。
   - `product.json` / `package.json`：品牌、仓库地址、AI SDK 依赖。
   - `src/vs/workbench/contrib/scm/browser/scmInput.ts`：仅在 Chenille 提交消息命令已注册时委托。

6. 更新 `CHENILLE_UPSTREAM.json` 中的 `upstream.version`、`upstream.commit` 和 `upstream.tag`。如果新增了上游挂钩文件，同时登记到 `allowedUpstreamChanges`；如果某个挂钩变大，评估能否迁入 `src/vs/chenille/**` 或调整该文件的 `maxChangedLines`。

7. 验证。

   ```bash
   node scripts/chenille/check-isolation.mjs
   npm install
   npm run typecheck-client
   npm run valid-layers-check
   npm run eslint -- src/vs/chenille
   npm run compile-client
   ```

   最后启动应用，手动验证设置面板、内联补全、提交消息生成、官方 Chat 中的 Chenille Agent 和工具调用。

8. 合并回 `main`。保留 `vendor-<version>` 标签和备份分支，至少保留到新版本稳定发布后再清理。

## 常见问题

- **`registerAgent` / `registerAgentImplementation` 报错**：Chat Agent 接口随版本变化，优先对照 `src/vs/workbench/contrib/chat/common/participants/chatAgents.ts`，不要修改该文件。
- **Agent 模式判断失效**：不要依赖 Chenille 自建的模式服务。官方 Chat 的模式记录在当前请求的 `modeInfo` 上，通过 `IChatService.getSession(...).getRequests()` 读取。
- **工具执行上下文字段变化**：对照 `IToolInvocationContext`。1.144 使用 `sessionResource` + `requestId`，旧的 `sessionId` 已被移除。
- **安装依赖时 LFS 报错**：`extensions/copilot/.gitattributes` 包含 `*.sqlite filter=lfs`，没有 LFS 时使用 `GIT_LFS_SKIP_SMUDGE=1 npm install`。
- **Node 版本**：以仓库根目录 `.nvmrc` 为准，当前为 `24.22.1`。
