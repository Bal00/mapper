// --- Data model ------------------------------------------------------------
let items = []; // {id, name, category, importance (0-100), proximity (0-100), strength (0-10), notes}
let editingId = null;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// --- Form & Table ----------------------------------------------------------
function resetForm() {
  editingId = null;
  $("#form").reset();
  $("#importance").value = 60;
  $("#proximity").value = 40;
  $("#strength").value = 6;
}
$("#clearForm").addEventListener("click", resetForm);

function upsertFromForm(e) {
  e.preventDefault();
  const rec = {
    id: editingId ?? crypto.randomUUID(),
    name: $("#name").value.trim(),
    category: $("#category").value.trim() || "Uncategorized",
    importance: clamp(+$("#importance").value, 0, 100),
    proximity: clamp(+$("#proximity").value, 0, 100),
    strength: clamp(+$("#strength").value, 0, 10),
    notes: $("#notes").value.trim()
  };
  if (!rec.name) return;
  const idx = items.findIndex(x => x.id === rec.id);
  if (idx >= 0) items[idx] = rec; else items.push(rec);
  renderTable();
  resetForm();
}
$("#form").addEventListener("submit", upsertFromForm);

function renderTable() {
  const tbody = $("#table tbody");
  tbody.innerHTML = "";
  for (const rec of items) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(rec.name)}</td>
      <td>${escapeHtml(rec.category)}</td>
      <td>${rec.importance}</td>
      <td>${rec.proximity}</td>
      <td>${rec.strength}</td>
      <td>
        <button class="action" data-act="edit" data-id="${rec.id}">Edit</button>
        <button class="action" data-act="del" data-id="${rec.id}">Delete</button>
      </td>`;
    tbody.appendChild(tr);
  }
  tbody.addEventListener("click", onRowAction);
}
function onRowAction(e) {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const id = btn.dataset.id;
  const rec = items.find(x => x.id === id);
  if (!rec) return;
  if (btn.dataset.act === "edit") {
    editingId = rec.id;
    $("#name").value = rec.name;
    $("#category").value = rec.category;
    $("#importance").value = rec.importance;
    $("#proximity").value = rec.proximity;
    $("#strength").value = rec.strength;
    $("#notes").value = rec.notes;
    window.scrollTo({ top: 0, behavior: "smooth" });
  } else if (btn.dataset.act === "del") {
    items = items.filter(x => x.id !== id);
    renderTable();
  }
}

// --- Persistence & I/O -----------------------------------------------------
$("#save").addEventListener("click", () => {
  localStorage.setItem("egomap_items", JSON.stringify(items));
  alert("Saved to this browser.");
});
$("#load").addEventListener("click", () => {
  const raw = localStorage.getItem("egomap_items");
  if (!raw) return alert("Nothing saved yet.");
  try { items = JSON.parse(raw) || []; }
  catch { items = []; }
  renderTable();
});
$("#exportJSON").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(items, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: "stakeholders.json" });
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
});
$("#importJSON").addEventListener("change", (e) => {
  const file = e.target.files?.[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const incoming = JSON.parse(reader.result);
      if (Array.isArray(incoming)) { items = incoming; renderTable(); }
      else alert("Invalid JSON format.");
    } catch { alert("Couldn't parse JSON."); }
  };
  reader.readAsText(file);
});

// --- Visualization (D3) ----------------------------------------------------
$("#render").addEventListener("click", draw);
window.addEventListener("resize", draw);

function draw() {
  const svg = d3.select("#svg");
  svg.selectAll("*").remove();

  const { width, height } = svg.node().getBoundingClientRect();
  const cx = width / 2, cy = height / 2;
  const maxR = Math.min(width, height) * 0.42;

  // Scales
  const size = d3.scaleLinear().domain([0,100]).range([8, 48]);
  const radius = d3.scaleLinear().domain([0,100]).range([maxR * 0.2, maxR]); // lower proximity => nearer center
  const linkWidth = d3.scaleLinear().domain([0,10]).range([1, 10]);

  // Rings for reference
  const ringVals = [20, 40, 60, 80, 100];
  svg.append("g").selectAll("circle")
    .data(ringVals).enter()
    .append("circle")
    .attr("class", "ring")
    .attr("cx", cx).attr("cy", cy)
    .attr("r", d => radius(d));

  // Center node (You)
  svg.append("circle")
    .attr("class", "center")
    .attr("cx", cx).attr("cy", cy)
    .attr("r", 12);

  svg.append("text")
    .attr("x", cx).attr("y", cy - 22)
    .attr("text-anchor", "middle")
    .attr("fill", "#c7ced9").attr("font-size", 12)
    .text("You");

  // Angle assignment: group by category, evenly within each group
  const groups = d3.groups(items, d => d.category);
  const groupAngles = d3.scalePoint()
    .domain(groups.map(g => g[0]))
    .range([0, 2 * Math.PI]);
  const positions = [];

  for (const [cat, arr] of groups) {
    const base = groupAngles(cat) ?? 0;
    // Spread items in the same category by small offsets
    const offsets = d3.scalePoint().domain(d3.range(arr.length)).range([-0.3, 0.3]);
    arr.forEach((d, i) => {
      positions.push({
        ...d,
        angle: base + (offsets(i) || 0),
        r: radius(d.proximity)
      });
    });
  }

  // Links (stalks)
  const links = positions.map(d => ({
    source: { x: cx, y: cy },
    target: { x: cx + Math.cos(d.angle) * d.r, y: cy + Math.sin(d.angle) * d.r },
    strength: d.strength,
    id: d.id
  }));

  const link = svg.append("g")
    .attr("stroke-linecap", "round")
    .selectAll("line")
    .data(links).enter()
    .append("line")
    .attr("class", "link")
    .attr("x1", d => d.source.x).attr("y1", d => d.source.y)
    .attr("x2", d => d.target.x).attr("y2", d => d.target.y)
    .attr("stroke-width", d => linkWidth(d.strength));

  // Nodes
  const tooltip = d3.select("body").append("div").attr("class", "tooltip");
  const node = svg.append("g")
    .selectAll("g.node")
    .data(positions, d => d.id)
    .enter()
    .append("g")
    .attr("class", "node")
    .attr("transform", d => `translate(${cx + Math.cos(d.angle) * d.r},${cy + Math.sin(d.angle) * d.r})`)
    .call(d3.drag()
      .on("start", function(event, d){
        d3.select(this).raise();
      })
      .on("drag", function(event, d){
        // Drag freely but keep the link anchored to center
        const x = event.x, y = event.y;
        d3.select(this).attr("transform", `translate(${x},${y})`);
        // Update its link
        const L = links.find(l => l.id === d.id);
        L.target.x = x; L.target.y = y;
        link.filter(l => l.id === d.id)
          .attr("x2", x).attr("y2", y);
      })
    );

  node.append("circle")
    .attr("r", d => size(d.importance))
    .on("mousemove", function(event, d){
      tooltip.style("display", "block")
        .style("left", (event.pageX + 12) + "px")
        .style("top", (event.pageY + 12) + "px")
        .html(`
          <strong>${escapeHtml(d.name)}</strong><br/>
          Category: ${escapeHtml(d.category)}<br/>
          Importance: ${d.importance}<br/>
          Proximity: ${d.proximity}<br/>
          Strength: ${d.strength}<br/>
          ${d.notes ? ("Notes: " + escapeHtml(d.notes)) : ""}
        `);
    })
    .on("mouseleave", () => tooltip.style("display", "none"));

  node.append("text")
    .text(d => d.name)
    .attr("dy", 0);

  // Legend
  const legend = svg.append("g").attr("transform", `translate(${width - 210},${20})`);
  legend.append("text").text("Legend").attr("fill", "#c7ced9").attr("font-size", 12);
  legend.append("circle").attr("cx", 16).attr("cy", 26).attr("r", 8).attr("fill", "#6ea8fe");
  legend.append("text").attr("x", 36).attr("y", 30).text("Size = Importance").attr("font-size", 12).attr("fill", "#c7ced9");
  legend.append("line").attr("x1", 8).attr("x2", 32).attr("y1", 48).attr("y2", 48).attr("stroke-width", 6).attr("stroke", "#9fb6d4");
  legend.append("text").attr("x", 36).attr("y", 52).text("Width = Strength").attr("font-size", 12).attr("fill", "#c7ced9");
  legend.append("text").attr("x", 0).attr("y", 74).text("Closer to center = higher proximity").attr("font-size", 12).attr("fill", "#c7ced9");
}

function clamp(v, min, max){ return Math.max(min, Math.min(max, v)); }
function escapeHtml(s){ return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

renderTable(); // initial table

// --- PNG download from SVG -------------------------------------------------
$("#downloadPNG").addEventListener("click", () => {
  const svg = document.getElementById("svg");
  const serializer = new XMLSerializer();
  const svgStr = serializer.serializeToString(svg);
  const canvas = document.createElement("canvas");
  const { width, height } = svg.getBoundingClientRect();
  canvas.width = width * 2; canvas.height = height * 2;
  const ctx = canvas.getContext("2d");
  const img = new Image();
  const svgBlob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);
  img.onload = () => {
    ctx.scale(2,2);
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    canvas.toBlob((blob) => {
      const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "stakeholder-map.png" });
      document.body.appendChild(a); a.click(); a.remove();
    });
  };
  img.src = url;
});
