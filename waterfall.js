// ---- CONFIG ----
const BASE_URL = "https://rainreport-971121604103.us-east5.run.app";
const FALLBACK_POINTS = [""];  

// ---- STATE ----
let chart = null;
let fullSeries = []; // all points returned from API (ms timestamps)
let minTs = 0;
let maxTs = 0;


function getUrlParam(name) {
  try {
    return new URLSearchParams(window.location.search).get(name);
  } catch (_) {
    return null;
  }
}



// ---------- UI helpers (jQuery) ----------
function setStatus(msg, isError = false) {
  // const $s = $("#status");
  // $s.text(msg);

  // // Bootstrap alert styling
  // $s.removeClass("alert-secondary alert-danger");
  // $s.addClass(isError ? "alert-danger" : "alert-secondary");
}

function fmt(dtMs) {
  const d = new Date(dtMs);
  return isNaN(d) ? "—" : d.toLocaleString();
}

// ---------- HTTP (jQuery) ----------
function fetchJson(url) {
  // Returns a Promise that resolves with JSON or rejects with an Error
  return $.ajax({
    url,
    method: "GET",
    dataType: "json",
    cache: false,
  }).catch((xhr) => {
    const text = (xhr && xhr.responseText) ? xhr.responseText : "";
    throw new Error(`HTTP ${xhr.status}: ${text}`);
  });
}

function loadPoints() {
  return fetchJson(`${BASE_URL}/v1/nexrain/waterfallpoints`)
    .then((data) => {
      const items = Array.isArray(data.items) ? data.items : [];
      return items.length ? items : FALLBACK_POINTS;
    })
    .catch(() => FALLBACK_POINTS);
}

function loadRecent(point) {
  const url = `${BASE_URL}/v1/nexrain/recent?point=${encodeURIComponent(point)}&limit=10000`;
  return fetchJson(url);
}

