import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export async function classificationAuditSql() {
  const migration = await fs.readFile(new URL('../prisma/migrations/202609300001_layer_division/migration.sql', import.meta.url), 'utf8');
  const contract = migration.match(/AS \$contract\$ SELECT ([\s\S]+?) \$contract\$;/)?.[1];
  const category = migration.match(/FUNCTION egem_layer_category\(p jsonb\)[\s\S]+?AS \$\$([\s\S]+?)\$\$;/)?.[1];
  if (!contract || !category) throw new Error('No se pudo leer el contrato de la migración final.');
  const expression = category.trim().replace(/;$/, '').replaceAll('egem_classification_contract()', `(${contract})`).replace(/\bp\b/g, 'm.properties');
  return `SELECT l.id,l.title,l."isDeleted",c.category FROM "Layer" l LEFT JOIN "LayerMetadata" m ON m."layerId"=l.id CROSS JOIN LATERAL (${expression}) c(category) ORDER BY l.id`;
}

export async function auditLayerClassification(prisma) {
  const query = await classificationAuditSql();
  return prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const rows = await tx.$queryRawUnsafe(query);
    const [column] = await tx.$queryRawUnsafe(`SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='Layer' AND column_name='division') AS present`);
    const fingerprints = {};
    for (const table of ['Layer','LayerMetadata','LayerFile']) {
      const [value] = await tx.$queryRawUnsafe(`SELECT count(*)::int AS count,md5(COALESCE(string_agg((to_jsonb(t)-${table === 'Layer' ? "'division'" : "'__audit_absent_key__'"})::text, E'\\n' ORDER BY id),'')) AS digest FROM "${table}" t`);
      fingerprints[table] = value;
    }
    return {
      total: rows.length, active: rows.filter(r=>!r.isDeleted).length, deleted: rows.filter(r=>r.isDeleted).length,
      hasDivisionColumn: column.present, fingerprints,
      distribution: rows.reduce((result,row)=>{const key=row.category||'AMBIGUOUS';result[key]=(result[key]||0)+1;return result},{}),
      rows: rows.map(({id,title,isDeleted,category})=>({id,title:String(title).replace(/[\u0000-\u001f]/g,' ').slice(0,180),isDeleted,category})),
      ambiguous: rows.filter(row=>!row.category).map(({id,title})=>({id,title:String(title).replace(/[\u0000-\u001f]/g,' ').slice(0,180)})),
    };
  }, {isolationLevel:'RepeatableRead',timeout:30000});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const {prisma} = await import('../src/config/database.js');
  try {
    const result=await auditLayerClassification(prisma);
    console.log(JSON.stringify(result,null,2));
    if(result.ambiguous.length)process.exitCode=2;
  } finally {await prisma.$disconnect();}
}
