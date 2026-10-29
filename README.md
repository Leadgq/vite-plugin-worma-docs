# plugin-worma-docs

将 Swagger / OpenAPI 转为本地接口手册，或通过 MCP 让 AI 按需查询接口。可选生成 Axios、Fetch、Ky 请求实现及类型声明，默认关闭。

同一个 npm 包提供三个入口：

| 使用方式 | 入口 | 默认行为 |
| --- | --- | --- |
| Vite 插件 | `plugin-worma-docs` | 在构建钩子中生成 Markdown 接口手册 |
| Webpack 5 插件 | `plugin-worma-docs/webpack` | 在运行钩子中生成 Markdown 接口手册 |
| stdio MCP | `worma-docs-mcp` 命令 | 只读查询接口，不生成 Markdown 或请求代码 |

请求代码根据 Swagger/OpenAPI 生成，不依赖 Markdown。MCP 可以独立使用，不需要安装或接入 Vite / Webpack 插件。

## 目录

- [安装与环境](#安装与环境)
- [MCP：单个与多个 Swagger](#mcp单个与多个-swagger)
- [Vite：单个与多个 Swagger](#vite单个与多个-swagger)
- [Webpack：单个与多个 Swagger](#webpack单个与多个-swagger)
- [请求代码配置与继承规则](#请求代码配置与继承规则)
- [全部配置项](#全部配置项)
- [MCP 工具与只读范围](#mcp-工具与只读范围)
- [本地开发、测试与发布](#本地开发测试与发布)

## 安装与环境

要求 Node.js 18.18+；构建插件支持的 Vite / Webpack 版本以 package.json 的 peerDependencies 为准。

使用构建插件时安装：

```sh
pnpm add -D plugin-worma-docs
```

只使用 MCP 时可通过 npx 运行，无需将本包安装到业务项目：

```sh
npx --yes --package=plugin-worma-docs worma-docs-mcp --config /absolute/path/worma-mcp.json
```

生成 Axios / Ky 客户端时，业务项目还需安装对应运行依赖：

```sh
pnpm add axios
# 或者使用 Ky 模板：
pnpm add ky
```

Fetch 模板使用运行环境提供的 Fetch API。生成器不会自动安装依赖。

## MCP：单个与多个 Swagger

MCP 配置是一个 JSON 文件，例如项目根目录的 `worma-mcp.json`。即使只有一个 Swagger，也使用 `sources` 数组。

### 单个 Swagger：只查询，不生成代码

```json
{
  "sources": [
    {
      "name": "knowledgebase",
      "swagger": "https://example.com/knowledgebase/openapi.json"
    }
  ]
}
```

省略 `generateClient` 等同于 `false`。也可以显式填写 `"generateClient": false`。

### Swagger 更新与刷新

默认每个来源的快照有效期为 **60 秒**。列表、搜索和详情工具在查询时检查是否过期，过期后重新读取 Swagger / 本地文件，再返回结果；没有查询时不做后台轮询。

```json
{
  "refreshIntervalSeconds": 60,
  "sources": [
    {
      "name": "knowledgebase",
      "swagger": "https://example.com/knowledgebase/openapi.json",
      "refreshIntervalSeconds": 15
    },
    {
      "name": "orders",
      "swagger": "./specs/orders.yaml"
    }
  ]
}
```

来源级设置覆盖顶层间隔：上例 knowledgebase 为 15 秒，orders 为 60 秒。范围为 0–86400 秒；`0` 关闭自动刷新，仍可手动刷新。后端刚更新、尚未到期时，可让 AI 调用 `refresh_apis`，传入 `source: "knowledgebase"` 只刷新一个来源，或省略 source 刷新全部。

列表/搜索的 `sources[]`、详情的 `freshness` 以及刷新工具的 `sources[]` 都包含：

| 字段 | 含义 |
| --- | --- |
| lastLoadedAt | 上一次成功读取并建立索引的时间，ISO 8601 UTC；不代表后端修改时间 |
| lastRefreshAttemptAt | 最近一次读取尝试的时间 |
| refreshIntervalSeconds | 该来源实际采用的刷新间隔 |
| automaticRefreshEnabled | 是否开启查询时自动刷新 |
| stale | 快照是否已过期或最近一次刷新失败；关闭自动刷新并不保证后端未变化 |
| lastRefreshError | 最近一次刷新错误，成功时为 null |

同一来源的并发刷新会合并为一次读取。读取或解析失败时保留上一次成功的接口数据，标记 stale 和错误，不清空接口；自动失败后按该来源间隔退避，手动刷新可立即重试。多来源分别更新，某来源失败不丢失其他来源的数据。`refresh_apis` 的 success 为 false 时，MCP 返回 isError，并附带各来源状态。

刷新仅重新读取配置中允许的文档，不修改 Swagger、不执行业务接口，也不会重新生成请求代码。需要更新已生成的请求代码时仍需重启服务或重新运行生成流程。修改来源 URL、标签、生成配置或刷新间隔等配置文件内容后，需要重启服务才能生效。

### 单个 Swagger：查询并生成请求代码

```json
{
  "generateClient": true,
  "client": {
    "output": "src/api/generated/knowledgebase",
    "library": "axios",
    "type": "module",
    "nameStyle": "camelCase"
  },
  "sources": [
    {
      "name": "knowledgebase",
      "swagger": "https://example.com/knowledgebase/openapi.json",
      "tags": ["AiKnowledge", "KnowledgeBase"]
    }
  ]
}
```

服务启动时先读取文档，再生成代码，成功后提供 MCP 工具。上例仅查询和生成所选标签的接口；删除 `tags` 可处理全部接口。

### 多个 Swagger：只查询，不生成代码

```json
{
  "sources": [
    {
      "name": "knowledgebase",
      "swagger": "https://example.com/knowledgebase/openapi.json"
    },
    {
      "name": "orders",
      "swagger": "./specs/orders.yaml",
      "tags": ["Order"]
    }
  ]
}
```

每个 `name` 必须唯一。支持 HTTP(S) 文档地址，以及本地 JSON / YAML 文件；本地相对路径基于配置文件所在目录解析。

### 多个 Swagger：公共默认配置 + 各来源覆盖

```json
{
  "generateClient": true,
  "client": {
    "library": "axios",
    "type": "module",
    "nameStyle": "camelCase"
  },
  "sources": [
    {
      "name": "knowledgebase",
      "swagger": "https://example.com/knowledgebase/openapi.json",
      "client": {
        "output": "src/api/generated/knowledgebase"
      }
    },
    {
      "name": "orders",
      "swagger": "https://example.com/orders/openapi.json",
      "client": {
        "output": "src/api/generated/orders",
        "library": "fetch",
        "type": "typescript"
      }
    },
    {
      "name": "audit",
      "swagger": "./specs/audit.json",
      "generateClient": false
    }
  ]
}
```

| 来源 | 是否生成请求 | 输出目录 | 请求库 | 格式 | 方法名 |
| --- | --- | --- | --- | --- | --- |
| knowledgebase | 是 | src/api/generated/knowledgebase | Axios | ESM JavaScript | camelCase |
| orders | 是 | src/api/generated/orders | Fetch | TypeScript | camelCase |
| audit | 否，仍可通过 MCP 查询 | — | — | — | — |

### 多个 Swagger：每个来源完全独立配置

不需要公共默认值时，可以完全省略顶层的 `generateClient` 和 `client`：

```json
{
  "sources": [
    {
      "name": "knowledgebase",
      "swagger": "https://example.com/knowledgebase/openapi.json",
      "generateClient": true,
      "client": {
        "output": "generated/knowledgebase",
        "library": "axios",
        "type": "module",
        "nameStyle": "camelCase"
      }
    },
    {
      "name": "orders",
      "swagger": "./specs/orders.yaml",
      "generateClient": true,
      "client": {
        "output": "generated/orders",
        "library": "ky",
        "type": "typescript",
        "nameStyle": "camelCase"
      }
    }
  ]
}
```

### 接入 MCP 客户端

在支持 stdio MCP 的客户端中添加服务。下面是通用 JSON 示例，具体配置位置由客户端决定；将路径替换为实际的配置文件绝对路径：

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
        "D:/your-project/worma-mcp.json"
      ]
    }
  }
}
```

需要固定版本时，将包参数改为 `--package=plugin-worma-docs@你的版本号`。升级后应更新固定版本号并重启服务。首次下载包、读取文档和生成代码可能较慢，可在客户端中适当增加启动超时。

客户端负责启动服务，无需另外手动运行一份。stdio 服务启动后等待协议消息，没有普通终端输出是正常现象。

CLI 只有以下选项，生成配置写在 JSON 文件中：

| 参数 | 说明 |
| --- | --- |
| `--config <path>` | 必填，JSON 配置文件路径；推荐使用绝对路径 |
| `--help` / `-h` | 显示命令说明 |

## Vite：单个与多个 Swagger

### 单个 Swagger：生成接口手册

```ts
import { defineConfig } from 'vite'
import { wormaDocs } from 'plugin-worma-docs'

export default defineConfig({
  plugins: [
    wormaDocs({
      swagger: 'https://example.com/knowledgebase/openapi.json',
      output: 'src/api/aidocs',
      tags: ['AiKnowledge', 'KnowledgeBase'],
    }),
  ],
})
```

### 单个 Swagger：额外生成请求代码

```ts
wormaDocs({
  swagger: 'https://example.com/knowledgebase/openapi.json',
  output: 'src/api/aidocs',
  enable: true,
  force: false,
  generateClient: true,
  client: {
    output: 'src/api/generated/knowledgebase',
    library: 'axios',
    type: 'module',
    nameStyle: 'camelCase',
  },
})
```

`output` 是 Markdown 目录；`client.output` 是请求代码目录，两者应分开。

### 多个 Swagger：字符串数组简写

```ts
wormaDocs({
  swagger: [
    'https://example.com/service-a/openapi.json',
    'https://example.com/service-b/openapi.json',
  ],
})
```

字符串数组中的来源继承顶层配置。此简写会共用默认 Markdown 输出目录；多份手册需要独立保留时，使用下面的对象数组，为每份指定不同的 `output`。

### 多个 Swagger：独立手册目录、筛选和请求代码配置

```ts
wormaDocs({
  generateClient: true,
  client: {
    library: 'axios',
    type: 'module',
    nameStyle: 'camelCase',
  },
  swagger: [
    {
      swagger: 'https://example.com/knowledgebase/openapi.json',
      output: 'src/api/aidocs/knowledgebase',
      tags: ['AiKnowledge', 'KnowledgeBase'],
      client: {
        output: 'src/api/generated/knowledgebase',
      },
    },
    {
      swagger: 'https://example.com/orders/openapi.json',
      output: 'src/api/aidocs/orders',
      apiFilter: {
        scope: 'url',
        include: /\/api\/Order\//,
      },
      client: {
        output: 'src/api/generated/orders',
        library: 'fetch',
        type: 'typescript',
      },
    },
    {
      swagger: './specs/audit.json',
      output: 'src/api/aidocs/audit',
      generateClient: false,
    },
  ],
})
```

第三个来源仍生成 Markdown，只关闭请求代码。也可以省略顶层 `client`，将完整的请求生成配置写在各个来源对象内。TypeScript 类型支持字符串数组或对象数组，建议不要混用两种元素。

### 按 URL、标签、正则或函数筛选

`tags` 和 `apiFilter` 互斥，同一层配置选择其中一个。`apiFilter` 是 Vite / Webpack 专用配置，MCP JSON 不支持此字段。

```ts
wormaDocs({
  swagger: 'https://example.com/openapi.json',
  apiFilter: {
    scope: 'url',
    include: /\/api\/Alert\/FindAlert(Overview|Trend)$/,
    exclude: '/internal/',
  },
})
```

多个筛选条件取并集（OR）；单个条件内部是 include 匹配且 exclude 不匹配。字符串规则按包含关系匹配，正则按正则匹配，函数接收 URL 或标签字符串：

```ts
wormaDocs({
  swagger: 'https://example.com/openapi.json',
  apiFilter: [
    { scope: 'url', include: '/api/Alert/FindAlertOverview' },
    { scope: 'url', include: '/api/Alert/FindAlertTrend' },
    {
      scope: 'tag',
      include: tag => tag.includes('Public'),
      exclude: 'Internal',
    },
  ],
})
```

`scope` 可为 `url` 或 `tag`，省略时为 `url`。每个规则至少提供 `include` / `exclude` 之一。筛选也用于可选的请求代码生成。

## Webpack：单个与多个 Swagger

### 单个 Swagger

```js
const { WormaDocsWebpackPlugin } = require('plugin-worma-docs/webpack')

module.exports = {
  plugins: [
    new WormaDocsWebpackPlugin({
      swagger: 'https://example.com/knowledgebase/openapi.json',
      output: 'src/api/aidocs',
      tags: ['KnowledgeBase'],
      generateClient: true,
      client: {
        output: 'src/api/generated/knowledgebase',
        library: 'axios',
        type: 'module',
        nameStyle: 'camelCase',
      },
    }),
  ],
}
```

省略 `generateClient` 和 `client` 即为只生成 Markdown。

### 多个 Swagger

```js
const { WormaDocsWebpackPlugin } = require('plugin-worma-docs/webpack')

module.exports = {
  plugins: [
    new WormaDocsWebpackPlugin({
      generateClient: true,
      client: {
        library: 'axios',
        type: 'module',
        nameStyle: 'camelCase',
      },
      swagger: [
        {
          swagger: 'https://example.com/knowledgebase/openapi.json',
          output: 'src/api/aidocs/knowledgebase',
          client: { output: 'src/api/generated/knowledgebase' },
        },
        {
          swagger: 'https://example.com/orders/openapi.json',
          output: 'src/api/aidocs/orders',
          tags: ['Order'],
          client: {
            output: 'src/api/generated/orders',
            library: 'fetch',
            type: 'typescript',
          },
        },
      ],
    }),
  ],
}
```

Webpack 和 Vite 共用全部插件选项，包括字符串数组简写、逐来源开关、筛选和继承规则。

## 请求代码配置与继承规则

### 公共默认值与来源级覆盖

1. `generateClient` 默认为 `false`。JSON 使用布尔值 `true` / `false`，不接受字符串 `"yes"`。
2. 来源级 `generateClient` 优先于顶层值，可以单独开启或关闭。
3. `client` 按字段合并：来源级只填写 `output` 时，仍继承顶层的 `library`、`type`、`nameStyle`。
4. 未指定的字段使用内置默认值：Axios、TypeScript、camelCase。
5. MCP 的来源对象位于 `sources[]`；插件的来源对象位于 `swagger[]`。插件来源没有 `name` 字段。
6. 插件来源未指定 `output` 时继承顶层 Markdown 目录；未指定自己的 `tags` / `apiFilter` 时继承顶层筛选。

### 单来源与多来源输出目录

| 情况 | 请求代码输出 |
| --- | --- |
| 单来源，省略所有 client.output | src/api/generated |
| 单来源，顶层 client.output 为 generated | generated |
| 多来源，顶层 client.output 为 generated，来源未指定目录 | generated/source-1、generated/source-2…… |
| 多来源，所有 client.output 都省略 | src/api/generated/source-1、src/api/generated/source-2…… |
| 来源级指定 client.output | 直接使用该目录，不再追加 source-N |

`source-N` 取配置数组中的位置，即使某些来源关闭生成，也不会重新编号；它不按 MCP 的 `name` 命名。推荐多来源显式指定目录，避免调整顺序后改变对应关系。

MCP 的相对路径基于配置文件目录；插件的相对路径基于项目根目录（Vite root / Webpack context）。请求输出必须位于该根目录内部，不能写到根目录自身或外部路径。多个请求输出目录不能相同或互相嵌套。

### 方法名、类型与生成文件

默认通过 worma 内置配置 `rename({ scope: 'name', style: 'camelCase' })` 处理方法名：

```text
post_get_user_info → postGetUserInfo
post_api_ai_knowledge_query_selectable_tree → postApiAiKnowledgeQuerySelectableTree
```

只调整方法名及对应声明，不修改 URL、入参字段或响应字段，也不会自动删除路径中的 api、模块名等片段。

| client.type | 主要产物 |
| --- | --- |
| typescript | .ts 请求实现与类型声明 |
| module | ESM .js 请求实现及 .d.ts 声明 |
| commonjs | .cjs 请求实现及 .d.cts 声明 |

Axios + module 的典型目录：

```text
generated/
├── index.js                 # Axios 实例、baseURL、拦截器
├── helper.js
├── components.d.ts          # 公共模型类型
├── .worma-client.json       # 本工具的来源归属标记
└── services/
    ├── index.js
    ├── KnowledgeBase.js     # 按标签分组的方法
    └── KnowledgeBase.d.ts
```

生成器不会自动接入业务项目原有的 request 实例、认证或宿主注入，也不会改写页面调用。请根据生成入口配置 baseURL、认证和拦截器，并确认已有请求层是否已解包响应。

### 重新生成与文件保护

输出目录必须是新目录、空目录，或带有本工具归属标记且属于同一来源的目录。不会直接覆盖非空的手写请求目录。生成目录中的文件视为自动产物，重新生成可能覆盖现有内容，业务手写封装应放在其他目录。

关闭 `generateClient` 不会删除已有产物；从 Swagger 移除接口后，也不会自动清理旧文件。请在专用生成目录中管理并按需清理过期产物。

请求生成在隔离进程和临时目录中执行，成功后才复制到目标目录；临时 Swagger 副本和请求生成缓存随后清理。MCP 默认不写磁盘；开启生成后也不会在项目根目录留下 .worma-cache。Vite / Webpack 的 Markdown 生成仍可能产生 .worma 和 .worma-cache。

## 全部配置项

### MCP 顶层配置

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| sources | 来源对象数组 | 必填 | 至少一个来源，不接受 Swagger 字符串简写 |
| generateClient | boolean | false | 所有来源的请求生成默认开关 |
| client | ClientOptions | 见下表 | 所有来源的请求生成默认设置 |
| refreshIntervalSeconds | 0–86400 的整数 | 60 | 查询时自动刷新的快照有效期，单位秒；0 关闭自动刷新 |

### MCP 来源配置：sources[]

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| name | 非空 string | 必填 | 来源唯一名称，用于工具 source 筛选和接口 ID |
| swagger | 非空 string | 必填 | HTTP(S) URL 或本地 JSON / YAML 路径 |
| tags | string[] | 全部标签 | 精确匹配标签，多个标签取并集；空数组表示全部 |
| generateClient | boolean | 继承顶层，最终 false | 仅控制该来源是否生成请求，不影响只读查询 |
| client | ClientOptions | 逐字段继承顶层 | 该来源的请求生成配置 |
| refreshIntervalSeconds | 0–86400 的整数 | 继承顶层，最终 60 | 单独设置该来源的快照有效期；0 关闭该来源自动刷新 |

MCP 的配置对象使用严格校验，不支持插件专用的顶层 `swagger`、`output`、`tags`、`apiFilter`、`enable`、`force`。标签筛选应写在来源内部。

### Vite / Webpack 顶层配置

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| swagger | string / string[] / 来源对象数组 | 必填 | 单个或多个独立 Swagger |
| output | string | src/api/aidocs | Markdown 输出目录 |
| tags | string[] | 全部接口 | worma 标签筛选快捷方式，与 apiFilter 互斥 |
| apiFilter | FilterApiConfig / FilterApiConfig[] | 全部接口 | URL / 标签筛选规则，与 tags 互斥 |
| enable | boolean | true | false 时跳过 Markdown 和请求代码生成 |
| force | boolean | false | 忽略 Markdown 生成的 worma 缓存；Webpack 中也允许后续运行再次进入生成流程 |
| generateClient | boolean | false | 请求代码生成默认开关 |
| client | ClientOptions | 见下表 | 请求生成默认设置 |

插件的 `tags` 使用 worma 的 tag/include 字符串匹配语义；MCP 来源的 `tags` 是精确匹配。需要严格控制插件筛选时可使用 `apiFilter` 正则或函数。

### Vite / Webpack 来源配置：swagger[]

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| swagger | string | 必填 | 该来源的 URL / 本地路径 |
| output | string | 继承顶层 | 独立的 Markdown 输出目录 |
| tags | string[] | 继承顶层筛选 | 与该层 apiFilter 互斥；空数组可清除继承的标签筛选 |
| apiFilter | FilterApiConfig / FilterApiConfig[] | 继承顶层筛选 | 与该层 tags 互斥；空数组可清除继承筛选 |
| generateClient | boolean | 继承顶层 | 该来源的请求生成开关 |
| client | ClientOptions | 逐字段继承顶层 | 该来源的请求生成配置 |

`enable` 和 `force` 只支持插件顶层，不支持逐来源设置。

### 公共 ClientOptions：client

| 字段 | 类型 / 可选值 | 默认值 | 说明 |
| --- | --- | --- | --- |
| output | 非空 string | src/api/generated | 请求代码目录，多来源分目录规则见上文 |
| library | axios / fetch / ky | axios | worma 内置请求模板 |
| type | typescript / module / commonjs | typescript | 请求实现格式 |
| nameStyle | camelCase / snakeCase / pascalCase | camelCase | 方法名风格，不能用 kebabCase 生成 JS 标识符 |

只填写 `client` 不会开启生成，必须由顶层或来源级 `generateClient: true` 显式开启。

### 插件运行时机与错误处理

- Vite：在 `configResolved` 中获取 root，在 `buildStart` 时进入生成流程。
- Webpack：监听 `beforeRun` / `watchRun`；默认每个插件实例只尝试一次，`force: true` 时后续运行也会重新尝试。
- 插件的文档或请求生成失败会记录警告，不阻断业务构建。
- MCP：全部来源加载完成，并完成显式开启的请求生成后，才连接 stdio；失败时通过 stderr 报错并退出。
- MCP 配置更新后需要重启；Swagger 内容更新通过查询时过期刷新或 refresh_apis 获取。当前没有后台轮询或文件监听。
- `force` 不控制请求生成缓存：进入已开启的请求生成流程时会重新生成。

## MCP 工具与只读范围

| 工具 | 参数 | 返回内容 |
| --- | --- | --- |
| list_apis | source?、tag?、method?、offset?、limit? | 来源名称、接口摘要、接口 ID、总数和分页位置 |
| search_apis | query 必填，以及上述筛选参数 | 搜索路径、摘要、描述、operationId 和标签 |
| get_api_detail | id 必填、maxDepth? | 完整的文档契约及引用展开警告 |
| refresh_apis | source? | 强制重新读取指定来源或全部来源，返回成功标记及刷新时间/错误；不生成文件 |

- `source` 和 `tag` 精确匹配；`method` 使用 GET / POST / PUT / PATCH / DELETE / HEAD / OPTIONS / TRACE 大写值。
- `offset` 默认 0，必须是非负整数；`limit` 默认 20，范围 1–100。返回的 `nextOffset` 为 null 表示结束。
- `query` 忽略大小写，空格分隔的词需全部匹配，长度 1–500。
- `id` 使用列表或搜索返回的完整值，例如 `knowledgebase::POST /api/Example/Query`。
- `maxDepth` 默认 8，范围 1–20，限制内部引用展开层数。

详情包含参数位置、必填项、请求体、响应状态码、媒体类型、响应头、嵌套字段、枚举、约束、示例和认证声明。保留 allOf / oneOf / anyOf 的含义。循环、缺失和外部引用出现在 warnings 中，并以 x-worma-ref-status 标注；结构截断使用 x-worma-truncated。文档未定义的字段代表未知，不会推断实际调用结果。

MCP 查询支持 Swagger 2.0、OpenAPI 3.0 / 3.1。远程文档超时 30 秒，大小上限 20 MiB，不跟随 HTTP 重定向，当前不支持自定义认证请求头。外部引用不会由查询工具自动读取，多文件规范建议预先打包为一个文档。

四个工具均只读：不修改 Swagger、不执行业务接口、不接受任意 URL 或文件路径，也不能开启代码生成。代码生成只能由用户在启动配置中明确启用。客户端其他终端、文件编辑工具的权限需单独控制。stdout 专用于 MCP 协议，日志使用 stderr。

可向 AI 提问：

> 先使用 MCP 搜索知识库目录接口，读取入参和响应，再用项目已有的 request 封装实现调用。

### 程序化使用

```ts
import path from 'node:path'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  loadConfig,
  OpenApiRepository,
  createWormaMcpServer,
} from 'plugin-worma-docs/mcp'

const filename = path.resolve('worma-mcp.json')
const config = await loadConfig(filename)
const baseDir = path.dirname(filename)
const repository = await OpenApiRepository.load(config, baseDir)

// 可选启动动作：不开启 generateClient 时不产生任何请求代码。
await repository.generateClients(config, baseDir)

// 程序化查询使用异步方法检查有效期；list()/detail() 仍保留为同步快照读取。
await repository.listFresh({ source: 'knowledgebase' })
// 强制刷新（可选）：await repository.refresh('knowledgebase')

const server = createWormaMcpServer(repository)
await server.connect(new StdioServerTransport())
```

直接使用 SDK 传输层时，请在宿主项目显式安装 `@modelcontextprotocol/sdk`。仅使用命令行入口时不需要额外安装 SDK。

三个入口导出公共 `ClientOptions` / `ClientGenerationSettings` 类型；构建插件还导出 `WormaDocsOptions` / `WormaDocsSource` / `FilterApiConfig`，MCP 入口导出 `McpConfig` / `OpenApiSource` / `ApiSummary` / `ApiQuery`。

## 本地开发、测试与发布

仓库采用单包、多入口结构，无需 pnpm-workspace.yaml。playground、playground-webpack、playground-mcp 分别演示 Vite、Webpack 和 MCP。

### 本地启动

```sh
pnpm install
pnpm build
pnpm dev
# 或：
pnpm dev:webpack
# 或：
pnpm dev:mcp
```

`dev:mcp` 使用 playground-mcp/worma-mcp.json。该示例明确开启了 Axios + ESM JavaScript + camelCase 生成，产物保留在 playground-mcp/generated，已被 Git 忽略；包本身的生成默认值仍是 false。

使用本地构建入口接入客户端：

```json
{
  "mcpServers": {
    "worma-docs-local": {
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

请替换为自己的绝对路径。修改源码后需要重新构建，并重启客户端中的服务。

### 测试

```sh
pnpm typecheck
pnpm test
pnpm test:mcp:live
pnpm test:mcp:live --generate-client
```

- typecheck：检查 TypeScript 类型。
- test：构建三个入口，运行本地 OpenAPI、MCP 协议、自动/手动刷新、失败回退、代码生成及方法命名测试，不访问公司网关。
- test:mcp:live：读取示例配置中的公司 Swagger，验证列表、搜索和详情；按示例配置生成并保留请求实现供查看。
- 追加 --generate-client：将公司接口生成到临时目录中验证，结束后清理；已有 playground 产物不会被删除。

实测只读取 Swagger 文档，不调用业务接口。

### 发布准备

先完成类型检查和本地测试，再更新版本、检查发布内容：

```sh
pnpm typecheck
pnpm test
npm version patch --no-git-tag-version
npm pack --dry-run --ignore-scripts
```

`npm version patch` 更新 package.json 中的补丁版本，不创建 Git 标签；根据实际发布计划也可以选择其他版本号。已发布的版本号不能重复使用。

发布包包含 dist、templates、README 和 LICENSE，不包含公司测试产物、playground 或 tests。确认版本、产物和 npm 账号正确后，执行：

```sh
npm publish
```

prepublishOnly 会再次构建。发布后，将客户端中固定的旧包版本更新到新版本并重启 MCP。
