"""Auto-resolve a docs/journal.md-only merge conflict.

Used by claude-build.yml's "Sync branch with main" step. docs/journal.md is
an append-only log (see its own intro): a conflict here almost always means
two branches each added a new entry at the same insertion point, not a real
disagreement about content. Safe to resolve mechanically by keeping every
entry from both sides -- take origin/main's version as the base (it already
has everything that's landed), then append whichever of this branch's own
entries aren't already present there (matched by heading text), in their
original order.

Expects the merge to currently be in a conflicted state, with the two sides
already extracted to /tmp/journal.ours.md (:2, this branch) and
/tmp/journal.theirs.md (:3, origin/main) by the calling shell step. Writes
the resolved result straight to docs/journal.md. Leaves conflict markers in
place (and lets the caller detect that) if the file doesn't look like a
clean pair of append-only logs -- the caller falls back to closing the PR
and re-queuing the issue rather than trusting a bad merge.
"""

import re

with open("/tmp/journal.ours.md") as f:
    ours = f.read()
with open("/tmp/journal.theirs.md") as f:
    theirs = f.read()

HEADING_RE = re.compile(r"^## .+$", re.M)


def split_entries(text):
    positions = [m.start() for m in HEADING_RE.finditer(text)]
    if not positions:
        return text, []
    preamble = text[: positions[0]]
    entries = [
        text[pos : positions[i + 1] if i + 1 < len(positions) else len(text)]
        for i, pos in enumerate(positions)
    ]
    return preamble, entries


def heading(entry):
    return entry.splitlines()[0]


_, ours_entries = split_entries(ours)
theirs_preamble, theirs_entries = split_entries(theirs)

theirs_headings = {heading(e) for e in theirs_entries}
new_entries = [e for e in ours_entries if heading(e) not in theirs_headings]

result = theirs_preamble + "".join(theirs_entries)
if not result.endswith("\n"):
    result += "\n"
for entry in new_entries:
    result += "\n" + entry.rstrip("\n") + "\n"

with open("docs/journal.md", "w") as f:
    f.write(result)

print(
    f"journal conflict auto-resolve: ours={len(ours_entries)} entries, "
    f"theirs={len(theirs_entries)} entries, newly appended={len(new_entries)}"
)
