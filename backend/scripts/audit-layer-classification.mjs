import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { LEGACY_VULNERABILITY_OVERRIDE_IDS } from '../../shared/legacy-vulnerability-overrides.js';

const authorizedIds = new Set(LEGACY_VULNERABILITY_OVERRIDE_IDS);

export function classifyAuditRows(rows) {
  const classified = rows.map(row => {
    const authorized = authorizedIds.has(row.id);
    const override = authorized && row.isDeleted === true && row.category === null && row.explicitCategory === false;
    const ambiguous = (authorized && !override) || (!authorized && row.category === null);
    return { ...row, override, ambiguous, classification: override ? 'vulnerability' : row.category };
  });
  const overrides = classified.filter(row => row.override);
  const ambiguous = classified.filter(row => row.ambiguous);
  const normalCategories = classified.filter(row => !row.override && !row.ambiguous).reduce((result, row) => {
    result[row.category] = (result[row.category] || 0) + 1;
    return result;
  }, {});
  const thematicCategories = Object.fromEntries(Object.entries(normalCategories).filter(([key]) => !['limites', 'otras'].includes(key)));
  const referenceCategories = Object.fromEntries(Object.entries(normalCategories).filter(([key]) => ['limites', 'otras'].includes(key)));
  return {
    total: rows.length,
    active: rows.filter(row => !row.isDeleted).length,
    deleted: rows.filter(row => row.isDeleted).length,
    thematicCategories,
    referenceCategories,
    distribution: { ...normalCategories, vulnerability: overrides.length },
    authorizedLegacyOverrides: overrides.length,
    overrideRows: overrides.map(({ id, isDeleted }) => ({
      id, isDeleted, division: 'vulnerability', phenomenon: null,
      preserved: true, publiclyVisible: false,
    })),
    rows: classified.map(({ id, title, isDeleted, classification, override, ambiguous }) => ({
      id, title: String(title).replace(/[\u0000-\u001f]/g, ' ').slice(0, 180),
      isDeleted, category: classification, authorizedLegacyOverride: override, ambiguous,
    })),
    ambiguous: ambiguous.map(({ id, title }) => ({ id, title: String(title).replace(/[\u0000-\u001f]/g, ' ').slice(0, 180) })),
  };
}

export async function classificationAuditSql() {
  const migration = await fs.readFile(new URL('../prisma/migrations/202609300001_layer_division/migration.sql', import.meta.url), 'utf8');
  const contract = migration.match(/AS \$contract\$ SELECT ([\s\S]+?) \$contract\$;/)?.[1];
  const category = migration.match(/FUNCTION egem_layer_category\(p jsonb\)[\s\S]+?AS \$\$([\s\S]+?)\$\$;/)?.[1];
  const explicit = migration.match(/FUNCTION egem_layer_has_explicit_category\(p jsonb\)[\s\S]+?AS \$\$([\s\S]+?)\$\$;/)?.[1];
  if (!contract || !category || !explicit) throw new Error('No se pudo leer el contrato de la migración final.');
  const expression = category.trim().replace(/;$/, '').replaceAll('egem_classification_contract()', `(${contract})`).replace(/\bp\b/g, 'm.properties');
  const hasCategory = explicit.trim().replace(/;$/, '').replace(/\bp\b/g, 'm.properties');
  return `SELECT l.id,l.title,l."isDeleted",c.category,x.explicit_category AS "explicitCategory" FROM "Layer" l LEFT JOIN "LayerMetadata" m ON m."layerId"=l.id CROSS JOIN LATERAL (${expression}) c(category) CROSS JOIN LATERAL (${hasCategory}) x(explicit_category) ORDER BY l.id`;
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
    return { ...classifyAuditRows(rows), hasDivisionColumn: column.present, fingerprints };
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
