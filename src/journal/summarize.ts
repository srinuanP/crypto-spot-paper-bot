import { parseArgs } from '../cli/args.js';
import { analyzeInputFile, renderThaiJournal } from './ruleChecker.js';

function printUsage(): void {
  const lines = [
    'Usage: npm run journal -- --input <path> [--date YYYY-MM-DD]',
    '',
    'Options:',
    '  --input reports/latest.json      Backtest report',
    '  --input paper-log.jsonl          Paper log (jsonl)',
    '  --date 2026-02-13                Optional; default is today for paper log',
    '  --help                           Show this help',
    '',
    'Examples:',
    '  npm run journal -- --input paper-log.jsonl --date 2026-02-13',
    '  npm run journal -- --input reports/latest.json',
    ''
  ];
  console.log(lines.join('\n'));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help === 'true') {
    printUsage();
    return;
  }

  const input = args.input ?? args.file ?? (args.mode === 'paper' ? 'paper-log.jsonl' : 'reports/latest.json');
  const date = args.date;
  const analysis = await analyzeInputFile(input, date);
  console.log(renderThaiJournal(analysis));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
