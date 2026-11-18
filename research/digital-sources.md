# Data centres: Blue Owl Digital Infrastructure Trust (SEC CIK 2069692)

Wholly owned portfolio of US data centres. Sources opened 2026-11-18.

- 10-Q for Sep 30, 2026 (filed Nov 6, 2026): https://www.sec.gov/Archives/edgar/data/2069692/000206969226000069/osnl-20260930.htm
- 10-K for 2025 (filed Mar 11, 2026): https://www.sec.gov/Archives/edgar/data/2069692/000206969226000016/osnl-20251231.htm

## Published figures used (10-Q, Sep 30, 2026)
| Figure | Value | Page |
|---|---|---|
| Properties / capacity | 12 / 235 MW | 33 |
| Leased | 99.7% | 14 |
| NTM base rent (commenced leases) | $302.733m | 33 |
| Gross asset value (fair value) | $4,289.880m | 33 |
| Weighted discount rate / capitalization rate | 7.7% / 6.1% | 40 |
| Value change, discount rate -25bp / +25bp | +1.9% / (1.8)% | 40 |
| Value change, cap rate -25bp / +25bp | +2.4% / (2.2)% | 40 |
| Lease expirations by NTM rent ($000) | 2026 rem 2,799; 2027 13,410; 2028 12,088; 2029 16,806; 2030 29,201; 2031 36,200; 2032 4,963; 2033 0; 2034 30,571; 2035 7,116; thereafter 149,579 | 34 |
| Q3 base rent / reimbursements / property operating costs ($000) | 81,575 / 46,762 / 65,906 | 24, 3 |

## Method
Ten-year hold, end-of-year discounting, exit on year 11 NOI at the cap rate, no selling costs, all leases renew at the escalated rent.
Two unpublished inputs solved:
1. Escalator. Sensitivity ratios do not depend on the NOI level, only on the shape of NOI. Searching hold 10 to 12, end or mid-year timing and escalators 0% to 6% in 0.5pt steps, the only fit where all four sensitivities round to the published 0.1pt figures is a 10-year hold, end-year timing, escalator about 2.4% to 2.5%. Midpoint 2.45% used. Model: +1.85%, -1.81%, +2.44%, -2.25%.
2. NOI margin on base rent: 81.27%, so value equals $4,289.9m. Cross-check from Q3 actuals: (81,575 + 46,762 - 65,906) / 81,575 = 76.5%; the valuation also counts executed leases not yet paying (excluded from NTM rent).

## Out-of-sample test (10-K, Dec 31, 2025)
Regions (NTM rent $m, discount, cap, published GAV $m): Midwest 54.944, 7.5%, 5.9%, 712.42; Southeast 20.384, 8.2%, 5.9%, 586.42; Southwest 41.805, 7.8%, 6.0%, 594.63; West 107.867, 7.4%, 6.1%, 1,398.62. Total $3,292.09m (p.82, p.87).
Same margin and escalator: total $3,245.5m, -1.4%. Regions: Midwest +13%, Southeast -52%, Southwest -0.2%, West +12%. The Southeast was 95% leased (lease-up and leases not yet paying are in value, not in NTM rent). Shown on the site as an information row, not a match.

## Not used
eStruxture (Canada): owned by a Fengate-led consortium; ruled out.
