import { expect } from "@playwright/test";

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function getTaskImageMetrics(imageLocator) {
  await expect(imageLocator).toBeVisible();
  await expect
    .poll(async () => {
      return imageLocator.evaluate((img) => ({
        complete: Boolean(img.complete),
        naturalWidth: Number(img.naturalWidth || 0),
        naturalHeight: Number(img.naturalHeight || 0),
      }));
    }, { timeout: 15000, intervals: [250, 500] })
    .toMatchObject({
      complete: true,
      naturalWidth: expect.any(Number),
      naturalHeight: expect.any(Number),
    });

  const box = await imageLocator.boundingBox();
  if (!box) {
    throw new Error("task_image_bounding_box_missing");
  }

  const metrics = await imageLocator.evaluate((img) => ({
    naturalWidth: Number(img.naturalWidth || 0),
    naturalHeight: Number(img.naturalHeight || 0),
  }));

  return {
    box,
    naturalWidth: metrics.naturalWidth || box.width,
    naturalHeight: metrics.naturalHeight || box.height,
  };
}

function toClientPoint(metrics, point) {
  const [x, y] = point;
  return {
    x: metrics.box.x + (Number(x) / metrics.naturalWidth) * metrics.box.width,
    y: metrics.box.y + (Number(y) / metrics.naturalHeight) * metrics.box.height,
  };
}

function polygonCentroid(points) {
  const safePoints = Array.isArray(points) ? points : [];
  if (!safePoints.length) {
    return [0, 0];
  }

  const total = safePoints.reduce(
    (acc, point) => {
      acc.x += Number(point?.[0] || 0);
      acc.y += Number(point?.[1] || 0);
      return acc;
    },
    { x: 0, y: 0 }
  );

  return [total.x / safePoints.length, total.y / safePoints.length];
}

export async function drawPointsOnTaskImage(page, points) {
  const image = page.locator("#task-content img").first();
  const metrics = await getTaskImageMetrics(image);
  const clientPoints = (Array.isArray(points) ? points : []).map((point) =>
    toClientPoint(metrics, point)
  );

  if (clientPoints.length < 3) {
    throw new Error("draw_happy_path_requires_three_points");
  }

  await page.evaluate((drawClientPoints) => {
    const target = document.querySelector("#task-content img");
    if (!target) {
      throw new Error("draw_target_image_missing");
    }

    const baseEvent = {
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      buttons: 1,
      bubbles: true,
      composed: true,
    };

    target.dispatchEvent(
      new PointerEvent("pointerdown", {
        ...baseEvent,
        clientX: drawClientPoints[0].x,
        clientY: drawClientPoints[0].y,
      })
    );

    for (let index = 1; index < drawClientPoints.length; index += 1) {
      window.dispatchEvent(
        new PointerEvent("pointermove", {
          ...baseEvent,
          clientX: drawClientPoints[index].x,
          clientY: drawClientPoints[index].y,
        })
      );
    }

    const lastPoint = drawClientPoints[drawClientPoints.length - 1];
    window.dispatchEvent(
      new PointerEvent("pointerup", {
        ...baseEvent,
        buttons: 0,
        clientX: lastPoint.x,
        clientY: lastPoint.y,
      })
    );
  }, clientPoints);
}

async function fillTextInputs(page, selector, values) {
  const safeValues = Array.isArray(values) ? values : [];
  const inputs = page.locator(selector);
  await expect(inputs.first()).toBeVisible();
  const count = await inputs.count();
  if (count < safeValues.length) {
    throw new Error(`insufficient_text_inputs:${count}:${safeValues.length}`);
  }
  for (let index = 0; index < safeValues.length; index += 1) {
    await inputs.nth(index).fill(String(safeValues[index] || ""));
  }
}

async function fillFirstAvailableTextInputs(page, selectors, values) {
  for (const selector of selectors) {
    const inputs = page.locator(selector);
    if ((await inputs.count()) > 0) {
      await fillTextInputs(page, selector, values);
      return;
    }
  }
  throw new Error(`text_inputs_not_found:${selectors.join(",")}`);
}

