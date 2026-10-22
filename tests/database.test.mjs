import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
const check = String.raw`
import {pool} from './dist/infrastructure/database/db.js';
import {checkPassword} from './dist/shared/auth/passwords.js';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const manifest=JSON.parse(readFileSync('/app/data/manifest.json','utf8'));
const mismatches=[];
const fidelity=JSON.parse(readFileSync('/app/data/fidelity.json','utf8'));
const relationships=JSON.parse(readFileSync('/app/data/relationships.json','utf8'));
for(const [table,proof] of [...Object.entries(fidelity),...Object.entries(relationships)]){
 const columns=proof.fields.map(c=>'"'+c+'"::text AS "'+c+'"').join(',');
 const rows=(await pool.query('SELECT '+columns+' FROM '+table)).rows;
 const hashes=rows.map(r=>createHash('sha256').update(JSON.stringify(proof.fields.map(c=>r[c]))).digest('hex')).sort();
 const digest=createHash('sha256').update(hashes.join('')).digest('hex');
 if(rows.length!==proof.rows||digest!==proof.sha256)mismatches.push(table+':source-business-values');
}
for(const [table,count] of Object.entries(manifest.table_counts)){
 if(!/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/.test(table))throw Error('Invalid table name');
 const result=await pool.query('SELECT count(*)::int AS n FROM '+table);
 if(result.rows[0].n!==count)mismatches.push(table);
 const [schema,name]=table.split('.');
 const cols=await pool.query('SELECT a.attname,format_type(a.atttypid,a.atttypmod) AS typ,a.attnotnull FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname=$2 AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum',[schema,name]);
 const expected=manifest.original_column_definitions[table];
 if(cols.rows.length!==Object.keys(expected).length)mismatches.push(table+':columns');
 for(const col of cols.rows){
  const original=expected[col.attname];
  const typ=original?.split(/ DEFAULT | NOT NULL/)[0].trim();
  if(typ!==col.typ||col.attnotnull!==original.includes('NOT NULL'))mismatches.push(table+':'+col.attname);
 }
}
const roles=(await pool.query('SELECT role,count(*)::int AS n FROM onboarding.accounts GROUP BY role')).rows;
const owners=(await pool.query("SELECT a.id FROM onboarding.accounts a JOIN onboarding.agencies g ON g.id=a.agency_id AND g.owner_account_id=a.id WHERE a.role='agency_owner' AND g.status='active'")).rowCount;
const users=(await pool.query('SELECT password_hash FROM onboarding.accounts UNION ALL SELECT password_hash FROM support.support_operators UNION ALL SELECT password_hash FROM teamops.users')).rows;
let valid=0;for(const hash of new Set(users.map(r=>r.password_hash)))if(await checkPassword('123456',hash))valid+=users.filter(r=>r.password_hash===hash).length;
console.log(JSON.stringify({mismatches,roles,owners,users:users.length,passwordsValid:valid}));
await pool.end();
`;
test("original schemas, all business rows, owner relationships and local passwords survive restoration", () => {
  const result = JSON.parse(
    execFileSync(
      "docker",
      ["compose", "exec", "-T", "backend", "node", "--input-type=module"],
      { input: check, encoding: "utf8" },
    ),
  );
  assert.deepEqual(result.mismatches, []);
  assert.equal(result.roles.find((r) => r.role === "agency_owner").n, 4);
  assert.equal(result.owners, 4);
  assert.equal(result.users, 118);
  assert.equal(result.passwordsValid, result.users);
});
