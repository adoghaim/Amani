\set ON_ERROR_STOP 1
-- PK-03e-F. The prelude's users stub predates 20260826000000, so the users
-- privileged-column clamp triggers never existed in the harness chain. Add
-- exactly the columns that migration's grants and function bodies name (shapes
-- from 20260216193045 / 20260823000000), plus the auth.users email the INSERT
-- clamp reads; trigger-enable-always.run.sh then applies the real
-- 20260826000000, so the safety-trigger list is checked against real DDL.
-- subscription_status DEFAULT 'trial' is the production column default the clamp
-- itself reuses (see its comment); nothing here is a new value.
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email text;

ALTER TABLE users ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status text DEFAULT 'trial';
ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_start_date timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id text;
