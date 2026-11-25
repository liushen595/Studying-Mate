# Studying-Mate · 考研英语 AI 精读与解析助手

**Studying-Mate** 是一款 **纯前端、零后端依赖（BYOK）** 的考研英语（英语一 / 英语二）AI 精读与生词管理 Web 应用。所有试卷数据、生词本与 API Key 均保存在本地浏览器（IndexedDB / LocalStorage），网络请求由浏览器直连各大 LLM 官方接口，可直接部署至 Cloudflare Pages 等静态托管平台。

> 详细系统设计与各供应商接口实测说明见 [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)。

---

## 核心特性

### 1. 多供应商直连与 Agent 级参数工作台
- **五大预设供应商 + 自定义供应商**：内置 **DeepSeek**、**阿里云百炼（Model Studio）**、**OpenAI**、**Anthropic（Claude）**、**Google Gemini**，以及支持 `openai-compatible` / `openai-responses` / `anthropic-messages` / `gemini-native` 四种协议的自定义供应商。
- **双槽位模型路由**：支持「主分析模型」与「视觉 OCR 模型」分离配置（默认跟随主模型），方便使用纯文本强推理模型（如 `deepseek-v4-pro`）做精读解析，同时搭配视觉模型（如 `deepseek-flash`、`qwen3-vl-plus`、`gemini-2.5-flash`、`gpt-5`）做拍照识图。
- **精细参数与防 400 保护**：支持上下文窗口、最大输入/输出 Token、深度思考开关/档位/预算（`thinking` / `reasoning_effort` / `enable_thinking` + `thinking_budget` / `thinkingLevel` / `thinkingBudget`）、采样参数（`temperature`、`topP`、`topK`、`frequencyPenalty`、`presencePenalty`、`seed`）、流式传输、图像清晰度等统一配置，并按供应商协议自动隔离互斥参数避免 HTTP 400。
- **阿里云百炼专属域名辅助**：内置 `WorkspaceId` + 地域（Region）拼接器，快速生成 `https://{WorkspaceId}.{region}.maas.aliyuncs.com/compatible-mode/v1`。
- **透明执行态与错误诊断**：实时展示分段进度、TTFT、Token 统计与可折叠的模型思考流；请求失败时完整呈现 HTTP 状态码、Endpoint、Request-ID、中文排查建议与原始返回体，支持一键复制与单段重试。

### 2. 双模输入、AI 生词补充与 OCR 中间校对态
- **文本输入与精准分段**：粘贴单篇或整套真题文本，使用 `{{word}}` 标记生词（选中按 `Ctrl/Cmd + M` 一键包裹/取消），支持在光标位置一键插入 `=== [标准标签] ===` 分段标记，或切换为「AI 智能切分整卷」。
- **两种生词提取策略**：
  - **仅提取手标 `{{生词}}`**：100% 精准提取手动或红笔框选生词。
  - **AI 自动总结 / 在手标基础上补充**：未框词时自动提炼考研核心词与熟词僻义；已有手标词时自动去重并智能补充遗漏词汇（支持精简 / 适中 / 全面三档密度），并在精读视图自动添加可点击下划线（不污染原文本）。
- **图像输入（Stage 1 仅 OCR → 人工校对 → Stage 2 深度解析）**：
  - 支持多图上传、拖拽排序、90° 旋转、增量追加 OCR 与 `Ctrl+V` 剪贴板粘贴（识别完成后图片自动释放，不持久化到 IndexedDB）。
  - 前端 Canvas 保留彩色通道并等比压缩，清晰识别**红笔方框生词**与**红笔订正答案**。
  - OCR 完成后停留在**左右分屏校对工作台**（左侧高清原图缩放对照，右侧带高亮文本编辑器并可存草稿），确认无误后再进入解析流水线。

### 3. 考研英语分题型精读与生词本
- **文章翻译与解析**：
  - **完形填空**：自动将正确答案填入原文空位（优先采用卷面订正答案），点击绿色胶囊可对照 A/B/C/D 选项与简要释义，并给出代入答案后的全文译文。
  - **传统阅读**：支持「逐段对照 / 双栏对照 / 纯英文」切换、衬线/无衬线与字号调节，文末紧凑展示题干与答案。
  - **新题型（七选五 / 排序 / 小标题匹配 / 多项对应）**：按四类子题型差异化还原完整文章与选项池（支持七选五回填、排序题还原顺并标识固定段、小标题置顶、英语二多项对应），选项池支持点词查词。
  - **翻译题（结构化句子剖析）**：按结构化 JSON 渲染为视觉卡片——**句子主干提取（S/V/O）+ 分层成分拆解卡片 + 直译/考场润色译文对比 + 得分点**，告别大段纯文本解析。
  - **写作题（Part A / Part B）**：提供审题要点、谋篇大纲、中英对照高分范文、提分好词替换与亮点句型库。
  - **交互式单词小卡片**：原文生词以克制虚线下划线标出，点击弹出浮卡展示音标、英/美语音朗读（Web Speech API）、**本文语境释义（标出熟词僻义）**、**全面多词性释义**及高频搭配。
- **本卷生词本 & 全部生词汇总**：
  - 支持按题型筛选、按来源筛选（手标 / AI 补充）、搜索、排序与「背词遮挡自测模式」。
  - **打印 / 导出 PDF（A4 防截断排版）**：基于专用 `@media print` 块级流与双栏原子行排版，提供三种模板（完整精读版 / 紧凑双栏背词版 / 默写自测版），彻底防止单词卡片跨页腰斩；同时支持导出 **Markdown** 与 **Anki `.tsv`**。

### 4. Island 极简 UI、WebDAV 云端同步与 E2EE 隐私保护
- 现代 Island 浮岛卡片式布局，支持 **跟随系统 / 浅色 / 深色** 无闪烁主题切换。
- 支持一键导出/导入全量学习数据与非敏感设置 JSON 备份（默认自动剔除 API Key 与 WebDAV 密码）。
- **WebDAV 云端备份与双向智能同步**：支持路径自动规范化、缺失目录自动递归 `MKCOL` 创建、一键连通性测试与清晰排障提示、历史快照轮转与按更新时间智能合并。
- **可选 API Key 端到端加密（E2EE）**：使用浏览器原生 `PBKDF2-HMAC-SHA256`（60 万次迭代）+ `AES-256-GCM` 对 API Key 进行客户端加密，仅随主备份 `studying-mate-latest.json` 同步（历史快照不含密钥），独立同步口令仅暂存当前标签页 `sessionStorage`。

---

## 技术栈

- **构建与语言**：Vite 6 + React 19 + TypeScript 5
- **样式与交互**：Tailwind CSS v4 + Lucide React + Floating UI
- **状态与存储**：Zustand + Dexie.js（IndexedDB）
- **结构化校验**：Zod + `jsonrepair`

---

## 本地开发与部署

### 环境要求
- Node.js >= 20（当前验证环境为 `v24.18.0`）
- `pnpm`

### 启动开发服务器
```bash
pnpm install
pnpm dev
```
访问 `http://localhost:5173`。打开首页后可直接点击 **「加载全题型示例卷」** 体验全部精读与打印功能，或在 **「设置」** 中填入 API Key 并测试连接。

### 构建与部署到 Cloudflare Pages
```bash
pnpm build
```
- **构建命令**：`pnpm build`
- **输出目录**：`dist`
- 仓库已内置 `public/_redirects`（`/* /index.html 200`）以支持 SPA 前端路由刷新回退。
