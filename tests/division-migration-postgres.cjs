const {execFileSync}=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const host=process.env.PGHOST,port=process.env.PGPORT,user=process.env.PGUSER,out=process.env.DIVISION_REVIEW_DIR;
assert.ok(['127.0.0.1','localhost'].includes(host)&&port&&user&&out,'Use explicit loopback PostgreSQL and an external evidence directory');
const db='egem_division_transition_'+Date.now();fs.mkdirSync(out,{recursive:true});
const args=['-h',host,'-p',port,'-U',user,'-v','ON_ERROR_STOP=1','-X','-t','-A'];
const sql=(query, database=db)=>execFileSync('psql',[...args,'-d',database,'-c',query],{encoding:'utf8'}).trim();
const file=p=>execFileSync('psql',[...args,'-d',db,'-f',path.resolve(p)],{encoding:'utf8'});
execFileSync('createdb',['-h',host,'-p',port,'-U',user,db]);
try {
file('backend/prisma/migrations/202605040001_init/migration.sql');

const categories=['geologicos','hidrometeorologicos','quimicos-tecnologicos','sanitario-ecologico','socio-organizativo','astronomicos','limites','otras'];
sql(`INSERT INTO "Role" (id,code,name,"updatedAt") VALUES ('role','ADMIN','Fixture',now()); INSERT INTO "User" (id,name,email,"passwordHash","roleId","updatedAt") VALUES ('owner','Fixture','fixture@example.test','test-only','role',now());`);
for(const [i,category]of categories.entries())sql(`INSERT INTO "Layer" (id,title,slug,"createdById","updatedAt") VALUES ('l${i}','Riesgo vulnerabilidad susceptibilidad referencia ${i}','layer-${i}','owner','2020-01-01'); INSERT INTO "LayerMetadata" (id,"layerId",properties,"updatedAt") VALUES ('m${i}','l${i}','{"tags":["category:${category}"],"vectorLegend":{"classes":[{"label":"Clase intacta","color":"#123456"}]}}','2020-01-01'); INSERT INTO "LayerFile" (id,"layerId","originalName","storedName","storagePath","mimeType",extension,"sizeBytes","uploadedById") VALUES ('f${i}','l${i}','original.geojson','stored','uploads/unchanged-${i}','application/json','geojson',9,'owner');`);
const authorized=['cmqs7uli10003l3dgilbk7jhm','cmqs8d6mt0003l3p1nzmrq8cg','cmqsf108j0003l3tkmx3k7ch4'];
for(const [i,id] of authorized.entries())sql(`INSERT INTO "Layer" (id,title,slug,"createdById","isDeleted","updatedAt") VALUES ('${id}','Changed title ${i}','legacy-${i}','owner',true,'2020-01-01'); INSERT INTO "LayerMetadata" (id,"layerId",properties,"updatedAt") VALUES ('legacy-m${i}','${id}','{"tags":["nota:sin-fenomeno"],"vectorLegend":{"classes":[{"label":"Intacta","color":"#654321"}]}}','2020-01-01'); INSERT INTO "LayerFile" (id,"layerId","originalName","storedName","storagePath","mimeType",extension,"sizeBytes","uploadedById") VALUES ('legacy-f${i}','${id}','original.geojson','stored','uploads/legacy-${i}','application/json','geojson',9,'owner');`);

const snapshot=()=>JSON.parse(sql(`SELECT jsonb_build_object('layers',(SELECT jsonb_agg(to_jsonb(l)-'division' ORDER BY id) FROM "Layer" l),'metadata',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM "LayerMetadata" m),'files',(SELECT jsonb_agg(to_jsonb(f) ORDER BY id) FROM "LayerFile" f),'users',(SELECT jsonb_agg(to_jsonb(u) ORDER BY id) FROM "User" u),'roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM "Role" r));`));
const before=snapshot();
// Failed preflight must roll back all changes, including helper creation.
const migration='backend/prisma/migrations/202609300001_layer_division/migration.sql';
for (const [name,properties] of [['conflict',{tags:['category:geologicos','category:limites']}],['unknown',{tags:['category:inventada']}],['missing',{}]]) {
  sql(`UPDATE "LayerMetadata" SET properties='${JSON.stringify(properties)}' WHERE id='m0';`);
  const invalidBefore=snapshot();let rejected=false;
  try{file(migration)}catch(e){rejected=true;fs.writeFileSync(path.join(out,`migration-${name}.log`),String(e.stderr));}
  assert.ok(rejected);assert.deepEqual(snapshot(),invalidBefore);assert.equal(sql(`SELECT to_regprocedure('egem_layer_category(jsonb)') IS NULL;`),'t');
}
sql(`UPDATE "LayerMetadata" SET properties='${JSON.stringify(before.metadata.find(m=>m.id==='m0').properties)}' WHERE id='m0';`);
for(const [name,setup,restore] of [
  ['authorized-active',`UPDATE "Layer" SET "isDeleted"=false WHERE id='${authorized[0]}'`,`UPDATE "Layer" SET "isDeleted"=true WHERE id='${authorized[0]}'`],
  ['authorized-contradictory',`UPDATE "LayerMetadata" SET properties='{"tags":["category:geologicos"]}' WHERE id='legacy-m1'`,`UPDATE "LayerMetadata" SET properties='${JSON.stringify(before.metadata.find(m=>m.id==='legacy-m1').properties)}' WHERE id='legacy-m1'`],
  ['fourth-similar-title',`INSERT INTO "Layer" (id,title,slug,"createdById","isDeleted","updatedAt") VALUES ('fourth','VF 01 Vulnerabilidad Fisica VPS','fourth','owner',true,'2020-01-01'); INSERT INTO "LayerMetadata" (id,"layerId",properties,"updatedAt") VALUES ('fourth-meta','fourth','{}','2020-01-01')`,`DELETE FROM "Layer" WHERE id='fourth'`],
]) {
  sql(setup);const invalidBefore=snapshot();let rejected=false;
  try{file(migration)}catch(e){rejected=true;fs.writeFileSync(path.join(out,`migration-${name}.log`),String(e.stderr));}
  assert.ok(rejected,name);assert.deepEqual(snapshot(),invalidBefore);assert.equal(sql(`SELECT to_regprocedure('egem_layer_category(jsonb)') IS NULL;`),'t');sql(restore);
}
assert.deepEqual(snapshot(),before);
file(migration);assert.deepEqual(snapshot(),before);
const values=JSON.parse(sql(`SELECT jsonb_agg(jsonb_build_object('id',id,'division',division) ORDER BY id) FROM "Layer";`));
assert.equal(values.length,11);assert.deepEqual(values.filter(v=>authorized.includes(v.id)).map(v=>v.division),['vulnerability','vulnerability','vulnerability']);
assert.deepEqual(values.filter(v=>/^l\d$/.test(v.id)).map(v=>v.division),['hazard','hazard','hazard','hazard','hazard','hazard',null,null]);
assert.equal(sql(`SELECT count(*) FROM "Layer" WHERE id IN ('${authorized.join("','")}') AND "isDeleted"=true AND division='vulnerability';`),'3');
for(const q of [`UPDATE "Layer" SET division=NULL WHERE id='l0'`,`UPDATE "Layer" SET division='hazard' WHERE id='l6'`,`UPDATE "LayerMetadata" SET properties='{"tags":["category:limites"]}' WHERE id='m0'`])assert.throws(()=>sql(q));
assert.deepEqual(snapshot(),before);
const contract=JSON.parse(sql(`SELECT egem_classification_contract();`));
let matrixChecks=0;
for(const division of Object.keys(contract.rules))for(const category of [...categories.slice(0,6),null,'inventada','limites']) {
 const canonical=category&&contract.aliases[category];
 const valid=division==='vulnerability'?category===null:contract.rules[division].includes(canonical);
 const properties=JSON.stringify({tags:category?['category:'+category]:[]});
 const query=`BEGIN; INSERT INTO "Layer" (id,title,slug,"createdById","updatedAt",division) VALUES ('matrix','Matrix','matrix','owner',now(),'${division}'); INSERT INTO "LayerMetadata" (id,"layerId",properties,"updatedAt") VALUES ('matrix-meta','matrix','${properties}',now()); SET CONSTRAINTS ALL IMMEDIATE; ROLLBACK;`;
 if(valid)sql(query);else assert.throws(()=>sql(query));matrixChecks++;
}
// Prisma creates a layer and its classification inside one transaction.
sql(`BEGIN; INSERT INTO "Layer" (id,title,slug,"createdById","updatedAt",division) VALUES ('new','New valid','new','owner',now(),'risk'); INSERT INTO "LayerMetadata" (id,"layerId",properties,"updatedAt") VALUES ('new-meta','new','{"tags":["category:geologicos"]}',now()); COMMIT;`);
assert.equal(sql(`SELECT division FROM "Layer" WHERE id='new';`),'risk');
const record={database:db,before:before.layers.length,afterMigration:values.length,rows:values,authorizedLegacyOverrides:3,authorizedActiveRollback:true,authorizedContradictoryRollback:true,fourthSimilarTitleRollback:true,allNonDivisionFieldsUnchanged:true,conflictingCategoryRollback:true,unknownCategoryRollback:true,missingCategoryRollback:true,conditionalConstraints:true,matrixChecks,nestedWriteCommitted:true};
fs.writeFileSync(path.join(out,'migration-postgres.json'),JSON.stringify(record,null,2));console.log(JSON.stringify(record));

} finally {execFileSync('dropdb',['-h',host,'-p',port,'-U',user,db]);}
