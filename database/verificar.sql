SELECT
 (SELECT COUNT(*) FROM tenants) AS tenants,
 (SELECT COUNT(*) FROM gates) AS gates,
 (SELECT COUNT(*) FROM users) AS users,
 (SELECT COUNT(*) FROM user_gates) AS user_gates,
 (SELECT COUNT(*) FROM codes) AS codes,
 (SELECT COUNT(*) FROM logs) AS logs,
 (SELECT COUNT(*) FROM platform_admins) AS platform_admins,
 (SELECT COUNT(*) FROM platform_audit_log) AS platform_audit_log,
 (SELECT COUNT(*) FROM login_attempts) AS login_attempts,
 (SELECT COUNT(*) FROM direct_operations) AS direct_operations;
