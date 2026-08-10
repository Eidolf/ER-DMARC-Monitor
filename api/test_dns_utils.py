import unittest
from unittest.mock import patch
import dns_utils

class TestDMARCParsing(unittest.TestCase):
    @patch('dns_utils.r_cache')
    @patch('dns_utils.query_txt')
    def test_single_dmarc_record(self, mock_query, mock_cache):
        mock_cache.get.return_value = None
        mock_query.return_value = ["v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com"]
        res = dns_utils.get_dmarc_record("example.com")
        self.assertEqual(res["status"], "Set")
        self.assertEqual(res["policy"], "quarantine")

    @patch('dns_utils.r_cache')
    @patch('dns_utils.query_txt')
    def test_multiple_dmarc_records(self, mock_query, mock_cache):
        mock_cache.get.return_value = None
        mock_query.return_value = [
            "v=DMARC1; p=reject;",
            "v=DMARC1; p=quarantine;"
        ]
        res = dns_utils.get_dmarc_record("example.com")
        self.assertEqual(res["status"], "Not Set")
        self.assertEqual(res["policy"], "none")
        self.assertEqual(len(res["records"]), 2)
        self.assertEqual(res["external_destinations"], [])

if __name__ == "__main__":
    unittest.main()
