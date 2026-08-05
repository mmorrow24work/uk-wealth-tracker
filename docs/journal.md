# Build Journal

Append-only log of each automated build-pipeline run, newest entries at the bottom. One entry per issue, added by the Claude Code session that implemented it, with a `<!-- METRICS:<slug> -->` block whose numbers are filled in afterward by the workflow from the run's actual duration/token usage.

Entry format. The Claude Code session that implements the issue writes everything **except** the six placeholder tokens below (`__DURATION__` etc.) verbatim — the pipeline's metrics-patch step replaces those tokens after the run finishes, since only it knows actual wall-clock duration and billed token usage:

```
## <Issue Title> — <YYYY-MM-DD>
<!-- METRICS:<slug> -->
- **Execution Duration:** __DURATION__ seconds
- **Model:** __MODEL__
- **Turns:** __TURNS__
- **Input Tokens:** __INPUT_TOKENS__
- **Output Tokens:** __OUTPUT_TOKENS__
- **Estimated Cost:** $__COST__

**Decisions:**
- ...

**Trade-offs / deviations from prompt:**
- ...
```
