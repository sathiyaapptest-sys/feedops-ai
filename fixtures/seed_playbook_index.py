"""
Builds the playbook RAG index in Firestore. Run once, or whenever
GOOGLE_ORDERING_REDIRECT_PLAYBOOK.md changes.

Usage:
    python -m fixtures.seed_playbook_index
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.rag.playbook_index import build_index


def main() -> int:
    count = build_index()
    print(f"Indexed {count} playbook section(s) into Firestore.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
