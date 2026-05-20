const state = {
  data: null,
  rows: [],
  selectedSpaceId: null,
  sortKey: "avgHoursPerDay",
  sortAsc: false,
  filters: {
    buildingId: "all",
    floorId: "all",
    type: "",
    startDate: "",
    endDate: "",
    days: new Set([1, 2, 3, 4, 5]),
    startHour: 9,
    endHour: 17
  }
};

const els = {
  sourceNote: document.querySelector("#source-note"),
  buildingFilter: document.querySelector("#building-filter"),
  floorFilter: document.querySelector("#floor-filter"),
  typeFilter: document.querySelector("#type-filter"),
  startDateFilter: document.querySelector("#start-date-filter"),
  endDateFilter: document.querySelector("#end-date-filter"),
  startHourFilter: document.querySelector("#start-hour-filter"),
  endHourFilter: document.querySelector("#end-hour-filter"),
  dayButtons: [...document.querySelectorAll(".day-filter button")],
  insightScope: document.querySelector("#insight-scope"),
  insightTitle: document.querySelector("#insight-title"),
  insightCopy: document.querySelector("#insight-copy"),
  spaceGrid: document.querySelector("#space-grid"),
  kpiPeakDemand: document.querySelector("#kpi-peak-demand"),
  kpiPeakDemandSub: document.querySelector("#kpi-peak-demand-sub"),
  kpiTypicalActive: document.querySelector("#kpi-typical-active"),
  kpiActiveSpaces: document.querySelector("#kpi-active-spaces"),
  kpiUtilization: document.querySelector("#kpi-utilization"),
  kpiUsed: document.querySelector("#kpi-used"),
  kpiSpaces: document.querySelector("#kpi-spaces"),
  kpiPeak: document.querySelector("#kpi-peak"),
  typeBars: document.querySelector("#type-bars"),
  heatmap: document.querySelector("#heatmap"),
  weekdayLines: document.querySelector("#weekday-lines"),
  weeklyTable: document.querySelector("#weekly-table"),
  dailyTable: document.querySelector("#daily-table"),
  spaceTable: document.querySelector("#space-table"),
  coverageNotes: document.querySelector("#coverage-notes")
};

const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const businessDays = [1, 2, 3, 4, 5];
const colors = ["#3367c2", "#2bb8a8", "#d5965f", "#8c5be8", "#159fd3", "#b4453f"];
const shortageThreshold = 0.8;

fetch("data/dashboard-data.json")
  .then((response) => response.json())
  .then((data) => {
    state.data = data;
    state.rows = (data.metrics.intervals || []).map((row) => ({
      ...row,
      day: dayIndex(row.date),
      timestamp: `${row.date}T${String(row.hour).padStart(2, "0")}:00`
    }));
    setupFilters();
    render();
  })
  .catch((error) => {
    els.sourceNote.textContent = `Could not load dashboard data: ${error.message}`;
  });

