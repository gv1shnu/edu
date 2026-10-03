CREATE OR REPLACE FUNCTION app_uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.user_id',true),'')::uuid $$;
-- Trusted server work (worker jobs, aggregate counts) runs with app.system=on.
CREATE OR REPLACE FUNCTION app_system() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('app.system',true),'')='on' $$;
CREATE OR REPLACE FUNCTION app_staff(cid uuid, sid uuid DEFAULT NULL) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM users WHERE id=app_uid() AND is_admin) OR EXISTS(SELECT 1 FROM course_members WHERE user_id=app_uid() AND course_id=cid AND role='instructor')
$$;
ALTER TABLE poll_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS poll_access ON poll_responses;
CREATE POLICY poll_access ON poll_responses USING(app_system() OR user_id=app_uid() OR EXISTS(SELECT 1 FROM polls p JOIN live_sessions s ON s.id=p.session_id WHERE p.id=poll_id AND app_staff(s.course_id,s.section_id)));
DROP POLICY IF EXISTS chat_access ON chat_messages;
CREATE POLICY chat_access ON chat_messages USING(app_system() OR EXISTS(SELECT 1 FROM live_sessions s WHERE s.id=session_id AND (app_staff(s.course_id,s.section_id) OR EXISTS(SELECT 1 FROM course_members m WHERE m.user_id=app_uid() AND m.course_id=s.course_id AND (s.allow_other_batches OR s.section_id IS NULL OR m.section_id=s.section_id))))) WITH CHECK(app_system() OR user_id=app_uid() OR EXISTS(SELECT 1 FROM live_sessions s WHERE s.id=session_id AND app_staff(s.course_id,s.section_id)));
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='edu_rls') THEN CREATE ROLE edu_rls NOLOGIN; END IF; END $$;
GRANT USAGE ON SCHEMA public TO edu_rls;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO edu_rls;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO edu_rls;

-- Runtime role for web, realtime and worker: not a superuser, does not own the tables, cannot
-- bypass RLS. Migrations run as the owner (MIGRATION_DATABASE_URL). migrate.ts sets its password.
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='edu_app') THEN CREATE ROLE edu_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB; END IF; END $$;
ALTER ROLE edu_app NOSUPERUSER NOBYPASSRLS;
GRANT edu_rls TO edu_app;
GRANT USAGE ON SCHEMA public TO edu_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO edu_app;
GRANT USAGE,SELECT,UPDATE ON ALL SEQUENCES IN SCHEMA public TO edu_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO edu_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE,SELECT,UPDATE ON SEQUENCES TO edu_app;
-- pg-boss manages its own schema (it creates queue partitions at runtime), so the runtime role owns it.
DO $$
DECLARE r record;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='pgboss') THEN
    EXECUTE 'CREATE SCHEMA pgboss AUTHORIZATION edu_app';
  ELSE
    EXECUTE 'ALTER SCHEMA pgboss OWNER TO edu_app';
    FOR r IN SELECT c.relname,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='pgboss' AND c.relkind IN ('r','p','S','v') LOOP
      EXECUTE format('ALTER %s pgboss.%I OWNER TO edu_app', CASE r.relkind WHEN 'S' THEN 'SEQUENCE' WHEN 'v' THEN 'VIEW' ELSE 'TABLE' END, r.relname);
    END LOOP;
    FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='pgboss' LOOP
      EXECUTE format('ALTER ROUTINE %s OWNER TO edu_app', r.sig);
    END LOOP;
    FOR r IN SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='pgboss' AND t.typtype='e' LOOP
      EXECUTE format('ALTER TYPE pgboss.%I OWNER TO edu_app', r.typname);
    END LOOP;
  END IF;
END $$;
