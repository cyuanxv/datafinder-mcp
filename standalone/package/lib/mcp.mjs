import {metricDictionary,dictionaryShape} from './dictionary.mjs';
import {mappingImport,mappingImportShape} from './mapping-import.mjs';
import {businessContracts,businessContractShape} from './business-contracts.mjs';
import {analysisWorkbench,workbenchShape} from './analysis-workbench.mjs';
import {mappedPlans,mappedPlanShape} from './mapped-plans.mjs';
import {trackingMapping,mappingShape} from './tracking-mapping.mjs';
import {nativeMetadata,nativeMetadataShape} from './native-metadata.mjs';
import {insightShape,runInsight} from './insights.mjs';
import {sessionShape,analysisSession} from './analysis-session.mjs';
import {experimentShape,assessExperiment} from './experiment.mjs';
import {workspaceShape,manageWorkspace} from './workspace.mjs';
import {managementSchema,manageDefinitions} from './management.mjs';
import {archiveShape,manageArchive} from './archive.mjs';
import {storageShape,storageOverview} from './storage.mjs';
import {manageAnomaly,handlingShape} from './anomaly-handling.mjs';
import {readOperations,operationsShape,dependencyJobs,dependencyJobShape} from './operations.mjs';
import {runDistribution,distributionShape} from './distribution.mjs';
import {manageCohort,cohortShape} from './cohorts.mjs';
import {exportShape,exportLink} from './export.mjs';
import {inspectionSchedules,scheduleShape} from './schedules.mjs';
import {cloudJobs,jobShape} from './jobs.mjs';
import {queryTemplate,templateShape} from './templates.mjs';
import {readAnomalies,anomalyShape} from './anomalies.mjs';
import {runAdvanced,advancedShape} from './advanced.mjs';
import {listCohorts,cohortsShape,queryUsage,usageShape,readTags,tagsShape} from './catalog-extras.mjs';
import {metricSource,saveRecord,readRecords,runBatch,readBatch,saveRecordShape,readRecordShape,batchShape} from './governance.mjs';
import {scanDependencies,dependencyShape} from './dependencies.mjs';
import {listUserProperties,userPropertiesShape} from './metadata.mjs';
import {compareVersions,regressionShape} from './regression.mjs';
import {checkTrackingHealth,healthShape,checkPropertyQuality,qualityShape} from './health.mjs';
import {runFunnel,funnelShape} from './funnel.mjs';
import {readVirtual,readVirtualShape,previewChange,changeShape,applyChange,getChange} from './virtual.mjs';
import {savedSql,savedSqlShape} from './saved-sql.mjs';
import {runAnalysis,inspectPropertyValues,analysisShape,propertyShape,modifiers,queryReportAdaptive} from './analysis.mjs';
import {metricDefinition} from './definitions.mjs';
import {querySavedReport} from './query.mjs';
import {readDashboard,findCatalog} from './dashboard.mjs';
import {McpServer,createMcpHandler,isLegacyRequest,WebStandardStreamableHTTPServerTransport} from '@modelcontextprotocol/server';
import {z} from 'zod/v4';
import {DataFinder,QueryError,REPORTS,APP,PROJECT,DASHBOARD,reportId,extractDSL,replayPlan,normalizeReport,normalizeMetadata,normalizeResults} from './core.mjs';
export function allowed(request,env) {
 const id=request.headers.get('oai-authenticated-user-id');
 // Trust these headers only behind owner-private Sites Dispatch, which authenticates the caller.
 return !!id && !!env.DATAFINDER_OWNER_USER_ID && env.DATAFINDER_OWNER_USER_ID===id;
}
export function createDataFinderServer(request,env,fetcher=fetch,options={}) {
 const server=new McpServer({name:options.name??'datafinder-cloud-query',version:options.version??'0.19.0'});
 const api=options.api??new DataFinder(env,fetcher);
 const wide=env.DATAFINDER_ALLOW_PROJECT_WIDE==='true';
 const register=(name,title,description,inputSchema,fn,write=false)=>server.registerTool(name,{title,description:options.describe?options.describe(name,description,write):description,inputSchema:z.object({...inputSchema,...(write?options.confirmationShape:{})}),annotations:{readOnlyHint:!write,destructiveHint:write,idempotentHint:!write,openWorldHint:true}},async args=>{
   try {if(!allowed(request,env))throw new QueryError('UNAUTHORIZED','需要本人授权连接。');const result=options.invoke?await options.invoke(name,args,clean=>fn(clean),write):await fn(args);return {resultType:'complete',content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result};}
   catch(e){const error={code:e instanceof QueryError?e.code:e instanceof z.ZodError?'INVALID_ARGUMENT':'INTERNAL_ERROR',message:e instanceof QueryError?e.message:e instanceof z.ZodError?'参数不符合查询契约，请核对日期、事件及筛选。':'查询失败；未输出内部错误详情。'};error.error_code=error.code;const conflict=error.code==='VERSION_CONFLICT',unsupported=['UNSUPPORTED_FIELD','UNVERIFIED_FIELD'].includes(error.code);const quality=['INCONSISTENT_COUNTS','INCOMPLETE_RESULT','UNVERIFIED_CONTRACT','UNVERIFIED_GROUP','UNVERIFIED_REVENUE','UNVERIFIED_MEASURE','UNVERIFIED_HOURLY_DATES'].includes(error.code);if(quality)Object.assign(error,{status:'incomplete',retryable:false});if(conflict||unsupported)Object.assign(error,{status:conflict?'conflict':'rejected',applied:false,retryable:false});return {resultType:'complete',isError:!(conflict||unsupported||quality),structuredContent:error,content:[{type:'text',text:JSON.stringify(error)}]};}
 });
 register('mapping_import','埋点文档差异与影响','结构化候选映射最多5项；preview给出差异、固定模板/计划影响及hash；apply需confirmed和hash，仅保存草稿，逐项返回结果，不自动发布、不删除未出现项。来源需明确文档摘要和单元格，非自动Excel解析。',mappingImportShape,a=>mappingImport(api,a,request.headers.get('oai-authenticated-user-id')),true);
 register('business_contracts','收入与实验业务口径','保存、回读、检查有版本的业务口径；未知项明确阻止结论。assess_experiment需固定实验版本和人工二元聚合，保留样本失衡检查，不宣告胜出。收入只保存定义，不计算净收入或首复购。',businessContractShape,a=>businessContracts(api,a,request.headers.get('oai-authenticated-user-id')),true);
 register('analysis_workbench','组合分析与对照验收','diagnose枚举最多3维组合、过滤小样本并排序线索，不合计重叠UV；bundle最多3项同日期同全局筛选分析，不计算缺成本ROI；capture确认后执行保存聚合证据，compare手工控制台单元格与固定查询指纹对照，仅证明所选数值匹配不证明语义。capture_query支持advanced/distribution；export需固定key和revision返回HTML证据报告。bundle/diagnose可带key、expected_revision和confirmed保存组合结果，保留历史。',workbenchShape,a=>analysisWorkbench(api,a,request.headers.get('oai-authenticated-user-id')),true);
 register('mapped_analysis_plans','映射分析计划与升级','固定模板和映射版本，保存默认预览；升级先preview_upgrade再confirmed及hash。tick复用云端队列，昨天完整日期，不自动迁移或删除。模板新版须显式升级计划；执行前校验映射。',mappedPlanShape,a=>mappedPlans(api,a,request.headers.get('oai-authenticated-user-id')),true);
 register('tracking_mapping','云端埋点映射与版本','save默认预览，confirmed保存草稿；validate读取实时元数据给出validation_hash；publish需confirmed、expected_revision和hash，追加发布版本。planned不能发布。read/history/list保留历史；run按指定revision或日期选择最新适用发布版本，query不传events/filters/revenue_property，extra_filters只追加AND筛选。query也支持user_frequency/user_cumulative_measure/numeric_event_distribution，使用start_date/end_date/boundaries；数值分布读取映射measure_property，必须单事件。执行前校验元数据指纹与类型，漂移/跨版本拒绝查询，不自动合并UV。元数据仅配置的应用，不证明全项目覆盖；不删除数据，不修改火山对象。',mappingShape,a=>trackingMapping(api,a,request.headers.get('oai-authenticated-user-id')),true);
 register('native_metadata','原始元数据读取与修改','仅配置的应用的普通事件、事件属性、用户属性定义；read读取，preview保存差异，apply用change_id及confirmation明确确认后提交，change回读变更。用户属性可创建；不支持删除或已有属性类型转换。',nativeMetadataShape,a=>nativeMetadata(api,a,request.headers.get('oai-authenticated-user-id')),true);
 register('analyze_insights','周期对比与专题诊断','周期/显式群体对比、事件次数贡献拆解、group_diagnosis多维群体UV变化排序（一个事件、baseline及group_by，识别重叠，不计算可加总UV贡献）、漏斗损失、留存队列、日级时间规律和关联、hourly_pattern小时规律（最多7个完整自然日、3个事件，上海时区次数，不相加小时UV）；revenue_quality查询一个支付事件的数值revenue_property合计、人数和跨期因素拆解，订单去重/币种/退款未核验，不等于净收入。输入明确period、events和filters；周期需等长不重叠baseline；贡献需group_by且仅分解事件次数。未知不补零，不推断因果。',insightShape,a=>runInsight(api,a));
 register('analysis_session','连续分析条件与追问','save/revise默认预览，confirmed后保存新版本；read回读；run需expected_revision。可保存mapped_definition绑定已发布映射key/revision/query/extra_filters，run实时校验元数据；追问changes继承固定映射版本，不能改映射事件或金额字段。未指定字段继承，数组整体替换；先展示差异。不删除历史、不修改火山对象。',sessionShape,a=>analysisSession(api,a,request.headers.get('oai-authenticated-user-id')),true);
 register('assess_experiment','实验聚合结果检查','对调用者明确提供的两组分配/二元转化人数计算比例、样本失衡和固定终点近似检验。来源未独立核验；小样本、未成熟、未确认随机化或持续偷看时不输出显著性。不是DataTester原生接口。',experimentShape,a=>assessExperiment(a));
 register('manage_workspace','批量配置与历史趋势','本人规则模板搜索和分页导出；preview/apply按完整目标配置逐项版本校验，确认后提交，可部分失败；trend要求规则版本，分页读取原始数值与状态；audit读取配置版本前后差异；result按任务ID和子任务读取可绘图的已保存聚合结果。扩展trend_export/audit_export分页CSV、compare同模板版本同日期比较、retry_preview最新版本差异、diagnostics重试历史、integrity任务结果校验。不删除数据，不修改火山看板。',workspaceShape,a=>manageWorkspace(api,a,request.headers.get('oai-authenticated-user-id')),true);
 register('manage_definitions','配置检查与版本管理','本人规则和模板管理：catalog搜索元数据，values按事件日期读取属性值，validate检查草稿，trial最多3天只读试跑不保存观测；action=workflow的payload={definition,changes?,execute?,preview_hash?}；definition:{dictionary:{key,revision}}可直接使用已绑定表列的SQL指标，不传日期；也可用saved_sql:{report_id,source_version,count,selection:{table_index,columns}}。SQL追问changes:{saved_sql:{count}}保留绑定与保存日期；普通模板definition:{template,start_date,end_date,dictionary?:{key,revision}}提供统一预览和追问（不限3天，遵循对应分析范围）；自由事件支持hour/include_today并固定查询截点。definition可用template_ref:{key,revision}复用公式模板；operation:templates配keyword搜索、read配session_key读查询记录、save配session_key/expected_revision/confirmed/preview_hash保存新版本。trial需预览hash；report config.metric_index从0开始选择单指标，字典可绑定同字段；执行前校验字典和模板版本。history/read/compare读取历史与差异；copy与restore须confirmed和目标expected_revision，恢复增加新版本，不改计划。save保留原有确认与版本校验。',managementSchema.shape,a=>manageDefinitions(api,a,request.headers.get('oai-authenticated-user-id')),true);
 register('read_operations','运行记录与故障排查','读取本人调度触发、任务进度、耗时、错误码、租约中断和每日计划下次名义时间；不会执行任务。服务收到tick不证明平台自动触发，需对照平台运行历史；view=jobs/attempts/dispatches支持cursor分页、status及带时区的from/to时间筛选，overview包含全量任务状态及剩余子任务统计、最近连续调度失败、90分钟停滞提示和需要升级的计划；不把手动调用当自动触发。',operationsShape,a=>readOperations(api,a,request.headers.get('oai-authenticated-user-id')));
 register('dependency_scan_jobs','后台依赖扫描','提交虚拟对象依赖扫描到云端队列，每次调度扫一页并持久化检查点；自动续扫、跨页去重、目录或元数据变化拒绝继续。按job_id回读进度；coverage始终partial，不包含不可见报表。提交不代表执行完成。',dependencyJobShape,a=>dependencyJobs(api,a,request.headers.get('oai-authenticated-user-id')),true);
 register('get_connection_status','连接状态','检查云端配置状态；配置存在不代表真实查询已验收。',{},async()=>({runtime:options.runtime??'cloud',requires_local_computer:options.runtime==='standalone',read_only:options.readOnly??false,metadata_writes:'preview_confirmation_required',change_store_configured:!!env.DB,credentials_configured:!!(env.DATAFINDER_AK&&env.DATAFINDER_SK),project_id:PROJECT,app_ids:wide?[]:[APP],scope_description:wide?'配置的项目 全部应用聚合数据':'配置的应用',report_scope:'all_accessible_project_reports',query_acceptance:'not_checked_by_status_tool',verification_hint:'本工具仅检查配置；请调用 query_report，以该次查询结果为准。'}));
 register('find_assets','查找资源','实时搜索项目内账号可见的看板和报表；事件与属性元数据仅限配置的应用，报表按批准的项目范围读取。',{kind:z.enum(['reports','dashboards','events','params','virtual_events','virtual_params']),keyword:z.string().max(100).default(''),page:z.number().int().min(1).max(100).default(1),dashboard_id:z.string().optional()},async({kind,keyword,page,dashboard_id})=>{
  if(kind==='reports'||kind==='dashboards')return findCatalog(api,kind,keyword,page,dashboard_id);
  if(kind==='virtual_events'||kind==='virtual_params')return readVirtual(api,{kind,keyword,page,page_size:10});
  const result=await api.request('POST',`/openapi/v1/metadata/${APP}/list/${kind}`,{page,page_size:50});
  return api.output({data:normalizeMetadata(result.data,keyword,page),log_id:result.log_id},{scope_description:'元数据仅来自 配置的应用',app_ids:[APP]});
 });
 register('get_dashboard','读取看板','读取项目内任意有权限看板的页面、布局和报表关联。可传id；dashboard_id保留兼容。',{dashboard_id:z.string().default(DASHBOARD),id:z.string().optional()},async({dashboard_id,id})=>readDashboard(api,id??dashboard_id));
 register('get_metric_definition','读取指标口径','解释已保存配置中的事件、分子分母、去重、留存起始/回访事件、筛选和依赖。业务名称不代替真实口径。',{report_id:z.string()},async({report_id})=>{reportId(report_id);const r=await api.report(report_id,{count:1});return api.output({data:r.data.dsls?.length===1?await metricDefinition(r.data,report_id,wide):{report_id,definitions:await Promise.all((r.data.dsls??[]).map(d=>metricDefinition({...r.data,dsls:[d]},report_id,wide)))},log_id:r.log_id},{source_report_id:report_id,definition_status:'saved_configuration_not_business_approved'});});
 register('query_report','查询报表','读取项目内账号有权限的任意报表，无固定报表名单。可同时提供 start_date/end_date（YYYY-MM-DD，北京时间完整自然日，最长31天），临时覆盖日期并保留原生公式；不修改保存配置。省略日期则读取原配置；临时 filters/group_by 需明确日期，走原生分析，filters 与原筛选取交集、group_by 替换原分组。检查 validation/status 后再解释结果；大型多指标报表自动分批查询，data.pagination.metrics.has_more时继续传metric_page；result_limit限制上游分组数（默认100），截断时请用筛选缩小范围或提高该值；按系列或留存队列分页，has_more为true时继续传page。',{report_id:z.string(),...modifiers,metric_page:z.number().int().min(1).max(100).default(1),result_limit:z.number().int().min(1).max(1000).default(100),start_date:z.string().optional(),end_date:z.string().optional(),page:z.number().int().min(1).default(1),page_size:z.number().int().min(1).max(20).default(5)},async args=>queryReportAdaptive(api,args));
 register('query_analysis','按日期重放报表','受控重放已保存的事件/留存 DSL，仅替换日期。日期是北京时间完整自然日，最长 31 天；不接受任意 DSL、SQL、字段或应用。契约未验收时拒绝执行。',{report_id:z.string(),start_date:z.string(),end_date:z.string()},async({report_id,start_date,end_date})=>{
  if(env.DATAFINDER_ENABLE_REPLAY!=='true')throw new QueryError('CAPABILITY_NOT_VERIFIED','日期重放须完成账号契约验收后启用；当前可读保存报表。');
  const saved=await api.report(report_id),plan=replayPlan(extractDSL(saved.data,wide),start_date,end_date,wide);
  const r=await api.request('POST','/openapi/v1/analysis',plan.dsl);
  return api.output({data:{results:normalizeResults(r.data),definition:plan.dsl.content,metrics:plan.dsl.show_option?.eventCompute??[]},log_id:r.log_id},{source_report_id:report_id,resolved_time_range:plan.range,definition_source:'saved_report_dsl',formula_equivalence:'unverified',result_semantics:'原子子查询结果；不冒充已重算的组合指标。按 query_id/item_key 和口径匹配，禁止按数组位置计算。'});
 });
 register('run_analysis','自由分析与临时报表筛选','自由事件可传formulas，A–E绑定events顺序，支持四则运算括号；插件按同日期同分组派生计算，缺失/除零未知，人数比值非漏斗；需第1指标页包含全部事件。公式不修改火山原生指标。不依赖已有报表创建事件/留存分析：事件传events，留存传initial_event/return_event；或仅传report_id沿用原口径。筛选用真实属性名/类型；filters数组外层为AND，可包含{logic:and或or,conditions:[条件]}分组，最多两层组；组内条件不能空。当前项目用户属性通常为user_profile。自由事件支持granularity=hour（最多7天）、start_clock/end_clock（北京时间HH:mm[:ss]，结束时刻包含在内）；今天须include_today=true，省略end_clock查询截至当前并标注暂定数据。留存/保存报表仍限完整历史日期。按日期和属性分组，保留原生公式，只读且不保存报表。必须检查validation与完整性；limit是前N组不是全量，不能累加日UV。',analysisShape,async args=>runAnalysis(api,args));
 register('inspect_property_values','检查属性取值','按事件和日期读取属性值组合，支持上游分页。properties使用真实属性名和类型；不提供标识符/消息内容明细。该工具列出值，不返回频次；频次用run_analysis分组查询。',propertyShape,async args=>inspectPropertyValues(api,args));

 register('check_tracking_health','手动埋点健康检查','查询指定事件次数与区间人数，对比前几周相同星期区间。最多7天、5个事件；返回异常线索而非故障结论，不自动通知。',healthShape,args=>checkTrackingHealth(api,args));
 register('check_property_quality','属性质量统计','按事件次数统计属性null、空字符串，以及明确字符串白名单以外的非空值。可用numeric_bounds检查原始数值属性的含边界范围，required_when限定必填条件与比例分母；白名单与数值规则不可混用。不读取用户明细。',qualityShape,args=>checkPropertyQuality(api,args));
 register('run_funnel','自由有序漏斗','2至8步去重人数有序漏斗；window={value,unit:minute/hour/day}指定滚动窗口，最长7天；兼容window_days，两者不能同时传。分钟/小时/天滚动窗口已完成控制台对照；不支持当天截止。允许后续步骤延伸到结束日期之后，未成熟窗口拒绝执行。仅聚合、不保存报表。',funnelShape,args=>runFunnel(api,args));
 register('list_user_properties','检索用户属性目录','读取用户属性名、类型、展示名与说明，不读取用户值。限配置的应用，返回目录快照的本地分页及完整性边界。',userPropertiesShape,args=>listUserProperties(api,args));
 register('compare_versions','版本回归对比','在相同日期和相同显式渠道/平台等controls下，对比新旧版本的事件次数、区间人数、人均次数，可同时传funnel_steps与quality。版本用原始common_param属性。只做描述性对照，不推断因果；没有controls时未控制流量混杂。',regressionShape,args=>compareVersions(api,args));
 register('run_distribution','数值分布与用户成分','user_cumulative_measure按每用户累计数值属性分桶，需要event、event_param property和非负递增boundaries；不转换单位、不去重订单。user_frequency按每个日或区间内累计事件次数统计用户分布，需要event和正整数boundaries、不传property，分桶与独立UV校验，零次用户不包含。numeric_event_distribution按单次事件属性分桶统计事件次数；必须指定递增边界，空值单列并校验守恒。成分分析按用户属性返回人数，上游日期与分母未独立验证时为incomplete，不能据此下结论。',distributionShape,a=>runDistribution(api,a));
 register('run_advanced_analysis','高级聚合分析','生命周期、LTV、首触/末触/线性归因、事件次数TopK和路径分析。LTV events顺序为收入事件、队列事件，必须提供数值收入属性；生命周期仅1天窗口。归因使用控制台核验的六列指标：触发次数、有效触发次数/率、目标次数、贡献度和相关性；window为回溯天数，不代表当天。路径window为会话间隔分钟，输出已核验列含义的流量边，不能解释为去重人数；上游日期未回读时整体仍为incomplete。失败不得解释为空数据。',advancedShape,a=>runAdvanced(api,a));
 register('read_tags','读取标签目录及基本信息','只读取配置的应用标签目录、类型和计算状态；不读取成员或标签值。上游失败不解释为没有标签。',tagsShape,a=>readTags(api,a));
 register('manage_cohort','读取与管理规则分群','配置的应用规则分群：读取完整定义，预览创建/替换规则/刷新。支持最近1至31天某事件至少N次及事件筛选；不上传或读取成员。必须展示预览并经用户确认才apply；写入未知不自动重试。',cohortShape,a=>manageCohort(api,a,request.headers.get('oai-authenticated-user-id')),true);
 register('list_cohorts','分群目录','读取配置的应用分群名称、计算状态和最近人数，不读取成员。',cohortsShape,a=>listCohorts(api,a));
 register('query_daily_usage','每日用量','查询配置的应用每日DAU和事件用量，不是计费金额或业务口径。',usageShape,a=>queryUsage(api,a));
 const owner=request.headers.get('oai-authenticated-user-id');
 register('export_aggregate_result','导出聚合结果','生成本人登录后可下载的CSV或Excel XML链接；源为持久巡检批次或云端任务，保留质量状态和配置，不补零、不重算；链接生成不证明下载成功。',exportShape,a=>exportLink(a));
 register('inspection_schedules','保存巡检计划与执行云端轮询','本人每日巡检计划，指定上海小时和规则版本，检查前一完整自然日；更新需confirmed和expected_revision。tick由云端调度调用，幂等入队并处理一个任务。preview_backfill检查最多31日，backfill需preview_hash、dates和confirmed，默认mode=missed仅补当时启用且到期的漏跑日期；mode=specified按当前保存口径明确补查选定日期，不声称历史漏跑；绑定规则变化则拒绝。preview_upgrade需keys（最多10个），返回规则新旧差异与各计划preview_hash；upgrade需upgrades:[{key,preview_hash}]及confirmed。逐计划提交，保留启停与时间、不改已入队任务。不外发消息。',scheduleShape,a=>inspectionSchedules(api,a,owner),true);
 register('cloud_query_jobs','云端查询任务','提交最多20个模板、巡检或后台依赖扫描子任务，用request_key去重。list支持cursor/status/from/to；read读取概要；pause/resume/cancel需confirmed，运行中暂停在当前查询结束后生效，取消仅限等待或暂停；read_merged返回至所选恢复任务的合并状态及来源，完整合并用merged_job导出；分块结果用read_result指定task_index与result_page按序读取并校验。retry需confirmed=true与新request_key，仅恢复失败/未执行部分并关联原任务；模板/规则及依赖指纹变化时拒绝继续。单个结果最多2MiB、任务8MiB，导出完整已保存结果。process_next每次领取一个子任务，需云端调度持续调用；保存队列不代表已运行。仅只读DataFinder操作，不提交元数据变更。',jobShape,a=>cloudJobs(api,a,owner),true);
 register('query_templates','保存和执行查询模板','保存或更新本人云端模板需confirmed与expected_revision；日期在执行时显式提供，报表模板绑定来源口径版本，漂移拒绝执行。结果完整性仍以output为准。',templateShape,a=>queryTemplate(api,a,owner),true);
 register('manage_anomaly_record','处理站内异常记录','读取或更新某次巡检观测的人工处理状态（unread未查看、acknowledged已查看、investigating处理中、resolved已处理）、备注及关联巡检任务。更新需expected_revision、confirmed、note、job_id（无关联传null）；已处理需说明。人工已处理不代表数据恢复；保留版本历史，不发送消息。',handlingShape,a=>manageAnomaly(api,a,owner),true);
 register('manage_job_archive','归档与恢复任务列表','预览后用preview_hash及confirmed确认手动归档或恢复；只影响默认任务列表，不删除结果、不改变恢复链或调度去重。未结束任务不能归档。批量可能部分冲突，按results逐项回读。',archiveShape,a=>manageArchive(api,a,owner),true);
 register('read_storage_usage','存储用量与归档预览','读取本人JSON与结果字段的UTF-8字节用量，预览历史任务归档候选及恢复链保留原因；不归档、不删除、不承诺释放空间。',storageShape,a=>storageOverview(api,a,owner));
 register('read_anomaly_records','读取站内异常记录','读取巡检产生的业务异常线索、执行失败和恢复记录；未知/无数据不算恢复，同版本连续异常去重；transitions先对全历史推导再筛选分页，恢复记录关联上一条非未知状态变化；observations读取逐次检查；未知及旧日期补跑不恢复新日期异常，不发送外部通知。',anomalyShape,a=>readAnomalies(api,a,owner));
 register('metric_dictionary','指标字典检索与维护','分析前优先 list 按名称或别名检索，再 read 核对使用建议、默认来源、来源变化及成熟窗口。无匹配明确说明未使用正式指标。source/catalog 读取来源；preview_import 仅预览。save 不传 confirmed 生成预览，展示完整内容经用户确认后带 preview_hash 保存；save_batch 仅保存逐项确认的预览。不删除、不修改上游。SQL来源可用sources[].sql_selection:{table_index,columns}绑定明确表列；read给出统一查询入口。旧记录未绑定列时须先预览保存绑定，不能把整个报表当单指标。SQL按保存日期逻辑，不接收任意日期。来源漂移/未知或暂停使用不得作为已核验指标。',dictionaryShape,a=>metricDictionary(api,a,request.headers.get('oai-authenticated-user-id')),true);
 register('get_dictionary_source','读取词典来源版本','读取报表配置和版本，先解释口径，再请用户确认业务含义；保存时绑定此版本。',{report_id:z.string()},a=>metricSource(api,a.report_id));
 register('save_governance_record','保存指标字典或巡检规则','保存本人云端记录，不修改DataFinder。必须展示完整内容并获得用户确认后传confirmed=true。新建expected_revision=0；更新需最新版本，保存为不可变新版本。指标需来源版本；规则保存不执行、不发通知。',saveRecordShape,a=>saveRecord(api,a,owner),true);
 register('read_governance_records','读取指标字典与巡检规则','读取当前用户记录；指定key和revision可读取历史。指标单条读取会检查来源配置漂移，列表不检查；字典文字是用户业务约定，不是上游事实。',readRecordShape,a=>readRecords(api,a,owner));
 register('run_check_batch','执行保存的巡检规则批次','传1至5条规则key及当前revision、日期。逐条执行，失败不终止其余；预算不足标记未执行，不能视为正常。保存聚合结果供后续读取，无通知。',batchShape,a=>runBatch(api,a,owner),true);
 register('read_check_batch','读取巡检批次结果','读取本人云端保存的聚合检查结果，历史结果不代表当前数据。',{run_id:z.string().uuid()},a=>readBatch(api,a.run_id,owner));
 register('scan_virtual_dependencies','检查虚拟对象引用与传递影响','每页3个可见看板，可用max_pages一次合并最多10页并去重报表。后续页带catalog_version；max_depth控制结构化传递链深度。SQL词法候选排除注释和普通字符串，但不证明语义依赖。未关联或不可见报表仍未覆盖，coverage始终partial，无匹配不代表无影响。',dependencyShape,a=>scanDependencies(api,a));

 register('read_virtual_asset','读取虚拟事件与虚拟属性','读取完整保存规则、SQL表达式、关联与版本。元数据限定配置的应用；查询数据使用run_analysis或inspect_property_values并指定virtual类型。',readVirtualShape,args=>readVirtual(api,args));
 register('preview_virtual_change','预览虚拟对象变更','预览创建或修改虚拟事件/属性并保存15分钟有效的云端草稿；不会修改DataFinder。修改前应调用scan_virtual_dependencies并展示覆盖范围。必须向用户展示差异和影响，获得本次确认后才能apply。修改虚拟事件不支持description描述字段，传入即拒绝，其他字段也不会提交；创建及虚拟属性不受此限制。虚拟事件规则仅支持原始事件OR组合；属性使用受限标量SQL表达式；不支持删除。',changeShape,args=>previewChange(api,args,owner),true);
 register('apply_virtual_change','确认提交虚拟对象变更','仅在用户确认本次预览后调用；传preview返回的change_id和confirmation。仅提交一次，超时状态unknown时先读取对象核对，不自动重试。',{change_id:z.string().uuid(),confirmation:z.string().min(1).max(128)},args=>applyChange(api,args,owner),true);
 register('get_virtual_change','读取虚拟对象变更记录','读取当前用户的云端预览、执行状态与回读结果；unknown/applying不是成功，不得自动重发。',{change_id:z.string().uuid()},async({change_id})=>{const r=await getChange(api,change_id,owner);return {change_id:r.id,state:r.state,expires_at:new Date(r.expires_at).toISOString(),plan:JSON.parse(r.plan),result:r.result?JSON.parse(r.result):null};});
 register('saved_sql','读取与执行已保存SQL','仅支持项目可见看板关联的已保存SQL报表。先action=read读取定义和版本，再经用户查询请求action=execute并传expected_version。可用selection按明确table_index和columns选择返回列；先action=preview获取preview_hash，再execute原样回传；行数、列名或来源改变须重新预览。支持已保存的完整事件日期参数，动态日期须固定预览；不接受临时参数覆盖。按保存配置读取原生结果，不接收任意SQL，不改写日期，不保证绕过缓存。',savedSqlShape,args=>savedSql(api,args));
 return server;
}
export async function mcpResponse(request,env,fetcher=fetch) {
 let payload; try{const text=await request.text();if(text.length>32000)return new Response('Request too large',{status:413});payload=JSON.parse(text);}catch{return new Response('Invalid JSON',{status:400});}
 if(!payload || Array.isArray(payload))return new Response('Invalid request',{status:400});
 const legacy=await isLegacyRequest(request,payload);
 const discovery=['server/discover','initialize','notifications/initialized','tools/list','ping'].includes(payload.method);
 if(!discovery&&!allowed(request,env))return Response.json({error:'Authentication required'},{status:401,headers:{'Cache-Control':'no-store'}});
 const server=createDataFinderServer(request,env,fetcher);
 if(!legacy){const handler=createMcpHandler(()=>server,{legacy:'reject',responseMode:'json'});const response=await handler.fetch(request,{parsedBody:payload});response.headers.set('Cache-Control','no-store');return response;}
 const transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
 await server.connect(transport);
 const response=await transport.handleRequest(request,{parsedBody:payload});
 response.headers.set('Cache-Control','no-store');return response;
}
