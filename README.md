# dsh-wps

让 DeepSeek Harness 里的 Agent 直接使用**本机安装的 WPS Office**：生成与读取文档、表格、演示文稿，导出 PDF，并把结果打开给用户看。

这不是"另写一个 Office 库"，而是通过 COM 自动化驱动用户真实的 WPS，所以产出的文件与该用户打开时看到的版式一致。

## 能力

插件注册 11 个 Agent 工具：

| 工具 | 作用 |
| --- | --- |
| `wps_env` | 探测 WPS 安装状态：三大组件 ProgID、可执行文件路径、常驻进程数。不启动 WPS |
| `wps_writer_create` | 由结构化内容块生成 `.docx`（标题 / 段落 / 项目符号 / 编号 / 引用 / 分页 / 表格），或追加到已有文档；可选同时导出 PDF |
| `wps_writer_read` | 打开 `.docx`/`.doc` 读取文字，表格渲染为 ` | ` 分隔的行 |
| `wps_sheet_create` | 由一个或多个工作表生成 `.xlsx`，首行加粗、列宽自适应，大表用整块赋值 |
| `wps_sheet_read` | 读取工作表已用区域（数字保持数值类型），返回制表符分隔的网格 |
| `wps_slides_create` | 由「标题 + 要点」生成 `.pptx` |
| `wps_slides_read` | 读取每页文字 |
| `wps_convert_pdf` | 用拥有该格式的 WPS 引擎把 doc/xls/ppt 转成 PDF |
| `wps_open` | 在可见的 WPS 窗口里打开文件给用户看 |
| `wps_close` | 关闭某个已打开的文档（不影响同窗口其他文档） |
| `wps_quit` | 释放插件启动的自动化实例 |

## 安装

```powershell
dsh plugin --profile <profile> add link:<本目录>
```

`desktop` profile 由桌面应用独占管理，改为在 GUI 的插件管理器中安装：

```
link:E:\dsh-plugin\wps-create
```

安装后 profile 的 bundle 列表会出现 `dsh-wps`。工具在当前宿主进程中热加载，无需重启。

## 配套 Skill：定制版 ppt-master

