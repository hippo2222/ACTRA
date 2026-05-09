"""Static / UI-serving routes.

All routes that serve HTML pages and static assets (CSS, JS, images)
via ``send_from_directory``.  No business logic — pure file serving.
"""

import hashlib
from html import escape
import json
import logging
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Dict

from flask import Blueprint, jsonify, redirect, request, send_from_directory

from routes._context import get_authenticated_user_id, get_ctx, get_extra, is_hosted_web_runtime
from services.user_service import USER_PLAN_PREMIUM, resolve_effective_plan

logger = logging.getLogger(__name__)

static_bp = Blueprint("static_ui", __name__)


_LEGAL_DOC_TYPES = {"terms", "privacy"}
_PUBLIC_LANGS = {"en", "ru"}

_PREMIUM_OFFERS = (
    {"days": 14, "label": "14 days", "price": "$4.99", "per_day": "$0.36/day"},
    {"days": 30, "label": "30 days", "price": "$7.99", "per_day": "$0.27/day"},
    {"days": 90, "label": "90 days", "price": "$19.99", "per_day": "$0.22/day"},
)

_SUPPORT_EMAIL = "actrafb@proton.me"

_PUBLIC_LABELS = {
    "en": {
        "pricing": "Pricing",
        "refund": "Refund policy",
        "terms": "Terms",
        "privacy": "Privacy",
        "open_app": "Open app",
        "support": "Support",
        "version": "Version",
        "premium": "ACTRA Premium",
    },
    "ru": {
        "pricing": "Цены",
        "refund": "Возвраты",
        "terms": "Условия",
        "privacy": "Приватность",
        "open_app": "Открыть приложение",
        "support": "Поддержка",
        "version": "Версия",
        "premium": "ACTRA Premium",
    },
}


def _public_lang(default: str = "en") -> str:
    requested = str(request.args.get("lang") or default or "en").strip().lower()
    return requested if requested in _PUBLIC_LANGS else "en"


def _localized_url(path: str, lang: str) -> str:
    clean_path = str(path or "/").strip() or "/"
    if not clean_path.startswith("/"):
        clean_path = f"/{clean_path}"
    return f"{clean_path}?lang={lang}"


def _public_nav_html(lang: str) -> str:
    labels = _PUBLIC_LABELS.get(lang, _PUBLIC_LABELS["en"])
    return f"""
      <nav aria-label="Public links">
        <a href="{_localized_url('/pricing', lang)}">{escape(labels['pricing'])}</a>
        <a href="{_localized_url('/refund', lang)}">{escape(labels['refund'])}</a>
        <a href="{_localized_url('/legal/terms', lang)}">{escape(labels['terms'])}</a>
        <a href="{_localized_url('/legal/privacy', lang)}">{escape(labels['privacy'])}</a>
        <a href="/ui/welcome">{escape(labels['open_app'])}</a>
      </nav>
    """


def _language_switch_html(current_path: str, lang: str) -> str:
    items = []
    for code, label in (("en", "English"), ("ru", "Русский")):
        active = code == lang
        attrs = ' aria-current="page"' if active else ""
        cls = "active" if active else ""
        items.append(f'<a class="{cls}" href="{_localized_url(current_path, code)}"{attrs}>{escape(label)}</a>')
    return f'<div class="language-switch" aria-label="Language selector">{"".join(items)}</div>'


def _public_base_url() -> str:
    configured = (
        str(os.environ.get("ACTRA_AUTH_PUBLIC_BASE_URL") or "").strip()
        or str(os.environ.get("ACTRA_PUBLIC_BASE_URL") or "").strip()
        or "https://actra.site"
    )
    return configured.rstrip("/") or "https://actra.site"


def _inline_markdown_to_html(text: str) -> str:
    safe = escape(str(text or ""), quote=True)
    safe = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", safe)
    safe = re.sub(r"`([^`]+)`", r"<code>\1</code>", safe)
    return safe


def _markdown_to_legal_html(markdown: str) -> str:
    blocks: list[str] = []
    paragraph: list[str] = []
    list_items: list[str] = []

    def flush_paragraph() -> None:
        if not paragraph:
            return
        text = " ".join(part.strip() for part in paragraph if part.strip()).strip()
        if text:
            blocks.append(f"<p>{_inline_markdown_to_html(text)}</p>")
        paragraph.clear()

    def flush_list() -> None:
        if not list_items:
            return
        items = "".join(f"<li>{_inline_markdown_to_html(item)}</li>" for item in list_items)
        blocks.append(f"<ul>{items}</ul>")
        list_items.clear()

    for raw_line in str(markdown or "").splitlines():
        line = raw_line.strip()
        if not line:
            flush_paragraph()
            flush_list()
            continue

        heading = re.match(r"^(#{1,3})\s+(.+)$", line)
        if heading:
            flush_paragraph()
            flush_list()
            level = min(3, len(heading.group(1)))
            blocks.append(f"<h{level}>{_inline_markdown_to_html(heading.group(2))}</h{level}>")
            continue

        bullet = re.match(r"^[-*]\s+(.+)$", line)
        if bullet:
            flush_paragraph()
            list_items.append(bullet.group(1))
            continue

        numbered = re.match(r"^\d+\.\s+(.+)$", line)
        if numbered:
            flush_paragraph()
            list_items.append(numbered.group(1))
            continue

        flush_list()
        paragraph.append(line.rstrip("\\"))

    flush_paragraph()
    flush_list()
    return "\n".join(blocks)


