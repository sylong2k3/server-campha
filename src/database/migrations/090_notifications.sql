-- Persistent per-user notification inbox. Complements the existing fire-and-forget
-- WebSocket/FCM push (src/services/notification.service.js) with a queryable history
-- so each user can list and mark as read only their own notifications.
CREATE TABLE IF NOT EXISTS core.notifications (
 id BIGSERIAL PRIMARY KEY,
 user_id BIGINT NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 type VARCHAR(50) NOT NULL,
 title VARCHAR(255) NOT NULL,
 body VARCHAR(2000),
 data JSONB NOT NULL DEFAULT '{}'::jsonb,
 read_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON core.notifications(user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON core.notifications(user_id) WHERE read_at IS NULL;
