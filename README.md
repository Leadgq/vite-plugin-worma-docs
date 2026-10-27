# plugin-worma-docs

Vite / Webpack plugin that turns an OpenAPI spec into a local handbook, plus a read-only MCP server for querying API contracts without generating Markdown files. No generated HTTP client.

## Read-only MCP

MCP 和现有 Vite / Webpack 插件是同一个 npm 包的独立入口。使用 MCP 不需要配置构建插件，不会生成 `.md`、请求代码或磁盘缓存。当前使用单包、多入口结构，`playground-mcp/` 是运行示例，无需 `pnpm-workspace.yaml`。只有需要独立发布、版本或依赖时才有必要拆成多包。

要求 Node.js 18.18+。配置文件采用 JSON，例如 `/absolute/path/worma-mcp.json`：

```json
{
  "sources": [
    {
      "name": "knowledgebase",
      "swagger": "https://example.com/swagger/v1/swagger.json",
      "tags": ["Knowledge"]
    },
    {
      "name": "orders",
      "swagger": "./specs/orders.yaml"
    }
  ]
}
```

- `name` 必填且不能重复，用于区分多个来源。
- `swagger` 支持 HTTP(S) 文档地址或本地 JSON / YAML 文件。本地相对路径基于配置文件所在目录解析。
- `tags` 可选，按标签精确匹配，多个标签取并集；不填或空数组表示全部接口。
- 支持 Swagger 2.0、OpenAPI 3.0 / 3.1。远程读取超时为 30 秒，文档大小上限 20 MiB，不跟随 HTTP 重定向。

### 在本地开发版本中接入

```sh
pnpm install
pnpm build
pnpm dev:mcp
```

`dev:mcp` 使用 `playground-mcp/worma-mcp.json` 中的公司文档地址。它是 stdio 服务：启动后等待 MCP 消息，终端无输出是正常现象。修改代码后需要重新构建、重启。

在支持 stdio MCP 的客户端中，将服务命令指向已构建的入口。下面为通用 JSON 配置示例，具体配置位置取决于客户端：

```json
{
  "mcpServers": {
    "worma-docs": {
      "command": "node",
      "args": [
        "D:/project/learn/vite-plugin-worma-docs/dist/mcp-cli.js",
        "--config",
        "D:/project/learn/vite-plugin-worma-docs/playground-mcp/worma-mcp.json"
      ]
    }
  }
}
```

替换为自己机器上的绝对路径，由客户端启动服务，无需同时手动运行 `dev:mcp`。

### 发布新版 npm 包之后

下面的命令需要先将包含 MCP 入口的新版发布到 npm；旧的已发布版本可能没有此命令：

```sh
npx --yes --package=plugin-worma-docs worma-docs-mcp --config /absolute/path/worma-mcp.json
```

相应的客户端配置：

```json
{
  "mcpServers": {
    "worma-docs": {
      "command": "npx",
      "args": [
        "--yes",
        "--package=plugin-worma-docs",
        "worma-docs-mcp",
        "--config",
        "/absolute/path/worma-mcp.json"
      ]
    }
  }
}
```

### AI 可以查询什么

| 工具 | 参数 | 内容 |
| --- | --- | --- |
| `list_apis` | `source?`, `tag?`, `method?`, `offset?`, `limit?` | 来源信息、接口摘要、稳定的接口 ID 和分页位置 |
| `search_apis` | `query` 及上述筛选参数 | 搜索路径、摘要、描述、operationId、标签，忽略大小写，空格分隔的词需全部匹配 |
| `get_api_detail` | `id`, `maxDepth?` | 参数位置、必填项、请求体、各状态码响应、媒体类型、响应头、嵌套结构、枚举、约束、示例及认证声明 |

列表默认每页 20 条，最多 100 条；返回 `nextOffset`，为 `null` 表示结束。工具参数 `method` 使用大写。详情必须使用列表或搜索返回的完整 `id`，例如 `knowledgebase::POST /api/Example/Query`。

可以向 AI 提问：“搜索知识库目录接口，查看它的入参和响应，然后用项目已有的 request 方法实现调用。” MCP 提供资料，业务代码编辑由客户端的其他工具完成。

