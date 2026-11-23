'use strict';

// Convenience runner: uses the test credentials built into api-test.js.
// Override with TEST_USER / TEST_PASS in the environment if needed.
const path = require('path');
const { spawnSync } = require('child_process');

const result = spawnSync(process.execPath, [path.join(__dirname, 'api-test.js')], {
  cwd: __dirname,
  stdio: 'inherit',
});

process.exit(result.status === null ? 1 : result.status);