async function clickButtonByName(page, pattern) {
  const button = page.getByRole("button", { name: pattern }).first();
  await expect(button).toBeVisible();
  await button.click();
}

async function createUserSequenceLevel(page) {
  const createButton = page
    .getByRole("button", {
      name: /(\u0421\u043e\u0437\u0434\u0430\u0442\u044c \u0443\u0440\u043e\u0432\u0435\u043d\u044c|\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u0443\u0440\u043e\u0432\u0435\u043d\u044c)/i,
    })
    .first();
  await expect(createButton).toBeVisible();
  await createButton.click();
}

async function addSequenceSlot(page) {
  await clickButtonByName(page, /\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u0441\u043b\u043e\u0442 \u0432 \u0443\u0440\u043e\u0432\u0435\u043d\u044c/i);
}

async function placeSequenceElement(page, elementText) {
  await clickButtonByName(page, new RegExp(escapeRegExp(elementText), "i"));
  await clickButtonByName(page, /\u0420\u0430\u0437\u043c\u0435\u0441\u0442\u0438\u0442\u044c \u0432\u044b\u0431\u0440\u0430\u043d\u043d\u044b\u0439 \u044d\u043b\u0435\u043c\u0435\u043d\u0442/i);
}

export async function answerClickTask(page, task) {
  const image = page.locator("#task-content img").first();
  const metrics = await getTaskImageMetrics(image);
  const centroid = polygonCentroid(task.interaction.points);
  const clientPoint = toClientPoint(metrics, centroid);

  await page.mouse.click(clientPoint.x, clientPoint.y);

  if (Array.isArray(task.interaction.labelsClicks) && task.interaction.labelsClicks.length) {
    await fillTextInputs(page, ".clickui-card-entry input[type=\"text\"]", task.interaction.labelsClicks);
  }
}

export async function answerDrawTask(page, task, fixtureTaskType = "draw") {
  await drawPointsOnTaskImage(page, task.interaction.points);

  if (Array.isArray(task.interaction.labelsPolygons) && task.interaction.labelsPolygons.length) {
    const preferredSelectors = fixtureTaskType === "draw"
      ? [
          ".drawui-card-entry input[type=\"text\"]",
          ".clickui-card-entry input[type=\"text\"]",
        ]
      : [
          ".clickui-card-entry input[type=\"text\"]",
          ".drawui-card-entry input[type=\"text\"]",
        ];
    await fillFirstAvailableTextInputs(page, preferredSelectors, task.interaction.labelsPolygons);
  }
}

export async function answerSequenceTask(page, task) {
  const interaction = task.interaction || {};

  if (interaction.kind === "sequence_l2") {
    const level = Array.isArray(interaction.levels) ? interaction.levels[0] : null;
    if (!level) {
      throw new Error("sequence_l2_missing_level");
    }

    await createUserSequenceLevel(page);
    await fillTextInputs(page, "#task-content input[type=\"text\"]", [level.levelName]);

    const blocks = Array.isArray(level.blocks) ? level.blocks : [];
    for (let index = 0; index < blocks.length; index += 1) {
      if (index > 0) {
        await addSequenceSlot(page);
      }
      await placeSequenceElement(page, blocks[index]);
    }
    return;
  }

  if (interaction.kind === "sequence_l3") {
    const level = Array.isArray(interaction.levels) ? interaction.levels[0] : null;
    if (!level) {
      throw new Error("sequence_l3_missing_level");
    }

    const blockNames = Array.isArray(level.blockNames) ? level.blockNames : [];
    await createUserSequenceLevel(page);
    for (let index = 1; index < blockNames.length; index += 1) {
      await addSequenceSlot(page);
    }
    await fillTextInputs(page, "#task-content input[type=\"text\"]", [level.levelName, ...blockNames]);
    return;
  }

  for (const placement of interaction.placements || []) {
    await clickButtonByName(page, new RegExp(escapeRegExp(placement.elementText), "i"));
    await clickButtonByName(page, /\u0420\u0430\u0437\u043c\u0435\u0441\u0442\u0438\u0442\u044c \u0432\u044b\u0431\u0440\u0430\u043d\u043d\u044b\u0439 \u044d\u043b\u0435\u043c\u0435\u043d\u0442/i);
  }
}

