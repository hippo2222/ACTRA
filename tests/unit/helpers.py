import importlib.util
import sys
import types
from pathlib import Path


def load_task_evaluator_service():
    repo_root = Path(__file__).resolve().parents[2]
    desktop_app_dir = repo_root / "desktop-app"
    services_dir = desktop_app_dir / "services"
    service_path = services_dir / "task_evaluator_service.py"

    desktop_pkg = types.ModuleType("desktop_app")
    desktop_pkg.__path__ = [str(desktop_app_dir)]
    sys.modules.setdefault("desktop_app", desktop_pkg)

    services_pkg = types.ModuleType("desktop_app.services")
    services_pkg.__path__ = [str(services_dir)]
    sys.modules.setdefault("desktop_app.services", services_pkg)

    module_name = "desktop_app.services.task_evaluator_service"
    spec = importlib.util.spec_from_file_location(
        module_name, service_path, submodule_search_locations=[str(services_dir)]
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    if spec.loader is None:  # pragma: no cover
        raise ImportError("Cannot load TaskEvaluatorService")
    spec.loader.exec_module(module)
    return module.TaskEvaluatorService


__all__ = ["load_task_evaluator_service"]
