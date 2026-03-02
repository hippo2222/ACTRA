# Анализ возможности миграции ACTRA на веб-платформу (Vercel)

**Дата анализа:** 2 марта 2026  
**Ветка:** feature/web-platform-migration-analysis  
**Автор:** Cascade AI Analysis  

---

## 📊 Executive Summary

### Вердикт: **ВОЗМОЖНО с существенными доработками**

Миграция проекта ACTRA с настольного приложения на полноценную веб-платформу технически **осуществима**, но требует **значительного рефакторинга** (оценка: 3-6 месяцев работы). Использование бесплатного tier Vercel **возможно для MVP**, но с серьёзными **ограничениями функциональности**.

**Ключевые выводы:**
- ✅ **Frontend** уже готов к веб-деплою (HTML/CSS/JS)
- ✅ **Backend API** на Flask легко адаптируется
- ⚠️ **Файловая система** требует замены на БД
- ⚠️ **Stateful операции** нужно переделать под serverless
- ❌ **PyWebView** не применим в вебе (очевидно)
- ❌ **AI-генерация с PDF** превысит лимиты Vercel Free

---

## 1. Текущая архитектура проекта

### 1.1 Технологический стек

**Backend:**
- Python 3.10+ (Flask 3.0)
- Зависимости: PyWebView, Pillow, PyMuPDF, bcrypt, Levenshtein
- Архитектура: Монолитный сервер + локальная файловая система

**Frontend:**
- Vanilla JavaScript (ES6+)
- Tailwind CSS 3.4
- HTML5 UI screens (модульная структура)

**Данные:**
- Файловая система (JSON)
- Структура: `data/users/{user_id}/*.json`, `data/modules/`, `data/complexes/`
- Нет БД (SQLite, PostgreSQL, etc.)

### 1.2 Ключевые сервисы

Проект имеет **28+ сервисов**, работающих с файловой системой:

