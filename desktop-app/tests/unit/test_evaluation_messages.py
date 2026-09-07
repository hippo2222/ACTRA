import unittest
from services.evaluation_messages import MESSAGES, get_message


class TestEvaluationMessages(unittest.TestCase):
    def test_click_fail_threshold_and_partial_keys(self):
        msg_threshold = get_message(
            "click_fail_threshold",
            found_count=5,
            required_correct=6,
            total_count=7
        )
        msg_partial = get_message(
            "click_fail_partial",
            found_count=5,
            required_correct=6,
            total_count=7
        )

        expected = "❌ Вы нашли 5 из 6 требуемых аннотаций (всего 7). Попробуйте еще раз!"
        self.assertEqual(msg_threshold, expected)
        self.assertEqual(msg_partial, expected)

    def test_click_success_partial_and_threshold_keys(self):
        msg1 = get_message(
            "click_success_partial_threshold",
            found_count=6,
            required_correct=6,
            total_count=7
        )
        msg2 = get_message(
            "click_success_partial",
            found_count=6,
            required_correct=6,
            total_count=7
        )
        msg3 = get_message(
            "click_success_threshold",
            found_count=6,
            required_correct=6,
            total_count=7
        )

        expected = "✅ Правильно! Вы правильно указали на 6 из 6 требуемых аннотаций (всего 7)"
        self.assertEqual(msg1, expected)
        self.assertEqual(msg2, expected)
        self.assertEqual(msg3, expected)

    def test_missing_key_fallback_and_warning(self):
        with self.assertLogs("services.evaluation_messages", level="WARNING") as cm:
            result = get_message("unknown_key_123")
            self.assertEqual(result, "unknown_key_123")
            self.assertTrue(any("unknown_key_123" in log for log in cm.output))

    def test_format_error_fallback(self):
        with self.assertLogs("services.evaluation_messages", level="WARNING") as cm:
            # Passing wrong or incomplete arguments to a key that requires arguments
            result = get_message("click_fail_threshold")  # missing found_count, required_correct, total_count
            self.assertEqual(result, MESSAGES["click_fail_threshold"])
            self.assertTrue(any("Failed to format" in log for log in cm.output))
