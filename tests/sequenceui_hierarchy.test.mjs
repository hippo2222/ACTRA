/* @vitest-environment jsdom */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";

const code = fs.readFileSync(
  path.resolve(process.cwd(), "frontend/SequenceUI/SequenceUI.web.js"),
  "utf8"
);

let SequenceUI;

function buildHierarchyTask({ difficulty = 1, colorDifferentiation = false, blind = false } = {}) {
  const content = {
    prompt: "Classify the findings",
    display_mode: "hierarchy",
    color_differentiation: colorDifferentiation,
    elements: blind
      ? []
      : [
          { id: "elem_1", text: "Atelectasis" },
          { id: "elem_2", text: "Obstructive" },
          { id: "elem_3", text: "Compressive" },
          { id: "elem_4", text: "Foreign body" },
        ],
    levels: [
      { level_id: "t1", label: "Causes", blocks: ["elem_1"] },
      { level_id: "t2", label: "Types", blocks: ["elem_2", "elem_3", "elem_4"] },
    ],
    nodes: [
      { node_id: "n1", level_id: "t1", parent_id: null, slots: ["elem_1"] },
      { node_id: "n2", level_id: "t2", parent_id: "n1", slots: ["elem_2", "elem_3"] },
      { node_id: "n3", level_id: "t2", parent_id: "n1", slots: ["elem_4"] },
    ],
    requires_block_names: blind,
    requires_level_names: difficulty === 2,
    settings: { difficulty, shuffle_elements: false, display_mode: "hierarchy" },
  };
  return { task_data: { content, settings: content.settings } };
}

function renderHierarchy(options) {
  const container = document.getElementById("seq-root");
  SequenceUI.render(container, buildHierarchyTask(options));
  return container;
}

function instance() {
  return SequenceUI.__testHooks.getCurrentInstance();
}

beforeAll(() => {
  window.requestAnimationFrame = window.requestAnimationFrame || ((cb) => {
    cb();
    return 1;
  });
  global.requestAnimationFrame = window.requestAnimationFrame;
  window.eval(`${code}\n;window.SequenceUI = SequenceUI;`);
  SequenceUI = window.SequenceUI;
});

beforeEach(() => {
  document.body.innerHTML = `<div id="seq-root"></div>`;
});

afterEach(() => {
  SequenceUI.cleanup();
});

describe("SequenceUI hierarchy helpers", () => {
  it("computes a deterministic tree layout with parents centred over their children", () => {
    const nodes = SequenceUI.__testHooks.normalizeHierarchyNodes([
      { node_id: "r", level_id: "t1", parent_id: null, slots: ["a"] },
      { node_id: "c1", level_id: "t2", parent_id: "r", slots: ["b"] },
      { node_id: "c2", level_id: "t2", parent_id: "r", slots: ["c"] },
      { node_id: "r2", level_id: "t1", parent_id: null, slots: ["d"] },
    ]);
    const layout = SequenceUI.__testHooks.computeHierarchyGridLayout(nodes, ["t1", "t2"]);

    expect(layout.totalCols).toBe(3);
    expect(layout.byNodeId.get("r")).toMatchObject({ colStart: 1, colSpan: 2, tierIdx: 0, hasChildren: true });
    expect(layout.byNodeId.get("c1")).toMatchObject({ colStart: 1, colSpan: 1, tierIdx: 1 });
    expect(layout.byNodeId.get("c2")).toMatchObject({ colStart: 2, colSpan: 1, tierIdx: 1 });
    expect(layout.byNodeId.get("r2")).toMatchObject({ colStart: 3, colSpan: 1, hasChildren: false });
  });

  it("survives cyclic or dangling parent references", () => {
    const nodes = SequenceUI.__testHooks.normalizeHierarchyNodes([
      { node_id: "a", level_id: "t1", parent_id: "b", slots: [null] },
      { node_id: "b", level_id: "t1", parent_id: "a", slots: [null] },
      { node_id: "c", level_id: "t1", parent_id: "ghost", slots: [null] },
    ]);
    const layout = SequenceUI.__testHooks.computeHierarchyGridLayout(nodes, ["t1"]);
    expect(layout.byNodeId.size).toBe(3);
    expect(layout.totalCols).toBeGreaterThanOrEqual(1);
  });

  it("builds rounded orthogonal connectors and clamps zoom", () => {
    expect(SequenceUI.__testHooks.buildRoundedElbowPath(10, 0, 10, 40)).toBe("M 10 0 L 10 40");
    expect(SequenceUI.__testHooks.buildRoundedElbowPath(10, 0, 90, 80)).toContain("Q");
    expect(SequenceUI.__testHooks.clampHierarchyZoom(5)).toBe(1.4);
    expect(SequenceUI.__testHooks.clampHierarchyZoom(0.1)).toBe(0.6);
    expect(SequenceUI.__testHooks.clampHierarchyZoom("bad")).toBe(1);
  });
});

