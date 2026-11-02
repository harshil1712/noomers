ALTER TABLE sites ADD COLUMN plausible_script_id TEXT;
CREATE UNIQUE INDEX sites_plausible_script_id_idx ON sites (plausible_script_id);
