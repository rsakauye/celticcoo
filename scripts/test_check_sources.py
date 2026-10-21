#!/usr/bin/env python3
"""Fixture checks for the weekly source checker. Standard library only.

    python3 scripts/test_check_sources.py
"""
import datetime as dt
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import check_sources as cs

TODAY = dt.date(2026, 10, 21)
NOW = "2026-10-21T14:00:00Z"
PAD = "<p>" + ("Schedule notes. " * 30) + "</p>"


def page(html, status=200):
    text = cs.visible_text(html)
    if status == 200 and len(text) <= 200:
        html = html + PAD
        text = cs.visible_text(html)
    return {"status": status, "text": text, "html": html}


def trusted(dates, status=200, events=None):
    return {
        "status": status,
        "dates": dates,
        "sha256": "abc123",
        "length": 500,
        "events": events or {},
        "labels": [],
    }


class DateParsing(unittest.TestCase):
    def test_en_dash_range_counts_as_the_start_day(self):
        text = "The Royal Edinburgh Military Tattoo 6 – 28 August 2027"
        self.assertTrue(cs.date_on_page("2027-08-06", text))
        self.assertTrue(cs.date_on_page("2027-08-28", text))
        self.assertFalse(cs.date_on_page("2027-08-07", text))
        self.assertIn("aug 6-28 2027", cs.date_mentions(text))

    def test_html_en_dash_and_other_range_spellings(self):
        html = "<p>This show runs from 6 &#x2013; 28 August 2027.</p>"
        text = cs.visible_text(html)
        self.assertTrue(cs.date_on_page("2027-08-06", text))
        self.assertIn("aug 6-28 2027", cs.date_mentions(text))
        for sample in (
            "6 - 28 August 2027",
            "6–28 August 2027",
            "6th – 28th August 2027",
            "Sunday 1 to Sunday 8 August 2027",
        ):
            self.assertTrue(cs.date_on_page("2027-08-06" if "6" in sample[:3] else "2027-08-01", sample), sample)
        self.assertTrue(cs.date_on_page("2027-08-01", "return to Belfast from Sunday 1 to Sunday 8 August 2027"))
        self.assertFalse(cs.date_on_page("2027-08-02", "Sunday 1 to Sunday 8 August 2027"))

    def test_ordinary_dates_still_match(self):
        self.assertTrue(cs.date_on_page("2027-07-13", "July 13-17, 2027 / Ice Palace, Edmonton"))
        self.assertTrue(cs.date_on_page("2027-06-05", "June 5, 2027"))
        self.assertIn("jul 30-31 2027", cs.date_mentions("Games on July 30-31, 2027."))
        self.assertIn("jun 5 2027", cs.date_mentions("June 5, 2027"))

    def test_year_in_its_own_element_still_counts(self):
        html = "<p>July 4-11th<span>2027</span></p><div class='topbar'>October 21, 2026</div>"
        mentions = cs.page_dates(html)
        self.assertIn("jul 4-11 2027", mentions)
        self.assertNotIn("oct 21 2026", mentions)

    def test_a_huge_wrapper_is_not_treated_as_a_date_widget(self):
        html = "<div class='t-entry'><p>June 5, 2027. " + ("Notes about the games. " * 300) + "</p></div>"
        self.assertIn("jun 5 2027", cs.page_dates(html))