function setupFilters() {
  const { dimensions, metadata } = state.data;
  const rankedTypes = dimensions.types
    .map((type) => ({
      type,
      spaces: dimensions.spaces.filter((space) => space.type === type).length
    }))
    .sort((a, b) => b.spaces - a.spaces || a.type.localeCompare(b.type));

  state.filters.type = rankedTypes[0]?.type || dimensions.types[0] || "";
  state.filters.startDate = metadata.includedRange.start;
  state.filters.endDate = metadata.includedRange.end;

  setOptions(
    els.buildingFilter,
    [{ value: "all", label: "All buildings" }].concat(
      dimensions.buildings.map((building) => ({
        value: building.buildingId,
        label: building.buildingName
      }))
    )
  );
  setOptions(
    els.typeFilter,
    rankedTypes.map(({ type, spaces }) => ({
      value: type,
      label: `${type} (${spaces})`
    }))
  );
  els.typeFilter.value = state.filters.type;
  els.startDateFilter.value = state.filters.startDate;
  els.endDateFilter.value = state.filters.endDate;
  setOptions(
    els.startHourFilter,
    range(6, 18).map((hour) => ({ value: hour, label: formatHour(hour) }))
  );
  setOptions(
    els.endHourFilter,
    range(7, 19).map((hour) => ({ value: hour, label: formatHour(hour) }))
  );
  els.startHourFilter.value = state.filters.startHour;
  els.endHourFilter.value = state.filters.endHour;
  refreshFloorOptions();
  refreshDayButtons();

  els.buildingFilter.addEventListener("change", () => {
    state.filters.buildingId = els.buildingFilter.value;
    state.filters.floorId = "all";
    state.selectedSpaceId = null;
    refreshFloorOptions();
    render();
  });
  els.floorFilter.addEventListener("change", () => {
    state.filters.floorId = els.floorFilter.value;
    state.selectedSpaceId = null;
    render();
  });
  els.typeFilter.addEventListener("change", () => {
    state.filters.type = els.typeFilter.value;
    state.selectedSpaceId = null;
    render();
  });
  els.startDateFilter.addEventListener("change", () => {
    state.filters.startDate = els.startDateFilter.value;
    render();
  });
  els.endDateFilter.addEventListener("change", () => {
    state.filters.endDate = els.endDateFilter.value;
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
      if (state.filters.days.has(day) && state.filters.days.size > 1) {
        state.filters.days.delete(day);
      } else {
        state.filters.days.add(day);
      }
      refreshDayButtons();
      render();
    });
  }
  for (const header of document.querySelectorAll("#space-table").item(0)?.closest("table")?.querySelectorAll("th[data-sort]") || []) {
    header.addEventListener("click", () => {
      const nextKey = header.dataset.sort;
      if (state.sortKey === nextKey) state.sortAsc = !state.sortAsc;
      else {
        state.sortKey = nextKey;
        state.sortAsc = nextKey === "spaceName";
      }
      renderSpaceTable(computeSpaceMetrics(filteredIntervals(), filteredSpaces()));
    });
  }
}

function refreshFloorOptions() {
  const floors = state.data.dimensions.floors.filter(
    (floor) =>
      state.filters.buildingId === "all" ||
      floor.buildingId === state.filters.buildingId
  );
  setOptions(
    els.floorFilter,
    [{ value: "all", label: "All floors" }].concat(
      floors.map((floor) => ({ value: floor.floorId, label: floor.floorName }))
    )
  );
  els.floorFilter.value = state.filters.floorId;
}

