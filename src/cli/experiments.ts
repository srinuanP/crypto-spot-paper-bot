import { parseArgs } from './args.js';
import { loadExperimentsConfig } from '../experiments/config.js';
import { runExperiments } from '../experiments/runner.js';
import { renderExperimentTable } from '../experiments/table.js';

function printUsage(): void {
  console.log([
    'Usage: npm run experiments -- [options]',
    '',
    'Options:',
    '  --config configs/experiments.default.json',
    '  --symbols BTCUSDT,ETHUSDT',
    '  --intervals 15m,1h',
    '  --strategies smaCross,rsiMeanReversion',
    '  --limit 2000',
    '  --feeBps 10',
    '  --slippageBps 5',
    '  --top 10',
    '  --sort expectancy|maxDrawdown|return|profitFactor',
    '  --minTrades 20',
    '',
    'Example:',
    '  npm run experiments -- --symbols BTCUSDT --intervals 1h --strategies smaCross --limit 300'
  ].join('\n'));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help === 'true') {
    printUsage();
    return;
  }

  const config = await loadExperimentsConfig(args);
  const { report, reportPath } = await runExperiments(config);

  console.log(`Experiment report saved: ${reportPath}`);
  console.log(renderExperimentTable(report.results, {
    sort: config.sort,
    top: config.top,
    minTrades: config.minTrades
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
