import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const {strictUtf8,runUtf8Sql,runUtf8File}=createRequire(import.meta.url)('./support/utf8-psql.cjs');
const labels=['Geológicos','Hidrometeorológicos','Químico-tecnológicos','Sanitario-ecológicos','Socio-organizativos','Astronómicos','Vulnerabilidad'];
test('SQL transport rejects invalid UTF-8 and replacement characters',()=>{
 assert.throws(()=>strictUtf8(Buffer.from([0xe1,0xe9,0xed])));
 assert.throws(()=>strictUtf8(Buffer.from('x�')));
});
test('SQL file preserves institutional accents; uses no shell or SQL command argument',()=>{
 let file;const records=[];
 const value=runUtf8Sql(['-d','fixture'],'SELECT '+labels.map(s=>`\'${s}\'`).join(',')+';',{
  record:r=>records.push(r),execute:(command,args,options)=>{
   assert.equal(command,'psql');assert.equal(options.shell,false);assert.equal(options.env.PGCLIENTENCODING,'UTF8');
   assert.equal(args.includes('-c'),false);file=args[args.indexOf('-f')+1];
   const sql=strictUtf8(fs.readFileSync(file));for(const label of labels)assert.ok(sql.includes(label));
   assert.ok(sql.startsWith("\\encoding UTF8\nSET client_encoding = 'UTF8';"));return 'ok\n';
  }});
 assert.equal(value,'ok');assert.equal(fs.existsSync(file),false);assert.equal(records[0].exitCode,0);assert.equal(records[0].sha256.length,64);
});
test('SQL temporary file is removed even when psql fails',()=>{
 let file;const records=[];assert.throws(()=>runUtf8Sql([],"SELECT 'Astronómicos';",{record:r=>records.push(r),execute:(_c,args)=>{file=args.at(-1);throw Object.assign(new Error('expected'),{status:3});}}));
 assert.equal(fs.existsSync(file),false);assert.equal(records[0].exitCode,3);
 assert.throws(()=>runUtf8Sql(['-c','SELECT 1'],'SELECT 2'));
});
test('versioned migration is strict UTF-8 and its accented normalization bytes survive file transport',()=>{
 const file='backend/prisma/migrations/202609300001_layer_division/migration.sql';
 const source=strictUtf8(fs.readFileSync(file));assert.ok(source.includes('áéíóúü'));
 runUtf8File([],file,{execute:(_command,args)=>{const text=strictUtf8(fs.readFileSync(args.at(-1)));assert.ok(text.endsWith(source));return '';}});
 const catalog=strictUtf8(fs.readFileSync('shared/phenomenon-utils.js'))+strictUtf8(fs.readFileSync('shared/division-utils.js'));
 for(const label of labels)assert.ok(catalog.includes(label),label);
});
