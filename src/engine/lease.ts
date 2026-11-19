// Engine D: contracted lease portfolio (data centres; the same structure fits towers and fibre leased by capacity).
// This is how appraisers and buyers value a stabilized portfolio: a hold-period DCF of net operating income
// plus an exit value at a capitalization rate on the year after the hold.
//   rent_t = (1 + escalator)^(t-1) x [NTM rent + mark-to-market on rolled leases - downtime on leases not renewed]
//          + lease-up of vacant megawatts from a chosen year
//   NOI_t  = NOI margin x rent_t          (net leases: tenants reimburse most operating costs)
//   value  = sum of NOI_t / (1 + r)^t over the hold + NOI_(hold+1) / exit cap x (1 - selling costs) / (1 + r)^hold
// Leases expiring in a year roll at the start of that year (a conservative timing).
// Column 0 is the valuation date; columns 1..hold+1 are the forecast years.
import type { Input, Item, ModelDef } from './sheet.ts';
import type { Module } from './projectFinance.ts';

const g = (group: string, list: Omit<Input, 'group'>[]): Input[] => list.map(i => ({ ...i, group }));
export const EXP_YEARS = 10;

export const leaseInputs: Input[] = [
  ...g('Timing', [
    { id: 'start_year', label: 'First forecast year', unit: 'year', value: 2027, fmt: 'year', timing: true, step: 1 },
    { id: 'hold', label: 'Hold period before exit', unit: 'years', value: 10, fmt: 'int', timing: true, min: 3, max: 20, step: 1 },
  ]),
  ...g('Portfolio', [
    { id: 'mw', label: 'Rentable capacity', unit: 'MW', value: 100, fmt: 'num' },
    { id: 'occ', label: 'Share of capacity leased', unit: '%', value: 1, fmt: 'pct', min: 0, max: 1 },
    { id: 'ntm', label: 'Base rent for the next twelve months (NTM), leases commenced', unit: 'US$m', value: 100, fmt: 'num' },
    { id: 'margin', label: 'NOI margin on base rent (after unreimbursed operating costs and property management)', unit: '%', value: 0.8, fmt: 'pct' },
  ]),
  ...g('Leases', [
    { id: 'esc', label: 'Annual rent escalator', unit: '% / yr', value: 0.025, fmt: 'pct' },
    ...Array.from({ length: EXP_YEARS }, (_, k) => ({ id: `exp_${k + 1}`, label: `NTM rent on leases expiring in year ${k + 1}`, unit: 'US$m', value: 0, fmt: 'num' as const })),
    { id: 'renew', label: 'Share of expiring rent that renews', unit: '%', value: 1, fmt: 'pct', min: 0, max: 1 },
    { id: 'downtime', label: 'Months vacant before space not renewed is re-let', unit: 'months', value: 12, fmt: 'int', min: 0, max: 36, step: 1 },
    { id: 'mtm', label: 'Mark-to-market on rolled leases (new rent / old rent - 1)', unit: '%', value: 0, fmt: 'pct' },
    { id: 'lu_year', label: 'Vacant capacity leased from year (0 = not leased)', unit: 'year', value: 0, fmt: 'int', min: 0, max: 20, step: 1 },
  ]),
  ...g('Valuation', [
    { id: 'rate', label: 'Discount rate (unlevered)', unit: '%', value: 0.075, fmt: 'pct' },
    { id: 'cap', label: 'Exit capitalization rate (on NOI in the year after the hold)', unit: '%', value: 0.06, fmt: 'pct' },
    { id: 'sell', label: 'Selling costs at exit', unit: '% of value', value: 0, fmt: 'pct' },
    { id: 'price', label: 'Purchase price, for the IRR', unit: 'US$m', value: 1000, fmt: 'num' },
  ]),
];

const row = (id: string, label: string, unit: string, fmt: string, f: (x: any) => string | number, extra: object = {}): Item =>
  ({ kind: 'row', id, label, unit, fmt, f, ...extra }) as Item;
