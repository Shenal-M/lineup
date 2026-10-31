import { test } from "node:test";
import assert from "node:assert/strict";
import { renderReminder } from "../src/email-template.ts";

test("reminder email shows the season, date precision and escapes title text", () => {
  const { subject, html, text } = renderReminder({
    notification: { kind: "day", date: "2026-11-10", medium: "streaming", service: "Prime Video" },
    title: { name: "Rings <Power> & Co", mediaType: "tv", year: 2022, poster: null },
    release: { season: 3, precision: "day" },
  });
  assert.equal(subject, "Coming tomorrow: Rings <Power> & Co");
  assert.ok(html.includes("Rings &#60;Power&#62; &#38; Co"));
  assert.ok(!html.includes("<Power>"));
  assert.ok(html.includes("Tuesday, November 10, 2026"));
  assert.ok(text.includes("Season 3 · Prime Video"));
  // No app URL, no button.
  assert.ok(!html.includes("Open Lineup"));
});

test("month-precision digital dates and unstored titles still read well", () => {
  const { subject, html } = renderReminder({
    notification: { kind: "announced", date: "2026-12-01", medium: "digital", titleName: "Hope" },
    release: { precision: "month" },
    appUrl: "https://lineup.example.com",
  });
  assert.equal(subject, "Date announced: Hope");
  assert.ok(html.includes("December 2026"));
  assert.ok(html.includes("Digital (rent or buy)"));
  assert.ok(html.includes('href="https://lineup.example.com"'));
});
