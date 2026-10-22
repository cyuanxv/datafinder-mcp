# 0.2.1 验收与功能边界

本轮修复数字筛选草稿误转零，以及一个计划提交失败导致整轮中断的问题。默认只读、修改预览与确认保持原样。

- 444 项自动化测试、类型检查、生产构建通过。
- 52 个工具发现及参数分派检查；32 项独立集成验收通过。工具发现/错误参数校验不等于 52 个上游功能逐项真实验收。
- 实际 React 筛选/追问组件与临时独立数据库：数字空白提示并拒绝错误预览，负数保留，查询记录保存、回读、追问继承验收。
- 独立 worker 在 MCP 前台断开后完成多步虚构查询；缺失模板失败被保留，后续任务继续；重开前台后回读并导出。持续运行在本机独立进程，不声称物理关机或远程主机已实测。
- 全局/事件筛选、AND/OR及嵌套组合经过编译器与真值表检查；不把测试夹具当作所有租户真实结果。

## 仍待厂商明确

行为与动态圈选；主体/身份切换；留存与漏斗关联属性、无序与次数；自定义窗口优先级；分布精确边界、原生快捷分组与成分分母；多天生命周期；完整路径与归因；广告LTV/eCPM、业务维度、用户日志；扩展聚合；原生指标、报表和看板写入。提供接口入口不代表这些能力已完成。

具体租户信息、日志、候选指标和私人配置不进入公开源码。指标导入仍要求单独预览确认。

## Published package verification

Version 0.2.1 was installed from the public npm registry into a clean directory; all 32 integration checks passed with 52 tools. The official MCP Registry reports version 0.2.1 as active and latest. No private tenant data or credentials are included in this evidence.