def _public_legal_document_page(doc_type: str) -> Any:
    clean_type = str(doc_type or "").strip().lower()
    if clean_type not in _LEGAL_DOC_TYPES:
        return jsonify({"ok": False, "error": "document_not_found"}), 404

    lang = _public_lang("en")
    legal_dir = Path(__file__).resolve().parents[2] / "frontend" / "legal"
    manifest_path = legal_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
    if lang == "en":
        meta = dict((manifest or {}).get(clean_type) or {})
        path = legal_dir / str(meta.get("filename_en") or f"{clean_type}.en.md")
        title = str(meta.get("title_en") or ("Privacy Policy" if clean_type == "privacy" else "Terms of Service"))
        version = str(meta.get("version") or "").strip()
        effective_at = str(meta.get("effective_at") or "").strip()
    else:
        helpers = get_extra("misc_helpers", {}) or {}
        load_manifest = helpers.get("load_legal_manifest")
        resolve_doc_path = helpers.get("legal_doc_path")
        if callable(load_manifest) and callable(resolve_doc_path):
            manifest = load_manifest()
            path = resolve_doc_path(clean_type, manifest=manifest)
        else:
            filename = str(((manifest or {}).get(clean_type) or {}).get("filename") or f"{clean_type}.md")
            path = legal_dir / filename
        meta = dict((manifest or {}).get(clean_type) or {})
        title = str(meta.get("title") or ("Политика приватности" if clean_type == "privacy" else "Условия пользования"))
        version = str(meta.get("version") or "").strip()
        effective_at = str(meta.get("effective_at") or "").strip()

    if path is None or not Path(path).exists():
        return jsonify({"ok": False, "error": "document_not_found"}), 404

    content = Path(path).read_text(encoding="utf-8")
    body_html = _markdown_to_legal_html(content)
    title_html = escape(title)
    labels = _PUBLIC_LABELS.get(lang, _PUBLIC_LABELS["en"])
    meta_parts = [part for part in (f"{labels['version']} {version}" if version else "", effective_at) if part]
    meta_html = escape(" | ".join(meta_parts))
    current_path = "/legal/privacy" if clean_type == "privacy" else "/legal/terms"

    return (
        f"""<!doctype html>
<html lang="{lang}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{title_html} - ACTRA</title>
  <style>
    :root {{
      color-scheme: light;
      --bg: #f8f7f4;
      --paper: #ffffff;
      --text: #221f1a;
      --muted: #6d6258;
      --line: #dfd7ce;
      --accent: #9d4f21;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.65;
    }}
    header {{
      border-bottom: 1px solid var(--line);
      background: var(--paper);
    }}
    .wrap {{
      width: min(920px, calc(100% - 32px));
      margin: 0 auto;
    }}
    .top {{
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 18px 0;
    }}
    .brand {{
      color: var(--text);
      font-size: 15px;
      font-weight: 750;
      text-decoration: none;
    }}
    .back {{
      color: var(--accent);
      font-size: 14px;
      font-weight: 650;
      text-decoration: none;
    }}
    nav {{
      display: flex;
      flex-wrap: wrap;
      gap: 14px;
      font-size: 14px;
    }}
    nav a {{
      color: var(--accent);
      font-weight: 700;
      text-decoration: none;
    }}
    .language-switch {{
      display: inline-flex;
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: #fbfaf8;
      margin: 0 0 18px;
    }}
    .language-switch a {{
      min-width: 82px;
      padding: 8px 13px;
      color: var(--muted);
      font-size: 13px;
      font-weight: 800;
      text-align: center;
      text-decoration: none;
    }}
    .language-switch a.active {{
      background: var(--accent);
      color: #ffffff;
    }}
    main {{
      padding: 42px 0 64px;
    }}
    article {{
      background: var(--paper);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: clamp(22px, 4vw, 44px);
      box-shadow: 0 14px 36px rgba(31, 25, 20, 0.07);
    }}
    h1 {{
      margin: 0 0 8px;
      font-size: clamp(28px, 4vw, 42px);
      line-height: 1.12;
    }}
    .meta {{
      margin: 0 0 30px;
      color: var(--muted);
      font-size: 14px;
    }}
    article h1:first-child {{
      display: none;
    }}
    h2 {{
      margin: 32px 0 10px;
      font-size: 22px;
      line-height: 1.25;
    }}
    h3 {{
      margin: 24px 0 8px;
      font-size: 18px;
      line-height: 1.3;
    }}
    p {{
      margin: 12px 0;
    }}
    ul {{
      margin: 12px 0 18px;
      padding-left: 24px;
    }}
    li {{
      margin: 6px 0;
    }}
    code {{
      border: 1px solid var(--line);
      border-radius: 4px;
      padding: 1px 5px;
      background: #fbfaf8;
      font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
      font-size: 0.92em;
    }}
    @media (max-width: 760px) {{
      .top {{
        align-items: flex-start;
        flex-direction: column;
      }}
    }}
  </style>
</head>
<body>
  <header>
    <div class="wrap top">
      <a class="brand" href="/">ACTRA</a>
      {_public_nav_html(lang)}
    </div>
  </header>
  <main class="wrap">
    {_language_switch_html(current_path, lang)}
    <article>
      <h1>{title_html}</h1>
      <p class="meta">{meta_html}</p>
      {body_html}
    </article>
  </main>
</body>
</html>""",
        200,
        {"Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store"},
    )


def _public_commerce_page(*, title: str, subtitle: str, body_html: str, lang: str, current_path: str) -> Any:
    title_html = escape(str(title or "ACTRA").strip() or "ACTRA")
    subtitle_html = escape(str(subtitle or "").strip())
    labels = _PUBLIC_LABELS.get(lang, _PUBLIC_LABELS["en"])
    return (
        f"""<!doctype html>
<html lang="{lang}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{title_html} - ACTRA</title>
  <style>
    :root {{
      color-scheme: light;
      --bg: #f7f8fb;
      --paper: #ffffff;
      --text: #182039;
      --muted: #5a657c;
      --line: #d9deea;
      --accent: #2f2690;
      --accent-soft: #eef0ff;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.6;
    }}
    a {{ color: var(--accent); font-weight: 700; }}
    header {{
      border-bottom: 1px solid var(--line);
      background: var(--paper);
    }}
    .wrap {{
      width: min(1040px, calc(100% - 32px));
      margin: 0 auto;
    }}
    .top {{
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 18px 0;
    }}
    .brand {{
      color: var(--text);
      font-size: 15px;
      font-weight: 850;
      text-decoration: none;
      letter-spacing: 0;
    }}
    nav {{
      display: flex;
      flex-wrap: wrap;
      gap: 14px;
      font-size: 14px;
    }}
    nav a {{ text-decoration: none; }}
    .language-switch {{
      display: inline-flex;
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: var(--paper);
      margin-bottom: 24px;
    }}
    .language-switch a {{
      min-width: 82px;
      padding: 8px 13px;
      color: var(--muted);
      font-size: 13px;
      font-weight: 850;
      text-align: center;
      text-decoration: none;
    }}
    .language-switch a.active {{
      background: var(--accent);
      color: #ffffff;
    }}
    main {{
      padding: clamp(34px, 6vw, 72px) 0 70px;
    }}
    .hero {{
      max-width: 760px;
      margin-bottom: 28px;
    }}
    .eyebrow {{
      margin: 0 0 8px;
      color: var(--accent);
      font-size: 12px;
      font-weight: 900;
      letter-spacing: 0.14em;
      text-transform: uppercase;
    }}
    h1 {{
      margin: 0;
      font-size: clamp(34px, 5vw, 58px);
      line-height: 1.02;
      letter-spacing: 0;
    }}
    .subtitle {{
      margin: 16px 0 0;
      max-width: 680px;
      color: var(--muted);
      font-size: 18px;
    }}
    .grid {{
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 14px;
      margin: 28px 0;
    }}
    .card, .panel {{
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--paper);
      box-shadow: 0 14px 34px rgba(20, 28, 52, 0.07);
    }}
    .card {{
      display: grid;
      gap: 10px;
      padding: 20px;
    }}
    .card strong {{
      font-size: 18px;
    }}
    .price {{
      font-size: 34px;
      line-height: 1;
      font-weight: 950;
      letter-spacing: 0;
    }}
    .muted {{ color: var(--muted); }}
    .badge {{
      display: inline-flex;
      width: fit-content;
      border-radius: 999px;
      background: var(--accent-soft);
      color: var(--accent);
      padding: 4px 9px;
      font-size: 12px;
      font-weight: 850;
    }}
    .panel {{
      margin-top: 18px;
      padding: clamp(20px, 4vw, 32px);
    }}
    h2 {{
      margin: 0 0 12px;
      font-size: 24px;
      line-height: 1.25;
    }}
    p {{ margin: 10px 0; }}
    ul {{
      margin: 12px 0 0;
      padding-left: 22px;
    }}
    li {{ margin: 6px 0; }}
    footer {{
      border-top: 1px solid var(--line);
      padding: 22px 0 32px;
      color: var(--muted);
      font-size: 14px;
    }}
    @media (max-width: 760px) {{
      .top {{ align-items: flex-start; flex-direction: column; }}
      .grid {{ grid-template-columns: 1fr; }}
      nav {{ gap: 10px; }}
    }}
  </style>
</head>
<body>
  <header>
    <div class="wrap top">
      <a class="brand" href="/">ACTRA</a>
      {_public_nav_html(lang)}
    </div>
  </header>
  <main class="wrap">
    {_language_switch_html(current_path, lang)}
    <section class="hero">
      <p class="eyebrow">{escape(labels['premium'])}</p>
      <h1>{title_html}</h1>
      <p class="subtitle">{subtitle_html}</p>
    </section>
    {body_html}
  </main>
  <footer>
    <div class="wrap">{escape(labels['support'])}: <a href="mailto:{_SUPPORT_EMAIL}">{_SUPPORT_EMAIL}</a></div>
  </footer>
</body>
</html>""",
        200,
        {"Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store"},
    )


