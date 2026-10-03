CREATE OR REPLACE VIEW v_course_progress AS
 SELECT cm.course_id,cm.user_id,count(l.id) AS total_lessons,count(lp.id) FILTER(WHERE lp.status='completed') AS completed_lessons,
 coalesce(round(100.0*count(lp.id) FILTER(WHERE lp.status='completed')/nullif(count(l.id),0),1),0) AS completion
 FROM course_members cm LEFT JOIN modules m ON m.course_id=cm.course_id AND (m.section_id IS NULL OR m.section_id=cm.section_id)
 LEFT JOIN lessons l ON l.module_id=m.id AND l.published LEFT JOIN lesson_progress lp ON lp.lesson_id=l.id AND lp.user_id=cm.user_id WHERE cm.role='student' GROUP BY cm.course_id,cm.user_id;
CREATE OR REPLACE VIEW v_attendance AS
 SELECT cm.course_id,cm.user_id,count(s.id) AS sessions,count(p.id) FILTER(WHERE p.attendance_complete) AS attended,
 round(100.0*count(p.id) FILTER(WHERE p.attendance_complete)/nullif(count(s.id),0),1) AS attendance
 FROM course_members cm LEFT JOIN live_sessions s ON s.course_id=cm.course_id AND s.ended_at IS NOT NULL AND (s.section_id IS NULL OR s.section_id=cm.section_id) LEFT JOIN session_participants p ON p.session_id=s.id AND p.user_id=cm.user_id WHERE cm.role='student' GROUP BY cm.course_id,cm.user_id;
CREATE OR REPLACE VIEW v_at_risk AS SELECT cm.course_id,cm.user_id,u.name,
 a.attendance,(SELECT max(e.at) FROM events e WHERE e.course_id=cm.course_id AND e.user_id=cm.user_id) AS last_activity
 FROM course_members cm JOIN users u ON u.id=cm.user_id LEFT JOIN v_attendance a ON a.course_id=cm.course_id AND a.user_id=cm.user_id WHERE cm.role='student';
CREATE MATERIALIZED VIEW IF NOT EXISTS league_weekly_standings AS SELECT p.league_id,date_trunc('week',p.at AT TIME ZONE 'Asia/Kolkata') AS week,p.section_id,sum(p.points) AS total,
 sum(p.points)/greatest(1,(SELECT count(*) FROM course_members cm WHERE cm.section_id=p.section_id AND cm.role='student')) AS per_capita,
 rank() OVER(PARTITION BY p.league_id,date_trunc('week',p.at AT TIME ZONE 'Asia/Kolkata') ORDER BY sum(p.points)/greatest(1,(SELECT count(*) FROM course_members cm WHERE cm.section_id=p.section_id AND cm.role='student')) DESC) AS rank
 FROM league_points p GROUP BY p.league_id,week,p.section_id;
CREATE INDEX IF NOT EXISTS events_course_at ON events(course_id,at);
CREATE INDEX IF NOT EXISTS chat_session_created ON chat_messages(session_id,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS active_join_code ON live_sessions(join_code) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS notes_search ON class_notes USING gin(to_tsvector('english',title||' '||regexp_replace(body_html,'<[^>]*>',' ','g')));
CREATE SEQUENCE IF NOT EXISTS receipt_seq;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS order_amount_positive;
ALTER TABLE orders ADD CONSTRAINT order_amount_positive CHECK(amount_paise>=0);
ALTER TABLE coupons DROP CONSTRAINT IF EXISTS coupon_valid;
ALTER TABLE coupons ADD CONSTRAINT coupon_valid CHECK(percent_off BETWEEN 0 AND 100 AND used_count BETWEEN 0 AND max_uses);
ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_length;
ALTER TABLE chat_messages ADD CONSTRAINT chat_length CHECK(length(body)<=1000);

-- REFRESH needs ownership; the runtime role calls this definer function instead.
CREATE OR REPLACE FUNCTION refresh_league_standings() RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$ REFRESH MATERIALIZED VIEW league_weekly_standings $$;
REVOKE ALL ON FUNCTION refresh_league_standings() FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='edu_app') THEN GRANT EXECUTE ON FUNCTION refresh_league_standings() TO edu_app; GRANT SELECT ON ALL TABLES IN SCHEMA public TO edu_app; END IF; END $$;
