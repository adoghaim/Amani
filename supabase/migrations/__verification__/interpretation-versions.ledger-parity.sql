\set ON_ERROR_STOP 1
-- TASK-048 turn 11 parity control: commit_deep_access's outcomes and writes for
-- reports WITHOUT an anchor, before and after 20261012000008 moved its claim
-- rules into settle_introductory_claim. Self-checking (each expectation is
-- asserted) and printing: run.sh compares the printed lines across the forward,
-- so the extracted rules must behave exactly as the original body did.
-- Everything is rolled back.
BEGIN;
\ir interpretation-versions.helpers.sql
CREATE TEMP TABLE task048_parity(n integer,line text) ON COMMIT DROP;
CREATE FUNCTION pg_temp.pdraw(t text) RETURNS text LANGUAGE sql AS $$ SELECT md5('h048p-'||t)||md5('h048p-'||t||'-draw') $$;
CREATE FUNCTION pg_temp.pcall(n integer,label text,u uuid,r uuid,d text,src text,tier text,consume boolean,expected text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE got text; BEGIN
  BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    got:=public.commit_deep_access(u,r,pg_temp.pdraw(d),'accession',jsonb_build_object('headline','H048P '||label),src,tier,consume);
    EXECUTE 'RESET ROLE';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS got=RETURNED_SQLSTATE; got:='sqlstate:'||got;
  END;
  INSERT INTO task048_parity VALUES(n,label||'='||got);
  IF got IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'FAIL H048L-PARITY %: expected %, observed %',label,expected,got;
  END IF;
END $$;

DO $$ DECLARE
  p1 uuid:='048f0000-0000-4000-8000-000000000001'; p2 uuid:='048f0000-0000-4000-8000-000000000002';
  p3 uuid:='048f0000-0000-4000-8000-000000000003';
  pa uuid:='048f1000-0000-4000-8000-00000000000a'; pb uuid:='048f1000-0000-4000-8000-00000000000b';
  pc uuid:='048f1000-0000-4000-8000-00000000000c'; pd uuid:='048f1000-0000-4000-8000-00000000000d';
  pe uuid:='048f1000-0000-4000-8000-00000000000e'; px uuid:='048f1000-0000-4000-8000-0000000000f0';
  pl uuid:='048f1000-0000-4000-8000-0000000000f1'; missing uuid:='048f1000-0000-4000-8000-0000000000ff';
BEGIN
  INSERT INTO users(id) VALUES(p1),(p2),(p3);
  INSERT INTO lab_reports(id,user_id) VALUES(pa,p1),(pb,p1),(pc,p1),(pd,p1),(pe,p1),(px,p2),(pl,p3);
  INSERT INTO introductory_deep_access_claims(user_id,report_id,blood_draw_id,evidence_tier) VALUES
    (p1,pc,pg_temp.pdraw('C0'),'accession'),
    (p3,NULL,pg_temp.pdraw('L1'),'accession'),(p3,NULL,pg_temp.pdraw('L2'),'accession'),(p3,NULL,pg_temp.pdraw('L3'),'accession');
  PERFORM pg_temp.pcall(1,'committed',p1,pa,'A','ai','plus',true,'committed');
  PERFORM pg_temp.pcall(2,'already-by-draw',p1,pb,'A','ai','plus',false,'already_claimed');
  PERFORM pg_temp.pcall(3,'already-by-report',p1,pc,'C1','ai','plus',false,'already_claimed');
  PERFORM pg_temp.pcall(4,'unclaimed-no-consume',p1,pd,'D','ai','plus',false,'sqlstate:22023');
  PERFORM pg_temp.pcall(5,'unclaimed-null-consume',p1,pe,'E','ai','plus',NULL,'sqlstate:22023');
  PERFORM pg_temp.pcall(6,'limit',p3,pl,'L','ai','plus',true,'limit_reached');
  PERFORM pg_temp.vassert(NOT EXISTS(SELECT 1 FROM interpretations_private WHERE lab_report_id=pl),'H048L-PARITY limit-no-write');
  PERFORM pg_temp.pcall(7,'foreign',p1,px,'X','ai','plus',true,'sqlstate:23503');
  PERFORM pg_temp.pcall(8,'invalid-tier',p1,pe,'E','ai','free',true,'sqlstate:22023');
  PERFORM pg_temp.pcall(9,'invalid-source',p1,pe,'E','deterministic','plus',true,'sqlstate:22023');
  PERFORM pg_temp.pcall(10,'foreign-before-invalid',p1,px,'X','ai','free',true,'sqlstate:23503');
  PERFORM pg_temp.pcall(11,'missing',p1,missing,'M','ai','plus',true,'sqlstate:23503');
  PERFORM pg_temp.pcall(12,'third-credit',p1,pe,'E','ai','plus',true,'committed');
  PERFORM pg_temp.pcall(13,'limit-after-three',p1,pd,'D','ai','plus',true,'limit_reached');
  PERFORM pg_temp.vassert(NOT EXISTS(SELECT 1 FROM interpretations_private WHERE lab_report_id=pd),'H048L-PARITY limit-after-three-no-write');
END $$;

-- The printed result: every outcome, then every claim and anchor the scenarios
-- left, without ids or timestamps.
SELECT 'outcome|'||line FROM task048_parity ORDER BY n;
SELECT 'claim|'||c.user_id||'|'||COALESCE(c.report_id::text,'-')||'|'||c.blood_draw_id||'|'||c.evidence_tier
FROM introductory_deep_access_claims c WHERE c.user_id::text LIKE '048f0000-%' ORDER BY 1;
SELECT 'anchor|'||i.lab_report_id||'|'||i.json_output::text||'|'||i.interpretation_source||'|'||COALESCE(i.tier,'-')
  ||'|'||i.stored_depth||'|'||i.disclaimer_version||'|'||COALESCE(i.blood_draw_id,'-')
FROM interpretations_private i WHERE i.lab_report_id::text LIKE '048f1000-%' ORDER BY 1;
ROLLBACK;
