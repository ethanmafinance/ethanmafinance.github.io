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