def _pricing_page() -> Any:
    lang = _public_lang("en")
    offer_labels = {
        "en": ("14 days", "30 days", "90 days"),
        "ru": ("14 дней", "30 дней", "90 дней"),
    }
    per_day_labels = {
        "en": ("$0.36/day", "$0.27/day", "$0.22/day"),
        "ru": ("$0.36/день", "$0.27/день", "$0.22/день"),
    }
    badge = "Premium access" if lang == "en" else "Премиум-доступ"
    cards = "\n".join(
        f"""<section class="card">
          <span class="badge">{escape(badge)}</span>
          <strong>{escape(offer_labels[lang][index])}</strong>
          <div class="price">{escape(offer["price"])}</div>
          <div class="muted">{escape(per_day_labels[lang][index])}</div>
        </section>"""
        for index, offer in enumerate(_PREMIUM_OFFERS)
    )
    if lang == "ru":
        title = "Цены"
        subtitle = "Фиксированный цифровой доступ к ACTRA Premium на выбранный срок."
        body = f"""
        <section class="grid" aria-label="Цены ACTRA Premium">
          {cards}
        </section>
        <section class="panel">
          <h2>Что входит</h2>
          <p>ACTRA Premium — это цифровой доступ на фиксированный срок. Физические товары не продаются и не доставляются.</p>
          <ul>
            <li>Повышенные лимиты для личных учебных задач, теорий и комплексов.</li>
            <li>Доступ к полным страницам Календаря и Статистики.</li>
            <li>Премиум-функции учебного процесса внутри web-приложения ACTRA.</li>
          </ul>
        </section>
        <section class="panel">
          <h2>Доставка и доступ</h2>
          <p>Премиум-доступ предоставляется цифровым способом в аккаунте пользователя после подтверждения оплаты. Выбранный срок начинается с момента активации Premium.</p>
          <p>По вопросам поддержки: <a href="mailto:{_SUPPORT_EMAIL}">{_SUPPORT_EMAIL}</a>.</p>
        </section>
        """
    else:
        title = "Pricing"
        subtitle = "Simple fixed-period digital access for ACTRA Premium."
        body = f"""
        <section class="grid" aria-label="ACTRA Premium prices">
          {cards}
        </section>
        <section class="panel">
          <h2>What is included</h2>
          <p>ACTRA Premium is digital access for a fixed period. No physical goods are sold or shipped.</p>
          <ul>
            <li>Higher limits for personal learning tasks, theories, and learning complexes.</li>
            <li>Access to the full Calendar and Statistics pages.</li>
            <li>Premium learning workflow features available inside the ACTRA web app.</li>
          </ul>
        </section>
        <section class="panel">
          <h2>Delivery and access</h2>
          <p>Premium access is delivered digitally to the user account after payment is confirmed. The selected access period starts when Premium is activated.</p>
          <p>For support, contact <a href="mailto:{_SUPPORT_EMAIL}">{_SUPPORT_EMAIL}</a>.</p>
        </section>
        """
    return _public_commerce_page(
        title=title,
        subtitle=subtitle,
        body_html=body,
        lang=lang,
        current_path="/pricing",
    )


def _refund_page() -> Any:
    lang = _public_lang("en")
    if lang == "ru":
        title = "Политика возвратов"
        subtitle = "Как рассматриваются возвраты за цифровой доступ ACTRA Premium."
        body = f"""
        <section class="panel">
          <h2>Возвраты за цифровой доступ</h2>
          <p>ACTRA Premium является цифровой услугой. Запросы на возврат рассматриваются службой поддержки с учетом обстоятельств покупки и правил платежного провайдера.</p>
          <p>Возврат может быть рассмотрен в следующих случаях:</p>
          <ul>
            <li>дублирующая или случайная оплата;</li>
            <li>оплата прошла успешно, но Premium-доступ не был активирован из-за технической ошибки;</li>
            <li>другая очевидная ошибка биллинга, связанная с покупкой.</li>
          </ul>
        </section>
        <section class="panel">
          <h2>Как запросить возврат</h2>
          <p>Напишите на <a href="mailto:{_SUPPORT_EMAIL}">{_SUPPORT_EMAIL}</a> и укажите email аккаунта ACTRA, дату оплаты, выбранный срок Premium и краткое описание ситуации.</p>
          <p>Мы можем запросить дополнительную информацию, необходимую для поиска платежа и проверки обращения.</p>
        </section>
        <section class="panel">
          <h2>Доступ после возврата</h2>
          <p>Если возврат одобрен, связанный Premium-доступ может быть отменен или скорректирован.</p>
        </section>
        """
    else:
        title = "Refund policy"
        subtitle = "How refunds are handled for ACTRA Premium digital access."
        body = f"""
        <section class="panel">
          <h2>Digital access refund policy</h2>
          <p>ACTRA Premium is a digital service. Refund requests are reviewed by support and handled according to the circumstances of the purchase and applicable payment provider rules.</p>
          <p>Refunds may be considered in the following cases:</p>
          <ul>
            <li>duplicate or accidental payment;</li>
            <li>payment was successful, but Premium access could not be activated due to a technical issue;</li>
            <li>another clear billing error related to the purchase.</li>
          </ul>
        </section>
        <section class="panel">
          <h2>How to request a refund</h2>
          <p>Send a request to <a href="mailto:{_SUPPORT_EMAIL}">{_SUPPORT_EMAIL}</a> and include the email used for your ACTRA account, payment date, selected Premium period, and a short description of the issue.</p>
          <p>We may ask for additional information needed to locate the payment and verify the request.</p>
        </section>
        <section class="panel">
          <h2>Access after a refund</h2>
          <p>If a refund is approved, the related Premium access may be cancelled or adjusted.</p>
        </section>
        """
    return _public_commerce_page(
        title=title,
        subtitle=subtitle,
        body_html=body,
        lang=lang,
        current_path="/refund",
    )


