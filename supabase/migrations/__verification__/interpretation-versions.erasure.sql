\set ON_ERROR_STOP 1
BEGIN;
CREATE FUNCTION pg_temp.vassert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL %',label; END IF; END $$;
-- Graph fixtures use the corpus. Parent-linked versions exercise self-FK cascade.
DO $$ DECLARE a record; other_user uuid; full_body jsonb; basic jsonb; v uuid; deletion_mode text; BEGIN
  SELECT spec->'full',spec->'basic' INTO STRICT full_body,basic FROM quarantine_cases WHERE spec->>'name'='current-authorized';
  FOREACH deletion_mode IN ARRAY ARRAY['report','rpc','account'] LOOP
    SELECT q.*,i.id INTO STRICT a FROM quarantine_rows q JOIN interpretations_private i ON i.lab_report_id=q.report_id
      WHERE q.spec->'expected'->>'trust'='legacy' AND q.mode='claimed' ORDER BY q.n LIMIT 1;
    SELECT user_id INTO STRICT other_user FROM lab_reports WHERE user_id<>a.user_id ORDER BY id LIMIT 1;
    v:=append_interpretation_version_internal(a.user_id,a.report_id,a.id,gen_random_uuid(),NULL,full_body,basic,'deep','1.0','{}');
    PERFORM append_interpretation_version_internal(a.user_id,a.report_id,a.id,gen_random_uuid(),v,full_body,basic,'deep','1.0','{}');
    CREATE TEMP TABLE unaffected_history AS SELECT convert_to(to_jsonb(i)::text,'UTF8') bytes
      FROM interpretations_private i JOIN lab_reports r ON r.id=i.lab_report_id WHERE r.user_id<>a.user_id;
    CREATE TEMP TABLE unaffected_claims AS SELECT convert_to(to_jsonb(c)::text,'UTF8') bytes
      FROM introductory_deep_access_claims c WHERE c.user_id<>a.user_id;
    IF deletion_mode='report' THEN
      DELETE FROM lab_reports WHERE id=a.report_id;
    ELSIF deletion_mode='rpc' THEN
      EXECUTE 'SET LOCAL ROLE service_role';
      PERFORM delete_interpretations(ARRAY[a.report_id]);
      -- Existing account cleanup subsequently repeats report deletion.
      DELETE FROM lab_reports WHERE id=a.report_id;
      EXECUTE 'RESET ROLE';
    ELSE
      DELETE FROM users WHERE id=a.user_id;
    END IF;
    PERFORM pg_temp.vassert(NOT EXISTS(SELECT 1 FROM lab_reports WHERE id=a.report_id)
      AND NOT EXISTS(SELECT 1 FROM interpretations_private WHERE id=a.id)
      AND NOT EXISTS(SELECT 1 FROM interpretation_history_protection WHERE lab_report_id=a.report_id)
      AND NOT EXISTS(SELECT 1 FROM interpretation_versions WHERE lab_report_id=a.report_id)
      AND NOT EXISTS(SELECT 1 FROM interpretation_current_versions WHERE lab_report_id=a.report_id),'H048-ERASURE-'||deletion_mode);
    IF deletion_mode<>'account' THEN
      PERFORM pg_temp.vassert(EXISTS(SELECT 1 FROM introductory_deep_access_claims WHERE user_id=a.user_id AND report_id IS NULL),'H048-ERASURE-CLAIM-NOT-REFUNDED');
    ELSE
      PERFORM pg_temp.vassert(NOT EXISTS(SELECT 1 FROM introductory_deep_access_claims WHERE user_id=a.user_id),'H048-ACCOUNT-CLAIM-ERASURE');
    END IF;
    PERFORM pg_temp.vassert(NOT EXISTS(
      (SELECT bytes FROM unaffected_history EXCEPT ALL SELECT convert_to(to_jsonb(i)::text,'UTF8') FROM interpretations_private i JOIN lab_reports r ON r.id=i.lab_report_id WHERE r.user_id<>a.user_id)
      UNION ALL (SELECT convert_to(to_jsonb(i)::text,'UTF8') FROM interpretations_private i JOIN lab_reports r ON r.id=i.lab_report_id WHERE r.user_id<>a.user_id EXCEPT ALL SELECT bytes FROM unaffected_history)), 'H048-ERASURE-OTHER-HISTORY');
    PERFORM pg_temp.vassert(NOT EXISTS(
      (SELECT bytes FROM unaffected_claims EXCEPT ALL SELECT convert_to(to_jsonb(c)::text,'UTF8') FROM introductory_deep_access_claims c WHERE c.user_id<>a.user_id)
      UNION ALL (SELECT convert_to(to_jsonb(c)::text,'UTF8') FROM introductory_deep_access_claims c WHERE c.user_id<>a.user_id EXCEPT ALL SELECT bytes FROM unaffected_claims)), 'H048-ERASURE-OTHER-CLAIMS');
    PERFORM pg_temp.vassert(EXISTS(SELECT 1 FROM lab_reports WHERE user_id=other_user),'H048-ERASURE-OTHER-REPORT');
    DROP TABLE unaffected_history,unaffected_claims;
    RAISE NOTICE 'PASS H048-ERASURE-%',deletion_mode;
  END LOOP;
END $$;
ROLLBACK;
