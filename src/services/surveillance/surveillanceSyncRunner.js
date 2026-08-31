import { fetchASM } from './asmService.js';
import { fetchGSM } from './gsmService.js';
import { fetchESM } from './esmService.js';
import { fetchT2T } from './t2tService.js';
import { fetchETF } from './etfService.js';
import { fetchZerodhaApproved } from './zerodhaApprovedService.js';
import { refreshSource } from './surveillanceRepository.js';


async function syncSurveillanceModule(moduleName, sourceName, fetchFunction, refreshSourceImpl) {
  const records = await fetchFunction();

  if (!Array.isArray(records)) {
    throw new Error(`${moduleName} returned invalid data`);
  }

  const count = await refreshSourceImpl(sourceName, records);
  return { moduleName, sourceName, count };
}

export async function runSurveillanceSync({
  fetchers = {
    asm: fetchASM,
    gsm: fetchGSM,
    esm: fetchESM,
    t2t: fetchT2T,
    etf: fetchETF,
    zerodha: fetchZerodhaApproved,
  },
  refreshSourceImpl = refreshSource,
} = {}) {
  const modules = [
    { key: 'asm', label: 'ASM', source: 'ASM_API' },
    { key: 'gsm', label: 'GSM', source: 'GSM_API' },
    { key: 'esm', label: 'ESM', source: 'ESM_API' },
    { key: 't2t', label: 'T2T', source: 'EQUITY_L' },
    { key: 'etf', label: 'ETF', source: 'ETF_API' },
    { key: 'zerodha', label: 'ZERODHA', source: 'ZERODHA_API' },
  ];

  const results = {};
  const failures = [];

  for (const module of modules) {
    try {
      const fetchFunction = fetchers[module.key];
      const moduleResult = await syncSurveillanceModule(module.label, module.source, fetchFunction, refreshSourceImpl);
      results[module.key] = { status: 'completed', count: moduleResult.count };
    } catch (error) {
      const message = error?.message || `Failed to sync ${module.label}`;
      failures.push(message);
      results[module.key] = { status: 'failed', error: message };
    }
  }

  if (failures.length > 0 && failures.length === modules.length) {
    throw new Error(failures[0]);
  }

  return {
    success: true,
    message: 'Surveillance sync completed',
    details: {
      surveillance: failures.length > 0 ? 'completed_with_errors' : 'completed',
      modules: results,
    },
  };
}
