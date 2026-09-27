# Confined offline verification

Run from the S1 worktree recorded in HANDOFF.md. No package installation was needed for S1.

The existing suite creates OS-temporary copies of modules and a synthetic HTML demo. The demo asserts that its output is outside the working tree. Set scratch to the sibling directory inside the physical clone below. This keeps all test files inside the clone while satisfying that existing assertion. Never let the suite default to an outside temporary directory.

Inspect new tests/imports for network or outside-file access before running a changed suite. The S1 preflight found only closed fetch stubs, synthetic inputs, local git reads and node --check subprocesses. This is not a blanket guarantee about future code.

Use this PowerShell setup. These removals do not inspect secret values.

    $scratch='C:\Users\patri\OneDrive\Desktop\masspermits-lander\.git\codex-session-scratch\revenue-harness-20260927'
    New-Item -ItemType Directory -Path $scratch -Force | Out-Null
    $env:TEMP=$scratch
    $env:TMP=$scratch
    $env:TMPDIR=$scratch
    $env:GIT_NO_LAZY_FETCH='1'
    $env:GIT_TERMINAL_PROMPT='0'
    $env:GIT_OPTIONAL_LOCKS='0'
    foreach($name in @('NODE_OPTIONS','NODE_PATH','HEALTH_JS','HEALTH_DUMP','MISSION_DEMO_OUT','MISSION_ORACLE_LOG','MISSION_ORACLE_OFF','MISSION_TABLE','MASSPERMITS_STRIPE_READ_ONLY_KEY','STRIPE_SECRET_KEY','STRIPE_API_KEY','STRIPE_WEBHOOK_SECRET','CLOUDFLARE_API_TOKEN','CF_API_TOKEN','RESEND_API_KEY')) {
      Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue
    }
    node --test test/*.test.mjs test/mission/*.test.mjs functions/api/*.test.mjs
    $testExit=$LASTEXITCODE

Keep any captured output in the same in-clone scratch location. Redact address-shaped strings before displaying or saving summaries. Do not commit raw output or captured provider bodies. Record the test process exit code rather than the wrapper's exit code.

At S1 baseline, Node v25.9.0 reported 211 tests: 209 passed, 2 failed, 0 skipped, 0 todo, 0 cancelled. The test process exited 1. INVARIANTS.md records both failing names and why they are existing post-merge test assumptions.

Once S2 has revenue test files, append test/revenue/*.test.mjs to the command. Do not add an empty glob before files exist. Do not invoke rehearsal all.test.mjs because it includes workflow-shell execution.

At close, remove only this session's created scratch directory, after resolving and checking its absolute path is inside the physical clone's .git/codex-session-scratch directory. Use PowerShell end to end. Never delete general OS temp contents or shared data.
