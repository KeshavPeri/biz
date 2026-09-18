"""Focused safety checks for the opt-in Discovery image enrichment script."""

from __future__ import annotations

import unittest

from backend.seeds.enrich_discovery_photos import SEED_DOMAIN, load_targets, verify_local_assets


class DiscoveryPhotoEnrichmentTests(unittest.TestCase):
    def test_manifest_maps_exactly_the_fictional_creator_accounts(self) -> None:
        targets = load_targets()

        self.assertEqual(len(targets), 15)
        self.assertEqual(len({target.email for target in targets}), 15)
        self.assertTrue(all(target.email.endswith(f"@{SEED_DOMAIN}") for target in targets))
        self.assertEqual(targets[0].email, "ananya.rao0@seed.inflo.test")
        self.assertEqual(targets[-1].email, "tanya.ghosh14@seed.inflo.test")

    def test_checked_in_photo_assets_match_the_reviewed_manifest(self) -> None:
        verify_local_assets(load_targets())


if __name__ == "__main__":
    unittest.main()
