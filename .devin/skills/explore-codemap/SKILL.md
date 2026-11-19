---
name: explore-codemap
description: Map the code a slice touches before writing - find the entry point, the exact exports and signatures in CODEMAP, the matching pattern, and the laws at stake
argument-hint: "<entry point or feature>"
agent: forge-scout
triggers:
  - user
  - model
---

Map: $ARGUMENTS

## Steps

1. Find the feature in `docs/CODEMAP.md`. Note each file, its layer (core / extension / webview / test) and the
   exact export names it lists.
2. Read each listed file **in full** (it may not exist yet; CODEMAP is the plan, and that is fine).
3. Follow callers one level up and callees one level down. Stop at two.
4. Find the recipe in `docs/PATTERNS.md`, and the rule that governs it (05 V3Code reference, 10 architecture,
   20 TrueForge, 30 review, 40 context, 50 modes/policy/crew, 60 latency, 70 models, 80 testing, 85 instructions).
   Then find the matching row in `docs/study/v3code.md` §15 (adopt / adapt / skip).
5. List the laws at stake (AGENTS.md 1–8) and the scoring row it serves (rule 00).

## Output contract

```
FILES:    <path — layer — exists? — exports used>
FLOW:     <caller → this → callee, one line>
PATTERN:  <P# name>   RULE: <##>
V3CODE:   <study §n — the idea, and the V3Code file it comes from | "none">
LAWS:     <numbers + one-line why each applies>
SERVES:   <A1 … C2>
UNKNOWN:  <any name not in CODEMAP or a .d.ts — must be resolved by research-web before editing>
```

An empty `UNKNOWN` line is the precondition for `/ship-slice`.
