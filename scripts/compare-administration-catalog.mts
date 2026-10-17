import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const raw=await readFile('supabase/configuration/verification_0015.json','utf8'),actual=JSON.parse(raw.replace(/^\uFEFF/,'')),expected=JSON.parse(await readFile('test-results/administration-0015-local-catalog.json','utf8'));
const sql=await readFile('supabase/migrations/202610100015_administration_controls.sql','utf8'),sha=createHash('sha256').update(sql).digest('hex');assert.equal(sha,JSON.parse(await readFile('test-results/administration-0015-local.json','utf8')).sqlSha256);
const notNull=expected.constraints.filter((c:{definition:string})=>c.definition.startsWith('NOT NULL')).length;
if(!actual.constraints.some((c:{definition:string})=>c.definition.startsWith('NOT NULL')))expected.constraints=expected.constraints.filter((c:{definition:string})=>!c.definition.startsWith('NOT NULL'));
function canonical(v:unknown):string{if(typeof v==='string')return JSON.stringify(v.replace(/\r\n/g,'\n').trim());if(Array.isArray(v))return '['+v.map(canonical).sort().join(',')+']';if(v&&typeof v==='object')return '{'+Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>JSON.stringify(k)+':'+canonical(x)).join(',')+'}';return JSON.stringify(v);}
assert.deepEqual(Object.keys(actual).sort(),Object.keys(expected).sort());for(const k of Object.keys(expected))assert.equal(canonical(actual[k]),canonical(expected[k]),'Catalog mismatch: '+k);
const report={verdict:'PASS',testedAt:new Date().toISOString(),sqlSha256:sha,sourceSha256:createHash('sha256').update(raw).digest('hex'),notNullColumnsToConfirmThroughHostedMetadata:notNull};await writeFile('test-results/administration-0015-catalog-comparison.json',JSON.stringify(report,null,2));console.log(report);
