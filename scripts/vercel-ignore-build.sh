#!/usr/bin/env bash
# Vercel "Ignored Build Step" (configured in vercel.json as ignoreCommand).
# Exit 0 = skip this build. Exit 1 = build normally.
#
# Production freeze: set CONFERENCE_FREEZE=1 on the Production environment in
# Vercel. Normal merges to main then stop deploying to production. Only a commit
# whose message contains [emergency] (e.g. a squash-merged PR titled
# "[emergency] fix ...") is built. Previews are never affected.
if [ "$VERCEL_ENV" = "production" ] && [ "$CONFERENCE_FREEZE" = "1" ]; then
  if printf '%s' "$VERCEL_GIT_COMMIT_MESSAGE" | grep -q '\[emergency\]'; then
    echo "Production freeze is active. [emergency] commit: building."
    exit 1
  fi
  echo "Production freeze is active. Build skipped. Use an [emergency] PR for conference-blocking fixes only."
  exit 0
fi
exit 1