class NoiseDates(unittest.TestCase):
    def test_page_blog_and_past_dates_are_not_flagged(self):
        html = """
        <header><div class="topbar"><div class="header-bottom">
          <i class="date-time"></i> October 21, 2026
        </div></div></header>
        <main>
          <p>Updated Dec 1, 2026</p>
          <h1>Competition Schedule for 2026-2027</h1>
          <p>Portland Highland Games, June 5, 2027</p>
          <p>A post on Wednesday, July 15, 2020 said save the date.</p>
          <div class="t-entry">
            <h3>2025 Gig tickets on sale on 30 April</h3>
            <p class="t-entry-meta"><span class="t-entry-date">April 25, 2025</span></p>
            <span class="t-entry-date">August 27, 2026</span>
            <span class="t-entry-date">November 2, 2026</span>
          </div>
          <div class="related-wrap"><div class="related-post">
            <div class="tag_date">October 17, 2026</div>
            <div class="tag_date">November 20, 2026</div>
          </div></div>
          <p>New gathering on September 4, 2027.</p>
        </main>
        """
        url = "https://example.test/schedule"
        mentions = cs.page_dates(page(html)["html"])
        self.assertIn("jun 5 2027", mentions)
        self.assertIn("sep 4 2027", mentions)
        self.assertIn("jul 15 2020", mentions)
        for noise in ("oct 21 2026", "dec 1 2026", "apr 30", "apr 25 2025", "aug 27 2026", "nov 2 2026", "oct 17 2026", "nov 20 2026"):
            self.assertNotIn(noise, mentions, noise)

        old = {"pages": {url: trusted(["jun 5 2027"])}}
        checked = cs.run_check({url: {"labels": ["Example"], "events": []}}, {url: page(html)}, old, TODAY, NOW)
        msgs = " ".join(m for _, _, ms in checked["significant"] for m in ms)
        self.assertIn("added sep 4 2027", msgs)
        for noise in ("oct 21", "dec 1", "apr 30", "apr 25", "aug 27", "nov 2", "oct 17", "nov 20", "jul 15", "2020", "2025"):
            self.assertNotIn(noise, msgs, noise)

    def test_moved_future_date_is_still_flagged(self):
        url = "https://example.test/games"
        html = "<p>The games are now August 8, 2027.</p>"
        old = {"pages": {url: trusted(["aug 1 2027"])}}
        checked = cs.run_check({url: {"labels": ["Games"], "events": []}}, {url: page(html)}, old, TODAY, NOW)
        msgs = checked["significant"][0][2]
        self.assertEqual(msgs, ["dates on page changed: added aug 8 2027; removed aug 1 2027"])

    def test_genuine_empty_page_then_a_date_is_flagged(self):
        url = "https://example.test/empty"
        old = {"pages": {url: trusted([])}}
        checked = cs.run_check(
            {url: {"labels": [], "events": []}},
            {url: page("<p>First announced June 12, 2027.</p>")},
            old, TODAY, NOW,
        )
        self.assertIn("added jun 12 2027", checked["significant"][0][2][0])


