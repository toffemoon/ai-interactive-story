import hashlib
import json
from pathlib import Path

import pytest
from fastapi import HTTPException

from src import api


def test_codex_bridge_manifest_matches_download_files():
    response = api.codex_bridge_manifest()
    payload = json.loads(response.body)

    assert payload["version"] == 1
    assert set(payload["files"]) == set(api._CODEX_BRIDGE_DOWNLOADS)
    for name, metadata in payload["files"].items():
        path = api.CODEX_BRIDGE_DIR / name
        assert metadata["sha256"] == hashlib.sha256(path.read_bytes()).hexdigest()
        assert metadata["size"] == path.stat().st_size


def test_codex_bridge_download_is_allowlisted():
    response = api.codex_bridge_download("server.js")
    assert Path(response.path) == api.CODEX_BRIDGE_DIR / "server.js"

    with pytest.raises(HTTPException) as error:
        api.codex_bridge_download("../../.env")
    assert error.value.status_code == 404