| Сервис | Файловые операции | Критичность для веба |
|--------|-------------------|---------------------|
| `StorageService` | 73 операции r/w JSON | 🔴 Критично |
| `UserService` | 31 операция (users/*.json) | 🔴 Критично |
| `ProgressService` | Запись прогресса | 🔴 Критично |
| `ComplexService` | Комплексы заданий | 🟡 Средне |
| `TheoryService` | 30 операций (Delta-формат) | 🟡 Средне |
| `CalendarService` | Календарь занятий | 🟡 Средне |
| `StatisticsService` | Агрегация метрик | 🟢 Низко |
| `AIGenerationService` | PDF обработка + AI | 🔴 Критично (лимиты) |

**Вывод:** ~400+ мест в коде напрямую работают с `Path()`, `open()`, `.json`.

---

## 2. Анализ совместимости с Vercel

### 2.1 Vercel Free Tier ограничения (из скриншота)

| Метрика | Лимит (30 дней) | Оценка достаточности |
|---------|-----------------|---------------------|
| **Edge Requests** | 4.2K / 1M | ✅ Достаточно для MVP (100 req/день) |
| **Fast Data Transfer** | 175 MB / 100 GB | ⚠️ Может не хватить (PDF + изображения) |
| **Fluid Active CPU** | 6s / 4h | ❌ **КРИТИЧНО: AI-генерация невозможна** |
| **Function Invocations** | 77 / 1M | ✅ Достаточно |
| **ISR Reads** | 242 / 1M | ✅ Достаточно (если используем ISR) |
| **Image Optimization** | 2 / 5K | ⚠️ Мало для image-heavy проекта |

### 2.2 Serverless Functions ограничения

**Vercel Serverless Functions (Free):**
- ⏱️ **Execution timeout:** 10 секунд (Hobby), 60s (Pro)
- 💾 **Memory:** 1024 MB
- 📦 **Bundle size:** 50 MB

**Проблемы для ACTRA:**
1. **AI-генерация заданий** (`AIGenerationService`) с PDF парсингом (PyMuPDF) может занимать **20-60 секунд** → превысит timeout
2. **PDF processing** требует библиотек (PyMuPDF ~50MB) → близко к лимиту bundle
3. **Pillow** для image processing → добавит ~10-15MB к bundle

---

## 3. Требуемые изменения для миграции

### 3.1 Критические изменения (Обязательные)

#### ❶ Замена файловой системы на БД

**Проблема:** Все сервисы пишут в локальные JSON файлы.

**Решение:**
- Использовать **Vercel Postgres** (Free: 256 MB, 60 часов compute)
- ИЛИ **Supabase** (бесплатно: 500MB + Auth)
- ИЛИ **PlanetScale** / **Neon** (serverless PostgreSQL)

**Объём работы:**
```python
# БЫЛО (StorageService):
def save_task(self, module_id, topic_id, task_id, data):
    path = self.data_dir / "modules" / module_id / topic_id / task_id / "task.json"
    with open(path, 'w') as f:
        json.dump(data, f)

# СТАЛО (с БД):
def save_task(self, module_id, topic_id, task_id, data):
    db.execute(
        "INSERT INTO tasks (module_id, topic_id, task_id, data) VALUES (?, ?, ?, ?)",
        (module_id, topic_id, task_id, json.dumps(data))
    )
```

**Оценка:** ~400+ мест изменений, **3-4 недели работы**.

---

#### ❷ Refactor на Serverless Architecture

**Проблема:** Flask `app.run()` работает как long-running процесс, Vercel требует stateless functions.

**Решение:**
- Конвертировать Flask routes в **Vercel Serverless Functions**
- Убрать глобальное состояние (`_headless_app_ctx`)
- Использовать **холодный старт** сервисов в каждом запросе

**Пример конверсии:**

```python
# БЫЛО (server.py):
app = Flask(__name__)
_headless_app_ctx = AppContextHeadless()  # Глобальное состояние

@app.route("/api/session/start", methods=["POST"])
def start_session():
    session_id = session_api.start_session(...)  # Использует глобальный контекст
    return jsonify({"session_id": session_id})

# СТАЛО (api/session/start.py):
from http.server import BaseHTTPRequestHandler
import json

class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        # Инициализация сервисов при каждом запросе (холодный старт)
        db = get_db_connection()  # Из env переменных
        session_service = SessionService(db)
        
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        session_id = session_service.start_session(...)
        
        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({"session_id": session_id}).encode())
```

**Оценка:** ~120 routes → **4-6 недель работы**.

---

#### ❸ Вынос AI-генерации на отдельный сервис

**Проблема:** `AIGenerationService` с PDF обработкой превышает Vercel Free лимиты (CPU time, timeout, bundle size).

**Решение:**
- Вынести на **отдельный сервер** (Railway, Render, Fly.io)
- ИЛИ использовать **Background Jobs** (Vercel Cron + external worker)
- ИЛИ переделать под **streaming** (chunked processing)

**Альтернатива (агрессивная):** Убрать AI-генерацию из MVP, оставить только ручное создание заданий.

**Оценка:** **2-3 недели** (если выносить), **1 день** (если убирать).

---

### 3.2 Важные изменения (Рекомендуемые)

#### ❹ Статические файлы (images, assets)

**Проблема:** `data/images/`, `frontend/assets/` хранятся локально.

**Решение:**
- **Vercel Blob Storage** (Free: 1GB) для user-uploaded изображений
- **Vercel Edge Config** для конфигураций
- **CDN** (Cloudflare Images) для оптимизации

**Оценка:** **1-2 недели**.

---

#### ❺ Authentication & User Management

**Проблема:** `UserService` работает с локальными JSON файлами.

**Решение:**
- **Vercel Authentication** (с NextAuth.js, если мигрируем на Next.js)
- ИЛИ **Supabase Auth** (готовое решение)
- ИЛИ **Clerk** (бесплатно до 5K MAU)

**Оценка:** **1 неделя** (если Supabase), **2-3 недели** (кастомное).

---

### 3.3 Опциональные изменения

#### ❻ Миграция на Next.js (вместо Flask)

**Преимущества:**
- Нативная поддержка Vercel (SSR, ISR, Edge Functions)
- Лучшая производительность (React Server Components)
- Меньше холодных стартов

**Недостатки:**
- Нужно переписать весь backend на TypeScript/JavaScript
- **Оценка:** +3-4 месяца работы

**Вердикт:** Не обязательно для MVP, можно оставить Flask.

---

## 4. Roadmap миграции

### Фаза 1: Подготовка (2-3 недели)
1. Настроить Vercel Postgres / Supabase
2. Создать database schema для всех сущностей
3. Написать миграционные скрипты JSON → DB
4. Настроить Vercel Blob для изображений

### Фаза 2: Backend рефакторинг (4-6 недель)
1. Конвертировать Flask routes → Vercel Functions
2. Убрать глобальное состояние, добавить DI для DB
3. Протестировать все API endpoints локально (Vercel CLI)
4. Вынести AI-генерацию на external service

### Фаза 3: Frontend адаптация (1-2 недели)
1. Обновить API клиенты (fetch URLs)
2. Добавить обработку холодных стартов (loading states)
3. Оптимизировать asset loading

### Фаза 4: Деплой & тестирование (2 недели)
1. Первый деплой на Vercel Preview
2. Нагрузочное тестирование (не превысить лимиты)
3. Мониторинг метрик (CPU, Data Transfer)
4. Production деплой

**Итого:** ~3-4 месяца (без миграции на Next.js).

---

## 5. Альтернативные платформы

Если Vercel Free tier недостаточен, рассмотреть:

| Платформа | Бесплатный план | Плюсы для ACTRA | Минусы |
|-----------|-----------------|-----------------|--------|
| **Railway** | $5 free credit/month | Поддержка Python, Docker, БД included | Не serverless, нужен мониторинг |
| **Fly.io** | 3 VM бесплатно (256MB) | Полный контроль, long-running процессы | Сложнее настройка |
| **Render** | Free tier (512MB, sleeps 15 min) | Простой деплой Flask, free PostgreSQL | Засыпает при неактивности |
| **Heroku** | Убрали free tier ❌ | — | — |
| **PythonAnywhere** | Free tier (limited) | Хостинг Python-приложений | Медленный, ограниченный |

**Рекомендация:** **Railway** как best fit (Python + БД + долгие процессы).

---

## 6. Оценка реализуемости для текущего проекта

### 6.1 Что работает "из коробки"

✅ **Frontend UI** — готов к деплою (статика)  
✅ **API routes** (большая часть) — легко конвертируются  
✅ **Session management** — можно адаптировать  
✅ **Statistics & analytics** — работает с БД  

### 6.2 Что требует серьёзной переделки

⚠️ **StorageService** — полный рефакторинг  
⚠️ **FileSystem-зависимые сервисы** — миграция на БД  
⚠️ **AI генерация** — вынос на отдельный сервис  
⚠️ **Image processing** — использовать Vercel Blob  

### 6.3 Что невозможно на Vercel Free

❌ **PDF processing с PyMuPDF** (bundle size + CPU time)  
❌ **Long-running AI tasks** (>10s timeout)  
❌ **Большие объёмы изображений** (только 2 optimizations/month)  

---

## 7. Финальные рекомендации

### Сценарий А: MVP на Vercel Free (ограниченная функциональность)

**Включаем:**
- ✅ Основной UI (главная, сессии, статистика)
- ✅ Ручное создание заданий
- ✅ Прохождение заданий (click, test, sequence)
- ✅ Базовая статистика

**Исключаем:**
- ❌ AI-генерация заданий
- ❌ PDF импорт
- ❌ Расширенная image optimization

**Итого:** ~2-3 месяца работы, урезанная функциональность.

---

### Сценарий Б: Полная миграция на Railway/Render (рекомендуется)

**Преимущества:**
- ✅ Полная функциональность сохраняется
- ✅ Меньше рефакторинга (можно оставить Flask as-is)
- ✅ Поддержка long-running процессов
- ✅ Включённая БД (PostgreSQL)

**Недостатки:**
- Платная подписка через 1-2 месяца (~$5-10/month)

**Итого:** ~1.5-2 месяца работы (только БД миграция).

---

### Сценарий В: Гибридное решение

**Архитектура:**
- **Vercel** — frontend + лёгкие API
- **Railway/Render** — backend с БД + AI-генерация
- **Supabase** — Auth + Storage

**Итого:** ~3 месяца работы, лучшее из двух миров.

---

## 8. Риски и митигация

| Риск | Вероятность | Воздействие | Митигация |
|------|-------------|-------------|-----------|
| Превышение Vercel лимитов | Высокая | Критичное | Мониторинг + переход на Railway |
| Сложность миграции БД | Средняя | Высокое | Пошаговые миграции + тесты |
| Холодные старты (latency) | Высокая | Среднее | Caching + keep-alive пинги |
| Потеря данных при миграции | Низкая | Критичное | Бэкапы + rollback план |

---

## 9. Следующие шаги

### Немедленные действия:
1. **Решить:** Vercel Free (MVP) или Railway (полная версия)?
2. **Выбрать БД:** Vercel Postgres, Supabase, или PlanetScale?
3. **Создать POC:** Один сервис (например, `UserService`) на Vercel Serverless

### Краткосрочные (1 месяц):
1. Начать database schema design
2. Настроить CI/CD для Vercel/Railway
3. Написать migration scripts

### Долгосрочные (3-6 месяцев):
1. Полная миграция backend
2. Тестирование под нагрузкой
3. Production deployment

---

## 10. Заключение

**Миграция ACTRA на веб-платформу технически возможна**, но требует значительных усилий (3-6 месяцев full-time разработки). 

**Ключевое решение:** 
- Если цель — **бесплатный хостинг** → выбрать **Railway** (более реалистично)
- Если цель — **максимальная масштабируемость** → выбрать **Vercel + гибридную архитектуру**
- Если цель — **быстрый MVP** → убрать AI-функции и деплоить на Vercel Free

**Рекомендация:** Начать с **Railway** как наиболее сбалансированное решение (поддержка Python, встроенная БД, разумные лимиты).

---

**Подготовлено:** Cascade AI  
**Статус:** Ready for review  
**Ветка:** `feature/web-platform-migration-analysis`
