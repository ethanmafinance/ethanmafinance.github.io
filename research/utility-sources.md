# Regulated utility example: Toronto Hydro 2025-2029 (EB-2023-0195)

Sources opened 2026-11-18:
- Settlement Proposal, filed Aug 16, 2024: https://torontohydro.com/documents/d/guest/settlement-proposal
  - Table 7 (p. 18-19): settled rate base 5,879.7 / 6,213.1 / 6,576.1 / 6,967.6 / 7,327.9; average NFA 5,648.3 / 5,981.8 / 6,344.8 / 6,736.2 / 7,096.5; WCA 231.3 each year.
  - Table 9 (p. 20): settled ISA 616.3 / 639.7 / 726.5 / 697.5 / 778.0.
  - Table 13 (p. 22): depreciation 286.3 / 297.9 / 314.0 / 332.6 / 342.8.
  - p. 21: deemed structure 40% equity, 56% LTD, 4% STD.
  - Table 15 (p. 23): other revenue 48.23 to 52.21 (2.0% a year).
- Draft Rate Order, Nov 26, 2024: https://www.rds.oeb.ca/CMWebDrawer/Record/873331/File/document
  - p. 3: 2025 ROE 9.25%, STD 5.04%, LTD 3.91% to 3.83%.
  - p. 4 Table 1: OM&A 323.5 / 331.3 / 339.3 / 347.4 / 355.8; deemed interest 137.8 / 145.6 / 154.1 / 163.3 / 171.8; ROE 217.5 / 229.9 / 243.3 / 257.8 / 271.1; PILs 28.1 / 31.4 / 20.6 / 54.5 / 46.4; service RR 993.2 / 1,036.1 / 1,071.3 / 1,155.6 / 1,188.0; offsets 48.2 to 52.2; base RR 944.9 / 986.9 / 1,021.1 / 1,104.5 / 1,135.8; stretch -5.6 / -11.7 / -18.6 / -25.7; incremental capital stretch -2.1 / -4.3 / -6.7 / -9.2; revenue 944.9 / 979.1 / 1,005.1 / 1,079.1 / 1,100.9; total 5,109.1.
  - p. 5: OM&A index 2.41%.
- CRA corporation tax rates: federal 15% after reduction, Ontario 11.5%.

Solved (est.): opening NFA 5,483.3 (from 2025 average NFA); stretch 0.775% a year (2026-29 reductions over base RR are 0.780%, 0.783%, 0.764%, 0.768% per year since 2025).
Checks: all 16 within 1%; largest 2029 deemed interest +0.8% and 2029 average NFA +0.8% (the NFA roll-forward from ISA and depreciation runs slightly above the settled schedule, likely retirements or contributions not in the tables; inference).
Implied ROE rate base 2026: 229.9 / (0.4 x 9.25%) = 6,213.5 vs settled 6,213.1, so 9.25% applies to every plan year.
Not modelled: 2030+ plan (projected), actual vs deemed interest and tax, DVA balances, the ESM. No sale price: city-owned.