describe("SequenceUI hierarchy mode - difficulty 1", () => {
  it("renders the tier skeleton, node cards and tier tabs with remaining counts", () => {
    renderHierarchy({ colorDifferentiation: true });

    expect(document.querySelector('[data-sequenceui="hierarchy-shell"]')).not.toBeNull();
    expect(document.querySelectorAll(".seqh-node")).toHaveLength(3);
    expect(document.querySelectorAll(".seqh-tier")).toHaveLength(2);
    expect(document.querySelectorAll(".seqh-tier")[0].textContent).toContain("Causes");
    expect(document.querySelector(".seqh-node[data-tint]")).not.toBeNull();

    // n2 is a leaf container-group with two slots, n1 and n3 have one slot each.
    expect(document.querySelectorAll('[data-sequenceui-slot="true"]')).toHaveLength(4);

    const tabs = document.querySelectorAll('[data-sequenceui="available-tier-tab"]');
    expect(tabs).toHaveLength(2);
    expect(tabs[0].querySelector(".seqh-tab__count").textContent).toBe("1");
    expect(tabs[1].querySelector(".seqh-tab__count").textContent).toBe("3");

    // Only the cards of the active tier are listed.
    const visible = document.querySelectorAll('[data-sequenceui="available-item"]');
    expect(visible).toHaveLength(1);
    expect(visible[0].textContent).toContain("Atelectasis");
  });

  it("serializes nodes with skeleton ids and parents after placing cards on their own tier", () => {
    renderHierarchy();
    const inst = instance();
    inst.placeElementIntoLevel(0, 0, "elem_1");
    // After the first tier is exhausted the active tab advances to the next unfinished tier.
    expect(
      document.querySelector('[data-sequenceui="available-tier-tab"].is-active').dataset.tierId
    ).toBe("t2");
    inst.placeElementIntoLevel(1, 0, "elem_3");

    const payload = inst.getUserAnswerPayload();
    expect(payload.display_mode).toBe("hierarchy");
    expect(payload.nodes).toHaveLength(3);
    expect(payload.nodes[0]).toMatchObject({ node_id: "n1", level_id: "t1", parent_id: null, blocks: ["elem_1"] });
    expect(payload.nodes[1]).toMatchObject({ node_id: "n2", parent_id: "n1", blocks: ["elem_3"] });
    expect(payload.nodes[2]).toMatchObject({ node_id: "n3", blocks: [] });
    expect(payload.levels).toHaveLength(2);
    expect(payload.levels[1].blocks).toEqual(["elem_3"]);
  });

  it("rejects dropping a card on a node of another tier and shows a hint", () => {
    renderHierarchy();
    const inst = instance();
    inst.placeElementIntoLevel(1, 0, "elem_1");

    expect(inst.getUserAnswerPayload().nodes.every((n) => n.blocks.length === 0)).toBe(true);
    const hint = document.querySelector(".seqh-hint");
    expect(hint.classList.contains("is-visible")).toBe(true);
    expect(hint.textContent).toContain("Causes");
  });

  it("dims nodes of other tiers while a card is selected", () => {
    renderHierarchy();
    document.querySelector('[data-sequenceui="available-item"]').click();

    expect(document.querySelector(".seqh-shell").classList.contains("seqh-focusing")).toBe(true);
    const matching = document.querySelectorAll(".seqh-node.seqh-tier-match");
    expect(matching).toHaveLength(1);
    expect(matching[0].dataset.nodeId).toBe("n1");
  });

  it("restores a saved draft by node id", () => {
    renderHierarchy();
    const inst = instance();
    inst.restoreInput({
      nodes: [
        { node_id: "n1", blocks: ["elem_1"] },
        { node_id: "n2", blocks: ["elem_2", "elem_3"] },
      ],
    });
    const payload = inst.getUserAnswerPayload();
    expect(payload.nodes[0].blocks).toEqual(["elem_1"]);
    expect(payload.nodes[1].blocks).toEqual(["elem_2", "elem_3"]);
    expect(payload.nodes[2].blocks).toEqual([]);
    expect(document.querySelectorAll('[data-sequenceui-placed-item="true"]')).toHaveLength(3);
  });

  it("marks nodes and slots from check feedback and switches to the reference view", () => {
    renderHierarchy();
    const inst = instance();
    inst.restoreInput({
      nodes: [
        { node_id: "n1", blocks: ["elem_1"] },
        { node_id: "n2", blocks: ["elem_2", "elem_4"] },
        { node_id: "n3", blocks: ["elem_3"] },
      ],
    });
    inst.applyCheckFeedback({
      success: false,
      details: {
        correct_levels: ["t1"],
        correct_nodes: ["n1"],
        incorrect_nodes: ["n2", "n3"],
        correct_blocks_by_node: { n1: ["elem_1"], n2: ["elem_2"], n3: [] },
        node_mapping: { n1: "n1", n2: "n2", n3: "n3" },
        correct_nodes_data: [
          { node_id: "n1", level_id: "t1", parent_id: null, blocks: ["elem_1"] },
          { node_id: "n2", level_id: "t2", parent_id: "n1", blocks: ["elem_2", "elem_3"] },
          { node_id: "n3", level_id: "t2", parent_id: "n1", blocks: ["elem_4"] },
        ],
        elements_data: [],
      },
    });

    const verdicts = Array.from(document.querySelectorAll(".seqh-node")).map((n) => n.dataset.verdict);
    expect(verdicts).toEqual(["correct", "incorrect", "incorrect"]);
    const n2Slots = document.querySelectorAll('.seqh-node[data-node-id="n2"] [data-sequenceui-placed-item="true"]');
    expect(n2Slots[0].className).toContain("bg-success-lighter");
    expect(n2Slots[1].className).toContain("bg-error-lighter");

    document.querySelector('[data-sequenceui="comparison-view-reference"]').click();
    const refNodes = Array.from(document.querySelectorAll(".seqh-node")).map((n) => n.dataset.verdict);
    expect(refNodes).toEqual(["reference", "reference", "reference"]);
    const staticSlots = Array.from(document.querySelectorAll(".seqh-slot--static")).map((s) => s.textContent);
    expect(staticSlots).toEqual(["Atelectasis", "Obstructive", "Compressive", "Foreign body"]);
  });

  it("collapses sidebar and renders in-node clinical diff overlay (Option 2) on submit", () => {
    renderHierarchy();
    const inst = instance();
    // Student places n1 correctly, leaves n2 partially missed (places elem_2, misses slot 2), places n3 incorrectly
    inst.restoreInput({
      nodes: [
        { node_id: "n1", blocks: ["elem_1"] },
        { node_id: "n2", blocks: ["elem_2"] },
        { node_id: "n3", blocks: ["elem_3"] },
      ],
    });

    inst.applyCheckFeedback({
      success: false,
      details: {
        correct_levels: ["t1"],
        correct_nodes: ["n1"],
        incorrect_nodes: ["n2", "n3"],
        correct_blocks_by_node: { n1: ["elem_1"], n2: ["elem_2"], n3: [] },
        node_mapping: { n1: "n1", n2: "n2", n3: "n3" },
        correct_nodes_data: [
          { node_id: "n1", level_id: "t1", parent_id: null, blocks: ["elem_1"] },
          { node_id: "n2", level_id: "t2", parent_id: "n1", blocks: ["elem_2", "elem_4"] },
          { node_id: "n3", level_id: "t2", parent_id: "n1", blocks: ["elem_4"] },
        ],
        elements_data: [
          { id: "elem_1", text: "Atelectasis" },
          { id: "elem_2", text: "Obstructive" },
          { id: "elem_3", text: "Compressive" },
          { id: "elem_4", text: "Foreign body" },
        ],
      },
    });

    // 1. Sidebar is collapsed and hidden to yield full width
    const sidebar = document.querySelector('[data-sequenceui="available-sidebar"]');
    expect(sidebar.classList.contains("hidden")).toBe(true);

    // 2. Comparison toggle is hidden; debriefing title is shown
    const toggle = document.querySelector('[data-sequenceui="comparison-toolbar"] > div:nth-child(2)');
    expect(toggle.classList.contains("hidden")).toBe(true);
    const debriefTitle = document.querySelector('[data-sequenceui="comparison-status"]');
    expect(debriefTitle.textContent).toContain("Разбор решения");

    // 3. n2 slot 2 was omitted by student -> rendered as .seqh-slot--missed
    const missedSlot = document.querySelector('.seqh-node[data-node-id="n2"] .seqh-slot--missed');
    expect(missedSlot).not.toBeNull();
    expect(missedSlot.textContent).toContain("Пропущен этап");
    expect(missedSlot.textContent).toContain("Foreign body");

    // 4. n3 was filled with wrong element (student placed elem_3, expected elem_4) -> rendered as .seqh-slot--incorrect
    const incorrectSlot = document.querySelector('.seqh-node[data-node-id="n3"] .seqh-slot--incorrect');
    expect(incorrectSlot).not.toBeNull();
    expect(incorrectSlot.textContent).toContain("Compressive");
    expect(incorrectSlot.textContent).toContain("Foreign body");
    expect(incorrectSlot.querySelector(".line-through").textContent).toContain("Compressive");
  });
});

