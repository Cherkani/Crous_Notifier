CREATE TABLE IF NOT EXISTS check_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  watch_id VARCHAR(64) NULL,
  watch_name VARCHAR(255) NULL,
  status ENUM('success', 'error') NOT NULL,
  found_count INT NOT NULL DEFAULT 0,
  new_count INT NOT NULL DEFAULT 0,
  message TEXT NULL,
  error_message TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_check_events_created (created_at),
  INDEX idx_check_events_watch_created (watch_id, created_at),
  INDEX idx_check_events_status_created (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS delivery_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  watch_id VARCHAR(64) NULL,
  watch_name VARCHAR(255) NULL,
  channel ENUM('whatsapp', 'email') NOT NULL,
  trigger_type VARCHAR(64) NOT NULL,
  status ENUM('success', 'failed') NOT NULL,
  recipient VARCHAR(255) NULL,
  subject VARCHAR(500) NULL,
  message TEXT NULL,
  provider_message_id VARCHAR(255) NULL,
  error_message TEXT NULL,
  metadata JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_delivery_events_created (created_at),
  INDEX idx_delivery_events_channel_status_created (channel, status, created_at),
  INDEX idx_delivery_events_trigger_created (trigger_type, created_at),
  INDEX idx_delivery_events_watch_created (watch_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE watches
  ADD COLUMN last_no_result_whatsapp_at DATETIME(3) NULL AFTER last_error;

