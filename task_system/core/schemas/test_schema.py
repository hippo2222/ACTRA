# task_system/schemas/test_schema.py
"""
Схема валидации для заданий типа "test".
"""

from typing import Dict, List, Any
from .base_schema import BaseTaskSchema


class TestTaskSchema(BaseTaskSchema):
    """Схема для валидации тестовых заданий."""
    
    @classmethod
    def _validate_content(cls, content: Dict[str, Any]) -> List[str]:
        """
        Валидирует содержимое тестового задания.
        
        Требования:
        - Должно быть поле questions (список вопросов)
        - Каждый вопрос должен иметь text и answers
        - Каждый ответ должен иметь text и correct
        - Хотя бы один ответ должен быть правильным
        """
        errors = []
        
        # Проверяем наличие вопросов
        if 'questions' not in content:
            errors.append("content.questions: обязательное поле отсутствует")
            return errors
        
        questions = content['questions']
        if not isinstance(questions, list):
            errors.append("content.questions: должен быть списком")
            return errors
        
        if len(questions) == 0:
            errors.append("content.questions: должен содержать хотя бы один вопрос")
            return errors
        
        # Проверяем каждый вопрос
        for i, question in enumerate(questions):
            if not isinstance(question, dict):
                errors.append(f"content.questions[{i}]: должен быть словарем")
                continue
            
            # Проверяем текст вопроса
            if 'text' not in question or not question['text']:
                errors.append(f"content.questions[{i}].text: обязательное поле отсутствует или пусто")
            
            # Проверяем изображения (опционально)
            if 'images' in question:
                images = question['images']
                if not isinstance(images, list):
                    errors.append(f"content.questions[{i}].images: должен быть списком")
                else:
                    if len(images) > 3:
                        errors.append(f"content.questions[{i}].images: максимум 3 изображения")
                    
                    for k, img in enumerate(images):
                        if isinstance(img, dict):
                            ref_keys = {
                                "path", "image_path", "image",
                                "asset_id", "image_asset_id",
                                "asset_url", "image_asset_url", "image_url", "url",
                            }
                            if not any(str(img.get(key) or "").strip() for key in ref_keys):
                                errors.append(f"content.questions[{i}].images[{k}]: image ref must include path, asset_id, or asset_url")
                        elif not isinstance(img, str):
                            errors.append(f"content.questions[{i}].images[{k}]: должен быть строкой (путь к файлу)")
            
            # Проверяем ответы
            if 'answers' not in question:
                errors.append(f"content.questions[{i}].answers: обязательное поле отсутствует")
                continue
            
            answers = question['answers']
            if not isinstance(answers, list):
                errors.append(f"content.questions[{i}].answers: должен быть списком")
                continue
            
            if len(answers) < 2:
                errors.append(f"content.questions[{i}].answers: должен содержать минимум 2 ответа")
                continue
            
            # Проверяем каждый ответ
            has_correct = False
            has_incorrect = False
            
            for j, answer in enumerate(answers):
                if not isinstance(answer, dict):
                    errors.append(f"content.questions[{i}].answers[{j}]: должен быть словарем")
                    continue
                
                # Проверяем текст ответа
                if 'text' not in answer or not answer['text']:
                    errors.append(f"content.questions[{i}].answers[{j}].text: обязательное поле отсутствует или пусто")
                
                # Проверяем флаг правильности
                if 'correct' not in answer:
                    errors.append(f"content.questions[{i}].answers[{j}].correct: обязательное поле отсутствует")
                else:
                    if not isinstance(answer['correct'], bool):
                        errors.append(f"content.questions[{i}].answers[{j}].correct: должен быть boolean")
                    else:
                        if answer['correct']:
                            has_correct = True
                        else:
                            has_incorrect = True
            
            # Проверяем наличие правильных и неправильных ответов
            if not has_correct:
                errors.append(f"content.questions[{i}]: должен содержать хотя бы один правильный ответ")
            
            if not has_incorrect:
                errors.append(f"content.questions[{i}]: должен содержать хотя бы один неправильный ответ")
        
        return errors

