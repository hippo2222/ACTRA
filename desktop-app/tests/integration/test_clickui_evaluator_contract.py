import json
import subprocess
import sys
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
DESKTOP_APP_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(DESKTOP_APP_ROOT))

from services.task_evaluator_service import EvaluationResult, TaskEvaluatorService


CLICKUI_PAYLOAD_SCRIPT = r"""
const scenario = process.argv[1];
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

function makeTask(level) {
  if (level === 'l3') {
    return {
      task_type: 'click',
      task_data: {
        content: {
          requires_labels: true,
          requires_drawing: true
        }
      },
      content: {
        requires_labels: true,
        requires_drawing: true
      },
      answer_key: {
        targets: [
          {
            shape: 'polygon',
            points: [[100, 100], [300, 100], [300, 300], [100, 300]],
            label: 'Liver'
          },
          {
            shape: 'freehand',
            type: 'freehand',
            points: [[600, 600], [800, 800]],
            label: 'Aorta'
          }
        ]
      }
    };
  }

  const requiresLabels = level === 'l2';
  return {
    task_type: 'click',
    task_data: {
      content: {
        requires_labels: requiresLabels,
        requires_drawing: false
      }
    },
    content: {
      requires_labels: requiresLabels,
      requires_drawing: false
    },
    answer_key: {
      targets: [
        {
          shape: 'polygon',
          points: [[100, 100], [300, 100], [300, 300], [100, 300]],
          label: 'Liver'
        }
      ]
    }
  };
}

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
  url: 'http://localhost',
  pretendToBeVisual: true,
  runScripts: 'dangerously'
});

const { window } = dom;
const { document } = window;

global.window = window;
global.document = document;
global.navigator = window.navigator;
global.Blob = window.Blob;
global.fetch = () => Promise.resolve({ ok: true, json: async () => ({}) });
window.fetch = global.fetch;
window.navigator.sendBeacon = () => true;
window.TaskMetadataPanel = {
  create: () => ({ rootEl: document.createElement('div'), api: {} }),
};
global.TaskMetadataPanel = window.TaskMetadataPanel;

const clickUiCode = fs.readFileSync(
  path.join(process.cwd(), 'frontend', 'ClickUI', 'ClickUI.web.js'),
  'utf8'
);
window.eval(clickUiCode);

const ClickUI = window.ClickUI;
if (!ClickUI) throw new Error('ClickUI was not initialized');

const container = document.getElementById('app');
const taskDto = makeTask(scenario);
ClickUI.render(container, taskDto, { runtimeMode: true });

const img = container.querySelector('img');
if (!img) throw new Error('Image element not found');

Object.defineProperty(img, 'naturalWidth', { configurable: true, value: 1000 });
Object.defineProperty(img, 'naturalHeight', { configurable: true, value: 1000 });
img.getBoundingClientRect = () => ({
  left: 0,
  top: 0,
  right: 1000,
  bottom: 1000,
  width: 1000,
  height: 1000,
});

const viewport = img.parentElement && img.parentElement.parentElement;
if (!viewport) throw new Error('Viewport element not found');
viewport.getBoundingClientRect = () => ({
  left: 0,
  top: 0,
  right: 1000,
  bottom: 1000,
  width: 1000,
  height: 1000,
});

function clickAt(x, y) {
  const ev = new window.MouseEvent('click', { bubbles: true, clientX: x, clientY: y });
  viewport.dispatchEvent(ev);
}

function pointer(type, target, x, y) {
  let ev;
  if (typeof window.PointerEvent === 'function') {
    ev = new window.PointerEvent(type, { bubbles: true, clientX: x, clientY: y });
  } else {
    ev = new window.MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
  }
  target.dispatchEvent(ev);
}

function setInputValue(id, value) {
  const input = container.querySelector('#' + id);
  if (!input) throw new Error('Input not found: ' + id);
  input.value = value;
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
}

if (scenario === 'l1' || scenario === 'l2') {
  clickAt(150, 150);
  if (scenario === 'l2') {
    setInputValue('clickui-click-1', 'Liver');
  }
}

if (scenario === 'l3') {
  const brushBtn = container.querySelector('button[data-icon="edit"]');
  if (!brushBtn) throw new Error('Brush mode button not found');
  brushBtn.click();

  pointer('pointerdown', viewport, 110, 110);
  pointer('pointermove', window, 290, 110);
  pointer('pointermove', window, 290, 290);
  pointer('pointermove', window, 112, 112);
  pointer('pointerup', window, 112, 112);

  pointer('pointerdown', viewport, 600, 600);
  pointer('pointermove', window, 700, 700);
  pointer('pointermove', window, 800, 800);
  pointer('pointerup', window, 800, 800);

  setInputValue('clickui-polygon-1', 'Liver');
  setInputValue('clickui-line-1', 'Aorta');
}

const payload = ClickUI.getUserAnswerPayload();
console.log(JSON.stringify(payload));
"""


