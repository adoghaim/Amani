\set ON_ERROR_STOP 1
-- This exact fixture/expected array also runs through buildBasicProjection in Vitest.
DO $$
DECLARE cases jsonb := $trend_cases$[
  {
    "full": {
      "key_findings": [
        {
          "biomarker_slug": "a",
          "abnormal": true
        },
        {
          "biomarker_slug": "a",
          "current_status": "AtTeNtIoN"
        },
        {
          "biomarker_slug": "b",
          "nested": {
            "urgent": true
          }
        },
        {
          "biomarker_slug": "normal",
          "status": "monitor"
        }
      ],
      "top_findings": [
        {
          "biomarker_slug": "a",
          "status": "discuss"
        },
        {
          "biomarker_slug": "c",
          "status": "discuss"
        }
      ],
      "trend_evidence": [
        {
          "biomarker_slug": "a",
          "delta": "not numeric"
        },
        {
          "biomarker_slug": "a",
          "marker": "A",
          "previous_value": 10,
          "current_value": 20,
          "unit": "u",
          "previous_date": "2026-03-01",
          "direction": "increased",
          "summary": "A increased 10 → 20 u since 2026-03-01"
        },
        {
          "biomarker_slug": "a",
          "delta": 100,
          "summary": "DUPLICATE"
        },
        {
          "biomarker_slug": "normal",
          "delta": 1
        },
        {
          "biomarker_slug": "b",
          "delta": 1
        },
        {
          "biomarker_slug": "c",
          "delta": -1
        }
      ]
    },
    "expected": [
      {
        "biomarker_slug": "a",
        "marker": "A",
        "previous_value": 10,
        "current_value": 20,
        "unit": "u",
        "previous_date": "2026-03-01",
        "direction": "increased",
        "status": "AtTeNtIoN",
        "summary": "A increased 10 → 20 u since 2026-03-01"
      },
      {
        "biomarker_slug": "b",
        "marker": "b",
        "previous_value": null,
        "current_value": null,
        "unit": null,
        "previous_date": null,
        "direction": null,
        "status": null,
        "summary": null
      },
      {
        "biomarker_slug": "c",
        "marker": "c",
        "previous_value": null,
        "current_value": null,
        "unit": null,
        "previous_date": null,
        "direction": null,
        "status": "discuss",
        "summary": null
      }
    ]
  },
  {
    "full": {},
    "expected": []
  },
  {
    "full": {
      "trend_evidence": null,
      "key_findings": {}
    },
    "expected": []
  },
  {
    "full": {
      "key_findings": [
        {
          "biomarker_slug": "x",
          "abnormal": {
            "status": "attention"
          }
        }
      ],
      "trend_evidence": [
        {
          "biomarker_slug": "x",
          "delta": 1
        }
      ]
    },
    "expected": [
      {
        "biomarker_slug": "x",
        "marker": "x",
        "previous_value": null,
        "current_value": null,
        "unit": null,
        "previous_date": null,
        "direction": null,
        "status": null,
        "summary": null
      }
    ]
  },
  {
    "full": {
      "key_findings": [
        {
          "biomarker_slug": "x",
          "abnormal": [
            {
              "status": "discuss"
            }
          ]
        }
      ],
      "trend_evidence": [
        {
          "biomarker_slug": "x",
          "delta": 1
        }
      ]
    },
    "expected": [
      {
        "biomarker_slug": "x",
        "marker": "x",
        "previous_value": null,
        "current_value": null,
        "unit": null,
        "previous_date": null,
        "direction": null,
        "status": null,
        "summary": null
      }
    ]
  },
  {
    "full": {
      "key_findings": [
        {
          "biomarker_slug": "x",
          "is_abnormal": {
            "status": "attention"
          }
        }
      ],
      "trend_evidence": [
        {
          "biomarker_slug": "x",
          "delta": 1
        }
      ]
    },
    "expected": [
      {
        "biomarker_slug": "x",
        "marker": "x",
        "previous_value": null,
        "current_value": null,
        "unit": null,
        "previous_date": null,
        "direction": null,
        "status": null,
        "summary": null
      }
    ]
  },
  {
    "full": {
      "key_findings": [
        {
          "biomarker_slug": "x",
          "is_abnormal": [
            {
              "status": "discuss"
            }
          ]
        }
      ],
      "trend_evidence": [
        {
          "biomarker_slug": "x",
          "delta": 1
        }
      ]
    },
    "expected": [
      {
        "biomarker_slug": "x",
        "marker": "x",
        "previous_value": null,
        "current_value": null,
        "unit": null,
        "previous_date": null,
        "direction": null,
        "status": null,
        "summary": null
      }
    ]
  },
  {
    "full": {
      "key_findings": [
        {
          "biomarker_slug": "x",
          "safety": {
            "status": "attention"
          }
        }
      ],
      "trend_evidence": [
        {
          "biomarker_slug": "x",
          "delta": 1
        }
      ]
    },
    "expected": [
      {
        "biomarker_slug": "x",
        "marker": "x",
        "previous_value": null,
        "current_value": null,
        "unit": null,
        "previous_date": null,
        "direction": null,
        "status": null,
        "summary": null
      }
    ]
  },
  {
    "full": {
      "key_findings": [
        {
          "biomarker_slug": "x",
          "safety": [
            {
              "status": "discuss"
            }
          ]
        }
      ],
      "trend_evidence": [
        {
          "biomarker_slug": "x",
          "delta": 1
        }
      ]
    },
    "expected": [
      {
        "biomarker_slug": "x",
        "marker": "x",
        "previous_value": null,
        "current_value": null,
        "unit": null,
        "previous_date": null,
        "direction": null,
        "status": null,
        "summary": null
      }
    ]
  },
  {
    "full": {
      "key_findings": [
        {
          "biomarker_slug": "x",
          "safety_related": {
            "status": "attention"
          }
        }
      ],
      "trend_evidence": [
        {
          "biomarker_slug": "x",
          "delta": 1
        }
      ]
    },
    "expected": [
      {
        "biomarker_slug": "x",
        "marker": "x",
        "previous_value": null,
        "current_value": null,
        "unit": null,
        "previous_date": null,
        "direction": null,
        "status": null,
        "summary": null
      }
    ]
  },
  {
    "full": {
      "key_findings": [
        {
          "biomarker_slug": "x",
          "safety_related": [
            {
              "status": "discuss"
            }
          ]
        }
      ],
      "trend_evidence": [
        {
          "biomarker_slug": "x",
          "delta": 1
        }
      ]
    },
    "expected": [
      {
        "biomarker_slug": "x",
        "marker": "x",
        "previous_value": null,
        "current_value": null,
        "unit": null,
        "previous_date": null,
        "direction": null,
        "status": null,
        "summary": null
      }
    ]
  },
  {
    "full": {
      "key_findings": [
        {
          "biomarker_slug": "x",
          "is_safety": {
            "status": "attention"
          }
        }
      ],
      "trend_evidence": [
        {
          "biomarker_slug": "x",
          "delta": 1
        }
      ]
    },
    "expected": [
      {
        "biomarker_slug": "x",
        "marker": "x",
        "previous_value": null,
        "current_value": null,
        "unit": null,
        "previous_date": null,
        "direction": null,
        "status": null,
        "summary": null
      }
    ]
  },
  {
    "full": {
      "key_findings": [
        {
          "biomarker_slug": "x",
          "is_safety": [
            {
              "status": "discuss"
            }
          ]
        }
      ],
      "trend_evidence": [
        {
          "biomarker_slug": "x",
          "delta": 1
        }
      ]
    },
    "expected": [
      {
        "biomarker_slug": "x",
        "marker": "x",
        "previous_value": null,
        "current_value": null,
        "unit": null,
        "previous_date": null,
        "direction": null,
        "status": null,
        "summary": null
      }
    ]
  },
  {
    "full": {
      "key_findings": [
        {
          "biomarker_slug": "x",
          "critical": {
            "status": "attention"
          }
        }
      ],
      "trend_evidence": [
        {
          "biomarker_slug": "x",
          "delta": 1
        }
      ]
    },
    "expected": [
      {
        "biomarker_slug": "x",
        "marker": "x",
        "previous_value": null,
        "current_value": null,
        "unit": null,
        "previous_date": null,
        "direction": null,
        "status": null,
        "summary": null
      }
    ]
  },
  {
    "full": {
      "key_findings": [
        {
          "biomarker_slug": "x",
          "critical": [
            {
              "status": "discuss"
            }
          ]
        }
      ],
      "trend_evidence": [
        {
          "biomarker_slug": "x",
          "delta": 1
        }
      ]
    },
    "expected": [
      {
        "biomarker_slug": "x",
        "marker": "x",
        "previous_value": null,
        "current_value": null,
        "unit": null,
        "previous_date": null,
        "direction": null,
        "status": null,
        "summary": null
      }
    ]
  },
  {
    "full": {
      "key_findings": [
        {
          "biomarker_slug": "x",
          "urgent": {
            "status": "attention"
          }
        }
      ],
      "trend_evidence": [
        {
          "biomarker_slug": "x",
          "delta": 1
        }
      ]
    },
    "expected": [
      {
        "biomarker_slug": "x",
        "marker": "x",
        "previous_value": null,
        "current_value": null,
        "unit": null,
        "previous_date": null,
        "direction": null,
        "status": null,
        "summary": null
      }
    ]
  },
  {
    "full": {
      "key_findings": [
        {
          "biomarker_slug": "x",
          "urgent": [
            {
              "status": "discuss"
            }
          ]
        }
      ],
      "trend_evidence": [
        {
          "biomarker_slug": "x",
          "delta": 1
        }
      ]
    },
    "expected": [
      {
        "biomarker_slug": "x",
        "marker": "x",
        "previous_value": null,
        "current_value": null,
        "unit": null,
        "previous_date": null,
        "direction": null,
        "status": null,
        "summary": null
      }
    ]
  },
  {
    "full": {
      "key_findings": [
        {
          "biomarker_slug": "férritine",
          "status": "DiScUsS"
        },
        {
          "biomarker_slug": "unicode_status",
          "status": "DÍSCUSS"
        }
      ],
      "trend_evidence": [
        {
          "biomarker_slug": "férritine",
          "delta": 1,
          "marker": "Férritine",
          "summary": "Évolution → 2"
        },
        {
          "biomarker_slug": "unicode_status",
          "delta": 1
        }
      ]
    },
    "expected": [
      {
        "biomarker_slug": "férritine",
        "marker": "Férritine",
        "previous_value": null,
        "current_value": null,
        "unit": null,
        "previous_date": null,
        "direction": null,
        "status": "DiScUsS",
        "summary": "Évolution → 2"
      }
    ]
  },
  {
    "full": {
      "key_findings": [
        null,
        "discuss",
        true,
        42,
        [],
        [
          {
            "status": "discuss"
          }
        ],
        {
          "biomarker_slug": "",
          "abnormal": true
        }
      ],
      "trend_evidence": [
        null,
        "x",
        false,
        42,
        [],
        [
          {
            "biomarker_slug": "",
            "delta": 1
          }
        ],
        {
          "biomarker_slug": "",
          "delta": 1,
          "marker": 42
        }
      ]
    },
    "expected": [
      {
        "biomarker_slug": "",
        "marker": "",
        "previous_value": null,
        "current_value": null,
        "unit": null,
        "previous_date": null,
        "direction": null,
        "status": null,
        "summary": null
      }
    ]
  },
  {
    "full": {
      "key_findings": [
        {
          "biomarker_slug": "x",
          "status": null
        },
        {
          "biomarker_slug": "x",
          "abnormal": true
        },
        {
          "biomarker_slug": "x",
          "urgent": true
        }
      ],
      "trend_evidence": [
        {
          "biomarker_slug": "x",
          "delta": 1,
          "marker": {
            "name": "ignored"
          }
        }
      ]
    },
    "expected": [
      {
        "biomarker_slug": "x",
        "marker": "x",
        "previous_value": null,
        "current_value": null,
        "unit": null,
        "previous_date": null,
        "direction": null,
        "status": null,
        "summary": null
      }
    ]
  },
  {
    "full": {
      "key_findings": [
        {
          "biomarker_slug": "x",
          "status": "monitor"
        }
      ],
      "trend_evidence": [
        {
          "biomarker_slug": "x",
          "delta": 1
        }
      ]
    },
    "expected": []
  }
]$trend_cases$::jsonb;
  item jsonb; source text; actual jsonb;
