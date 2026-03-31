import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface AnalyteData {
  id: string;
  raw_name: string;
  canonical_slug: string | null;
  value_numeric: number;
  raw_value_text: string | null;
  unit: string | null;
  raw_reference_range: string | null;
  normalized_min: number | null;
  normalized_max: number | null;
  normalized_operator: string | null;
  normalized_operator_value: number | null;
  is_core: boolean;
}

interface LabReportData {
  id: string;
  report_date: string;
  estimated_cycle_day: number | null;
  estimated_cycle_phase: string | null;
  context: {
    birth_control?: string;
    pregnant?: string;
    postpartum?: string;
    top_symptoms?: string[];
  };
}

type AnalyteStatus = "in_range" | "out_of_range" | "borderline" | "unknown";

interface PatternCandidate {
  title: string;
  confidence: "low" | "medium" | "high";
  explanation: string;
  related_biomarkers: string[];
}

interface ReportFacts {
  top_out_of_range: AnalyteData[];
  top_borderline: AnalyteData[];
  reassuring_in_range: AnalyteData[];
  matched_patterns: PatternCandidate[];
  missing_followup_labs: string[];
  cycle_notes: string;
  context_notes: string[];
}

// ─── Classification ───────────────────────────────────────────────────────────

function classifyAnalyte(a: AnalyteData): AnalyteStatus {
  const v = Number(a.value_numeric);
  if (a.normalized_min !== null && a.normalized_max !== null) {
    const min = Number(a.normalized_min);
    const max = Number(a.normalized_max);
    const buf = (max - min) * 0.08;
    if (v < min - buf || v > max + buf) return "out_of_range";
    if (v < min || v > max) return "borderline";
    return "in_range";
  }
  if (a.normalized_operator && a.normalized_operator_value !== null) {
    const val = Number(a.normalized_operator_value);
    const op = a.normalized_operator;
    if (op === "<" || op === "<=" || op === "< OR =") return v <= val ? "in_range" : "out_of_range";
    if (op === ">" || op === ">=" || op === "> OR =") return v >= val ? "in_range" : "out_of_range";
  }
  return "unknown";
}

function slug(a: AnalyteData): string {
  return a.canonical_slug ?? a.raw_name.toLowerCase().replace(/\s+/g, "_");
}

function displayVal(a: AnalyteData): string {
  return `${a.raw_value_text ?? String(a.value_numeric)}${a.unit ? " " + a.unit : ""}`;
}

function getBySlug(analytes: AnalyteData[], s: string): AnalyteData | undefined {
  return analytes.find(a => a.canonical_slug === s);
}

// ─── Pattern Detection ────────────────────────────────────────────────────────

