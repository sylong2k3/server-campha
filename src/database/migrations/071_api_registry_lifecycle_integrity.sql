-- Sprint 13 forward hardening: never reuse registry lifecycle identities with historical keys/logs.
DROP INDEX IF EXISTS apikey.uq_api_registries_active_layer;
DROP INDEX IF EXISTS apikey.uq_api_registries_active_slug;
CREATE UNIQUE INDEX uq_api_registries_layer ON apikey.registries(layer_id);
CREATE UNIQUE INDEX uq_api_registries_slug ON apikey.registries(slug);