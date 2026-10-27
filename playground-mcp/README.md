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
