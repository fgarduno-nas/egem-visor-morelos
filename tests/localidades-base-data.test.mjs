import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const geojson = JSON.parse(await readFile("data/base/localidades_morelos.geojson", "utf8"));
const diagnostic = JSON.parse(await readFile("data/base/localidades_morelos_diagnostico.json", "utf8"));

const expectedBounds = {
  minLon: -99.65,
  maxLon: -98.45,
  minLat: 18.25,
  maxLat: 19.2,
};

function features() {
  return geojson.features;
}

function byName(name) {
  return features().filter((feature) => feature.properties.NOM_LOC === name);
}

test("localidades de Morelos es un FeatureCollection de puntos oficiales", () => {
  assert.equal(geojson.type, "FeatureCollection");
  assert.equal(geojson.name, "Localidades oficiales de Morelos 2020");
  assert.equal(geojson.metadata.crs, "EPSG:4326");
  assert.equal(geojson.metadata.source, "INEGI, Censo de Poblacion y Vivienda 2020, ITER");
  assert.equal(geojson.metadata.sourceUrl, diagnostic.sourceUrl);
  assert.equal(features().length, 1578);
  assert.equal(geojson.metadata.totalFeatures, features().length);

  for (const feature of features()) {
    assert.equal(feature.type, "Feature");
    assert.equal(feature.geometry.type, "Point");
    assert.equal(feature.geometry.coordinates.length, 2);
  }
});

test("coordenadas usan orden longitud latitud y permanecen en el entorno de Morelos", () => {
  for (const feature of features()) {
    const [longitude, latitude] = feature.geometry.coordinates;
    assert.equal(typeof longitude, "number");
    assert.equal(typeof latitude, "number");
    assert.ok(longitude >= expectedBounds.minLon && longitude <= expectedBounds.maxLon, feature.properties.CVEGEO);
    assert.ok(latitude >= expectedBounds.minLat && latitude <= expectedBounds.maxLat, feature.properties.CVEGEO);
  }

  assert.ok(diagnostic.coordinateBounds.minLongitude < diagnostic.coordinateBounds.maxLongitude);
  assert.ok(diagnostic.coordinateBounds.minLatitude < diagnostic.coordinateBounds.maxLatitude);
  assert.ok(diagnostic.coordinateBounds.minLongitude < -99);
  assert.ok(diagnostic.coordinateBounds.maxLatitude > 19);
});

test("propiedades obligatorias estan normalizadas y no contienen cadenas numericas vacias", () => {
  const requiredProperties = [
    "CVE_ENT",
    "CVE_MUN",
    "CVE_LOC",
    "CVEGEO",
    "NOM_ENT",
    "NOM_MUN",
    "NOM_LOC",
    "POBTOT",
    "ALTITUD",
    "esCabecera",
    "labelTier",
    "labelPriority",
    "source",
  ];

  for (const feature of features()) {
    for (const property of requiredProperties) {
      assert.ok(Object.hasOwn(feature.properties, property), `${feature.properties.CVEGEO} falta ${property}`);
    }
    assert.equal(feature.properties.CVE_ENT, "17");
    assert.match(feature.properties.CVE_MUN, /^\d{3}$/);
    assert.match(feature.properties.CVE_LOC, /^\d{4}$/);
    assert.match(feature.properties.CVEGEO, /^17\d{7}$/);
    assert.equal(feature.properties.CVEGEO, `${feature.properties.CVE_ENT}${feature.properties.CVE_MUN}${feature.properties.CVE_LOC}`);
    assert.equal(typeof feature.properties.POBTOT, "number");
    assert.ok(Number.isInteger(feature.properties.POBTOT));
    assert.ok(feature.properties.POBTOT >= 0);
    assert.equal(typeof feature.properties.ALTITUD, "number");
    assert.ok(Number.isInteger(feature.properties.ALTITUD));
    assert.equal(typeof feature.properties.esCabecera, "boolean");
    assert.ok(feature.properties.NOM_LOC.trim().length > 0);
    assert.equal(feature.properties.source, geojson.metadata.source);
  }
});

test("excluye totales y agregados no geograficos del ITER", () => {
  assert.equal(features().some((feature) => feature.properties.CVE_LOC === "0000"), false);
  assert.equal(features().some((feature) => feature.properties.CVE_LOC === "9998"), false);
  assert.equal(features().some((feature) => feature.properties.CVE_LOC === "9999"), false);
  assert.equal(features().some((feature) => /^Total\b/i.test(feature.properties.NOM_LOC)), false);

  assert.equal(diagnostic.removedRecords.totalEstatal, 1);
  assert.equal(diagnostic.removedRecords.totalMunicipalLoc0000, 36);
  assert.equal(diagnostic.removedRecords.agregadoLoc9998, 32);
  assert.equal(diagnostic.removedRecords.agregadoLoc9999, 31);
});

