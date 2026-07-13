-- ============================================================
-- 015_maker_checker_config_unique.sql
-- Phase 7 Cluster C — one maker-checker config row per (brand, action).
--
-- The config table (008) had only an index on brand_id, so nothing stopped
-- duplicate rows for the same brand+action_type. A brand configures exactly one
-- rule per action, so make that a UNIQUE constraint — it's correct modelling and
-- lets the config UI upsert cleanly (onConflict brand_id,action_type).
-- Depends on: 008_maker_checker.sql
-- ============================================================

ALTER TABLE maker_checker_config
    ADD CONSTRAINT maker_checker_config_brand_action_uniq
    UNIQUE (brand_id, action_type);
