// Atomic D1 counters; shared by login and visitor endpoints, isolated by scope/IP.
export async function takeAttempt(env, key, max = 10) {
  const now = Date.now();
  const row = await env.DB.prepare(
    `INSERT INTO login_attempts(key,count,expires_at) VALUES(?,1,?)
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END,
    expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END RETURNING count`,
  )
    .bind(key, now + 300000, now, now)
    .first();
  return row.count <= max;
}