插件负责「操作 WPS」，但要**做出高质量的 PPTX**，还需要一个会做演示文稿的技能。
本仓库附带一份定制版 [ppt-master](https://github.com/hugohe3/ppt-master) 的安装器：

```bash
node skill/ppt-master/install.mjs
```

它会从上游拉取完整技能包、覆盖两处本地定制，然后运行官方完整性门禁验证结果。

| 定制 | 作用 |
|---|---|
| **Pre-Flight Intake** | 开工前先问清楚：浏览器确认还是对话确认？完整流程还是快速生成？ |
| **Cost Discipline** | 记录真实成本形状（动手前必读的契约文档约 150 KB，属固定成本）；明确 Quick 省流程不省执行；禁止因求快而砍掉配图等内容需求 |

**需要知道的三件事**：

- ppt-master 是**第三方作品**（作者 **Hugo He**，**MIT** 许可）。本仓库只分发**定制差异**，
  官方代码始终在安装时从上游获取，署名文件保持完整。
- 两者**没有代码依赖**。推荐组合：用 ppt-master 生成 PPTX，再用本插件的 `wps_open`
  打开给你看、`wps_convert_pdf` 导出 PDF 校验 —— 通过文件路径衔接。
- 详细说明与故障处理见 [`skill/ppt-master/README.md`](skill/ppt-master/README.md)。

## 安全设计

这个插件能改用户磁盘上的文件，所以安全默认是刻意的：

- **覆盖需要显式同意**。目标文件已存在时，`create` 类操作直接失败，除非调用方传 `overwrite: true`。这一点对默认 PDF 输出路径同样成立。
- **绝不动用户自己的 WPS 会话**。已运行的 WPS 实例通过 Running Object Table 复用：不改它的 `Visible`，不关闭它的文档，更不会 `Quit`。
- **`wps_quit` 默认只关闭没有打开文档的实例**，因此不会丢掉用户未保存的工作；`force: true` 才会越过这道保护。
- **Node 侧只传数据，不生成 PowerShell 代码**。请求是 UTF-8 JSON 文件，从根本上没有脚本注入面。
- **`wps_convert_pdf` 以只读方式打开源文件**，从不修改原文件。

## 架构

```
src/index.ts       Cordis 插件入口：注册工具 + 系统提示公告
src/tools.ts       11 个工具的定义（参数、输出 schema、渲染、执行）
src/ops.ts         领域层：路径解析、写入安全判断、结果渲染（纯函数）
src/bridge.ts      Node → worker 桥接：串行队列、超时、取消
src/tool-kit.ts    defineTool 的零依赖等价实现
src/json-schema.ts author spec → JSON Schema 编译 + 参数校验
scripts/wps-worker.ps1   PowerShell COM 执行器（纯 ASCII）
```

三个设计决定值得说明：

**为什么每次调用起一个新进程。** 一个请求一个 `powershell.exe`，用 UTF-8 JSON 文件而不是管道通信。文件通信完全绕开控制台代码页协商，中文、引号、反斜杠、emoji 都能字节精确往返——这是实测过的，不是推断。WPS 实例本身仍然被复用（通过 ROT），所以第二次调用通常比第一次快一半。

**为什么零运行时依赖。** 插件不带任何 `@deepseek-ai/*` 运行时依赖，`lib/` 里没有一行 `import`。这样无论宿主用真实路径还是符号链接路径解析这个包，都不会出现模块解析失败。代价是自己实现 schema 编译与校验，而这一点用官方 `defineTool` 做了逐字节对照测试来兜底。

**为什么串行。** COM 自动化服务器是单线程套间，并发调用会在同一个 WPS 实例里交错。`bridge.ts` 用 promise 链保证同一时刻只有一个 worker 进程。

## 依赖

运行时**零依赖**：`lib/` 里没有任何 `import` 语句。`devDependencies`（TypeScript 与官方 SDK 包）只用于构建和对照测试，不参与插件运行。

`pnpm install` 只装 25 个包：`autoInstallPeers` 关闭（宿主是全局安装，自己解析插件声明的 peer），官方 SDK 的 peer 包按 pnpm 的推荐做法显式列入 `devDependencies`，因此不会连带拉入整棵 `@deepseek-ai/dsh` 依赖树（500+ 个包，其中几个还需要原生构建）。

写入类工具会自动创建目标文件的父目录——WPS 对不存在的目录只回一句"文档保存失败"，不带路径，所以在 Node 侧先把目录建好。

## 测试

```powershell
npm run build      # tsc → lib/
npm test           # node --test
```

62 个测试，分四层：

- `tests/ops.test.mjs`、`tests/validation.test.mjs` —— 纯逻辑，毫秒级。
- `tests/schema-parity.test.mjs` —— 把本插件的 schema 编译器与校验器**逐字节对照官方 `defineTool`**：编译产物深度相等，11 个工具的参数在两边得到完全一致的判定。这是"零依赖"能成立的前提。
- `tests/plugin-entry.test.mjs` —— 插件入口契约：注册 11 个工具、公告的开关行为、销毁时全部注销。
- `tests/end-to-end.test.mjs` —— 10 个用例真实驱动 WPS：中文与 emoji 往返、表格读回、多工作表数值类型、幻灯片、PDF 导出（校验 `%PDF-` 文件头）、父目录自动创建，以及覆盖保护。WPS 未安装时自动跳过。

另有一个从**宿主真实解析路径**出发的加载验证——这条路径是直接跑源码目录盖不住的：

```powershell
node scripts/verify-load.mjs "C:\Users\<你>\.dsh\profiles\desktop\node_modules\dsh-wps"
```

它经 profile 链接导入入口、定位 worker 脚本、注册全部工具，并发起一次真实的 `wps_env` 调用。

## 已知限制

- 仅 Windows：依赖 COM 与 `powershell.exe`（Windows PowerShell 5.1，STA）。
- 写入仍需要 WPS 能正常启动；WPS 处于异常状态时错误来自 COM 层，`wps_env` 是第一诊断入口。
- `wps_sheet_create` 中字符串以 `=` 开头会被 WPS 解释为公式（与在 WPS 中手工输入一致）。
- 表格与幻灯片的样式支持是刻意保守的：字体大小、配色、图片尚未暴露。
