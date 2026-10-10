\set ON_ERROR_STOP 1
BEGIN;
\ir interpretation-versions.helpers.sql
-- Reproduce the production client boundary for report deletion (ReportView /
-- Reports delete lab_reports directly under RLS). Rolled back with everything else.
ALTER TABLE lab_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY task048_own_reports ON lab_reports FOR ALL TO authenticated USING (user_id=auth.uid());
GRANT SELECT,DELETE ON lab_reports TO authenticated;
-- Graph fixtures use the corpus. Parent-linked versions exercise self-FK cascade.
DO $$ DECLARE a record; other record; full_body jsonb; basic jsonb; v uuid; deletion_mode text; affected bigint; BEGIN
  SELECT spec->'full',spec->'basic' INTO STRICT full_body,basic FROM quarantine_cases WHERE spec->>'name'='current-authorized';
  FOREACH deletion_mode IN ARRAY ARRAY['client','report','rpc','account'] LOOP
    SELECT q.*,i.id INTO STRICT a FROM quarantine_rows q JOIN interpretations_private i ON i.lab_report_id=q.report_id
      WHERE q.spec->'expected'->>'trust'='legacy' AND q.mode='claimed' ORDER BY q.n LIMIT 1;
    -- Another user's report that ALSO holds versions, so isolation is not vacuous.
    SELECT q.*,i.id INTO STRICT other FROM quarantine_rows q JOIN interpretations_private i ON i.lab_report_id=q.report_id
      WHERE q.spec->'expected'->>'trust'='legacy' AND q.mode='premium' AND q.user_id<>a.user_id ORDER BY q.n LIMIT 1;
    v:=append_interpretation_version_internal(a.user_id,a.report_id,a.id,gen_random_uuid(),NULL,full_body,basic,'deep','1.0','{}');
    PERFORM append_interpretation_version_internal(a.user_id,a.report_id,a.id,gen_random_uuid(),v,full_body,basic,'deep','1.0','{}');
    IF NOT EXISTS(SELECT 1 FROM interpretation_versions WHERE lab_report_id=other.report_id) THEN
      PERFORM append_interpretation_version_internal(other.user_id,other.report_id,other.id,gen_random_uuid(),NULL,full_body,basic,'deep','1.0','{}');
    END IF;
    CREATE TEMP TABLE unaffected AS
      SELECT 'history' kind,convert_to(to_jsonb(i)::text,'UTF8') bytes FROM interpretations_private i JOIN lab_reports r ON r.id=i.lab_report_id WHERE r.user_id<>a.user_id
      UNION ALL SELECT 'version',convert_to(to_jsonb(x)::text,'UTF8') FROM interpretation_versions x JOIN lab_reports r ON r.id=x.lab_report_id WHERE r.user_id<>a.user_id
      UNION ALL SELECT 'pointer',convert_to(to_jsonb(x)::text,'UTF8') FROM interpretation_current_versions x JOIN lab_reports r ON r.id=x.lab_report_id WHERE r.user_id<>a.user_id
      UNION ALL SELECT 'protection',convert_to(to_jsonb(x)::text,'UTF8') FROM interpretation_history_protection x JOIN lab_reports r ON r.id=x.lab_report_id WHERE r.user_id<>a.user_id
      UNION ALL SELECT 'claim',convert_to(to_jsonb(c)::text,'UTF8') FROM introductory_deep_access_claims c WHERE c.user_id<>a.user_id
      UNION ALL SELECT 'report',convert_to(to_jsonb(r)::text,'UTF8') FROM lab_reports r WHERE r.user_id<>a.user_id;
    IF deletion_mode='client' THEN
      PERFORM set_config('request.jwt.claim.sub',a.user_id::text,true);
      EXECUTE 'SET LOCAL ROLE authenticated';
      -- Cross-user: RLS hides the other report, so nothing is deleted.
      DELETE FROM lab_reports WHERE id=other.report_id;
      GET DIAGNOSTICS affected = ROW_COUNT;
      PERFORM pg_temp.vassert(affected=0,'H048-ERASURE-CROSS-USER-DELETE');
      DELETE FROM lab_reports WHERE id=a.report_id;
      GET DIAGNOSTICS affected = ROW_COUNT;
      EXECUTE 'RESET ROLE';
      PERFORM set_config('request.jwt.claim.sub','',true);
      PERFORM pg_temp.vassert(affected=1,'H048-ERASURE-client own report deleted');
    ELSIF deletion_mode='report' THEN
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
      AND NOT EXISTS(SELECT 1 FROM interpretation_history_protection WHERE lab_report_id=a.report_id OR interpretation_id=a.id)
      AND NOT EXISTS(SELECT 1 FROM interpretation_versions WHERE lab_report_id=a.report_id OR historical_interpretation_id=a.id)
      AND NOT EXISTS(SELECT 1 FROM interpretation_current_versions WHERE lab_report_id=a.report_id),'H048-ERASURE-'||deletion_mode);
    IF deletion_mode<>'account' THEN
      PERFORM pg_temp.vassert(EXISTS(SELECT 1 FROM introductory_deep_access_claims WHERE user_id=a.user_id AND report_id IS NULL),'H048-ERASURE-CLAIM-NOT-REFUNDED');
    ELSE
      PERFORM pg_temp.vassert(NOT EXISTS(SELECT 1 FROM introductory_deep_access_claims WHERE user_id=a.user_id),'H048-ACCOUNT-CLAIM-ERASURE');
    END IF;
    PERFORM pg_temp.vassert(NOT EXISTS(
      (SELECT * FROM unaffected EXCEPT ALL (
        SELECT 'history',convert_to(to_jsonb(i)::text,'UTF8') FROM interpretations_private i JOIN lab_reports r ON r.id=i.lab_report_id WHERE r.user_id<>a.user_id
        UNION ALL SELECT 'version',convert_to(to_jsonb(x)::text,'UTF8') FROM interpretation_versions x JOIN lab_reports r ON r.id=x.lab_report_id WHERE r.user_id<>a.user_id
        UNION ALL SELECT 'pointer',convert_to(to_jsonb(x)::text,'UTF8') FROM interpretation_current_versions x JOIN lab_reports r ON r.id=x.lab_report_id WHERE r.user_id<>a.user_id
        UNION ALL SELECT 'protection',convert_to(to_jsonb(x)::text,'UTF8') FROM interpretation_history_protection x JOIN lab_reports r ON r.id=x.lab_report_id WHERE r.user_id<>a.user_id
        UNION ALL SELECT 'claim',convert_to(to_jsonb(c)::text,'UTF8') FROM introductory_deep_access_claims c WHERE c.user_id<>a.user_id
        UNION ALL SELECT 'report',convert_to(to_jsonb(r)::text,'UTF8') FROM lab_reports r WHERE r.user_id<>a.user_id))),
      'H048-ERASURE-OTHER-USERS-UNCHANGED '||deletion_mode);
    PERFORM pg_temp.vassert(EXISTS(SELECT 1 FROM interpretation_versions WHERE lab_report_id=other.report_id),'H048-ERASURE-OTHER-VERSIONS-KEPT');
    DROP TABLE unaffected;
    RAISE NOTICE 'PASS H048-ERASURE-%',deletion_mode;
  END LOOP;
END $$;
-- Erasure never leaves an orphan anywhere in the version graph.
SELECT pg_temp.vassert(NOT EXISTS(SELECT 1 FROM interpretation_versions v LEFT JOIN interpretations_private i ON i.id=v.historical_interpretation_id WHERE i.id IS NULL)
  AND NOT EXISTS(SELECT 1 FROM interpretation_history_protection p LEFT JOIN interpretations_private i ON i.id=p.interpretation_id WHERE i.id IS NULL)
  AND NOT EXISTS(SELECT 1 FROM interpretation_current_versions c LEFT JOIN interpretation_versions v ON v.id=c.version_id WHERE v.id IS NULL),
  'H048-ERASURE-NO-ORPHANS');
ROLLBACK;
