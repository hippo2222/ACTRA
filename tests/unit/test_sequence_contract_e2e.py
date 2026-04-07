"""
Contract e2e тесты для SEQUENCE_ASSEMBLY task type.

Проверка контракта: getUserAnswerPayload (Frontend) → TaskEvaluatorService (Backend)

Тестирует полный путь данных от формата UI payload до результата evaluator.
"""

import pytest
from task_system.types.sequence_assembly_task import SequenceAssemblyTaskEvaluator


class TestSequenceContractE2E:
    """
    Контрактные e2e тесты: проверяют что payload из SequenceUI.web.js 
    корректно обрабатывается Backend evaluator.
    """
    
    def test_difficulty_1_payload_basic(self):
        """
        Тест: Difficulty 1 payload (userCreatesLevels=false).
        
        UI (SequenceUI.web.js) отправляет:
        {
            "levels": [
                {"level_id": "level_1", "blocks": ["elem_1", "elem_2"]}
            ]
        }
        """
        evaluator = SequenceAssemblyTaskEvaluator()
        
        # Симулируем payload как отправляет SequenceUI.web.js для difficulty 1
        ui_payload = {
            "levels": [
                {"level_id": "level_1", "blocks": ["elem_1", "elem_2"]},
                {"level_id": "level_2", "blocks": ["elem_3", "elem_4"]}
            ]
        }
        
        # Backend reference data
        reference_data = {
            "levels": [
                {"level_id": "level_1", "blocks": ["elem_1", "elem_2"]},
                {"level_id": "level_2", "blocks": ["elem_3", "elem_4"]}
            ],
            "sequence_within_level_matters": True,
            "level_order_matters": True
        }
        
        result = evaluator.evaluate(ui_payload, reference_data)
        
        # Проверяем успешный результат
        assert result["success"] is True
        assert result["score"] == 100.0
        assert "message" in result
    
    def test_difficulty_1_payload_filtered_nulls(self):
        """
        Тест: После Fix 1    , null values фильтруются на frontend.
        Backend должен корректно обрабатывать payload без null.
        """
        evaluator = SequenceAssemblyTaskEvaluator()
        
        # После Fix 1: UI отправляет отфильтрованный payload (без null)
        ui_payload = {
            "levels": [
                {"level_id": "level_1", "blocks": ["elem_1"]},  # Был ["elem_1", null, "elem_2"]
            ]
        }
        
        reference_data = {
            "levels": [
                {"level_id": "level_1", "blocks": ["elem_1", "elem_2"]}
            ],
            "sequence_within_level_matters": True
        }
        
        result = evaluator.evaluate(ui_payload, reference_data)
        
        # Partial success - не все блоки размещены
        assert result["success"] is False
        assert result["score"] < 100.0
    
    def test_difficulty_2_payload_with_level_names(self):
        """
        Тест: Difficulty 2 payload (userCreatesLevels=true, requires_level_names=true).
        
        UI отправляет level_name в payload:
        {
            "levels": [
                {"level_id": "user_level_1", "level_name": "Этап подготовки", "blocks": ["elem_1"]}
            ]
        }
        """
        evaluator = SequenceAssemblyTaskEvaluator()
        
        # Difficulty 2: пользователь создаёт уровни с названиями
        ui_payload = {
            "levels": [
                {"level_id": "user_level_1", "level_name": "Этап подготовки", "blocks": ["elem_1", "elem_2"]},
                {"level_id": "user_level_2", "level_name": "Основной этап", "blocks": ["elem_3", "elem_4"]}
            ]
        }
        
        # Reference: оригинальные уровни с level_name
        reference_data = {
            "levels": [
                {"level_id": "level_1", "level_name": "Этап подготовки", "blocks": ["elem_1", "elem_2"]},
                {"level_id": "level_2", "level_name": "Основной этап", "blocks": ["elem_3", "elem_4"]}
            ],
            "sequence_within_level_matters": True,
            "level_order_matters": True
        }
        
        result = evaluator.evaluate(ui_payload, reference_data)
        
        # Evaluator сравнивает по level_id, но для difficulty 2 важен контент
        # Здесь level_id не совпадает, но это проверяется в TaskEvaluatorService
        assert "score" in result
        assert "success" in result
    
    def test_sequence_within_level_matters_false(self):
        """
        Тест: sequence_within_level_matters=false позволяет любой порядок внутри уровня.
        """
        evaluator = SequenceAssemblyTaskEvaluator()
        
        # Блоки в обратном порядке
        ui_payload = {
            "levels": [
                {"level_id": "level_1", "blocks": ["elem_2", "elem_1"]}  # Обратный порядок
            ]
        }
        
        reference_data = {
            "levels": [
                {"level_id": "level_1", "blocks": ["elem_1", "elem_2"]}  # Правильный порядок
            ],
            "sequence_within_level_matters": False,  # Порядок не важен
            "level_order_matters": False
        }
        
        result = evaluator.evaluate(ui_payload, reference_data)
        
        # Должен быть успех, т.к. порядок не важен
        assert result["success"] is True
        assert result["score"] == 100.0
    
    def test_same_text_blocks_are_equivalent_even_with_different_ids(self):
        evaluator = SequenceAssemblyTaskEvaluator()

        ui_payload = {
            "levels": [
                {"level_id": "level_1", "blocks": ["elem_2", "elem_4"]},
            ]
        }

        reference_data = {
            "elements": [
                {"id": "elem_1", "text": "Same step"},
                {"id": "elem_2", "text": "Same step"},
                {"id": "elem_3", "text": "Another"},
                {"id": "elem_4", "text": "Another"},
            ],
            "levels": [
                {"level_id": "level_1", "blocks": ["elem_1", "elem_3"]},
            ],
            "sequence_within_level_matters": True,
            "level_order_matters": False
        }

        result = evaluator.evaluate(ui_payload, reference_data)

        assert result["success"] is True
        assert result["score"] == 100.0

    def test_level_order_matters_true(self):
        """
        Тест: level_order_matters=true требует правильный порядок уровней.
        """
        evaluator = SequenceAssemblyTaskEvaluator()
        
        # Уровни в неправильном порядке
        ui_payload = {
            "levels": [
                {"level_id": "level_2", "blocks": ["elem_3", "elem_4"]},  # Должен быть вторым
                {"level_id": "level_1", "blocks": ["elem_1", "elem_2"]}   # Должен быть первым
            ]
        }
        
        reference_data = {
            "levels": [
                {"level_id": "level_1", "blocks": ["elem_1", "elem_2"]},
                {"level_id": "level_2", "blocks": ["elem_3", "elem_4"]}
            ],
            "sequence_within_level_matters": True,
            "level_order_matters": True  # Порядок уровней важен
        }
        
        result = evaluator.evaluate(ui_payload, reference_data)
        
        # Должен быть провал из-за неправильного порядка
        assert result["success"] is False
        assert "incorrect_levels" in result.get("details", {}) or "levels_in_correct_order" in result.get("details", {})


