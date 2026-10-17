import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const path='supabase/configuration/verification_0009.json';
const raw=await readFile(path,'utf8');
const actual=JSON.parse(raw.replace(/^\uFEFF/,''));
const expected=JSON.parse(await readFile('test-results/voucher-auth-0009-local-catalog.json','utf8'));
const migration=await readFile('supabase/migrations/202610020009_voucher_session_operations.sql','utf8');
const migrationSha256=createHash('sha256').update(migration).digest('hex');
const localReport=JSON.parse(await readFile('test-results/voucher-auth-0009-local.json','utf8'));
assert.equal(migrationSha256,localReport.sqlSha256,'Local catalog must correspond to the current exact migration SQL');
function canonical(value: unknown): string {
  if(typeof value==='string')return JSON.stringify(value.replace(/\r\n/g,'\n').trim());
  if(Array.isArray(value))return '['+value.map(canonical).sort().join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';
  return JSON.stringify(value);
}
assert.deepEqual(Object.keys(actual).sort(),Object.keys(expected).sort());
assert.equal(actual.functions.length,4);
assert.equal(canonical(actual.functions),canonical(expected.functions),'Function definition/configuration/owner/ACL mismatch');
assert.equal(canonical(actual.private_tables),canonical(expected.private_tables),'Private table RLS/permission mismatch');
const result={verdict:'PASS',reviewedAt:new Date().toISOString(),source:path,sourceSha256:createHash('sha256').update(raw).digest('hex'),migrationSha256,engine:actual.engine,functions:4,privateTables:actual.private_tables.length,comparison:'Complete definitions, signatures, security definer, search_path, owner, ACLs and role privileges; ordering/CRLF normalization only'};
await writeFile('test-results/voucher-session-0009-catalog-comparison.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