# ---------------------------------------------------------------------------
# Helpers (used only by UI routes)
# ---------------------------------------------------------------------------

def _get_ui_dirs() -> Dict[str, Path]:
    """Return the dict of UI directory paths stored during init_context."""
    return get_extra("ui_dirs", {})


def _current_ui_user() -> Any:
    ctx = get_ctx()
    if ctx is None:
        return None
    user_id = str(get_authenticated_user_id() or "").strip() if is_hosted_web_runtime() else str(getattr(ctx, "user_id", "") or "").strip()
    if not user_id or user_id == "guest":
        return None
    try:
        return ctx.user_service.get_user(user_id)
    except Exception:
        return None


def _current_user_has_premium_access() -> bool:
    return resolve_effective_plan(_current_ui_user()) == USER_PLAN_PREMIUM


def _premium_required_page(feature_label: str) -> Any:
    safe_label = str(feature_label or "Premium").strip() or "Premium"
    return (
        f"""<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Premium required - ACTRA</title>
  <link rel="stylesheet" href="/assets/tailwind.css" />
  <link rel="stylesheet" href="/assets/fonts.css" />
  <link rel="stylesheet" href="/assets/lightB-variables.css" />
  <link rel="stylesheet" href="/assets/lightB-components.css" />
</head>
<body class="min-h-screen bg-bg-main text-text-main">
  <main class="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center px-6 py-12 text-center">
    <div class="rounded-2xl border border-border-subtle bg-surface-1 px-6 py-8 shadow-lg">
      <p class="text-xs font-bold uppercase tracking-[0.18em] text-primary">Premium</p>
      <h1 class="mt-3 text-3xl font-bold">{safe_label} доступен в Premium</h1>
      <p class="mt-3 text-sm leading-6 text-text-secondary">
        Виджеты на главной остаются доступны, а полная страница открывается после активации Premium.
      </p>
      <div class="mt-6 flex flex-wrap justify-center gap-3">
        <a class="btn-primary inline-flex rounded-xl px-4 py-2.5 text-sm font-semibold" href="/ui/settings#premium">Открыть Premium</a>
        <a class="btn-secondary inline-flex rounded-xl px-4 py-2.5 text-sm font-semibold" href="/ui/main">На главную</a>
      </div>
    </div>
  </main>
</body>
</html>""",
        403,
        {"Cache-Control": "no-store"},
    )


def _file_debug_meta(path: Path) -> Dict[str, Any]:
    try:
        if not path.exists() or not path.is_file():
            return {"exists": False, "path": str(path)}

        raw = path.read_bytes()
        st = path.stat()
        return {
            "exists": True,
            "path": str(path),
            "size": st.st_size,
            "mtime": datetime.fromtimestamp(st.st_mtime).isoformat(),
            "sha256": hashlib.sha256(raw).hexdigest(),
        }
    except Exception as exc:
        return {"exists": False, "path": str(path), "error": str(exc)}


def _flush_log_handlers() -> None:
    try:
        candidates = [logging.getLogger(), logging.getLogger(__name__), logging.getLogger("server")]
        for lg in candidates:
            for h in list(getattr(lg, "handlers", []) or []):
                try:
                    h.flush()
                except Exception:
                    pass

        # Best-effort: flush handlers attached to any configured logger
        mgr = getattr(logging.getLogger(), "manager", None)
        logger_dict = getattr(mgr, "loggerDict", {}) if mgr else {}
        for lg in logger_dict.values():
            handlers = getattr(lg, "handlers", None)
            if not handlers:
                continue
            for h in list(handlers):
                try:
                    h.flush()
                except Exception:
                    pass
    except Exception:
        return


# ---------------------------------------------------------------------------
# Complexes UI
# ---------------------------------------------------------------------------

@static_bp.route("/ui/complexes", methods=["GET"])
def serve_complexes_ui() -> Any:
    """Serve the complexes list HTML UI (S0)."""
    dirs = _get_ui_dirs()
    COMPLEXES_UI_DIR = dirs.get("COMPLEXES_UI_DIR")
    if not COMPLEXES_UI_DIR or not COMPLEXES_UI_DIR.exists():
        logger.error("[HTTP] COMPLEXES_UI_DIR does not exist: %s", COMPLEXES_UI_DIR)
        return jsonify({"ok": False, "error": "complexes_ui_not_found"}), 500

    resp = send_from_directory(COMPLEXES_UI_DIR, "index.html")
    try:
        resp.headers["Cache-Control"] = "no-store"
    except Exception:
        pass
    return resp


@static_bp.route("/ui/complexes/create", methods=["GET"])
def serve_complexes_create_ui() -> Any:
    dirs = _get_ui_dirs()
    COMPLEXES_UI_DIR = dirs.get("COMPLEXES_UI_DIR")
    if not COMPLEXES_UI_DIR or not COMPLEXES_UI_DIR.exists():
        logger.error("[HTTP] COMPLEXES_UI_DIR does not exist: %s", COMPLEXES_UI_DIR)
        return jsonify({"ok": False, "error": "complexes_ui_not_found"}), 500

    resp = send_from_directory(COMPLEXES_UI_DIR, "create.html")
    try:
        resp.headers["Cache-Control"] = "no-store"
    except Exception:
        pass
    return resp


# ---------------------------------------------------------------------------
# Catalog UI
# ---------------------------------------------------------------------------

@static_bp.route("/ui/catalog", methods=["GET"])
@static_bp.route("/ui/catalog/", methods=["GET"])
def serve_catalog_ui() -> Any:
    """Serve the public catalog UI."""
    dirs = _get_ui_dirs()
    CATALOG_UI_DIR = dirs.get("CATALOG_UI_DIR")
    if not CATALOG_UI_DIR or not CATALOG_UI_DIR.exists():
        logger.error("[HTTP] CATALOG_UI_DIR does not exist: %s", CATALOG_UI_DIR)
        return jsonify({"ok": False, "error": "catalog_ui_not_found"}), 500

    resp = send_from_directory(CATALOG_UI_DIR, "index.html")
    try:
        resp.headers["Cache-Control"] = "no-store"
    except Exception:
        pass
    return resp


