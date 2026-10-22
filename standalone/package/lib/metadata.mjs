import {z} from 'zod/v4';
import {APP,QueryError} from './core.mjs';
import {propertySchema} from './analysis.mjs';
export const userPropertiesShape={keyword:z.string().max(100).default(''),page:z.number().int().min(1).max(1000).default(1),page_size:z.number().int().min(1).max(100).default(25),value_type:z.enum(['string','int','float','datetime','list','version']).optional()};
export async function listUserProperties(api,input){
 const a=z.object(userPropertiesShape).strict().parse(input),r=await api.request('POST',`/openapi/v1/metadata/${APP}/list/user_profiles`,{});
 if(!Array.isArray(r.data)||r.data.some(x=>typeof x?.name!=='string'))throw new QueryError('UNVERIFIED_CONTRACT','用户属性目录结构无法验证。');
 const safe=r.data.filter(x=>propertySchema.safeParse({property_name:x.name,property_type:'user_profile'}).success);
 const items=safe.filter(x=>(!a.value_type||x.value_type===a.value_type)&&`${x.name} ${x.show_name??''} ${x.description??''}`.toLowerCase().includes(a.keyword.toLowerCase())).sort((a,b)=>a.name.localeCompare(b.name,'en'));
 return api.output({data:{items:items.slice((a.page-1)*a.page_size,a.page*a.page_size).map(x=>({name:x.name,show_name:x.show_name??null,description:x.description??null,value_type:x.value_type??null,status:x.status??null,property_type:'user_profile',property_compose_type:'origin'})),matched_count:items.length,received_count:r.data.length,restricted_count:r.data.length-safe.length,pagination:{page:a.page,page_size:a.page_size,has_more:a.page*a.page_size<items.length},source_complete:'unknown'},log_id:r.log_id},{status:'success',app_ids:[APP],scope_description:'仅 配置应用 的用户属性元数据，不返回用户属性值',warnings:['分页基于本次上游返回的目录快照；不能证明平台所有属性均已返回。','目录类型不等于业务规则，敏感标识符不开放用于聚合分组。']});
}
export async function numericProperty(api,property){
 const p=propertySchema.parse(property);
 if(p.property_compose_type==='virtual')throw new QueryError('UNSUPPORTED_NUMERIC_PROPERTY','数值范围首版仅支持已登记的原始数值属性。');
 if(['user_is_new','$is_first_day'].includes(p.property_name))throw new QueryError('UNSUPPORTED_NUMERIC_PROPERTY','新老用户等特殊语义字段不按普通数值范围计算。');
 const user=['profile','user_profile'].includes(p.property_type),kind=user?'user_profiles':'params';
 const r=await api.request('POST',`/openapi/v1/metadata/${APP}/list/${kind}`,{filter:{name:p.property_name}});
 const matches=Array.isArray(r.data)?r.data.filter(x=>x.name===p.property_name):[];
 if(matches.length!==1||!['int','float'].includes(matches[0].value_type)||(!user&&matches[0].type!==(p.property_type==='common_param'?2:1)))throw new QueryError('PROPERTY_TYPE_MISMATCH','没有找到唯一且类型匹配的 int/float 属性，拒绝数值范围比较。');
 return {name:p.property_name,value_type:matches[0].value_type,metadata_app_id:APP};
}
