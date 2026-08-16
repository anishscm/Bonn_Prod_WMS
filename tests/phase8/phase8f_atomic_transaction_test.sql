\set ON_ERROR_STOP on
BEGIN;
CREATE TEMP TABLE tx_probe(id integer PRIMARY KEY, value text);
INSERT INTO tx_probe VALUES (1,'before');
SAVEPOINT phase8f_probe;
UPDATE tx_probe SET value='changed' WHERE id=1;
ROLLBACK TO SAVEPOINT phase8f_probe;
DO $$ DECLARE v text; BEGIN SELECT value INTO v FROM tx_probe WHERE id=1; IF v <> 'before' THEN RAISE EXCEPTION 'rollback contract failed'; END IF; END $$;
ROLLBACK;
SELECT 'Phase 8F atomic transaction SQL contract: PASS' AS result;