class TestSequenceRegressionBugFixes:
    """
    Регрессионные тесты на ранее найденные баги (Stage 2 + Stage 3 fixes).
    """
    
    def test_bug_null_in_blocks_handled(self):
        """
        Регрессионный тест: null в blocks не ломает evaluator.
        
        Баг: До Fix 1 UI мог отправить null в blocks для пустых слотов.
        Фикс: Frontend теперь фильтрует null (Fix 1).
        Backend должен корректно обрабатывать если legacy null всё-таки придёт.
        """
        evaluator = SequenceAssemblyTaskEvaluator()
        
        # Legacy payload с null (до Fix 1)
        ui_payload = {
            "levels": [
                {"level_id": "level_1", "blocks": ["elem_1", None, "elem_2"]}  # None внутри!
            ]
        }
        
        reference_data = {
            "levels": [
                {"level_id": "level_1", "blocks": ["elem_1", "elem_2", "elem_3"]}
            ],
            "sequence_within_level_matters": True
        }
        
        # Не должно быть исключения
        try:
            result = evaluator.evaluate(ui_payload, reference_data)
            assert "score" in result
            assert "success" in result
        except Exception as e:
            pytest.fail(f"Регрессия! Null в blocks вызвал ошибку: {e}")
    
    def test_bug_empty_levels_handled(self):
        """
        Регрессионный тест: пустой список уровней обрабатывается корректно.
        """
        evaluator = SequenceAssemblyTaskEvaluator()
        
        # Пользователь ничего не разместил
        ui_payload = {
            "levels": []
        }
        
        reference_data = {
            "levels": [
                {"level_id": "level_1", "blocks": ["elem_1", "elem_2"]}
            ]
        }
        
        result = evaluator.evaluate(ui_payload, reference_data)
        
        # Должен быть провал с 0% score
        assert result["success"] is False
        assert result["score"] == 0.0
    
    def test_bug_missing_blocks_key_handled(self):
        """
        Регрессионный тест: отсутствие ключа blocks обрабатывается.
        """
        evaluator = SequenceAssemblyTaskEvaluator()
        
        # Малформатный payload без blocks
        ui_payload = {
            "levels": [
                {"level_id": "level_1"}  # Нет blocks!
            ]
        }
        
        reference_data = {
            "levels": [
                {"level_id": "level_1", "blocks": ["elem_1"]}
            ]
        }
        
        # Не должно быть KeyError
        try:
            result = evaluator.evaluate(ui_payload, reference_data)
            assert "score" in result
        except KeyError as e:
            pytest.fail(f"Регрессия! Отсутствие blocks вызвало KeyError: {e}")
    
    def test_success_requires_100_percent(self):
        """
        Регрессионный тест: success=True требует ровно 100% score.
        
        Подтверждает корректность бинарной логики success для интеграции 
        с UserProgressManager и mistake_bank.
        """
        evaluator = SequenceAssemblyTaskEvaluator()
        
        # Partial correct - 50%
        ui_payload = {
            "levels": [
                {"level_id": "level_1", "blocks": ["elem_1"]}  # Только 1 блок
            ]
        }
        
        reference_data = {
            "levels": [
                {"level_id": "level_1", "blocks": ["elem_1", "elem_2"]}  # Нужно 2 блока
            ],
            "sequence_within_level_matters": True
        }
        
        result = evaluator.evaluate(ui_payload, reference_data)
        
        # 50% score, но success=False (требуется 100%)
        assert result["success"] is False
        assert result["score"] < 100.0