function detectPatterns(analytes: AnalyteData[], report: LabReportData): PatternCandidate[] {
  const patterns: PatternCandidate[] = [];
  const statusMap = new Map<string, AnalyteStatus>();
  for (const a of analytes) {
    if (a.canonical_slug) statusMap.set(a.canonical_slug, classifyAnalyte(a));
  }

  const isAbnormal = (s: string) =>
    statusMap.get(s) === "out_of_range" || statusMap.get(s) === "borderline";
  const isLow = (a: AnalyteData | undefined) => {
    if (!a || a.normalized_min === null) return false;
    return Number(a.value_numeric) < Number(a.normalized_min);
  };
  const isHigh = (a: AnalyteData | undefined) => {
    if (!a) return false;
    if (a.normalized_max !== null) return Number(a.value_numeric) > Number(a.normalized_max);
    if (a.normalized_operator === "<" && a.normalized_operator_value !== null)
      return Number(a.value_numeric) > Number(a.normalized_operator_value);
    return false;
  };

  // ── Thyroid autoimmunity ──────────────────────────────────────────────────
  const tpo = getBySlug(analytes, "tpo_antibodies");
  const tgAb = getBySlug(analytes, "tg_antibodies");
  const tsh = getBySlug(analytes, "tsh");
  const ft4 = getBySlug(analytes, "free_t4");
  const ft3 = getBySlug(analytes, "free_t3");

  const tpoHigh = tpo && isHigh(tpo);
  const tgHigh = tgAb && isHigh(tgAb);
  const thyroidFunctionAbnormal = isAbnormal("tsh") || isAbnormal("free_t4") || isAbnormal("free_t3");

  if (tpoHigh || tgHigh) {
    const related = ["tpo_antibodies", "tg_antibodies", "tsh", "free_t4", "free_t3"].filter(s =>
      analytes.some(a => a.canonical_slug === s)
    );
    const confidence: "low" | "medium" | "high" =
      (tpoHigh && tgHigh && thyroidFunctionAbnormal) ? "high" :
      (tpoHigh || tgHigh) && thyroidFunctionAbnormal ? "medium" : "low";
    patterns.push({
      title: "Thyroid Autoimmunity Pattern",
      confidence,
      explanation: `Elevated thyroid antibodies${tpoHigh && tgHigh ? " (both TPO and thyroglobulin)" : tpoHigh ? " (TPO)" : " (thyroglobulin)"}${thyroidFunctionAbnormal ? " alongside thyroid function markers that are outside their reference range" : ""} can be seen in autoimmune thyroid conditions. This combination is worth evaluating in context with your provider, particularly if you're experiencing symptoms like fatigue, hair changes, or temperature sensitivity.`,
      related_biomarkers: related,
    });
  } else if (isAbnormal("tsh") || isAbnormal("free_t4") || isAbnormal("free_t3")) {
    const related = ["tsh", "free_t4", "free_t3"].filter(s => analytes.some(a => a.canonical_slug === s));
    const allThreeAbnormal = isAbnormal("tsh") && (isAbnormal("free_t4") || isAbnormal("free_t3"));
    patterns.push({
      title: "Thyroid Function Variation",
      confidence: allThreeAbnormal ? "medium" : "low",
      explanation: `One or more thyroid function markers are outside their reference range. Thyroid hormones affect energy, metabolism, mood, and menstrual regularity, so this is worth a closer look in conjunction with your symptoms and full thyroid panel.`,
      related_biomarkers: related,
    });
  }

  // ── Insulin resistance / glucose dysregulation ───────────────────────────
  const glucose = getBySlug(analytes, "fasting_glucose");
  const hba1c = getBySlug(analytes, "hemoglobin_a1c");
  const insulin = getBySlug(analytes, "fasting_insulin");
  const triglycerides = getBySlug(analytes, "triglycerides");
  const hdl = getBySlug(analytes, "hdl_cholesterol");

  const glucoseAbnormal = isAbnormal("fasting_glucose");
  const hba1cAbnormal = isAbnormal("hemoglobin_a1c");
  const insulinHigh = insulin && isHigh(insulin);
  const trigsHigh = triglycerides && isHigh(triglycerides);
  const hdlLow = hdl && isLow(hdl);

  const irSignals = [glucoseAbnormal, hba1cAbnormal, insulinHigh, trigsHigh, hdlLow].filter(Boolean).length;

  if (irSignals >= 2) {
    const related = ["fasting_glucose", "hemoglobin_a1c", "fasting_insulin", "triglycerides", "hdl_cholesterol"].filter(s =>
      analytes.some(a => a.canonical_slug === s)
    );
    patterns.push({
      title: "Glucose Regulation Pattern",
      confidence: irSignals >= 3 ? "medium" : "low",
      explanation: `${irSignals} markers associated with glucose regulation are outside their reference ranges — ${[glucoseAbnormal && "fasting glucose", hba1cAbnormal && "HbA1c", insulinHigh && "fasting insulin", trigsHigh && "triglycerides", hdlLow && "HDL"].filter(Boolean).join(", ")}. Together, these may reflect variation in how the body is currently processing sugar and insulin. This pattern is worth discussing in context with your provider, particularly if you have a history of PCOS or metabolic conditions.`,
      related_biomarkers: related,
    });
  } else if (irSignals === 1 && (glucoseAbnormal || hba1cAbnormal)) {
    const related = ["fasting_glucose", "hemoglobin_a1c"].filter(s => analytes.some(a => a.canonical_slug === s));
    patterns.push({
      title: "Fasting Glucose Elevation",
      confidence: "low",
      explanation: `A single elevated fasting glucose or HbA1c marker can sometimes suggest early variation in glucose regulation, but is not meaningful in isolation. A repeat test and conversation with your provider — in context of your full health history — will clarify whether any follow-up is warranted.`,
      related_biomarkers: related,
    });
  }

  // ── Lipid pattern ─────────────────────────────────────────────────────────
  const ldl = getBySlug(analytes, "ldl_cholesterol");
  const totalChol = getBySlug(analytes, "total_cholesterol");
  const apob = getBySlug(analytes, "apob");

  const ldlHigh = ldl && isHigh(ldl);
  const totalCholHigh = totalChol && isHigh(totalChol);
  const apobHigh = apob && isHigh(apob);
  const lipidSignals = [ldlHigh, totalCholHigh, apobHigh, trigsHigh, hdlLow].filter(Boolean).length;

  if (lipidSignals >= 2) {
    const related = ["ldl_cholesterol", "total_cholesterol", "hdl_cholesterol", "triglycerides", "apob"].filter(s =>
      analytes.some(a => a.canonical_slug === s)
    );
    patterns.push({
      title: "Lipid Pattern Worth Monitoring",
      confidence: lipidSignals >= 3 ? "medium" : "low",
      explanation: `${[ldlHigh && "LDL", totalCholHigh && "total cholesterol", apobHigh && "ApoB", trigsHigh && "triglycerides", hdlLow && "HDL"].filter(Boolean).join(", ")} ${lipidSignals === 1 ? "is" : "are"} outside reference range. Because estrogen modulates lipid metabolism, values can shift across the cycle and with hormonal changes — so context matters. Your provider can help assess whether this pattern warrants closer tracking over time.`,
      related_biomarkers: related,
    });
  }

  // ── Phase-aware reproductive hormone interpretation ───────────────────────
  const phase = report.estimated_cycle_phase;
  const cycleDay = report.estimated_cycle_day;
  const onBC = report.context?.birth_control === "yes";
  const pregnant = report.context?.pregnant === "yes";

  if (!onBC && !pregnant && phase && phase !== "unknown") {
    const estradiol = getBySlug(analytes, "estradiol");
    const progesterone = getBySlug(analytes, "progesterone");
    const lh = getBySlug(analytes, "lh");
    const fsh = getBySlug(analytes, "fsh");
    const amh = getBySlug(analytes, "amh");

    const hormoneAbnormal = [estradiol, progesterone, lh, fsh].filter(a => a && isAbnormal(a.canonical_slug!)).length;

    if (hormoneAbnormal >= 2) {
      const related = ["estradiol", "progesterone", "lh", "fsh", "amh"].filter(s =>
        analytes.some(a => a.canonical_slug === s)
      );
      const phaseLabel = phase === "luteal" ? "luteal" : phase === "follicular" ? "follicular" : phase === "ovulatory" ? "ovulatory" : phase;
      patterns.push({
        title: "Reproductive Hormone Variation",
        confidence: hormoneAbnormal >= 3 ? "medium" : "low",
        explanation: `${hormoneAbnormal} reproductive hormones are outside their reference ranges for the ${phaseLabel} phase (day ${cycleDay ?? "?"}). Hormone levels are highly phase-dependent and a single draw rarely tells the full story — this may simply reflect normal individual variation, but it can be worth repeating at a different phase or tracking across cycles to see if a pattern holds.`,
        related_biomarkers: related,
      });
    }

    if (amh && isLow(amh)) {
      patterns.push({
        title: "Low Ovarian Reserve Signal",
        confidence: "low",
        explanation: `AMH (anti-Müllerian hormone) is below the lower reference limit. AMH values vary between labs and across the cycle, and a single reading below range doesn't tell a complete story on its own. If fertility or ovarian function is relevant to you, this is worth reviewing with your provider alongside FSH and a full cycle context.`,
        related_biomarkers: ["amh", "fsh"],
      });
    }
  }

  // ── Iron / nutrient depletion ─────────────────────────────────────────────
  const ferritin = getBySlug(analytes, "ferritin");
  const vitD = getBySlug(analytes, "vitamin_d_25_oh");
  const b12 = getBySlug(analytes, "vitamin_b12");
  const hgb = getBySlug(analytes, "hemoglobin");

  const ferritinLow = ferritin && isLow(ferritin);
  const vitDLow = vitD && isLow(vitD);
  const b12Low = b12 && isLow(b12);
  const hgbLow = hgb && isLow(hgb);
  const nutrientSignals = [ferritinLow, vitDLow, b12Low, hgbLow].filter(Boolean).length;

  if (nutrientSignals >= 2) {
    const related = ["ferritin", "vitamin_d_25_oh", "vitamin_b12", "hemoglobin", "serum_iron"].filter(s =>
      analytes.some(a => a.canonical_slug === s)
    );
    patterns.push({
      title: "Nutrient Depletion Pattern",
      confidence: nutrientSignals >= 3 ? "medium" : "low",
      explanation: `${[ferritinLow && "Ferritin", vitDLow && "vitamin D", b12Low && "B12", hgbLow && "hemoglobin"].filter(Boolean).join(", ")} ${nutrientSignals === 1 ? "is" : "are"} below their reference ranges. Nutrient markers often cluster, and low levels across several can sometimes be associated with fatigue, mood changes, or hormonal variability. How and whether to address these depends on severity and your full clinical picture — your provider can help prioritize.`,
      related_biomarkers: related,
    });
  } else if (ferritinLow && hgbLow) {
    patterns.push({
      title: "Iron-Deficiency Signal",
      confidence: "medium",
      explanation: `Both ferritin and hemoglobin are below their reference ranges, which can sometimes be seen alongside iron insufficiency — a pattern that's relatively common in women, particularly those with heavier cycles. A full iron panel and clinical context would help clarify the picture before any next steps.`,
      related_biomarkers: ["ferritin", "hemoglobin", "serum_iron", "tibc"],
    });
  }

  return patterns.slice(0, 3);
}

