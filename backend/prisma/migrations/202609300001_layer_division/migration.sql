BEGIN;

-- Generated from shared/division-utils.js and shared/phenomenon-utils.js.
CREATE FUNCTION egem_classification_contract() RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $contract$ SELECT '{"aliases":{"otras":"otras","geologicos":"geologicos","hidrometeorologicos":"hidrometeorologicos","quimico-tecnologicos":"quimico-tecnologicos","quimicos-tecnologicos":"quimico-tecnologicos","sanitario-ecologico":"sanitario-ecologico","sanitario-ecologicos":"sanitario-ecologico","socio-organizativos":"socio-organizativos","socio-organizativo":"socio-organizativos","astronomicos":"astronomicos","limites":"limites"},"rules":{"hazard":["geologicos","hidrometeorologicos","quimico-tecnologicos","sanitario-ecologico","socio-organizativos","astronomicos"],"vulnerability":[],"risk":["geologicos","hidrometeorologicos","quimico-tecnologicos"]}}'::jsonb $contract$;

-- Classification is relational metadata, not a title/geometry heuristic.
-- Unknown, absent or contradictory categories deliberately return NULL.
CREATE FUNCTION egem_layer_category(p jsonb) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  WITH containers AS (
    SELECT p AS obj UNION ALL SELECT p->'metadata' UNION ALL SELECT p->'properties'
  ), candidates AS (
    SELECT obj->>field AS value FROM containers
      CROSS JOIN (VALUES ('phenomenon'), ('category'), ('theme'), ('topic')) fields(field)
      WHERE jsonb_typeof(obj->field) = 'string' AND trim(obj->>field) <> ''
    UNION ALL
    SELECT tag FROM containers CROSS JOIN LATERAL jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(obj->'tags') = 'array' THEN obj->'tags' ELSE '[]'::jsonb END
    ) tags(tag) WHERE tag ~* '^category\s*:'
  ), normalized AS (
    SELECT regexp_replace(regexp_replace(translate(lower(trim(value)),
      'áéíóúü', 'aeiouu'), '^category\s*:\s*', ''), '[_\s]+', '-', 'g') AS key
    FROM candidates
  ), categories AS (
    SELECT egem_classification_contract()->'aliases'->>key AS key FROM normalized
  )
  SELECT CASE WHEN count(*) > 0 AND count(key) = count(*) AND count(DISTINCT key) = 1
    THEN min(key) ELSE NULL END FROM categories;
$$;

-- A category marker that is unknown or contradictory is still explicit and must
-- never be treated as a category-free vulnerability layer.
CREATE FUNCTION egem_layer_has_explicit_category(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  WITH containers AS (
    SELECT p AS obj UNION ALL SELECT p->'metadata' UNION ALL SELECT p->'properties'
  )
  SELECT EXISTS (
    SELECT 1 FROM containers c, jsonb_each(
      CASE WHEN jsonb_typeof(c.obj)='object' THEN c.obj ELSE '{}'::jsonb END
    ) kv WHERE kv.key IN ('phenomenon','category','theme','topic')
      AND kv.value NOT IN ('null'::jsonb,'""'::jsonb)
  ) OR EXISTS (
    SELECT 1 FROM containers c, jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(c.obj->'tags')='array' THEN c.obj->'tags' ELSE '[]'::jsonb END
    ) tags(tag) WHERE tag ~* '^category\s*:'
  );
$$;

