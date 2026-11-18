// Portfolio valuation: holdings at the latest close, converted to C$ at the Bank of Canada USD/CAD rate.
export type Holding = { ticker: string; shares: number; cost: number }; // cost per share, trading currency
export type Quote = { name: string; currency: string; price: number; date: string; beta: number };

export function valuePortfolio(hs: Holding[], q: Record<string, Quote>, usdcad: number) {
  const toCad = (cur: string) => (cur === 'USD' ? usdcad : 1);
  const rows = hs.filter(h => q[h.ticker]).map(h => {
    const x = q[h.ticker];
    const value = h.shares * x.price, cost = h.shares * h.cost;
    return { ...h, ...x, value, gain: cost ? value / cost - 1 : NaN, valueCad: value * toCad(x.currency), costCad: cost * toCad(x.currency) };
  });
  const total = rows.reduce((s, r) => s + r.valueCad, 0);
  const withCost = rows.filter(r => r.costCad > 0); // holdings entered without a cost stay out of the gain
  const cost = withCost.reduce((s, r) => s + r.costCad, 0);
  const costedValue = withCost.reduce((s, r) => s + r.valueCad, 0);
  const out = rows.map(r => ({ ...r, weight: total ? r.valueCad / total : 0 }));
  return {
    rows: out, total, cost,
    gain: cost ? costedValue / cost - 1 : NaN, // both legs at today's FX, so this is the gain in local currency terms
    beta: out.reduce((s, r) => s + r.weight * r.beta, 0),
    usdShare: total ? out.filter(r => r.currency === 'USD').reduce((s, r) => s + r.valueCad, 0) / total : 0,
  };
}
