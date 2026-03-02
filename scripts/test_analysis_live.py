"""
Live integration test for AI Analysis (Theory v2).

Extracts text from test files in docs/, sends them through the full
analyze_material() pipeline with real AI providers, saves all artifacts,
and produces a detailed quality evaluation report.

Usage:
    python scripts/test_analysis_live.py
    python scripts/test_analysis_live.py --files docs/25-343.pdf
    python scripts/test_analysis_live.py --out-dir reports/analysis_live_test
"""

import argparse
import json
import logging
import os
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# ---------------------------------------------------------------------------
# Path setup
# ---------------------------------------------------------------------------
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "desktop-app"))

from services.file_processor import FileProcessor
from services.ai_generation_service import (
    AIGenerationService,
    AnalysisParseError,
    AnalysisResult,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("test_analysis_live")

# ---------------------------------------------------------------------------
# Default test files
# ---------------------------------------------------------------------------
DEFAULT_TEST_FILES = [
    "docs/25-343.pdf",
    "docs/Nephr.pdf",
    "docs/VMleuko.docx",
]

# ---------------------------------------------------------------------------
# Quality evaluation
# ---------------------------------------------------------------------------

_REQUIRED_UNIT_FIELDS = {
    "id", "title", "type", "description", "explicitness",
    "evidence", "modality", "assessment_risk",
}
_OPTIONAL_UNIT_V2_FIELDS = {
    "chunk_ids", "prerequisite_unit_ids", "cognitive_ops", "factual_anchors",
}
_UNIT_TYPES = {"concept", "process", "fact", "term", "classification"}
_PRIORITY = {"high", "medium", "low"}
_RISK = {"low", "medium", "high"}
_TASK_TYPES = {"TEST", "OPEN_ANSWER", "SEQUENCE", "CLICK_TEXT", "CLICK_WORDS"}
_SEQ_INTENTS = {"ordering", "classification", "hierarchy", "ranking", "grouping"}
_CHUNK_TYPES = {
    "classification", "process", "mechanism", "contrast",
    "hierarchy", "factual_set", "other",
}
_ROUTE_KINDS = {"complex_progression", "manual_practice", "microcards_support", "hybrid"}
_SURFACES = {"complexes", "editor_manual", "microcards", "mixed"}
_CARD_TYPES = {
    "fact_recall", "term_definition", "cloze", "pair_match",
    "numeric_anchor", "contrast_pair",
}


def evaluate_analysis(
    result: AnalysisResult,
    file_name: str,
    word_count: int,
    elapsed_sec: float,
) -> Dict[str, Any]:
    """Produce a detailed quality evaluation of an AnalysisResult."""
    report: Dict[str, Any] = {
        "file": file_name,
        "word_count": word_count,
        "elapsed_sec": round(elapsed_sec, 2),
        "pass": True,
        "issues": [],
        "warnings_from_analysis": list(result.warnings or []),
        "sections": {},
    }
    issues: List[str] = report["issues"]

    def fail(msg: str) -> None:
        issues.append(msg)
        report["pass"] = False

    def warn(msg: str) -> None:
        issues.append(f"[WARN] {msg}")

    # --- 1. Schema version ---
    sv = result.analysis_schema_version
    sec_schema: Dict[str, Any] = {"analysis_schema_version": sv}
    if sv != "2.0":
        warn(f"analysis_schema_version={sv!r}, expected '2.0'")
    report["sections"]["schema"] = sec_schema

    # --- 2. Top-level fields ---
    sec_top: Dict[str, Any] = {
        "material_volume": result.material_volume,
        "target_language": result.target_language,
        "illustrations_detected": result.illustrations_detected,
        "illustrations_note": result.illustrations_note,
        "human_summary_length": len(result.human_summary or ""),
    }
    if not result.human_summary or len(result.human_summary) < 20:
        warn("human_summary is very short or empty")
    if result.material_volume not in {"small", "medium", "large"}:
        warn(f"material_volume={result.material_volume!r} is non-standard")
    report["sections"]["top_level"] = sec_top

    # --- 3. Educational units ---
    units = result.educational_units or []
    sec_units: Dict[str, Any] = {"count": len(units), "details": []}
    if len(units) < 3:
        fail(f"Only {len(units)} educational units found (expected >= 3 for meaningful material)")
    unit_ids = set()
    for u in units:
        uid = u.get("id")
        detail: Dict[str, Any] = {"id": uid, "title": u.get("title")}
        # required fields
        missing = _REQUIRED_UNIT_FIELDS - set(u.keys())
        if missing:
            fail(f"Unit {uid}: missing required fields: {missing}")
        # v2 enrichment
        v2_present = _OPTIONAL_UNIT_V2_FIELDS & set(u.keys())
        v2_missing = _OPTIONAL_UNIT_V2_FIELDS - set(u.keys())
        detail["v2_fields_present"] = sorted(v2_present)
        detail["v2_fields_missing"] = sorted(v2_missing)
        if v2_missing:
            warn(f"Unit {uid}: missing v2 fields: {sorted(v2_missing)}")
        # enum checks
        if u.get("type") not in _UNIT_TYPES:
            warn(f"Unit {uid}: type={u.get('type')!r} not in {_UNIT_TYPES}")
        if u.get("explicitness") not in {"explicit", "inferred"}:
            warn(f"Unit {uid}: explicitness={u.get('explicitness')!r}")
        if u.get("modality") not in {"text", "visual", "mixed"}:
            warn(f"Unit {uid}: modality={u.get('modality')!r}")
        if u.get("assessment_risk") not in _RISK:
            warn(f"Unit {uid}: assessment_risk={u.get('assessment_risk')!r}")
        # factual_anchors quality
        anchors = u.get("factual_anchors") or []
        if not anchors:
            warn(f"Unit {uid}: no factual_anchors")
        detail["factual_anchors_count"] = len(anchors)
        # cognitive_ops
        cog = u.get("cognitive_ops") or []
        detail["cognitive_ops"] = cog
        if not cog:
            warn(f"Unit {uid}: no cognitive_ops")
        sec_units["details"].append(detail)
        if uid in unit_ids:
            fail(f"Duplicate unit id: {uid}")
        unit_ids.add(uid)
    report["sections"]["educational_units"] = sec_units

    # --- 4. Recommendations ---
    recs = result.recommendations or []
    sec_recs: Dict[str, Any] = {"count": len(recs), "types": {}}
    if not recs:
        fail("No recommendations at all")
    total_tasks = 0
    all_covered_units = set()
    for r in recs:
        tt = r.get("task_type", "?")
        sec_recs["types"][tt] = {
            "count": r.get("count"),
            "priority": r.get("priority"),
            "covers_units": r.get("covers_units"),
            "rationale": r.get("rationale"),
        }
        total_tasks += r.get("count", 0)
        for uid in r.get("covers_units") or []:
            all_covered_units.add(uid)
        if r.get("priority") not in _PRIORITY:
            warn(f"Rec {tt}: priority={r.get('priority')!r}")
    sec_recs["total_tasks"] = total_tasks
    uncovered = unit_ids - all_covered_units
    sec_recs["uncovered_unit_ids"] = sorted(uncovered)
    if uncovered:
        warn(f"{len(uncovered)} unit(s) not covered by any recommendation: {sorted(uncovered)}")
    report["sections"]["recommendations"] = sec_recs

    # --- 5. not_recommended ---
    notrec = result.not_recommended or []
    notrec_types = {str(n.get("task_type", "")).upper() for n in notrec}
    rec_types = {str(r.get("task_type", "")).upper() for r in recs}
    all_covered_types = rec_types | notrec_types
    missing_types = _TASK_TYPES - all_covered_types
    sec_notrec: Dict[str, Any] = {
        "count": len(notrec),
        "types": [n.get("task_type") for n in notrec],
        "missing_suitability_map_types": sorted(missing_types),
    }
    if missing_types:
        warn(f"Types not in recommendations or not_recommended: {sorted(missing_types)}")
    report["sections"]["not_recommended"] = sec_notrec

    # --- 6. Learning chunks (v2) ---
    chunks = result.learning_chunks or []
    sec_chunks: Dict[str, Any] = {"count": len(chunks)}
    if not chunks:
        warn("No learning_chunks in v2 output")
    else:
        chunk_ids = set()
        for c in chunks:
            cid = c.get("id")
            if not cid:
                warn("Chunk with empty id")
            chunk_ids.add(cid)
            ctype = c.get("chunk_type")
            if ctype not in _CHUNK_TYPES:
                warn(f"Chunk {cid}: chunk_type={ctype!r} not in {_CHUNK_TYPES}")
            if not c.get("unit_ids"):
                warn(f"Chunk {cid}: no unit_ids linked")
            if not c.get("goal"):
                warn(f"Chunk {cid}: no goal")
        sec_chunks["chunk_ids"] = sorted(chunk_ids)
    report["sections"]["learning_chunks"] = sec_chunks

    # --- 7. type_progression_suitability (v2) ---
    tps = result.type_progression_suitability or []
    sec_tps: Dict[str, Any] = {"count": len(tps), "entries": []}
    if not tps:
        warn("No type_progression_suitability entries")
    for entry in tps:
        tt = entry.get("task_type", "?")
        e_info: Dict[str, Any] = {
            "task_type": tt,
            "availability": entry.get("availability"),
            "suitability": entry.get("suitability"),
            "priority": entry.get("priority"),
            "progression_is_fixed": entry.get("progression_is_fixed"),
            "level_role_map_count": len(entry.get("level_role_map") or []),
            "sequence_intents": entry.get("sequence_intents"),
            "covers_unit_ids_count": len(entry.get("covers_unit_ids") or []),
            "covers_chunk_ids_count": len(entry.get("covers_chunk_ids") or []),
        }
        # Check fixed progression (CLICK_TEXT/CLICK_WORDS are finisher types without fixed progression — expected)
        is_finisher = tt in {"CLICK_TEXT", "CLICK_WORDS"}
        if entry.get("availability") == "implemented" and not entry.get("progression_is_fixed") and not is_finisher:
            warn(f"TPS {tt}: implemented but progression_is_fixed=False")
        # Level role map quality (finisher types don't have level_role_map — expected)
        lrm = entry.get("level_role_map") or []
        if entry.get("availability") == "implemented" and not lrm and not is_finisher:
            warn(f"TPS {tt}: implemented but no level_role_map")
        # Sequence intents
        if tt == "SEQUENCE":
            si = entry.get("sequence_intents") or []
            if not si:
                warn(f"TPS SEQUENCE: no sequence_intents specified")
            for intent in si:
                if intent not in _SEQ_INTENTS:
                    warn(f"TPS SEQUENCE: invalid intent={intent!r}")
        sec_tps["entries"].append(e_info)
    report["sections"]["type_progression_suitability"] = sec_tps

    # --- 8. authoring_routes (v2) ---
    routes = result.authoring_routes or []
    sec_routes: Dict[str, Any] = {"count": len(routes), "summaries": []}
    if not routes:
        warn("No authoring_routes in v2 output")
    for route in routes:
        rid = route.get("id", "?")
        r_info: Dict[str, Any] = {
            "id": rid,
            "title": route.get("title"),
            "route_kind": route.get("route_kind"),
            "target_surface": route.get("target_surface"),
            "steps_count": len(route.get("steps") or []),
            "effort_estimate": route.get("effort_estimate"),
            "has_anti_patterns": bool(route.get("anti_patterns")),
            "has_expected_effect": bool(route.get("expected_effect")),
        }
        rk = route.get("route_kind")
        if rk and rk not in _ROUTE_KINDS:
            warn(f"Route {rid}: route_kind={rk!r} not in {_ROUTE_KINDS}")
        ts = route.get("target_surface")
        if ts and ts not in _SURFACES:
            warn(f"Route {rid}: target_surface={ts!r} not in {_SURFACES}")
        steps = route.get("steps") or []
        if not steps:
            warn(f"Route {rid}: no steps")
        for step in steps:
            pp = step.get("progression_policy")
            if pp == "pick_only_level":
                fail(f"Route {rid}: step uses forbidden pick_only_level policy")
        sec_routes["summaries"].append(r_info)
    report["sections"]["authoring_routes"] = sec_routes

    # --- 9. coverage_plan (v2) ---
    cp = result.coverage_plan or {}
    sec_cp: Dict[str, Any] = {"present": bool(cp)}
    if not cp:
        warn("No coverage_plan in v2 output")
    else:
        sec_cp["has_unit_targets"] = bool(cp.get("unit_targets"))
        sec_cp["has_chunk_targets"] = bool(cp.get("chunk_targets"))
        sec_cp["unit_targets_count"] = len(cp.get("unit_targets") or [])
        sec_cp["chunk_targets_count"] = len(cp.get("chunk_targets") or [])
    report["sections"]["coverage_plan"] = sec_cp

    # --- 10. future_capabilities (v2) ---
    fc = result.future_capabilities or []
    sec_fc: Dict[str, Any] = {"count": len(fc)}
    has_pair_matching = False
    for cap in fc:
        if cap.get("capability_id") == "pair_matching":
            has_pair_matching = True
            if cap.get("status") not in {"planned", "microcards_mvp", "implemented"}:
                warn(f"pair_matching: status={cap.get('status')!r}")
            if cap.get("recommended_surface") != "microcards":
                warn(f"pair_matching: recommended_surface={cap.get('recommended_surface')!r}")
    sec_fc["has_pair_matching"] = has_pair_matching
    if not has_pair_matching:
        warn("future_capabilities missing pair_matching entry")
    report["sections"]["future_capabilities"] = sec_fc

    # --- 11. microcards_candidates (v2) ---
    mc = result.microcards_candidates or []
    sec_mc: Dict[str, Any] = {"count": len(mc)}
    if not mc:
        warn("No microcards_candidates")
    else:
        card_types_seen = set()
        for card in mc:
            ct = card.get("card_type")
            card_types_seen.add(ct)
            if ct and ct not in _CARD_TYPES:
                warn(f"Microcard candidate: card_type={ct!r} not in {_CARD_TYPES}")
        sec_mc["card_types"] = sorted(card_types_seen)
    report["sections"]["microcards_candidates"] = sec_mc

    # --- 12. report_blocks (v2) ---
    rb = result.report_blocks or []
    sec_rb: Dict[str, Any] = {
        "count": len(rb),
        "report_blocks_version": result.report_blocks_version,
    }
    if not rb:
        warn("No report_blocks")
    else:
        block_types = [b.get("type") for b in rb]
        sec_rb["block_types"] = block_types
        has_toc = "toc" in block_types
        has_section = "section" in block_types
        sec_rb["has_toc"] = has_toc
        sec_rb["has_section"] = has_section
        if not has_toc:
            warn("report_blocks: no toc block")
        if not has_section:
            warn("report_blocks: no section block")
    report["sections"]["report_blocks"] = sec_rb

    # --- 13. report_lint ---
    rl = result.report_lint or {}
    sec_rl: Dict[str, Any] = {
        "present": bool(rl),
        "verbosity_risk": rl.get("verbosity_risk"),
        "duplicate_content_signals": rl.get("duplicate_content_signals"),
        "fallback_renderer_recommended": rl.get("fallback_renderer_recommended"),
    }
    report["sections"]["report_lint"] = sec_rl

    # --- 14. capability_matrix annotations ---
    sec_cm: Dict[str, Any] = {
        "capability_matrix_version": result.capability_matrix_version,
        "has_validation": result.capability_matrix_validation is not None,
    }
    if not result.capability_matrix_version:
        warn("capability_matrix_version is missing")
    report["sections"]["capability_matrix"] = sec_cm

    # --- Summary scores ---
    total_issues = len(issues)
    hard_fails = [i for i in issues if not i.startswith("[WARN]")]
    soft_warns = [i for i in issues if i.startswith("[WARN]")]

    # V2 completeness score
    v2_fields_checks = {
        "learning_chunks": bool(chunks),
        "type_progression_suitability": bool(tps),
        "authoring_routes": bool(routes),
        "coverage_plan": bool(cp),
        "future_capabilities": bool(fc),
        "microcards_candidates": bool(mc),
        "report_blocks": bool(rb),
        "report_lint": bool(rl),
        "analysis_schema_version_2.0": sv == "2.0",
    }
    v2_score = sum(v2_fields_checks.values()) / len(v2_fields_checks) * 100

    report["summary"] = {
        "total_issues": total_issues,
        "hard_fails": len(hard_fails),
        "soft_warnings": len(soft_warns),
        "v2_completeness_pct": round(v2_score, 1),
        "v2_field_checks": v2_fields_checks,
        "educational_units_count": len(units),
        "total_recommended_tasks": total_tasks,
        "recommendation_types_count": len(recs),
    }

    return report


# ---------------------------------------------------------------------------
# Main test runner
# ---------------------------------------------------------------------------

def run_test(
    test_files: List[str],
    out_dir: Path,
    data_dir: Path,
) -> Dict[str, Any]:
    """Run live analysis tests against real AI providers."""
    out_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

    fp = FileProcessor()
    svc = AIGenerationService(data_dir)

    if not svc.is_configured:
        logger.error("AI service is not configured (no providers). Check data/ai_config.json")
        return {"error": "ai_not_configured"}

    # Filter out mock providers for live testing
    real_providers = [p for p in svc._providers if p.name != "mock"]
    if not real_providers:
        logger.error(
            "No real AI providers configured (only mock found). "
            "Add OpenRouter/Gemini/Groq keys to data/ai_config.json"
        )
        return {"error": "no_real_providers"}
    # Replace provider list with real-only providers for this test run
    svc._providers = real_providers

    logger.info("AI service configured with %d real provider(s)", len(svc._providers))
    for p in svc._providers:
        logger.info("  Provider: %s model=%s", p.name, p.model)

    overall: Dict[str, Any] = {
        "timestamp": timestamp,
        "files_tested": [],
        "results": [],
    }

    for file_rel in test_files:
        file_path = PROJECT_ROOT / file_rel
        file_name = file_path.name
        logger.info("=" * 70)
        logger.info("Testing: %s", file_name)
        logger.info("=" * 70)

        entry: Dict[str, Any] = {
            "file": file_name,
            "file_path": str(file_path),
            "status": "pending",
        }

        # 1. Extract text
        if not file_path.exists():
            entry["status"] = "file_not_found"
            entry["error"] = f"File not found: {file_path}"
            logger.error(entry["error"])
            overall["results"].append(entry)
            continue

        file_bytes = file_path.read_bytes()
        extraction = fp.process_file(file_bytes, file_name)
        entry["extraction"] = {
            "ok": extraction.ok,
            "word_count": extraction.word_count,
            "file_info": extraction.file_info,
            "warnings": extraction.warnings,
        }

        if not extraction.ok:
            entry["status"] = "extraction_failed"
            entry["error"] = extraction.error_message
            logger.error("Extraction failed for %s: %s", file_name, extraction.error_message)
            overall["results"].append(entry)
            continue

        logger.info(
            "Extracted %d words from %s (format=%s, size=%.2f MB)",
            extraction.word_count,
            file_name,
            extraction.file_info.get("format", "?"),
            extraction.file_info.get("size_mb", 0),
        )

        # Save extracted text
        text_out = out_dir / f"{file_path.stem}_extracted_text.txt"
        text_out.write_text(extraction.extracted_text, encoding="utf-8")
        logger.info("Saved extracted text to %s", text_out.name)

        # 2. Run analysis
        logger.info("Sending to AI for analysis...")
        t0 = time.time()
        try:
            analysis_result, provider_name = svc.analyze_material(extraction.extracted_text)
            elapsed = time.time() - t0
            provider_chain = svc.consume_last_provider_chain_attempts()

            entry["analysis"] = {
                "ok": True,
                "provider_used": provider_name,
                "elapsed_sec": round(elapsed, 2),
                "provider_chain_attempts": provider_chain,
            }
            entry["status"] = "analyzed"

            logger.info(
                "Analysis complete: provider=%s elapsed=%.1fs units=%d recs=%d",
                provider_name,
                elapsed,
                len(analysis_result.educational_units),
                len(analysis_result.recommendations),
            )

            # Save raw analysis result
            result_dict = analysis_result.to_dict()
            result_dict["human_summary"] = analysis_result.human_summary
            result_out = out_dir / f"{file_path.stem}_analysis_result.json"
            result_out.write_text(
                json.dumps(result_dict, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            logger.info("Saved analysis result to %s", result_out.name)

            # 3. Evaluate quality
            logger.info("Evaluating quality...")
            evaluation = evaluate_analysis(
                analysis_result,
                file_name,
                extraction.word_count,
                elapsed,
            )
            entry["evaluation"] = evaluation

            eval_out = out_dir / f"{file_path.stem}_evaluation.json"
            eval_out.write_text(
                json.dumps(evaluation, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            logger.info("Saved evaluation to %s", eval_out.name)

            # Print summary
            summary = evaluation.get("summary", {})
            v2_pct = summary.get("v2_completeness_pct", 0)
            hard = summary.get("hard_fails", 0)
            soft = summary.get("soft_warnings", 0)
            status_emoji = "PASS" if hard == 0 else "FAIL"
            logger.info(
                "[%s] %s: v2=%s%% units=%d tasks=%d hard_fails=%d warnings=%d (%.1fs)",
                status_emoji,
                file_name,
                v2_pct,
                summary.get("educational_units_count", 0),
                summary.get("total_recommended_tasks", 0),
                hard,
                soft,
                elapsed,
            )

            # Print issues
            for issue in evaluation.get("issues", []):
                prefix = "  WARN:" if issue.startswith("[WARN]") else "  FAIL:"
                logger.info("%s %s", prefix, issue)

        except AnalysisParseError as e:
            elapsed = time.time() - t0
            provider_chain = svc.consume_last_provider_chain_attempts()
            entry["status"] = "parse_error"
            entry["analysis"] = {
                "ok": False,
                "error": str(e),
                "raw_preview": (e.raw_text or "")[:2000],
                "provider_name": e.provider_name,
                "elapsed_sec": round(elapsed, 2),
                "provider_chain_attempts": provider_chain,
            }
            logger.error("Analysis parse error for %s: %s", file_name, e)

            # Save raw response for debugging
            if e.raw_text:
                raw_out = out_dir / f"{file_path.stem}_raw_response.txt"
                raw_out.write_text(e.raw_text, encoding="utf-8")
                logger.info("Saved raw response to %s", raw_out.name)

        except RuntimeError as e:
            elapsed = time.time() - t0
            provider_chain = svc.consume_last_provider_chain_attempts()
            entry["status"] = "provider_error"
            entry["analysis"] = {
                "ok": False,
                "error": str(e),
                "elapsed_sec": round(elapsed, 2),
                "provider_chain_attempts": provider_chain,
            }
            logger.error("All providers failed for %s: %s", file_name, e)

        except Exception as e:
            elapsed = time.time() - t0
            entry["status"] = "unexpected_error"
            entry["analysis"] = {
                "ok": False,
                "error": str(e),
                "traceback": traceback.format_exc(),
                "elapsed_sec": round(elapsed, 2),
            }
            logger.exception("Unexpected error for %s", file_name)

        overall["results"].append(entry)
        overall["files_tested"].append(file_name)

    # ---------------------------------------------------------------------------
    # Aggregate summary
    # ---------------------------------------------------------------------------
    logger.info("=" * 70)
    logger.info("AGGREGATE SUMMARY")
    logger.info("=" * 70)

    analyzed = [r for r in overall["results"] if r["status"] == "analyzed"]
    failed = [r for r in overall["results"] if r["status"] != "analyzed"]

    overall["aggregate"] = {
        "total_files": len(test_files),
        "analyzed_ok": len(analyzed),
        "failed": len(failed),
        "failed_files": [r["file"] for r in failed],
    }

    if analyzed:
        v2_scores = [
            r["evaluation"]["summary"]["v2_completeness_pct"]
            for r in analyzed if "evaluation" in r
        ]
        hard_fails_total = sum(
            r["evaluation"]["summary"]["hard_fails"]
            for r in analyzed if "evaluation" in r
        )
        soft_warns_total = sum(
            r["evaluation"]["summary"]["soft_warnings"]
            for r in analyzed if "evaluation" in r
        )
        avg_v2 = sum(v2_scores) / len(v2_scores) if v2_scores else 0

        overall["aggregate"]["avg_v2_completeness_pct"] = round(avg_v2, 1)
        overall["aggregate"]["total_hard_fails"] = hard_fails_total
        overall["aggregate"]["total_soft_warnings"] = soft_warns_total

        logger.info("Analyzed: %d/%d files", len(analyzed), len(test_files))
        logger.info("Avg v2 completeness: %.1f%%", avg_v2)
        logger.info("Total hard fails: %d", hard_fails_total)
        logger.info("Total soft warnings: %d", soft_warns_total)

        # Collect all unique issues across files for cross-cutting analysis
        all_issues: Dict[str, List[str]] = {}
        for r in analyzed:
            ev = r.get("evaluation", {})
            for issue in ev.get("issues", []):
                all_issues.setdefault(issue, []).append(r["file"])

        if all_issues:
            logger.info("\nCross-cutting issues:")
            # Sort: issues appearing in more files first
            sorted_issues = sorted(all_issues.items(), key=lambda x: -len(x[1]))
            for issue, files in sorted_issues[:30]:
                logger.info(
                    "  [%d file(s)] %s — %s",
                    len(files),
                    issue,
                    ", ".join(files),
                )
            overall["aggregate"]["cross_cutting_issues"] = {
                issue: files for issue, files in sorted_issues
            }

    for r in failed:
        logger.error("FAILED: %s — %s", r["file"], r.get("error", r.get("status")))

    # Save overall report
    report_out = out_dir / f"overall_report_{timestamp}.json"
    report_out.write_text(
        json.dumps(overall, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    logger.info("\nFull report saved to: %s", report_out)

    # Also generate a human-readable markdown summary
    md_lines = _generate_markdown_summary(overall, timestamp)
    md_out = out_dir / f"summary_{timestamp}.md"
    md_out.write_text("\n".join(md_lines), encoding="utf-8")
    logger.info("Markdown summary saved to: %s", md_out)

    return overall


def _generate_markdown_summary(
    overall: Dict[str, Any],
    timestamp: str,
) -> List[str]:
    """Generate a human-readable markdown summary of test results."""
    lines: List[str] = []
    lines.append(f"# AI Analysis Live Test Report — {timestamp}")
    lines.append("")

    agg = overall.get("aggregate", {})
    lines.append("## Overview")
    lines.append("")
    lines.append(f"- **Files tested**: {agg.get('total_files', 0)}")
    lines.append(f"- **Analyzed OK**: {agg.get('analyzed_ok', 0)}")
    lines.append(f"- **Failed**: {agg.get('failed', 0)}")
    if agg.get("failed_files"):
        lines.append(f"- **Failed files**: {', '.join(agg['failed_files'])}")
    lines.append(f"- **Avg v2 completeness**: {agg.get('avg_v2_completeness_pct', 0)}%")
    lines.append(f"- **Total hard fails**: {agg.get('total_hard_fails', 0)}")
    lines.append(f"- **Total soft warnings**: {agg.get('total_soft_warnings', 0)}")
    lines.append("")

    for result in overall.get("results", []):
        file_name = result.get("file", "?")
        lines.append(f"## {file_name}")
        lines.append("")

        if result["status"] != "analyzed":
            lines.append(f"**Status**: {result['status']}")
            lines.append(f"**Error**: {result.get('error', 'unknown')}")
            lines.append("")
            continue

        ev = result.get("evaluation", {})
        summary = ev.get("summary", {})
        analysis = result.get("analysis", {})
        extraction = result.get("extraction", {})

        lines.append(f"- **Status**: analyzed")
        lines.append(f"- **Provider**: {analysis.get('provider_used', '?')}")
        lines.append(f"- **Elapsed**: {analysis.get('elapsed_sec', '?')}s")
        lines.append(f"- **Word count**: {extraction.get('word_count', '?')}")
        lines.append(f"- **V2 completeness**: {summary.get('v2_completeness_pct', 0)}%")
        lines.append(f"- **Educational units**: {summary.get('educational_units_count', 0)}")
        lines.append(f"- **Recommended tasks**: {summary.get('total_recommended_tasks', 0)}")
        lines.append(f"- **Hard fails**: {summary.get('hard_fails', 0)}")
        lines.append(f"- **Warnings**: {summary.get('soft_warnings', 0)}")
        lines.append("")

        # V2 field checks
        v2_checks = summary.get("v2_field_checks", {})
        if v2_checks:
            lines.append("### V2 Field Presence")
            lines.append("")
            lines.append("| Field | Present |")
            lines.append("|-------|---------|")
            for field, present in sorted(v2_checks.items()):
                icon = "yes" if present else "**NO**"
                lines.append(f"| {field} | {icon} |")
            lines.append("")

        # Issues
        issues = ev.get("issues", [])
        if issues:
            lines.append("### Issues")
            lines.append("")
            for issue in issues:
                prefix = "WARN" if issue.startswith("[WARN]") else "FAIL"
                clean = issue.replace("[WARN] ", "")
                lines.append(f"- **{prefix}**: {clean}")
            lines.append("")

        # Sections detail
        sections = ev.get("sections", {})

        # TPS detail
        tps = sections.get("type_progression_suitability", {})
        entries = tps.get("entries", [])
        if entries:
            lines.append("### Type Progression Suitability")
            lines.append("")
            lines.append("| Task Type | Availability | Suitability | Priority | Fixed | Levels | Seq Intents |")
            lines.append("|-----------|-------------|-------------|----------|-------|--------|-------------|")
            for e in entries:
                lines.append(
                    f"| {e.get('task_type','?')} "
                    f"| {e.get('availability','?')} "
                    f"| {e.get('suitability','?')} "
                    f"| {e.get('priority','?')} "
                    f"| {e.get('progression_is_fixed','?')} "
                    f"| {e.get('level_role_map_count',0)} "
                    f"| {e.get('sequence_intents','') or '-'} |"
                )
            lines.append("")

        # Routes summary
        routes_sec = sections.get("authoring_routes", {})
        route_summaries = routes_sec.get("summaries", [])
        if route_summaries:
            lines.append("### Authoring Routes")
            lines.append("")
            for rs in route_summaries:
                lines.append(
                    f"- **{rs.get('id','?')}**: {rs.get('title','?')} "
                    f"(kind={rs.get('route_kind','?')}, surface={rs.get('target_surface','?')}, "
                    f"steps={rs.get('steps_count',0)}, effort={rs.get('effort_estimate','?')})"
                )
            lines.append("")

        # Microcards
        mc_sec = sections.get("microcards_candidates", {})
        if mc_sec.get("count", 0) > 0:
            lines.append(f"### Microcards Candidates: {mc_sec['count']}")
            if mc_sec.get("card_types"):
                lines.append(f"- Card types: {', '.join(mc_sec['card_types'])}")
            lines.append("")

    # Cross-cutting
    cross = agg.get("cross_cutting_issues", {})
    if cross:
        lines.append("## Cross-Cutting Issues")
        lines.append("")
        sorted_cross = sorted(cross.items(), key=lambda x: -len(x[1]))
        for issue, files in sorted_cross[:20]:
            prefix = "WARN" if issue.startswith("[WARN]") else "FAIL"
            clean = issue.replace("[WARN] ", "")
            lines.append(f"- **{prefix}** ({len(files)} file(s)): {clean}")
        lines.append("")

    return lines


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Live AI Analysis Integration Test")
    parser.add_argument(
        "--files",
        nargs="*",
        default=None,
        help="Specific test files (relative to project root). Default: all 3 docs files.",
    )
    parser.add_argument(
        "--out-dir",
        default=None,
        help="Output directory for results. Default: reports/analysis_live_test/",
    )
    parser.add_argument(
        "--data-dir",
        default=None,
        help="Data directory with ai_config.json. Default: data/",
    )
    args = parser.parse_args()

    test_files = args.files or DEFAULT_TEST_FILES
    out_dir = Path(args.out_dir) if args.out_dir else PROJECT_ROOT / "reports" / "analysis_live_test"
    data_dir = Path(args.data_dir) if args.data_dir else PROJECT_ROOT / "data"

    logger.info("Project root: %s", PROJECT_ROOT)
    logger.info("Data dir: %s", data_dir)
    logger.info("Output dir: %s", out_dir)
    logger.info("Test files: %s", test_files)

    result = run_test(test_files, out_dir, data_dir)

    # Exit code
    agg = result.get("aggregate", {})
    if agg.get("failed", 0) > 0 or agg.get("total_hard_fails", 0) > 0:
        sys.exit(1)
    sys.exit(0)


if __name__ == "__main__":
    main()
