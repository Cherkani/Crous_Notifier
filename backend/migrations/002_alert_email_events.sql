CREATE TABLE IF NOT EXISTS alert_email_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  event_type VARCHAR(64) NOT NULL,
  status ENUM('sent', 'failed', 'skipped') NOT NULL,
  recipient_count INT NOT NULL DEFAULT 0,
  recipients TEXT NULL,
  subject VARCHAR(500) NULL,
  error_message TEXT NULL,
  metadata JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_alert_email_events_created (created_at),
  INDEX idx_alert_email_events_type_status (event_type, status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

