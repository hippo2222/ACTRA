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


_LEGAL_DOC_TYPES = {"terms", "privacy", "refund"}
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
        "home": "Home",
        "back_home": "Back to home",
        "language": "Language",
        "support": "Support",
        "version": "Version",
        "effective": "Effective",
        "reviewed": "Last reviewed",
        "premium": "ACTRA Premium",
    },
    "ru": {
        "pricing": "Цены",
        "refund": "Возвраты",
        "terms": "Условия",
        "privacy": "Приватность",
        "home": "Главная",
        "back_home": "Вернуться на главную",
        "language": "Язык",
        "support": "Поддержка",
        "version": "Версия",
        "effective": "Действует с",
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


def _public_nav_html(lang: str, current_path: str = "") -> str:
    labels = _PUBLIC_LABELS.get(lang, _PUBLIC_LABELS["en"])
    normalized_current = str(current_path or "").strip() or "/"
    if normalized_current in {"/terms", "/legal/terms"}:
        normalized_current = "/legal/terms"
    elif normalized_current in {"/privacy", "/legal/privacy"}:
        normalized_current = "/legal/privacy"
    items = (
        ("/pricing", labels["pricing"]),
        ("/refund", labels["refund"]),
        ("/legal/terms", labels["terms"]),
        ("/legal/privacy", labels["privacy"]),
    )
    links = []
    for path, label in items:
        active = normalized_current == path
        attrs = ' class="active" aria-current="page"' if active else ""
        links.append(f'<a href="{_localized_url(path, lang)}"{attrs}>{escape(label)}</a>')
    return f"""
      <nav aria-label="Public links">
        {"".join(links)}
      </nav>
    """


def _language_switch_html(current_path: str, lang: str) -> str:
    labels = _PUBLIC_LABELS.get(lang, _PUBLIC_LABELS["en"])
    items = []
    for code, label in (("en", "English"), ("ru", "Русский")):
        active = code == lang
        attrs = ' aria-current="page"' if active else ""
        cls = "active" if active else ""
        items.append(f'<a class="{cls}" href="{_localized_url(current_path, code)}"{attrs}>{escape(label)}</a>')
    return f'<div class="language-switch" aria-label="{escape(labels["language"])}">{"".join(items)}</div>'


def _public_base_url() -> str:
    configured = (
        str(os.environ.get("ACTRA_AUTH_PUBLIC_BASE_URL") or "").strip()
        or str(os.environ.get("ACTRA_PUBLIC_BASE_URL") or "").strip()
        or "https://actra.site"
    )
    return configured.rstrip("/") or "https://actra.site"


def _inline_markdown_to_html(text: str) -> str:
    safe = escape(str(text or ""), quote=True)
    safe = re.sub(
        r"\[([^\]]+)\]\((https?://[^)]+|mailto:[^)]+|/[^)]+)\)",
        r'<a href="\2">\1</a>',
        safe,
    )
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


def _strip_legal_document_lead(markdown: str) -> str:
    skipped_prefixes = (
        "Версия:",
        "Дата вступления в силу:",
        "Версия:",
        "Дата вступления в силу:",
        "Дата последнего пересмотра:",
        "Version:",
        "Effective date:",
        "Last reviewed:",
    )
    lines = []
    in_document_lead = True
    for raw_line in str(markdown or "").splitlines():
        line = raw_line.strip()
        if in_document_lead and any(line.startswith(prefix) for prefix in skipped_prefixes):
            continue
        if line.startswith("## "):
            in_document_lead = False
        lines.append(raw_line)
    return "\n".join(lines).strip()


def _public_page_css() -> str:
    return """
    :root {
      color-scheme: light;
      --bg: #f4efe8;
      --paper: #fffdf9;
      --paper-strong: #ffffff;
      --text: #221f1a;
      --muted: #645d55;
      --line: #dfd3c6;
      --accent: #2f2189;
      --accent-hover: #24176f;
      --accent-soft: #ebe7ff;
      --orange: #ff4b18;
      --shadow: 0 18px 44px rgba(38, 25, 16, 0.09);
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      background:
        radial-gradient(circle at top left, rgba(255, 75, 24, 0.12), transparent 34rem),
        linear-gradient(180deg, #fffaf4 0%, var(--bg) 100%);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.62;
      letter-spacing: 0;
    }
    a { color: var(--accent); font-weight: 750; text-decoration: none; }
    a:hover, a:focus-visible { color: var(--accent-hover); text-decoration: underline; text-underline-offset: 3px; }
    .wrap { width: min(1080px, calc(100% - 32px)); margin: 0 auto; }
    header {
      position: sticky;
      top: 0;
      z-index: 10;
      border-bottom: 1px solid rgba(223, 211, 198, 0.9);
      background: rgba(255, 253, 249, 0.88);
      backdrop-filter: blur(18px);
      box-shadow: 0 12px 30px rgba(38, 25, 16, 0.06);
    }
    .top {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: center;
      gap: 18px;
      min-height: 70px;
    }
    .brand {
      display: inline-flex;
      align-items: center;
      gap: 0.7rem;
      color: var(--text);
      text-decoration: none;
      min-width: 0;
    }
    .brand-logo {
      display: inline-block;
      flex: 0 0 auto;
      width: 2.35rem;
      height: 2.35rem;
      background-color: currentColor;
      color: var(--accent);
      mask: url('/assets/logo.svg') center/contain no-repeat;
      -webkit-mask: url('/assets/logo.svg') center/contain no-repeat;
    }
    .brand-word {
      display: block;
      color: var(--text);
      font-size: 1.25rem;
      font-weight: 900;
      line-height: 1;
      letter-spacing: 0;
      white-space: nowrap;
    }
    nav {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 0.35rem;
      font-size: 14px;
      font-weight: 750;
    }
    nav a {
      border-radius: 999px;
      color: var(--muted);
      padding: 0.45rem 0.72rem;
      text-decoration: none;
    }
    nav a:hover, nav a:focus-visible, nav a.active {
      background: var(--accent-soft);
      color: var(--accent);
      text-decoration: none;
    }
    .home-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 2.55rem;
      border-radius: 999px;
      padding: 0 1rem;
      font-size: 14px;
      font-weight: 850;
      text-decoration: none;
      white-space: nowrap;
    }
    .home-button {
      background: var(--accent);
      color: #ffffff;
      box-shadow: 0 12px 28px rgba(47, 33, 137, 0.2);
    }
    .home-button:hover, .home-button:focus-visible {
      background: var(--accent-hover);
      color: #ffffff;
      text-decoration: none;
    }
    main { padding: clamp(34px, 6vw, 72px) 0 78px; }
    .utility-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: clamp(20px, 4vw, 34px);
    }
    .language-switch {
      display: inline-flex;
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: rgba(255, 253, 249, 0.84);
      box-shadow: 0 8px 22px rgba(38, 25, 16, 0.04);
    }
    .language-switch a {
      min-width: 88px;
      padding: 8px 14px;
      color: var(--muted);
      font-size: 13px;
      font-weight: 850;
      text-align: center;
      text-decoration: none;
    }
    .language-switch a.active {
      background: var(--accent);
      color: #ffffff;
    }
    .hero {
      max-width: 760px;
      margin: 0 0 28px;
    }
    .hero--compact { max-width: 880px; }
    .eyebrow {
      margin: 0 0 0.55rem;
      color: var(--orange);
      font-size: 0.78rem;
      font-weight: 900;
      text-transform: uppercase;
    }
    h1 {
      margin: 0;
      color: var(--text);
      font-size: clamp(2.15rem, 5vw, 4rem);
      line-height: 1.02;
      letter-spacing: 0;
    }
    .subtitle, .meta {
      max-width: 720px;
      color: var(--muted);
      font-size: 1.05rem;
    }
    .subtitle { margin: 1rem 0 0; }
    .meta { margin: 0.8rem 0 0; font-size: 0.95rem; }
    .grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 14px;
      margin: 28px 0;
    }
    .card, .panel, .document-card {
      border: 1px solid var(--line);
      border-radius: 18px;
      background: var(--paper-strong);
      box-shadow: var(--shadow);
    }
    .card {
      display: grid;
      gap: 10px;
      min-height: 170px;
      padding: 22px;
    }
    .card strong { font-size: 1.08rem; }
    .price {
      color: var(--text);
      font-size: clamp(2.2rem, 4vw, 3.25rem);
      line-height: 1;
      font-weight: 950;
      letter-spacing: 0;
    }
    .muted { color: var(--muted); }
    .badge {
      display: inline-flex;
      width: fit-content;
      border-radius: 999px;
      background: var(--accent-soft);
      color: var(--accent);
      padding: 4px 9px;
      font-size: 12px;
      font-weight: 850;
    }
    .panel, .document-card {
      margin-top: 18px;
      padding: clamp(22px, 4vw, 38px);
    }
    .document-card {
      max-width: 920px;
    }
    .document-card > h1:first-child {
      display: none;
    }
    h2 {
      margin: 0 0 12px;
      color: var(--text);
      font-size: clamp(1.35rem, 3vw, 1.75rem);
      line-height: 1.18;
    }
    .document-card h2 {
      margin-top: 2rem;
    }
    h3 {
      margin: 1.5rem 0 0.55rem;
      font-size: 1.08rem;
      line-height: 1.25;
    }
    p { margin: 10px 0; }
    ul { margin: 12px 0 0; padding-left: 22px; }
    li { margin: 6px 0; }
    code {
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 1px 5px;
      background: #fff8ef;
      font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
      font-size: 0.92em;
    }
    footer {
      border-top: 1px solid var(--line);
      padding: 24px 0 34px;
      color: var(--muted);
      font-size: 14px;
    }
    @media (max-width: 860px) {
      .top { grid-template-columns: 1fr; gap: 12px; padding: 14px 0; }
      nav { justify-content: flex-start; }
      .home-button { width: fit-content; }
      .grid { grid-template-columns: 1fr; }
    }
    @media (max-width: 520px) {
      .wrap { width: min(100% - 24px, 1080px); }
      .utility-row { align-items: stretch; flex-direction: column; }
      .language-switch { width: 100%; }
      .language-switch a { flex: 1; min-width: 0; }
      h1 { font-size: clamp(2rem, 12vw, 3rem); }
    }
    """


def _public_shell_page(
    *,
    title: str,
    subtitle: str = "",
    body_html: str,
    lang: str,
    current_path: str,
    eyebrow: str = "",
    meta_html: str = "",
    legal: bool = False,
) -> Any:
    labels = _PUBLIC_LABELS.get(lang, _PUBLIC_LABELS["en"])
    title_html = escape(str(title or "ACTRA").strip() or "ACTRA")
    subtitle_html = escape(str(subtitle or "").strip())
    clean_eyebrow = escape(str(eyebrow or labels["premium"]).strip())
    meta_block = f'<p class="meta">{meta_html}</p>' if meta_html else ""
    subtitle_block = f'<p class="subtitle">{subtitle_html}</p>' if subtitle_html else ""
    article_class = "document-card" if legal else ""
    content_html = f'<article class="{article_class}">{body_html}</article>' if legal else body_html
    return (
        f"""<!doctype html>
<html lang="{lang}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{title_html} - ACTRA</title>
  <style>{_public_page_css()}</style>
</head>
<body>
  <header>
    <div class="wrap top">
      <a class="brand" href="/welcome" aria-label="ACTRA">
        <span class="brand-logo" aria-hidden="true"></span>
        <span class="brand-word">ACTRA</span>
      </a>
      {_public_nav_html(lang, current_path)}
      <a class="home-button" href="/welcome">{escape(labels['back_home'])}</a>
    </div>
  </header>
  <main class="wrap">
    <div class="utility-row">
      {_language_switch_html(current_path, lang)}
    </div>
    <section class="hero{' hero--compact' if legal else ''}">
      <p class="eyebrow">{clean_eyebrow}</p>
      <h1>{title_html}</h1>
      {subtitle_block}
      {meta_block}
    </section>
    {content_html}
  </main>
  <footer>
    <div class="wrap">{escape(labels['support'])}: <a href="mailto:{_SUPPORT_EMAIL}">{_SUPPORT_EMAIL}</a></div>
  </footer>
</body>
</html>""",
        200,
        {"Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store"},
    )


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
        fallback_titles = {
            "terms": "Terms of Service",
            "privacy": "Privacy Policy",
            "refund": "Refund Policy",
        }
        title = str(meta.get("title_en") or fallback_titles.get(clean_type) or "Legal document")
        version = str(meta.get("version") or "").strip()
        effective_at = str(meta.get("effective_at") or "").strip()
        last_reviewed_at = str(meta.get("last_reviewed_at") or "").strip()
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
        last_reviewed_at = str(meta.get("last_reviewed_at") or "").strip()

    if path is None or not Path(path).exists():
        return jsonify({"ok": False, "error": "document_not_found"}), 404

    content = Path(path).read_text(encoding="utf-8")
    body_html = _markdown_to_legal_html(_strip_legal_document_lead(content))
    labels = _PUBLIC_LABELS.get(lang, _PUBLIC_LABELS["en"])
    effective_date = effective_at.split("T", 1)[0] if "T" in effective_at else effective_at
    last_reviewed_date = (
        last_reviewed_at.split("T", 1)[0] if "T" in last_reviewed_at else last_reviewed_at
    )
    reviewed_label = "Дата последнего пересмотра" if lang == "ru" else labels.get("reviewed", "Last reviewed")
    meta_parts = [
        part
        for part in (
            f"{labels['version']} {version}" if version else "",
            f"{labels['effective']} {effective_date}" if effective_date else "",
            f"{reviewed_label} {last_reviewed_date}" if last_reviewed_date else "",
        )
        if part
    ]
    meta_html = escape(" · ".join(meta_parts))
    current_path = (
        "/legal/privacy"
        if clean_type == "privacy"
        else "/refund"
        if clean_type == "refund"
        else "/legal/terms"
    )

    return _public_shell_page(
        title=title,
        body_html=body_html,
        lang=lang,
        current_path=current_path,
        eyebrow=str(labels.get(clean_type) or title),
        meta_html=meta_html,
        legal=True,
    )


def _public_commerce_page(*, title: str, subtitle: str, body_html: str, lang: str, current_path: str) -> Any:
    labels = _PUBLIC_LABELS.get(lang, _PUBLIC_LABELS["en"])

    return _public_shell_page(
        title=title,
        subtitle=subtitle,
        body_html=body_html,
        lang=lang,
        current_path=current_path,
        eyebrow=str(labels["premium"]),
        legal=False,
    )


def _public_home_page() -> Any:
    lang = _public_lang("en")
    if lang == "ru":
        title = "ACTRA"
        subtitle = "Веб-приложение для создания учебных материалов, практики по заданиям и отслеживания учебного прогресса."
        body = f"""
        <section class="panel">
          <h2>Что такое ACTRA</h2>
          <p>ACTRA помогает пользователям собирать личную учебную библиотеку, создавать задания и теории, проходить учебные комплексы, повторять материал и видеть прогресс в календаре и статистике.</p>
          <p>Базовый доступ доступен после регистрации. ACTRA Premium добавляет повышенные лимиты и расширенные учебные возможности внутри web-приложения.</p>
        </section>
        <section class="grid" aria-label="ACTRA Premium prices">
          <section class="card">
            <span class="badge">ACTRA Premium</span>
            <strong>14 дней</strong>
            <div class="price">$4.99</div>
            <div class="muted">$0.36/день</div>
          </section>
          <section class="card">
            <span class="badge">ACTRA Premium</span>
            <strong>30 дней</strong>
            <div class="price">$7.99</div>
            <div class="muted">$0.27/день</div>
          </section>
          <section class="card">
            <span class="badge">ACTRA Premium</span>
            <strong>90 дней</strong>
            <div class="price">$19.99</div>
            <div class="muted">$0.22/день</div>
          </section>
        </section>
        <section class="panel">
          <h2>Цифровой доступ</h2>
          <p>ACTRA Premium является цифровой услугой. Физические товары не продаются и не доставляются. Доступ предоставляется в аккаунте пользователя после подтверждения оплаты.</p>
          <p><a href="/pricing?lang=ru">Посмотреть цены</a> · <a href="/welcome">Главная ACTRA</a> · <a href="mailto:{_SUPPORT_EMAIL}">{_SUPPORT_EMAIL}</a></p>
        </section>
        """
    else:
        title = "ACTRA"
        subtitle = "A web app for creating learning materials, practicing tasks, and tracking study progress."
        body = f"""
        <section class="panel">
          <h2>What ACTRA does</h2>
          <p>ACTRA helps users build a personal learning library, create tasks and theories, run learning complexes, review material, and follow progress through calendar and statistics views.</p>
          <p>Basic access is available after registration. ACTRA Premium adds higher limits and expanded learning workflow features inside the web app.</p>
        </section>
        <section class="grid" aria-label="ACTRA Premium prices">
          <section class="card">
            <span class="badge">ACTRA Premium</span>
            <strong>14 days</strong>
            <div class="price">$4.99</div>
            <div class="muted">$0.36/day</div>
          </section>
          <section class="card">
            <span class="badge">ACTRA Premium</span>
            <strong>30 days</strong>
            <div class="price">$7.99</div>
            <div class="muted">$0.27/day</div>
          </section>
          <section class="card">
            <span class="badge">ACTRA Premium</span>
            <strong>90 days</strong>
            <div class="price">$19.99</div>
            <div class="muted">$0.22/day</div>
          </section>
        </section>
        <section class="panel">
          <h2>Digital access</h2>
          <p>ACTRA Premium is a digital service. No physical goods are sold or shipped. Access is delivered to the user account after payment is confirmed.</p>
          <p><a href="/pricing?lang=en">View pricing</a> · <a href="/welcome">ACTRA home</a> · <a href="mailto:{_SUPPORT_EMAIL}">{_SUPPORT_EMAIL}</a></p>
        </section>
        """
    return _public_commerce_page(
        title=title,
        subtitle=subtitle,
        body_html=body,
        lang=lang,
        current_path="/",
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
    return _public_legal_document_page("refund")


# ---------------------------------------------------------------------------
# Helpers (used only by UI routes)
# ---------------------------------------------------------------------------

def _legacy_redirect(new_path: str) -> Any:
    """301-redirect from a legacy ``/ui/...`` URL to a new canonical path.

    The current request's query string is preserved so deep-link URLs like
    ``/ui/editor?module=X&topic=Y`` correctly become ``/editor?module=X&topic=Y``.
    """
    qs = request.query_string.decode("utf-8") if request.query_string else ""
    target = f"{new_path}?{qs}" if qs else new_path
    return redirect(target, code=301)


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
        <a class="btn-primary inline-flex rounded-xl px-4 py-2.5 text-sm font-semibold" href="/settings#premium">Открыть Premium</a>
        <a class="btn-secondary inline-flex rounded-xl px-4 py-2.5 text-sm font-semibold" href="/main">На главную</a>
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

@static_bp.route("/complexes", methods=["GET"])
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


@static_bp.route("/ui/complexes", methods=["GET"])
def serve_complexes_ui_legacy() -> Any:
    return _legacy_redirect("/complexes")


@static_bp.route("/complexes/create", methods=["GET"])
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


@static_bp.route("/ui/complexes/create", methods=["GET"])
def serve_complexes_create_ui_legacy() -> Any:
    return _legacy_redirect("/complexes/create")


# ---------------------------------------------------------------------------
# Catalog UI
# ---------------------------------------------------------------------------

@static_bp.route("/catalog", methods=["GET"])
@static_bp.route("/catalog/", methods=["GET"])
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


@static_bp.route("/ui/catalog", methods=["GET"])
@static_bp.route("/ui/catalog/", methods=["GET"])
def serve_catalog_ui_legacy() -> Any:
    return _legacy_redirect("/catalog")


@static_bp.route("/catalog/<path:filename>", methods=["GET"])
def serve_catalog_file(filename: str) -> Any:
    """Serve Catalog static files (HTML, JS)."""
    dirs = _get_ui_dirs()
    CATALOG_UI_DIR = dirs.get("CATALOG_UI_DIR")
    if not CATALOG_UI_DIR or not CATALOG_UI_DIR.exists():
        return jsonify({"ok": False, "error": "catalog_ui_not_found"}), 500
    return send_from_directory(CATALOG_UI_DIR, filename)


@static_bp.route("/ui/catalog/<path:filename>", methods=["GET"])
def serve_catalog_file_legacy(filename: str) -> Any:
    return _legacy_redirect(f"/catalog/{filename}")


# ---------------------------------------------------------------------------
# Welcome UI
# ---------------------------------------------------------------------------

@static_bp.route("/", methods=["GET"])
def serve_root_ui_alias() -> Any:
    """Send the product domain entry point to the public welcome experience.

    Uses 301 (permanent) so that Google Search Console treats /welcome as the
    canonical indexable URL for the root domain. The previous 302 broke
    indexing because Google declines to follow temporary redirects when
    deciding canonical URLs.
    """
    return redirect("/welcome", code=301)


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
    # /welcome is the canonical indexable entry point (/ 301-redirects to it).
    paths = ("", "welcome", "pricing", "refund", "privacy", "terms")
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


@static_bp.route("/welcome", methods=["GET"])
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


@static_bp.route("/ui/welcome", methods=["GET"])
def serve_welcome_ui_legacy() -> Any:
    return _legacy_redirect("/welcome")


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

@static_bp.route("/main", methods=["GET"])
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


@static_bp.route("/ui", methods=["GET"])
@static_bp.route("/ui/main", methods=["GET"])
def serve_main_ui_legacy() -> Any:
    return _legacy_redirect("/main")


# ---------------------------------------------------------------------------
# Task UI modules (TestUI, SequenceUI, ClickUI, DrawUI, OpenAnswerUI, MistakesUI)
# ---------------------------------------------------------------------------

@static_bp.route("/TestUI/<path:filename>", methods=["GET"])
def serve_testui_static(filename: str) -> Any:
    """Serve static JS/CSS/assets for the TestUI module used by S1.

    This allows paths like ../TestUI/TestUI.web.js in S1/index.html to be
    resolved as /TestUI/TestUI.web.js.
    """
    dirs = _get_ui_dirs()
    TESTUI_DIR = dirs.get("TESTUI_DIR")
    if not TESTUI_DIR or not TESTUI_DIR.exists():
        logger.error("[HTTP] TESTUI_DIR does not exist: %s", TESTUI_DIR)
        return jsonify({"ok": False, "error": "testui_not_found"}), 500

    return send_from_directory(TESTUI_DIR, filename)


@static_bp.route("/ui/TestUI/<path:filename>", methods=["GET"])
def serve_testui_static_legacy(filename: str) -> Any:
    return _legacy_redirect(f"/TestUI/{filename}")


@static_bp.route("/SequenceUI/<path:filename>", methods=["GET"])
def serve_sequenceui_static(filename: str) -> Any:
    dirs = _get_ui_dirs()
    SEQUENCEUI_DIR = dirs.get("SEQUENCEUI_DIR")
    if not SEQUENCEUI_DIR or not SEQUENCEUI_DIR.exists():
        logger.error("[HTTP] SEQUENCEUI_DIR does not exist: %s", SEQUENCEUI_DIR)
        return jsonify({"ok": False, "error": "sequenceui_not_found"}), 500

    return send_from_directory(SEQUENCEUI_DIR, filename)


@static_bp.route("/ui/SequenceUI/<path:filename>", methods=["GET"])
def serve_sequenceui_static_legacy(filename: str) -> Any:
    return _legacy_redirect(f"/SequenceUI/{filename}")


@static_bp.route("/ClickUI/<path:filename>", methods=["GET"])
def serve_clickui_static(filename: str) -> Any:
    dirs = _get_ui_dirs()
    CLICKUI_DIR = dirs.get("CLICKUI_DIR")
    if not CLICKUI_DIR or not CLICKUI_DIR.exists():
        logger.error("[HTTP] CLICKUI_DIR does not exist: %s", CLICKUI_DIR)
        return jsonify({"ok": False, "error": "clickui_not_found"}), 500

    resp = send_from_directory(CLICKUI_DIR, filename)
    try:
        resp.headers["Cache-Control"] = "no-store"
    except Exception:
        pass
    return resp


@static_bp.route("/ui/ClickUI/<path:filename>", methods=["GET"])
def serve_clickui_static_legacy(filename: str) -> Any:
    return _legacy_redirect(f"/ClickUI/{filename}")


@static_bp.route("/DrawUI/<path:filename>", methods=["GET"])
def serve_drawui_static(filename: str) -> Any:
    dirs = _get_ui_dirs()
    DRAWUI_DIR = dirs.get("DRAWUI_DIR")
    if not DRAWUI_DIR or not DRAWUI_DIR.exists():
        logger.error("[HTTP] DRAWUI_DIR does not exist: %s", DRAWUI_DIR)
        return jsonify({"ok": False, "error": "drawui_not_found"}), 500

    return send_from_directory(DRAWUI_DIR, filename)


@static_bp.route("/ui/DrawUI/<path:filename>", methods=["GET"])
def serve_drawui_static_legacy(filename: str) -> Any:
    return _legacy_redirect(f"/DrawUI/{filename}")


@static_bp.route("/OpenAnswerUI/<path:filename>", methods=["GET"])
def serve_openanswerui_static(filename: str) -> Any:
    dirs = _get_ui_dirs()
    OPENANSWERUI_DIR = dirs.get("OPENANSWERUI_DIR")
    if not OPENANSWERUI_DIR or not OPENANSWERUI_DIR.exists():
        logger.error("[HTTP] OPENANSWERUI_DIR does not exist: %s", OPENANSWERUI_DIR)
        return jsonify({"ok": False, "error": "openanswerui_not_found"}), 500

    return send_from_directory(OPENANSWERUI_DIR, filename)


@static_bp.route("/ui/OpenAnswerUI/<path:filename>", methods=["GET"])
def serve_openanswerui_static_legacy(filename: str) -> Any:
    return _legacy_redirect(f"/OpenAnswerUI/{filename}")


@static_bp.route("/MistakesUI/<path:filename>", methods=["GET"])
def serve_mistakesui_static(filename: str) -> Any:
    dirs = _get_ui_dirs()
    MISTAKESUI_DIR = dirs.get("MISTAKESUI_DIR")
    if not MISTAKESUI_DIR or not MISTAKESUI_DIR.exists():
        logger.error("[HTTP] MISTAKESUI_DIR does not exist: %s", MISTAKESUI_DIR)
        return jsonify({"ok": False, "error": "mistakesui_not_found"}), 500

    return send_from_directory(MISTAKESUI_DIR, filename)


@static_bp.route("/ui/MistakesUI/<path:filename>", methods=["GET"])
def serve_mistakesui_static_legacy(filename: str) -> Any:
    return _legacy_redirect(f"/MistakesUI/{filename}")


# ---------------------------------------------------------------------------
# Theory Center UI
# ---------------------------------------------------------------------------

@static_bp.route("/theory-center", methods=["GET"])
@static_bp.route("/theory-center/", methods=["GET"])
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


@static_bp.route("/ui/theory-center", methods=["GET"])
@static_bp.route("/ui/theory-center/", methods=["GET"])
def serve_theory_center_ui_legacy() -> Any:
    return _legacy_redirect("/theory-center")


@static_bp.route("/editor/theory_center.js", methods=["GET"])
def serve_theory_center_js() -> Any:
    """Serve the Theory Center JavaScript directly."""
    dirs = _get_ui_dirs()
    EDITOR_UI_DIR = dirs.get("EDITOR_UI_DIR")
    if not EDITOR_UI_DIR or not EDITOR_UI_DIR.exists():
        logger.error("[HTTP] EDITOR_UI_DIR does not exist: %s", EDITOR_UI_DIR)
        return jsonify({"ok": False, "error": "editor_ui_not_found"}), 500
    return send_from_directory(EDITOR_UI_DIR, "theory_center.js")


@static_bp.route("/ui/editor/theory_center.js", methods=["GET"])
def serve_theory_center_js_legacy() -> Any:
    return _legacy_redirect("/editor/theory_center.js")


@static_bp.route("/theory-editor", methods=["GET"])
@static_bp.route("/theory-editor/", methods=["GET"])
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


@static_bp.route("/ui/theory-editor", methods=["GET"])
@static_bp.route("/ui/theory-editor/", methods=["GET"])
def serve_theory_editor_ui_legacy() -> Any:
    return _legacy_redirect("/theory-editor")


# ---------------------------------------------------------------------------
# Editor UI
# ---------------------------------------------------------------------------

@static_bp.route("/editor", methods=["GET"])
@static_bp.route("/editor/", methods=["GET"])
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


@static_bp.route("/ui/editor", methods=["GET"])
@static_bp.route("/ui/editor/", methods=["GET"])
def serve_editor_dashboard_legacy() -> Any:
    return _legacy_redirect("/editor")


@static_bp.route("/editor/<path:filename>", methods=["GET"])
def serve_editor_file(filename: str) -> Any:
    """Serve any file (HTML, CSS, JS) from the Editor directory."""
    dirs = _get_ui_dirs()
    EDITOR_UI_DIR = dirs.get("EDITOR_UI_DIR")
    if not EDITOR_UI_DIR or not EDITOR_UI_DIR.exists():
        return jsonify({"ok": False, "error": "editor_ui_not_found"}), 500

    return send_from_directory(EDITOR_UI_DIR, filename)


@static_bp.route("/ui/editor/<path:filename>", methods=["GET"])
def serve_editor_file_legacy(filename: str) -> Any:
    return _legacy_redirect(f"/editor/{filename}")


# ---------------------------------------------------------------------------
# Calendar UI Routes
# ---------------------------------------------------------------------------

@static_bp.route("/calendar.css", methods=["GET"])
def serve_calendar_css_direct() -> Any:
    """Serve calendar.css specifically."""
    dirs = _get_ui_dirs()
    CALENDAR_UI_DIR = dirs.get("CALENDAR_UI_DIR")
    if not CALENDAR_UI_DIR or not CALENDAR_UI_DIR.exists():
        return jsonify({"ok": False, "error": "calendar_ui_not_found"}), 500
    return send_from_directory(CALENDAR_UI_DIR, "calendar.css")


@static_bp.route("/ui/calendar.css", methods=["GET"])
def serve_calendar_css_direct_legacy() -> Any:
    return _legacy_redirect("/calendar.css")


@static_bp.route("/calendar", methods=["GET"])
@static_bp.route("/calendar/", methods=["GET"])
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


@static_bp.route("/ui/calendar", methods=["GET"])
@static_bp.route("/ui/calendar/", methods=["GET"])
def serve_calendar_ui_legacy() -> Any:
    return _legacy_redirect("/calendar")


@static_bp.route("/calendar/<path:filename>", methods=["GET"])
def serve_calendar_file(filename: str) -> Any:
    """Serve Calendar static files (CSS, JS)."""
    dirs = _get_ui_dirs()
    CALENDAR_UI_DIR = dirs.get("CALENDAR_UI_DIR")
    if not CALENDAR_UI_DIR or not CALENDAR_UI_DIR.exists():
        return jsonify({"ok": False, "error": "calendar_ui_not_found"}), 500
    return send_from_directory(CALENDAR_UI_DIR, filename)


@static_bp.route("/ui/calendar/<path:filename>", methods=["GET"])
def serve_calendar_file_legacy(filename: str) -> Any:
    return _legacy_redirect(f"/calendar/{filename}")


# ---------------------------------------------------------------------------
# Statistics UI Routes
# ---------------------------------------------------------------------------

@static_bp.route("/statistics", methods=["GET"])
@static_bp.route("/statistics/", methods=["GET"])
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


@static_bp.route("/ui/statistics", methods=["GET"])
@static_bp.route("/ui/statistics/", methods=["GET"])
def serve_statistics_ui_legacy() -> Any:
    return _legacy_redirect("/statistics")


@static_bp.route("/statistics/<path:filename>", methods=["GET"])
def serve_statistics_file(filename: str) -> Any:
    """Serve Statistics static files (CSS, JS)."""
    dirs = _get_ui_dirs()
    STATISTICS_UI_DIR = dirs.get("STATISTICS_UI_DIR")
    if not STATISTICS_UI_DIR or not STATISTICS_UI_DIR.exists():
        return jsonify({"ok": False, "error": "statistics_ui_not_found"}), 500
    return send_from_directory(STATISTICS_UI_DIR, filename)


@static_bp.route("/ui/statistics/<path:filename>", methods=["GET"])
def serve_statistics_file_legacy(filename: str) -> Any:
    return _legacy_redirect(f"/statistics/{filename}")


# ---------------------------------------------------------------------------
# Microcards Runtime UI Routes (M10)
# ---------------------------------------------------------------------------

@static_bp.route("/microcards", methods=["GET"])
@static_bp.route("/microcards/", methods=["GET"])
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


@static_bp.route("/ui/microcards", methods=["GET"])
@static_bp.route("/ui/microcards/", methods=["GET"])
def serve_microcards_ui_legacy() -> Any:
    return _legacy_redirect("/microcards")


@static_bp.route("/microcards/<path:filename>", methods=["GET"])
def serve_microcards_file(filename: str) -> Any:
    """Serve Microcards static files (CSS, JS)."""
    dirs = _get_ui_dirs()
    MICROCARDS_UI_DIR = dirs.get("MICROCARDS_UI_DIR")
    if not MICROCARDS_UI_DIR or not MICROCARDS_UI_DIR.exists():
        return jsonify({"ok": False, "error": "microcards_ui_not_found"}), 500
    return send_from_directory(MICROCARDS_UI_DIR, filename)


@static_bp.route("/ui/microcards/<path:filename>", methods=["GET"])
def serve_microcards_file_legacy(filename: str) -> Any:
    return _legacy_redirect(f"/microcards/{filename}")


# ---------------------------------------------------------------------------
# Settings UI Routes
# ---------------------------------------------------------------------------

@static_bp.route("/settings", methods=["GET"])
@static_bp.route("/settings/", methods=["GET"])
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


@static_bp.route("/ui/settings", methods=["GET"])
@static_bp.route("/ui/settings/", methods=["GET"])
def serve_settings_ui_legacy() -> Any:
    return _legacy_redirect("/settings")


@static_bp.route("/settings/<path:filename>", methods=["GET"])
def serve_settings_file(filename: str) -> Any:
    """Serve Settings static files (CSS, JS)."""
    dirs = _get_ui_dirs()
    SETTINGS_UI_DIR = dirs.get("SETTINGS_UI_DIR")
    if not SETTINGS_UI_DIR or not SETTINGS_UI_DIR.exists():
        return jsonify({"ok": False, "error": "settings_ui_not_found"}), 500
    return send_from_directory(SETTINGS_UI_DIR, filename)


@static_bp.route("/ui/settings/<path:filename>", methods=["GET"])
def serve_settings_file_legacy(filename: str) -> Any:
    return _legacy_redirect(f"/settings/{filename}")


# ---------------------------------------------------------------------------
# Reference UI Routes
# ---------------------------------------------------------------------------

@static_bp.route("/reference", methods=["GET"])
@static_bp.route("/reference/", methods=["GET"])
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


@static_bp.route("/ui/reference", methods=["GET"])
@static_bp.route("/ui/reference/", methods=["GET"])
def serve_reference_ui_legacy() -> Any:
    return _legacy_redirect("/reference")


@static_bp.route("/reference/<path:filename>", methods=["GET"])
def serve_reference_file(filename: str) -> Any:
    """Serve Reference static files."""
    dirs = _get_ui_dirs()
    REFERENCE_UI_DIR = dirs.get("REFERENCE_UI_DIR")
    if not REFERENCE_UI_DIR or not REFERENCE_UI_DIR.exists():
        return jsonify({"ok": False, "error": "reference_ui_not_found"}), 500
    return send_from_directory(REFERENCE_UI_DIR, filename)


@static_bp.route("/ui/reference/<path:filename>", methods=["GET"])
def serve_reference_file_legacy(filename: str) -> Any:
    return _legacy_redirect(f"/reference/{filename}")


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

@static_bp.route("/session/<string:session_id>", methods=["GET"])
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
                    session_url = f"/session/{session_id}"
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
    resp = send_from_directory(S1_UI_DIR, "index.html")
    try:
        resp.headers["Cache-Control"] = "no-store"
    except Exception:
        pass
    return resp


@static_bp.route("/ui/session/<string:session_id>", methods=["GET"])
def serve_session_ui_legacy(session_id: str) -> Any:
    return _legacy_redirect(f"/session/{session_id}")


@static_bp.route("/S1/<path:filename>", methods=["GET"])
def serve_session_static(filename: str) -> Any:
    """Serve static assets for S1 (JS/CSS)."""
    dirs = _get_ui_dirs()
    S1_UI_DIR = dirs.get("S1_UI_DIR")
    if not S1_UI_DIR or not S1_UI_DIR.exists():
        logger.error("[HTTP] S1_UI_DIR does not exist: %s", S1_UI_DIR)
        return jsonify({"ok": False, "error": "s1_ui_not_found"}), 500

    return send_from_directory(S1_UI_DIR, filename)


@static_bp.route("/ui/S1/<path:filename>", methods=["GET"])
def serve_session_static_legacy(filename: str) -> Any:
    return _legacy_redirect(f"/S1/{filename}")


@static_bp.route("/session/<string:session_id>/iteration/<string:iteration_id>", methods=["GET"])
def serve_iteration_results_ui(session_id: str, iteration_id: str) -> Any:
    """Serve the S2 HTML UI for iteration results.

    Both session_id and iteration_id are consumed by the frontend JS.
    """
    dirs = _get_ui_dirs()
    S2_UI_DIR = dirs.get("S2_UI_DIR")
    if not S2_UI_DIR or not S2_UI_DIR.exists():
        return jsonify({"ok": False, "error": "s2_ui_not_found"}), 500
    return send_from_directory(S2_UI_DIR, "index.html")


@static_bp.route("/ui/session/<string:session_id>/iteration/<string:iteration_id>", methods=["GET"])
def serve_iteration_results_ui_legacy(session_id: str, iteration_id: str) -> Any:
    return _legacy_redirect(f"/session/{session_id}/iteration/{iteration_id}")


@static_bp.route("/session/<string:session_id>/results", methods=["GET"])
def serve_session_results_ui(session_id: str) -> Any:
    """Serve the S3 HTML UI for final session results."""
    dirs = _get_ui_dirs()
    S3_UI_DIR = dirs.get("S3_UI_DIR")
    if not S3_UI_DIR or not S3_UI_DIR.exists():
        logger.error("[HTTP] S3_UI_DIR does not exist: %s", S3_UI_DIR)
        return jsonify({"ok": False, "error": "s3_ui_not_found"}), 500
    return send_from_directory(S3_UI_DIR, "index.html")


@static_bp.route("/ui/session/<string:session_id>/results", methods=["GET"])
def serve_session_results_ui_legacy(session_id: str) -> Any:
    return _legacy_redirect(f"/session/{session_id}/results")
