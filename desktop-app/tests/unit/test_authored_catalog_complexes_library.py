import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

DESKTOP_APP_PATH = Path(__file__).resolve().parents[2]
if str(DESKTOP_APP_PATH) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_PATH))

from persistence.hosted_complex_repository import HostedComplexRepository
from services.hosted_complex_service import HostedComplexService


def test_hosted_complex_repository_methods_exist():
    repo = HostedComplexRepository("postgresql://dummy:dummy@localhost:5432/dummy")
    assert hasattr(repo, "upsert_complex")
    assert hasattr(repo, "delete_complex")
    assert callable(repo.upsert_complex)
    assert callable(repo.delete_complex)


def test_hosted_complex_service_atomic_crud_with_mocks():
    with tempfile.TemporaryDirectory() as tmp_dir:
        fake_settings = SimpleNamespace(postgres_dsn="postgresql://dummy:dummy@localhost:5432/dummy")
        service = HostedComplexService(data_dir=tmp_dir, persistence_settings=fake_settings)
        service.ensure_persistence_ready = MagicMock()
        service._initialized = True
        service.repository = MagicMock()
        service.repository.get_history_snapshot.return_value = None
        service.repository.list_history.return_value = []

        complex_data = {
            "id": "complex_atomic_1",
            "name": "КТ Грудной клетки. Шесть уровней",
            "description": "Тестовый комплекс",
            "tasks": ["module_01/topic_01/task_001"],
            "chains": [],
            "settings": {},
            "created_by_user_id": "user_hippopotamus",
            "updated_by_user_id": "user_hippopotamus",
            "created_via": "manual_editor",
            "content_scope": "shared_local",
        }

        # Create
        created = service.create_complex(complex_data)
        assert created.id == "complex_atomic_1"
        assert service.repository.upsert_complex.called

        # Update
        service.repository.upsert_complex.reset_mock()
        updated = service.update_complex("complex_atomic_1", {"name": "Обновленное имя"})
        assert updated.name == "Обновленное имя"
        assert service.repository.upsert_complex.called

        # Delete
        service.repository.delete_complex.return_value = True
        deleted = service.delete_complex("complex_atomic_1")
        assert deleted is True
        assert service.repository.delete_complex.called