describe("SequenceUI hierarchy mode - difficulty 2", () => {
  it("hides tier names, lets the learner type them, and validates before submit", () => {
    renderHierarchy({ difficulty: 2 });

    const inputs = document.querySelectorAll(".seqh-tier__input");
    expect(inputs).toHaveLength(2);
    expect(inputs[0].value).toBe("");
    expect(document.body.textContent).not.toContain("Causes");
    // Neutral tab titles must not leak the real tier names.
    const tabLabels = Array.from(document.querySelectorAll(".seqh-tab__label")).map((el) => el.textContent);
    expect(tabLabels.join("|")).not.toContain("Causes");

    const inst = instance();
    inst.placeElementIntoLevel(0, 0, "elem_1");
    expect(inst.validateBeforeSubmit().valid).toBe(false);

    const firstInput = document.querySelector(".seqh-tier__input");
    firstInput.value = "My causes";
    firstInput.dispatchEvent(new window.Event("input", { bubbles: true }));

    expect(inst.validateBeforeSubmit().valid).toBe(true);
    expect(inst.getUserAnswerPayload().levels[0].level_name).toBe("My causes");
    // The typed name is reflected in the tab title in real time.
    expect(document.querySelector(".seqh-tab__label").textContent).toContain("My causes");
  });
});

