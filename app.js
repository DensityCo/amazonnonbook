const state = {
  data: null,
  metricsLoaded: false,
  metricsLoading: null,
  activeTab: "daily",
  dailyDetailExpanded: false,
  dailyGroup: "floor",
  filters: {
    buildingIds: new Set(),
    floorIds: new Set(["all"]),
    type: "all",
    thresholdHours: 1,
    startDate: "",
    endDate: "",
    days: new Set([1, 2, 3, 4, 5]),
    startHour: 9,
    endHour: 17
  },
  tableFilters: {
    date: "all",
    day: "all",
    building: "all",
    floor: "all",
    type: "all"
  }
};

const els = {
  sourceNote: document.querySelector("#source-note"),
  buildingFilter: document.querySelector("#building-filter"),
  floorFilter: document.querySelector("#floor-filter"),
  typeFilter: document.querySelector("#type-filter"),
  thresholdFilter: document.querySelector("#threshold-filter"),
  thresholdValue: document.querySelector("#threshold-value"),
  startDateFilter: document.querySelector("#start-date-filter"),
  endDateFilter: document.querySelector("#end-date-filter"),
  startHourFilter: document.querySelector("#start-hour-filter"),
  endHourFilter: document.querySelector("#end-hour-filter"),
  dayButtons: [...document.querySelectorAll(".day-filter button")],
  tabButtons: [...document.querySelectorAll(".dashboard-tabs button")],
  tabPanels: [...document.querySelectorAll(".tab-panel")],
  emptyState: document.querySelector("#empty-state"),
  dashboard: document.querySelector("#dashboard"),
  insightScope: document.querySelector("#insight-scope"),
  insightTitle: document.querySelector("#insight-title"),
  insightCopy: document.querySelector("#insight-copy"),
  kpiAverageLabel: document.querySelector("#kpi-average-label"),
  kpiAverage: document.querySelector("#kpi-average"),
  kpiAverageSub: document.querySelector("#kpi-average-sub"),
  kpiAverageShare: document.querySelector("#kpi-average-share"),
  kpiPeakShare: document.querySelector("#kpi-peak-share"),
  comparisonHeading: document.querySelector("#comparison-heading"),
  comparisonSubtitle: document.querySelector("#comparison-subtitle"),
  comparisonGroupHeading: document.querySelector("#comparison-group-heading"),
  comparisonTable: document.querySelector("#comparison-table"),
  hourlyInsightScope: document.querySelector("#hourly-insight-scope"),
  hourlyInsightTitle: document.querySelector("#hourly-insight-title"),
  hourlyInsightCopy: document.querySelector("#hourly-insight-copy"),
  hourlyKpiHour: document.querySelector("#hourly-kpi-hour"),
  hourlyKpiHourSub: document.querySelector("#hourly-kpi-hour-sub"),
  dailyGroupButtons: [...document.querySelectorAll(".daily-group-toggle button")],
  weekdaySummary: document.querySelector("#weekday-summary"),
  weekdayLineSummary: document.querySelector("#weekday-line-summary"),
  inventoryBreakdown: document.querySelector("#inventory-breakdown"),
  dailyTrend: document.querySelector("#daily-trend"),
  dailyThresholdLegend: document.querySelector("#daily-threshold-legend"),
  dailyDateFilter: document.querySelector("#daily-date-filter"),
  dailyDayFilter: document.querySelector("#daily-day-filter"),
  dailyBuildingFilter: document.querySelector("#daily-building-filter"),
  dailyFloorFilter: document.querySelector("#daily-floor-filter"),
  dailyTypeFilter: document.querySelector("#daily-type-filter"),
  dailyDetailToggle: document.querySelector("#daily-detail-toggle"),
  dailyDetailBody: document.querySelector("#daily-detail-body"),
  dailyFloorHeading: document.querySelector("#daily-floor-heading"),
  dailyThresholdHeading: document.querySelector("#daily-threshold-heading"),
  dailyTable: document.querySelector("#daily-table"),
  heatmap: document.querySelector("#heatmap")
};

for (const [name, element] of Object.entries(els)) {
  if (Array.isArray(element)) continue;
  if (!element) throw new Error(`Missing required dashboard element: ${name}`);
}

const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const businessDays = [1, 2, 3, 4, 5];
const lineColors = ["#3367c2", "#2bb8a8", "#d5965f", "#8c5be8", "#159fd3"];

loadInitialData();

async function loadInitialData() {
  try {
    const catalogResponse = await fetch("data/catalog.json?v=daily-hourly-tabs-20260618-jfk27-through-jun17");
    if (catalogResponse.ok) {
      const catalog = await catalogResponse.json();
      state.data = { ...catalog, metrics: {} };
      state.metricsLoaded = false;
    } else {
      const response = await fetch("data/dashboard-data.json?v=daily-hourly-tabs-20260618-jfk27-through-jun17");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      state.data = await response.json();
      state.metricsLoaded = Boolean(state.data.metrics?.concurrency);
    }
    setupFilters();
    render();
  } catch (error) {
    els.sourceNote.textContent = `Could not load dashboard data: ${error.message}`;
  }
}

async function ensureMetricsLoaded() {
  if (state.metricsLoaded) return true;
  if (!state.metricsLoading) {
    els.sourceNote.textContent = "Loading usage metrics...";
    state.metricsLoading = fetch("data/metrics.json?v=daily-hourly-tabs-20260618-jfk27-through-jun17")
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const metricsPayload = await response.json();
        state.data = {
          ...state.data,
          metrics: metricsPayload.metrics || metricsPayload,
          metadata: {
            ...(state.data.metadata || {}),
            ...(metricsPayload.metadata || {})
          },
          dimensions: {
            ...(state.data.dimensions || {}),
            ...(metricsPayload.dimensions || {})
          }
        };
        state.metricsLoaded = true;
        state.metricsLoading = null;
      })
      .catch((error) => {
        state.metricsLoading = null;
        els.sourceNote.textContent = `Could not load usage metrics: ${error.message}`;
        throw error;
      });
  }
  await state.metricsLoading;
  return true;
}

