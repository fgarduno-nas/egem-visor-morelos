import test from "node:test";
import assert from "node:assert/strict";

import {
  getPhenomenonSearchTokens,
  normalizePhenomenonForDisplay,
  normalizePhenomenonLookupValue,
} from "../shared/phenomenon-utils.js";

test("normaliza fenomenos institucionales desde claves tecnicas y variantes historicas", () => {
  const cases = [
    ["category:geologicos", "Geológicos", "category:geologicos"],
    ["CATEGORY:GEOLÓGICOS", "Geológicos", "category:geologicos"],
    ["geologicos", "Geológicos", "category:geologicos"],
    ["category:hidrometeorologicos", "Hidrometeorológicos", "category:hidrometeorologicos"],
    ["category:quimico-tecnologicos", "Químico-tecnológicos", "category:quimico-tecnologicos"],
    ["category:quimicos_tecnologicos", "Químico-tecnológicos", "category:quimico-tecnologicos"],
    ["category:sanitario-ecologico", "Sanitario-ecológico", "category:sanitario-ecologico"],
    ["category:socio-organizativo", "Socio-organizativos", "category:socio-organizativos"],
    ["category:socio_organizativos", "Socio-organizativos", "category:socio-organizativos"],
    ["category:astronomicos", "Astronómicos", "category:astronomicos"],
    ["category:limites", "Límites", "category:limites"],
  ];

  for (const [input, displayLabel, technicalKey] of cases) {
    assert.deepEqual(normalizePhenomenonForDisplay(input), {
      technicalKey,
      displayLabel,
      recognized: true,
    });
  }
});

test("fenomenos desconocidos tienen fallback seguro y nulos no se serializan", () => {
  assert.deepEqual(normalizePhenomenonForDisplay("category:riesgo_especial"), {
    technicalKey: "category:riesgo_especial",
    displayLabel: "Riesgo especial",
    recognized: false,
  });
  assert.deepEqual(normalizePhenomenonForDisplay(null), {
    technicalKey: null,
    displayLabel: "Sin clasificar",
    recognized: false,
  });
  assert.deepEqual(normalizePhenomenonForDisplay({ code: "category:geologicos" }), {
    technicalKey: null,
    displayLabel: "Sin clasificar",
    recognized: false,
  });
});

test("tokens de busqueda toleran acentos, prefijo category y guiones bajos", () => {
  assert.equal(normalizePhenomenonLookupValue(" Geológicos "), "geologicos");
  assert.equal(normalizePhenomenonLookupValue("category:GEOLÓGICOS"), "category:geologicos");
  assert.equal(normalizePhenomenonLookupValue("category:sanitario_ecologico"), "category:sanitario-ecologico");

  const tokens = getPhenomenonSearchTokens("category:geologicos");
  assert.ok(tokens.includes("category:geologicos"));
  assert.ok(tokens.includes("geologicos"));
});
