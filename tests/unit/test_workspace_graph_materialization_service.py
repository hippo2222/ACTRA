from unittest.mock import Mock

from services.workspace_graph_materialization_service import WorkspaceGraphMaterializationService


def _make_materializer(**overrides):
    services = {
        "complex_service": Mock(),
        "storage_service": Mock(),
        "theory_service": Mock(),
        "source_storage_service": Mock(),
    }
    services.update(overrides)
    return WorkspaceGraphMaterializationService(**services)


def test_remap_complex_settings_rekeys_test_question_display_modes():
    materializer = _make_materializer()

    remapped = materializer._remap_complex_settings(
        {
            "adaptive_difficulty": True,
            "test_question_display_modes": {
                "src_module/src_topic/test_1": "scattered",
                "src_module/src_topic/test_2": "together",
                "src_module/src_topic/missing": "scattered",
            },
        },
        {
            "src_module/src_topic/test_1": "dst_module/dst_topic/test_1",
            "src_module/src_topic/test_2": "dst_module/dst_topic/test_2",
        },
    )

    assert remapped["adaptive_difficulty"] is True
    assert remapped["test_question_display_modes"] == {
        "dst_module/dst_topic/test_1": "scattered",
        "dst_module/dst_topic/test_2": "together",
    }


def test_remap_complex_settings_accepts_list_mode_payloads():
    materializer = _make_materializer()

    remapped = materializer._remap_complex_settings(
        {
            "test_question_display_modes": [
                {
                    "task_ref": "src_module/src_topic/test_1",
                    "display_mode": "scattered",
                },
            ],
        },
        {"src_module/src_topic/test_1": "dst_module/dst_topic/test_1"},
    )

    assert remapped["test_question_display_modes"] == {
        "dst_module/dst_topic/test_1": "scattered",
    }


def test_materialize_complex_copy_remaps_scattered_mode_settings_with_task_refs():
    complex_service = Mock()
    storage_service = Mock()
    source_storage_service = Mock()

    complex_service.find_complex_by_source_lineage.return_value = None
    complex_service.ensure_workspace_complex_copy.side_effect = (
        lambda payload, **_: {
            "created": True,
            "reused": False,
            "complex_id": payload["id"],
            "item": payload,
        }
    )
    source_storage_service.get_module.return_value = {"name": "Source module"}
    source_storage_service.get_topic.return_value = {"name": "Source topic"}
    source_storage_service.load_task.side_effect = lambda module_id, topic_id, task_id: {
        "id": task_id,
        "type": "test",
        "questions": [{"id": "q1"}],
    }
    source_storage_service.get_topic_theory_link.return_value = None
    storage_service.ensure_module_workspace_copy.return_value = {
        "created": True,
        "reused": False,
        "module_id": "dst_module",
        "item": {},
    }
    storage_service.ensure_topic_workspace_copy.return_value = {
        "created": True,
        "reused": False,
        "module_id": "dst_module",
        "topic_id": "dst_topic",
        "item": {},
    }
    storage_service.materialize_task_workspace_copy.side_effect = (
        lambda module_id, topic_id, source_task, preferred_task_id, **_: {
            "created": True,
            "reused": False,
            "module_id": module_id,
            "topic_id": topic_id,
            "task_id": f"copy_{preferred_task_id}",
            "item": {},
        }
    )

    materializer = _make_materializer(
        complex_service=complex_service,
        storage_service=storage_service,
        source_storage_service=source_storage_service,
    )

    materializer.materialize_complex_copy(
        {
            "id": "complex_src",
            "name": "LR Herring",
            "tasks": [
                "src_module/src_topic/test_1",
                "src_module/src_topic/test_2",
            ],
            "settings": {
                "test_question_display_modes": {
                    "src_module/src_topic/test_1": "scattered",
                },
            },
        },
        source_catalog_item_id="catalog_item",
        source_catalog_version_id="version_1",
    )

    saved_payload = complex_service.ensure_workspace_complex_copy.call_args.args[0]

    assert saved_payload["tasks"] == [
        "dst_module/dst_topic/copy_test_1",
        "dst_module/dst_topic/copy_test_2",
    ]
    assert saved_payload["settings"]["test_question_display_modes"] == {
        "dst_module/dst_topic/copy_test_1": "scattered",
    }
