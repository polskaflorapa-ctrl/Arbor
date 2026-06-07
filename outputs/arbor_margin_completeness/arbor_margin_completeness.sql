-- ARBOR margin completeness validation
-- Run this in PostgreSQL on staging or production.
-- It creates a temporary session table only; it does not modify application data.

DROP TABLE IF EXISTS tmp_arbor_margin_completeness;

CREATE TEMP TABLE tmp_arbor_margin_completeness AS
WITH params AS (
  SELECT
    90::int AS lookback_days,
    NULL::int AS only_branch_id
),
settlements AS (
  SELECT
    tr.task_id,
    MAX(tr.created_at) AS latest_settlement_at,
    SUM(COALESCE(tr.wartosc_netto, 0)) AS settlement_revenue_net,
    SUM(COALESCE(tr.koszt_robocizny, 0)) AS labor_cost,
    SUM(COALESCE(tr.koszt_podwykonawcow, 0)) AS subcontractor_cost
  FROM task_rozliczenie tr
  GROUP BY tr.task_id
),
operational_costs AS (
  SELECT
    toc.task_id,
    SUM(CASE WHEN toc.category = 'sprzet' THEN COALESCE(toc.amount, 0) ELSE 0 END) AS equipment_cost,
    SUM(CASE WHEN toc.category = 'paliwo' THEN COALESCE(toc.amount, 0) ELSE 0 END) AS fuel_cost,
    SUM(CASE WHEN toc.category = 'utylizacja' THEN COALESCE(toc.amount, 0) ELSE 0 END) AS disposal_cost,
    SUM(CASE WHEN toc.category = 'inne' THEN COALESCE(toc.amount, 0) ELSE 0 END) AS other_cost,
    COUNT(*) AS operational_cost_rows
  FROM task_operational_costs toc
  GROUP BY toc.task_id
),
materials AS (
  SELECT
    tfmu.task_id,
    SUM(COALESCE(tfmu.koszt_laczny, 0)) AS material_cost,
    COUNT(*) AS material_rows
  FROM task_finish_material_usage tfmu
  GROUP BY tfmu.task_id
),
base AS (
  SELECT
    t.id AS task_id,
    t.status,
    t.oddzial_id,
    b.nazwa AS oddzial_nazwa,
    t.ekipa_id,
    tm.nazwa AS ekipa_nazwa,
    COALESCE(t.data_wykonania, t.data_planowana, t.updated_at::date, t.created_at::date) AS task_date,
    COALESCE(
      s.settlement_revenue_net,
      t.wartosc_netto_do_rozliczenia,
      t.wartosc_rzeczywista,
      t.wartosc_planowana,
      0
    ) AS revenue_net,
    COALESCE(s.labor_cost, 0) AS labor_cost,
    COALESCE(s.subcontractor_cost, 0) AS subcontractor_cost,
    COALESCE(oc.equipment_cost, 0) AS equipment_cost,
    COALESCE(oc.fuel_cost, 0) AS fuel_cost,
    COALESCE(m.material_cost, 0) AS material_cost,
    COALESCE(oc.disposal_cost, 0) AS disposal_cost,
    COALESCE(oc.other_cost, 0) AS other_cost,
    s.latest_settlement_at,
    COALESCE(oc.operational_cost_rows, 0) AS operational_cost_rows,
    COALESCE(m.material_rows, 0) AS material_rows
  FROM tasks t
  LEFT JOIN branches b ON b.id = t.oddzial_id
  LEFT JOIN teams tm ON tm.id = t.ekipa_id
  LEFT JOIN settlements s ON s.task_id = t.id
  LEFT JOIN operational_costs oc ON oc.task_id = t.id
  LEFT JOIN materials m ON m.task_id = t.id
  WHERE COALESCE(t.data_wykonania, t.data_planowana, t.updated_at::date, t.created_at::date)
        >= CURRENT_DATE - ((SELECT lookback_days FROM params) * INTERVAL '1 day')
    AND COALESCE(t.status, '') NOT ILIKE ANY (ARRAY['%anul%', '%cancel%'])
    AND (
      (SELECT only_branch_id FROM params) IS NULL
      OR t.oddzial_id = (SELECT only_branch_id FROM params)
    )
),
scored AS (
  SELECT
    *,
    labor_cost + subcontractor_cost + equipment_cost + fuel_cost + material_cost + disposal_cost + other_cost AS known_cost,
    revenue_net - (labor_cost + subcontractor_cost + equipment_cost + fuel_cost + material_cost + disposal_cost + other_cost) AS gross_margin,
    CASE
      WHEN revenue_net > 0 THEN
        (revenue_net - (labor_cost + subcontractor_cost + equipment_cost + fuel_cost + material_cost + disposal_cost + other_cost))
        / revenue_net
      ELSE NULL
    END AS margin_pct,
    (latest_settlement_at IS NULL)::int AS missing_settlement,
    (operational_cost_rows = 0)::int AS missing_operational_costs,
    (material_rows = 0)::int AS missing_materials,
    (labor_cost = 0)::int AS missing_labor_cost,
    (
      (latest_settlement_at IS NULL)::int
      + (operational_cost_rows = 0)::int
      + (material_rows = 0)::int
      + (labor_cost = 0)::int
    ) AS missing_lane_count
  FROM base
)
SELECT
  *,
  CASE
    WHEN revenue_net <= 0 THEN 'no_revenue'
    WHEN missing_lane_count >= 3 THEN 'high_risk_margin'
    WHEN missing_lane_count = 2 THEN 'medium_risk_margin'
    WHEN missing_lane_count = 1 THEN 'low_risk_margin'
    ELSE 'complete_enough'
  END AS margin_confidence
FROM scored;

-- Branch-level health summary.
SELECT
  oddzial_id,
  oddzial_nazwa,
  COUNT(*) AS task_count,
  SUM(revenue_net) AS revenue_net,
  SUM(known_cost) AS known_cost,
  SUM(gross_margin) AS gross_margin,
  CASE WHEN SUM(revenue_net) > 0 THEN SUM(gross_margin) / SUM(revenue_net) END AS margin_pct,
  AVG(missing_lane_count::numeric) AS avg_missing_lane_count,
  SUM((margin_confidence = 'high_risk_margin')::int) AS high_risk_margin_tasks,
  SUM((margin_confidence = 'medium_risk_margin')::int) AS medium_risk_margin_tasks,
  SUM((margin_confidence = 'no_revenue')::int) AS no_revenue_tasks
FROM tmp_arbor_margin_completeness
GROUP BY oddzial_id, oddzial_nazwa
ORDER BY high_risk_margin_tasks DESC, revenue_net DESC;

-- Task-level queue for cleanup before margin decisions.
SELECT
  task_id,
  status,
  oddzial_id,
  oddzial_nazwa,
  ekipa_id,
  ekipa_nazwa,
  task_date,
  revenue_net,
  known_cost,
  gross_margin,
  margin_pct,
  missing_settlement,
  missing_operational_costs,
  missing_materials,
  missing_labor_cost,
  missing_lane_count,
  margin_confidence
FROM tmp_arbor_margin_completeness
ORDER BY missing_lane_count DESC, revenue_net DESC, task_date DESC
LIMIT 200;
