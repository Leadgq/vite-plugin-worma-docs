# MCP playground

这是 stdio MCP 的示例配置目录，不是独立 npm 包，无需添加 workspace。

在仓库根目录运行：

```sh
pnpm build
pnpm dev:mcp
```

服务会读取 `worma-mcp.json` 配置的知识库 Swagger，并等待 MCP 客户端消息。可使用 `pnpm test:mcp:live` 自动完成连接、工具发现、搜索与入参/响应检查。

接入客户端时使用根目录 README 中的 `node` 配置，并将入口文件和配置文件路径替换为本机绝对路径。客户端会自动启动服务，无需额外手动运行一次。

配置支持多个来源、可选标签筛选、本地 JSON / YAML 文件；来源名称必须唯一。查询工具不生成文档、不执行业务接口。默认在查询时检查 60 秒有效期，过期后读取最新 Swagger；后端刚更新时可调用 refresh_apis 立即刷新。

包的请求代码生成功能默认关闭；本 playground 已显式开启 `generateClient: true`，使用 Axios + ESM JavaScript，将公司接口实现保留在 `playground-mcp/generated/`，便于检查。

运行 `pnpm test:mcp:live` 会生成并保留这些实现；追加 `--generate-client` 则使用临时目录验证，结束后清理。`generated/index.js` 是 Axios 实例入口，`generated/services/` 中是按接口标签分组的请求函数，旁边的 `.d.ts` 文件提供类型声明。该目录已被 Git 忽略，不会提交公司接口产物。

把本示例的 `generateClient` 改为 `false` 可停止后续生成，已生成的文件仍会保留。查询工具始终只读；完整选项见根目录 README。

方法名使用 `client.nameStyle: "camelCase"`，例如 `postApiAiKnowledgeQuerySelectableTree`，通过 worma 内置的 `rename` 插件生成；请求和响应字段保留 Swagger 原名。

自动刷新间隔可在配置顶层或单个来源中设置 `refreshIntervalSeconds`，单位秒，0 关闭自动刷新。列表和详情会返回最后成功加载时间及失败状态。刷新仅更新查询数据，不会重生成 generated 中的请求代码；更新实现需重新启动生成流程。修改配置本身仍需重启。