BEGIN
  FOR item IN SELECT value FROM jsonb_array_elements(cases) LOOP
    actual := public.interpretation_floor(item->'full');
    IF COALESCE(actual->'flagged_trends', '[]'::jsonb) <> item->'expected' THEN
      RAISE EXCEPTION 'one-argument flagged trend parity failure: %', actual;
    END IF;
    FOREACH source IN ARRAY ARRAY['ai','fallback','deterministic',NULL] LOOP
      actual := public.interpretation_floor(item->'full', source);
      IF COALESCE(actual->'flagged_trends', '[]'::jsonb) <> item->'expected' THEN
        RAISE EXCEPTION 'source-aware flagged trend parity failure: %', actual;
      END IF;
      IF item->'expected'='[]'::jsonb AND actual ? 'flagged_trends' THEN
        RAISE EXCEPTION 'empty evidence must not introduce a key';
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- Every row is accounted for: only a missing key with abnormal evidence changes.
SELECT set_config('test.trend_relation', :'rel', false);
DO $$
DECLARE row record; expected jsonb; eligible integer := 0; preserved integer := 0;
BEGIN
  FOR row IN EXECUTE format('SELECT s.*, n.json_output AS new_full, n.json_output_basic AS new_basic,
    n.stored_depth AS new_depth, n.projection_version AS new_version
    FROM flagged_trend_snapshot s JOIN %I n USING (id)', current_setting('test.trend_relation')) LOOP
    expected := row.json_output_basic;
    IF NOT COALESCE(expected ? 'flagged_trends', false)
      AND public.interpretation_flagged_trends(row.json_output) <> '[]'::jsonb THEN
      expected := COALESCE(expected, public.interpretation_floor(row.json_output))
        || jsonb_build_object('flagged_trends', public.interpretation_flagged_trends(row.json_output));
      eligible := eligible + 1;
    ELSE preserved := preserved + 1;
    END IF;
    IF row.new_basic IS DISTINCT FROM expected OR row.new_full IS DISTINCT FROM row.json_output
      OR row.new_depth IS DISTINCT FROM row.stored_depth OR row.new_version IS DISTINCT FROM row.projection_version THEN
      RAISE EXCEPTION 'backfill changed unexpected fields on %', row.id;
    END IF;
  END LOOP;
  IF eligible = 0 OR preserved = 0 THEN RAISE EXCEPTION 'missing repaired/preserved fixture coverage'; END IF;
END $$;

-- A legacy-writer full-body update must keep flagged lines via the trigger.
-- Roll back so this check does not perturb the later migration cases.
BEGIN;
UPDATE :rel SET json_output = json_output || '{"legacy_update":true}'::jsonb
WHERE lab_report_id = '09100000-0000-4000-8000-000000000050';
DO $$
DECLARE actual jsonb; full_body jsonb;
BEGIN
  EXECUTE format('SELECT json_output_basic, json_output FROM %I
    WHERE lab_report_id = ''09100000-0000-4000-8000-000000000050''', current_setting('test.trend_relation'))
    INTO actual, full_body;
  IF actual->'flagged_trends' IS DISTINCT FROM public.interpretation_flagged_trends(full_body) THEN
    RAISE EXCEPTION 'legacy trigger dropped flagged trends';
  END IF;
END $$;
ROLLBACK;
