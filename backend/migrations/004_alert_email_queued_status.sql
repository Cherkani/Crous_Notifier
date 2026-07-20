ALTER TABLE alert_email_events
  MODIFY status ENUM('sent', 'failed', 'skipped', 'queued') NOT NULL;