function setupFilters() {
  const dates = availableDates();
  state.filters.startDate = state.data.metadata?.includedRange?.start || dates[0] || "";
  state.filters.endDate = state.data.metadata?.includedRange?.end || dates.at(-1) || "";
  const minDate = dates[0] || "";
  const maxDate = dates.at(-1) || "";

  setOptions(els.typeFilter, [
    { value: "all", label: "All non-bookable types" },
    ...availableTypes().map((type) => ({ value: type, label: type }))
  ]);
  setOptions(
    els.startHourFilter,
    range(6, 18).map((hour) => ({ value: hour, label: formatHour(hour) }))
  );
  setOptions(
    els.endHourFilter,
    range(7, 19).map((hour) => ({ value: hour, label: formatHour(hour) }))
  );

  els.typeFilter.value = state.filters.type;
  els.thresholdFilter.value = state.filters.thresholdHours;
  renderThresholdValue();
  els.startDateFilter.min = minDate;
  els.startDateFilter.max = maxDate;
  els.endDateFilter.min = minDate;
  els.endDateFilter.max = maxDate;
  els.startDateFilter.value = state.filters.startDate;
  els.endDateFilter.value = state.filters.endDate;
  els.startHourFilter.value = state.filters.startHour;
  els.endHourFilter.value = state.filters.endHour;

  els.typeFilter.addEventListener("change", () => {
    state.filters.type = els.typeFilter.value;
    render();
  });
  els.thresholdFilter.addEventListener("change", () => {
    state.filters.thresholdHours = Number(els.thresholdFilter.value);
    renderThresholdValue();
    render();
  });
  els.thresholdFilter.addEventListener("input", () => {
    state.filters.thresholdHours = Number(els.thresholdFilter.value);
    renderThresholdValue();
  });
  els.startDateFilter.addEventListener("change", () => {
    state.filters.startDate = clampDateToAvailableRange(els.startDateFilter.value);
    els.startDateFilter.value = state.filters.startDate;
    if (state.filters.endDate < state.filters.startDate) {
      state.filters.endDate = state.filters.startDate;
      els.endDateFilter.value = state.filters.endDate;
    }
    render();
  });
  els.endDateFilter.addEventListener("change", () => {
    state.filters.endDate = clampDateToAvailableRange(els.endDateFilter.value);
    els.endDateFilter.value = state.filters.endDate;
    if (state.filters.startDate > state.filters.endDate) {
      state.filters.startDate = state.filters.endDate;
      els.startDateFilter.value = state.filters.startDate;
    }
    render();
  });
  els.startHourFilter.addEventListener("change", () => {
    state.filters.startHour = Number(els.startHourFilter.value);
    if (state.filters.endHour <= state.filters.startHour) {
      state.filters.endHour = state.filters.startHour + 1;
      els.endHourFilter.value = state.filters.endHour;
    }
    render();
  });
  els.endHourFilter.addEventListener("change", () => {
    state.filters.endHour = Number(els.endHourFilter.value);
    if (state.filters.endHour <= state.filters.startHour) {
      state.filters.startHour = state.filters.endHour - 1;
      els.startHourFilter.value = state.filters.startHour;
    }
    render();
  });
  for (const button of els.dayButtons) {
    button.addEventListener("click", () => {
      const day = Number(button.dataset.day);
      if (state.filters.days.has(day) && state.filters.days.size > 1) state.filters.days.delete(day);
      else state.filters.days.add(day);
      render();
    });
  }
  for (const button of els.tabButtons) {
    button.addEventListener("click", () => {
      state.activeTab = button.dataset.tab;
      render();
    });
  }
  for (const button of els.dailyGroupButtons) {
    button.addEventListener("click", () => {
      state.dailyGroup = button.dataset.group;
      render();
    });
  }
  els.dailyDetailToggle.addEventListener("click", () => {
    state.dailyDetailExpanded = !state.dailyDetailExpanded;
    render();
  });
  for (const [key, select] of Object.entries(dailyTableFilterElements())) {
    select.addEventListener("change", () => {
      state.tableFilters[key] = select.value;
      if (state.dailyDetailExpanded) renderDailyTable(filteredSpaces(), computeUsageSummary(filteredSpaces()));
    });
  }
}

function render() {
  if (!state.data) return;
  renderBuildingPills();
  renderFloorPills();
  refreshDayButtons();
  refreshTabs();
  for (const button of els.dailyGroupButtons) {
    button.classList.toggle("active", button.dataset.group === state.dailyGroup);
  }

  els.sourceNote.textContent = sourceText();
  const hasBuildingSelection = state.filters.buildingIds.size > 0;
  els.emptyState.hidden = hasBuildingSelection;
  els.dashboard.hidden = !hasBuildingSelection;
  if (!hasBuildingSelection) return;
  if (!state.metricsLoaded) {
    ensureMetricsLoaded()
      .then(() => render())
      .catch(() => {});
    return;
  }

  const spaces = filteredSpaces();
  const usage = computeUsageSummary(spaces);

  if (state.activeTab === "daily") {
    renderDailyInsight(spaces, usage);
    renderKpis(spaces, usage);
    renderInventoryBreakdown(spaces);
    renderComparison(spaces, usage);
    renderDailyTrend(spaces, usage);
    renderWeekdaySummary(spaces, usage);
    renderDailyDetail(spaces, usage);
  } else {
    const summary = computeSummary(spaces);
    renderHourlyInsight(spaces, summary, usage);
    renderWeekdayLineSummary(spaces);
    renderHeatmap(summary);
  }
}

function renderThresholdValue() {
  els.thresholdValue.textContent = thresholdLabelText();
}

function renderDailyDetail(spaces, usage) {
  els.dailyDetailToggle.textContent = state.dailyDetailExpanded ? "Collapse" : "Expand";
  els.dailyDetailToggle.classList.toggle("active", state.dailyDetailExpanded);
  els.dailyDetailToggle.setAttribute("aria-expanded", String(state.dailyDetailExpanded));
  els.dailyDetailBody.hidden = !state.dailyDetailExpanded;

  if (state.dailyDetailExpanded) {
    renderDailyTable(spaces, usage);
  } else {
    els.dailyTable.replaceChildren();
  }
}

function renderBuildingPills() {
  const buildings = eligibleBuildings();
  const options = [{ id: "all", label: "All" }].concat(
    buildings.map((building) => ({
      id: building.buildingId,
      label: shortBuildingName(building.buildingName)
    }))
  );
  renderPills(els.buildingFilter, options, state.filters.buildingIds, (id) => {
    toggleBuildingFilter(id);
    state.filters.floorIds = new Set(["all"]);
    render();
  });
}

function renderFloorPills() {
  const floors = eligibleFloors()
    .filter((floor) => state.filters.buildingIds.has("all") || state.filters.buildingIds.has(floor.buildingId))
    .sort((a, b) => a.buildingName.localeCompare(b.buildingName) || a.floorName.localeCompare(b.floorName));
  const options = [{ id: "all", label: "All" }].concat(
    floors.map((floor) => ({
      id: floor.floorId,
      label: floorPillLabel(floor)
    }))
  );
  const allowed = new Set(options.map((option) => option.id));
  state.filters.floorIds = new Set([...state.filters.floorIds].filter((id) => allowed.has(id)));
  if (!state.filters.floorIds.size) state.filters.floorIds.add("all");
  renderPills(els.floorFilter, options, state.filters.floorIds, (id) => {
    toggleSetFilter(state.filters.floorIds, id);
    render();
  });
}

function renderPills(container, options, selectedSet, onClick) {
  container.replaceChildren(
    ...options.map((option) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = selectedSet.has(option.id) ? "active" : "";
      button.textContent = option.label;
      button.addEventListener("click", () => onClick(option.id));
      return button;
    })
  );
}

function toggleBuildingFilter(id) {
  if (id === "all") {
    state.filters.buildingIds = state.filters.buildingIds.has("all") ? new Set() : new Set(["all"]);
    return;
  }
  state.filters.buildingIds.delete("all");
  if (state.filters.buildingIds.has(id)) state.filters.buildingIds.delete(id);
  else state.filters.buildingIds.add(id);
}

function toggleSetFilter(set, id) {
  if (id === "all") {
    set.clear();
    set.add("all");
    return;
  }
  set.delete("all");
  if (set.has(id)) set.delete(id);
  else set.add(id);
  if (!set.size) set.add("all");
}

function refreshDayButtons() {
  for (const button of els.dayButtons) {
    button.classList.toggle("active", state.filters.days.has(Number(button.dataset.day)));
  }
}

function refreshTabs() {
  for (const button of els.tabButtons) {
    button.classList.toggle("active", button.dataset.tab === state.activeTab);
  }
  for (const panel of els.tabPanels) {
    panel.hidden = panel.dataset.panel !== state.activeTab;
  }
}

function renderDailyInsight(spaces, usage) {
  const typeLabel = selectedTypeLabel();
  els.insightScope.textContent = [
    selectedBuildingLabel(),
    selectedFloorLabel(),
    typeLabel,
    `${state.filters.startDate} to ${state.filters.endDate}`,
    `${formatHour(state.filters.startHour)}-${formatHour(state.filters.endHour)}`
  ].join(" · ");

  if (!spaces.length) {
    els.insightTitle.textContent = "No labeled non-bookable spaces match the selected filters.";
    els.insightCopy.textContent = "Choose another building, floor, or space type.";
    return;
  }

  els.insightTitle.innerHTML = `The average selected ${escapeHtml(averageSubjectLabel())} was used for <span>${number(usage.avgHoursPerSpacePerDay, 2)} hours</span> per selected day.`;
  els.insightCopy.innerHTML = buildingInsightLines(spaces, usage).join("<br>");
}

