# Participation and Debate ranking contract

Owner-authorised feature package, 19 October 2026. Both views use the existing authorised conference snapshot.
No schema, scoring award, outbox or permission change is required.

- Participation Quick entry ranks **conference-wide contribution counts**, highest first. Each non-voided
  participation-event id counts once, regardless of points (including zero-point contributions). Equal counts
  use country, delegate name and id; points never break a contribution tie.
- The automatic `submitter` credit is not a contribution: its associated scored speech already counts once.
  Point deductions/restores do not count. They remain separate adjustments in the original history.
- A Chair-recorded Amendment category event counts as one contribution. Speeches and POIs delivered during
  amendment debate count normally. Submitting, accepting, passing or failing an amendment creates no extra
  contribution by itself. Other manually recorded participation categories count once per event id.
- Separate POI events in the same speech remain separate contributions. Do not deduplicate by speech id.
- Participation keeps the existing focus/editor order freeze. Point values, manual scoring, deduction/restore
  controls and event history remain available. The top metrics explicitly describe the current session;
  Quick entry explicitly describes conference totals. No ranked CSV export currently exists in this app.
- Debate replaces the suggestions panel with a compact **conference-total points** list for every delegation
  in the current committee, including absent delegates and zero/negative totals. Totals remain non-voided event
  points plus signed adjustments/restores, across sessions. Sort points descending, then country/name/id.
- The Debate list shows flags, countries and numeric points only, with the scope in its heading. Its bounded
  scroll area contains all delegations; it is not a top-three list. Manual scoring stays in Participation.
