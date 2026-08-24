"""
Seeds Firestore with the golden merchant dataset. Actually writes to Firestore
(Application Default Credentials, or FIRESTORE_EMULATOR_HOST for local dev) --
unlike seed_demo.py, which only prints a scripted narration and touches nothing.

Usage:
    python -m fixtures.seed_firestore
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.jobs.scheduled_tasks import _load_from_json_snapshot, DEFAULT_SNAPSHOT_PATH
from backend.db.firestore_client import seed_from_snapshot


def main() -> int:
    merchants = _load_from_json_snapshot(DEFAULT_SNAPSHOT_PATH)
    count = seed_from_snapshot(merchants)
    print(f"Seeded {count} merchant(s) from {DEFAULT_SNAPSHOT_PATH} into Firestore.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
