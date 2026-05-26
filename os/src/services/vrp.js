/**
 * VRP Solver — Clarke-Wright Savings Algorithm
 *
 * Solves the Vehicle Routing Problem with:
 *  - Time windows (okno_od / okno_do per task)
 *  - Service time (czas_obslugi_min per task)
 *  - Equipment type constraints (wymagany_sprzet_typ)
 *  - Required competencies (wymagane_kompetencje[])
 *  - Max working hours per crew (max_godzin_dzien)
 *  - Haversine distance → travel time estimation (avg 40 km/h in field)
 *
 * Input:  { tasks[], teams[], date }
 * Output: { routes[], unassigned[], stats }
 */

const AVG_SPEED_KMH = 40;
const DEFAULT_SERVICE_MIN = 60;
const DEFAULT_MAX_HOURS = 8;
const WORKDAY_START_HOUR = 7; // 07:00 default if no depot time

// ─── Geometry ────────────────────────────────────────────────────────────────

function toRad(deg) { return deg * Math.PI / 180; }

/**
 * Haversine distance in km between two lat/lng points.
 */
function haversineKm(lat1, lng1, lat2, lng2) {
  if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) return 50; // fallback
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Travel time in minutes between two points.
 */
function travelMin(lat1, lng1, lat2, lng2) {
  return (haversineKm(lat1, lng1, lat2, lng2) / AVG_SPEED_KMH) * 60;
}

// ─── Time helpers ─────────────────────────────────────────────────────────────

/** "HH:MM" → minutes from midnight */
function timeToMin(t) {
  if (!t) return null;
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + (m || 0);
}