test("CVEGEO y labelPriority son unicos y consecutivos", () => {
  const cvegeos = features().map((feature) => feature.properties.CVEGEO);
  assert.equal(new Set(cvegeos).size, cvegeos.length);
  assert.deepEqual(diagnostic.duplicateKeys, []);

  const priorities = features().map((feature) => feature.properties.labelPriority).sort((a, b) => a - b);
  assert.equal(new Set(priorities).size, priorities.length);
  assert.deepEqual(priorities, Array.from({ length: features().length }, (_, index) => index + 1));
});

test("labelTier cumple rangos de poblacion y coincide con diagnostico", () => {
  const counts = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
  for (const feature of features()) {
    const { POBTOT, labelTier } = feature.properties;
    assert.ok(labelTier >= 1 && labelTier <= 5);
    if (POBTOT >= 50000) assert.equal(labelTier, 1, feature.properties.CVEGEO);
    else if (POBTOT >= 25000) assert.equal(labelTier, 2, feature.properties.CVEGEO);
    else if (POBTOT >= 5000) assert.equal(labelTier, 3, feature.properties.CVEGEO);
    else if (POBTOT >= 1000) assert.equal(labelTier, 4, feature.properties.CVEGEO);
    else assert.equal(labelTier, 5, feature.properties.CVEGEO);
    counts[String(labelTier)] += 1;
  }
  assert.deepEqual(counts, diagnostic.localidadesPorTier);
  assert.equal(Object.values(counts).reduce((sum, count) => sum + count, 0), features().length);
});

test("cabeceras se identifican por LOC 0001 y tienen claves municipales validas", () => {
  const cabeceras = features().filter((feature) => feature.properties.esCabecera);
  const municipios = new Set(features().map((feature) => feature.properties.CVE_MUN));
  assert.equal(cabeceras.length, 36);
  assert.equal(diagnostic.cabecerasConfirmadas.length, 36);

  for (const cabecera of cabeceras) {
    assert.equal(cabecera.properties.CVE_LOC, "0001");
    assert.ok(municipios.has(cabecera.properties.CVE_MUN));
    assert.ok(diagnostic.cabecerasConfirmadas.some((item) => item.CVEGEO === cabecera.properties.CVEGEO));
  }
});

test("localidades principales solicitadas estan presentes", () => {
  const expected = ["Cuernavaca", "Cuautla", "Jiutepec", "Jojutla", "Xochitepec", "Emiliano Zapata"];
  for (const name of expected) {
    const matches = byName(name);
    assert.ok(matches.length >= 1, `${name} no encontrada`);
    assert.ok(matches.some((feature) => feature.properties.esCabecera), `${name} no marcada como cabecera`);
  }

  const cuernavaca = byName("Cuernavaca").find((feature) => feature.properties.CVEGEO === "170070001");
  assert.equal(cuernavaca.properties.POBTOT, 341029);
  assert.equal(cuernavaca.properties.labelTier, 1);
  assert.equal(cuernavaca.properties.labelPriority, 1);
});

test("diagnostico conserva trazabilidad del insumo y consistencia con GeoJSON", () => {
  assert.equal(diagnostic.zipSha256, "158567bec3feef647ddc4cf803bc8ae57f230e3c61b49626efd850c2ae6a5e7f");
  assert.equal(diagnostic.zipName, "iter_17_cpv2020_csv.zip");
  assert.equal(diagnostic.csvName, "conjunto_de_datos_iter_17CSV20.csv");
  assert.equal(diagnostic.encodingDetected, "utf8");
  assert.equal(diagnostic.originalRecords, 1678);
  assert.equal(diagnostic.finalRecords, features().length);
  assert.equal(diagnostic.zeroPopulationRecords.length, 0);
  assert.equal(diagnostic.nullAltitudeRecords.length, 0);
  assert.equal(diagnostic.validationSummary.allPoints, true);
  assert.equal(diagnostic.validationSummary.allCoordinatesLonLat, true);
  assert.equal(diagnostic.validationSummary.uniqueCvegeo, true);
  assert.equal(diagnostic.validationSummary.labelPriorityConsecutive, true);
  assert.equal(diagnostic.validationSummary.noAggregateLocCodes, true);
});
