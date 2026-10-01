const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {execFileSync} = require('node:child_process');

function strictUtf8(bytes) {
  const text = new TextDecoder('utf-8', {fatal:true}).decode(bytes);
  if (text.includes('\uFFFD')) throw new Error('SQL contains replacement characters');
  return text;
}

function runUtf8Sql(args, sql, {execute=execFileSync, record=()=>{}}={}) {
  if (args.some(arg=>['-c','--command','-f','--file'].includes(arg))) throw new Error('SQL execution accepts connection arguments only');
  // Strict validation also catches unpaired surrogates converted by Buffer.from.
  const content = strictUtf8(Buffer.from(sql,'utf8'));
  const bytes = Buffer.from("\\encoding UTF8\nSET client_encoding = 'UTF8';\n"+content,'utf8');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'egem-sql-'));
  const file = path.join(dir,'trial.sql');
  let exitCode = null;
  try {
    fs.writeFileSync(file,bytes,{flag:'wx'});
    strictUtf8(fs.readFileSync(file));
    const result = execute('psql',[...args,'-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-f',file],{
      encoding:'utf8',shell:false,env:{...process.env,PGCLIENTENCODING:'UTF8'},stdio:['ignore','pipe','pipe'],
    });
    exitCode = 0;
    return result.trim();
  } catch(error) {
    exitCode = error.status ?? -1;
    throw error;
  } finally {
    try { record({path:'<temp>/'+path.basename(dir)+'/trial.sql',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),encoding:'UTF-8',exitCode}); }
    finally { fs.rmSync(file,{force:true});fs.rmdirSync(dir); }
  }
}

function runUtf8File(args, file, options) {
  return runUtf8Sql(args,strictUtf8(fs.readFileSync(file)),options);
}
module.exports={strictUtf8,runUtf8Sql,runUtf8File};
