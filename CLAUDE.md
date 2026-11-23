# Claude Code notes for this repo

README.md maps the project: where each kind of code lives, how to run it
locally and how it deploys.

## Running locally

```sh
npm start        # http://localhost:8000 (serves the static files)
npm test         # node --test, a few seconds
```

`.claude/launch.json` starts the same server for the Claude desktop app's
preview.

## Shipping changes

Unless the user says otherwise, finish every change by opening a pull request
into `main` and merging it yourself -- don't stop at a pushed branch.

1. Run the tests locally (`npm test`) before pushing.
2. Push the working branch and open a PR into `main`.
3. Wait for the PR's CI (the `CI` workflow's test job) to pass. Fix and
   re-push on failure; never merge red.
4. Merge the PR (squash).

Merging to `main` deploys to production automatically (Vercel's Git
integration), so a merge is a release. Vercel does not wait for CI, which is
why step 3 matters.

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues (TheOneRichy/PuttingPractice). See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical labels, used as-is: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` plus `docs/adr/` at the repo root. See `docs/agents/domain.md`.
