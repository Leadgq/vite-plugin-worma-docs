# MCP playground

这是 stdio MCP 的示例配置目录，不是独立 npm 包，无需添加 workspace。

在仓库根目录运行：

```sh
pnpm build
pnpm dev:mcp
```

服务会读取 `worma-mcp.json` 配置的知识库 Swagger，并等待 MCP 客户端消息。可使用 `pnpm test:mcp:live` 自动完成连接、工具发现、搜索与入参/响应检查。

接入客户端时使用根目录 README 中的 `node` 配置，并将入口文件和配置文件路径替换为本机绝对路径。客户端会自动启动服务，无需额外手动运行一次。

配置支持多个来源、可选标签筛选、本地 JSON / YAML 文件；来源名称必须唯一。只读服务不生成文档、不执行业务接口，重启后重新读取最新 Swagger。

包的请求代码生成功能默认关闭；本 playground 已显式开启 `generateClient: true`，使用 Axios + ESM JavaScript，将公司接口实现保留在 `playground-mcp/generated/`，便于检查。

运行 `pnpm test:mcp:live` 会生成并保留这些实现；追加 `--generate-client` 则使用临时目录验证，结束后清理。`generated/index.js` 是 Axios 实例入口，`generated/services/` 中是按接口标签分组的请求函数，旁边的 `.d.ts` 文件提供类型声明。该目录已被 Git 忽略，不会提交公司接口产物。

把本示例的 `generateClient` 改为 `false` 可停止后续生成，已生成的文件仍会保留。查询工具始终只读；完整选项见根目录 README。
