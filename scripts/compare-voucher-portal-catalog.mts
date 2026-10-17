import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const source='supabase/configuration/verification_0010.json';
const raw=await readFile(source,'utf8');
const actual=JSON.parse(raw.replace(/^\uFEFF/,''));
const expected=JSON.parse(await readFile('test-results/voucher-portal-0010-local-catalog.json','utf8'));
const migration=await readFile('supabase/migrations/202610030010_voucher_scoped_portal.sql','utf8');
const sha=createHash('sha256').update(migration).digest('hex');
assert.equal(sha,JSON.parse(await readFile('test-results/voucher-portal-0010-local.json','utf8')).sqlSha256);
function canonical(value:unknown):string {
  if(typeof value==='string')return JSON.stringify(value.replace(/\r\n/g,'\n').trim());
  if(Array.isArray(value))return '['+value.map(canonical).sort().join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';
  return JSON.stringify(value);
}
assert.deepEqual(Object.keys(actual).sort(),Object.keys(expected).sort());
for(const key of Object.keys(expected))assert.equal(canonical(actual[key]),canonical(expected[key]),'Catalog mismatch: '+key);
assert.equal(actual.functions.length,12);assert.equal(actual.owner_columns.length,14);assert.equal(actual.private_tables.length,8);
const report={verdict:'PASS',testedAt:new Date().toISOString(),source,sourceSha256:createHash('sha256').update(raw).digest('hex'),migrationSha256:sha,functions:12,ownerColumns:14,privateTables:8,notificationTrigger:true,comparison:'Complete JSON including full function definitions, owner, security config, all reported permissions, RLS and owner columns; only order/CRLF normalization'};
await writeFile('test-results/voucher-portal-0010-catalog-comparison.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
