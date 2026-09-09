-- Idempotent event notifications: manual notifications keep a NULL event key and may repeat.
ALTER TABLE core.notifications
 ADD COLUMN IF NOT EXISTS event_key VARCHAR(160);

CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_user_event
 ON core.notifications(user_id, event_key)
 WHERE event_key IS NOT NULL;

-- Include immutable transition context in PostgreSQL NOTIFY so a delayed listener
-- does not mistake a newer review for the event currently being handled.
CREATE OR REPLACE FUNCTION community.notify_field_report_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
 event_name TEXT;
 previous_status TEXT;
 actor_user_id BIGINT;
BEGIN
 event_name := CASE WHEN TG_OP = 'INSERT' THEN 'created' ELSE 'status_changed' END;
 IF TG_OP = 'UPDATE' THEN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  previous_status := OLD.status;
  actor_user_id := NEW.reviewed_by;
 END IF;
 PERFORM pg_notify(
  'field_report_events',
  json_build_object(
   'reportId', NEW.id,
   'event', event_name,
   'status', NEW.status,
   'previousStatus', previous_status,
   'actorUserId', actor_user_id
  )::text
 );
 RETURN NEW;
END $$;
