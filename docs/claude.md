# Working with Claude Code — Security & Privacy Lessons

Notes specifically about Claude Code itself (the CLI/agent, not this app or GitHub) — what it can
and can't do, and one real incident worth learning from. Companion to `docs/github.md`, which covers
GitHub/Actions-specific lessons; this file is about the assistant's own access boundaries and limits.

---

## A coding session's filesystem access is exactly the shell's — including WSL drive mounts

**What happened:** mid-session, the user referenced a file by a path that turned out not to exist
where expected. Rather than asking where it actually was, a broad, unscoped `find /` (and `find ~`)
was run to locate it. On WSL specifically, this reached `/mnt/c/Users/.../Downloads` — the Windows
filesystem, transparently mounted and readable from the Linux side exactly like any other directory
— and surfaced real personal financial files sitting there, entirely as a side effect of searching
too broadly, not because of any special "reach outside the project" capability being used. The user
was seriously alarmed, understandably: nothing about "help me with this git repo" implies "and also
look through my Downloads folder."

**Why this is easy to do by accident on WSL specifically.** On a normal Linux or macOS setup, "the
project directory" and "the whole filesystem" are already mentally distinct, and there's rarely a
reason a project-scoped search would surface anything outside it. WSL removes that boundary
structurally: the Windows C: drive is just another mounted path, no different in kind from `/home`
or `/tmp`. A search command that would be harmlessly narrow on a native Linux box (`find /`, a
recursive grep from `/`) becomes a search of the user's *entire actual computer*, Downloads and
AppData and Recent-files list included, purely because of how the two filesystems are joined.

**The fix is behavioural, not technical — there is no sandboxing switch to flip from inside a
session.** A coding agent's Bash tool has whatever filesystem access the shell it's running in has;
nothing about the harness inherently prevents a broad search from reaching outside the intended
directory. The actual mitigation:
- **Never widen a search past the project directory.** If a referenced file isn't where expected,
  ask where it is rather than searching outward for it — every time, no exceptions, regardless of
  how quick a `find /` feels compared to asking a follow-up question.
- **If a user explicitly places a file inside the project** (uploads it to the repo, drops it in a
  scratch directory under the project) for reference, that's a legitimate, in-scope thing to read —
  the boundary is the project directory, not "never touch a file the user gives you." Delete it
  again immediately after extracting whatever was actually needed, especially if it's real personal
  data — see `docs/github.md`'s own section on the incident this caused for the fuller data-handling
  side of the same story.
- **A user's stated boundary here should be treated as durable, not session-scoped.** "Don't do this
  again, in this or any future session" is a real, standing instruction — the right way to honour it
  is to persist it somewhere that survives the session ending (Claude Code's own memory feature, if
  available), since a chat instruction by itself only lasts as long as the conversation does.
- **Be honest about what can and can't actually be guaranteed.** A coding session can commit to
  never *initiating* an out-of-scope read again, and can persist that commitment durably — but it
  cannot impose a hard technical sandbox on itself from the inside. If a user wants an unbreakable
  guarantee rather than a behavioural one, that has to be configured at the harness/host level
  (Claude Code's own permission settings, a restricted working directory, a container boundary) —
  outside of what's achievable from within a running session. Say this plainly rather than implying
  a memory note is equivalent to a real sandbox.

---

## Account-level privacy settings (training data, conversation retention) are not reachable from a coding session

**What happened:** immediately after the incident above, the user asked to have their data purged
from "Claude records" and opted out of model training, revoking permission given earlier in the
same conversation, and asked not to be asked about it again.

**The important distinction:** a Claude Code session and an Anthropic/claude.ai account are two
different systems. A coding session has tools for the *project* — reading and writing files, running
shell commands, managing a git repo — and no tool at all for the *account* underneath it: no way to
view, change, or purge what Anthropic retains, whether conversations are used to improve models, or
account-level data-subject requests. Nothing achievable from inside a session reaches that layer,
regardless of how the request is phrased — there is no hidden admin command, and pretending
otherwise (or quietly saving a memory note and treating that as equivalent to actioning the request)
would be actively misleading.

**What to actually tell a user asking for this:**
- **claude.ai account settings → Privacy Controls** is where conversation-level data handling and
  training-data preferences are actually managed, including deleting conversation history directly.
- **Anthropic's published privacy policy / data-rights process** covers the fuller formal request
  path (access, deletion, objection to processing) for a data-subject request beyond what the
  account settings UI exposes directly — relevant in particular for a user in a jurisdiction with
  statutory data rights (UK/EU GDPR and similar).
- A coding session **can** durably remember "don't ask about this again" as a standing behavioural
  preference (Claude Code's own memory feature, same mechanism as the filesystem-boundary lesson
  above) — that's a real, useful thing to do. It is not, and should not be presented as, the same
  as the user's account settings actually having been changed.

**Standing takeaway:** when a request is really about the Anthropic account/product layer rather
than the project a session is working in, say so plainly and point at the real place to do it,
rather than trying to satisfy it with whatever tools happen to be available in-session. Silently
attempting a partial, wrong-layer fix is worse than clearly explaining the boundary.