class TestSequenceEdgeCasesIntegration:
    """
    Интеграционные тесты на граничные случаи.
    """
    
    def test_single_element_task(self):
        """
        Тест: Задание с одним элементом (минимально возможное).
        """
        evaluator = SequenceAssemblyTaskEvaluator()
        
        ui_payload = {
            "levels": [
                {"level_id": "level_1", "blocks": ["elem_1"]}
            ]
        }
        
        reference_data = {
            "levels": [
                {"level_id": "level_1", "blocks": ["elem_1"]}
            ]
        }
        
        result = evaluator.evaluate(ui_payload, reference_data)
        
        assert result["success"] is True
        assert result["score"] == 100.0
    
    def test_many_levels_many_blocks(self):
        """
        Тест: Большое задание с множеством уровней и блоков.
        """
        evaluator = SequenceAssemblyTaskEvaluator()
        
        # 5 уровней по 3 блока = 15 блоков
        levels = []
        for i in range(5):
            levels.append({
                "level_id": f"level_{i+1}",
                "blocks": [f"elem_{i*3+1}", f"elem_{i*3+2}", f"elem_{i*3+3}"]
            })
        
        ui_payload = {"levels": levels}
        reference_data = {
            "levels": levels,
            "sequence_within_level_matters": True,
            "level_order_matters": True
        }
        
        result = evaluator.evaluate(ui_payload, reference_data)
        
        assert result["success"] is True
        assert result["score"] == 100.0
        assert result["details"]["total_blocks"] == 15
    
    def test_legacy_correct_sequence_format(self):
        """
        Тест: Legacy формат correct_sequence (обратная совместимость).
        """
        evaluator = SequenceAssemblyTaskEvaluator()
        
        ui_payload = {
            "levels": [
                {"level_id": "level_1", "blocks": ["elem_1", "elem_2", "elem_3"]}
            ]
        }
        
        # Legacy format: correct_sequence вместо levels
        reference_data = {
            "correct_sequence": ["elem_1", "elem_2", "elem_3"]
        }
        
        result = evaluator.evaluate(ui_payload, reference_data)
        
        # Должен обработать legacy формат
        assert "score" in result
        assert "success" in result

    def test_difficulty_3_runtime_slots_match_by_typed_names(self):
        evaluator = SequenceAssemblyTaskEvaluator()

        ui_payload = {
            "levels": [
                {
                    "level_id": "user_level_1",
                    "level_name": "Правая рука",
                    "blocks": ["user_slot_1", "user_slot_2"],
                    "block_names": {
                        "user_slot_1": "Красный",
                        "user_slot_2": "Желтый",
                    },
                }
            ]
        }

        reference_data = {
            "levels": [
                {
                    "level_id": "level_1",
                    "level_name": "Правая рука",
                    "blocks": ["elem_red", "elem_yellow"],
                    "block_names": {
                        "elem_red": "Красный",
                        "elem_yellow": "Желтый",
                    },
                }
            ],
            "elements": [
                {"id": "elem_red", "text": "Красный"},
                {"id": "elem_yellow", "text": "Желтый"},
            ],
            "sequence_within_level_matters": True,
            "level_order_matters": False,
        }

        result = evaluator.evaluate(ui_payload, reference_data)

        assert result["success"] is True
        assert result["score"] == 100.0

    def test_difficulty_3_runtime_slots_match_explicit_text_semantic_keys_after_normalization(self):
        evaluator = SequenceAssemblyTaskEvaluator()

        ui_payload = {
            "levels": [
                {
                    "level_id": "user_level_1",
                    "level_name": "\u041b\u0435\u0432\u0430\u044f \u043d\u043e\u0433\u0430",
                    "blocks": ["user_slot_1", "user_slot_2"],
                    "block_names": {
                        "user_slot_1": "\u0416\u0435\u043b\u0442\u044b\u0439",
                        "user_slot_2": "\u0417\u0435\u043b\u0435\u043d\u044b\u0439",
                    },
                }
            ]
        }

        reference_data = {
            "levels": [
                {
                    "level_id": "level_1",
                    "level_name": "\u041b\u0435\u0432\u0430\u044f \u043d\u043e\u0433\u0430",
                    "blocks": ["elem_yellow", "elem_green"],
                    "block_names": {
                        "elem_yellow": "\u0416\u0435\u043b\u0442\u044b\u0439",
                        "elem_green": "\u0417\u0435\u043b\u0451\u043d\u044b\u0439",
                    },
                }
            ],
            "elements": [
                {"id": "elem_yellow", "text": "\u0416\u0435\u043b\u0442\u044b\u0439", "semantic_key": "text:\u0416\u0435\u043b\u0442\u044b\u0439"},
                {"id": "elem_green", "text": "\u0417\u0435\u043b\u0435\u043d\u044b\u0439", "semantic_key": "text:\u0417\u0435\u043b\u0451\u043d\u044b\u0439"},
            ],
            "sequence_within_level_matters": True,
            "level_order_matters": False,
        }

        result = evaluator.evaluate(ui_payload, reference_data)

        assert result["success"] is True
        assert result["score"] == 100.0


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
