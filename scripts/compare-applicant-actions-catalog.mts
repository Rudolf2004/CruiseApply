import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const source='supabase/configuration/verification_0013.json';
const raw=await readFile(source,'utf8');
const actual=JSON.parse(raw.replace(/^\uFEFF/,''));
const expected=JSON.parse(await readFile('test-results/applicant-actions-0013-local-catalog.json','utf8'));
const migration=await readFile('supabase/migrations/202610040013_applicant_responses_withdrawal.sql','utf8');
const sha=createHash('sha256').update(migration).digest('hex');
assert.equal(sha,JSON.parse(await readFile('test-results/applicant-actions-0013-local.json','utf8')).sqlSha256);
// PostgreSQL 18 catalogs NOT NULL as pg_constraint rows; older hosted versions
// expose them through pg_attribute instead. Compare only that representational
// difference here; owner/PIN nullability remains compared independently.
const localNotNull=expected.constraints.filter((c:{definition:string})=>c.definition.startsWith('NOT NULL'));
assert.equal(localNotNull.length,220);
assert.equal(actual.constraints.some((c:{definition:string})=>c.definition.startsWith('NOT NULL')),false);
expected.constraints=expected.constraints.filter((c:{definition:string})=>!c.definition.startsWith('NOT NULL'));
function canonical(value:unknown):string {
  if(typeof value==='string')return JSON.stringify(value.replace(/\r\n/g,'\n').trim());
  if(Array.isArray(value))return '['+value.map(canonical).sort().join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';
  return JSON.stringify(value);
}
assert.deepEqual(Object.keys(actual).sort(),Object.keys(expected).sort());
for(const key of Object.keys(expected))assert.equal(canonical(actual[key]),canonical(expected[key]),'Catalog mismatch: '+key);
assert.equal(actual.functions.length,5);assert.equal(actual.owner_columns.length,14);assert.equal(actual.private_tables.length,9);
const report={verdict:'PASS',testedAt:new Date().toISOString(),source,sourceSha256:createHash('sha256').update(raw).digest('hex'),migrationSha256:sha,functions:5,ownerColumns:14,privateTables:9,notificationTrigger:true,notNullRepresentation:'220 PG18-only NOT NULL catalog entries excluded; changed owner/PIN nullability independently matches hosted columns',comparison:'Complete JSON including full function definitions, owner, security config, all reported permissions, RLS and owner columns; order/CRLF normalization and the documented PostgreSQL NOT NULL catalog representation difference'};
await writeFile('test-results/applicant-actions-0013-catalog-comparison.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