describe("SequenceUI hierarchy mode - difficulty 3", () => {
  it("renders text inputs for every skeleton slot and serializes block names per node", () => {
    renderHierarchy({ difficulty: 3, blind: true });

    expect(document.querySelectorAll(".seqh-slot__input")).toHaveLength(4);
    expect(document.querySelector('[data-sequenceui="available-sidebar"]').classList.contains("hidden")).toBe(true);
    // Tier labels stay visible as the coordinate system of the question.
    expect(document.querySelectorAll(".seqh-tier")[1].textContent).toContain("Types");

    const first = document.querySelector(".seqh-slot__input");
    first.value = "Atelectasis";
    first.dispatchEvent(new window.Event("input", { bubbles: true }));

    const payload = instance().getUserAnswerPayload();
    expect(payload.nodes[0].blocks).toHaveLength(1);
    const slotId = payload.nodes[0].blocks[0];
    expect(payload.nodes[0].block_names[slotId]).toBe("Atelectasis");
    expect(payload.nodes[1].blocks).toEqual([]);
  });
});

describe("SequenceUI hierarchy Stage 1 deep fixes", () => {
  it("distinguishes single-slot vs multi-slot group nodes with data-slot-count", () => {
    renderHierarchy();

    const n1 = document.querySelector('.seqh-node[data-node-id="n1"]');
    const n2 = document.querySelector('.seqh-node[data-node-id="n2"]');
    expect(n1).not.toBeNull();
    expect(n2).not.toBeNull();

    expect(n1.getAttribute("data-slot-count")).toBe("1");
    expect(n1.classList.contains("seqh-node--empty")).toBe(true);

    expect(n2.getAttribute("data-slot-count")).toBe("2");
    expect(n2.classList.contains("seqh-node--empty")).toBe(true);
  });

  it("performs in-place DOM patching without destroying the canvas shell on card placement", () => {
    renderHierarchy();
    const inst = instance();

    const shellBefore = document.querySelector('[data-sequenceui="hierarchy-shell"]');
    const sliderBefore = document.querySelector(".seqh-zoom-slider");
    expect(shellBefore).not.toBeNull();
    expect(sliderBefore).not.toBeNull();

    // Place card into n1
    inst.placeElementIntoLevel(0, 0, "elem_1");

    const shellAfter = document.querySelector('[data-sequenceui="hierarchy-shell"]');
    const sliderAfter = document.querySelector(".seqh-zoom-slider");

    // The shell and toolbar must NOT have been destroyed or recreated
    expect(shellAfter).toBe(shellBefore);
    expect(sliderAfter).toBe(sliderBefore);

    const n1 = document.querySelector('.seqh-node[data-node-id="n1"]');
    expect(n1.classList.contains("seqh-node--empty")).toBe(false);
    expect(n1.querySelector('[data-sequenceui-placed-item="true"]').textContent).toContain("Atelectasis");
  });

  it("renders precision zoom slider in toolbar and synchronizes zoom in both directions", () => {
    renderHierarchy();
    const slider = document.querySelector(".seqh-zoom-slider");
    expect(slider).not.toBeNull();
    expect(slider.min).toBe("60");
    expect(slider.max).toBe("140");
    expect(slider.step).toBe("1");

    const zoomLabel = document.querySelector(".seqh-zoom-label");
    expect(zoomLabel).not.toBeNull();

    // Move slider to 120%
    slider.value = "120";
    slider.dispatchEvent(new window.Event("input", { bubbles: true }));

    expect(zoomLabel.textContent).toBe("120%");
    const stage = document.querySelector(".seqh-stage");
    expect(stage.style.transform).toBe("scale(1.2)");
  });

  it("switches to sticky category accordion for tasks with 5 or more tiers", () => {
    const content = {
      prompt: "Multi-tier classification",
      display_mode: "hierarchy",
      color_differentiation: true,
      elements: [
        { id: "e1", text: "Alpha" },
        { id: "e2", text: "Beta" },
        { id: "e3", text: "Gamma" },
        { id: "e4", text: "Delta" },
        { id: "e5", text: "Epsilon" },
      ],
      levels: [
        { level_id: "lvl_1", label: "Tier One", blocks: ["e1"] },
        { level_id: "lvl_2", label: "Tier Two", blocks: ["e2"] },
        { level_id: "lvl_3", label: "Tier Three", blocks: ["e3"] },
        { level_id: "lvl_4", label: "Tier Four", blocks: ["e4"] },
        { level_id: "lvl_5", label: "Tier Five", blocks: ["e5"] },
      ],
      nodes: [
        { node_id: "nd_1", level_id: "lvl_1", parent_id: null, slots: ["e1"] },
        { node_id: "nd_2", level_id: "lvl_2", parent_id: "nd_1", slots: ["e2"] },
        { node_id: "nd_3", level_id: "lvl_3", parent_id: "nd_2", slots: ["e3"] },
        { node_id: "nd_4", level_id: "lvl_4", parent_id: "nd_3", slots: ["e4"] },
        { node_id: "nd_5", level_id: "lvl_5", parent_id: "nd_4", slots: ["e5"] },
      ],
      settings: { difficulty: 1, shuffle_elements: false, display_mode: "hierarchy" },
    };

    const container = document.getElementById("seq-root");
    SequenceUI.render(container, { task_data: { content, settings: content.settings } });

    // Standard horizontal tabs must be hidden
    const tabs = document.querySelector(".seqh-tabs");
    expect(tabs.classList.contains("hidden")).toBe(true);

    // Accordion headers must be rendered for all 5 tiers
    const headers = document.querySelectorAll('[data-sequenceui="available-tier-header"]');
    expect(headers).toHaveLength(5);
    expect(headers[0].textContent).toContain("I.");
    expect(headers[0].textContent).toContain("Tier One");
    expect(headers[4].textContent).toContain("V.");
    expect(headers[4].textContent).toContain("Tier Five");

    // Clicking a header toggles its collapse state
    expect(document.querySelector('.seqh-pool-group[data-tier-id="lvl_1"]').classList.contains("is-collapsed")).toBe(false);

    headers[0].click();
    expect(document.querySelector('.seqh-pool-group[data-tier-id="lvl_1"]').classList.contains("is-collapsed")).toBe(true);

    document.querySelectorAll('[data-sequenceui="available-tier-header"]')[0].click();
    expect(document.querySelector('.seqh-pool-group[data-tier-id="lvl_1"]').classList.contains("is-collapsed")).toBe(false);
  });
});

