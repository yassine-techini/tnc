import { describe, it, expect } from 'vitest';
import { checkLeaseAmount, projectAnnualLeaseYieldXof, dailyLeaseYieldXof } from './lease.js';

const base = { minimumG: 1, availableG: 500, acknowledged: true };

describe('checkLeaseAmount', () => {
  it('accepts a valid amount', () => {
    expect(checkLeaseAmount({ ...base, raw: '100' })).toEqual({
      grams: 100,
      valid: true,
      problem: null,
    });
  });

  it('accepts a comma as the decimal separator', () => {
    // What a French keyboard offers first. Refusing it looks like a broken field.
    expect(checkLeaseAmount({ ...base, raw: '10,5' })).toMatchObject({ grams: 10.5, valid: true });
  });

  it('refuses more than the wallet holds', () => {
    expect(checkLeaseAmount({ ...base, raw: '501' })).toMatchObject({
      valid: false,
      problem: 'OVER_BALANCE',
    });
    // Exactly the balance is allowed — lending everything is a choice, not a bug.
    expect(checkLeaseAmount({ ...base, raw: '500' }).valid).toBe(true);
  });

  it('refuses below the minimum, and accepts exactly the minimum', () => {
    expect(checkLeaseAmount({ ...base, raw: '0.9' })).toMatchObject({ problem: 'BELOW_MINIMUM' });
    expect(checkLeaseAmount({ ...base, raw: '1' }).valid).toBe(true);
  });

  it('refuses zero and negative amounts', () => {
    expect(checkLeaseAmount({ ...base, raw: '0' })).toMatchObject({ problem: 'NOT_A_NUMBER' });
    expect(checkLeaseAmount({ ...base, raw: '-5' })).toMatchObject({ problem: 'NOT_A_NUMBER' });
  });

  it('refuses text and an empty field distinctly', () => {
    expect(checkLeaseAmount({ ...base, raw: '' })).toMatchObject({ problem: 'EMPTY' });
    expect(checkLeaseAmount({ ...base, raw: '   ' })).toMatchObject({ problem: 'EMPTY' });
    expect(checkLeaseAmount({ ...base, raw: 'beaucoup' })).toMatchObject({
      problem: 'NOT_A_NUMBER',
    });
  });

  it('refuses to proceed until the terms are acknowledged', () => {
    // Lending gold away is not something to agree to by accident.
    expect(checkLeaseAmount({ ...base, raw: '100', acknowledged: false })).toMatchObject({
      grams: 100,
      valid: false,
      problem: 'NOT_ACKNOWLEDGED',
    });
  });

  it('reports the amount problem before the unticked box', () => {
    // Flagging the checkbox while the amount is still wrong points the user at
    // the wrong control.
    expect(
      checkLeaseAmount({ ...base, raw: '9999', acknowledged: false }).problem
    ).toBe('OVER_BALANCE');
  });

  it('refuses everything when the wallet is empty', () => {
    expect(checkLeaseAmount({ ...base, raw: '1', availableG: 0 })).toMatchObject({
      problem: 'OVER_BALANCE',
    });
  });
});

describe('projectAnnualLeaseYieldXof', () => {
  it('is principal x spot x rate', () => {
    // 100 g x 53 000 XOF x 6% = 318 000 XOF
    expect(
      projectAnnualLeaseYieldXof({ grams: 100, spotPerGramXof: 53_000, annualRate: 0.06 })
    ).toBe(318_000);
  });

  it('returns zero rather than a wrong figure when the price is unknown', () => {
    // No price means no defensible projection; showing 0 XOF beats showing NaN.
    expect(
      projectAnnualLeaseYieldXof({ grams: 100, spotPerGramXof: 0, annualRate: 0.06 })
    ).toBe(0);
    expect(
      projectAnnualLeaseYieldXof({ grams: 0, spotPerGramXof: 53_000, annualRate: 0.06 })
    ).toBe(0);
  });
});

describe('dailyLeaseYieldXof', () => {
  it('matches the Actual/365 the accrual job books', () => {
    // The same 871 XOF the API books for 100 g at 53 000 XOF and 6 %.
    expect(dailyLeaseYieldXof({ grams: 100, spotPerGramXof: 53_000, annualRate: 0.06 })).toBe(871);
  });

  it('is the annual projection divided by 365, to the rounding', () => {
    const args = { grams: 250, spotPerGramXof: 53_000, annualRate: 0.06 };
    const annual = projectAnnualLeaseYieldXof(args);
    expect(dailyLeaseYieldXof(args)).toBe(Math.round(annual / 365));
  });
});
