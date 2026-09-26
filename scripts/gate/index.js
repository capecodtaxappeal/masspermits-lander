// Entry point so that `node --test scripts/gate/` works on Node 22, which
// resolves a directory argument as a module (index.js) rather than a folder
// of test files. It only loads the gate tests; it does nothing else.
import('./gate.test.mjs');