function refreshDayButtons() {
  for (const button of els.dayButtons) {
    button.classList.toggle("active", state.filters.days.has(Number(button.dataset.day)));
  }
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

function render() {
  const rows = filteredIntervals();
  const spaces = filteredSpaces();
  const spaceMetrics = computeSpaceMetrics(rows, spaces);
  const total = combine(rows);
  const peak = peakSnapshot(rows);
  const activeMeaningful = spaceMetrics.filter((space) => space.avgHoursPerDay > 1).length;
  const typicalActive = averageActiveSpaces(rows);
  const usage = selectedUsageSummary(rows, spaces, spaceMetrics);

  els.sourceNote.textContent = sourceText();
  els.kpiUtilization.textContent = `${number(usage.avgHoursPerSpacePerDay)}h`;
  els.kpiUsed.textContent = `${number(usage.medianHoursPerSpacePerDay)}h`;
  els.kpiSpaces.textContent = `${number(usage.shortageHours, 0)}h`;
  els.kpiPeak.textContent = `${activeMeaningful}/${spaces.length}`;
  els.kpiPeakDemand.textContent = `${peak.active}/${spaces.length}`;
  els.kpiPeakDemandSub.textContent = peak.active ? `${peak.dayLabel} ${peak.date} ${formatHour(peak.hour)}` : "No usage";
  els.kpiTypicalActive.textContent = number(typicalActive, 1);
  els.kpiActiveSpaces.textContent = `${activeMeaningful}/${spaces.length}`;

  renderInsight(rows, spaces, spaceMetrics, peak, typicalActive, usage);
  renderTypeBars();
  renderHeatmap(rows, spaces.length);
  renderWeekdayLines(rows, spaces.length);
  renderDailyTable(rows);
  renderWeeklyTable(rows);
  renderSpaceTable(spaceMetrics);
  renderCoverageNotes();
}

function sourceText() {
  const { metadata } = state.data;
  const start = metadata.includedRange.start || "no rows";
  const end = metadata.includedRange.end || "no rows";
  const source =
    metadata.source ||
    [metadata.sourceSpacesPath, metadata.sourceLabelsPath].filter(Boolean).join(" + ") ||
    "dashboard data";
  return `Current data: ${start} to ${end}, ${metadata.requestedRange.businessHours}. ${metadata.rowsInScope.toLocaleString()} hourly rows from ${source}.`;
}

function filteredIntervals(typeOverride = state.filters.type) {
  return state.rows.filter(
    (row) =>
      row.type === typeOverride &&
      row.date >= state.filters.startDate &&
      row.date <= state.filters.endDate &&
      state.filters.days.has(row.day) &&
      row.hour >= state.filters.startHour &&
      row.hour < state.filters.endHour &&
      (state.filters.buildingId === "all" || row.buildingId === state.filters.buildingId) &&
      (state.filters.floorId === "all" || row.floorId === state.filters.floorId)
  );
}

function filteredSpaces(typeOverride = state.filters.type) {
  return state.data.dimensions.spaces.filter(
    (space) =>
      space.type === typeOverride &&
      (state.filters.buildingId === "all" || space.buildingId === state.filters.buildingId) &&
      (state.filters.floorId === "all" || space.floorId === state.filters.floorId)
  );
}

function combine(rows) {
  const usedMinutes = sum(rows, "usedMinutes");
  const availableMinutes = sum(rows, "availableMinutes");
  return {
    usedMinutes,
    availableMinutes,
    usedHours: usedMinutes / 60,
    availableHours: availableMinutes / 60
  };
}

function computeSpaceMetrics(rows, spaces, datesOverride = selectedDates()) {
  const rowsBySpace = groupBy(rows, (row) => row.spaceId);
  const dates = datesOverride;
  const dayCount = dates.length;
  return spaces.map((space) => {
    const spaceRows = rowsBySpace.get(space.spaceId) || [];
    const total = combine(spaceRows);
    const dailyHours = dates.map(
      (date) => sum(spaceRows.filter((row) => row.date === date), "usedMinutes") / 60
    );
    const weekdayHours = Object.fromEntries(
      businessDays.map((day) => [
        day,
        sum(
          spaceRows.filter((row) => row.day === day),
          "usedMinutes"
        ) / 60 / Math.max(selectedDateCount(day), 1)
      ])
    );
    const dayUsages = businessDays.map((day) => ({
      day,
      label: dayNames[day],
      hours: weekdayHours[day] || 0
    }));
    return {
      ...space,
      ...total,
      avgHoursPerDay: total.usedHours / Math.max(dayCount, 1),
      medianHoursPerDay: median(dailyHours),
      daysUsed: dailyHours.filter((hours) => hours > 0).length,
      weekdayHours,
      busiestHour: busiestHour(spaceRows),
      busiestDay: [...dayUsages].sort((a, b) => b.hours - a.hours)[0],
      quietestDay: [...dayUsages].sort((a, b) => a.hours - b.hours)[0],
      rows: spaceRows
    };
  });
}

function renderInsight(rows, spaces, spaceMetrics, peak, typicalActive, usage) {
  const type = state.filters.type;
  const scope = [
    state.filters.buildingId === "all" ? "All buildings" : buildingName(state.filters.buildingId),
    state.filters.floorId === "all" ? "All floors" : floorName(state.filters.floorId),
    `${state.filters.startDate} to ${state.filters.endDate}`,
    `${formatHour(state.filters.startHour)}-${formatHour(state.filters.endHour)}`
  ];
  const meaningful = spaceMetrics.filter((space) => space.avgHoursPerDay > 1).length;
  const unusedAtPeak = Math.max(spaces.length - peak.active, 0);

  els.insightScope.textContent = scope.join(" · ");
  els.insightTitle.innerHTML = `${escapeHtml(type)} never needed more than <span>${peak.active}</span> spaces at once.`;
  els.insightCopy.textContent = `${unusedAtPeak} of ${spaces.length} ${type.toLowerCase()} spaces were available at the selected peak. Each space averaged ${number(usage.avgHoursPerSpacePerDay)} hours of use per selected day; median space use was ${number(usage.medianHoursPerSpacePerDay)} hours/day. ${usage.shortageHours} selected hours crossed ${Math.round(shortageThreshold * 100)}% active, and ${meaningful} spaces averaged more than 1 hour/day.`;
  els.spaceGrid.replaceChildren(
    ...spaces.map((space, index) => {
      const node = document.createElement("button");
      const metric = spaceMetrics.find((item) => item.spaceId === space.spaceId);
      const activeAtPeak = peak.spaceIds.has(space.spaceId);
      node.type = "button";
      node.className = `space-dot ${activeAtPeak ? "peak" : ""} ${metric?.usedMinutes ? "used" : ""}`;
      node.title = `${space.spaceName}: ${number(metric?.avgHoursPerDay || 0)} avg hrs/day`;
      node.textContent = index + 1;
      node.addEventListener("click", () => {
        state.selectedSpaceId = state.selectedSpaceId === space.spaceId ? null : space.spaceId;
        renderSpaceTable(computeSpaceMetrics(filteredIntervals(), filteredSpaces()));
      });
      return node;
    })
  );
}

function renderTypeBars() {
  const byType = state.data.dimensions.types.map((type, index) => {
    const rows = filteredIntervals(type);
    const spaces = filteredSpaces(type);
    const peak = peakSnapshot(rows);
    const metrics = computeSpaceMetrics(rows, spaces);
    const usage = selectedUsageSummary(rows, spaces, metrics);
    return { type, spaces: spaces.length, index, peakActive: peak.active, ...usage };
  });
  const maxAvg = Math.max(...byType.map((row) => row.avgHoursPerSpacePerDay), 0.1);
  els.typeBars.replaceChildren(
    ...byType
      .sort((a, b) => b.avgHoursPerSpacePerDay - a.avgHoursPerSpacePerDay)
      .map((row) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = `bar-row type-row ${row.type === state.filters.type ? "selected" : ""}`;
        item.innerHTML = `
          <strong>${escapeHtml(row.type)}</strong>
          <div class="track"><div class="bar" style="width:${Math.max(2, (row.avgHoursPerSpacePerDay / maxAvg) * 100)}%; background:${colors[row.index % colors.length]}"></div></div>
          <span>${number(row.avgHoursPerSpacePerDay)}h/space/day · peak ${row.peakActive}/${row.spaces}</span>
        `;
        item.addEventListener("click", () => {
          state.filters.type = row.type;
          els.typeFilter.value = row.type;
          state.selectedSpaceId = null;
          render();
        });
        return item;
      })
  );
}

