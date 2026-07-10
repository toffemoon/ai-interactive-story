from src import auth


def user_row(email: str, role: str = "user", local_proxy_enabled: bool = False) -> dict:
    return {
        "id": "00000000-0000-0000-0000-000000000001",
        "username": "tester",
        "email": email,
        "display_name": "Tester",
        "role": role,
        "email_verified_at": None,
        "status": "active",
        "avatar": None,
        "local_proxy_enabled": local_proxy_enabled,
    }


def test_only_configured_email_can_be_superadmin(monkeypatch):
    monkeypatch.setenv("SUPERADMIN_EMAIL", "gengyue081@gmail.com")

    assert auth.effective_role(user_row("GENGYUE081@gmail.com", "user")) == "superadmin"
    assert auth.effective_role(user_row("other@example.com", "superadmin")) == "user"
    assert auth.effective_role(user_row("admin@example.com", "admin")) == "admin"


def test_database_superadmin_is_ignored_when_env_is_missing(monkeypatch):
    monkeypatch.delenv("SUPERADMIN_EMAIL", raising=False)

    assert auth.effective_role(user_row("other@example.com", "superadmin")) == "user"


def test_configured_superadmin_always_has_local_proxy_access(monkeypatch):
    monkeypatch.setenv("SUPERADMIN_EMAIL", "gengyue081@gmail.com")

    user = auth._row_to_user(user_row("gengyue081@gmail.com", local_proxy_enabled=False))

    assert user["role"] == "superadmin"
    assert user["local_proxy_enabled"] is True
class FakeCursor:
    def __init__(self, target):
        self.target = target
        self.rowcount = 0

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def execute(self, _query, _params):
        pass

    def fetchone(self):
        return self.target


class FakeConnection:
    def __init__(self, cursor):
        self._cursor = cursor

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def cursor(self):
        return self._cursor


class FakePool:
    def __init__(self, target):
        self._connection = FakeConnection(FakeCursor(target))

    def connection(self):
        return self._connection


def test_configured_superadmin_access_cannot_be_revoked(monkeypatch):
    monkeypatch.setenv("SUPERADMIN_EMAIL", "gengyue081@gmail.com")
    monkeypatch.setattr(
        auth,
        "get_pool",
        lambda: FakePool({
            "id": "00000000-0000-0000-0000-000000000001",
            "email": "gengyue081@gmail.com",
        }),
    )

    try:
        auth.set_local_proxy_enabled("gengyue081@gmail.com", False)
    except auth.HTTPException as exc:
        assert exc.status_code == 400
    else:
        raise AssertionError("configured superadmin access was revoked")