// ─── Missing Follow-up Labs ───────────────────────────────────────────────────

function computeMissingFollowupLabs(analytes: AnalyteData[], report: LabReportData): string[] {
  const present = new Set(analytes.map(a => a.canonical_slug).filter(Boolean));
  const missing: string[] = [];

  const has = (...slugs: string[]) => slugs.some(s => present.has(s));

  if (has("tsh") && !has("free_t4", "free_t3")) {
    missing.push("Free T4 and Free T3 (TSH alone is incomplete for thyroid function assessment)");
  }
  if (has("tpo_antibodies", "tg_antibodies") && !has("tsh")) {
    missing.push("TSH (to pair with the antibody markers already present)");
  }
  if (has("fasting_glucose", "hemoglobin_a1c") && !has("fasting_insulin")) {
    missing.push("Fasting insulin (would complete a glucose dysregulation assessment)");
  }
  if (has("ldl_cholesterol", "total_cholesterol") && !has("apob")) {
    missing.push("ApoB (a more precise cardiovascular risk marker than LDL alone)");
  }
  if (has("estradiol", "progesterone") && !has("lh", "fsh")) {
    missing.push("LH and FSH (would provide a more complete reproductive hormone picture)");
  }
  if (has("ferritin") && !has("serum_iron", "tibc")) {
    missing.push("Serum iron and TIBC (to characterize iron status more fully)");
  }
  if (!has("vitamin_d_25_oh") && !has("vitamin_b12")) {
    missing.push("Vitamin D and B12 (commonly deficient and clinically impactful for women)");
  }
  if (has("hemoglobin") && !has("ferritin")) {
    missing.push("Ferritin (often low before hemoglobin drops — the earliest iron marker)");
  }
  if (!has("hs_crp") && !has("esr")) {
    missing.push("hs-CRP (a sensitive inflammatory marker absent from this panel)");
  }

  return missing.slice(0, 5);
}