function renderHourlyInsight(spaces, summary, usage) {
  const peak = summary.peak;
  els.hourlyInsightScope.textContent = [
    selectedBuildingLabel(),
    selectedFloorLabel(),
    selectedTypeLabel(),
    `${state.filters.startDate} to ${state.filters.endDate}`,
    `${formatHour(state.filters.startHour)}-${formatHour(state.filters.endHour)}`
  ].join(" · ");

  if (!spaces.length) {
    els.hourlyInsightTitle.textContent = "No labeled non-bookable spaces match the selected filters.";
    els.hourlyInsightCopy.textContent = "Choose another building, floor, or space type.";
    return;
  }

  const busiest = busiestHour(summary);
  els.hourlyInsightTitle.innerHTML = `At the busiest times, <span>${number(peak.active, 0)} of ${spaces.length}</span> selected ${escapeHtml(subjectPluralLabel())} were in use simultaneously.`;
  els.hourlyInsightCopy.innerHTML = hourlyInsightCopy(spaces, summary, busiest);
  els.hourlyKpiHour.textContent = busiest ? formatHourLabel(busiest.hour) : "-";
  els.hourlyKpiHourSub.textContent = busiest ? `${dayNames[busiest.day]} · ${number(busiest.value, 1)} avg active spaces` : "no hourly activity";
}

function hourlyInsightCopy(spaces, summary, busiest) {
  if (!summary.peak.active) return "No raw-session activity was present in the selected window.";

  const buildingLines = hourlyPeakLinesByBuilding(spaces);
  if (buildingLines.length > 1) return buildingLines.join("<br>");

  const peak = summary.peak;
  const busiestSentence = busiest
    ? ` ${dayNames[busiest.day]} at ${formatHourLabel(busiest.hour)} had the highest average active count at ${number(busiest.value, 1)} spaces.`
    : "";
  return `Peak simultaneous use happened on ${dayNames[peak.day]} ${peak.date} at ${formatTimeOfDay(peak.hour, peak.minute)}.${busiestSentence}`;
}

