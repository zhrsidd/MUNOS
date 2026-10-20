# Clear-majority For / Against — Claude implementation brief

Retained owner request, 20 October 2026. **Pending implementation.** This is a general voting convenience;
existing committee procedures and veto rules remain authoritative.

## Required behavior

- Add compact **Clear majority For** and **Clear majority Against** actions for an obvious observed result,
  avoiding a click on each country's ballot. Confirm the resolution, voting method and result before saving.
- Record the method as **observed majority**, with the Chair's declared result, actor and time. Individual
  country choices and exact For/Against/Abstain totals stay **not recorded**. Never invent named votes, fill
  all delegates with one choice, label unknown counts as zero, or claim every delegation voted.
- Preserve per-country counted voting and Divide the House. A shortcut must not bypass a required named
  roll call, the Present & Voting abstention rule, or a configured two-thirds threshold. Initial proposed
  scope is normal simple-majority voting; review other rules separately before enabling shortcuts there.
- Preserve existing veto checks. Missing named ballots do not establish that no veto was raised. Specify a
  truthful way to capture the information required by the current rule; use counted voting where the shortcut
  cannot establish a valid result. Do not introduce a new veto-discussion or override procedure in this task.
- Keep earlier recorded ballots/history. Switching recording methods needs explicit confirmation and a
  distinguishable new attempt or audited supersession, never silent deletion or alteration of named choices.
- Persist through the existing durable outbox and server-validated commands. Do not ship working-looking
  buttons that only change local UI state. Review schema/contract changes independently and replay on staging.

## Acceptance checks

Both majority directions work in an eligible normal vote and remain honest after reload, offline/reconnect and
history display. No country choices or counts are manufactured. Existing counted arithmetic, abstention,
Divide the House and veto tests continue to pass. Duplicate submissions, concurrent Chairs, stale ballots,
revoked grants and other-committee commands cannot alter or finalise the wrong ballot. Follow the normal
review, automated and browser checks, and state any staging limitations.
