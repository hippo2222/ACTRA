"""
Unit tests for UserService — T18 coverage plan.

Covers:
- User dataclass: to_dict, to_api_dict, from_dict
- UserService init
- create_user (normal, validation, duplicate)
- get_user (normal, not found, guest, invalid JSON)
- get_all_users
- get_last_user_id / save_last_user_id
- delete_user
- update_user
- _check_duplicate_name, _generate_user_id
"""

import sys
import os
import json
import pytest
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "desktop-app"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.user_service import User, UserService


# ═══════════════════════════════════════════════════════════════════
# User dataclass
# ═══════════════════════════════════════════════════════════════════


class TestUserDataclass:
    def test_to_dict(self):
        user = User(user_id="u1", name="Test", created_at="2024-01-01")
        d = user.to_dict()
        assert d["user_id"] == "u1"
        assert d["profile"]["name"] == "Test"

    def test_to_api_dict(self):
        user = User(user_id="u1", name="Test", created_at="2024-01-01")
        d = user.to_api_dict()
        assert d["user_id"] == "u1"
        assert d["name"] == "Test"
        assert d["has_password"] is False
        assert d["avatar_seed"] == "1.png"  # default

    def test_to_api_dict_with_password(self):
        user = User(user_id="u1", name="Test", created_at="2024-01-01", password_hash="$2b$hash")
        d = user.to_api_dict()
        assert d["has_password"] is True

    def test_from_dict(self):
        data = {
            "user_id": "u1",
            "profile": {
                "name": "Test",
                "created_at": "2024-01-01",
                "avatar_seed": "3.png",
                "settings": {"theme": "dark"},
            },
        }
        user = User.from_dict(data)
        assert user.user_id == "u1"
        assert user.name == "Test"
        assert user.avatar_seed == "3.png"

    def test_from_dict_defaults(self):
        user = User.from_dict({})
        assert user.user_id == ""
        assert user.name == ""


# ═══════════════════════════════════════════════════════════════════
# UserService init
# ═══════════════════════════════════════════════════════════════════


@pytest.fixture
def svc(tmp_path):
    return UserService(data_dir=str(tmp_path))


class TestInit:
    def test_creates_users_dir(self, tmp_path):
        svc = UserService(data_dir=str(tmp_path))
        assert (tmp_path / "users").is_dir()


# ═══════════════════════════════════════════════════════════════════
# create_user
# ═══════════════════════════════════════════════════════════════════


class TestCreateUser:
    def test_normal(self, svc):
        user = svc.create_user("Alice Test")
        assert user.name == "Alice Test"
        assert user.user_id.startswith("user_")
        # Files created
        user_dir = svc.users_dir / user.user_id
        assert (user_dir / "profile.json").exists()
        assert (user_dir / "progress.json").exists()
        assert (user_dir / "statistics.json").exists()

    def test_empty_name(self, svc):
        with pytest.raises(ValueError):
            svc.create_user("")

    def test_whitespace_name(self, svc):
        with pytest.raises(ValueError):
            svc.create_user("   ")

    def test_short_name(self, svc):
        with pytest.raises(ValueError):
            svc.create_user("A")

    def test_long_name(self, svc):
        with pytest.raises(ValueError):
            svc.create_user("x" * 51)

    def test_forbidden_chars(self, svc):
        with pytest.raises(ValueError):
            svc.create_user("bad/name")

    def test_duplicate_name(self, svc):
        svc.create_user("Alice")
        with pytest.raises(ValueError, match="уже существует"):
            svc.create_user("Alice")


# ═══════════════════════════════════════════════════════════════════
# get_user
# ═══════════════════════════════════════════════════════════════════


class TestGetUser:
    def test_normal(self, svc):
        created = svc.create_user("Bob Test")
        fetched = svc.get_user(created.user_id)
        assert fetched is not None
        assert fetched.name == "Bob Test"

    def test_not_found(self, svc):
        assert svc.get_user("nonexistent") is None

    def test_empty_id(self, svc):
        assert svc.get_user("") is None

    def test_guest(self, svc):
        assert svc.get_user("guest") is None

    def test_invalid_json(self, svc):
        user_dir = svc.users_dir / "bad_user"
        user_dir.mkdir()
        (user_dir / "profile.json").write_text("{bad json", encoding="utf-8")
        assert svc.get_user("bad_user") is None


# ═══════════════════════════════════════════════════════════════════
# get_all_users
# ═══════════════════════════════════════════════════════════════════


class TestGetAllUsers:
    def test_empty(self, svc):
        assert svc.get_all_users() == []

    def test_multiple(self, svc):
        svc.create_user("Alice")
        svc.create_user("Bob")
        users = svc.get_all_users()
        assert len(users) == 2

    def test_skips_guest(self, svc):
        # Create a guest directory
        guest_dir = svc.users_dir / "guest"
        guest_dir.mkdir()
        (guest_dir / "profile.json").write_text("{}", encoding="utf-8")
        svc.create_user("Real User")
        users = svc.get_all_users()
        assert len(users) == 1


# ═══════════════════════════════════════════════════════════════════
# get_last_user_id / save_last_user_id
# ═══════════════════════════════════════════════════════════════════


class TestLastUserId:
    def test_no_state(self, svc):
        assert svc.get_last_user_id() is None

    def test_save_and_load(self, svc):
        svc.save_last_user_id("user_abc")
        assert svc.get_last_user_id() == "user_abc"

    def test_guest_cleared(self, svc):
        svc.save_last_user_id("guest")
        assert svc.get_last_user_id() == ""


# ═══════════════════════════════════════════════════════════════════
# delete_user
# ═══════════════════════════════════════════════════════════════════


class TestDeleteUser:
    def test_normal(self, svc):
        user = svc.create_user("Delete Me")
        assert svc.delete_user(user.user_id) is True
        assert not (svc.users_dir / user.user_id).exists()

    def test_not_found(self, svc):
        assert svc.delete_user("nonexistent") is False

    def test_empty_id(self, svc):
        with pytest.raises(ValueError):
            svc.delete_user("")


# ═══════════════════════════════════════════════════════════════════
# update_user
# ═══════════════════════════════════════════════════════════════════


class TestUpdateUser:
    def test_normal(self, svc):
        user = svc.create_user("Original")
        user.name = "Updated"
        assert svc.update_user(user) is True
        fetched = svc.get_user(user.user_id)
        assert fetched.name == "Updated"

    def test_not_found(self, svc):
        user = User(user_id="nonexistent", name="Test", created_at="2024-01-01")
        assert svc.update_user(user) is False
