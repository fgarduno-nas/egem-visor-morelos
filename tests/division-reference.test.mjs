import test from 'node:test';
import assert from 'node:assert/strict';
import {isIndependentReference,latestThematicId} from '../js/app/utils/thematic-selection.js';
import fs from 'node:fs/promises';
test('reference layers cannot replace the exclusive thematic selection',()=>{
 const layers=[{id:'hazard',category:'geologicos',visible:true},{id:'limits',category:'limites',visible:true},{id:'cartography',category:'otras',visible:true}];
 assert.equal(latestThematicId(layers,['hazard','limits','cartography']),'hazard');assert.equal(isIndependentReference(layers[0]),false);assert.ok(isIndependentReference(layers[1]));assert.ok(isIndependentReference(layers[2]));
});
test('single final migration embeds the shared contract and preserves external data',async()=>{
 const {divisionSqlContract}=await import('../shared/division-sql-contract.js');
 const sql=await fs.readFile('backend/prisma/migrations/202609300001_layer_division/migration.sql','utf8');
 assert.ok(sql.replaceAll("\r\n","\n").includes(divisionSqlContract()));assert.match(sql,/ADD COLUMN "division" TEXT/);
 assert.match(sql,/CREATE INDEX/);assert.doesNotMatch(sql,/DELETE FROM|DROP TABLE|SET "updatedAt"|UPDATE "LayerMetadata"/);
});
test('final migration has explicit preflight and deferred section constraints',async()=>{
 const sql=await fs.readFile('backend/prisma/migrations/202609300001_layer_division/migration.sql','utf8');
 assert.match(sql,/^BEGIN;/);assert.match(sql,/COMMIT;/);assert.match(sql,/LOCK TABLE "Layer", "LayerMetadata"/);
 assert.match(sql,/SET division = 'hazard'/);assert.equal((sql.match(/CREATE CONSTRAINT TRIGGER/g)||[]).length,2);
});
