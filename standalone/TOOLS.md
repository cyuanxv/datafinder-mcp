# 独立版 52 个工具清单

与云端版保持相同工具名。安装版新增统一的预览确认参数，但保留原有工具参数、版本和确认规则。52 项已完成发现和参数分发检查；业务实现通过项目回归测试。真实 DataFinder 只读验收覆盖自由事件查询、保存报表与后台查询导出，不代表所有火山接口都逐项做过真实写入。

| 工具 | 用途 |
|---|---|
| `mapping_import` | 埋点文档差异与影响 |
| `business_contracts` | 收入与实验业务口径 |
| `analysis_workbench` | 组合分析与对照验收 |
| `mapped_analysis_plans` | 映射分析计划与升级 |
| `tracking_mapping` | 云端埋点映射与版本 |
| `native_metadata` | 原始元数据读取与修改 |
| `analyze_insights` | 周期对比与专题诊断 |
| `analysis_session` | 连续分析条件与追问 |
| `assess_experiment` | 实验聚合结果检查 |
| `manage_workspace` | 批量配置与历史趋势 |
| `manage_definitions` | 配置检查与版本管理 |
| `read_operations` | 运行记录与故障排查 |
| `dependency_scan_jobs` | 后台依赖扫描 |
| `get_connection_status` | 连接状态 |
| `find_assets` | 查找资源 |
| `get_dashboard` | 读取看板 |
| `get_metric_definition` | 读取指标口径 |
| `query_report` | 查询报表 |
| `query_analysis` | 按日期重放报表 |
| `run_analysis` | 自由分析与临时报表筛选 |
| `inspect_property_values` | 检查属性取值 |
| `check_tracking_health` | 手动埋点健康检查 |
| `check_property_quality` | 属性质量统计 |
| `run_funnel` | 自由有序漏斗 |
| `list_user_properties` | 检索用户属性目录 |
| `compare_versions` | 版本回归对比 |
| `run_distribution` | 数值分布与用户成分 |
| `run_advanced_analysis` | 高级聚合分析 |
| `read_tags` | 读取标签目录及基本信息 |
| `manage_cohort` | 读取与管理规则分群 |
| `list_cohorts` | 分群目录 |
| `query_daily_usage` | 每日用量 |
| `export_aggregate_result` | 导出聚合结果 |
| `inspection_schedules` | 保存巡检计划与执行云端轮询 |
| `cloud_query_jobs` | 云端查询任务 |
| `query_templates` | 保存和执行查询模板 |
| `manage_anomaly_record` | 处理站内异常记录 |
| `manage_job_archive` | 归档与恢复任务列表 |
| `read_storage_usage` | 存储用量与归档预览 |
| `read_anomaly_records` | 读取站内异常记录 |
| `metric_dictionary` | 指标字典检索与维护 |
| `get_dictionary_source` | 读取词典来源版本 |
| `save_governance_record` | 保存指标字典或巡检规则 |
| `read_governance_records` | 读取指标字典与巡检规则 |
| `run_check_batch` | 执行保存的巡检规则批次 |
| `read_check_batch` | 读取巡检批次结果 |
| `scan_virtual_dependencies` | 检查虚拟对象引用与传递影响 |
| `read_virtual_asset` | 读取虚拟事件与虚拟属性 |
| `preview_virtual_change` | 预览虚拟对象变更 |
| `apply_virtual_change` | 确认提交虚拟对象变更 |
| `get_virtual_change` | 读取虚拟对象变更记录 |
| `saved_sql` | 读取与执行已保存SQL |

上游限制仍保留：用户标签需要对应 CDP 购买权限；原始事件创建、原始事件属性创建及虚拟事件描述修改等未核实或不支持的接口，继续返回明确限制，不宣称安装包已绕过。后台 worker 只执行已经确认的查询任务，不修改上游报表。
