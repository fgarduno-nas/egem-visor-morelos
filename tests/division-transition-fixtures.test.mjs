import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import {seedTransitionFixtures} from './support/division-transition-fixtures.mjs';
const base='3a9f6d1df13907bb96f33d03328691b2a9bcf973';
test('transition fixtures use actual previous Prisma Layer fields, including private and deleted records',async()=>{
 const schema=execFileSync('git',['show',`${base}:backend/prisma/schema.prisma`],{encoding:'utf8'});
 const fields=new Set([...schema.match(/model Layer \{([\s\S]*?)\n\}/)[1].matchAll(/^\s+(\w+)\s+/gm)].map(m=>m[1]));
 const rows=[];await seedTransitionFixtures({role:{create:async()=>{}},user:{create:async()=>{}},layer:{create:async({data})=>rows.push(data)}},'synthetic','fixture.geojson');
 assert.equal(rows.length,10);for(const row of rows)for(const key of Object.keys(row))assert.ok(fields.has(key),key);
 assert.equal(rows.filter(r=>r.isDeleted).length,1);assert.equal(rows.filter(r=>r.status==='draft').length,1);assert.equal(fields.has('isPublic'),false);
});
test('historical migration is identical to the real base; publication contract is explicit',async()=>{
 const path='backend/prisma/migrations/202605040001_init/migration.sql';
 assert.equal((await fs.readFile(path,'utf8')).replaceAll('\r\n','\n'),execFileSync('git',['show',`${base}:${path}`],{encoding:'utf8'}).replaceAll('\r\n','\n'));
 const policy=await fs.readFile('backend/src/modules/layers/layer-public-policy.js','utf8');
 assert.match(policy,/LAYER_STATUS.PUBLISHED/);assert.match(policy,/isDeleted !== false/);assert.match(policy,/isVisualizable/);assert.match(policy,/processed/);
});
