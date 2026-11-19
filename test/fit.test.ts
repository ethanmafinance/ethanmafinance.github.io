import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dcfFit, quantile } from '../src/engine/fit.ts';

test('IREN-like build-out with losses is not meaningful; a steady utility fits', () => {
  // IREN FY2026: revenue 707, EBIT -1,047, capex 2,998 (SEC filings); earlier years approximate shape.
  const iren = dcfFit({ rev: [187, 501, 707], ebit: [-50, 39, -1047], capex: [500, 1500, 2998], fcfForecast: [-900, -500, -200], ev: -1000, tvShare: 1 });
  assert.equal(iren.verdict, 'no');
  assert.ok(iren.reasons.length >= 3);
  const util = dcfFit({ rev: [100, 104, 108], ebit: [20, 21, 22], capex: [30, 32, 33], fcfForecast: [5, 6, 7], ev: 500, tvShare: 0.7 });
  assert.deepEqual(util, { verdict: 'ok', reasons: [] });
  assert.equal(dcfFit({ rev: [100, 104, 108], ebit: [20, 21, 22], capex: [30, 32, 33], fcfForecast: [5, 6, 7], ev: 500, tvShare: 0.93 }).verdict, 'caution');
});

test('quantile interpolates and ignores missing values', () => {
  assert.equal(quantile([1, undefined, 3, 2, 4], 0.5), 2.5);
  assert.equal(quantile([10, 20], 0.25), 12.5);
  assert.equal(quantile([undefined], 0.5), undefined);
});

test('blend: weights follow the DCF fit and drop methods without a value', async () => {
  const { blend } = await import('../src/engine/fit.ts');
  const ok = blend('ok', { dcf_g: 100, dcf_x: 120, ev_ebitda: 80, pe: 100, ev_rev: 500 })!;
  assert.equal(ok.weights.ev_rev, 0);
  assert.ok(Math.abs(ok.value - 100) < 1e-9);
  const no = blend('no', { dcf_g: -5, ev_ebitda: undefined, pe: undefined, ev_rev: 30 })!;
  assert.equal(no.weights.ev_rev, 1);
  assert.equal(no.value, 30);
  // forward P / E takes the trailing P / E weight when it has a value
  const fw = blend('ok', { dcf_g: 100, dcf_x: 100, ev_ebitda: 100, pe: 40, pe_f: 200 })!;
  assert.ok(fw.weights.pe === 0 && Math.abs(fw.weights.pe_f - 0.25) < 1e-9 && Math.abs(fw.value - 125) < 1e-9);
  const part = blend('ok', { dcf_g: 100, ev_ebitda: 50, pe: -1 })!;
  assert.ok(Math.abs(part.weights.dcf_g - 0.5) < 1e-9 && Math.abs(part.value - 75) < 1e-9);
  assert.equal(blend('ok', {}), undefined);
});