function renderHeatmap(rows, totalSpaces) {
  const grouped = groupBy(rows, (row) => `${row.day}-${row.hour}`);
  const values = new Map(
    [...grouped].map(([id, group]) => [id, totalSpaces ? averageActiveSpaces(group) / totalSpaces : 0])
  );
  const maxValue = Math.max(...values.values(), 0.01);
  const hourRange = range(state.filters.startHour, state.filters.endHour);
  const cells = [label("")].concat(hourRange.map((hour) => label(formatHour(hour))));
  for (const day of businessDays.filter((day) => state.filters.days.has(day))) {
    cells.push(label(dayNames[day]));
    for (const hour of hourRange) {
      const value = values.get(`${day}-${hour}`) || 0;
      const alpha = 0.08 + (value / maxValue) * 0.72;
      const cell = document.createElement("div");
      cell.className = "heatmap-cell";
      cell.style.background = `rgb(40 124 116 / ${alpha})`;
      cell.title = `${dayNames[day]} ${formatHour(hour)}: ${Math.round(value * 100)}% active on average`;
      cell.textContent = `${Math.round(value * 100)}%`;
      cells.push(cell);
    }
  }
  els.heatmap.style.gridTemplateColumns = `44px repeat(${hourRange.length}, minmax(44px, 1fr))`;
  els.heatmap.replaceChildren(...cells);
}

