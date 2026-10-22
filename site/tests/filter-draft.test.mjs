import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFilterDraft,filterValueDraft} from '../lib/datafinder/filter-draft.mjs';
test('filter draft preserves nested conditions, numeric/text identities and extra fields',()=>{
 const value=[{logic:'or',conditions:[{property:{property_name:'id',property_type:'event_param'},operator:'in',values:['001',0],extra:'keep'}]}];
 assert.deepEqual(readFilterDraft(JSON.stringify(value)),{valid:true,value});
});
test('malformed or non-list drafts never turn into empty filters',()=>{
 for(const text of ['{','null','{}','[null]','[1]','[{}]','[{"logic":"xor","conditions":[]}]'])assert.deepEqual(readFilterDraft(text),{valid:false});
 assert.deepEqual(readFilterDraft('[]'),{valid:true,value:[]});
});

test('numeric editing preserves blanks, invalid text and explicit zero separately',()=>{
 for(const v of ['', '  ', 'abc', 'Infinity'])assert.equal(filterValueDraft(v,true),v);
 assert.equal(filterValueDraft('0',true),0);assert.equal(filterValueDraft('-2.5',true),-2.5);
 assert.equal(filterValueDraft('001',false),'001');
});
