const fs = require('fs');

try {
  const configRaw = fs.readFileSync('openclaw.json', 'utf8');
  const config = JSON.parse(configRaw);

  const smConfig = config?.plugins?.entries?.['openclaw-supermemory']?.config;

  if (!smConfig) {
    throw new Error('openclaw-supermemory plugin or its config object is missing.');
  }

  const assertions = [
    { key: 'autoRecall', expectedType: 'boolean', expectedValue: true },
    { key: 'autoCapture', expectedType: 'boolean', expectedValue: true },
    { key: 'captureMode', expectedType: 'string', expectedValue: 'all' },
    { key: 'profileFrequency', expectedType: 'number', expectedValue: 50 },
    { key: 'maxRecallResults', expectedType: 'number', expectedValue: 10 },
    { key: 'enableCustomContainerTags', expectedType: 'boolean', expectedValue: true }
  ];

  let passed = 0;

  console.log('--- Configuration Verification Results ---');

  for (const { key, expectedType, expectedValue } of assertions) {
    const val = smConfig[key];
    const actualType = typeof val;

    if (val === undefined) {
      console.error(`[FAIL] ${key} is totally missing.`);
    } else if (actualType !== expectedType) {
      console.error(`[FAIL] ${key} is type '${actualType}', expected '${expectedType}'.`);
    } else if (val !== expectedValue) {
      console.error(`[FAIL] ${key} has value '${val}', expected '${expectedValue}'.`);
    } else {
      console.log(`[PASS] ${key} = ${val} (${actualType})`);
      passed++;
    }
  }

  console.log(`\nVerified ${passed}/${assertions.length} properties successfully.`);

  if (passed !== assertions.length) {
    process.exit(1);
  } else {
    process.exit(0);
  }

} catch (err) {
  console.error(`Script Execution Failed: ${err.message}`);
  process.exit(1);
}
