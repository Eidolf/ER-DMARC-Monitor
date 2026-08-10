import unittest
from unittest.mock import patch, MagicMock
import dns_utils

class TestDMARCParsing(unittest.TestCase):
    @patch('dns_utils.r_cache')
    @patch('dns_utils.query_txt')
    def test_single_dmarc_record(self, mock_query: MagicMock, mock_cache: MagicMock) -> None:
        mock_cache.get.return_value = None
        mock_query.return_value = ["v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com"]
        res = dns_utils.get_dmarc_record("example.com")
        self.assertEqual(res["status"], "Set")
        self.assertEqual(res["policy"], "quarantine")

    @patch('dns_utils.check_external_dmarc_authorization')
    @patch('dns_utils.r_cache')
    @patch('dns_utils.query_txt')
    def test_multiple_dmarc_records(self, mock_query: MagicMock, mock_cache: MagicMock, mock_check_auth: MagicMock) -> None:
        mock_cache.get.return_value = None
        mock_query.return_value = [
            "v=DMARC1; p=reject; rua=mailto:dmarc@external.org",
            "v=DMARC1; p=quarantine;"
        ]
        res = dns_utils.get_dmarc_record("example.com")
        self.assertEqual(res["status"], "Not Set")
        self.assertEqual(res["policy"], "none")
        self.assertEqual(len(res["records"]), 2)
        self.assertEqual(res["external_destinations"], [])
        mock_check_auth.assert_not_called()

    @patch('dns_utils.r_cache')
    @patch('dns_utils.query_txt')
    def test_valid_p_none_record(self, mock_query: MagicMock, mock_cache: MagicMock) -> None:
        mock_cache.get.return_value = None
        mock_query.return_value = ["v=DMARC1; p=none; rua=mailto:dmarc@example.com"]
        res = dns_utils.get_dmarc_record("example.com")
        self.assertEqual(res["status"], "Set")
        self.assertEqual(res["policy"], "none")

    @patch('dns_utils.r_cache')
    @patch('dns_utils.query_txt')
    def test_invalid_or_missing_p_tag(self, mock_query: MagicMock, mock_cache: MagicMock) -> None:
        mock_cache.get.return_value = None
        
        # Case 1: Invalid policy value
        mock_query.return_value = ["v=DMARC1; p=invalid_policy; rua=mailto:dmarc@example.com"]
        res = dns_utils.get_dmarc_record("example.com")
        self.assertEqual(res["status"], "Not Set")
        self.assertEqual(res["policy"], "none")

        # Case 2: Missing p tag
        mock_query.return_value = ["v=DMARC1; rua=mailto:dmarc@example.com"]
        res_missing = dns_utils.get_dmarc_record("example.com")
        self.assertEqual(res_missing["status"], "Not Set")
        self.assertEqual(res_missing["policy"], "none")

if __name__ == "__main__":
    unittest.main()
