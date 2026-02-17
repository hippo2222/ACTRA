import json
import subprocess
import sys
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
DESKTOP_APP_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(DESKTOP_APP_ROOT))

from services.task_evaluator_service import TaskEvaluatorService


MISTAKESUI_PAYLOAD_SCRIPT = r"""
const scenario = process.argv[1];
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

function makeTask(kind) {
  if (kind === 'text_choice') {
    return {
      task_type: 'click',
      task_data: {
        subtype: 'error_detection',
        content: {
          mode: 'text_choice',
          subtype: 'error_detection',
          options: [
            { id: 'opt-1', text: 'Wrong', is_correct: false },
            { id: 'opt-2', text: 'Correct', is_correct: true }
          ]
        }
      }
    };
  }

  return {
    task_type: 'click',
    task_data: {
      subtype: 'error_detection',
      content: {
        mode: 'text_errors',
        subtype: 'error_detection',
        text: 'alpha beta gamma',
        required_correct: 1,
        error_spans: [
          { start: 6, end: 10, is_correct: false }
        ]
      }
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

const mistakesCode = fs.readFileSync(
  path.join(process.cwd(), 'frontend', 'MistakesUI', 'MistakesUI.web.js'),
  'utf8'
);
window.eval(mistakesCode);

const MistakesUI = window.MistakesUI;
if (!MistakesUI) throw new Error('MistakesUI was not initialized');

const container = document.getElementById('app');
const taskDto = makeTask(scenario);
MistakesUI.render(container, taskDto);

if (scenario === 'text_choice') {
  const card = container.querySelector('.choice-card[data-option-id="opt-2"]');
  if (!card) throw new Error('Choice option not found');
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
} else {
  const word = container.querySelector('[data-index="1"]');
  if (!word) throw new Error('Error word not found');
  word.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
}

const payload = MistakesUI.getUserAnswerPayload();
console.log(JSON.stringify(payload));
"""


class TestMistakesUIEvaluatorContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        check = subprocess.run(
            ["node", "-e", "require.resolve('jsdom')"],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
            check=False,
        )
        if check.returncode != 0:
            raise unittest.SkipTest(
                "jsdom is not available for MistakesUI contract tests. Install frontend deps (npm ci)."
            )

    def setUp(self):
        self.service = TaskEvaluatorService()

    def _get_payload(self, scenario: str):
        cmd = ["node", "-e", MISTAKESUI_PAYLOAD_SCRIPT, scenario]
        proc = subprocess.run(
            cmd,
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
            check=False,
        )
        if proc.returncode != 0:
            raise AssertionError(
                f"MistakesUI payload script failed for {scenario}\nSTDOUT:\n{proc.stdout}\nSTDERR:\n{proc.stderr}"
            )
        lines = [line.strip() for line in proc.stdout.splitlines() if line.strip()]
        if not lines:
            raise AssertionError(f"MistakesUI payload script produced no output for {scenario}")
        return json.loads(lines[-1])

    def test_contract_text_errors_payload_to_evaluator(self):
        payload = self._get_payload("text_errors")
        self.assertEqual(payload.get("mode"), "text_errors")
        self.assertIn("selected_indices", payload)

        task_data = {
            "subtype": "error_detection",
            "content": {
                "mode": "text_errors",
                "subtype": "error_detection",
                "text": "alpha beta gamma",
                "required_correct": 1,
                "error_spans": [{"start": 6, "end": 10, "is_correct": False}],
            },
        }

        result = self.service.evaluate_click_task(payload, {}, task_data)

        self.assertTrue(result.success)
        self.assertEqual(result.details.get("mode"), "text_errors")
        self.assertEqual(result.details.get("selected_count"), 1)

    def test_contract_text_choice_payload_to_evaluator(self):
        payload = self._get_payload("text_choice")
        self.assertEqual(payload.get("mode"), "text_choice")
        self.assertEqual(payload.get("selected_option_id"), "opt-2")

        options = [
            {"id": "opt-1", "text": "Wrong", "is_correct": False},
            {"id": "opt-2", "text": "Correct", "is_correct": True},
        ]
        answer_key = {"options": options}
        task_data = {
            "subtype": "error_detection",
            "content": {
                "mode": "text_choice",
                "subtype": "error_detection",
                "options": options,
            },
        }

        result = self.service.evaluate_click_task(payload, answer_key, task_data)

        self.assertTrue(result.success)
        self.assertEqual(result.details.get("mode"), "text_choice")
        self.assertEqual(result.details.get("selected_option_id"), "opt-2")


if __name__ == "__main__":
    unittest.main()