class FailedFetch(unittest.TestCase):
    def test_empty_dates_from_a_failed_read_are_not_a_baseline(self):
        url = "https://example.test/captcha"
        html = "<p>June 5, 2027 and September 4, 2027 are on the schedule.</p>"
        # HTTP 202 captcha, or a 500, previously stored as an empty date list with no page hash.
        for status in (202, 500):
            old = {"pages": {url: {"status": status, "dates": [], "events": {}, "labels": []}}}
            checked = cs.run_check({url: {"labels": ["Captured"], "events": []}}, {url: page(html)}, old, TODAY, NOW)
            self.assertEqual(checked["significant"], [], status)
            saved = checked["state"]["pages"][url]
            self.assertEqual(saved["dates_basis"], "ok")
            self.assertIn("jun 5 2027", saved["dates"])
            self.assertIn("sep 4 2027", saved["dates"])

    def test_failed_read_does_not_wipe_dates_and_is_reported(self):
        url = "https://scotfestbc.com/"
        prev = trusted(["jun 18-19 2027"])
        old = {"pages": {url: prev}}
        failed = {"status": 500, "text": "", "html": "<p>June 1, 2027 captcha should not be stored.</p>"}
        checked = cs.run_check({url: {"labels": [], "events": []}}, {url: failed}, old, TODAY, NOW)
        saved = checked["state"]["pages"][url]
        self.assertEqual(saved["dates"], ["jun 18-19 2027"])
        self.assertEqual(saved["dates_basis"], "carried")
        self.assertEqual(saved["status"], 500)
        self.assertEqual(checked["significant"], [])
        self.assertIn(f"- {url}: `500`", checked["report"])
        self.assertIn("Pages that didn't load this run", checked["report"])

        # The carried dates stay the baseline, so a real addition on the next good read is flagged.
        nxt = cs.run_check(
            {url: {"labels": [], "events": []}},
            {url: page("<p>June 18-19, 2027 and October 10, 2027.</p>")},
            checked["state"], TODAY, NOW,
        )
        self.assertIn("added oct 10 2027", nxt["significant"][0][2][0])
        self.assertNotIn("jun 18", nxt["significant"][0][2][0])

    def test_legacy_failed_snapshot_with_a_saved_hash_still_diffs(self):
        url = "https://example.test/kept"
        old = {"pages": {url: trusted(["jun 5 2027"], status=500)}}
        checked = cs.run_check(
            {url: {"labels": [], "events": []}},
            {url: page("<p>June 5, 2027 and July 4, 2027.</p>")},
            old, TODAY, NOW,
        )
        self.assertIn("added jul 4 2027", checked["significant"][0][2][0])

    def test_http_202_body_is_not_stored_as_the_page_dates(self):
        url = "https://example.test/interstitial"
        old = {"updated_at": NOW, "pages": {url: {"status": 200, "dates": ["jun 5 2027"], "sha256": "abc", "length": 400, "events": {}, "labels": []}}}
        # dates_basis inferred as ok from the hash. A 202 must not replace those dates with the interstitial.
        fetched = {"status": 202, "text": "Checking your browser " * 30, "html": "<p>Added August 2, 2027</p>" + PAD}
        checked = cs.run_check({url: {"labels": [], "events": []}}, {url: fetched}, old, TODAY, NOW)
        saved = checked["state"]["pages"][url]
        self.assertEqual(saved["dates"], ["jun 5 2027"])
        self.assertEqual(saved["status"], 202)
        self.assertEqual(checked["significant"], [])
        self.assertIn("`202`", checked["report"])


class StartDateVisibility(unittest.TestCase):
    def test_tattoo_range_is_not_listed_as_missing(self):
        url = "https://www.edintattoo.co.uk/tickets/tattoo-2027"
        html = "<p class='header-date'>The Royal Edinburgh Military Tattoo 6 - 28 August 2027</p><p>runs from 6 &#x2013; 28 August 2027.</p>"
        targets = {url: {"labels": [], "events": [{"name": "Royal Edinburgh Military Tattoo", "start_date": "2027-08-06", "confirmed": True}]}}
        checked = cs.run_check(targets, {url: page(html)}, {"pages": {}}, TODAY, NOW)
        self.assertEqual(checked["unconfirmed"], [])
        self.assertTrue(checked["state"]["pages"][url]["events"]["Royal Edinburgh Military Tattoo"])

    def test_missing_start_date_is_still_reported(self):
        url = "https://example.test/fleadh"
        html = "<p>See you Sunday 8 August 2027.</p>"
        targets = {url: {"labels": [], "events": [{"name": "Fleadh", "start_date": "2027-08-01", "confirmed": True}]}}
        old = {"pages": {url: trusted([], events={"Fleadh": True})}}
        checked = cs.run_check(targets, {url: page(html)}, old, TODAY, NOW)
        self.assertEqual(checked["unconfirmed"], [("Fleadh", url)])
        self.assertTrue(any("no longer found" in m for _, _, ms in checked["significant"] for m in ms))


class ReportShape(unittest.TestCase):
    def test_headers_stay_the_same(self):
        url = "https://example.test/gone"
        old = {"pages": {url: trusted(["jun 5 2027"])}}
        checked = cs.run_check({url: {"labels": ["Gone"], "events": []}}, {url: {"status": 404, "text": ""}}, old, TODAY, NOW)
        self.assertTrue(checked["report"].startswith(f"# Weekly source check ({NOW})"))
        self.assertIn("## Review before publishing", checked["report"])
        self.assertIn("page now returns `404`", checked["report"])
        self.assertIn("Pages that didn't load this run", checked["report"])
        self.assertIn("`404`", checked["report"])


if __name__ == "__main__":
    unittest.main()
