#!/usr/bin/env node
// Heuristic clinical-language linter for MARKETING copy and proposals.
// It mirrors (loosely) the rules in the Amani repo:
//   - NUTRIENT_GUIDELINES.md / supabase/functions/_shared/nutrient-policy.ts (dosing, banned supplements, prescriptive verbs)
//   - the clinical-language authority rule: no "optimal/better/worse/normal" without an authority source
//   - no diagnosis / treatment / cure claims
// The repo's policy module is the source of truth for in-app text; this linter is a safety net
// for marketing drafts only. A clean lint is NOT clinical sign-off.
//
// Usage: node lib/claims-lint.mjs <file>   or   echo "text" | node lib/claims-lint.mjs -
// Exit code: 0 = no blocking findings, 1 = blocking findings, 2 = usage error.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BANNED_SUPPLEMENTS = [
  "ashwagandha", "maca", "vitex", "chasteberry", "chaste tree", "diindolylmethane", "evening primrose", "black cohosh",
  "rhodiola", "ginseng", "saw palmetto", "berberine", "inositol", "n-acetylcysteine", "n-acetyl cysteine", "red clover",
  "dong quai", "licorice root", "milk thistle", "st john's wort", "st. john's wort", "tribulus", "fenugreek", "melatonin",
  "adaptogen", "5-htp",
];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const SUBSTANCE = /\b(supplement\w*|vitamin\w*|mineral\w*|pill\w*|capsule\w*|tablet\w*|dose\w*|dosage|vitamin d|b12|folate|iron|magnesium|omega[- ]?3|iodine|selenium|zinc)\b/i;

export const RULES = [
  { id: "evaluative-without-authority", severity: "block",
    re: /\b(optimal|optimi[sz]e[sd]?|optimum|ideal (level|range)s?|better|worse|normal|abnormal|healthy (level|range)s?)\b/gi,
    why: "Evaluative wording needs a cited clinical authority (Amani clinical-language authority rule)." },
  { id: "diagnosis-or-treatment-claim", severity: "block",
    re: /\b(diagnos\w*|detects?|screens? for|cures?|curing|treats?|treatment|heals?|reverses?|prevents?|tells you (if|whether) you have)\b/gi,
    why: "Amani is educational; it does not diagnose, treat, cure or prevent anything." },
  { id: "wellness-hype", severity: "block",
    re: /\b(balance (your )?hormones|hormone[- ]balanc\w*|detox\w*|boost (your )?\w+|fix (your )?\w+|hack (your )?\w+|clinically proven|doctor[- ]approved|fda[- ]approved|guarantee\w*)\b/gi,
    why: "Unsupported health/efficacy claim." },
  { id: "dosage", severity: "block",
    re: /\b\d+(\.\d+)?\s?(iu|mg|mcg|µg|ug|g|ml|grams|milligrams|micrograms)\b(?!\s*\/\s*(dl|l|ml)\b)/gi,
    why: "Dosage units are never allowed (NUTRIENT_GUIDELINES)." },
  { id: "banned-supplement", severity: "block",
    re: new RegExp(`\\b(${BANNED_SUPPLEMENTS.map(esc).join("|")})\\b|\\bDIM\\b|\\bNAC\\b`, "g"),
    why: "Banned supplement named (NUTRIENT_GUIDELINES deny-list)." },
  { id: "prescriptive-verb", severity: "block", needsSubstance: true,
    re: /\b(take|start taking|begin taking|consume|swallow|prescribed?)\s+(a|an|the|\d)/gi,
    why: "Prescriptive language aimed at something ingestible." },
  { id: "dosing-frequency", severity: "block", needsSubstance: true,
    re: /\b(daily|twice a day|twice per day|once a day|per day|every (day|morning|night|evening)|with food|on an empty stomach)\b/gi,
    why: "Dosing frequency/timing language next to a substance." },
  { id: "supplement-mention", severity: "warn",
    re: /\bsupplement\w*\b/gi,
    why: "Marketing should not discuss supplements at all; in-app, only allow-listed nutrients in consultative phrasing." },
  { id: "personal-health-attribute", severity: "warn",
    re: /\b(do you have|are you (suffering|struggling)|your (pcos|endometriosis|infertility|thyroid (disease|condition)|diabetes|anemia))\b/gi,
    why: "Ad platforms (e.g. Meta) restrict ads that assert or imply a person's health condition. Rephrase as general education." },
  { id: "outcome-testimonial", severity: "warn",
    re: /\b(changed my life|fixed my|my (levels|results) (improved|got better)|before (and|&) after)\b/gi,
    why: "Outcome testimonials imply efficacy; avoid unless substantiated and reviewed." },
];

export function lint(text) {
  const findings = [];
  const hasSubstance = SUBSTANCE.test(text);
  for (const r of RULES) {
    if (r.needsSubstance && !hasSubstance) continue;
    for (const m of text.matchAll(r.re)) {
      const start = Math.max(0, m.index - 40);
      findings.push({ rule: r.id, severity: r.severity, match: m[0], context: text.slice(start, m.index + m[0].length + 40).replace(/\s+/g, " "), why: r.why });
    }
  }
  return { blocking: findings.filter((f) => f.severity === "block").length, warnings: findings.filter((f) => f.severity === "warn").length, findings };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = process.argv[2];
  if (!arg) { console.error("usage: claims-lint.mjs <file|->"); process.exit(2); }
  const text = arg === "-" ? readFileSync(0, "utf8") : readFileSync(arg, "utf8");
  const res = lint(text);
  console.log(JSON.stringify(res, null, 2));
  process.exit(res.blocking ? 1 : 0);
}
