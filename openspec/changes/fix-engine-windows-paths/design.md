## Context

`new URL(rel, import.meta.url).pathname` returns the URL's path component, not a filesystem path. On POSIX they coincide (apart from percent-encoding: a folder named `Ana Silva` gives `Ana%20Silva`, so the old code also broke on POSIX for a path with a space; `fileURLToPath` decodes it). On Windows `file:///D:/a/x/` has pathname `/D:/a/x/`; `path.join("/D:/a/x/", ...)` on win32 gives `\D:\a\x\...`, and Node then resolves it against the current drive: `D:\D:\a\x`.

The repository supports Node `>=20` (root `engines`; CI runs 20, 22 and 24, the engine's Windows leg runs 24).

## Decision: `fileURLToPath(new URL("../../templates/", base))`

Alternatives:

| Option | Works on Windows | Node floor | Notes |
| --- | --- | --- | --- |
| A. `fileURLToPath(new URL(rel, import.meta.url))` | yes | any | The idiom already used by 30+ other places of the repository (`helpers.mjs`, `docs.mjs`, `main.mjs`). Handles drive letters, UNC and percent-decoding. |
| B. `path.resolve(import.meta.dirname, "../../templates")` | yes | 20.11 | Shorter, but `import.meta.dirname` does not exist before 20.11, and the repository says only `>=20`. Cannot be fed a URL in a test. |
| C. Pass the `URL` object to `fs` (`readdirSync(new URL(...))`) | yes | any | Works, but the code joins file names with `join`, so a string is needed; would change more lines. |

Recommended and chosen: A. It is the most compatible with the floor and consistent with the rest of the repository.

The code is `export const templatesDir = (base = import.meta.url, opts) => fileURLToPath(new URL("../../templates/", base), opts)`. The `base` and `opts` parameters exist for the test: `templatesDir("file:///D:/a/r/x/scripts/lib/gen-terraform.mjs", { windows: true })` runs the Windows conversion on Linux. `fileURLToPath`'s `windows` option exists from Node 20.13 and 22.1; the unit test detects its absence and says so in the skip message (CI runs the latest 20.x). The production call passes no option, so the platform decides.

## Sweep and what is not a bug

Every occurrence in `plugins/`, `hooks`, `scripts/`, `src/` and `test/` is classified in `tasks.md` (task 2.1). Summary: `.pathname` once (this bug); `new URL(rel, import.meta.url)` passed straight to `readFileSync` or to `new Worker` is valid on Windows (Node accepts file URLs there) and was left alone; the rest already use `fileURLToPath` or `pathToFileURL`.

## Test portability

The tests that failed on Windows besides the templates folder fall in three groups, found by the full run on Windows in CI: (1) guard tests paste native paths into shell commands, and the guard denies a backslash on purpose, so those paths are written with forward slashes (Windows accepts them for every call); (2) the temp folder of a Windows runner is `C:\Users\RUNNER~1\...` and the guard denies a tilde in the middle of a word, so fixtures use the long name (`realpathSync.native`); (3) a test compared `relative()` output with `/` keys. The `--open-pr` tests use bash stubs named `gh` and `az`; Windows starts a program without a shell only as `.exe`, so they are skipped there, with the reason in the message. The differential tests against a real bash were already skipped on Windows and stay so.

## Risks

- The Windows leg now depends on the full suite; a flaky test would turn it red. Mitigated: the job is not a required check, uses no timing assertions, and a failure is visible but does not block merging.
- Forward-slash command paths make the guard tests exercise the guard on Windows with `D:/...` paths; the guard's own logic is unchanged and tested with native paths by `node:path` calls.
- Only Windows with Node 24 is proven. Node 20/22 on Windows and macOS are not exercised by this job.