/** minutes from midnight → "HH:MM" */
function minToTime(m) {
  const h = Math.floor(m / 60) % 24;
  const min = Math.round(m % 60);
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

// ─── Feasibility checks ───────────────────────────────────────────────────────

function teamCanHandleTask(team, task) {
  // Equipment type constraint
  if (task.wymagany_sprzet_typ && team.sprzet_typy) {
    const need = String(task.wymagany_sprzet_typ).toLowerCase();
    const has = (team.sprzet_typy || []).map(s => String(s).toLowerCase());
    if (!has.includes(need)) return false;
  }
  // Competency constraint
  if (task.wymagane_kompetencje && task.wymagane_kompetencje.length > 0) {
    const teamComps = new Set((team.kompetencje || []).map(c => String(c).toLowerCase()));
    for (const comp of task.wymagane_kompetencje) {
      if (!teamComps.has(String(comp).toLowerCase())) return false;
    }
  }
  return true;
}

// ─── Clarke-Wright Savings ────────────────────────────────────────────────────

/**
 * Build initial "star" routes: depot → task → depot for every (team, task).
 * Then merge routes by savings.
 */
function clarkeWright(team, tasks, depotLat, depotLng) {
  if (tasks.length === 0) return [];

  // Compute savings s(i,j) = d(depot,i) + d(depot,j) - d(i,j) for all pairs
  const savings = [];
  for (let i = 0; i < tasks.length; i++) {
    for (let j = i + 1; j < tasks.length; j++) {
      const ti = tasks[i], tj = tasks[j];
      const di = travelMin(depotLat, depotLng, ti.pin_lat, ti.pin_lng);
      const dj = travelMin(depotLat, depotLng, tj.pin_lat, tj.pin_lng);
      const dij = travelMin(ti.pin_lat, ti.pin_lng, tj.pin_lat, tj.pin_lng);
      savings.push({ i, j, saving: di + dj - dij });
    }
  }
  savings.sort((a, b) => b.saving - a.saving);

  // Each task starts in its own route
  const routes = tasks.map(t => [t]);
  const taskRoute = tasks.map((_, i) => i); // taskRoute[i] = route index

  const maxMin = (team.max_godzin_dzien || DEFAULT_MAX_HOURS) * 60;

  for (const { i, j } of savings) {
    const ri = taskRoute[i];
    const rj = taskRoute[j];
    if (ri === rj) continue; // already in same route

    const merged = [...routes[ri], ...routes[rj]];
    if (routeDurationMin(merged, depotLat, depotLng) > maxMin) continue;
    if (!timeWindowsOk(merged, depotLat, depotLng)) continue;

    // Merge: rj into ri
    routes[ri] = merged;
    const oldRj = rj;
    for (let k = 0; k < taskRoute.length; k++) {
      if (taskRoute[k] === oldRj) taskRoute[k] = ri;
    }
    routes[oldRj] = [];
  }

  return routes.filter(r => r.length > 0);
}

function routeDurationMin(tasks, depotLat, depotLng) {
  if (tasks.length === 0) return 0;
  let t = WORKDAY_START_HOUR * 60;
  let prevLat = depotLat, prevLng = depotLng;
  for (const task of tasks) {
    t += travelMin(prevLat, prevLng, task.pin_lat, task.pin_lng);
    t += task.czas_obslugi_min || DEFAULT_SERVICE_MIN;
    prevLat = task.pin_lat;
    prevLng = task.pin_lng;
  }
  t += travelMin(prevLat, prevLng, depotLat, depotLng);
  return t - WORKDAY_START_HOUR * 60;
}

function timeWindowsOk(tasks, depotLat, depotLng) {
  let t = WORKDAY_START_HOUR * 60;
  let prevLat = depotLat, prevLng = depotLng;
  for (const task of tasks) {
    t += travelMin(prevLat, prevLng, task.pin_lat, task.pin_lng);
    const windowFrom = timeToMin(task.okno_od);
    const windowTo   = timeToMin(task.okno_do);
    if (windowFrom != null && t < windowFrom) t = windowFrom; // wait at site
    if (windowTo   != null && t > windowTo)   return false;   // too late
    t += task.czas_obslugi_min || DEFAULT_SERVICE_MIN;
    prevLat = task.pin_lat;
    prevLng = task.pin_lng;
  }
  return true;
}

// ─── Build schedule (ETA per stop) ───────────────────────────────────────────

function buildSchedule(tasks, depotLat, depotLng, startMin) {
  const stops = [];
  let t = startMin ?? WORKDAY_START_HOUR * 60;
  let prevLat = depotLat, prevLng = depotLng;

  for (const task of tasks) {
    const travel = Math.round(travelMin(prevLat, prevLng, task.pin_lat, task.pin_lng));
    t += travel;
    const windowFrom = timeToMin(task.okno_od);
    const windowTo   = timeToMin(task.okno_do);
    if (windowFrom != null && t < windowFrom) t = windowFrom;
    const etaMin = t;
    const serviceMin = task.czas_obslugi_min || DEFAULT_SERVICE_MIN;
    t += serviceMin;

    stops.push({
      task_id:    task.id,
      task_numer: task.numer || `ZLE-${String(task.id).padStart(4,'0')}`,
      client:     task.klient_nazwa || task.client || '',
      client_phone: task.klient_telefon || task.client_phone || '',
      adres:      task.adres || task.miasto || '',
      lat:        task.pin_lat,
      lng:        task.pin_lng,
      eta:        minToTime(etaMin),
      eta_min:    etaMin,
      finish:     minToTime(t),
      travel_min: travel,
      service_min: serviceMin,
      time_window_ok: windowTo == null || etaMin <= windowTo,
      okno_od:    task.okno_od ?? null,
      okno_do:    task.okno_do ?? null,
      priorytet:  task.priorytet ?? 3,
    });

    prevLat = task.pin_lat;
    prevLng = task.pin_lng;
  }

  const returnTravel = Math.round(travelMin(prevLat, prevLng, depotLat, depotLng));
  const totalMin = t - (startMin ?? WORKDAY_START_HOUR * 60) + returnTravel;

  return { stops, total_min: totalMin, return_travel_min: returnTravel, end_time: minToTime(t + returnTravel) };
}

// ─── Main solver ──────────────────────────────────────────────────────────────

/**
 * @param {{
 *   tasks: Array<{id,numer,pin_lat,pin_lng,adres,miasto,priorytet,czas_obslugi_min,
 *                 okno_od,okno_do,wymagany_sprzet_typ,wymagane_kompetencje}>,
 *   teams: Array<{id,nazwa,depot_lat,depot_lng,max_godzin_dzien,
 *                 sprzet_typy,kompetencje,oddzial_id}>,
 *   date: string,       // ISO date "YYYY-MM-DD"
 *   oddzial_id?: number
 * }} input
 * @returns {{ routes: Array, unassigned: Array, stats: object }}
 */
function solve(input) {
  const t0 = Date.now();
  const { tasks, teams, date } = input;

  // Normalize task coordinates (fallback to city-centroid lookup is not done here,
  // tasks without coordinates get a penalty distance)
  const eligibleTasks = tasks.filter(t =>
    !['Zakonczone','Anulowane','W_Realizacji'].includes(t.status)
  );

  const routes = [];
  const assigned = new Set();
  const unassigned = [];

  for (const team of teams) {
    const depotLat = team.depot_lat ?? 50.06;  // Kraków default
    const depotLng = team.depot_lng ?? 19.94;

    // Tasks this team CAN handle
    const feasible = eligibleTasks.filter(t =>
      !assigned.has(t.id) && teamCanHandleTask(team, t)
    );

    if (feasible.length === 0) continue;

    // Sort by priority first (1=highest), then by distance from depot
    feasible.sort((a, b) => {
      if ((a.priorytet || 3) !== (b.priorytet || 3)) return (a.priorytet || 3) - (b.priorytet || 3);
      return haversineKm(depotLat, depotLng, a.pin_lat, a.pin_lng)
           - haversineKm(depotLat, depotLng, b.pin_lat, b.pin_lng);
    });

    // Clarke-Wright to find good route(s) for this team in one day
    const teamRoutes = clarkeWright(team, feasible, depotLat, depotLng);

    for (const routeTasks of teamRoutes) {
      const { stops, total_min, return_travel_min, end_time } =
        buildSchedule(routeTasks, depotLat, depotLng);

      routes.push({
        team_id:   team.id,
        team_name: team.nazwa,
        depot_lat: depotLat,
        depot_lng: depotLng,
        date,
        stops,
        total_min,
        return_travel_min,
        end_time,
        distance_km: Math.round(
          stops.reduce((sum, s) => sum + s.travel_min, 0) / 60 * AVG_SPEED_KMH
          + return_travel_min / 60 * AVG_SPEED_KMH
        ),
      });

      for (const t of routeTasks) assigned.add(t.id);
    }
  }

  // Collect unassigned
  for (const t of eligibleTasks) {
    if (!assigned.has(t.id)) {
      unassigned.push({
        task_id:    t.id,
        task_numer: t.numer || `ZLE-${String(t.id).padStart(4,'0')}`,
        adres:      t.adres || t.miasto || '',
        reason:     teams.length === 0 ? 'no_teams' :
                    !teams.some(tm => teamCanHandleTask(tm, t)) ? 'no_capable_team' :
                    'capacity_exceeded',
      });
    }
  }

  const solverMs = Date.now() - t0;

  return {
    routes,
    unassigned,
    stats: {
      solver_ms:       solverMs,
      tasks_total:     eligibleTasks.length,
      tasks_assigned:  assigned.size,
      tasks_unassigned: unassigned.length,
      teams_used:      new Set(routes.map(r => r.team_id)).size,
      coverage_pct:    eligibleTasks.length > 0
        ? Math.round((assigned.size / eligibleTasks.length) * 100)
        : 100,
    },
  };
}

module.exports = { solve, haversineKm, travelMin };
