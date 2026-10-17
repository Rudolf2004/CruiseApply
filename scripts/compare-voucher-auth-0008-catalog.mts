import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const path = 'supabase/configuration/verification_0008.json';
const raw = await readFile(path, 'utf8');
const hosted = JSON.parse(raw.replace(/^\uFEFF/, ''));
const local = JSON.parse(await readFile('test-results/voucher-auth-0008-local-catalog.json', 'utf8'));
// Sort object keys and arrays; normalize CRLF line endings and outer whitespace only.
function canonical(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value.replace(/\r\n/g, '\n').trim());
  if (Array.isArray(value)) return '[' + value.map(canonical).sort().join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => JSON.stringify(k)+':'+canonical(v)).join(',') + '}';
  return JSON.stringify(value);
}
const counts: Record<string, number> = {};
for (const section of ['guards','columns','indexes','policies','triggers','constraints','private_tables']) {
  // PG18 catalogs NOT NULL as separate constraints; PG17 exposes it in columns.
  const expected = section === 'constraints' ? local[section].filter((r: {type: string}) => r.type !== 'n') : local[section];
  assert.equal(canonical(hosted[section]), canonical(expected), section + ' mismatch');
  counts[section] = hosted[section].length;
}
assert.equal(canonical(hosted.new_table_counts), canonical(local.new_table_counts));
const permittedLegacyAclDifferences: Record<string, string[]> = {
  handle_new_user: ['anon_execute','authenticated_execute','service_execute'],
  audit_change: ['anon_execute','authenticated_execute','service_execute'],
  is_admin: ['service_execute'],
  protect_payment_snapshot: ['service_execute'],
  protect_payment_quote: ['service_execute'],
  guard_managed_application: ['service_execute'],
};
const aclDifferences: {function: string; field: string; hosted: boolean; local: boolean}[] = [];
assert.equal(hosted.existing_functions.length, local.existing_functions.length);
for (const actual of hosted.existing_functions) {
  const expected = local.existing_functions.find((r: {name: string}) => r.name === actual.name);
  assert.ok(expected, actual.name);
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort());
  for (const field of Object.keys(actual)) {
    if (canonical(actual[field]) === canonical(expected[field])) continue;
    assert.ok(permittedLegacyAclDifferences[actual.name]?.includes(field), actual.name + '.' + field);
    assert.equal(actual[field], true); assert.equal(expected[field], false);
    aclDifferences.push({function: actual.name, field, hosted: true, local: false});
  }
}
const result = { verdict: 'PASS for 0008 hosted catalog, with documented legacy ACL differences',
  reviewedAt: new Date().toISOString(), source: path, sourceSha256: createHash('sha256').update(raw).digest('hex'),
  engine: hosted.engine, counts, existingFunctions: hosted.existing_functions.length, aclDifferences,
  limits: 'Export review, not a new live query. No pre-0008 hosted ACL snapshot; differences cannot be dated from this export. No interactive login re-test.' };
await writeFile('test-results/voucher-auth-0008-catalog-comparison.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