describe("SequenceUI Stage 3: 2D Columns, Headers, and Anti-Matryoshka", () => {
  function buildTable51Task() {
    const content = {
      prompt: "Пневмоторакс против Обтурационного ателектаза (Таблица 5.1)",
      display_mode: "hierarchy",
      elements: [
        { id: "e_p1", text: "Средостение: Смещение в здоровую сторону" },
        { id: "e_p2", text: "Диафрагма: Опущена и уплощена" },
        { id: "e_a1", text: "Средостение: Смещение в сторону поражения" },
        { id: "e_a2", text: "Диафрагма: Поднята вверх" },
      ],
      levels: [
        { level_id: "lvl_crit_1", label: "Положение средостения", blocks: ["e_p1", "e_a1"] },
        { level_id: "lvl_crit_2", label: "Положение купола диафрагмы", blocks: ["e_p2", "e_a2"] },
      ],
      nodes: [
        {
          node_id: "node_p1",
          level_id: "lvl_crit_1",
          parent_id: null,
          column_title: "Пневмоторакс",
          slots: ["e_p1"],
        },
        {
          node_id: "node_p2",
          level_id: "lvl_crit_2",
          parent_id: "node_p1",
          column_title: "Пневмоторакс",
          slots: ["e_p2"],
        },
        {
          node_id: "node_a1",
          level_id: "lvl_crit_1",
          parent_id: null,
          column_title: "Обтурационный ателектаз",
          slots: ["e_a1"],
        },
        {
          node_id: "node_a2",
          level_id: "lvl_crit_2",
          parent_id: "node_a1",
          column_title: "Обтурационный ателектаз",
          slots: ["e_a2"],
        },
      ],
      settings: { difficulty: 1, shuffle_elements: false, display_mode: "hierarchy" },
    };
    return { task_data: { content, settings: content.settings } };
  }

  it("normalizeHierarchyNodes parses columnTitle / column_title", () => {
    const normalized = SequenceUI.__testHooks.normalizeHierarchyNodes([
      { node_id: "n1", level_id: "l1", parent_id: null, column_title: "Пневмоторакс", slots: ["e1"] },
      { node_id: "n2", level_id: "l1", parent_id: null, columnTitle: "Ателектаз", slots: ["e2"] },
      { node_id: "n3", level_id: "l1", parent_id: null, slots: ["e3"] },
    ]);
    expect(normalized[0].columnTitle).toBe("Пневмоторакс");
    expect(normalized[1].columnTitle).toBe("Ателектаз");
    expect(normalized[2].columnTitle).toBe("");
  });

  it("computeHierarchyGridLayout detects 2D columns and propagates rootIdx to children", () => {
    const task = buildTable51Task();
    const nodes = SequenceUI.__testHooks.normalizeHierarchyNodes(task.task_data.content.nodes);
    const layout = SequenceUI.__testHooks.computeHierarchyGridLayout(nodes, ["lvl_crit_1", "lvl_crit_2"]);

    expect(layout.hasColumnHeaders).toBe(true);
    expect(layout.roots).toHaveLength(2);
    expect(layout.byNodeId.get("node_p1").rootIdx).toBe(0);
    expect(layout.byNodeId.get("node_p2").rootIdx).toBe(0);
    expect(layout.byNodeId.get("node_a1").rootIdx).toBe(1);
    expect(layout.byNodeId.get("node_a2").rootIdx).toBe(1);
  });

  it("renders corner open-air spacer (1, 1), column lanes and column headers in S1 player", () => {
    const container = document.getElementById("seq-root");
    SequenceUI.render(container, buildTable51Task());

    // Corner spacer
    const cornerSpacer = document.querySelector(".seqh-grid-corner-spacer");
    expect(cornerSpacer).not.toBeNull();
    expect(cornerSpacer.style.gridColumn).toBe("1 / 2");
    expect(cornerSpacer.style.gridRow).toBe("1");

    // 2 Column lanes spanning 1 / -1
    const lanes = document.querySelectorAll(".seqh-col-lane");
    expect(lanes).toHaveLength(2);
    expect(lanes[0].dataset.colIdx).toBe("0");
    expect(lanes[1].dataset.colIdx).toBe("1");
    expect(lanes[0].style.gridRow).toBe("1 / -1");

    // 2 Column headers in gridRow: 1 with Roman numerals and titles
    const headers = document.querySelectorAll(".seqh-col-header-cell");
    expect(headers).toHaveLength(2);
    expect(headers[0].style.gridRow).toBe("1");
    expect(headers[0].textContent).toContain("I");
    expect(headers[0].textContent).toContain("Пневмоторакс");
    expect(headers[1].style.gridRow).toBe("1");
    expect(headers[1].textContent).toContain("II");
    expect(headers[1].textContent).toContain("Обтурационный ателектаз");

    // Tier cells and bands shifted down by 1 (to row 2 and 3)
    const tierCells = document.querySelectorAll(".seqh-tier-cell");
    expect(tierCells[0].style.gridRow).toBe("2");
    expect(tierCells[1].style.gridRow).toBe("3");
  });

  it("renders column tags and column accents on node cards", () => {
    const container = document.getElementById("seq-root");
    SequenceUI.render(container, buildTable51Task());

    const cards = document.querySelectorAll(".seqh-node");
    expect(cards).toHaveLength(4);

    // Cards in column 0 (Pneumothorax)
    expect(cards[0].dataset.colIdx).toBe("0");
    expect(cards[1].dataset.colIdx).toBe("0");
    const tag0 = cards[0].querySelector(".seqh-node__col-tag");
    expect(tag0).not.toBeNull();
    expect(tag0.textContent).toContain("• I · Пневмоторакс");

    // Cards in column 1 (Atelectasis)
    expect(cards[2].dataset.colIdx).toBe("1");
    expect(cards[3].dataset.colIdx).toBe("1");
    const tag1 = cards[2].querySelector(".seqh-node__col-tag");
    expect(tag1).not.toBeNull();
    expect(tag1.textContent).toContain("• II · Обтурационный ателектаз");
  });

  it("draws vertical stems connecting column headers down to root cards", () => {
    const container = document.getElementById("seq-root");
    SequenceUI.render(container, buildTable51Task());

    const stems = document.querySelectorAll(".seqh-link--col-stem");
    expect(stems).toHaveLength(2);
    expect(stems[0].dataset.childId).toBe("node_p1");
    expect(stems[1].dataset.childId).toBe("node_a1");
  });

  it("serializes column_title in getUserAnswerPayload for backend evaluation matching", () => {
    const container = document.getElementById("seq-root");
    SequenceUI.render(container, buildTable51Task());
    const inst = instance();

    const payload = inst.getUserAnswerPayload();
    expect(payload.display_mode).toBe("hierarchy");
    expect(payload.nodes).toHaveLength(4);
    expect(payload.nodes[0].column_title).toBe("Пневмоторакс");
    expect(payload.nodes[1].column_title).toBe("Пневмоторакс");
    expect(payload.nodes[2].column_title).toBe("Обтурационный ателектаз");
    expect(payload.nodes[3].column_title).toBe("Обтурационный ателектаз");
  });
});