-- Freeze both sides during the preflight and backfill. No concurrent category edits.
LOCK TABLE "Layer", "LayerMetadata" IN SHARE ROW EXCLUSIVE MODE;
DO $$
DECLARE invalid_ids text;
BEGIN
  -- Explicit user authorization applies only to these three deleted IDs.
  -- No title, filename, geometry, or partial-text inference is permitted.
  WITH authorized(id) AS (VALUES
    ('cmqs7uli10003l3dgilbk7jhm'),
    ('cmqs8d6mt0003l3p1nzmrq8cg'),
    ('cmqsf108j0003l3tkmx3k7ch4')
  ), inspected AS (
    SELECT l.id, l."isDeleted", a.id IS NOT NULL AS authorized,
      egem_layer_category(m.properties) AS category,
      egem_layer_has_explicit_category(m.properties) AS explicit_category
    FROM "Layer" l LEFT JOIN "LayerMetadata" m ON m."layerId" = l.id
    LEFT JOIN authorized a ON a.id = l.id
  )
  SELECT string_agg(id, ', ') INTO invalid_ids FROM (
    SELECT id FROM inspected WHERE
      (authorized AND (NOT "isDeleted" OR explicit_category OR category IS NOT NULL))
      OR (category IS NULL AND NOT (authorized AND "isDeleted" AND NOT explicit_category))
    ORDER BY id LIMIT 20
  ) invalid;
  IF invalid_ids IS NOT NULL THEN
    RAISE EXCEPTION 'Division migration stopped: missing/unknown/conflicting explicit category. Layer IDs: %', invalid_ids;
  END IF;
END $$;

ALTER TABLE "Layer" ADD COLUMN "division" TEXT;
ALTER TABLE "Layer" ADD CONSTRAINT "Layer_division_check" CHECK (division IS NULL OR egem_classification_contract()->'rules' ? division);
CREATE INDEX "Layer_division_idx" ON "Layer"(division);

-- Change only the new field. In particular, do not touch updatedAt or metadata.
UPDATE "Layer" l SET division = 'hazard'
FROM "LayerMetadata" m
WHERE m."layerId" = l.id AND egem_layer_category(m.properties) NOT IN ('limites', 'otras');

-- The three historical records remain soft-deleted. Only the new column changes.
UPDATE "Layer" SET division = 'vulnerability'
WHERE id IN (
  'cmqs7uli10003l3dgilbk7jhm',
  'cmqs8d6mt0003l3p1nzmrq8cg',
  'cmqsf108j0003l3tkmx3k7ch4'
);

-- Cross-table invariants cannot be implemented by a PostgreSQL CHECK subquery.
-- Deferred constraint triggers validate the final state of Prisma's nested writes.
CREATE FUNCTION egem_assert_layer_division(layer_id text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE category text; value text;
BEGIN
  SELECT l.division, egem_layer_category(m.properties) INTO value, category
  FROM "Layer" l LEFT JOIN "LayerMetadata" m ON m."layerId" = l.id
  WHERE l.id = layer_id;
  IF NOT FOUND THEN RETURN; END IF; -- physical cascade deletion is not blocked
  IF value = 'vulnerability' THEN
    IF EXISTS (SELECT 1 FROM "LayerMetadata" m WHERE m."layerId"=layer_id
      AND egem_layer_has_explicit_category(m.properties))
    THEN RAISE EXCEPTION 'Vulnerability layer % cannot have phenomenon', layer_id USING ERRCODE='23514'; END IF;
  ELSIF category IN ('limites','otras') THEN
    IF value IS NOT NULL THEN RAISE EXCEPTION 'Reference layer % cannot have section', layer_id USING ERRCODE='23514'; END IF;
  ELSIF category IS NULL OR value IS NULL OR NOT COALESCE((egem_classification_contract()->'rules'->value) ? category, false) THEN
    RAISE EXCEPTION 'Invalid section/phenomenon for layer %', layer_id USING ERRCODE='23514';
  END IF;
END $$;

DO $$ DECLARE item record;
BEGIN
  FOR item IN SELECT id FROM "Layer" LOOP PERFORM egem_assert_layer_division(item.id); END LOOP;
END $$;

CREATE FUNCTION egem_check_layer_division() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'Layer' THEN
    PERFORM egem_assert_layer_division(NEW.id);
  ELSE
    IF TG_OP <> 'INSERT' THEN PERFORM egem_assert_layer_division(OLD."layerId"); END IF;
    IF TG_OP <> 'DELETE' THEN PERFORM egem_assert_layer_division(NEW."layerId"); END IF;
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER "Layer_division_required"
AFTER INSERT OR UPDATE ON "Layer" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION egem_check_layer_division();
CREATE CONSTRAINT TRIGGER "LayerMetadata_division_required"
AFTER INSERT OR UPDATE OR DELETE ON "LayerMetadata" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION egem_check_layer_division();

COMMIT;
