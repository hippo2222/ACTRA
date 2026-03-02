# Railway Hobby Migration Roadmap для ACTRA

**Платформа:** Railway Hobby ($5/месяц)  
**Дата создания:** 3 марта 2026  
**Статус:** Ready to execute  
**Оценка:** 6-8 недель full-time работы  

---

## 📋 Содержание

1. [Pre-migration подготовка (1-2 недели)](#phase-1)
2. [Database миграция (2-3 недели)](#phase-2)
3. [Backend адаптация (1-2 недели)](#phase-3)
4. [Deployment & тестирование (1 неделя)](#phase-4)
5. [Production launch (1 неделя)](#phase-5)

---

## <a name="phase-1"></a>Phase 1: Pre-migration подготовка (1-2 недели)

### ✅ Шаг 1.1: Настройка Railway проекта

**Цель:** Создать Railway workspace и сервисы.

**Действия:**
```bash
# 1. Зарегистрироваться на Railway.app
# 2. Создать новый проект "ACTRA Production"
# 3. Подключить GitHub репозиторий hippo2222/ACTRA
# 4. Выбрать ветку для деплоя (например, main или production)
```

**Railway сервисы для создания:**
- ✅ **Web Service** (Flask backend) — main application
- ✅ **PostgreSQL Database** — primary data store
- ⚠️ **Redis** (опционально) — для sessions/cache, если нужно

**Переменные окружения для Railway:**
```bash
# Database (Railway auto-provides DATABASE_URL)
DATABASE_URL=${RAILWAY_PROVIDED_DATABASE_URL}

# Flask settings
FLASK_ENV=production
SECRET_KEY=<generate-with-secrets.token_hex(32)>

# Application paths
DATA_ROOT=/app/data  # Will be in-memory or use volume
TASK_SYSTEM_ROOT=/app/task_system

# Feature flags
AI_GENERATION_ENABLED=true
CALENDAR_ENABLED=true
```

**Стоимость:**
- Web service: ~$3-4/мес (при низкой нагрузке)
- PostgreSQL: ~$1-2/мес (256MB-1GB)
- **Итого:** Влезет в $5/мес + немного сверху

---

### ✅ Шаг 1.2: Database Schema Design

**Цель:** Спроектировать PostgreSQL схему для замены JSON файлов.

**Создать файл:** `database/schema.sql`

```sql
-- ============================================================================
-- ACTRA PostgreSQL Schema v1.0
-- Миграция с файловой системы (JSON) на PostgreSQL
-- ============================================================================

-- Users table (заменяет data/users/{user_id}/*.json)
CREATE TABLE users (
    user_id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE,
    password_hash VARCHAR(255),  -- bcrypt hash
    avatar_path VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    settings JSONB DEFAULT '{}'::jsonb  -- Гибкие настройки пользователя
);

CREATE INDEX idx_users_email ON users(email);

-- ============================================================================
-- Modules, Topics, Tasks (заменяет data/modules/)
-- ============================================================================

CREATE TABLE modules (
    module_id VARCHAR(255) PRIMARY KEY,
    title VARCHAR(500) NOT NULL,
    description TEXT,
    icon VARCHAR(100),
    order_index INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE topics (
    topic_id VARCHAR(255) PRIMARY KEY,
    module_id VARCHAR(255) NOT NULL REFERENCES modules(module_id) ON DELETE CASCADE,
    title VARCHAR(500) NOT NULL,
    description TEXT,
    order_index INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_topics_module ON topics(module_id);

CREATE TABLE tasks (
    task_id VARCHAR(255) PRIMARY KEY,
    module_id VARCHAR(255) NOT NULL,
    topic_id VARCHAR(255) NOT NULL REFERENCES topics(topic_id) ON DELETE CASCADE,
    task_type VARCHAR(50) NOT NULL,  -- 'click', 'draw', 'test', etc.
    title VARCHAR(500) NOT NULL,
    question TEXT,
    
    -- Task data stored as JSONB (flexible schema per type)
    answer_key JSONB NOT NULL,      -- Правильный ответ
    task_data JSONB DEFAULT '{}'::jsonb,  -- Дополнительные данные задания
    
    -- Images (paths or URLs)
    image_path VARCHAR(1000),
    
    -- Metadata
    difficulty INTEGER DEFAULT 1,   -- 1-5
    tags TEXT[],                     -- Array of tags
    order_index INTEGER DEFAULT 0,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_tasks_topic ON tasks(topic_id);
CREATE INDEX idx_tasks_type ON tasks(task_type);
CREATE INDEX idx_tasks_difficulty ON tasks(difficulty);

-- ============================================================================
-- User Progress (заменяет data/users/{user_id}/progress.json)
-- ============================================================================

CREATE TABLE user_progress (
    id BIGSERIAL PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    task_id VARCHAR(255) NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
    
    -- Progress metrics
    attempts INTEGER DEFAULT 0,
    correct_attempts INTEGER DEFAULT 0,
    last_attempt_correct BOOLEAN,
    
    -- Difficulty tracking
    current_difficulty INTEGER DEFAULT 1,
    difficulty_history JSONB DEFAULT '[]'::jsonb,  -- История изменений
    
    -- Timestamps
    first_attempt_at TIMESTAMP,
    last_attempt_at TIMESTAMP,
    next_review_at TIMESTAMP,  -- Для spaced repetition
    
    -- Additional metadata
    metadata JSONB DEFAULT '{}'::jsonb,
    
    UNIQUE(user_id, task_id)
);

CREATE INDEX idx_user_progress_user ON user_progress(user_id);
CREATE INDEX idx_user_progress_task ON user_progress(task_id);
CREATE INDEX idx_user_progress_review ON user_progress(next_review_at) WHERE next_review_at IS NOT NULL;

-- ============================================================================
-- Task Attempts (детальная история попыток)
-- ============================================================================

CREATE TABLE task_attempts (
    id BIGSERIAL PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    task_id VARCHAR(255) NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
    
    -- Attempt data
    user_answer JSONB NOT NULL,      -- Ответ пользователя
    is_correct BOOLEAN NOT NULL,
    score DECIMAL(5,2),              -- 0-100 или custom metric
    
    -- Context
    session_id VARCHAR(255),         -- ID сессии (если есть)
    attempt_number INTEGER,          -- Порядковый номер попытки для задания
    
    -- Timing
    time_spent_seconds INTEGER,     -- Время на выполнение
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Evaluation details
    evaluation_details JSONB DEFAULT '{}'::jsonb  -- Детали оценки
);

CREATE INDEX idx_attempts_user ON task_attempts(user_id);
CREATE INDEX idx_attempts_task ON task_attempts(task_id);
CREATE INDEX idx_attempts_session ON task_attempts(session_id);
CREATE INDEX idx_attempts_created ON task_attempts(created_at);

-- ============================================================================
-- Complexes (заменяет data/complexes/)
-- ============================================================================

CREATE TABLE complexes (
    complex_id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(500) NOT NULL,
    description TEXT,
    creator_user_id VARCHAR(255) REFERENCES users(user_id),
    
    -- Complex configuration
    task_ids TEXT[] NOT NULL,        -- Упорядоченный массив task_id
    settings JSONB DEFAULT '{}'::jsonb,
    
    -- Versioning
    version INTEGER DEFAULT 1,
    parent_complex_id VARCHAR(255) REFERENCES complexes(complex_id),  -- Для версионирования
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_complexes_creator ON complexes(creator_user_id);

-- ============================================================================
-- Complex Sessions (активные сессии прохождения)
-- ============================================================================

CREATE TABLE complex_sessions (
    session_id VARCHAR(255) PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    complex_id VARCHAR(255) NOT NULL REFERENCES complexes(complex_id),
    
    -- Session state
    current_task_index INTEGER DEFAULT 0,
    completed BOOLEAN DEFAULT FALSE,
    
    -- Progress tracking
    correct_count INTEGER DEFAULT 0,
    total_count INTEGER DEFAULT 0,
    
    -- Session data (flexible)
    session_data JSONB DEFAULT '{}'::jsonb,
    
    -- Timestamps
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    last_activity_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_sessions_user ON complex_sessions(user_id);
CREATE INDEX idx_sessions_complex ON complex_sessions(complex_id);
CREATE INDEX idx_sessions_active ON complex_sessions(completed) WHERE completed = FALSE;

-- ============================================================================
-- Theories (заменяет data/complexes/theories/)
-- ============================================================================

CREATE TABLE theories (
    theory_id VARCHAR(255) PRIMARY KEY,
    complex_id VARCHAR(255) NOT NULL REFERENCES complexes(complex_id) ON DELETE CASCADE,
    
    -- Content (Delta format from Quill editor)
    content JSONB NOT NULL,          -- Delta format
    
    -- Versioning
    version INTEGER DEFAULT 1,
    parent_theory_id VARCHAR(255) REFERENCES theories(theory_id),
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_theories_complex ON theories(complex_id);

-- ============================================================================
-- Calendar & Health Score (заменяет data/user_calendar/)
-- ============================================================================

CREATE TABLE user_calendar_activities (
    id BIGSERIAL PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    activity_date DATE NOT NULL,
    
    -- Activity metrics
    tasks_completed INTEGER DEFAULT 0,
    session_time_minutes INTEGER DEFAULT 0,
    health_score DECIMAL(5,2),       -- 0-100
    
    -- Activity details
    activity_data JSONB DEFAULT '{}'::jsonb,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(user_id, activity_date)
);

CREATE INDEX idx_calendar_user_date ON user_calendar_activities(user_id, activity_date);

-- ============================================================================
-- Microcards (для микрокарточек, если используются)
-- ============================================================================

CREATE TABLE microcards (
    card_id VARCHAR(255) PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    
    -- Card content
    front TEXT NOT NULL,
    back TEXT NOT NULL,
    
    -- Spaced repetition
    ease_factor DECIMAL(5,2) DEFAULT 2.5,
    interval_days INTEGER DEFAULT 1,
    repetitions INTEGER DEFAULT 0,
    last_reviewed_at TIMESTAMP,
    next_review_at TIMESTAMP,
    
    -- Metadata
    tags TEXT[],
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_microcards_user ON microcards(user_id);
CREATE INDEX idx_microcards_review ON microcards(next_review_at) WHERE next_review_at IS NOT NULL;

-- ============================================================================
-- App State (заменяет data/app_state.json)
-- ============================================================================

CREATE TABLE app_state (
    key VARCHAR(255) PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- AI Runs (заменяет data/ai_runs/)
-- ============================================================================

CREATE TABLE ai_runs (
    run_id VARCHAR(255) PRIMARY KEY,
    run_type VARCHAR(50) NOT NULL,   -- 'generation', 'analysis', 'import'
    
    -- Input/Output
    input_data JSONB,
    output_data JSONB,
    
    -- Status
    status VARCHAR(50) DEFAULT 'pending',  -- pending, running, completed, failed
    error_message TEXT,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

CREATE INDEX idx_ai_runs_type ON ai_runs(run_type);
CREATE INDEX idx_ai_runs_status ON ai_runs(status);
CREATE INDEX idx_ai_runs_created ON ai_runs(created_at);

-- ============================================================================
-- Functions & Triggers
-- ============================================================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to tables with updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tasks_updated_at BEFORE UPDATE ON tasks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_complexes_updated_at BEFORE UPDATE ON complexes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_theories_updated_at BEFORE UPDATE ON theories
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_calendar_updated_at BEFORE UPDATE ON user_calendar_activities
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_microcards_updated_at BEFORE UPDATE ON microcards
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Initial Data (можно добавить default пользователя и т.д.)
-- ============================================================================

-- Default user (если нужен)
INSERT INTO users (user_id, name, email) 
VALUES ('default_user', 'Default User', 'default@actra.local')
ON CONFLICT (user_id) DO NOTHING;

-- App state initialization
INSERT INTO app_state (key, value) 
VALUES ('last_user_id', '"default_user"'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

COMMIT;
```

**Что учтено:**
- ✅ Индексы для частых запросов
- ✅ Foreign keys для integrity
- ✅ JSONB для гибких данных (answer_key, task_data)
- ✅ Триггеры для auto-update timestamps
- ✅ Versioning для complexes и theories

---

### ✅ Шаг 1.3: Создать Railway конфигурацию

**Файл:** `railway.json` (в корне проекта)

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS",
    "buildCommand": "pip install -e '.[dev]' && npm install && npm run build:css"
  },
  "deploy": {
    "startCommand": "cd desktop-app && python server.py",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
```

**Файл:** `Procfile` (для Railway/Heroku-style deploy)

```
web: cd desktop-app && python server.py
```

**Файл:** `runtime.txt`

```
python-3.11
```

---

### ✅ Шаг 1.4: Подготовить `.railwayignore`

```
# Railway ignore (аналог .dockerignore)
.git/
.github/
.venv/
venv/
__pycache__/
*.pyc
*.pyo
*.pyd
.pytest_cache/
.mypy_cache/
node_modules/
.vscode/
.idea/

# Local development files
data/users/
data/ai_runs/
data/images/
data/feedback/
data/telemetry/
logs/
*.log

# Build artifacts
dist/
build/
*.egg-info/

# Documentation
docs/*.pdf
reports/
```

---

## <a name="phase-2"></a>Phase 2: Database Migration (2-3 недели)

### ✅ Шаг 2.1: Создать Database Adapter Layer

**Цель:** Абстрагировать работу с БД от бизнес-логики.

**Создать:** `desktop-app/services/database/`

```
database/
├── __init__.py
├── connection.py       # Database connection pool
├── repositories/       # Data access layer
│   ├── __init__.py
│   ├── user_repository.py
│   ├── task_repository.py
│   ├── progress_repository.py
│   ├── complex_repository.py
│   └── theory_repository.py
└── migrations/         # Migration scripts
    ├── __init__.py
    ├── migrate_users.py
    ├── migrate_tasks.py
    └── migrate_progress.py
```

**Файл:** `desktop-app/services/database/connection.py`

```python
"""Database connection management for PostgreSQL."""

import os
import logging
from typing import Optional
import psycopg2
from psycopg2 import pool
from contextlib import contextmanager

logger = logging.getLogger(__name__)


class DatabaseConnection:
    """Singleton database connection pool."""
    
    _instance: Optional['DatabaseConnection'] = None
    _pool: Optional[pool.ThreadedConnectionPool] = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance
    
    def __init__(self):
        if self._pool is None:
            self._initialize_pool()
    
    def _initialize_pool(self):
        """Initialize connection pool from environment."""
        database_url = os.environ.get('DATABASE_URL')
        if not database_url:
            raise ValueError("DATABASE_URL environment variable not set")
        
        # Railway provides postgres:// but psycopg2 needs postgresql://
        if database_url.startswith('postgres://'):
            database_url = database_url.replace('postgres://', 'postgresql://', 1)
        
        try:
            self._pool = pool.ThreadedConnectionPool(
                minconn=1,
                maxconn=10,
                dsn=database_url
            )
            logger.info("Database connection pool initialized")
        except Exception as e:
            logger.error(f"Failed to initialize database pool: {e}")
            raise
    
    @contextmanager
    def get_connection(self):
        """Get a connection from pool (context manager)."""
        conn = self._pool.getconn()
        try:
            yield conn
            conn.commit()
        except Exception as e:
            conn.rollback()
            raise
        finally:
            self._pool.putconn(conn)
    
    @contextmanager
    def get_cursor(self, commit=True):
        """Get a cursor (context manager)."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            try:
                yield cursor
                if commit:
                    conn.commit()
            except Exception as e:
                conn.rollback()
                raise
            finally:
                cursor.close()


# Singleton instance
db = DatabaseConnection()
```

---

### ✅ Шаг 2.2: Создать Repository паттерн для каждого сервиса

**Пример:** `desktop-app/services/database/repositories/user_repository.py`

```python
"""User repository for database operations."""

import json
from typing import Optional, List, Dict, Any
from datetime import datetime
from ..connection import db


class UserRepository:
    """Data access layer for users table."""
    
    def create_user(self, user_id: str, name: str, email: Optional[str] = None, 
                   password_hash: Optional[str] = None) -> Dict[str, Any]:
        """Create a new user."""
        with db.get_cursor() as cursor:
            cursor.execute("""
                INSERT INTO users (user_id, name, email, password_hash, created_at)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING user_id, name, email, created_at
            """, (user_id, name, email, password_hash, datetime.utcnow()))
            
            row = cursor.fetchone()
            return {
                'user_id': row[0],
                'name': row[1],
                'email': row[2],
                'created_at': row[3]
            }
    
    def get_user(self, user_id: str) -> Optional[Dict[str, Any]]:
        """Get user by ID."""
        with db.get_cursor(commit=False) as cursor:
            cursor.execute("""
                SELECT user_id, name, email, avatar_path, settings, created_at, updated_at
                FROM users
                WHERE user_id = %s
            """, (user_id,))
            
            row = cursor.fetchone()
            if not row:
                return None
            
            return {
                'user_id': row[0],
                'name': row[1],
                'email': row[2],
                'avatar_path': row[3],
                'settings': row[4],  # Already parsed from JSONB
                'created_at': row[5],
                'updated_at': row[6]
            }
    
    def get_all_users(self) -> List[Dict[str, Any]]:
        """Get all users."""
        with db.get_cursor(commit=False) as cursor:
            cursor.execute("""
                SELECT user_id, name, email, avatar_path, created_at
                FROM users
                ORDER BY created_at DESC
            """)
            
            rows = cursor.fetchall()
            return [
                {
                    'user_id': row[0],
                    'name': row[1],
                    'email': row[2],
                    'avatar_path': row[3],
                    'created_at': row[4]
                }
                for row in rows
            ]
    
    def update_user(self, user_id: str, **kwargs) -> bool:
        """Update user fields."""
        allowed_fields = {'name', 'email', 'avatar_path', 'settings'}
        updates = {k: v for k, v in kwargs.items() if k in allowed_fields}
        
        if not updates:
            return False
        
        set_clause = ', '.join(f"{k} = %s" for k in updates.keys())
        values = list(updates.values()) + [user_id]
        
        with db.get_cursor() as cursor:
            cursor.execute(f"""
                UPDATE users
                SET {set_clause}, updated_at = CURRENT_TIMESTAMP
                WHERE user_id = %s
            """, values)
            
            return cursor.rowcount > 0
    
    def delete_user(self, user_id: str) -> bool:
        """Delete user (cascade deletes progress, sessions, etc.)."""
        with db.get_cursor() as cursor:
            cursor.execute("DELETE FROM users WHERE user_id = %s", (user_id,))
            return cursor.rowcount > 0
```

**Аналогично создать:**
- `task_repository.py` (для modules/topics/tasks)
- `progress_repository.py` (для user_progress, task_attempts)
- `complex_repository.py` (для complexes, complex_sessions)
- `theory_repository.py` (для theories)

---

### ✅ Шаг 2.3: Рефакторинг существующих сервисов

**Пример:** Обновить `UserService` для работы с БД

**БЫЛО (файловая система):**
```python
# desktop-app/services/user_service.py
class UserService:
    def get_user(self, user_id: str):
        path = self.data_dir / "users" / user_id / "profile.json"
        with open(path, 'r') as f:
            return json.load(f)
```

**СТАЛО (PostgreSQL):**
```python
# desktop-app/services/user_service.py
from .database.repositories import UserRepository

class UserService:
    def __init__(self, data_dir: str = None):
        # data_dir больше не используется для users
        self.user_repo = UserRepository()
    
    def get_user(self, user_id: str):
        return self.user_repo.get_user(user_id)
    
    def create_user(self, user_id: str, name: str, email: str = None):
        return self.user_repo.create_user(user_id, name, email)
```

**Оценка работы:**
- UserService: 1 день
- ProgressService: 3-4 дня
- StorageService: 5-7 дней (самый сложный)
- ComplexService: 2-3 дня
- TheoryService: 1-2 дня
- CalendarService: 2-3 дня

**Итого:** ~2-3 недели

---

### ✅ Шаг 2.4: Написать миграционные скрипты

**Цель:** Перенести данные из JSON в PostgreSQL.

**Файл:** `scripts/migrate_to_postgresql.py`

```python
"""Migrate data from JSON files to PostgreSQL database."""

import json
import sys
from pathlib import Path
from datetime import datetime

# Add project paths
sys.path.insert(0, str(Path(__file__).parent.parent / "desktop-app"))

from services.database.connection import db
from services.database.repositories import (
    UserRepository,
    TaskRepository,
    ProgressRepository,
    ComplexRepository
)

# Import old StorageService for reading JSON
from services.storage_service import StorageService


def migrate_users(data_dir: Path):
    """Migrate users from data/users/ to database."""
    print("Migrating users...")
    user_repo = UserRepository()
    users_dir = data_dir / "users"
    
    if not users_dir.exists():
        print("No users directory found, skipping")
        return
    
    for user_dir in users_dir.iterdir():
        if not user_dir.is_dir():
            continue
        
        user_id = user_dir.name
        profile_path = user_dir / "profile.json"
        
        if not profile_path.exists():
            print(f"Skipping {user_id} (no profile.json)")
            continue
        
        with open(profile_path, 'r', encoding='utf-8') as f:
            profile = json.load(f)
        
        try:
            user_repo.create_user(
                user_id=user_id,
                name=profile.get('name', user_id),
                email=profile.get('email')
            )
            print(f"✓ Migrated user: {user_id}")
        except Exception as e:
            print(f"✗ Failed to migrate user {user_id}: {e}")


def migrate_modules_and_tasks(data_dir: Path):
    """Migrate modules, topics, tasks from data/modules/ to database."""
    print("\nMigrating modules and tasks...")
    storage = StorageService(data_dir)
    task_repo = TaskRepository()
    
    try:
        modules = storage.load_modules()
    except Exception as e:
        print(f"Failed to load modules: {e}")
        return
    
    for module in modules:
        module_id = module['id']
        
        # Create module
        try:
            task_repo.create_module(
                module_id=module_id,
                title=module.get('title', module_id),
                description=module.get('description', ''),
                icon=module.get('icon'),
                order_index=module.get('order', 0)
            )
            print(f"✓ Created module: {module_id}")
        except Exception as e:
            print(f"✗ Failed to create module {module_id}: {e}")
            continue
        
        # Migrate topics and tasks
        topics = storage.get_topics(module_id)
        for topic in topics:
            topic_id = topic['id']
            
            try:
                task_repo.create_topic(
                    topic_id=topic_id,
                    module_id=module_id,
                    title=topic.get('title', topic_id),
                    description=topic.get('description', ''),
                    order_index=topic.get('order', 0)
                )
                print(f"  ✓ Created topic: {topic_id}")
            except Exception as e:
                print(f"  ✗ Failed to create topic {topic_id}: {e}")
                continue
            
            # Migrate tasks
            tasks = storage.get_tasks(module_id, topic_id)
            for task_meta in tasks:
                task_id = task_meta['id']
                
                try:
                    task = storage.load_task(module_id, topic_id, task_id)
                    
                    task_repo.create_task(
                        task_id=task_id,
                        module_id=module_id,
                        topic_id=topic_id,
                        task_type=task.get('type', 'unknown'),
                        title=task.get('title', task_id),
                        question=task.get('question', ''),
                        answer_key=task.get('answer_key', {}),
                        task_data={
                            'options': task.get('options', []),
                            'images': task.get('images', []),
                            # ... other task-specific fields
                        },
                        image_path=task.get('image'),
                        difficulty=task.get('difficulty', 1),
                        tags=task.get('tags', [])
                    )
                    print(f"    ✓ Migrated task: {task_id}")
                except Exception as e:
                    print(f"    ✗ Failed to migrate task {task_id}: {e}")


def migrate_user_progress(data_dir: Path):
    """Migrate user progress from data/users/{user_id}/progress.json to database."""
    print("\nMigrating user progress...")
    progress_repo = ProgressRepository()
    users_dir = data_dir / "users"
    
    for user_dir in users_dir.iterdir():
        if not user_dir.is_dir():
            continue
        
        user_id = user_dir.name
        progress_path = user_dir / "progress.json"
        
        if not progress_path.exists():
            continue
        
        with open(progress_path, 'r', encoding='utf-8') as f:
            progress_data = json.load(f)
        
        for task_id, task_progress in progress_data.get('tasks', {}).items():
            try:
                progress_repo.upsert_progress(
                    user_id=user_id,
                    task_id=task_id,
                    attempts=task_progress.get('attempts', 0),
                    correct_attempts=task_progress.get('correct', 0),
                    last_attempt_correct=task_progress.get('last_correct', False),
                    current_difficulty=task_progress.get('difficulty', 1),
                    last_attempt_at=task_progress.get('last_attempt')
                )
            except Exception as e:
                print(f"✗ Failed to migrate progress for {user_id}/{task_id}: {e}")
        
        print(f"✓ Migrated progress for user: {user_id}")


def main():
    """Run all migrations."""
    import os
    
    # Ensure DATABASE_URL is set
    if 'DATABASE_URL' not in os.environ:
        print("ERROR: DATABASE_URL environment variable not set")
        print("Set it to your Railway PostgreSQL connection string")
        sys.exit(1)
    
    # Get data directory
    data_dir = Path(__file__).parent.parent / "data"
    if not data_dir.exists():
        print(f"ERROR: Data directory not found: {data_dir}")
        sys.exit(1)
    
    print(f"Starting migration from {data_dir}")
    print("=" * 60)
    
    # Run migrations in order
    migrate_users(data_dir)
    migrate_modules_and_tasks(data_dir)
    migrate_user_progress(data_dir)
    
    print("\n" + "=" * 60)
    print("Migration completed!")
    print("\nIMPORTANT: Verify data in database before deleting JSON files")


if __name__ == '__main__':
    main()
```

**Запуск миграции:**
```bash
# 1. Set DATABASE_URL from Railway
export DATABASE_URL="postgresql://user:pass@host:port/dbname"

# 2. Run migration
python scripts/migrate_to_postgresql.py

# 3. Verify data in database
# (используйте Railway dashboard или pgAdmin)
```

---

## <a name="phase-3"></a>Phase 3: Backend Адаптация (1-2 недели)

### ✅ Шаг 3.1: Обновить `server.py` для Railway

**Изменения в `desktop-app/server.py`:**

```python
# ДОБАВИТЬ в начало файла
import os

# Database initialization
from services.database.connection import db

# Проверка DATABASE_URL
if 'DATABASE_URL' not in os.environ:
    logger.warning("DATABASE_URL not set - running in local file mode")
    USE_DATABASE = False
else:
    logger.info("DATABASE_URL found - using PostgreSQL database")
    USE_DATABASE = True
    
    # Initialize database connection
    try:
        db._initialize_pool()
        logger.info("Database connection pool ready")
    except Exception as e:
        logger.error(f"Failed to initialize database: {e}")
        sys.exit(1)
```

---

### ✅ Шаг 3.2: Обновить остальные сервисы

**Обновить все сервисы в `desktop-app/services/`:**
- ProgressService → use ProgressRepository
- StorageService → use TaskRepository + ModuleRepository
- ComplexService → use ComplexRepository
- TheoryService → use TheoryRepository
- CalendarService → use CalendarRepository
- StatisticsService → query from database

**Паттерн:**
```python
# OLD
class XService:
    def __init__(self, data_dir):
        self.data_dir = Path(data_dir)
    
    def load_data(self):
        with open(self.data_dir / "file.json") as f:
            return json.load(f)

# NEW
from .database.repositories import XRepository

class XService:
    def __init__(self, data_dir=None):
        self.repo = XRepository()
    
    def load_data(self):
        return self.repo.get_all()
```

---

### ✅ Шаг 3.3: Обработка статических файлов (изображения)

**Проблема:** `data/images/` больше не на файловой системе.

**Решение:**
1. **Railway Volumes** (persistent storage) — $0.20/GB/месяц
2. **Railway Blob Storage** (S3-compatible)
3. **Vercel Blob** (отдельно от Railway)
4. **Cloudflare R2** (S3-compatible, бесплатно 10GB)

**Рекомендация:** **Railway Volumes** (проще интеграция)

**Обновить `server.py`:**
```python
# Вместо
IMAGE_DIR = PROJECT_ROOT / "data" / "images"

# Использовать
IMAGE_DIR = Path(os.environ.get('IMAGE_STORAGE_PATH', '/data/images'))
```

**В Railway settings → Variables:**
```
IMAGE_STORAGE_PATH=/data/images
```

**В Railway settings → Volumes:**
```
Mount path: /data
```

---

## <a name="phase-4"></a>Phase 4: Deployment & Тестирование (1 неделя)

### ✅ Шаг 4.1: Первый деплой на Railway

**Действия:**
1. Push код в GitHub branch
2. Railway auto-deploy (если настроен)
3. Проверить логи деплоя
4. Запустить database schema:
   ```bash
   # In Railway dashboard → Database → Query
   # Paste schema.sql and execute
   ```

**Проверка:**
```bash
# Railway CLI
railway run python scripts/check_database.py
```

---

### ✅ Шаг 4.2: Smoke tests

**Создать:** `scripts/smoke_test_production.py`

```python
"""Smoke tests for production Railway deployment."""

import requests
import sys

BASE_URL = "https://your-app.railway.app"  # Railway предоставит URL

def test_health():
    """Test /api/health endpoint."""
    r = requests.get(f"{BASE_URL}/api/health")
    assert r.status_code == 200
    assert r.json()['ok'] is True
    print("✓ Health check passed")

def test_users():
    """Test users API."""
    r = requests.get(f"{BASE_URL}/api/users")
    assert r.status_code == 200
    users = r.json().get('users', [])
    print(f"✓ Users API works ({len(users)} users)")

def test_modules():
    """Test modules API."""
    r = requests.get(f"{BASE_URL}/api/modules")
    assert r.status_code == 200
    modules = r.json().get('modules', [])
    print(f"✓ Modules API works ({len(modules)} modules)")

if __name__ == '__main__':
    try:
        test_health()
        test_users()
        test_modules()
        print("\n✅ All smoke tests passed!")
    except Exception as e:
        print(f"\n❌ Smoke test failed: {e}")
        sys.exit(1)
```

---

## <a name="phase-5"></a>Phase 5: Production Launch (1 неделя)

### ✅ Шаг 5.1: Performance optimization

**PostgreSQL indexes:**
```sql
-- Add after initial testing
CREATE INDEX CONCURRENTLY idx_tasks_module_topic ON tasks(module_id, topic_id);
CREATE INDEX CONCURRENTLY idx_progress_user_task ON user_progress(user_id, task_id);
```

**Connection pooling tuning:**
```python
# В connection.py
self._pool = pool.ThreadedConnectionPool(
    minconn=2,      # Минимум соединений
    maxconn=20,     # Максимум (Railway Hobby поддерживает)
    dsn=database_url
)
```

---

### ✅ Шаг 5.2: Monitoring setup

**Railway Dashboard:**
- ✅ Enable metrics (CPU, Memory, Network)
- ✅ Set up alerts (> 80% memory, > 90% CPU)
- ✅ Monitor database size

**Application logging:**
```python
# В server.py
import logging
logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] %(levelname)s in %(module)s: %(message)s'
)
```

---

## 📋 Pre-launch Checklist

### Database
- [ ] Schema applied to production database
- [ ] All indices created
- [ ] Data migrated from JSON
- [ ] Backup strategy in place

### Code
- [ ] All services use database repositories
- [ ] No hardcoded file paths
- [ ] Environment variables configured
- [ ] Error handling for database failures

### Testing
- [ ] All unit tests pass
- [ ] Integration tests pass
- [ ] Smoke tests on Railway deployment
- [ ] Load testing (basic)

### Railway Configuration
- [ ] PostgreSQL provisioned
- [ ] Environment variables set
- [ ] Volumes configured (if needed)
- [ ] Custom domain (optional)

### Monitoring
- [ ] Logging enabled
- [ ] Metrics visible in dashboard
- [ ] Alerts configured

---

## 🚀 Launch Day Commands

```bash
# 1. Final migration
python scripts/migrate_to_postgresql.py

# 2. Deploy to Railway
git push origin main  # Auto-deploys if configured

# 3. Run smoke tests
python scripts/smoke_test_production.py

# 4. Monitor logs
railway logs --follow

# 5. Check database
railway run psql $DATABASE_URL -c "SELECT COUNT(*) FROM users;"
```

---

## 💰 Cost Estimation

**Railway Hobby ($5/месяц включает credits):**
- Web service: ~$2-3/мес
- PostgreSQL (1GB): ~$1/мес
- Egress bandwidth: ~$0.5/мес
- **Total:** ~$3-4/мес usage (влезает в $5 credit)

**Если превысит $5:**
- Pay-as-you-go: дополнительно $0.10/GB RAM-hour, $0.10/GB egress

---

## 🛠️ Troubleshooting

### "DATABASE_URL not set"
→ Проверить Railway Environment Variables

### "Connection pool exhausted"
→ Увеличить `maxconn` в connection.py

### "Out of memory"
→ Оптимизировать queries (LIMIT, pagination)

### "Slow queries"
→ Добавить индексы, использовать EXPLAIN ANALYZE

---

## 📚 Дополнительные ресурсы

- [Railway Documentation](https://docs.railway.app/)
- [PostgreSQL Best Practices](https://wiki.postgresql.org/wiki/Don%27t_Do_This)
- [psycopg2 Documentation](https://www.psycopg.org/docs/)
- [Flask + PostgreSQL Tutorial](https://flask.palletsprojects.com/en/2.3.x/patterns/sqlalchemy/)

---

**Готово к выполнению!** 🎉  
**Автор:** Cascade AI  
**Дата:** 3 марта 2026