function renderWeekdayLines(rows, totalSpaces) {
  const hourRange = range(state.filters.startHour, state.filters.endHour);
  const selectedDays = businessDays.filter((day) => state.filters.days.has(day));
  const width = 1120;
  const height = 300;
  const pad = { left: 48, right: 18, top: 28, bottom: 34 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const pointsByDay = selectedDays.map((day, dayIndex) => {
    const points = hourRange.map((hour, index) => {
      const hourRows = rows.filter((row) => row.day === day && row.hour === hour);
      const share = totalSpaces ? averageActiveSpaces(hourRows) / totalSpaces : 0;
      return {
        day,
        hour,
        share,
        x: pad.left + (hourRange.length <= 1 ? 0 : (index / (hourRange.length - 1)) * innerW),
        y: pad.top + innerH - share * innerH,
        color: colors[dayIndex % colors.length]
      };
    });
    return { day, points, color: colors[dayIndex % colors.length] };
  });
  const grid = [0, 0.25, 0.5, 0.75, 1];
  els.weekdayLines.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Hourly active share by weekday">
      ${grid
        .map((value) => {
          const y = pad.top + innerH - value * innerH;
          return `<line x1="${pad.left}" x2="${width - pad.right}" y1="${y}" y2="${y}" class="chart-grid"></line><text x="8" y="${y + 4}" class="chart-label">${Math.round(value * 100)}%</text>`;
        })
        .join("")}
      ${hourRange
        .map((hour, index) => {
          const x = pad.left + (hourRange.length <= 1 ? 0 : (index / (hourRange.length - 1)) * innerW);
          return `<text x="${x}" y="${height - 8}" text-anchor="middle" class="chart-label">${formatHour(hour)}</text>`;
        })
        .join("")}
      ${pointsByDay
        .map(
          ({ points, color }) =>
            `<polyline fill="none" stroke="${color}" stroke-width="3" points="${points.map((point) => `${point.x},${point.y}`).join(" ")}"></polyline>` +
            points.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="4" fill="${color}"><title>${dayNames[point.day]} ${formatHour(point.hour)}: ${Math.round(point.share * 100)}% active</title></circle>`).join("")
        )
        .join("")}
    </svg>
    <div class="line-legend">${pointsByDay.map(({ day, color }) => `<span><i style="background:${color}"></i>${dayNames[day]}</span>`).join("")}</div>
  `;
}

function renderDailyTable(rows) {
  const grouped = [...groupBy(rows, (row) => `${row.date}|${row.floorId}`)].map(([id, group]) => {
    const first = group[0];
    const floorSpaces = filteredSpaces().filter((space) => space.floorId === first.floorId);
    const spaceMetrics = computeSpaceMetrics(group, floorSpaces, [first.date]);
    const usage = selectedUsageSummary(group, floorSpaces, spaceMetrics, [first.date]);
    const activeSpaces = new Set(group.filter((row) => row.usedMinutes > 0).map((row) => row.spaceId)).size;
    return {
      id,
      date: first.date,
      day: first.day,
      buildingName: buildingName(first.buildingId),
      floorName: floorName(first.floorId),
      type: first.type,
      activeSpaces,
      peakActive: peakSnapshot(group).active,
      shortageHours: usage.shortageHours,
      avgHoursPerSpace: floorSpaces.length ? combine(group).usedHours / floorSpaces.length : 0,
      ...combine(group)
    };
  });
  els.dailyTable.replaceChildren(
    ...grouped
      .sort((a, b) => a.date.localeCompare(b.date) || a.floorName.localeCompare(b.floorName))
      .map((row) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${escapeHtml(row.date)}</td>
          <td>${escapeHtml(dayNames[row.day])}</td>
          <td>${escapeHtml(row.buildingName)}</td>
          <td>${escapeHtml(row.floorName)}</td>
          <td>${escapeHtml(row.type)}</td>
          <td>${row.activeSpaces}</td>
          <td>${number(row.avgHoursPerSpace)}h</td>
          <td>${row.peakActive}</td>
          <td>${number(row.shortageHours, 0)}</td>
        `;
        return tr;
      })
  );
}

function renderWeeklyTable(rows) {
  const grouped = [...groupBy(rows, (row) => `${mondayOf(row.date)}|${row.floorId}`)].map(([id, group]) => {
    const first = group[0];
    const floorSpaces = filteredSpaces().filter((space) => space.floorId === first.floorId);
    const dates = unique(group.map((row) => row.date));
    const spaceMetrics = computeSpaceMetrics(group, floorSpaces, dates);
    const usage = selectedUsageSummary(group, floorSpaces, spaceMetrics, dates);
    return {
      id,
      weekStart: mondayOf(first.date),
      buildingName: buildingName(first.buildingId),
      floorName: floorName(first.floorId),
      type: first.type,
      peakActive: peakSnapshot(group).active,
      ...usage,
      ...combine(group)
    };
  });
  els.weeklyTable.replaceChildren(
    ...grouped
      .sort((a, b) => a.weekStart.localeCompare(b.weekStart) || a.floorName.localeCompare(b.floorName))
      .map((row) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${escapeHtml(row.weekStart)}</td>
          <td>${escapeHtml(row.buildingName)}</td>
          <td>${escapeHtml(row.floorName)}</td>
          <td>${escapeHtml(row.type)}</td>
          <td>${number(row.avgHoursPerSpacePerDay)}h</td>
          <td>${number(row.medianHoursPerSpacePerDay)}h</td>
          <td>${row.peakActive}</td>
          <td>${number(row.shortageHours, 0)}</td>
        `;
        return tr;
      })
  );
}

function renderSpaceTable(spaceMetrics) {
  const maxHours = Math.max(...spaceMetrics.map((row) => row.avgHoursPerDay), 0.1);
  const sorted = spaceMetrics.slice().sort((a, b) => {
    const av = sortValue(a, state.sortKey);
    const bv = sortValue(b, state.sortKey);
    if (typeof av === "string") return state.sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    return state.sortAsc ? av - bv : bv - av;
  });
  els.spaceTable.replaceChildren(
    ...sorted.flatMap((row) => {
      const tr = document.createElement("tr");
      tr.className = row.spaceId === state.selectedSpaceId ? "selected-row" : "";
      tr.innerHTML = `
        <td><button class="link-button" data-sort="spaceName">${escapeHtml(row.spaceName)} ${row.spaceId === state.selectedSpaceId ? "▲" : "▼"}</button></td>
        <td>${escapeHtml(row.floorName)}</td>
        <td>${escapeHtml(row.function)}</td>
        <td>${hoursBar(row.avgHoursPerDay, maxHours)}</td>
        <td>${number(row.medianHoursPerDay)}h</td>
        <td>${number(row.usedHours)}h</td>
        <td>${row.daysUsed}</td>
        ${businessDays.map((day) => `<td>${weekdayPill(row.weekdayHours[day] || 0)}</td>`).join("")}
        <td>${formatDayUsage(row.busiestDay)}</td>
        <td>${row.busiestHour}</td>
        <td>${formatDayUsage(row.quietestDay)}</td>
      `;
      tr.addEventListener("click", () => {
        state.selectedSpaceId = state.selectedSpaceId === row.spaceId ? null : row.spaceId;
        renderSpaceTable(spaceMetrics);
      });
      const rows = [tr];
      if (row.spaceId === state.selectedSpaceId) rows.push(detailRow(row));
      return rows;
    })
  );
}

function sortValue(space, key) {
  if (key.startsWith("day-")) return space.weekdayHours[Number(key.slice(4))] || 0;
  return space[key];
}

function detailRow(space) {
  const tr = document.createElement("tr");
  tr.className = "detail-row";
  const byDate = [...groupBy(space.rows, (row) => row.date)].map(([date, rows]) => ({
    date,
    hours: sum(rows, "usedMinutes") / 60
  }));
  const maxDay = Math.max(...byDate.map((row) => row.hours), 0.1);
  const byHour = [...groupBy(space.rows, (row) => `${row.day}-${row.hour}`)].map(([id, rows]) => ({
    id,
    hours: sum(rows, "usedMinutes") / 60 / Math.max(selectedDateCount(Number(id.split("-")[0])), 1)
  }));
  const maxHour = Math.max(...byHour.map((row) => row.hours), 0.1);

  tr.innerHTML = `
    <td colspan="15">
      <div class="space-detail">
        <div>
          <strong>${escapeHtml(space.spaceName)}</strong>
          <span>${number(space.avgHoursPerDay)} avg hrs/day · ${number(space.medianHoursPerDay)} median hrs/day · ${space.daysUsed} selected days used</span>
        </div>
        <div class="mini-bars">
          ${byDate
            .sort((a, b) => a.date.localeCompare(b.date))
            .map((row) => `<span title="${row.date}: ${number(row.hours)}h"><i style="height:${Math.max(2, (row.hours / maxDay) * 46)}px"></i><small>${row.date.slice(5)}</small></span>`)
            .join("")}
        </div>
        <div class="mini-heatmap">
          ${businessDays
            .filter((day) => state.filters.days.has(day))
            .map((day) => `<b>${dayNames[day]}</b>${range(state.filters.startHour, state.filters.endHour).map((hour) => {
              const value = byHour.find((row) => row.id === `${day}-${hour}`)?.hours || 0;
              const alpha = 0.08 + (value / maxHour) * 0.72;
              return `<em style="background:rgb(40 124 116 / ${alpha})" title="${dayNames[day]} ${formatHour(hour)}: ${number(value)}h avg">${number(value, 1)}</em>`;
            }).join("")}`)
            .join("")}
        </div>
      </div>
    </td>
  `;
  return tr;
}

function renderCoverageNotes() {
  const { metadata, dimensions } = state.data;
  const notes = [
    `Loaded buildings: ${dimensions.buildings.map((building) => building.buildingName).join(", ")}.`,
    `Loaded range: ${metadata.includedRange.start} to ${metadata.includedRange.end}; current filters: ${state.filters.startDate} to ${state.filters.endDate}, ${selectedDayLabels()}, ${formatHour(state.filters.startHour)}-${formatHour(state.filters.endHour)}.`,
    `${dimensions.spaces.length.toLocaleString()} non-bookable target spaces are available in the dashboard.`,
    `All loaded spaces exclude meeting_room function: ${dimensions.spaces.every((space) => space.function !== "meeting_room") ? "yes" : "no"}.`
  ];
  els.coverageNotes.replaceChildren(
    ...notes.map((note) => {
      const li = document.createElement("li");
      li.textContent = note;
      return li;
    })
  );
}

function label(text) {
  const node = document.createElement("div");
  node.className = "heatmap-label";
  node.textContent = text;
  return node;
}

function averageActiveSpaces(rows) {
  const grouped = groupBy(rows, (row) => row.timestamp);
  const counts = [...grouped.values()].map(
    (group) => new Set(group.filter((row) => row.usedMinutes > 0).map((row) => row.spaceId)).size
  );
  return counts.length ? counts.reduce((total, count) => total + count, 0) / counts.length : 0;
}

function peakSnapshot(rows) {
  const grouped = groupBy(rows, (row) => row.timestamp);
  const snapshots = [...grouped].map(([timestamp, group]) => {
    const active = new Set(group.filter((row) => row.usedMinutes > 0).map((row) => row.spaceId));
    const first = group[0];
    return {
      timestamp,
      date: first?.date || "",
      hour: first?.hour || 0,
      dayLabel: first ? dayNames[first.day] : "",
      active: active.size,
      spaceIds: active
    };
  });
  return snapshots.sort((a, b) => b.active - a.active || a.timestamp.localeCompare(b.timestamp))[0] || {
    active: 0,
    spaceIds: new Set(),
    date: "",
    hour: 0,
    dayLabel: ""
  };
}

function mostUsedHourLabel(rows) {
  const grouped = [...groupBy(rows, (row) => `${row.day}-${row.hour}`)].map(([id, group]) => {
    const [day, hour] = id.split("-").map(Number);
    return { day, hour, usedMinutes: sum(group, "usedMinutes") };
  });
  const top = grouped.sort((a, b) => b.usedMinutes - a.usedMinutes)[0];
  return top ? `${dayNames[top.day]} ${formatHour(top.hour)}` : "-";
}

function selectedUsageSummary(rows, spaces, spaceMetrics, datesOverride = selectedDates()) {
  const total = combine(rows);
  const dates = datesOverride.length ? datesOverride : selectedDates();
  const spaceCount = spaces.length;
  const shortageHours = shortageSnapshots(rows, spaceCount).length;
  return {
    usedMinutes: total.usedMinutes,
    availableMinutes: total.availableMinutes,
    usedHours: total.usedHours,
    availableHours: total.availableHours,
    avgHoursPerSpacePerDay:
      spaceCount && dates.length ? total.usedHours / spaceCount / dates.length : 0,
    medianHoursPerSpacePerDay: median(spaceMetrics.map((space) => space.avgHoursPerDay)),
    shortageHours
  };
}

function shortageSnapshots(rows, totalSpaces) {
  if (!totalSpaces) return [];
  return [...groupBy(rows, (row) => row.timestamp)]
    .map(([timestamp, group]) => {
      const active = new Set(group.filter((row) => row.usedMinutes > 0).map((row) => row.spaceId)).size;
      const first = group[0];
      return {
        timestamp,
        active,
        share: active / totalSpaces,
        date: first?.date,
        day: first?.day,
        hour: first?.hour
      };
    })
    .filter((snapshot) => snapshot.share >= shortageThreshold);
}

function busiestHour(rows) {
  const top = [...groupBy(rows, (row) => `${row.day}-${row.hour}`)]
    .map(([id, group]) => {
      const [day, hour] = id.split("-").map(Number);
      return {
        day,
        hour,
        minutes: sum(group, "usedMinutes")
      };
    })
    .sort((a, b) => b.minutes - a.minutes)[0];
  return top && top.minutes > 0 ? `${dayNames[top.day]} ${formatHour(top.hour)}` : "-";
}

function selectedDateCount(dayFilter = null) {
  const dates = new Set(
    state.rows
      .filter(
        (row) =>
          row.date >= state.filters.startDate &&
          row.date <= state.filters.endDate &&
          state.filters.days.has(row.day) &&
          (dayFilter == null || row.day === dayFilter)
      )
      .map((row) => row.date)
  );
  return dates.size;
}

function selectedDates(dayFilter = null) {
  return unique(
    state.rows
      .filter(
        (row) =>
          row.date >= state.filters.startDate &&
          row.date <= state.filters.endDate &&
          state.filters.days.has(row.day) &&
          (dayFilter == null || row.day === dayFilter)
      )
      .map((row) => row.date)
  );
}

function selectedDayLabels() {
  return [...state.filters.days].sort((a, b) => a - b).map((day) => dayNames[day]).join(", ");
}

function median(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function unique(values) {
  return [...new Set(values)].sort();
}

function buildingName(id) {
  return state.data.dimensions.buildings.find((building) => building.buildingId === id)?.buildingName || id;
}

function floorName(id) {
  return state.data.dimensions.floors.find((floor) => floor.floorId === id)?.floorName || id;
}

function groupBy(rows, getKey) {
  const map = new Map();
  for (const row of rows) {
    const id = getKey(row);
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(row);
  }
  return map;
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
}

function utilization(row) {
  return row.availableMinutes ? (row.usedMinutes / row.availableMinutes) * 100 : 0;
}

function percent(row) {
  return utilization(row).toFixed(1);
}

function number(value, places = 1) {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: places,
    maximumFractionDigits: places
  });
}

function range(start, end) {
  return Array.from({ length: Math.max(end - start, 0) }, (_, index) => start + index);
}

function dayIndex(date) {
  return new Date(`${date}T00:00:00`).getDay();
}

function mondayOf(date) {
  const result = new Date(`${date}T00:00:00`);
  const day = result.getDay();
  result.setDate(result.getDate() + (day === 0 ? -6 : 1 - day));
  return result.toISOString().slice(0, 10);
}

function formatHour(hour) {
  const suffix = hour >= 12 ? "pm" : "am";
  const display = hour > 12 ? hour - 12 : hour;
  return `${display}${suffix}`;
}

function formatDayUsage(day) {
  return `${day.label} ${number(day.hours)}h`;
}

function hoursBar(value, max) {
  return `<span class="hours-bar"><i style="width:${Math.max(2, (value / max) * 100)}%"></i><b>${number(value)}h</b></span>`;
}

function weekdayPill(value) {
  const intensity = Math.min(value / 4, 1);
  return `<span class="weekday-pill" style="background:rgb(31 109 214 / ${0.08 + intensity * 0.72})">${value < 0.05 ? "<0.1" : number(value, 1)}</span>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };
    return entities[char];
  });
}
