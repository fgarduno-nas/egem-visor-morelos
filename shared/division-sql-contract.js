import { INSTITUTIONAL_DIVISIONS } from './division-utils.js';
import { INSTITUTIONAL_PHENOMENA, normalizePhenomenonLookupValue } from './phenomenon-utils.js';

// The checked-in migration embeds this generated contract. Tests reject drift.
export function divisionSqlContract() {
  const aliases = {otras:'otras'};
  for (const p of INSTITUTIONAL_PHENOMENA) {
    for (const value of [p.key, ...p.aliases]) {
      aliases[normalizePhenomenonLookupValue(value).replace(/^category:/, '')] = p.key.replace(/^category:/, '');
    }
  }
  const rules = Object.fromEntries(INSTITUTIONAL_DIVISIONS.map(d => [d.key, d.phenomena.map(p=>p.replace(/^category:/, ''))]));
  return `-- Generated from shared/division-utils.js and shared/phenomenon-utils.js.\nCREATE FUNCTION egem_classification_contract() RETURNS jsonb\nLANGUAGE sql IMMUTABLE AS $contract$ SELECT '${JSON.stringify({aliases,rules}).replaceAll("'", "''")}'::jsonb $contract$;`;
}
