// Match the accepted template schemas; fixed-bin/funnel results have no row-limit control.
export function followupLimit(definition){
 const template=definition.template,config=template?.config??{};
 if(definition.saved_sql)return {key:'count',maximum:1000,value:definition.saved_sql.count??100};
 if(template?.kind==='report')return {key:'result_limit',maximum:1000,value:config.result_limit??100};
 if(template?.kind==='analysis')return {key:'limit',maximum:1000,value:config.limit??100};
 if(template?.kind==='advanced')return {key:'limit',maximum:50,value:config.limit??20};
 if(template?.kind==='distribution'&&config.kind==='composition')return {key:'limit',maximum:200,value:config.limit??50};
 return null;
}
export function followupCountChange(definition,raw){
 const control=followupLimit(definition),n=typeof raw==='string'&&raw.trim()===''?NaN:Number(raw);
 if(!control)throw Error('此分析不支持调整返回条数。');
 if(!Number.isSafeInteger(n)||n<1||n>control.maximum)throw Error(`返回条数须为1至${control.maximum}的整数。`);
 return definition.saved_sql?{saved_sql:{count:n}}:{config:{[control.key]:n}};
}