// ─── Pre-LLM Report Facts ─────────────────────────────────────────────────────

const HIGH_VALUE_SLUGS = new Set([
  "estradiol", "progesterone", "lh", "fsh", "tsh", "free_t4", "free_t3",
  "fasting_glucose", "hemoglobin_a1c", "total_cholesterol", "ldl_cholesterol",
  "hdl_cholesterol", "triglycerides", "creatinine", "egfr", "alt", "ast",
  "ferritin", "vitamin_d_25_oh", "vitamin_b12", "hs_crp", "tpo_antibodies",
  "hemoglobin", "shbg", "total_testosterone", "dheas", "fasting_insulin",
  "amh", "prolactin", "apob", "tg_antibodies", "serum_iron",
]);

function computeReportFacts(analytes: AnalyteData[], report: LabReportData): ReportFacts {
  const outOfRange = analytes.filter(a => classifyAnalyte(a) === "out_of_range");
  const borderline = analytes.filter(a => classifyAnalyte(a) === "borderline");
  const inRange = analytes.filter(a => classifyAnalyte(a) === "in_range");

  const reassuring = inRange.filter(a =>
    a.canonical_slug && HIGH_VALUE_SLUGS.has(a.canonical_slug)
  ).slice(0, 6);

  const phase = report.estimated_cycle_phase;
  const day = report.estimated_cycle_day;
  const onBC = report.context?.birth_control === "yes";
  const pregnant = report.context?.pregnant === "yes";
  const postpartum = report.context?.postpartum === "yes";

  let cycleNotes = "";
  if (pregnant) {
    cycleNotes = "Patient is currently pregnant. Hormone and metabolic reference ranges differ significantly in pregnancy.";
  } else if (postpartum) {
    cycleNotes = "Patient is postpartum. Hormone levels may be suppressed or fluctuating as the body recovers.";
  } else if (onBC) {
    cycleNotes = "Patient is on hormonal birth control. Endogenous hormone levels — especially estradiol, progesterone, LH, and FSH — will be suppressed. SHBG is often elevated. Interpret hormone markers accordingly.";
  } else if (phase && phase !== "unknown" && day) {
    const phaseExpectations: Record<string, string> = {
      menstrual: "Estradiol and progesterone are typically low. FSH begins rising. Spotting iron-related markers (ferritin, hemoglobin) here is valuable.",
      follicular: "Estradiol is rising. Progesterone is low. FSH is moderately elevated. LH is baseline.",
      ovulatory: "LH surge expected. Estradiol peaks just before ovulation. Progesterone beginning to rise.",
      luteal: "Progesterone should be elevated (ideally above 5–10 ng/mL at mid-luteal). Estradiol has a secondary, smaller rise. LH and FSH are low.",
    };
    cycleNotes = `Labs drawn on day ${day} (${phase} phase). ${phaseExpectations[phase] ?? "Phase-specific hormone expectations apply."}`;
  } else {
    cycleNotes = "Cycle day is not known. Hormone values cannot be interpreted in phase context without this information.";
  }

  const contextNotes: string[] = [];
  const symptoms = report.context?.top_symptoms ?? [];
  if (symptoms.length > 0) {
    contextNotes.push(`Reported symptoms: ${symptoms.slice(0, 4).join(", ")}.`);
  }
  if (postpartum) contextNotes.push("Postpartum status noted.");
  if (pregnant) contextNotes.push("Currently pregnant.");
  if (onBC) contextNotes.push("On hormonal birth control.");

  return {
    top_out_of_range: outOfRange.slice(0, 6),
    top_borderline: borderline.slice(0, 5),
    reassuring_in_range: reassuring,
    matched_patterns: detectPatterns(analytes, report),
    missing_followup_labs: computeMissingFollowupLabs(analytes, report),
    cycle_notes: cycleNotes,
    context_notes: contextNotes,
  };
}