export async function answerOpenAnswerTask(page, task) {
  const textarea = page.locator("#task-content textarea, #task-content .oa-answer-input").first();
  await expect(textarea).toBeVisible();
  await textarea.fill(task.interaction.answerText);
}

export async function answerTestTask(page, task) {
  const input = page.locator('#task-content textarea, #task-content input[type="text"]').first();
  await expect(input).toBeVisible();
  await input.fill(task.interaction.answerText);
}

export async function answerMistakesTask(page, task) {
  const interaction = task?.interaction || {};

  if (interaction.kind === "mistakes_text_errors") {
    const word = page.locator(`#task-content [data-index="${Number(interaction.wordIndex || 0)}"]`).first();
    await expect(word).toBeVisible();
    await word.click();
    return;
  }

  if (interaction.kind === "mistakes_text_choice") {
    const optionId = String(interaction.selectedOptionId || "").trim();
    const card = optionId
      ? page.locator(`#task-content .choice-card[data-option-id="${optionId}"]`).first()
      : page.locator("#task-content .choice-card").first();
    await expect(card).toBeVisible();
    await card.click();
    return;
  }

  throw new Error(`unsupported_mistakes_action:${interaction.kind || "unknown"}`);
}

export async function performTaskPartialAction(page, fixture, mode = "omit_labels") {
  const task = Array.isArray(fixture.tasks) ? fixture.tasks[0] : null;
  if (!task) {
    throw new Error("fixture_missing_task");
  }

  if (mode === "omit_labels") {
    if (fixture.taskType === "click") {
      if (task.interaction.kind === "draw_and_label") {
        await drawPointsOnTaskImage(page, task.interaction.points);
        return;
      }
      if (task.interaction.kind === "click_and_label") {
        const image = page.locator("#task-content img").first();
        const metrics = await getTaskImageMetrics(image);
        const centroid = polygonCentroid(task.interaction.points);
        const clientPoint = toClientPoint(metrics, centroid);
        await page.mouse.click(clientPoint.x, clientPoint.y);
        return;
      }
    }

    if (fixture.taskType === "draw" && task.interaction.kind === "draw_and_label") {
      await drawPointsOnTaskImage(page, task.interaction.points);
      return;
    }
  }

  throw new Error(`unsupported_partial_action:${fixture.taskType}:${task.interaction?.kind || "unknown"}:${mode}`);
}

export async function performTaskHappyPath(page, fixture) {
  const task = Array.isArray(fixture.tasks) ? fixture.tasks[0] : null;
  if (!task) {
    throw new Error("fixture_missing_task");
  }

  if (fixture.taskSubtype === "error_detection") {
    await answerMistakesTask(page, task);
    return;
  }

  if (fixture.taskType === "click") {
    if (task.interaction.kind === "draw_and_label") {
      await answerDrawTask(page, task, fixture.taskType);
      return;
    }
    await answerClickTask(page, task);
    return;
  }

  if (fixture.taskType === "draw") {
    await answerDrawTask(page, task, fixture.taskType);
    return;
  }

  if (fixture.taskType === "test") {
    await answerTestTask(page, task);
    return;
  }

  if (fixture.taskType === "sequence_assembly") {
    await answerSequenceTask(page, task);
    return;
  }

  if (fixture.taskType === "open_answer") {
    await answerOpenAnswerTask(page, task);
    return;
  }

  throw new Error(`unsupported_task_happy_path:${fixture.taskType}`);
}