function hourlyPeakLinesByBuilding(spaces) {
  return [...groupBy(spaces, (space) => space.buildingId)]
    .map(([, groupSpaces]) => {
      const summary = computeSummary(groupSpaces);
      return {
        label: shortBuildingName(groupSpaces[0].buildingName),
        spaceCount: groupSpaces.length,
        peak: summary.peak
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" }))
    .map((group) => {
      if (!group.peak.active) {
        return `<strong>${escapeHtml(group.label)}</strong>: no simultaneous use in the selected window.`;
      }
      const peakShare = formatShare(group.spaceCount ? group.peak.active / group.spaceCount : 0, 0);
      return `<strong>${escapeHtml(group.label)}</strong>: peak simultaneous use was ${number(group.peak.active, 0)} of ${group.spaceCount} selected spaces (${peakShare}) on ${dayNames[group.peak.day]} ${escapeHtml(group.peak.date)} at ${formatTimeOfDay(group.peak.hour, group.peak.minute)}.`;
    });
}

function renderKpis(spaces, usage) {
  const week = usage.weekOverWeek;
  els.kpiAverageLabel.textContent = "Usage time change";
  els.kpiAverage.textContent = formatDailyWeekOverWeekValue(week);
  els.kpiAverageSub.textContent = formatDailyWeekOverWeekSubtext(week);
  els.kpiAverageShare.textContent = `${number(usage.averageDailyThreshold, 0)}/${spaces.length}`;
  els.kpiPeakShare.textContent = usage.peakDailyThreshold
    ? `${number(usage.peakDailyThreshold.thresholdCount, 0)}/${spaces.length}`
    : `0/${spaces.length}`;
}

function renderWeekdaySummary(spaces, usage) {
  const selectedDays = businessDays.filter((day) => state.filters.days.has(day));
  const rowsByDay = new Map(selectedDays.map((day) => [day, []]));
  const thresholdLabel = thresholdLabelText();
  for (const { date, day } of selectedDateEntries()) {
    if (!rowsByDay.has(day)) continue;
    const daily = usage.daily.get(date) || emptyDailyUsage(date, day);
    rowsByDay.get(day).push({
      date,
      day,
      thresholdSpaces: daily.thresholdCount,
      avgHours: spaces.length ? daily.totalHours / spaces.length : 0
    });
  }
  for (const rows of rowsByDay.values()) rows.sort((a, b) => a.date.localeCompare(b.date));

  els.weekdaySummary.replaceChildren(
    ...selectedDays.map((day) => {
      const rows = rowsByDay.get(day) || [];
      const latest = rows.at(-1) || null;
      const previous = rows.at(-2) || null;
      const node = document.createElement("article");
      node.className = "weekday-used-card";
      node.innerHTML = `
        <div class="weekday-used-head">
          <strong>${escapeHtml(dayNames[day])}</strong>
          <span>${formatWeekdayHourChange(latest?.avgHours ?? null, previous?.avgHours ?? null)}</span>
        </div>
        <div class="weekday-used-list">
          <div class="weekday-used-row weekday-used-row-head">
            <span>Date</span>
            <span>Used ${escapeHtml(thresholdLabel)}</span>
            <span>Avg hrs</span>
          </div>
          ${rows
            .map(
              (row) => `
                <div class="weekday-used-row">
                  <span>${escapeHtml(row.date)}</span>
                  <strong>${number(row.thresholdSpaces, 0)}/${spaces.length}</strong>
                  <strong>${number(row.avgHours, 1)}h</strong>
                </div>
              `
            )
            .join("")}
        </div>
      `;
      return node;
    })
  );
}

function renderWeekdayLineSummary(spaces) {
  const selectedDays = businessDays.filter((day) => state.filters.days.has(day));
  const hourly = computeWeekdayHourlyUsage(spaces);
  const globalMax = Math.max(
    ...selectedDays.flatMap((day) => hourly.get(day)?.hours.map((item) => item.avgUsed) || []),
    ...selectedDays.flatMap((day) => hourly.get(day)?.dateSeries.flatMap((series) => series.counts) || []),
    1
  );

  els.weekdayLineSummary.replaceChildren(
    ...selectedDays.map((day, dayIndexValue) => {
      const chart = hourly.get(day) || emptyWeekdayChart(day);
      const color = lineColors[dayIndexValue % lineColors.length];
      const node = document.createElement("article");
      node.className = "weekday-chart-card";
      node.innerHTML = `
        <div class="weekday-chart-head">
          <strong style="color:${color}">${escapeHtml(dayNames[day])}</strong>
          <span class="weekday-peak">
            <em>peak ${number(chart.peakUsed, 0)}/${spaces.length}</em>
            <small>${chart.peakHour == null ? "-" : escapeHtml(formatHourLabel(chart.peakHour))}</small>
          </span>
        </div>
        ${weekdayTileSvg(chart, globalMax, color, spaces.length)}
        <div class="weekday-axis">
          <span>${formatHour(state.filters.startHour)}</span>
          <span>${formatHour(Math.max(state.filters.startHour, state.filters.endHour - 1))}</span>
        </div>
        <div class="weekday-chart-foot">
          <span>min ${number(chart.minUsed, 0)}</span>
          <span>avg ${number(chart.avgUsed, 1)}</span>
          <span>pk ${number(chart.peakUsed, 0)}</span>
        </div>
      `;
      return node;
    })
  );
}

function weekdayTileSvg(chart, globalMax, color, spaceCount) {
  const width = 320;
  const height = 118;
  const pad = { left: 34, right: 12, top: 8, bottom: 12 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const yMax = Math.max(globalMax, 1);
  const xFor = (index) => pad.left + (chart.hours.length <= 1 ? innerW / 2 : (index / (chart.hours.length - 1)) * innerW);
  const yFor = (value) => pad.top + innerH - (value / yMax) * innerH;
  const pointsFor = (values) => values.map((value, index) => `${xFor(index)},${yFor(value)}`).join(" ");
  const averageValues = chart.hours.map((item) => item.avgUsed);
  const dailyLines = chart.dateSeries
    .map((series) => `<polyline class="weekday-trace" points="${pointsFor(series.counts)}"><title>${escapeHtml(series.date)} hourly spaces used</title></polyline>`)
    .join("");
  const averagePoints = chart.hours
    .map(
      (item, index) =>
        `<circle cx="${xFor(index)}" cy="${yFor(item.avgUsed)}" r="2.4" fill="${color}">
          <title>${escapeHtml(dayNames[chart.day])} ${formatHour(item.hour)}: ${number(item.avgUsed, 1)} avg spaces used of ${spaceCount}</title>
        </circle>`
    )
    .join("");

  return `
    <svg class="weekday-line-chart" style="color:${color}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(dayNames[chart.day])} hourly used-space line chart">
      <line x1="${pad.left}" x2="${width - pad.right}" y1="${yFor(yMax)}" y2="${yFor(yMax)}" class="weekday-grid"></line>
      <line x1="${pad.left}" x2="${width - pad.right}" y1="${yFor(yMax / 2)}" y2="${yFor(yMax / 2)}" class="weekday-grid"></line>
      <line x1="${pad.left}" x2="${width - pad.right}" y1="${yFor(0)}" y2="${yFor(0)}" class="weekday-grid"></line>
      <text x="2" y="${yFor(yMax) + 4}" class="weekday-chart-label">${number(yMax, yMax >= 10 ? 0 : 1)}</text>
      <text x="2" y="${yFor(yMax / 2) + 4}" class="weekday-chart-label">${number(yMax / 2, yMax / 2 >= 10 ? 0 : 1)}</text>
      <text x="2" y="${yFor(0) + 4}" class="weekday-chart-label">0</text>
      ${dailyLines}
      <polyline class="weekday-average-line" style="stroke:${color}" points="${pointsFor(averageValues)}"></polyline>
      ${averagePoints}
    </svg>
  `;
}

function renderInventoryBreakdown(spaces) {
  const counts = [...groupBy(spaces, (space) => space.type)]
    .map(([type, groupSpaces]) => ({ type, count: groupSpaces.length }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
  els.inventoryBreakdown.replaceChildren(
    ...counts.map(({ type, count }) => {
      const node = document.createElement("button");
      node.type = "button";
      node.className = state.filters.type === type ? "active" : "";
      node.setAttribute("aria-pressed", state.filters.type === type ? "true" : "false");
      node.innerHTML = `<strong>${count}</strong> ${escapeHtml(count === 1 ? singularTypeLabel(type) : type)}`;
      node.addEventListener("click", () => {
        state.filters.type = state.filters.type === type ? "all" : type;
        els.typeFilter.value = state.filters.type;
        render();
      });
      return node;
    })
  );
}

function renderDailyTrend(spaces, usage) {
  const rows = selectedDateEntries().map(({ date, day }) => usage.daily.get(date) || emptyDailyUsage(date, day));
  const groups = comparisonGroups(spaces);
  const series =
    groups.length > 1 && groups.length <= 8
      ? groups.map((group) => ({
          label: group.label,
          spaceCount: group.spaces.length,
          rows: selectedDateEntries().map(({ date, day }) =>
            usageForSpacesOnDate(group.spaces, date, usage.bySpaceDate, day)
          )
        }))
      : [{ label: selectedBuildingLabel(), spaceCount: spaces.length, rows }];
  const enrichedSeries = series.map((item) => ({
    ...item,
    rows: item.rows.map((row) => ({
      ...row,
      avgHoursPerSpace: item.rows.length && item.label ? averageDailyHoursForRow(row, item) : 0
    }))
  }));
  const maxValue = Math.max(...enrichedSeries.flatMap((item) => item.rows.map((row) => row.avgHoursPerSpace)), 1);
  els.dailyThresholdLegend.textContent =
    enrichedSeries.length > 1 ? `Avg hrs / space / day by ${comparisonModeLabel().toLowerCase()}` : "Avg hrs / space / day";
  els.dailyTrend.innerHTML = dailyTrendSvg(enrichedSeries, maxValue);
}

function averageDailyHoursForRow(row, item) {
  const spaceCount = item.spaceCount || null;
  if (spaceCount) return row.totalHours / spaceCount;
  return 0;
}

function dailyTrendSvg(series, maxValue) {
  const width = 1120;
  const height = 220;
  const rows = series[0]?.rows || [];
  const pad = { left: 42, right: 24, top: 24, bottom: 44 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const yMax = Math.max(maxValue, 1);
  const xFor = (index) => pad.left + (rows.length <= 1 ? innerW / 2 : (index / (rows.length - 1)) * innerW);
  const yFor = (value) => pad.top + innerH - (value / yMax) * innerH;
  const pointsFor = (itemRows) => itemRows.map((row, index) => `${xFor(index)},${yFor(row.avgHoursPerSpace)}`).join(" ");
  const labelRows = rows.filter((_, index) => index === 0 || index === rows.length - 1 || index % Math.ceil(rows.length / 8) === 0);
  const grid = [0, 0.5, 1];

  return `
    <svg class="daily-line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Average usage time over time">
      ${grid
        .map((value) => {
          const y = yFor(yMax * value);
          return `<line x1="${pad.left}" x2="${width - pad.right}" y1="${y}" y2="${y}" class="daily-grid"></line><text x="8" y="${y + 4}" class="daily-chart-label">${number(yMax * value, yMax >= 10 ? 0 : 1)}</text>`;
        })
        .join("")}
      ${labelRows
        .map((row, index) => {
          const rowIndex = rows.indexOf(row);
          const x = xFor(rowIndex);
          return `<text x="${x}" y="${height - 16}" text-anchor="${index === 0 ? "start" : index === labelRows.length - 1 ? "end" : "middle"}" class="daily-chart-label">${escapeHtml(row.date.slice(5))}</text>`;
        })
        .join("")}
      ${series
        .map((item, index) => {
          const color = lineColors[index % lineColors.length];
          return `<polyline class="daily-line threshold" style="stroke:${color}" points="${pointsFor(item.rows)}"><title>${escapeHtml(item.label)} avg hours per space per day</title></polyline>`;
        })
        .join("")}
      ${series.length === 1 ? rows
        .map((row, index) => {
          const x = xFor(index);
          const y = yFor(row.avgHoursPerSpace);
          return `
            <text x="${x}" y="${Math.max(12, y - 10)}" text-anchor="middle" class="daily-point-label">${number(row.avgHoursPerSpace, 1)}h</text>
            <circle class="daily-dot threshold" cx="${x}" cy="${y}" r="3">
              <title>${escapeHtml(row.date)}: ${number(row.avgHoursPerSpace, 2)} avg hrs / space / day</title>
            </circle>
          `;
        })
        .join("") : ""}
      ${series.length > 1
        ? series
            .map((item, index) => {
              const y = 16 + index * 14;
              const color = lineColors[index % lineColors.length];
              return `<circle cx="${width - 190}" cy="${y - 4}" r="4" fill="${color}"></circle><text x="${width - 180}" y="${y}" class="daily-chart-label">${escapeHtml(item.label)}</text>`;
            })
            .join("")
        : ""}
    </svg>
  `;
}

function renderComparison(spaces, usage) {
  const groups = comparisonGroups(spaces);
  const mode = comparisonModeLabel();
  els.comparisonHeading.textContent = `${mode} comparison`;
  els.comparisonGroupHeading.textContent = mode;
  els.comparisonSubtitle.textContent = `Average usage time and week-over-week change for the current ${selectedTypeLabel().toLowerCase()} scope`;

  const rows = groups
    .map((group) => {
      const dailyRowsForGroup = selectedDateEntries().map(({ date, day }) =>
        usageForSpacesOnDate(group.spaces, date, usage.bySpaceDate, day)
      );
      const averageDailyThreshold = dailyRowsForGroup.length ? sum(dailyRowsForGroup, "thresholdCount") / dailyRowsForGroup.length : 0;
      const totalHours = sum(dailyRowsForGroup, "totalHours");
      const avgHoursPerSpacePerDay = group.spaces.length && dailyRowsForGroup.length ? totalHours / group.spaces.length / dailyRowsForGroup.length : 0;
      const peakDay = dailyRowsForGroup.reduce((best, row) => (row.thresholdCount > best.thresholdCount ? row : best), emptyDailyUsage(""));
      const weekOverWeek = computeDailyWeekOverWeek(group.spaces, new Map(dailyRowsForGroup.map((row) => [row.date, row])));
      return {
        label: group.label,
        spaceCount: group.spaces.length,
        averageDailyThreshold,
        avgHoursPerSpacePerDay,
        peakDay,
        weekOverWeek
      };
    })
    .sort((a, b) => b.avgHoursPerSpacePerDay - a.avgHoursPerSpacePerDay || a.label.localeCompare(b.label));

  els.comparisonTable.replaceChildren(
    ...rows.map((row) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(row.label)}</td>
        <td>${row.spaceCount}</td>
        <td>${number(row.avgHoursPerSpacePerDay, 2)}h</td>
        <td>${number(row.averageDailyThreshold, 0)}/${row.spaceCount}</td>
        <td>${row.peakDay.date ? `${number(row.peakDay.thresholdCount, 0)} on ${escapeHtml(row.peakDay.date)}` : "-"}</td>
        <td>${escapeHtml(compactDailyWeekOverWeek(row.weekOverWeek))}</td>
      `;
      return tr;
    })
  );
}

function renderDailyTable(spaces, usage) {
  const allRows = dailyRows(spaces, usage);
  syncDailyTableFilters(allRows);
  const rows = filterDailyRows(allRows);
  els.dailyFloorHeading.textContent = state.dailyGroup === "building" ? "Group" : "Floor";
  els.dailyThresholdHeading.textContent = `Used ${thresholdLabelText()}`;
  els.dailyTable.replaceChildren(
    ...rows.map((row) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(row.date)}</td>
        <td>${escapeHtml(dayNames[row.day])}</td>
        <td>${escapeHtml(row.buildingName)}</td>
        <td>${escapeHtml(row.floorName)}</td>
        <td>${escapeHtml(row.typeLabel)}</td>
        <td>${row.thresholdSpaces}/${row.spaceCount}</td>
        <td>${number(row.avgHoursPerSelectedSpace, 2)}h</td>
      `;
      return tr;
    })
  );
}

function syncDailyTableFilters(rows) {
  const controls = dailyTableFilterElements();
  const optionsByKey = {
    date: unique(rows.map((row) => row.date)).sort((a, b) => a.localeCompare(b)).map((date) => ({ value: date, label: date })),
    day: unique(rows.map((row) => String(row.day)))
      .sort((a, b) => Number(a) - Number(b))
      .map((day) => ({ value: day, label: dayNames[Number(day)] })),
    building: unique(rows.map((row) => row.buildingName)).sort((a, b) => a.localeCompare(b)).map((value) => ({ value, label: value })),
    floor: unique(rows.map((row) => row.floorName)).sort(compareFloorName).map((value) => ({ value, label: value })),
    type: unique(rows.map((row) => row.typeLabel)).sort((a, b) => a.localeCompare(b)).map((value) => ({ value, label: value }))
  };
  const labels = {
    date: "All dates",
    day: "All days",
    building: "All buildings",
    floor: "All floors",
    type: "All space types"
  };

  for (const [key, select] of Object.entries(controls)) {
    const current = state.tableFilters[key];
    const options = [{ value: "all", label: labels[key] }, ...(optionsByKey[key] || [])];
    setOptions(select, options);
    state.tableFilters[key] = options.some((option) => option.value === current) ? current : "all";
    select.value = state.tableFilters[key];
  }
}

function filterDailyRows(rows) {
  return rows.filter(
    (row) =>
      matchesTableFilter("date", row.date) &&
      matchesTableFilter("day", String(row.day)) &&
      matchesTableFilter("building", row.buildingName) &&
      matchesTableFilter("floor", row.floorName) &&
      matchesTableFilter("type", row.typeLabel)
  );
}

function dailyTableFilterElements() {
  return {
    date: els.dailyDateFilter,
    day: els.dailyDayFilter,
    building: els.dailyBuildingFilter,
    floor: els.dailyFloorFilter,
    type: els.dailyTypeFilter
  };
}

function matchesTableFilter(key, value) {
  return state.tableFilters[key] === "all" || state.tableFilters[key] === value;
}

function renderHeatmap(summary) {
  const hourRange = selectedHours();
  const selectedDays = businessDays.filter((day) => state.filters.days.has(day));
  const maxValue = Math.max(...summary.shareByDayHour.values(), 0.01);
  const cells = [label("")].concat(hourRange.map((hour) => label(formatHour(hour))));

  for (const day of selectedDays) {
    cells.push(label(dayNames[day]));
    for (const hour of hourRange) {
      const value = summary.shareByDayHour.get(`${day}|${hour}`) || 0;
      const cell = document.createElement("div");
      cell.className = "heatmap-cell";
      cell.style.background = `rgb(40 124 116 / ${0.08 + (value / maxValue) * 0.72})`;
      cell.title = `${dayNames[day]} ${formatHour(hour)}: ${formatShare(value, 1)}`;
      cell.textContent = formatShare(value);
      cells.push(cell);
    }
  }

  els.heatmap.style.gridTemplateColumns = `44px repeat(${hourRange.length}, minmax(44px, 1fr))`;
  els.heatmap.replaceChildren(...cells);
}

function filteredSpaces() {
  return nonBookableSpaces().filter(
    (space) =>
      matchesSelectedBuildings(space.buildingId) &&
      matchesSet(state.filters.floorIds, space.floorId) &&
      (state.filters.type === "all" || space.type === state.filters.type)
  );
}

function nonBookableSpaces() {
  return (state.data.dimensions?.spaces || []).filter(isNonBookableSpace);
}

function isNonBookableSpace(space) {
  const labels = (space.labels || []).map((label) => normalizeLabel(label));
  return labels.some((label) => label === "non bookable" || label === "non-bookable");
}

function eligibleBuildings() {
  const ids = new Set(nonBookableSpaces().map((space) => space.buildingId));
  return (state.data.dimensions?.buildings || [])
    .filter((building) => ids.has(building.buildingId))
    .sort((a, b) => a.buildingName.localeCompare(b.buildingName));
}

function eligibleFloors() {
  const ids = new Set(nonBookableSpaces().map((space) => space.floorId));
  return (state.data.dimensions?.floors || []).filter((floor) => ids.has(floor.floorId));
}

function availableTypes() {
  return unique(nonBookableSpaces().map((space) => space.type)).sort((a, b) => a.localeCompare(b));
}

function matchesSelectedBuildings(buildingId) {
  return state.filters.buildingIds.has("all") || state.filters.buildingIds.has(buildingId);
}

function matchesSet(set, id) {
  return set.has("all") || set.has(id);
}

function computeUsageSummary(spaces) {
  const concurrency = state.data.metrics?.concurrency || {};
  const rows = concurrency.bySpaceHour || [];
  const allSpaces = state.data.dimensions?.spaces || [];
  const dates = concurrency.dates || availableDates();
  const selectedIds = new Set(spaces.map((space) => space.spaceId));
  const dateEntries = selectedDateEntries();
  const selectedDateIndexes = new Set(dateEntries.map((entry) => entry.index));
  const selectedHoursSet = new Set(selectedHours());
  const intervalBySpaceDate = intervalMinutesBySpaceDate(spaces);
  const bySpaceDate = intervalBySpaceDate || new Map();
  const bySpaceTotal = new Map();

  if (!intervalBySpaceDate) {
    for (const row of rows) {
      const [spaceIndex, dateIndex, hour, minutes] = row;
      const space = allSpaces[spaceIndex];
      const date = dates[dateIndex];
      if (!space || !selectedIds.has(space.spaceId)) continue;
      if (!selectedDateIndexes.has(dateIndex)) continue;
      if (!selectedHoursSet.has(hour)) continue;
      addNumber(bySpaceDate, `${space.spaceId}|${date}`, minutes);
    }
  }
  for (const [key, minutes] of bySpaceDate) {
    const [spaceId] = key.split("|");
    addNumber(bySpaceTotal, spaceId, minutes);
  }

  const thresholdMinutes = state.filters.thresholdHours * 60;
  const usedSpaces = new Set([...bySpaceTotal].filter(([, minutes]) => minutes > 0).map(([spaceId]) => spaceId));
  const thresholdSpaces = new Set(
    [...bySpaceTotal].filter(([, minutes]) => minutes >= thresholdMinutes).map(([spaceId]) => spaceId)
  );
  const daily = new Map(
    dateEntries.map((entry) => [entry.date, usageForSpacesOnDate(spaces, entry.date, bySpaceDate)])
  );
  const totalHours = [...bySpaceTotal.values()].reduce((total, minutes) => total + minutes / 60, 0);
  const averageDailyUsed = daily.size ? sum([...daily.values()], "usedCount") / daily.size : 0;
  const averageDailyThreshold = daily.size ? sum([...daily.values()], "thresholdCount") / daily.size : 0;
  const avgHoursPerSpacePerDay = spaces.length && daily.size ? totalHours / spaces.length / daily.size : 0;
  const weekOverWeek = computeDailyWeekOverWeek(spaces, daily);
  const peakDailyThreshold = [...daily.values()].reduce(
    (best, row) => (row.thresholdCount > best.thresholdCount ? row : best),
    emptyDailyUsage("")
  );

  return {
    bySpaceDate,
    bySpaceTotal,
    usedSpaces,
    thresholdSpaces,
    daily,
    totalHours,
    averageDailyUsed,
    averageDailyThreshold,
    avgHoursPerSpacePerDay,
    weekOverWeek,
    peakDailyThreshold
  };
}

function intervalMinutesBySpaceDate(spaces) {
  const intervals = state.data.metrics?.intervals;
  if (!Array.isArray(intervals) || !intervals.length) return null;
  const selectedIds = new Set(spaces.map((space) => space.spaceId));
  const selectedHoursSet = new Set(selectedHours());
  const selectedDates = new Set(selectedDateEntries().map((entry) => entry.date));
  const bySpaceDate = new Map();

  for (const row of intervals) {
    const spaceId = row.spaceId ?? row[0];
    const date = row.date ?? row[1];
    const hour = Number(row.hour ?? row[2]);
    const usedMinutes = Number(row.usedMinutes ?? row[3] ?? 0);
    if (!selectedIds.has(spaceId)) continue;
    if (!selectedDates.has(date)) continue;
    if (!selectedHoursSet.has(hour)) continue;
    addNumber(bySpaceDate, `${spaceId}|${date}`, usedMinutes);
  }
  return bySpaceDate;
}

function computeDailyWeekOverWeek(spaces, daily) {
  const weeks = [...groupBy([...daily.values()], (row) => mondayOf(row.date))]
    .map(([weekStart, rows]) => {
      const totalHours = sum(rows, "totalHours");
      const totalThreshold = sum(rows, "thresholdCount");
      const selectedDays = rows.length;
      return {
        weekStart,
        selectedDays,
        averageDailyThreshold: selectedDays ? totalThreshold / selectedDays : 0,
        totalHours,
        avgHoursPerSpacePerDay: spaces.length && selectedDays ? totalHours / spaces.length / selectedDays : 0
      };
    })
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  const current = weeks.at(-1) || null;
  const previous = weeks.at(-2) || null;
  const delta = current && previous ? current.avgHoursPerSpacePerDay - previous.avgHoursPerSpacePerDay : 0;
  const pct = previous?.avgHoursPerSpacePerDay ? delta / previous.avgHoursPerSpacePerDay : null;
  return { current, previous, delta, pct };
}

function computeWeekdayHourlyUsage(spaces) {
  const concurrency = state.data.metrics?.concurrency || {};
  const rows = concurrency.bySpaceHour || [];
  const allSpaces = state.data.dimensions?.spaces || [];
  const dates = concurrency.dates || availableDates();
  const selectedIds = new Set(spaces.map((space) => space.spaceId));
  const selectedDateIndexes = new Set(selectedDateEntries().map((entry) => entry.index));
  const selectedHoursSet = new Set(selectedHours());
  const usedByDateHour = new Map();

  for (const row of rows) {
    const [spaceIndex, dateIndex, hour, minutes] = row;
    const space = allSpaces[spaceIndex];
    const date = dates[dateIndex];
    if (!space || !date || !(minutes > 0)) continue;
    if (!selectedIds.has(space.spaceId)) continue;
    if (!selectedDateIndexes.has(dateIndex)) continue;
    if (!selectedHoursSet.has(hour)) continue;
    const key = `${date}|${hour}`;
    if (!usedByDateHour.has(key)) usedByDateHour.set(key, new Set());
    usedByDateHour.get(key).add(space.spaceId);
  }

  const dateCountsByWeekday = countDatesByDay();
  const result = new Map();
  for (const day of businessDays.filter((value) => state.filters.days.has(value))) {
    const dateCount = Math.max(dateCountsByWeekday.get(day) || 0, 1);
    const hours = selectedHours().map((hour) => {
      const counts = selectedDateEntries()
        .filter((entry) => entry.day === day)
        .map((entry) => usedByDateHour.get(`${entry.date}|${hour}`)?.size || 0);
      const total = counts.reduce((sumValue, value) => sumValue + value, 0);
      return {
        hour,
        avgUsed: total / dateCount,
        peakUsed: Math.max(0, ...counts)
      };
    });
    const dateSeries = selectedDateEntries()
      .filter((entry) => entry.day === day)
      .map((entry) => ({
        date: entry.date,
        counts: selectedHours().map((hour) => usedByDateHour.get(`${entry.date}|${hour}`)?.size || 0)
      }));
    const allCounts = dateSeries.flatMap((series) => series.counts);
    const peakHourRow = hours.reduce((best, item) => (item.peakUsed > best.peakUsed ? item : best), { hour: null, peakUsed: 0 });
    result.set(day, {
      day,
      hours,
      dateSeries,
      minUsed: allCounts.length ? Math.min(...allCounts) : 0,
      avgUsed: hours.length ? sum(hours, "avgUsed") / hours.length : 0,
      peakUsed: peakHourRow.peakUsed,
      peakHour: peakHourRow.hour
    });
  }
  return result;
}

function emptyWeekdayChart(day) {
  return {
    day,
    dateSeries: [],
    hours: selectedHours().map((hour) => ({ hour, avgUsed: 0, peakUsed: 0 })),
    minUsed: 0,
    avgUsed: 0,
    peakUsed: 0,
    peakHour: null
  };
}

function usageForSpacesOnDate(spaces, date, bySpaceDate, day = dayIndex(date)) {
  const thresholdMinutes = state.filters.thresholdHours * 60;
  const minutesBySpace = spaces.map((space) => bySpaceDate.get(`${space.spaceId}|${date}`) || 0);
  const usedCount = minutesBySpace.filter((minutes) => minutes > 0).length;
  const thresholdCount = minutesBySpace.filter((minutes) => minutes >= thresholdMinutes).length;
  const totalMinutes = minutesBySpace.reduce((total, minutes) => total + minutes, 0);
  return {
    date,
    day,
    usedCount,
    thresholdCount,
    totalHours: totalMinutes / 60
  };
}

function emptyDailyUsage(date, day = dayIndex(date)) {
  return {
    date,
    day,
    usedCount: 0,
    thresholdCount: 0,
    totalHours: 0
  };
}

function computeSummary(spaces) {
  const snapshots = snapshotsForSpaces(spaces);
  const totalWindows = selectedWindowCount();
  const totalActive = sum(snapshots, "active");
  const averageActive = totalWindows ? totalActive / totalWindows : 0;
  const peak = snapshots.reduce((best, snapshot) => (snapshot.active > best.active ? snapshot : best), emptyPeak());
  const spaceCount = spaces.length;

  return {
    snapshots,
    averageActive,
    averageShare: spaceCount ? averageActive / spaceCount : 0,
    peak,
    peakShare: spaceCount ? peak.active / spaceCount : 0,
    shareByDayHour: aggregateByDayHour(snapshots, spaceCount, "share"),
    averageActiveByDayHour: aggregateByDayHour(snapshots, spaceCount, "average"),
    peakActiveByDayHour: peakByDayHour(snapshots)
  };
}

function snapshotsForSpaces(spaces) {
  const concurrency = state.data.metrics?.concurrency;
  if (!concurrency?.grainMinutes || !spaces.length) return [];

  const floorIndexes = indexSet(concurrency.floors || [], unique(spaces.map((space) => space.floorId)));
  const typeIndexes = indexSet(concurrency.types || [], unique(spaces.map((space) => space.type)));
  const dateEntries = selectedDateEntries();
  const dateIndexes = new Set(dateEntries.map((entry) => entry.index));
  const dateByIndex = new Map(dateEntries.map((entry) => [entry.index, entry.date]));
  const slotCounts = new Map();

  for (const row of concurrency.byFloorTypeHour || []) {
    const [floorIndex, typeIndex, dateIndex, hour, slot, active] = row;
    if (!floorIndexes.has(floorIndex)) continue;
    if (!typeIndexes.has(typeIndex)) continue;
    if (!dateIndexes.has(dateIndex)) continue;
    if (hour < state.filters.startHour || hour >= state.filters.endHour) continue;
    addNumber(slotCounts, `${dateIndex}|${hour}|${slot}`, active);
  }

  const snapshots = [];
  for (const [id, active] of slotCounts) {
    const [dateIndex, hour, slot] = id.split("|").map(Number);
    const date = dateByIndex.get(dateIndex);
    const minute = slot * concurrency.grainMinutes;
    const day = dayIndex(date);
    if (!date || !state.filters.days.has(day)) continue;
    snapshots.push({ date, day, hour, minute, active });
  }
  return snapshots;
}

function selectedWindowCount() {
  const concurrency = state.data.metrics?.concurrency;
  const slotsPerHour = concurrency?.grainMinutes ? 60 / concurrency.grainMinutes : 12;
  return selectedDateEntries().length * selectedHours().length * slotsPerHour;
}

function selectedDateEntries() {
  return availableDates()
    .map((date, index) => ({ date, index, day: dayIndex(date) }))
    .filter(
      ({ date, day }) =>
        date >= state.filters.startDate &&
        date <= state.filters.endDate &&
        state.filters.days.has(day)
    );
}

function dailyRows(spaces, usage) {
  const groups = groupedSpacesForDaily(spaces);
  return groups
    .flatMap((group) =>
      selectedDateEntries().map(({ date, day }) => {
        const dailyUsage = usageForSpacesOnDate(group.spaces, date, usage.bySpaceDate);
        return {
          date,
          day,
          buildingName: group.buildingName,
          floorName: group.floorName,
          typeLabel: group.type,
          spaceCount: group.spaces.length,
          usedSpaces: dailyUsage.usedCount,
          thresholdSpaces: dailyUsage.thresholdCount,
          avgHoursPerSelectedSpace: group.spaces.length ? dailyUsage.totalHours / group.spaces.length : 0
        };
      })
    )
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.day - b.day ||
        a.buildingName.localeCompare(b.buildingName) ||
        compareFloorName(a.floorName, b.floorName) ||
        a.typeLabel.localeCompare(b.typeLabel)
    );
}

function groupedSpacesForDaily(spaces) {
  const keyFn =
    state.dailyGroup === "building"
      ? (space) => `${space.buildingId}|${state.filters.type === "all" ? space.type : state.filters.type}`
      : (space) => `${space.floorId}|${state.filters.type === "all" ? space.type : state.filters.type}`;
  return [...groupBy(spaces, keyFn)].map(([, groupSpaces]) => {
    const first = groupSpaces[0];
    return {
      buildingName: first.buildingName,
      floorName: state.dailyGroup === "building" ? "All selected floors" : first.floorName,
      type: state.filters.type === "all" ? first.type : selectedTypeLabel(),
      spaces: groupSpaces
    };
  });
}

function comparisonGroups(spaces) {
  const selectedBuildingCount = state.filters.buildingIds.has("all") ? eligibleBuildings().length : state.filters.buildingIds.size;
  const selectedFloorCount = state.filters.floorIds.has("all") ? eligibleFloors().filter((floor) => matchesSelectedBuildings(floor.buildingId)).length : state.filters.floorIds.size;
  let keyFn;
  let labelFn;

  if (selectedBuildingCount !== 1) {
    keyFn = (space) => space.buildingId;
    labelFn = (groupSpaces) => shortBuildingName(groupSpaces[0].buildingName);
  } else if (selectedFloorCount !== 1 && state.filters.type === "all") {
    keyFn = (space) => space.floorId;
    labelFn = (groupSpaces) => groupSpaces[0].floorName;
  } else {
    keyFn = (space) => space.type;
    labelFn = (groupSpaces) => groupSpaces[0].type;
  }

  return [...groupBy(spaces, keyFn)].map(([, groupSpaces]) => ({
    label: labelFn(groupSpaces),
    spaces: groupSpaces
  }));
}

function buildingInsightLines(spaces, usage) {
  const thresholdLabel = thresholdLabelText();
  const groups = [...groupBy(spaces, (space) => space.buildingId)]
    .map(([, groupSpaces]) => {
      const rows = selectedDateEntries().map(({ date, day }) =>
        usageForSpacesOnDate(groupSpaces, date, usage.bySpaceDate, day)
      );
      const averageDailyThreshold = rows.length ? sum(rows, "thresholdCount") / rows.length : 0;
      const totalHours = sum(rows, "totalHours");
      const avgHoursPerSpacePerDay = groupSpaces.length && rows.length ? totalHours / groupSpaces.length / rows.length : 0;
      return {
        label: shortBuildingName(groupSpaces[0].buildingName),
        spaceCount: groupSpaces.length,
        averageDailyThreshold,
        avgHoursPerSpacePerDay
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" }));

  if (groups.length <= 1) return [];
  return groups.map(
    (group) =>
      `<strong>${escapeHtml(group.label)}</strong>: ${number(group.avgHoursPerSpacePerDay, 2)} hrs per space per day; ${number(group.averageDailyThreshold, 0)} of ${group.spaceCount} spaces met ${escapeHtml(thresholdLabel)}.`
  );
}

function comparisonModeLabel() {
  const selectedBuildingCount = state.filters.buildingIds.has("all") ? eligibleBuildings().length : state.filters.buildingIds.size;
  const selectedFloorCount = state.filters.floorIds.has("all") ? eligibleFloors().filter((floor) => matchesSelectedBuildings(floor.buildingId)).length : state.filters.floorIds.size;
  if (selectedBuildingCount !== 1) return "Building";
  if (selectedFloorCount !== 1 && state.filters.type === "all") return "Floor";
  return "Space type";
}

function groupedSpacesForHourly(spaces) {
  return [...groupBy(spaces, (space) => `${space.buildingId}|${space.floorId}|${space.type}`)].map(([, groupSpaces]) => {
    const first = groupSpaces[0];
    return {
      buildingName: first.buildingName,
      floorName: first.floorName,
      type: first.type,
      spaces: groupSpaces
    };
  });
}

function aggregateByDayHour(snapshots, spaceCount, mode) {
  const result = new Map();
  const slotsPerHour = slotsPerHourCount();
  const dateCountsByDay = countDatesByDay();

  for (const day of businessDays.filter((value) => state.filters.days.has(value))) {
    for (const hour of selectedHours()) {
      const selectedSnapshots = snapshots.filter((snapshot) => snapshot.day === day && snapshot.hour === hour);
      const denominator = Math.max((dateCountsByDay.get(day) || 0) * slotsPerHour, 1);
      const active = sum(selectedSnapshots, "active") / denominator;
      result.set(`${day}|${hour}`, mode === "share" && spaceCount ? active / spaceCount : active);
    }
  }
  return result;
}

function peakByDayHour(snapshots) {
  const result = new Map();
  for (const snapshot of snapshots) {
    const id = `${snapshot.day}|${snapshot.hour}`;
    result.set(id, Math.max(result.get(id) || 0, snapshot.active));
  }
  return result;
}

function groupedByDateHourSlot(snapshots) {
  return groupBy(snapshots, (snapshot) => `${snapshot.date}|${snapshot.hour}|${snapshot.minute}`);
}

function emptyPeak() {
  return { date: "", day: 0, hour: 0, minute: 0, active: 0 };
}

function sourceText() {
  const metadata = state.data.metadata || {};
  const range = metadata.includedRange || {};
  return `Current data: ${range.start || "no rows"} to ${range.end || "no rows"}, ${metadata.requestedRange?.businessHours || "selected business hours"}. ${nonBookableSpaces().length.toLocaleString()} labeled non-bookable spaces available.`;
}

function selectedTypeLabel() {
  return state.filters.type === "all" ? "All non-bookable types" : state.filters.type;
}

function averageSubjectLabel() {
  if (state.filters.type === "all") return "non-bookable space";
  return singularTypeLabel(state.filters.type).toLowerCase();
}

function subjectPluralLabel() {
  if (state.filters.type === "all") return "non-bookable spaces";
  return selectedTypeLabel().toLowerCase();
}

function singularTypeLabel(type) {
  return String(type || "space")
    .replace(/ies$/i, "y")
    .replace(/Rooms$/i, "room")
    .replace(/Booths$/i, "booth")
    .replace(/Spaces$/i, "space")
    .replace(/s$/i, "");
}

function thresholdLabelText() {
  const hours = state.filters.thresholdHours;
  if (hours < 1) return `${Math.round(hours * 60)} min+`;
  return `${number(hours, hours % 1 ? 1 : 0)} ${hours === 1 ? "hr" : "hrs"}+`;
}

function dailyWeekOverWeekSentence(weekOverWeek) {
  const { current, previous, delta, pct } = weekOverWeek;
  if (!current || !previous) return "There is not enough selected history for a week-over-week comparison.";
  const direction = delta > 0.005 ? "up" : delta < -0.005 ? "down" : "flat";
  if (direction === "flat") {
    return `Week over week usage time was flat at ${number(current.avgHoursPerSpacePerDay, 2)} hrs per space per day.`;
  }
  const pctText = pct == null ? `${number(Math.abs(delta), 2)} hrs` : `${number(Math.abs(pct) * 100, 0)}%`;
  return `Week over week usage time was ${direction} ${pctText}, from ${number(previous.avgHoursPerSpacePerDay, 2)} to ${number(current.avgHoursPerSpacePerDay, 2)} hrs per space per day.`;
}

function compactDailyWeekOverWeek(weekOverWeek) {
  const { previous, delta, pct } = weekOverWeek;
  if (!previous) return "-";
  if (Math.abs(delta) < 0.005) return "No change";
  const sign = delta > 0 ? "+" : "";
  const pctText = pct == null ? "" : ` (${sign}${number(pct * 100, 0)}%)`;
  return `${sign}${number(delta, 2)} hrs${pctText}`;
}

function formatDailyWeekOverWeekValue(weekOverWeek) {
  const { previous, delta, pct } = weekOverWeek;
  if (!previous) return "-";
  if (Math.abs(delta) < 0.005) return "Flat";
  const sign = delta > 0 ? "+" : "";
  return pct == null ? `${sign}${number(delta, 2)}h` : `${sign}${number(pct * 100, 0)}%`;
}

function formatDailyWeekOverWeekSubtext(weekOverWeek) {
  const { current, previous } = weekOverWeek;
  if (!current || !previous) return "not enough prior-week data";
  return `${number(previous.avgHoursPerSpacePerDay, 2)} to ${number(current.avgHoursPerSpacePerDay, 2)} hrs/space/day`;
}

function busiestHour(summary) {
  let best = null;
  for (const [key, value] of summary.averageActiveByDayHour) {
    const [day, hour] = key.split("|").map(Number);
    if (!best || value > best.value) best = { day, hour, value };
  }
  return best;
}

function formatWeekdayHourChange(current, previous) {
  if (previous == null) return "-";
  const delta = current - previous;
  if (Math.abs(delta) < 0.005) return "No change";
  const sign = delta > 0 ? "+" : "";
  const pct = previous ? ` (${sign}${number((delta / previous) * 100, 0)}%)` : "";
  return `${sign}${number(delta, 2)} hrs${pct}`;
}

function selectedBuildingLabel() {
  if (state.filters.buildingIds.has("all")) return "All buildings";
  const selected = eligibleBuildings().filter((building) => state.filters.buildingIds.has(building.buildingId));
  if (!selected.length) return "No buildings";
  if (selected.length === 1) return shortBuildingName(selected[0].buildingName);
  return `${selected.length} buildings`;
}

function selectedFloorLabel() {
  if (state.filters.floorIds.has("all")) return "All floors";
  const selected = eligibleFloors().filter((floor) => state.filters.floorIds.has(floor.floorId));
  if (selected.length === 1) return selected[0].floorName;
  return `${selected.length} floors`;
}

function floorPillLabel(floor) {
  const building = shortBuildingName(floor.buildingName);
  const floorName = String(floor.floorName || "");
  const floorMatch = floorName.match(/floor\s*0*(\d+[a-z]?)/i);
  if (floorMatch) return `${building} Fl ${floorMatch[1].toUpperCase()}`;

  const suffix = floorName
    .replace(new RegExp(`\\s*:?\\s*${escapeRegExp(building)}\\s*$`, "i"), "")
    .trim();
  return suffix ? `${building} ${suffix}` : building;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function availableDates() {
  return state.data.dimensions?.dates || state.data.metrics?.concurrency?.dates || [];
}

function clampDateToAvailableRange(value) {
  const dates = availableDates();
  if (!dates.length) return value;
  if (!value || value < dates[0]) return dates[0];
  if (value > dates.at(-1)) return dates.at(-1);
  return value;
}

function selectedHours() {
  return range(state.filters.startHour, state.filters.endHour);
}

function slotsPerHourCount() {
  const grain = state.data.metrics?.concurrency?.grainMinutes || 5;
  return 60 / grain;
}

function countDatesByDay() {
  const counts = new Map();
  for (const { day } of selectedDateEntries()) addNumber(counts, day, 1);
  return counts;
}

function mondayOf(date) {
  const result = new Date(`${date}T00:00:00`);
  const day = result.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  result.setDate(result.getDate() + diff);
  return result.toISOString().slice(0, 10);
}

function indexSet(source, selectedIds) {
  const selected = new Set(selectedIds);
  return new Set(source.map((id, index) => (selected.has(id) ? index : null)).filter((index) => index != null));
}

function normalizeLabel(label) {
  return String(label?.name || label || "").trim().toLowerCase();
}

function setOptions(select, options) {
  select.replaceChildren(
    ...options.map((option) => {
      const node = document.createElement("option");
      node.value = option.value;
      node.textContent = option.label;
      return node;
    })
  );
}

function label(text) {
  const node = document.createElement("div");
  node.className = "heatmap-label";
  node.textContent = text;
  return node;
}

function range(start, end) {
  return Array.from({ length: Math.max(0, end - start) }, (_, index) => start + index);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function groupBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

function addNumber(map, key, value) {
  map.set(key, (map.get(key) || 0) + value);
}

function compareFloorName(a, b) {
  const numberDelta = floorNumber(a) - floorNumber(b);
  return numberDelta || String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

function floorNumber(value) {
  const match = String(value).match(/floor\s*0*(\d+)/i) || String(value).match(/\b0*(\d+)\b/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function sum(items, key) {
  return items.reduce((total, item) => total + (Number(item[key]) || 0), 0);
}

function dayIndex(date) {
  return new Date(`${date}T00:00:00`).getDay();
}

function formatHour(hour) {
  const suffix = hour >= 12 ? "PM" : "AM";
  const display = hour % 12 || 12;
  return `${display}${suffix}`;
}

function formatHourLabel(hour) {
  const suffix = hour >= 12 ? "pm" : "am";
  const display = hour % 12 || 12;
  return `${display} ${suffix}`;
}

function formatTimeOfDay(hour = 0, minute = 0) {
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function formatShare(value, places = 0) {
  return `${number(value * 100, places)}%`;
}

function number(value, places = 1) {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: places,
    maximumFractionDigits: places
  });
}

function shortBuildingName(name) {
  return String(name || "").split(" - ")[0] || name;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
