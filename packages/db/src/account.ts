import type { PoolClient } from "pg";

/**
 * DPDP "Download my data": everything we hold about one person. Secrets are left out
 * (OAuth tokens, session tokens).
 * Run as system (see withUser/asSystem) so RLS doesn't hide the person's own history.
 */
export async function collectAccountData(tx: PoolClient, userId: string) {
  const one = async (sql: string) => (await tx.query(sql, [userId])).rows;
  const [user] = await one(
    "SELECT id,name,email,image,phone,timezone,email_enabled,created_at FROM users WHERE id=$1",
  );
  return {
    exported_at: new Date().toISOString(),
    user,
    google_accounts: await one(
      "SELECT provider_id,account_id,scope,created_at FROM accounts WHERE user_id=$1",
    ),
    sign_in_sessions: await one(
      "SELECT created_at,expires_at,ip_address,user_agent FROM sessions WHERE user_id=$1",
    ),
    profile: (await one("SELECT * FROM profiles WHERE user_id=$1"))[0] ?? null,
    enrolments: await one(
      "SELECT m.role,m.access_until,m.created_at,c.title course,s.name batch FROM course_members m JOIN courses c ON c.id=m.course_id LEFT JOIN sections s ON s.id=m.section_id WHERE m.user_id=$1",
    ),
    orders: await one(
      "SELECT o.id,f.title offering,o.amount_paise,o.coupon_code,o.status,o.paid_at,o.receipt_number,o.created_at FROM orders o JOIN offerings f ON f.id=o.offering_id WHERE o.user_id=$1",
    ),
    lesson_progress: await one(
      "SELECT * FROM lesson_progress WHERE user_id=$1",
    ),
    live_attendance: await one(
      "SELECT p.session_id,l.title,p.joined_at,p.last_seen_at,p.attendance_complete FROM session_participants p JOIN live_sessions l ON l.id=p.session_id WHERE p.user_id=$1",
    ),
    chat_messages: await one(
      "SELECT session_id,body,kind,created_at,deleted_at FROM chat_messages WHERE user_id=$1",
    ),
    poll_responses: await one(
      "SELECT poll_id,response,answered_at FROM poll_responses WHERE user_id=$1",
    ),
    exit_ticket_responses: await one(
      "SELECT ticket_id,response,confused_about,at FROM exit_ticket_responses WHERE user_id=$1",
    ),
    confusion_signals: await one(
      "SELECT session_id,at,cleared_at FROM confusion_signals WHERE user_id=$1",
    ),
    pace_votes: await one(
      "SELECT session_id,vote,updated_at FROM pace_votes WHERE user_id=$1",
    ),
    cold_calls: await one(
      "SELECT session_id,at,outcome FROM cold_calls WHERE picked_user_id=$1",
    ),
    class_note_reads: await one(
      "SELECT note_id,first_opened_at,last_opened_at,downloaded FROM class_note_reads WHERE user_id=$1",
    ),
    league_points: await one(
      "SELECT league_id,source,points,reason,at FROM league_points WHERE user_id=$1",
    ),
    uploads: await one(
      "SELECT filename,mime,size_bytes,created_at FROM uploads WHERE user_id=$1",
    ),
    notifications: await one(
      "SELECT kind,title,body,link,read_at,created_at FROM notifications WHERE user_id=$1",
    ),
    activity_events: await one(
      "SELECT type,course_id,entity_id,meta,at FROM events WHERE user_id=$1",
    ),
  };
}

/**
 * DPDP "Delete my account": erase personal data and anonymise what must be kept.
 * Kept: orders and receipts (financial records), and anonymised attendance and poll rows so
 * course statistics stay correct. Everything identifying or free-text is removed. Returns the
 * object-storage keys of the person's files so a worker job can delete them.
 */
export async function eraseAccount(tx: PoolClient, userId: string) {
  const run = (sql: string) => tx.query(sql, [userId]);
  const files = (
    await tx.query(
      `SELECT r2_key FROM uploads WHERE user_id=$1
       UNION SELECT banner_r2_key FROM profiles WHERE user_id=$1 AND banner_r2_key IS NOT NULL`,
      [userId],
    )
  ).rows.map((r) => r.r2_key as string);
  const [u] = (await run("SELECT email FROM users WHERE id=$1")).rows;
  // Free text and identifying content.
  await run(
    "UPDATE chat_messages SET body='[removed]',deleted_at=coalesce(deleted_at,now()) WHERE user_id=$1",
  );
  // Free-text answers are removed; choice answers stay (anonymously) for class statistics.
  await run(
    "UPDATE exit_ticket_responses r SET confused_about='',response=CASE WHEN t.type='short_text' THEN '\"[removed]\"'::jsonb ELSE r.response END FROM exit_tickets t WHERE t.id=r.ticket_id AND r.user_id=$1",
  );
  await run(
    "UPDATE poll_responses r SET response='\"[removed]\"'::jsonb FROM polls p WHERE p.id=r.poll_id AND p.type='short_text' AND r.user_id=$1",
  );
  // Personal records that serve no retained purpose.
  for (const table of [
    "sessions",
    "accounts",
    "notifications",
    "events",
    "class_note_reads",
    "confusion_signals",
    "pace_votes",
    "lesson_progress",
    "uploads",
    "profiles",
    "course_members",
  ])
    await run(`DELETE FROM ${table} WHERE user_id=$1`);
  if (u?.email) {
    await tx.query("DELETE FROM verifications WHERE identifier=$1", [u.email]);
    await tx.query(
      "UPDATE staff_invites SET revoked_at=coalesce(revoked_at,now()) WHERE lower(email)=lower($1)",
      [u.email],
    );
  }
  await tx.query(
    "UPDATE users SET name='Deleted learner',email=$2,email_verified=false,image=NULL,phone=NULL,is_admin=false,deleted_at=now() WHERE id=$1",
    [userId, `deleted-${userId}@invalid.local`],
  );
  return { files };
}