// ─── Fallback Interpretation ──────────────────────────────────────────────────

function generateFallbackInterpretation(report: LabReportData, analytes: AnalyteData[]) {
  const facts = computeReportFacts(analytes, report);
  const { top_out_of_range, top_borderline, matched_patterns } = facts;
  const totalFlagged = top_out_of_range.length + top_borderline.length;
  const phase = report.estimated_cycle_phase ?? "unknown";
  const day = report.estimated_cycle_day;

  let headline: string;
  if (totalFlagged === 0) {
    headline = `Your ${analytes.length}-marker panel is within reference ranges — a solid baseline to build from.`;
  } else if (top_out_of_range.length > 0) {
    const firstName = top_out_of_range[0].raw_name;
    headline = `${top_out_of_range.length} value${top_out_of_range.length > 1 ? "s" : ""} outside reference range — ${firstName} is the most notable finding.`;
  } else {
    const firstName = top_borderline[0].raw_name;
    headline = `${top_borderline.length} borderline result${top_borderline.length > 1 ? "s" : ""} — including ${firstName} — worth keeping an eye on.`;
  }

  const summaryBullets: string[] = [];

  if (totalFlagged === 0) {
    summaryBullets.push(`All ${analytes.length} markers reviewed are within their reference ranges.`);
  } else {
    const parts: string[] = [];
    if (top_out_of_range.length > 0) parts.push(`${top_out_of_range.length} out of range`);
    if (top_borderline.length > 0) parts.push(`${top_borderline.length} borderline`);
    summaryBullets.push(`Of ${analytes.length} analytes reviewed: ${parts.join(", ")}.`);
  }

  if (day && phase !== "unknown") {
    summaryBullets.push(
      `These labs were drawn on cycle day ${day} (${phase} phase). Reproductive hormones — especially estradiol, progesterone, LH, and FSH — are highly phase-dependent, so timing context matters when interpreting them.`
    );
  } else {
    summaryBullets.push(
      `Cycle timing isn't available for this report. Adding your last period date would allow hormone markers like estradiol, progesterone, and LH to be interpreted in their proper cycle context.`
    );
  }

  if (facts.context_notes.length > 0) {
    summaryBullets.push(facts.context_notes.join(" "));
  } else if (facts.matched_patterns.length > 0) {
    summaryBullets.push(
      `Pattern analysis identified ${facts.matched_patterns.length} potential signal${facts.matched_patterns.length > 1 ? "s" : ""} — including ${facts.matched_patterns[0].title.toLowerCase()}. These are observations, not diagnoses.`
    );
  }

  const topFlagged = [...top_out_of_range, ...top_borderline].slice(0, 5);
  const top_findings = topFlagged.map(a => {
    const status = classifyAnalyte(a);
    const val = displayVal(a);
    let explanation = `Your ${a.raw_name} result was ${val}.`;
    if (status === "out_of_range") {
      explanation += " This falls outside the reference range. The clinical significance depends on your full history, symptoms, and cycle context.";
    } else {
      explanation += " This sits near the edge of the reference range — worth noting and potentially retesting to assess the trend.";
    }
    return {
      biomarker_slug: slug(a),
      title: a.raw_name,
      status: status === "out_of_range" ? "discuss" as const : "monitor" as const,
      explanation,
    };
  });

  const questions: string[] = [];

  if (top_out_of_range.length > 0) {
    questions.push(`My ${top_out_of_range[0].raw_name} came back ${displayVal(top_out_of_range[0])} — can you help me understand what that means in the context of my full history?`);
  } else if (top_borderline.length > 0) {
    questions.push(`My ${top_borderline[0].raw_name} is near the edge of the reference range at ${displayVal(top_borderline[0])} — is that something to monitor or retest?`);
  } else {
    questions.push("Are there any values on this panel that you'd want to track over time, even if they're currently in range?");
  }

  if (matched_patterns.length > 0) {
    questions.push(`The pattern analysis flagged a possible ${matched_patterns[0].title.toLowerCase()} — is there anything you'd want to evaluate or rule out based on these results?`);
  } else if (facts.missing_followup_labs.length > 0) {
    questions.push(`Would adding ${facts.missing_followup_labs[0].split(" (")[0]} to my next draw give us more useful information?`);
  } else {
    questions.push("Are there any markers not on this panel that you'd recommend adding to get a more complete picture?");
  }

  if (day && phase !== "unknown") {
    questions.push(`These labs were drawn on day ${day} of my cycle. Would retesting any of these at a different phase change how we interpret them?`);
  } else {
    questions.push("Which markers on this panel are most sensitive to cycle timing, and when would be the best phase to retest them?");
  }

  const cycleExplanation = day && phase !== "unknown"
    ? `Labs drawn on cycle day ${day} during the ${phase} phase. Hormone values on this panel should be read with that timing in mind.`
    : "Cycle timing was not available for this report. Providing your last period date with future reports will enable more precise hormone interpretation.";

  return {
    headline,
    summary_bullets: summaryBullets.slice(0, 3),
    top_findings,
    pattern_signals: matched_patterns,
    cycle_context: {
      estimated_cycle_day: day,
      estimated_cycle_phase: phase,
      confidence: day ? "medium" as const : "low" as const,
      explanation: cycleExplanation,
    },
    questions_for_doctor: questions.slice(0, 3),
    disclaimer:
      "This report is for educational purposes only and does not constitute medical advice. All results should be reviewed with your healthcare provider in the context of your full health history, symptoms, and clinical presentation.",
  };
}