const sc = (id: string, label: string, unit: string, fmt: string, f: (x: any) => string, extra: object = {}): Item =>
  ({ kind: 'scalar', id, label, unit, fmt, f, ...extra }) as Item;
const rowNo = (x: any, id: string) => x.i(id).match(/\$(\d+)$/)![1];

export function lease(mod: Module): ModelDef {
  // Value at discount rate r (a formula) and exit cap c, from the NOI row and a discount factor row.
  const exitNoi = (x: any) => `INDEX(${x.row('noi')},1,${x.i('hold')}+2)`;
  const value = (x: any, df: string, r: string, c: string) =>
    `SUMPRODUCT(${x.row('hold_flag')},${x.row('noi')},${x.row(df)})+${exitNoi(x)}/(${c})*(1-${x.i('sell')})/(1+${r})^${x.i('hold')}`;
  const items: Item[] = [
    { section: 'Valuation summary' },
    sc('pv_noi', 'Present value of NOI over the hold', 'US$m', 'num', x => `SUMPRODUCT(${x.row('hold_flag')},${x.row('noi')},${x.row('df')})`),
    sc('exit_value', 'Exit value at the end of the hold (NOI next year / exit cap, less selling costs)', 'US$m', 'num', x => `${exitNoi(x)}/${x.i('cap')}*(1-${x.i('sell')})`),
    sc('pv_exit', 'Present value of the exit value', 'US$m', 'num', x => `${x.s('exit_value')}/(1+${x.i('rate')})^${x.i('hold')}`),
    sc('value', 'Portfolio value (gross asset value)', 'US$m', 'num', x => `${x.s('pv_noi')}+${x.s('pv_exit')}`, { bold: true }),
    sc('tv_share', 'Exit value share of total value', '%', 'pct', x => `${x.s('pv_exit')}/${x.s('value')}`),
    sc('going_in', 'Going-in yield (year 1 NOI / value)', '%', 'pct', x => `INDEX(${x.row('noi')},1,2)/${x.s('value')}`, { bold: true }),
    sc('per_mw', 'Value per MW of capacity', 'US$m', 'num', x => `${x.s('value')}/${x.i('mw')}`),
    sc('rent_mw', 'NTM rent per leased MW', 'US$m', 'num', x => `${x.i('ntm')}/(${x.i('mw')}*${x.i('occ')})`),
    sc('irr', 'Unlevered IRR at the purchase price', '%', 'pct', x => `IRR(${x.row('cf')})`, { bold: true }),
    sc('s_dr_dn', 'Value change, discount rate 25bp lower', '%', 'pct', x => `(${value(x, 'df_dn', `${x.i('rate')}-0.0025`, x.i('cap'))})/${x.s('value')}-1`),
    sc('s_dr_up', 'Value change, discount rate 25bp higher', '%', 'pct', x => `(${value(x, 'df_up', `${x.i('rate')}+0.0025`, x.i('cap'))})/${x.s('value')}-1`),
    sc('s_cap_dn', 'Value change, exit cap 25bp lower', '%', 'pct', x => `(${value(x, 'df', x.i('rate'), `${x.i('cap')}-0.0025`)})/${x.s('value')}-1`),
    sc('s_cap_up', 'Value change, exit cap 25bp higher', '%', 'pct', x => `(${value(x, 'df', x.i('rate'), `${x.i('cap')}+0.0025`)})/${x.s('value')}-1`),
    { section: 'Timing' },
    row('t', 'Forecast year (0 = valuation date)', '#', 'int', x => (x.first ? 0 : `${x.p('t')}+1`)),
    row('year', 'Year', 'year', 'year', x => `${x.i('start_year')}-1+${x.r('t')}`, { bold: true }),
    row('op', 'Forecast year flag', 'flag', 'flag', x => `IF(${x.r('t')}>0,1,0)`),
    row('hold_flag', 'Hold period flag', 'flag', 'flag', x => `IF(AND(${x.r('t')}>0,${x.r('t')}<=${x.i('hold')}),1,0)`),
    row('df', 'Discount factor (end of year)', 'x', 'x', x => `1/(1+${x.i('rate')})^${x.r('t')}`),
    row('df_dn', 'Discount factor, rate 25bp lower', 'x', 'x', x => `1/(1+${x.i('rate')}-0.0025)^${x.r('t')}`),
    row('df_up', 'Discount factor, rate 25bp higher', 'x', 'x', x => `1/(1+${x.i('rate')}+0.0025)^${x.r('t')}`),
    { section: 'Rent and NOI' },
    row('idx', 'Escalation index', 'x', 'x', x => `${x.r('op')}*(1+${x.i('esc')})^MAX(0,${x.r('t')}-1)`),
    row('expiring', 'NTM rent on leases expiring this year', 'US$m', 'num',
      x => `IF(AND(${x.r('t')}>=1,${x.r('t')}<=${EXP_YEARS}),INDEX(Inputs!$C$${rowNo(x, 'exp_1')}:$C$${rowNo(x, `exp_${EXP_YEARS}`)},MAX(1,${x.r('t')})),0)`),
    row('cum_exp', 'NTM rent rolled to date (cumulative)', 'US$m', 'num', x => `${x.p('cum_exp')}+${x.r('expiring')}`),
    row('rent_contract', 'Rent on the leases in place today, escalated', 'US$m', 'num', x => `${x.r('idx')}*${x.i('ntm')}`),
    row('rent_mtm', 'Mark-to-market on rolled leases', 'US$m', 'num', x => `${x.r('idx')}*${x.i('mtm')}*${x.r('cum_exp')}`),
    row('rent_down', 'Rent lost to downtime on leases not renewed', 'US$m', 'num',
      x => `-${x.r('idx')}*(1-${x.i('renew')})*MIN(12,${x.i('downtime')})/12*${x.r('expiring')}*(1+${x.i('mtm')})`),
    row('rent_lu', 'Lease-up of vacant capacity at the current rent per MW', 'US$m', 'num',
      x => `IF(AND(${x.i('lu_year')}>0,${x.r('t')}>=${x.i('lu_year')}),${x.r('idx')}*${x.i('mw')}*(1-${x.i('occ')})*${x.s('rent_mw')},0)`),
    row('rent', 'Base rent', 'US$m', 'num', x => `${x.r('rent_contract')}+${x.r('rent_mtm')}+${x.r('rent_down')}+${x.r('rent_lu')}`, { bold: true }),
    row('noi', 'Net operating income', 'US$m', 'num', x => `${x.i('margin')}*${x.r('rent')}`, { bold: true }),
    { section: 'Unlevered cash flow' },
    row('exit_cf', 'Exit value', 'US$m', 'num', x => `IF(${x.r('t')}=${x.i('hold')},${x.s('exit_value')},0)`),
    row('cf', 'Cash flow to a buyer at the purchase price', 'US$m', 'num', x => `IF(${x.r('t')}=0,-${x.i('price')},${x.r('hold_flag')}*${x.r('noi')}+${x.r('exit_cf')})`, { bold: true }),
  ];
  const eq = (f: string | number) => (typeof f === 'number' ? f : '=' + f);
  return {
    title: mod.name,
    inputs: [...leaseInputs.map(i => ({ ...i, ...mod.defaults?.[i.id] })), ...mod.inputs],
    items: items.map(it => ('kind' in it ? { ...it, f: (x: any) => eq(it.f(x)) } : it)) as Item[],
    columns: v => v.hold + 2,
    dash: {
      units: 'US$ millions, nominal, annual periods',
      inputs: ['start_year', 'hold', 'mw', 'occ', 'ntm', 'margin', 'esc', 'renew', 'rate', 'cap', 'price'],
      outputs: ['value', 'pv_noi', 'pv_exit', 'tv_share', 'going_in', 'per_mw', 'rent_mw', 'irr'],
      rows: ['rent', 'noi', 'cf'],
    },
  };
}