// ---------- Chart ----------
function buildChart() {
  const ctx = document.getElementById("chart").getContext("2d");

  chart = new Chart(ctx, {
    type: "line",
    data: {
      datasets: [{
        label: "DBZ",
        data: [],
        parsing: false,
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.15,
        spanGaps: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "nearest", intersect: false },
      plugins: {
        legend: { display: false },
      tooltip: {
        callbacks: {
            title: (ctx) => {
            const x = ctx?.[0]?.parsed?.x;
            return x ? new Date(x).toLocaleString() : "";
            },
            label: (ctx) => {
            const d = ctx.raw?.descript;
            const y = ctx.parsed?.y;

            if (d && y !== null && y !== undefined) {
                return `${d} (${y} dBZ)`;
            }
            if (d) return d;
            if (y !== null && y !== undefined) return `${y} dBZ`;
            return "";
            }
        }
        }

      },
      scales: {
        x: {
          type: "time",
          title: { display: true, text: "Date / Time" },
          time: {
            displayFormats: {
              minute: "M/d h:mm a",
              hour: "M/d h a",
              day: "M/d"
            }
          },
          ticks: { autoSkip: true, maxTicksLimit: 8 }
        },
        y: {
          min: 0,
          max: 60,
          title: { display: true, text: "DBZ" },
          ticks: { stepSize: 10 }
        }
      }
    }
  });
}

function setSeriesFromPayload(payload) {
  const items = Array.isArray(payload.items) ? payload.items : [];

    const series = items.map(r => {
    const iso = r.DT_ISO || r.DT;
    const x = new Date(iso).getTime();
    const y = (r.DBZ === null || r.DBZ === undefined) ? null : Number(r.DBZ);

    return isNaN(x) ? null : {
        x,
        y,
        descript: r.DESCRIPT || ""   // ← store description per point
    };
    }).filter(Boolean);


  series.sort((a, b) => a.x - b.x);

  fullSeries = series;
  minTs = fullSeries.length ? fullSeries[0].x : (Date.now() - 7 * 24 * 60 * 60 * 1000);
  maxTs = fullSeries.length ? fullSeries[fullSeries.length - 1].x : Date.now();
}

function applyWindowHoursFilter() {
  if (!chart) return;

  const hours = Number($("#windowHours").val() || "24");
  const windowMs = hours * 60 * 60 * 1000;

  const end = maxTs || Date.now();
  const start = Math.max(minTs, end - windowMs);

  const filtered = fullSeries.filter(p => p.x >= start && p.x <= end);

  chart.data.datasets[0].data = filtered;
  chart.options.scales.x.min = start;
  chart.options.scales.x.max = end;
  chart.update("none");


  // --- NEW LOGIC ---
  const hasDbzAboveZero = filtered.some(p =>
    typeof p.y === "number" && p.y > 0
  );

  if (!filtered.length) {
    setStatus(`No data available for ${$("#pointSelect").val()} in this time window.`, true);
  }
  else if (!hasDbzAboveZero) {
    setStatus(`No Precipitation above 0 for ${$("#pointSelect").val()} in the selected time range.`);
  }
  else {
    setStatus(
      `Showing ${$("#pointSelect").val()} • ${filtered.length} data pts • ${fmt(start)} → ${fmt(end)}`
    );
  }

  // Meta pills (unchanged)
  $("#pillView").text(`view: ${fmt(start)} → ${fmt(end)}`);
  $("#pillCount").text(`count: ${filtered.length}`);
}

// ---------- App flow ----------
function refreshForSelectedPoint() {
  const point = $("#pointSelect").val();
  if (!point) return;

  setStatus(`Loading ${point}…`);

  return loadRecent(point)
    .then((payload) => {
      setSeriesFromPayload(payload);
      if (!chart) buildChart();
      applyWindowHoursFilter();
    })
    .catch((err) => {
      console.error(err);
      setStatus(`Failed to load ${point}. ${err.message || err}`, true);
    });
}

function init() {
  setStatus("Loading points…");

  // URL params (support a couple names for convenience)
  const pointParam = getUrlParam("point");
  const hoursParam = getUrlParam("hours") || getUrlParam("windowHours");

  loadPoints().then((points) => {
    const $sel = $("#pointSelect");
    $sel.empty();

    points.forEach((p) => {
      $sel.append($("<option>", { value: p, text: p }));
    });

    // 1) windowHours from URL (must match an existing option)
    if (hoursParam) {
      const hoursStr = String(hoursParam).trim();
      if ($("#windowHours option[value='" + hoursStr.replace(/'/g, "\\'") + "']").length) {
        $("#windowHours").val(hoursStr);
      }
    }

    // 2) point from URL (must match one of the loaded points)
    if (pointParam) {
      const wanted = String(pointParam).trim();
      const match = points.find(p => String(p).toLowerCase() === wanted.toLowerCase());
      if (match) {
        $sel.val(match);
      } else if (points.length) {
        $sel.val(points[0]);
      }
    } else if (points.length) {
      // default behavior
      $sel.val(points[0]);
    }

    return refreshForSelectedPoint();
  });
}

// DOM ready
$(function () {
  // Events
  $("#pointSelect").on("change", refreshForSelectedPoint);
  $("#windowHours").on("change", applyWindowHoursFilter);


   const $btn = $("#scrollDownBtn");
  const $target = $("#pointSelect").closest(".card");

  // Scroll to point select card
  $btn.on("click", function () {
    if ($target.length) {
      $("html, body").animate(
        { scrollTop: $target.offset().top - 12 },
        350
      );
    }
  });

  // Hide arrow once user scrolls past the chart
  const chartBottom = () => {
    const $chartCard = $(".chartCard");
    return $chartCard.length
      ? $chartCard.offset().top + $chartCard.outerHeight()
      : 0;
  };

  $(window).on("scroll", function () {
    if ($(window).scrollTop() > chartBottom() - 20) {
      $btn.fadeOut(150);
    } else {
      $btn.fadeIn(150);
    }
  });


  init();
});