// ─── OpenAI Call ──────────────────────────────────────────────────────────────

async function tryOpenAI(apiKey: string, report: LabReportData, analytes: AnalyteData[]): Promise<any | null> {
  const facts = computeReportFacts(analytes, report);
  const { top_out_of_range, top_borderline, reassuring_in_range, matched_patterns, missing_followup_labs, cycle_notes, context_notes } = facts;

  const patternSlugs = new Set(matched_patterns.flatMap(p => p.related_biomarkers));

  const patternSupportingInRange = analytes.filter(a =>
    a.canonical_slug &&
    patternSlugs.has(a.canonical_slug) &&
    classifyAnalyte(a) === "in_range"
  );

  const remainingHighValue = analytes.filter(a =>
    a.canonical_slug &&
    HIGH_VALUE_SLUGS.has(a.canonical_slug) &&
    classifyAnalyte(a) === "in_range" &&
    !patternSlugs.has(a.canonical_slug)
  );

  const selected = [
    ...top_out_of_range,
    ...top_borderline,
    ...patternSupportingInRange,
    ...reassuring_in_range,
    ...remainingHighValue,
  ].filter((a, i, arr) => arr.indexOf(a) === i).slice(0, 16);

  const labLines = selected.map(a => {
    const val = displayVal(a);
    const s = a.canonical_slug ? ` [${a.canonical_slug}]` : "";
    let line = `${a.raw_name}${s}: ${val}`;
    if (a.raw_reference_range) line += ` (ref: ${a.raw_reference_range})`;
    const st = classifyAnalyte(a);
    if (st === "out_of_range") line += " ← OUT OF RANGE";
    else if (st === "borderline") line += " ← BORDERLINE";
    return line;
  }).join("\n");

  const patternBlock = matched_patterns.length > 0
    ? `\nDETERMINISTIC PATTERN CANDIDATES (pre-analyzed — use as starting evidence, not final conclusions):\n` +
      matched_patterns.map(p =>
        `- ${p.title} [confidence: ${p.confidence}]: ${p.explanation} (markers: ${p.related_biomarkers.join(", ")})`
      ).join("\n")
    : "";

  const missingBlock = missing_followup_labs.length > 0
    ? `\nABSENT FOLLOW-UP LABS WORTH NOTING:\n${missing_followup_labs.map(m => `- ${m}`).join("\n")}`
    : "";

  const prompt = `You are Amani, an intelligent women's health lab interpretation assistant.

Your role is to interpret lab results in a way that is:
- clear
- calm
- clinically informed
- practical
- not alarmist
- not generic

You are NOT diagnosing. You are helping the user understand what matters and what they can do next.

-----------------------------------

STYLE RULES

- Write like a knowledgeable clinician explaining results to a patient
- Avoid generic phrases like:
  - "may indicate"
  - "suggests possible"
  - "further evaluation may be necessary"
  - "clinical significance depends on..."
- Be specific and grounded in the actual lab values
- Do not repeat the same idea across sections
- Do not include generic wellness advice unless directly tied to findings
- Keep explanations concise but meaningful

-----------------------------------

PRIORITIZATION

- Identify ONE primary concern if present
- Then list up to 2–3 secondary findings
- Do not treat all abnormalities equally

-----------------------------------

KEY FINDINGS — "FOCUS NOW" RULES

Each item in key_findings must:
- Answer WHY this specific result matters for this patient
- Answer WHAT DIRECTION it points (e.g., trending low, pushing above range, within healthy zone)
- Avoid repetitive phrasing across items
- Avoid vague filler like "clinical significance depends on symptoms" or "may warrant further testing"
- Be grounded in the actual numeric value, not just the flag

Good example:
"Your ferritin came back at 9 ng/mL, which is below the typical threshold for adequate iron storage. At this level, energy and focus are often the first things to take a hit, and it can also affect thyroid function if left unaddressed."

Bad example:
"Ferritin is low. Clinical significance depends on symptoms. Further evaluation may be necessary."

-----------------------------------

PATIENT CONTEXT:
- Report date: ${report.report_date}
- Cycle: ${cycle_notes}
${context_notes.length ? "- " + context_notes.join("\n- ") : ""}

LAB PANEL: ${analytes.length} total analytes. Key values shown below:
${labLines}
${patternBlock}
${missingBlock}

STRUCTURED FACTS (derived before this call — use to ground your response):
- Out-of-range markers: ${top_out_of_range.length > 0 ? top_out_of_range.map(a => `${a.raw_name} (${displayVal(a)})`).join(", ") : "none"}
- Borderline markers: ${top_borderline.length > 0 ? top_borderline.map(a => `${a.raw_name} (${displayVal(a)})`).join(", ") : "none"}
- Clinically important in-range markers: ${reassuring_in_range.length > 0 ? reassuring_in_range.map(a => `${a.raw_name} (${displayVal(a)})`).join(", ") : "none notable"}

-----------------------------------

WHAT YOU CAN DO NOW (IMPORTANT)

Populate the what_you_can_do_now field with 3–5 practical wellness suggestions tied directly to the flagged biomarkers.

Each suggestion must be:
- Safe and non-prescriptive
- Framed as a supportive action, not medical advice
- Specific to what was found in these labs, not generic health tips

Categories to draw from (use only what applies):
- Nutrition: foods rich in relevant micronutrients (e.g., "leafy greens for folate", "Brazil nuts for selenium")
- Lifestyle: movement, sleep quality, stress management — only if a marker supports it
- Supplements: mention ONLY widely accepted, generally safe options (e.g., vitamin D, magnesium, omega-3s) — never suggest doses

DO NOT:
- Prescribe medications or dosages
- Make disease claims
- Repeat suggestions from what_to_do_next verbatim

Tone: simple, warm, human — not clinical. Write as if a knowledgeable friend is giving a heads-up.

Examples:
- "Adding foods like salmon, walnuts, or flaxseed can support the omega-3 balance your results hint at."
- "Some people find that magnesium-rich foods like dark chocolate or pumpkin seeds help with sleep and energy — both relevant given what's showing here."
- "If your vitamin D is on the lower end, getting 15–20 minutes of midday sun a few times a week is a gentle place to start."

-----------------------------------

WHAT TO DO NEXT

Populate what_to_do_next with 3–5 action-oriented next steps, focused on:
- Follow-up labs to consider
- Conversations to have with a provider
- Timing of retesting

Keep this distinct from what_you_can_do_now — this section is about next steps, not daily habits.

-----------------------------------

SAFETY

- Do not diagnose conditions
- Do not create urgency unless clearly warranted
- Keep everything educational

-----------------------------------

Return ONLY a valid JSON object. No markdown. No code blocks. No preamble. Every array field MUST be an array.

Required schema:
{
  "headline": "string",
  "primary_concern": {
    "title": "string",
    "summary": "string",
    "why_it_matters": "string"
  },
  "key_findings": [
    {
      "biomarker_slug": "string",
      "title": "string",
      "status": "monitor" | "attention" | "reassuring",
      "explanation": "string"
    }
  ],
  "pattern_signals": [
    {
      "title": "string",
      "confidence": "emerging" | "moderate" | "strong",
      "explanation": "string",
      "related_biomarkers": ["string"]
    }
  ],
  "what_you_can_do_now": ["string"],
  "what_to_do_next": ["string"],
  "questions_for_doctor": ["string"],
  "cycle_context": "string",
  "disclaimer": "string"
}`;

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 28000);

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You are Amani's clinical interpretation engine. Return ONLY valid JSON. No markdown, no code blocks, no preamble. Educational use only — not medical advice.",
          },
          { role: "user", content: prompt },
        ],
        max_tokens: 1800,
        temperature: 0.25,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });
    clearTimeout(tid);

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.warn("[generate-interpretation] OpenAI status:", res.status, errBody);
      return null;
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;

    const parsed = JSON.parse(content);
    if (typeof parsed.headline !== "string") return null;
    if (!Array.isArray(parsed.summary_bullets)) return null;
    return parsed;
  } catch (e: any) {
    clearTimeout(tid);
    console.warn("[generate-interpretation] OpenAI failed:", e?.message);
    return null;
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const openaiApiKey = Deno.env.get("OPENAI_API_KEY");

  const supabase = createClient(supabaseUrl, serviceKey);

  let reportId: string | null = null;

  try {
    const body = await req.json();
    reportId = body?.reportId ?? null;

    if (!reportId || typeof reportId !== "string") {
      return new Response(JSON.stringify({ error: "reportId is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: reportCheck } = await supabase
      .from("lab_reports")
      .select("id, user_id")
      .eq("id", reportId)
      .maybeSingle();

    if (!reportCheck) {
      return new Response(JSON.stringify({ error: "Report not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.from("lab_reports").update({ status: "processing" }).eq("id", reportId);

    const { data: report } = await supabase
      .from("lab_reports")
      .select("id, report_date, estimated_cycle_day, estimated_cycle_phase, context")
      .eq("id", reportId)
      .maybeSingle();

    const { data: rawAnalytes } = await supabase
      .from("report_analytes")
      .select("id, raw_name, canonical_slug, value_numeric, raw_value_text, unit, raw_reference_range, normalized_min, normalized_max, normalized_operator, normalized_operator_value, is_core")
      .eq("lab_report_id", reportId)
      .order("raw_name");

    const analytes: AnalyteData[] = (rawAnalytes ?? []) as AnalyteData[];
    console.log(`[generate-interpretation] ${analytes.length} analytes for report ${reportId}`);

    let interpretationJson: any;
    let source = "fallback";

    if (openaiApiKey && analytes.length > 0 && report) {
      console.log("[generate-interpretation] Trying OpenAI...");
      const aiResult = await tryOpenAI(openaiApiKey, report as LabReportData, analytes);
      if (aiResult) {
        interpretationJson = aiResult;
        source = "ai";
        console.log("[generate-interpretation] OpenAI succeeded");
      } else {
        console.log("[generate-interpretation] OpenAI failed, using fallback");
        interpretationJson = generateFallbackInterpretation(report as LabReportData, analytes);
      }
    } else {
      console.log("[generate-interpretation] Using fallback (no key or no analytes)");
      interpretationJson = report
        ? generateFallbackInterpretation(report as LabReportData, analytes)
        : {
            headline: "Lab data could not be loaded for this report.",
            summary_bullets: [],
            top_findings: [],
            pattern_signals: [],
            cycle_context: { estimated_cycle_day: null, estimated_cycle_phase: "unknown", confidence: "low", explanation: "" },
            questions_for_doctor: [],
            disclaimer: "This report is for educational purposes only and does not constitute medical advice.",
          };
    }

    const { error: upsertError } = await supabase
      .from("interpretations")
      .upsert({
        lab_report_id: reportId,
        json_output: interpretationJson,
        interpretation_source: source,
        generated_at: new Date().toISOString(),
        disclaimer_version: "1.0",
      }, { onConflict: "lab_report_id" });

    if (upsertError) {
      console.error("[generate-interpretation] Upsert error:", upsertError.message);
      await supabase.from("lab_reports").update({ status: "error" }).eq("id", reportId);
      return new Response(JSON.stringify({ error: "Failed to save interpretation" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.from("lab_reports").update({ status: "ready" }).eq("id", reportId);
    console.log("[generate-interpretation] Done — status: ready, source:", source);

    return new Response(JSON.stringify({ success: true, source }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("[generate-interpretation] Fatal error:", err?.message ?? err);
    if (reportId) {
      try {
        await supabase.from("lab_reports").update({ status: "error" }).eq("id", reportId);
      } catch (_) {}
    }
    return new Response(JSON.stringify({ error: "Internal server error", detail: err?.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
