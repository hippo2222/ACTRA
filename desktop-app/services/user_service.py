"""
User Service - Управление профилями пользователей.

Отвечает за:
- Создание новых пользователей
- Получение информации о пользователях
- Управление структурой данных пользователей

ФАЗА 1: Профили пользователей и расширенная статистика
"""

import json
import logging
import uuid
import os
import random
import tempfile
from pathlib import Path
from typing import List, Optional, Dict, Any
from dataclasses import dataclass, field
from datetime import datetime

from services.schemas.user_schemas import ProfileSchema, ProgressSchema, StatisticsSchema
from task_system.core.exceptions import TaskValidationError

USER_ROLE_USER = "user"
USER_ROLE_ADMIN = "admin"
USER_PLAN_FREE = "free"
USER_PLAN_PREMIUM = "premium"


@dataclass
class User:
    """
    Модель пользователя.
    
    Attributes:
        user_id: Уникальный идентификатор пользователя
        name: Имя пользователя
        created_at: Дата и время создания профиля (ISO 8601)
        settings: Настройки пользователя
    """
    user_id: str
    name: str
    created_at: str
    avatar_seed: Optional[str] = None
    login: Optional[str] = None
    email: Optional[str] = None
    pending_email: Optional[str] = None
    email_verified_at: Optional[str] = None
    email_verification_sent_at: Optional[str] = None
    pending_email_verification_sent_at: Optional[str] = None
    password_hash: Optional[str] = None
    role: str = USER_ROLE_USER
    plan: str = USER_PLAN_FREE
    security_settings: Dict[str, Any] = field(default_factory=lambda: {
        "require_password_on_login": False,
        "require_password_on_edit": False
    })
    settings: Dict[str, Any] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, Any]:
        """Преобразует User в словарь для сохранения в profile.json"""
        return {
            "user_id": self.user_id,
            "profile": {
                "name": self.name,
                "created_at": self.created_at,
                "avatar_seed": self.avatar_seed,
                "login": self.login,
                "email": self.email,
                "pending_email": self.pending_email,
                "email_verified_at": self.email_verified_at,
                "email_verification_sent_at": self.email_verification_sent_at,
                "pending_email_verification_sent_at": self.pending_email_verification_sent_at,
                "password_hash": self.password_hash,
                "role": self.role or USER_ROLE_USER,
                "plan": self.plan or USER_PLAN_FREE,
                "security_settings": self.security_settings,
                "settings": self.settings
            }
        }

    def to_api_dict(self) -> Dict[str, Any]:
        """Преобразует User в плоский словарь для API (совместимость с UI)"""
        return {
            "user_id": self.user_id,
            "name": self.name,
            "created_at": self.created_at,
            "login": self.login,
            "email": self.email,
            "pending_email": self.pending_email,
            "pending_email_change_pending": bool(self.pending_email),
            "email_verified": bool(self.email and self.email_verified_at),
            "email_verified_at": self.email_verified_at,
            "email_verification_sent_at": self.email_verification_sent_at,
            "pending_email_verification_sent_at": self.pending_email_verification_sent_at,
            "avatar_seed": self.avatar_seed or "1.png",  # Дефолтный аватар вместо user_id
            "has_password": bool(self.password_hash),
            "role": self.role or USER_ROLE_USER,
            "plan": self.plan or USER_PLAN_FREE,
            "security_settings": {
                "require_password_on_login": self.security_settings.get("require_password_on_login", False),
                "require_password_on_edit": self.security_settings.get("require_password_on_edit", False),
            },
            "settings": self.settings
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'User':
        """Создает User из словаря (из profile.json)"""
        profile = data.get("profile", {})
        return cls(
            user_id=data.get("user_id", ""),
            name=profile.get("name", ""),
            created_at=profile.get("created_at", ""),
            avatar_seed=profile.get("avatar_seed"),
            login=profile.get("login"),
            email=profile.get("email"),
            pending_email=profile.get("pending_email"),
            email_verified_at=profile.get("email_verified_at"),
            email_verification_sent_at=profile.get("email_verification_sent_at"),
            pending_email_verification_sent_at=profile.get("pending_email_verification_sent_at"),
            password_hash=profile.get("password_hash"),
            role=str(profile.get("role") or USER_ROLE_USER).strip() or USER_ROLE_USER,
            plan=str(profile.get("plan") or USER_PLAN_FREE).strip() or USER_PLAN_FREE,
            security_settings=profile.get("security_settings", {
                "require_password_on_login": False,
                "require_password_on_edit": False
            }),
            settings=profile.get("settings", {})
        )


class UserService:
    """
    Сервис для управления профилями пользователей.
    
    Отвечает за:
    - Создание новых пользователей
    - Получение информации о пользователях
    - Управление структурой данных пользователей
    
    Использование:
        service = UserService(data_dir="./data")
        
        # Создание пользователя
        user = service.create_user("Иван Иванов")
        
        # Получение пользователя
        user = service.get_user("user_123")
        
        # Получение всех пользователей
        users = service.get_all_users()
    """
    
    def __init__(self, data_dir: str = None):
        """
        Инициализация UserService.
        
        Args:
            data_dir: Путь к директории с данными (если None, используется config.json)
        """
        # Импортируем load_config только если data_dir не указан
        if data_dir is None:
            from common.config_loader import load_config
            config = load_config()
            data_dir = config.get("data_root", "data")
        
        self.data_dir = Path(data_dir)
        self.users_dir = self.data_dir / "users"
        self.logger = logging.getLogger(self.__class__.__name__)
        
        # Создаем директорию users, если её нет
        self.users_dir.mkdir(parents=True, exist_ok=True)
        self.app_state_file = self.data_dir / "app_state.json"
        self.logger.info(f"UserService initialized with data_dir: {self.data_dir}")
    
    def get_last_user_id(self) -> Optional[str]:
        """Загружает ID последнего активного пользователя."""
        if not self.app_state_file.exists():
            return None
        try:
            with open(self.app_state_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                return data.get("last_user_id")
        except Exception as e:
            self.logger.error(f"Failed to load app state: {e}")
            return None

    def save_last_user_id(self, user_id: str):
        """Сохраняет ID последнего активного пользователя."""
        try:
            # Guest mode is removed; do not persist guest as active profile.
            if user_id == "guest":
                user_id = ""

            data = {}
            if self.app_state_file.exists():
                with open(self.app_state_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
            
            data["last_user_id"] = user_id
            with open(self.app_state_file, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            self.logger.error(f"Failed to save app state: {e}")
    
    def create_user(self, name: str) -> User:
        """
        Создает нового пользователя.
        
        Args:
            name: Имя пользователя
        
        Returns:
            User: Созданный пользователь
        
        Raises:
            ValueError: Если имя пустое или некорректное
            TaskValidationError: Если данные не прошли валидацию
        """
        if not name or not name.strip():
            raise ValueError("Имя пользователя не может быть пустым")
        
        name = name.strip()
        
        # Проверка длины
        if len(name) < 2:
            raise ValueError("Имя должно содержать минимум 2 символа")
        if len(name) > 50:
            raise ValueError("Имя не может быть длиннее 50 символов")
        
        # Проверка запрещенных символов
        forbidden_chars = ['/', '\\', '<', '>', ':', '"', '|', '?', '*']
        if any(char in name for char in forbidden_chars):
            raise ValueError(f"Имя не может содержать символы: {', '.join(forbidden_chars)}")
        
        # Проверка дубликатов
        if self._check_duplicate_name(name):
            raise ValueError(f"Пользователь с именем '{name}' уже существует")
        
        # Генерируем уникальный user_id
        user_id = self._generate_user_id()
        
        # Создаем структуру данных пользователя
        created_at = datetime.now().isoformat()
        
        # Выбираем случайный аватар из доступных (1.png - 7.png)
        default_avatar = f"{random.randint(1, 7)}.png"
        
        user = User(
            user_id=user_id,
            name=name.strip(),
            created_at=created_at,
            avatar_seed=default_avatar,
            settings={}
        )
        
        # Создаем директорию пользователя
        user_dir = self.users_dir / user_id
        user_dir.mkdir(parents=True, exist_ok=True)
        
        # Сохраняем profile.json
        profile_data = user.to_dict()
        ProfileSchema.validate_or_raise(profile_data)
        
        profile_file = user_dir / "profile.json"
        with open(profile_file, 'w', encoding='utf-8') as f:
            json.dump(profile_data, f, ensure_ascii=False, indent=2)
        
        self.logger.info(f"Created user: {user_id} ({name})")
        
        # Создаем начальные файлы progress.json и statistics.json
        self._initialize_user_data(user_id)
        
        return user
    
    def get_user(self, user_id: str) -> Optional[User]:
        """
        Получает пользователя по ID.
        
        Args:
            user_id: ID пользователя
        
        Returns:
            User: Пользователь или None, если не найден
        """
        if not user_id:
            return None
        if user_id == "guest":
            return None
        
        user_dir = self.users_dir / user_id
        profile_file = user_dir / "profile.json"
        
        if not profile_file.exists():
            self.logger.warning(f"User not found: {user_id}")
            return None
        
        try:
            with open(profile_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            # Валидируем данные
            errors = ProfileSchema.validate(data)
            if errors:
                self.logger.error(f"Invalid profile data for user {user_id}: {errors}")
                return None
            
            user = User.from_dict(data)
            return user
        
        except json.JSONDecodeError as e:
            self.logger.error(f"Failed to parse profile.json for user {user_id}: {e}")
            return None
        except Exception as e:
            self.logger.error(f"Error loading user {user_id}: {e}")
            return None
    
    def get_all_users(self) -> List[User]:
        """
        Получает список всех пользователей.
        
        Returns:
            List[User]: Список всех пользователей
        """
        users = []
        
        if not self.users_dir.exists():
            return users
        
        # Проходим по всем директориям в users/
        for user_dir in self.users_dir.iterdir():
            if not user_dir.is_dir():
                continue
            
            user_id = user_dir.name
            if user_id == "guest":
                # Legacy compatibility: ignore deprecated guest profile directory.
                continue
            profile_file = user_dir / "profile.json"
            
            if not profile_file.exists():
                self.logger.warning(f"Profile not found for user directory: {user_id}")
                continue
            
            try:
                with open(profile_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                
                # Валидируем данные
                errors = ProfileSchema.validate(data)
                if errors:
                    self.logger.warning(f"Invalid profile data for user {user_id}: {errors}")
                    continue
                
                user = User.from_dict(data)
                users.append(user)
            
            except json.JSONDecodeError as e:
                self.logger.warning(f"Failed to parse profile.json for user {user_id}: {e}")
                continue
            except Exception as e:
                self.logger.warning(f"Error loading user {user_id}: {e}")
                continue
        
        self.logger.info(f"Loaded {len(users)} users")
        return users
    
    def _check_duplicate_name(self, name: str) -> bool:
        """
        Проверяет, существует ли пользователь с таким именем.
        
        Args:
            name: Имя для проверки
        
        Returns:
            bool: True если пользователь с таким именем существует, False иначе
        """
        existing_users = self.get_all_users()
        return any(user.name.lower() == name.lower() for user in existing_users)
    
    def _generate_user_id(self) -> str:
        """
        Генерирует уникальный user_id.
        
        Returns:
            str: Уникальный идентификатор пользователя
        """
        # Используем UUID для генерации уникального ID
        # Формат: user_<uuid4>
        unique_id = str(uuid.uuid4()).replace('-', '')[:12]  # Берем первые 12 символов
        user_id = f"user_{unique_id}"
        
        # Проверяем, что такого пользователя еще нет (на всякий случай)
        while (self.users_dir / user_id).exists():
            unique_id = str(uuid.uuid4()).replace('-', '')[:12]
            user_id = f"user_{unique_id}"
        
        return user_id
    
    def _initialize_user_data(self, user_id: str):
        """
        Создает начальные файлы progress.json и statistics.json для нового пользователя.
        
        Args:
            user_id: ID пользователя
        """
        user_dir = self.users_dir / user_id
        
        # Создаем progress.json с начальной структурой (v3.0)
        from datetime import datetime
        progress_data = {
            "version": "3.0",
            "user_id": user_id,
            "task_history": {},
            "mistake_bank": [],
            "global_stats": {
                "total_attempts": 0,
                "total_time_seconds": 0
            },
            "updated_at": datetime.now().isoformat()
        }
        
        # Валидируем перед сохранением
        errors = ProgressSchema.validate(progress_data)
        if errors:
            self.logger.error(f"Invalid progress data structure: {errors}")
            raise TaskValidationError(f"Invalid progress data structure: {errors}")
        
        progress_file = user_dir / "progress.json"
        with open(progress_file, 'w', encoding='utf-8') as f:
            json.dump(progress_data, f, ensure_ascii=False, indent=2)
        
        # Создаем statistics.json с начальной структурой
        statistics_data = {
            "total_tasks_attempted": 0,
            "total_tasks_completed": 0,
            "success_rate": 0.0,
            "by_task_type": {},
            "weak_areas": []
        }
        
        # Валидируем перед сохранением
        errors = StatisticsSchema.validate(statistics_data)
        if errors:
            self.logger.error(f"Invalid statistics data structure: {errors}")
            raise TaskValidationError(f"Invalid statistics data structure: {errors}")
        
        statistics_file = user_dir / "statistics.json"
        with open(statistics_file, 'w', encoding='utf-8') as f:
            json.dump(statistics_data, f, ensure_ascii=False, indent=2)
        
        # Создаем complex_statistics.json с начальной структурой
        complex_stats_data = {
            "complexes": {}
        }
        
        complex_stats_file = user_dir / "complex_statistics.json"
        with open(complex_stats_file, 'w', encoding='utf-8') as f:
            json.dump(complex_stats_data, f, ensure_ascii=False, indent=2)
        
        self.logger.debug(f"Initialized data files for user {user_id}")
    
    def delete_user(self, user_id: str) -> bool:
        """
        Удаляет пользователя и все его данные.
        
        Args:
            user_id: ID пользователя для удаления
        
        Returns:
            bool: True если удаление успешно, False если пользователь не найден
        
        Raises:
            ValueError: Если user_id пустой
        """
        if not user_id:
            raise ValueError("user_id не может быть пустым")
        
        user_dir = self.users_dir / user_id
        
        if not user_dir.exists():
            self.logger.warning(f"User directory not found for deletion: {user_id}")
            return False
        
        try:
            import shutil
            # Удаляем всю директорию пользователя
            shutil.rmtree(user_dir)
            
            # Удаляем данные календаря пользователя (хранятся отдельно)
            calendar_dir = self.data_dir / "user_calendar" / user_id
            if calendar_dir.exists():
                shutil.rmtree(calendar_dir)
                self.logger.info(f"Deleted calendar data for user: {user_id}")
            
            self.logger.info(f"Deleted user: {user_id}")
            return True
        
        except Exception as e:
            self.logger.error(f"Error deleting user {user_id}: {e}")
            return False

    def verify_password(self, user_id: str, password: str, auto_migrate: bool = True) -> bool:
        """
        Проверяет пароль пользователя (bcrypt или legacy SHA-256).
        
        При успешной верификации SHA-256 хеша автоматически мигрирует на bcrypt.
        
        Args:
            user_id: ID пользователя
            password: Пароль для проверки
            auto_migrate: Автоматически мигрировать SHA-256 → bcrypt
        
        Returns:
            bool: True если пароль верный, False иначе
        """
        import bcrypt
        import hashlib
        
        user = self.get_user(user_id)
        if not user or not user.password_hash:
            return not user or not user.password_hash  # True if no password set
        
        is_valid = False
        if user.password_hash.startswith('$2b$'):
            is_valid = bcrypt.checkpw(password.encode('utf-8'), user.password_hash.encode('utf-8'))
        else:
            hashed = hashlib.sha256(password.encode()).hexdigest()
            is_valid = (hashed == user.password_hash)
            if is_valid and auto_migrate:
                user.password_hash = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
                self.update_user(user)
                self.logger.info(f"Auto-migrated password hash to bcrypt for user {user_id}")
        
        return is_valid

    def update_user(self, user: User) -> bool:
        """
        Обновляет данные существующего пользователя.
        
        Args:
            user: Объект пользователя с обновленными данными
            
        Returns:
            bool: True если обновление успешно, False иначе
        """
        user_dir = self.users_dir / user.user_id
        if not user_dir.exists():
            self.logger.warning(f"User directory not found: {user.user_id}")
            return False
            
        profile_file = user_dir / "profile.json"
        profile_data = user.to_dict()
        
        # Валидация данных перед сохранением
        try:
            ProfileSchema.validate_or_raise(profile_data)
        except Exception as e:
            self.logger.error(f"Validation failed for user {user.user_id}: {e}")
            return False
        
        # Атомарная запись с использованием временного файла
        temp_name = None
        try:
            with tempfile.NamedTemporaryFile(
                mode='w',
                dir=str(user_dir),
                delete=False,
                encoding='utf-8',
                suffix='.tmp'
            ) as tf:
                json.dump(profile_data, tf, ensure_ascii=False, indent=2)
                temp_name = tf.name
            
            # Атомарная замена файла
            os.replace(temp_name, str(profile_file))
            self.logger.info(f"Updated user profile: {user.user_id}")
            return True
            
        except Exception as e:
            self.logger.error(f"Failed to update user {user.user_id}: {e}")
            # Очистка временного файла в случае ошибки
            if temp_name and os.path.exists(temp_name):
                try:
                    os.remove(temp_name)
                except Exception:
                    pass
            return False