class TestClickUIEvaluatorContract(unittest.TestCase):
    def setUp(self):
        self.service = TaskEvaluatorService()

    def _get_clickui_payload(self, scenario: str):
        cmd = ["node", "-e", CLICKUI_PAYLOAD_SCRIPT, scenario]
        proc = subprocess.run(
            cmd,
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
            check=False,
        )
        if proc.returncode != 0:
            raise AssertionError(
                f"ClickUI payload script failed for {scenario}\nSTDOUT:\n{proc.stdout}\nSTDERR:\n{proc.stderr}"
            )
        lines = [line.strip() for line in proc.stdout.splitlines() if line.strip()]
        if not lines:
            raise AssertionError(f"ClickUI payload script produced no output for {scenario}")
        return json.loads(lines[-1])

    def test_contract_l1_clickui_payload_to_evaluator(self):
        payload = self._get_clickui_payload("l1")
        answer_key = {
            "targets": [
                {
                    "shape": "polygon",
                    "points": [[100, 100], [300, 100], [300, 300], [100, 300]],
                    "label": "Liver",
                }
            ]
        }
        task_data = {"content": {"requires_labels": False, "requires_drawing": False}}

        result = self.service.evaluate_click_task(payload, answer_key, task_data)

        self.assertTrue(result.success)
        self.assertEqual(result.details.get("level"), 1)
        self.assertIn("clicks", payload)

    def test_contract_l2_clickui_labels_clicks_to_evaluator(self):
        payload = self._get_clickui_payload("l2")
        answer_key = {
            "targets": [
                {
                    "shape": "polygon",
                    "points": [[100, 100], [300, 100], [300, 300], [100, 300]],
                    "label": "Liver",
                }
            ]
        }
        task_data = {"content": {"requires_labels": True, "requires_drawing": False}}

        result = self.service.evaluate_click_task(payload, answer_key, task_data)

        self.assertIn("labels_clicks", payload)
        self.assertNotIn("labels", payload)
        self.assertTrue(result.success)
        self.assertEqual(result.details.get("level"), 2)
        self.assertTrue(result.details.get("labels", {}).get("success"))

    def test_contract_l3_clickui_payload_to_evaluator(self):
        payload = self._get_clickui_payload("l3")
        answer_key = {
            "targets": [
                {
                    "shape": "polygon",
                    "points": [[100, 100], [300, 100], [300, 300], [100, 300]],
                    "label": "Liver",
                },
                {
                    "shape": "freehand",
                    "type": "freehand",
                    "points": [[600, 600], [800, 800]],
                    "label": "Aorta",
                },
            ]
        }
        task_data = {"content": {"requires_labels": True, "requires_drawing": True}}

        result = self.service.evaluate_click_task(payload, answer_key, task_data)

        self.assertIn("polygons", payload)
        self.assertIn("lines", payload)
        self.assertIn("labels_polygons", payload)
        self.assertIn("labels_lines", payload)
        self.assertEqual(result.details.get("level"), 3)
        self.assertIn("drawing", result.details)
        self.assertIn("labels", result.details)

    def test_click_idx_regression_for_freehand_in_multiple_clicks(self):
        user_input = {
            "clicks": [
                {"x": 700, "y": 700, "scale_factor": 1.0, "offset_x": 0.0, "offset_y": 0.0}
            ],
            "found_targets": [],
            "total_targets": 1,
        }
        answer_key = {
            "targets": [
                {
                    "shape": "freehand",
                    "type": "freehand",
                    "points": [[650, 650], [750, 750]],
                    "label": "Aorta",
                }
            ]
        }
        task_data = {"content": {"requires_labels": False, "requires_drawing": False}}

        result = self.service.evaluate_click_task(user_input, answer_key, task_data)

        self.assertIsInstance(result, EvaluationResult)
        self.assertIn("level", result.details)

    def test_l3_has_default_message_when_labels_not_required(self):
        payload = self._get_clickui_payload("l3")
        answer_key = {
            "targets": [
                {
                    "shape": "polygon",
                    "points": [[100, 100], [300, 100], [300, 300], [100, 300]],
                    "label": "Liver",
                },
                {
                    "shape": "freehand",
                    "type": "freehand",
                    "points": [[600, 600], [800, 800]],
                    "label": "Aorta",
                },
            ]
        }
        task_data = {"content": {"requires_labels": False, "requires_drawing": True}}

        result = self.service.evaluate_click_task(payload, answer_key, task_data)

        self.assertIsInstance(result.message, str)
        self.assertTrue(result.message.strip())
        self.assertIn("Contours:", result.message)


if __name__ == "__main__":
    unittest.main()
