import DictionaryPanel from './dictionary-panel';
import EventTimePanel from './event-time-panel';
import ExperimentPanel from './experiment-panel';
import MetadataPanel from './metadata-panel';
import FrequencyPanel from './frequency-panel';
import InsightsPanel from './insights-panel';
import WorkspaceAdvanced from './workspace-advanced';
import WorkspacePanel from './workspace-panel';
import TemplateRunner from './template-runner';
import ArchivePanel from './archive-panel';
import ManagementPanel from './management-panel';
import StoragePanel from './storage-panel';
import SchedulesPanel from './schedules-panel';
import OperationsPanel from './operations-panel';
import AnomalyRecords from './anomaly-records';
import ConnectionCheck from './connection-check';
import {requireChatGPTUser} from './chatgpt-auth';
export const dynamic='force-dynamic';
export default async function Home(){
 await requireChatGPTUser('/');
 return <main style={{maxWidth:880,margin:'72px auto',padding:'28px',fontFamily:'system-ui',color:'#18242d',background:'#ffffff',colorScheme:'light'}}>
 <p style={{color:'#437767',fontSize:14}}>DATAFINDER / PRIVATE</p><h1 style={{fontSize:42,margin:'18px 0'}}>云端数据查询</h1>
 <p style={{fontSize:19,lineHeight:1.8}}>在 ChatGPT 中读取示例业务 看板与报表。查询服务运行在云端，无需保持电脑开机。</p>
 <nav aria-label="主要功能"><a href="#dictionary">指标字典</a> · <a href="#event-time">当天与小时查询</a> · <a href="#operations">运行记录</a></nav><ConnectionCheck/><DictionaryPanel/><EventTimePanel/><InsightsPanel/><FrequencyPanel/><MetadataPanel/><ExperimentPanel/><SchedulesPanel/><OperationsPanel/><AnomalyRecords/><ManagementPanel/><StoragePanel/><ArchivePanel/><TemplateRunner/><WorkspacePanel/><WorkspaceAdvanced/>
 <section style={{padding:28,background:'#f3f6f4',borderRadius:18,marginTop:36}}><h2>全项目查询与虚拟对象管理</h2><p>全项目报表 · 指标口径 · 临时筛选分组 · 自由事件与留存 · 属性取值 · 用户属性目录 · 版本回归对比 · 手动健康检查 · 属性质量 · 有序漏斗 · 指标字典 · 保存巡检规则与批量执行 · 变更依赖检查 · 生命周期 · LTV · 事件次数排行 · 分群目录与受控创建/修改/刷新 · 数值属性分布 · 首触/末触/线性归因 · 查询模板 · 云端任务 · 巡检计划 · CSV/Excel XML导出 · 每日用量 · 虚拟事件与属性 · 已保存 SQL</p><p>路径和用户成分分析返回不完整结果时不能下业务结论。用户标签需要另购 CDP，仅购买 Finder 时可能不可用，请核实自己的套餐；普通报表和看板写入尚无已核验接口。依赖检查标明扫描范围，不保证发现所有引用。</p><p>每次查询保留来源、查询时间与质量提示。数据是否完整、数值是否一致，以实际验收为准。</p></section>
 <section style={{padding:'28px 0',lineHeight:1.9}}><h2>开始使用</h2><p>在插件列表中连接「DataFinder 云端查询」，然后说：</p><blockquote>检查 DataFinder 连接状态，列出示例业务 报表。</blockquote><blockquote>查询页面访问率，说明日期范围和指标口径。</blockquote><blockquote>分析 10 月 1 至 7 日的启动人数，按语言分组，并查看属性有哪些取值。</blockquote><blockquote>读取虚拟事件的完整定义，预览需要的修改，等我确认后提交。</blockquote><blockquote>检查 10 月 10 日启动事件的健康情况，与前两周同一天对比。</blockquote><blockquote>统计启动事件 os_name 的缺失率，并用 android、ios 白名单检查其他取值。</blockquote><blockquote>分析从启动到播放的两步人数漏斗，转化窗口为 1 天。</blockquote><blockquote>比较 iOS 2.9.1 和 3.0.0 的启动与播放漏斗，使用相同日期和筛选条件。</blockquote><blockquote>检查支付成功事件 order_amount 是否缺失或超出指定数值范围。</blockquote><blockquote>读取已保存 SQL 报表的定义，按该版本执行查询。</blockquote><blockquote>读取报表口径并保存指标字典，标明分子、分母和去重规则。</blockquote><blockquote>读取保存的巡检规则，按最新版本批量检查 10 月 10 日的数据。</blockquote><blockquote>修改虚拟事件前，分页检查它被哪些报表直接引用。</blockquote><blockquote>查询 10 月 10 日按事件次数排名前 20 的事件。</blockquote><blockquote>保存一个查询模板，按指定日期提交云端任务，并读取进度。</blockquote><blockquote>读取站内异常记录，查看异常依据和恢复状态。</blockquote><p>高级分析每次最多 7 个完整自然日。首次使用请先检查连接状态。支持最多 31 个北京时间完整自然日；返回子查询来源与日期。</p></section>
 <small style={{color:'#6b747b'}}>仅本人访问。虚拟事件和属性的创建、修改须先预览并确认。变更记录保存在云端；写入后逐字段核验；修改虚拟事件不支持描述字段，传入即拒绝；其他写入按字段核验。密钥不返回客户端。</small></main>;
}