@static_bp.route("/catalog", methods=["GET"])
@static_bp.route("/catalog/", methods=["GET"])
def serve_catalog_ui_alias() -> Any:
    """Legacy-friendly alias for the public catalog UI."""
    return redirect("/ui/catalog")


@static_bp.route("/ui/catalog/<path:filename>", methods=["GET"])
def serve_catalog_file(filename: str) -> Any:
    """Serve Catalog static files (HTML, JS)."""
    dirs = _get_ui_dirs()
    CATALOG_UI_DIR = dirs.get("CATALOG_UI_DIR")
    if not CATALOG_UI_DIR or not CATALOG_UI_DIR.exists():
        return jsonify({"ok": False, "error": "catalog_ui_not_found"}), 500
    return send_from_directory(CATALOG_UI_DIR, filename)


# ---------------------------------------------------------------------------
# Welcome UI
# ---------------------------------------------------------------------------

@static_bp.route("/", methods=["GET"])
def serve_root_ui_alias() -> Any:
    """Send the browser through the canonical UI entrypoint."""
    return redirect("/ui")


@static_bp.route("/robots.txt", methods=["GET"])
def serve_robots_txt() -> Any:
    base_url = _public_base_url()
    body = f"""User-agent: *
Allow: /

Sitemap: {base_url}/sitemap.xml
"""
    return body, 200, {"Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store"}


