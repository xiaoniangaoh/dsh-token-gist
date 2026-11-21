# dsh-token-gist

一个 DeepSeek Harness (DSH) 插件，用于维护**累计 Token 用量总计**，并将其备份到 **GitHub gist**。总计保存在独立文件中，从新提交的会话事件中累加，因此**不是**从会话日志派生的——删除、归档或压缩对话都不会减少总计。

## 它能做什么

- **累计总计** —— 统计每一场对话（包括子代理）的用量，按提供商报告的用量计算：输入、输出、缓存读取、缓存写入 Token。
- **删除对话后仍保留** —— 运行总计与会话日志独立。只有*新的*模型尝试会被累加，因此恢复的会话不会被重复计算。
- **Gist 云备份** —— 总计（加上按天明细）推送到私有 GitHub gist。支持按间隔自动同步，也支持一键手动同步。
- **侧边栏卡片** —— 显示运行总计和上次同步状态，带一个“同步”按钮。
- **斜杠命令** —— `/token-usage` 打印总计；`/token-usage sync` 立即推送到 gist。
- **本地持久化** —— 状态以原子方式写入 `$DSH_HOME/dsh-token-gist/state.json`。

## 安装

从本地目录（此检出）：

```
plugin_manager  action: install_bundle  target: <此目录的绝对路径>
```

## 配置

在 **Settings → Plugins**（插件的专属页面）中配置，或编辑 `cordis.patch.yml`：

| 字段 | 默认 | 含义 |
|---|---|---|
| `gistToken` | — | 带 **gist** 写入权限的 GitHub 个人访问令牌（PAT）。建议使用仅限 “Gists → 读写” 的细粒度 PAT，可随时撤销。 |
| `gistId` | — | 要更新的现有 gist id。为空则首次同步时自动新建 gist。 |
| `gistFilename` | `dsh-token-usage.json` | gist 内的文件名。 |
| `autoSync` | `true` | 按间隔自动同步到 gist。 |
| `syncIntervalMinutes` | `30` | 自动同步间隔（1–1440 分钟）。 |
| `description` | `DSH token usage total` | gist 描述。 |

也可通过环境变量 `DSH_TOKEN_GIST_TOKEN` 设置令牌。

## 注意和限制

- 计数从插件安装时开始。安装前的用量不会被回填（不会重放会话历史到计数器）。
- 总计使用提供商报告的用量。当提供商不报告用量时，该尝试贡献为零（与 DSH 自身的 token-meter 一致）。
- gist 仅存储总计和按天明细——从不上传对话内容。
- 令牌存储在你的本地 profile 配置中。请使用权限窄且可撤销的令牌。

## 许可证

MIT
