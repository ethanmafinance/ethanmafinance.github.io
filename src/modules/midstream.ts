// Midstream and pipelines: contracted capacity paid whether or not it is used (take-or-pay demand charge),
// plus a volume charge on throughput above or alongside the contract. Lenders size debt on the contracted
// revenue (a share of uncontracted volume at most); returns read on expected throughput.
// Not shown on the site until a real example passes its published checks (no example sourced yet).
import type { Module } from '../engine/projectFinance.ts';
import type { Item } from '../engine/sheet.ts';

const g = 'Pipeline: capacity, contracts, tolls and costs';
const PH = { title: '', est: true, note: 'placeholder until a sourced example is loaded' };
const row = (id: string, label: string, unit: string, fmt: 'num' | 'pct', f: (x: any) => string, extra: object = {}): Item =>
  ({ kind: 'row', id, label, unit, fmt, f, ...extra }) as Item;

// Throughput used by the volume charge: utilization of capacity; the sizing case counts only the contracted share.
const volume = (sizing: boolean) => (x: any) =>
  `${x.r('ops_flag')}*${x.i('capacity')}*365*${sizing ? `MIN(${x.i('utilization')},${x.i('contracted')})*${x.r('top_flag')}` : x.i('utilization')}`;

export const midstream: Module = {
  id: 'midstream',
  name: 'Midstream and pipelines',
  blurb: 'Take-or-pay capacity contracts plus volume charges, with debt sized on contracted cash flow.',
  inputs: [
    { id: 'capacity', label: 'Capacity', unit: 'mmcf / day', value: 1000, fmt: 'num', group: g, source: PH },
    { id: 'contracted', label: 'Share of capacity under take-or-pay contracts', unit: '%', value: 0.9, fmt: 'pct', group: g, source: PH },
    { id: 'top_years', label: 'Take-or-pay contract term from COD', unit: 'years', value: 20, fmt: 'int', step: 1, group: g, source: PH },
    { id: 'demand_toll', label: 'Demand (reservation) charge (start-year dollars)', unit: 'C$ / mcf of capacity', value: 0.6, fmt: 'num', group: g, source: PH },
    { id: 'toll_index_m', label: 'Share of CPI the demand charge rises by', unit: '%', value: 0, fmt: 'pct', group: g, source: PH },
    { id: 'recontract', label: 'Recontracting rate after the term, share of the original charge', unit: '%', value: 0.8, fmt: 'pct', group: g, source: PH },
    { id: 'utilization', label: 'Expected throughput, share of capacity', unit: '%', value: 0.9, fmt: 'pct', group: g, source: PH },
    { id: 'commodity_toll', label: 'Volume (commodity) charge (start-year dollars, CPI-indexed)', unit: 'C$ / mcf', value: 0.03, fmt: 'num', group: g, source: PH },
    { id: 'opex_m', label: 'Operating costs: O&M, compression fuel, property tax (start-year dollars)', unit: 'C$m / yr', value: 40, fmt: 'num', group: g, source: PH },
    { id: 'lifecycle_m', label: 'Sustaining capex, annual average (start-year dollars)', unit: 'C$m / yr', value: 10, fmt: 'num', group: g, source: PH },
  ],
  items: [
    row('top_flag', 'Under take-or-pay contract', 'flag', 'num', x => `IF(AND(${x.r('ops_flag')}=1,${x.r('ops_year')}<=${x.i('top_years')}),1,0)`, { fmt: 'flag' }),
    // Demand revenue is paid on contracted capacity regardless of flow; after the term it is recontracted at a discount.
    row('demand_rev', 'Demand charge revenue (take-or-pay)', 'C$m', 'num',
      x => `${x.r('ops_flag')}*${x.i('capacity')}*${x.i('contracted')}*365/1000*${x.i('demand_toll')}*(${x.r('index')})^${x.i('toll_index_m')}*IF(${x.r('top_flag')}=1,1,${x.i('recontract')})`,
      { role: 'revenue', fb: (x: any) => `${x.r('top_flag')}*${x.i('capacity')}*${x.i('contracted')}*365/1000*${x.i('demand_toll')}*(${x.r('index')})^${x.i('toll_index_m')}` }),
    row('throughput', 'Throughput (expected; contracted only in the base rows)', 'bcf', 'num', x => `${volume(false)(x)}/1000`, { fb: (x: any) => `${volume(true)(x)}/1000` }),
    row('volume_rev', 'Volume charge revenue', 'C$m', 'num', x => `${x.r('throughput')}*${x.i('commodity_toll')}*${x.r('index')}`, { role: 'revenue' }),
    row('opex_m_r', 'Operating costs', 'C$m', 'num', x => `${x.r('ops_flag')}*${x.i('opex_m')}*${x.r('index')}`, { role: 'opex' }),
    row('lc_m_r', 'Sustaining capex', 'C$m', 'num', x => `${x.r('ops_flag')}*${x.i('lifecycle_m')}*${x.r('index')}`, { role: 'maint' }),
  ],
  bid: { input: 'demand_toll', label: 'demand charge' },
  bidText: 'Shippers and pipeline owners negotiate the demand charge; this solves the charge that gives the target return.',
};