@static_bp.route("/sitemap.xml", methods=["GET"])
def serve_sitemap_xml() -> Any:
    base_url = escape(_public_base_url(), quote=True)
    paths = ("", "pricing", "refund", "privacy", "terms")
    urls = "\n".join(
        f"  <url><loc>{base_url}/{path}</loc></url>" if path else f"  <url><loc>{base_url}/</loc></url>"
        for path in paths
    )
    body = f"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
{urls}
</urlset>
"""
    return body, 200, {"Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-store"}


@static_bp.route("/privacy", methods=["GET"])
@static_bp.route("/legal/privacy", methods=["GET"])
def serve_privacy_policy() -> Any:
    """Serve the public privacy policy page for OAuth consent links."""
    return _public_legal_document_page("privacy")


@static_bp.route("/terms", methods=["GET"])
@static_bp.route("/legal/terms", methods=["GET"])
def serve_terms_of_service() -> Any:
    """Serve the public terms page for OAuth consent links."""
    return _public_legal_document_page("terms")


@static_bp.route("/pricing", methods=["GET"])
def serve_pricing_page() -> Any:
    """Serve the public ACTRA Premium pricing page for payment verification."""
    return _pricing_page()


@static_bp.route("/refund", methods=["GET"])
@static_bp.route("/refund-policy", methods=["GET"])
def serve_refund_policy() -> Any:
    """Serve the public refund policy page for payment verification."""
    return _refund_page()


@static_bp.route("/ui/welcome", methods=["GET"])
def serve_welcome_ui() -> Any:
    """Serve the Welcome / onboarding screen."""
    dirs = _get_ui_dirs()
    WELCOME_UI_DIR = dirs.get("WELCOME_UI_DIR")
    if not WELCOME_UI_DIR or not WELCOME_UI_DIR.exists():
        logger.error("[HTTP] WELCOME_UI_DIR does not exist: %s", WELCOME_UI_DIR)
        return jsonify({"ok": False, "error": "welcome_ui_not_found"}), 500
    resp = send_from_directory(WELCOME_UI_DIR, "welcome.html")
    try:
        resp.headers["Cache-Control"] = "no-store"
    except Exception:
        pass
    return resp


@static_bp.route("/Welcome/<path:filename>", methods=["GET"])
def serve_welcome_static(filename: str) -> Any:
    """Serve static files (JS/CSS) for the Welcome screen."""
    dirs = _get_ui_dirs()
    WELCOME_UI_DIR = dirs.get("WELCOME_UI_DIR")
    if not WELCOME_UI_DIR or not WELCOME_UI_DIR.exists():
        return jsonify({"ok": False, "error": "welcome_ui_not_found"}), 500
    return send_from_directory(WELCOME_UI_DIR, filename)


# ---------------------------------------------------------------------------
# Main Screen UI
# ---------------------------------------------------------------------------

@static_bp.route("/ui", methods=["GET"])
@static_bp.route("/ui/main", methods=["GET"])
def serve_main_ui() -> Any:
    dirs = _get_ui_dirs()
    MAINSCREEN_UI_DIR = dirs.get("MAINSCREEN_UI_DIR")
    if not MAINSCREEN_UI_DIR or not MAINSCREEN_UI_DIR.exists():
        logger.error("[HTTP] MAINSCREEN_UI_DIR does not exist: %s", MAINSCREEN_UI_DIR)
        return jsonify({"ok": False, "error": "mainscreen_ui_not_found"}), 500

    main_path = MAINSCREEN_UI_DIR / "Main.html"
    try:
        meta = _file_debug_meta(main_path)
        logger.info("[HTTP][UI_MAIN] serve %s", json.dumps(meta, ensure_ascii=False))
        _flush_log_handlers()
    except Exception:
        pass

    resp = send_from_directory(MAINSCREEN_UI_DIR, "Main.html")
    try:
        resp.headers["Cache-Control"] = "no-store"
    except Exception:
        pass
    return resp


# ---------------------------------------------------------------------------
# Task UI modules (TestUI, SequenceUI, ClickUI, DrawUI, OpenAnswerUI, MistakesUI)
# ---------------------------------------------------------------------------

@static_bp.route("/ui/TestUI/<path:filename>", methods=["GET"])
def serve_testui_static(filename: str) -> Any:
    """Serve static JS/CSS/assets for the TestUI module used by S1.

    This allows paths like ../TestUI/TestUI.web.js in S1/index.html to be resolved
    as /ui/TestUI/TestUI.web.js.
    """
    dirs = _get_ui_dirs()
    TESTUI_DIR = dirs.get("TESTUI_DIR")
    if not TESTUI_DIR or not TESTUI_DIR.exists():
        logger.error("[HTTP] TESTUI_DIR does not exist: %s", TESTUI_DIR)
        return jsonify({"ok": False, "error": "testui_not_found"}), 500

    return send_from_directory(TESTUI_DIR, filename)


@static_bp.route("/ui/SequenceUI/<path:filename>", methods=["GET"])
def serve_sequenceui_static(filename: str) -> Any:
    dirs = _get_ui_dirs()
    SEQUENCEUI_DIR = dirs.get("SEQUENCEUI_DIR")
    if not SEQUENCEUI_DIR or not SEQUENCEUI_DIR.exists():
        logger.error("[HTTP] SEQUENCEUI_DIR does not exist: %s", SEQUENCEUI_DIR)
        return jsonify({"ok": False, "error": "sequenceui_not_found"}), 500

    return send_from_directory(SEQUENCEUI_DIR, filename)


@static_bp.route("/ui/ClickUI/<path:filename>", methods=["GET"])
def serve_clickui_static(filename: str) -> Any:
    dirs = _get_ui_dirs()
    CLICKUI_DIR = dirs.get("CLICKUI_DIR")
    if not CLICKUI_DIR or not CLICKUI_DIR.exists():
        logger.error("[HTTP] CLICKUI_DIR does not exist: %s", CLICKUI_DIR)
        return jsonify({"ok": False, "error": "clickui_not_found"}), 500

    return send_from_directory(CLICKUI_DIR, filename)


@static_bp.route("/ui/DrawUI/<path:filename>", methods=["GET"])
def serve_drawui_static(filename: str) -> Any:
    dirs = _get_ui_dirs()
    DRAWUI_DIR = dirs.get("DRAWUI_DIR")
    if not DRAWUI_DIR or not DRAWUI_DIR.exists():
        logger.error("[HTTP] DRAWUI_DIR does not exist: %s", DRAWUI_DIR)
        return jsonify({"ok": False, "error": "drawui_not_found"}), 500

    return send_from_directory(DRAWUI_DIR, filename)


@static_bp.route("/ui/OpenAnswerUI/<path:filename>", methods=["GET"])
def serve_openanswerui_static(filename: str) -> Any:
    dirs = _get_ui_dirs()
    OPENANSWERUI_DIR = dirs.get("OPENANSWERUI_DIR")
    if not OPENANSWERUI_DIR or not OPENANSWERUI_DIR.exists():
        logger.error("[HTTP] OPENANSWERUI_DIR does not exist: %s", OPENANSWERUI_DIR)
        return jsonify({"ok": False, "error": "openanswerui_not_found"}), 500

    return send_from_directory(OPENANSWERUI_DIR, filename)


@static_bp.route("/ui/MistakesUI/<path:filename>", methods=["GET"])
def serve_mistakesui_static(filename: str) -> Any:
    dirs = _get_ui_dirs()
    MISTAKESUI_DIR = dirs.get("MISTAKESUI_DIR")
    if not MISTAKESUI_DIR or not MISTAKESUI_DIR.exists():
        logger.error("[HTTP] MISTAKESUI_DIR does not exist: %s", MISTAKESUI_DIR)
        return jsonify({"ok": False, "error": "mistakesui_not_found"}), 500

    return send_from_directory(MISTAKESUI_DIR, filename)


# ---------------------------------------------------------------------------
# Theory Center UI
# ---------------------------------------------------------------------------

@static_bp.route("/ui/theory-center", methods=["GET"])
@static_bp.route("/ui/theory-center/", methods=["GET"])
def serve_theory_center_ui() -> Any:
    """Serve the standalone Theory Center overview UI."""
    dirs = _get_ui_dirs()
    EDITOR_UI_DIR = dirs.get("EDITOR_UI_DIR")
    if not EDITOR_UI_DIR or not EDITOR_UI_DIR.exists():
        logger.error("[HTTP] EDITOR_UI_DIR does not exist: %s", EDITOR_UI_DIR)
        return jsonify({"ok": False, "error": "editor_ui_not_found"}), 500

    resp = send_from_directory(EDITOR_UI_DIR, "Theory_Center.html")
    try:
        resp.headers["Cache-Control"] = "no-store"
    except Exception:
        pass
    return resp


@static_bp.route("/ui/editor/theory_center.js", methods=["GET"])
def serve_theory_center_js() -> Any:
    """Serve the Theory Center JavaScript directly."""
    dirs = _get_ui_dirs()
    EDITOR_UI_DIR = dirs.get("EDITOR_UI_DIR")
    if not EDITOR_UI_DIR or not EDITOR_UI_DIR.exists():
        logger.error("[HTTP] EDITOR_UI_DIR does not exist: %s", EDITOR_UI_DIR)
        return jsonify({"ok": False, "error": "editor_ui_not_found"}), 500
    return send_from_directory(EDITOR_UI_DIR, "theory_center.js")


@static_bp.route("/ui/theory-editor", methods=["GET"])
@static_bp.route("/ui/theory-editor/", methods=["GET"])
def serve_theory_editor_ui() -> Any:
    """Serve the Theory Editor UI."""
    dirs = _get_ui_dirs()
    EDITOR_UI_DIR = dirs.get("EDITOR_UI_DIR")
    if not EDITOR_UI_DIR or not EDITOR_UI_DIR.exists():
        logger.error("[HTTP] EDITOR_UI_DIR does not exist: %s", EDITOR_UI_DIR)
        return jsonify({"ok": False, "error": "editor_ui_not_found"}), 500

    resp = send_from_directory(EDITOR_UI_DIR, "Theory_Editor.html")
    try:
        resp.headers["Cache-Control"] = "no-store"
    except Exception:
        pass
    return resp


# ---------------------------------------------------------------------------
# Editor UI
# ---------------------------------------------------------------------------

@static_bp.route("/ui/editor", methods=["GET"])
@static_bp.route("/ui/editor/", methods=["GET"])
def serve_editor_dashboard() -> Any:
    """Serve the Editor Main Dashboard."""
    dirs = _get_ui_dirs()
    EDITOR_UI_DIR = dirs.get("EDITOR_UI_DIR")
    if not EDITOR_UI_DIR or not EDITOR_UI_DIR.exists():
        logger.error("[HTTP] EDITOR_UI_DIR does not exist: %s", EDITOR_UI_DIR)
        return jsonify({"ok": False, "error": "editor_ui_not_found"}), 500

    resp = send_from_directory(EDITOR_UI_DIR, "Main_Dashboard.html")
    try:
        resp.headers["Cache-Control"] = "no-store"
    except Exception:
        pass
    return resp


@static_bp.route("/ui/editor/<path:filename>", methods=["GET"])
def serve_editor_file(filename: str) -> Any:
    """Serve any file (HTML, CSS, JS) from the Editor directory."""
    dirs = _get_ui_dirs()
    EDITOR_UI_DIR = dirs.get("EDITOR_UI_DIR")
    if not EDITOR_UI_DIR or not EDITOR_UI_DIR.exists():
        return jsonify({"ok": False, "error": "editor_ui_not_found"}), 500

    return send_from_directory(EDITOR_UI_DIR, filename)


# ---------------------------------------------------------------------------
# Calendar UI Routes
# ---------------------------------------------------------------------------

@static_bp.route("/ui/calendar.css", methods=["GET"])
def serve_calendar_css_direct() -> Any:
    """Serve calendar.css specifically."""
    dirs = _get_ui_dirs()
    CALENDAR_UI_DIR = dirs.get("CALENDAR_UI_DIR")
    if not CALENDAR_UI_DIR or not CALENDAR_UI_DIR.exists():
        return jsonify({"ok": False, "error": "calendar_ui_not_found"}), 500
    return send_from_directory(CALENDAR_UI_DIR, "calendar.css")


@static_bp.route("/ui/calendar", methods=["GET"])
@static_bp.route("/ui/calendar/", methods=["GET"])
def serve_calendar_ui() -> Any:
    """Serve the Calendar page."""
    if not _current_user_has_premium_access():
        return _premium_required_page("Календарь")

    dirs = _get_ui_dirs()
    CALENDAR_UI_DIR = dirs.get("CALENDAR_UI_DIR")
    if not CALENDAR_UI_DIR or not CALENDAR_UI_DIR.exists():
        logger.error("[HTTP] CALENDAR_UI_DIR does not exist: %s", CALENDAR_UI_DIR)
        return jsonify({"ok": False, "error": "calendar_ui_not_found"}), 500

    resp = send_from_directory(CALENDAR_UI_DIR, "calendar.html")
    try:
        resp.headers["Cache-Control"] = "no-store"
    except Exception:
        pass
    return resp


@static_bp.route("/ui/calendar/<path:filename>", methods=["GET"])
def serve_calendar_file(filename: str) -> Any:
    """Serve Calendar static files (CSS, JS)."""
    dirs = _get_ui_dirs()
    CALENDAR_UI_DIR = dirs.get("CALENDAR_UI_DIR")
    if not CALENDAR_UI_DIR or not CALENDAR_UI_DIR.exists():
        return jsonify({"ok": False, "error": "calendar_ui_not_found"}), 500
    return send_from_directory(CALENDAR_UI_DIR, filename)


# ---------------------------------------------------------------------------
# Statistics UI Routes
# ---------------------------------------------------------------------------

@static_bp.route("/ui/statistics", methods=["GET"])
@static_bp.route("/ui/statistics/", methods=["GET"])
def serve_statistics_ui() -> Any:
    """Serve the Statistics page."""
    if not _current_user_has_premium_access():
        return _premium_required_page("Статистика")

    dirs = _get_ui_dirs()
    STATISTICS_UI_DIR = dirs.get("STATISTICS_UI_DIR")
    if not STATISTICS_UI_DIR or not STATISTICS_UI_DIR.exists():
        logger.error("[HTTP] STATISTICS_UI_DIR does not exist: %s", STATISTICS_UI_DIR)
        return jsonify({"ok": False, "error": "statistics_ui_not_found"}), 500

    resp = send_from_directory(STATISTICS_UI_DIR, "statistics.html")
    try:
        resp.headers["Cache-Control"] = "no-store"
    except Exception:
        pass
    return resp


@static_bp.route("/ui/statistics/<path:filename>", methods=["GET"])
def serve_statistics_file(filename: str) -> Any:
    """Serve Statistics static files (CSS, JS)."""
    dirs = _get_ui_dirs()
    STATISTICS_UI_DIR = dirs.get("STATISTICS_UI_DIR")
    if not STATISTICS_UI_DIR or not STATISTICS_UI_DIR.exists():
        return jsonify({"ok": False, "error": "statistics_ui_not_found"}), 500
    return send_from_directory(STATISTICS_UI_DIR, filename)


# ---------------------------------------------------------------------------
# Microcards Runtime UI Routes (M10)
# ---------------------------------------------------------------------------

@static_bp.route("/ui/microcards", methods=["GET"])
@static_bp.route("/ui/microcards/", methods=["GET"])
def serve_microcards_ui() -> Any:
    """Serve the Microcards runtime review page (M10)."""
    dirs = _get_ui_dirs()
    MICROCARDS_UI_DIR = dirs.get("MICROCARDS_UI_DIR")
    if not MICROCARDS_UI_DIR or not MICROCARDS_UI_DIR.exists():
        logger.error("[HTTP] MICROCARDS_UI_DIR does not exist: %s", MICROCARDS_UI_DIR)
        return jsonify({"ok": False, "error": "microcards_ui_not_found"}), 500

    resp = send_from_directory(MICROCARDS_UI_DIR, "microcards.html")
    try:
        resp.headers["Cache-Control"] = "no-store"
    except Exception:
        pass
    return resp


@static_bp.route("/ui/microcards/<path:filename>", methods=["GET"])
def serve_microcards_file(filename: str) -> Any:
    """Serve Microcards static files (CSS, JS)."""
    dirs = _get_ui_dirs()
    MICROCARDS_UI_DIR = dirs.get("MICROCARDS_UI_DIR")
    if not MICROCARDS_UI_DIR or not MICROCARDS_UI_DIR.exists():
        return jsonify({"ok": False, "error": "microcards_ui_not_found"}), 500
    return send_from_directory(MICROCARDS_UI_DIR, filename)


# ---------------------------------------------------------------------------
# Settings UI Routes
# ---------------------------------------------------------------------------

@static_bp.route("/ui/settings", methods=["GET"])
@static_bp.route("/ui/settings/", methods=["GET"])
def serve_settings_ui() -> Any:
    """Serve the Settings page (AI keys, etc.)."""
    dirs = _get_ui_dirs()
    SETTINGS_UI_DIR = dirs.get("SETTINGS_UI_DIR")
    if not SETTINGS_UI_DIR or not SETTINGS_UI_DIR.exists():
        logger.error("[HTTP] SETTINGS_UI_DIR does not exist: %s", SETTINGS_UI_DIR)
        return jsonify({"ok": False, "error": "settings_ui_not_found"}), 500

    resp = send_from_directory(SETTINGS_UI_DIR, "settings.html")
    try:
        resp.headers["Cache-Control"] = "no-store"
    except Exception:
        pass
    return resp


@static_bp.route("/ui/settings/<path:filename>", methods=["GET"])
def serve_settings_file(filename: str) -> Any:
    """Serve Settings static files (CSS, JS)."""
    dirs = _get_ui_dirs()
    SETTINGS_UI_DIR = dirs.get("SETTINGS_UI_DIR")
    if not SETTINGS_UI_DIR or not SETTINGS_UI_DIR.exists():
        return jsonify({"ok": False, "error": "settings_ui_not_found"}), 500
    return send_from_directory(SETTINGS_UI_DIR, filename)


# ---------------------------------------------------------------------------
# Reference UI Routes
# ---------------------------------------------------------------------------

@static_bp.route("/ui/reference", methods=["GET"])
@static_bp.route("/ui/reference/", methods=["GET"])
def serve_reference_ui() -> Any:
    """Serve the onboarding reference page."""
    dirs = _get_ui_dirs()
    REFERENCE_UI_DIR = dirs.get("REFERENCE_UI_DIR")
    if not REFERENCE_UI_DIR or not REFERENCE_UI_DIR.exists():
        logger.error("[HTTP] REFERENCE_UI_DIR does not exist: %s", REFERENCE_UI_DIR)
        return jsonify({"ok": False, "error": "reference_ui_not_found"}), 500

    resp = send_from_directory(REFERENCE_UI_DIR, "index.html")
    try:
        resp.headers["Cache-Control"] = "no-store"
    except Exception:
        pass
    return resp


@static_bp.route("/ui/reference/<path:filename>", methods=["GET"])
def serve_reference_file(filename: str) -> Any:
    """Serve Reference static files."""
    dirs = _get_ui_dirs()
    REFERENCE_UI_DIR = dirs.get("REFERENCE_UI_DIR")
    if not REFERENCE_UI_DIR or not REFERENCE_UI_DIR.exists():
        return jsonify({"ok": False, "error": "reference_ui_not_found"}), 500
    return send_from_directory(REFERENCE_UI_DIR, filename)


# ---------------------------------------------------------------------------
# Assets
# ---------------------------------------------------------------------------

@static_bp.route("/assets/<path:filename>", methods=["GET"])
def serve_assets(filename: str) -> Any:
    """Serve global static assets (CSS, fonts)."""
    dirs = _get_ui_dirs()
    ASSETS_DIR = dirs.get("ASSETS_DIR")
    if not ASSETS_DIR or not ASSETS_DIR.exists():
        logger.error("[HTTP] ASSETS_DIR does not exist: %s", ASSETS_DIR)
        return jsonify({"ok": False, "error": "assets_dir_not_found"}), 500
    return send_from_directory(ASSETS_DIR, filename)


@static_bp.route("/ui/assets/<path:filename>", methods=["GET"])
def serve_ui_assets(filename: str) -> Any:
    """Serve global static assets via /ui/assets for relative links."""
    dirs = _get_ui_dirs()
    ASSETS_DIR = dirs.get("ASSETS_DIR")
    if not ASSETS_DIR or not ASSETS_DIR.exists():
        logger.error("[HTTP] ASSETS_DIR does not exist: %s", ASSETS_DIR)
        return jsonify({"ok": False, "error": "assets_dir_not_found"}), 500
    return send_from_directory(ASSETS_DIR, filename)


@static_bp.route("/favicon.ico")
def favicon() -> Any:
    dirs = _get_ui_dirs()
    ASSETS_DIR = dirs.get("ASSETS_DIR")
    if not ASSETS_DIR or not ASSETS_DIR.exists():
        logger.error("[HTTP] ASSETS_DIR does not exist: %s", ASSETS_DIR)
        return jsonify({"ok": False, "error": "assets_dir_not_found"}), 500
    return send_from_directory(ASSETS_DIR, "actra_white.ico", mimetype="image/x-icon")


# ---------------------------------------------------------------------------
# Session UI routes (S1, S2, S3)
# ---------------------------------------------------------------------------

@static_bp.route("/ui/session/<string:session_id>", methods=["GET"])
def serve_session_ui(session_id: str) -> Any:
    """Serve the S1 HTML UI for a given session.

    The session_id is consumed by the frontend JS — we only need to serve the HTML here.
    """
    dirs = _get_ui_dirs()
    try:
        ctx = get_ctx()
        session_api = getattr(ctx, "session_api", None)
        requested_user_id = getattr(ctx, "user_id", None)
        if session_api is not None:
            session = session_api.get_session(session_id, user_id=requested_user_id)
            if session is not None:
                ui_state = getattr(session, "ui_state", None) or {}
                ui_screen_type = (
                    ui_state.get("screen_type")
                    if isinstance(ui_state, dict)
                    else None
                )
                should_redirect = bool(getattr(session, "paused", False)) or ui_screen_type in {
                    "iteration_results",
                    "final_results",
                }
                if should_redirect:
                    resume_target = session_api.get_resume_target(session)
                    resume_url = (
                        resume_target.get("url")
                        if isinstance(resume_target, dict)
                        else None
                    )
                    session_url = f"/ui/session/{session_id}"
                    if isinstance(resume_url, str) and resume_url and resume_url != session_url:
                        logger.info(
                            "[HTTP] serve_session_ui redirect session_id=%s -> %s",
                            session_id,
                            resume_url,
                        )
                        return redirect(resume_url)
    except Exception:
        logger.exception(
            "[HTTP] Failed to resolve resume target for session %s before serving S1",
            session_id,
        )

    S1_UI_DIR = dirs.get("S1_UI_DIR")
    if not S1_UI_DIR or not S1_UI_DIR.exists():
        return jsonify({"ok": False, "error": "s1_ui_not_found"}), 500
    return send_from_directory(S1_UI_DIR, "index.html")


@static_bp.route("/ui/S1/<path:filename>", methods=["GET"])
def serve_session_static(filename: str) -> Any:
    """Serve static assets for S1 (JS/CSS)."""
    dirs = _get_ui_dirs()
    S1_UI_DIR = dirs.get("S1_UI_DIR")
    if not S1_UI_DIR or not S1_UI_DIR.exists():
        logger.error("[HTTP] S1_UI_DIR does not exist: %s", S1_UI_DIR)
        return jsonify({"ok": False, "error": "s1_ui_not_found"}), 500

    return send_from_directory(S1_UI_DIR, filename)


@static_bp.route("/ui/session/<string:session_id>/iteration/<string:iteration_id>", methods=["GET"])
def serve_iteration_results_ui(session_id: str, iteration_id: str) -> Any:
    """Serve the S2 HTML UI for iteration results.

    Both session_id and iteration_id are consumed by the frontend JS.
    """
    dirs = _get_ui_dirs()
    S2_UI_DIR = dirs.get("S2_UI_DIR")
    if not S2_UI_DIR or not S2_UI_DIR.exists():
        return jsonify({"ok": False, "error": "s2_ui_not_found"}), 500
    return send_from_directory(S2_UI_DIR, "index.html")


@static_bp.route("/ui/session/<string:session_id>/results", methods=["GET"])
def serve_session_results_ui(session_id: str) -> Any:
    """Serve the S3 HTML UI for final session results."""
    dirs = _get_ui_dirs()
    S3_UI_DIR = dirs.get("S3_UI_DIR")
    if not S3_UI_DIR or not S3_UI_DIR.exists():
        logger.error("[HTTP] S3_UI_DIR does not exist: %s", S3_UI_DIR)
        return jsonify({"ok": False, "error": "s3_ui_not_found"}), 500
    return send_from_directory(S3_UI_DIR, "index.html")