内部 `$ref` 按需展开，保留 `allOf` / `oneOf` / `anyOf`。循环引用、缺失引用、外部引用和展开限制会出现在 `warnings` 中；保留的引用节点也会带有 `x-worma-ref-status`。默认最多展开 8 层引用，可通过 `maxDepth` 调整到 1–20；另有结构深度和节点数量限制，截断节点标为 `x-worma-truncated`。响应是文档声明的结构，缺失的 schema 代表未知，不会猜测实际返回字段。

### 只读范围与刷新

服务只在启动时读取用户配置的文档，之后工具查询使用内存数据。它没有写文件、修改 Swagger、执行业务接口或加载任意 URL 的工具。外部 `$ref` 不自动访问；多文件规范应先由用户打包为单个文档。当前不支持自定义认证请求头。

所有来源加载成功后才连接客户端；任何来源失败都会退出并将错误写入 stderr。更新 Swagger 或配置后，需要重启 MCP 服务刷新。stdout 专用于 MCP 协议消息。

只读限制针对本服务，客户端其他文件或终端工具的权限需单独控制。

### 校验

```sh
pnpm typecheck
pnpm test
pnpm test:mcp:live
```

`pnpm test` 构建三个入口并运行本地 OpenAPI 与 stdio MCP 集成测试，不访问公司网关。`test:mcp:live` 通过真实 MCP 客户端读取示例配置中的公司 Swagger，验证搜索、入参与响应结构；不调用业务接口，也不将公司文档存入仓库。

程序化使用可从 `plugin-worma-docs/mcp` 导入 `OpenApiRepository`、`loadConfig` 和 `createWormaMcpServer`。原有插件使用方式如下。

## Vite

```ts
import { defineConfig } from 'vite'
import { wormaDocs } from 'plugin-worma-docs'

export default defineConfig({
  plugins: [
    wormaDocs({
      swagger: 'https://petstore3.swagger.io/api/v3/openapi.json',
      output: 'src/api/aidocs',
      tags: ['pet', 'store'],
    }),
  ],
})
```

Several independent specs:

```ts
wormaDocs({
  swagger: [
    'https://api-a.example.com/swagger/v1/swagger.json',
    'https://api-b.example.com/swagger/v1/swagger.json',
  ],
  output: 'src/api/aidocs',
})
```

Different tags / folders per spec:

```ts
wormaDocs({
  swagger: [
    {
      swagger: 'https://api-a.example.com/swagger/v1/swagger.json',
      tags: ['CompanySupervision'],
      output:"src/api/data-center"
    },
    {
      swagger: 'https://api-b.example.com/swagger/v1/swagger.json',
      tags: ['Tender'],
      output: 'src/api/aidocs-tender',
    },
  ],
})
```

Same as worma `apiFilter` — one path, or a regex. Do not set `tags` at the same time:

```ts
wormaDocs({
  swagger: 'https://test2-gateway.hnyotech.com.cn/tenderalertapi/swagger/v1/swagger.json',
  output: 'src/api/aidocs',
  apiFilter: {
    scope: 'url',
    include: /\/api\/Alert\/FindAlert(Overview|Trend)$/,
  },
})
```

Several paths (union / OR):

```ts
wormaDocs({
  swagger: '.../swagger.json',
  apiFilter: [
    { scope: 'url', include: '/api/Alert/FindAlertOverview' },
    { scope: 'url', include: '/api/Alert/FindAlertTrend' },
  ],
})
```

## Webpack 5

```js
const { WormaDocsWebpackPlugin } = require('plugin-worma-docs/webpack')

module.exports = {
  plugins: [
    new WormaDocsWebpackPlugin({
      swagger: 'https://petstore3.swagger.io/api/v3/openapi.json',
      output: 'src/api/aidocs',
    }),
  ],
}
```

## Options

| Name | Default | Description |
| --- | --- | --- |
| `swagger` | required | One URL, several URLs, or `{ swagger, tags?, output? }` objects |
| `output` | `src/api/aidocs` | Handbook directory, relative to project root |
| `tags` | all tags | Shortcut for `{ scope: 'tag', include }`. Mutually exclusive with `apiFilter` |
| `apiFilter` | all APIs | Same as wormajs `apiFilter()`. Mutually exclusive with `tags` |
| `enable` | `true` | Skip generation when `false` |
| `force` | `false` | Ignore worma cache and refetch the spec |

Generation runs once on Vite `buildStart` and once on Webpack `beforeRun` / first `watchRun`. A failed fetch logs a warning and does not fail the build.
