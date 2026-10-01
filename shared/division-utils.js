import { normalizePhenomenonForDisplay, INSTITUTIONAL_PHENOMENA } from "./phenomenon-utils.js";
export const INSTITUTIONAL_DIVISIONS = Object.freeze([
  Object.freeze({key:"hazard",label:"Peligro",phenomena:Object.freeze(INSTITUTIONAL_PHENOMENA.slice(0,6).map(p=>p.key))}),
  Object.freeze({key:"vulnerability",label:"Vulnerabilidad",phenomena:Object.freeze([])}),
  Object.freeze({key:"risk",label:"Riesgo",phenomena:Object.freeze(INSTITUTIONAL_PHENOMENA.slice(0,3).map(p=>p.key))}),
]);
export function normalizeDivisionKey(value) { return INSTITUTIONAL_DIVISIONS.some(d=>d.key===value)?value:null; }
export function divisionLabel(value) { return INSTITUTIONAL_DIVISIONS.find(d=>d.key===value)?.label || "No aplica"; }
export function isThematicPhenomenon(value) { const p=normalizePhenomenonForDisplay(value);return p.recognized && p.technicalKey!=="category:limites"; }
export function phenomenaForDivision(division) { return (INSTITUTIONAL_DIVISIONS.find(d=>d.key===division)?.phenomena||[]).map(key=>INSTITUTIONAL_PHENOMENA.find(p=>p.key===key)); }
export function divisionUploadError(phenomenon, division) {
  if (division != null && division !== "" && !normalizeDivisionKey(division)) return "Sección desconocida. Selecciona Peligro, Vulnerabilidad o Riesgo.";
  const key=normalizePhenomenonForDisplay(phenomenon).technicalKey;
  if (["category:limites","category:otras","otras"].includes(key)) return division ? "Límites y referencias no admiten sección temática." : null;
  if (!division) return "Selecciona una sección para la capa temática.";
  if (division === "vulnerability") return phenomenon ? "Vulnerabilidad no admite fenómeno." : null;
  if (!phenomenon) return `Selecciona un fenómeno para ${divisionLabel(division)}.`;
  return phenomenaForDivision(division).some(p=>p.key===key) ? null : `El fenómeno no está permitido en ${divisionLabel(division)}.`;
}
export function reconcileDivisionPhenomenon(division, phenomenon) { return phenomenaForDivision(division).some(p=>p.key===normalizePhenomenonForDisplay(phenomenon).technicalKey)?phenomenon:""; }
// Historical read compatibility only; never completes new uploads.
export function effectiveDivisionKey(value, phenomenon) {
  if (value === "vulnerability" && !phenomenon) return value;
  if (!isThematicPhenomenon(phenomenon)) return null;
  const key = normalizePhenomenonForDisplay(phenomenon).technicalKey;
  return phenomenaForDivision(value).some(p => p.key === key) ? value : "hazard";
}
export function divisionFields(value, phenomenon) { const divisionKey=effectiveDivisionKey(value,phenomenon);return {divisionKey,division:divisionKey?divisionLabel(divisionKey):null}; }
export function classificationFields(division, category) {
  const fields=divisionFields(division,category),info=normalizePhenomenonForDisplay(category),thematic=fields.divisionKey&&fields.divisionKey!=="vulnerability";
  return {...fields,phenomenonKey:thematic?info.technicalKey:null,phenomenon:thematic?info.displayLabel:null,referenceCategory:!fields.divisionKey?info.technicalKey:null};
}
export function classificationLocation(division, category) { const f=classificationFields(division,category);return f.divisionKey?[f.division,f.phenomenon].filter(Boolean).join(" → "):(["otras", "category:otras"].includes(category) ? "Cartografía" : normalizePhenomenonForDisplay(category).displayLabel); }
export function groupLayersByDivision(layers) { const groups=INSTITUTIONAL_DIVISIONS.map(d=>({...d,layers:[]}));for(const layer of layers)groups.find(d=>d.key===(normalizeDivisionKey(layer.divisionKey)||"hazard")).layers.push(layer);return groups; }
export function createDivisionFallbackReporter(warn=message=>console.warn(message)) { let reported=false;return count=>{if(!reported&&count>0){reported=true;warn(`Compatibilidad temporal: ${count} capas temáticas sin una división válida se muestran en Peligro. Revisa la migración del catálogo.`);}}; }
export function divisionUploadTagsError(tags, division, explicit=[]) {
  const categories=[...(Array.isArray(tags)?tags:[]).filter(v=>/^category:/i.test(v)),...explicit.filter(v=>v!=null&&v!=="")];
  const unique=new Set(categories.map(v=>normalizePhenomenonForDisplay(v).technicalKey));
  if(unique.size>1)return "Selecciona un solo fenómeno para la capa.";
  return divisionUploadError(categories[0]||null,division);
}
