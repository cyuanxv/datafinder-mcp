# GitHub 发现入口设置 / Repository discovery setup

本文件记录新公开仓库的发布设置。源码文件不会自动设置仓库的 About、Topics 或分享封面。仅在确定发布的新仓库中应用；不要把原私有仓库改为公开。

These settings are prepared locally, not applied to GitHub. Apply them only to the intended new repository when publication is approved.

## 仓库名称 / Name

建议 `datafinder-mcp`。名称是否可用需创建时确认。

## 仓库简介 / About description

复制下面这一整段到仓库首页 About 右侧齿轮里的 Description：

Connect Volcengine DataFinder to ChatGPT with MCP: conversational product analytics, retention, funnels, metric dictionaries and CSV exports. 用自然语言查数、分析留存与转化，支持指标字典和结果导出。

英文放前面便于海外用户理解；中文补充国内用户常用词。不添加没有证据的用户量、排名或效率倍数。

## Topics

在同一个 About 编辑窗口逐个添加以下 12 个主题，然后保存：

`datafinder`, `volcengine`, `mcp`, `mcp-server`, `model-context-protocol`, `chatgpt`, `product-analytics`, `conversational-analytics`, `retention-analysis`, `funnel-analysis`, `data-analysis`, `typescript`

覆盖产品名、MCP 生态和实际分析用途。GitHub 限制最多 20 个主题，每个最多 50 字符，使用小写字母、数字和连字符。主题有助于分类发现，不保证搜索排名或流量。

## 分享封面 / Social preview

Settings → Social preview → Edit → Upload an image，选择 [英文封面](../assets/cover.en.png)。尺寸 1280 × 640，PNG 小于 1 MB。该图用于分享仓库链接时的卡片；README 顶部图片需要单独保留。

[中文封面](../assets/cover.zh.png) 用于中文 README 和中文传播。GitHub 分享封面只选一张，默认英文版。

## Website

暂时留空。以后有独立公开的项目主页或演示站，再填其地址。不要填写个人私有服务地址、本机演示地址或尚未存在的网址。

## 发布后回读检查

- 仓库首页显示完整简介和全部 12 个 Topics。
- 分享封面设置已保存；检查仓库分享预览，外部平台可能有缓存。
- 中英文 README 图片和教程链接能正常打开。
- 独立公开主页就绪后再填写 Website。

机器可读设置见 [github-metadata.json](github-metadata.json)。该文件仅记录设置，不会自动修改仓库。

## 官方说明 / References

- [GitHub Topics](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics)
- [GitHub social preview](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview)
