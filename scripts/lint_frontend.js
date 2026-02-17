#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const ROOT = process.cwd();
const TARGET_DIRS = ["frontend", "scripts"];
const JS_EXTENSIONS = new Set([".js", ".cjs", ".mjs"]);
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".venv", "__pycache__"]);

function isSkippableDir(dirName) {
    return SKIP_DIRS.has(dirName);
}

function collectJsFiles(startDir, out) {
    if (!fs.existsSync(startDir)) {
        return;
    }
    const entries = fs.readdirSync(startDir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(startDir, entry.name);
        if (entry.isDirectory()) {
            if (isSkippableDir(entry.name)) {
                continue;
            }
            collectJsFiles(fullPath, out);
            continue;
        }
        if (!entry.isFile()) {
            continue;
        }
        const ext = path.extname(entry.name).toLowerCase();
        if (JS_EXTENSIONS.has(ext)) {
            out.push(fullPath);
        }
    }
}

function checkSyntax(filePath) {
    const result = cp.spawnSync(process.execPath, ["--check", filePath], {
        encoding: "utf-8",
        stdio: "pipe",
    });
    return {
        ok: result.status === 0,
        stdout: result.stdout || "",
        stderr: result.stderr || "",
    };
}

function main() {
    const files = [];
    for (const rel of TARGET_DIRS) {
        collectJsFiles(path.join(ROOT, rel), files);
    }

    if (files.length === 0) {
        console.log("frontend lint: no JavaScript files found");
        return 0;
    }

    const failures = [];
    for (const file of files) {
        const syntax = checkSyntax(file);
        if (!syntax.ok) {
            failures.push({
                file,
                output: `${syntax.stdout}${syntax.stderr}`.trim(),
            });
        }
    }

    if (failures.length > 0) {
        console.error(`frontend lint failed: ${failures.length} file(s) with syntax errors`);
        for (const f of failures) {
            const rel = path.relative(ROOT, f.file).replace(/\\/g, "/");
            console.error(`\n[${rel}]`);
            console.error(f.output || "syntax check failed");
        }
        return 1;
    }

    console.log(`frontend lint passed: ${files.length} JavaScript file(s) checked`);
    return 0;
}

process.exit(main());
