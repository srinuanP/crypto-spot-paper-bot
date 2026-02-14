import { parseArgs } from './args.js';
import { compareReports, loadExperimentReport, renderCompareTable, type CompareKey } from '../experiments/compare.js';

function printUsage(): void {
  console.log([
    'Usage: npm run experiments:compare -- --a <reportA.json> --b <reportB.json> [--key expectancy]',
    '',
    'Keys:',
    '  expectancy (default)',
    '  maxDrawdown',
    '  return',
    '  profitFactor'
  ].join('\n'));
}

function toCompareKey(value: string | undefined): CompareKey {
  if (!value) return 'expectancy';
  if (value === 'expectancy' || value === 'maxDrawdown' || value === 'return' || value === 'profitFactor') {
    return value;
  }
  throw new Error(`Invalid --key ${value}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help === 'true') {
    printUsage();
    return;
  }

  const aPath = args.a;
  const bPath = args.b;
  if (!aPath || !bPath) {
    throw new Error('Both --a and --b are required');
  }

  const key = toCompareKey(args.key);
  const [reportA, reportB] = await Promise.all([
    loadExperimentReport(aPath),
    loadExperimentReport(bPath)
  ]);

  const compare = compareReports(reportA, reportB, key);
  console.log(renderCompareTable(compare));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
