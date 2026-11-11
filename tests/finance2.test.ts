import { describe, it, expect } from 'vitest';
import { alreadyInvoiced, invoiceKey, applyPayment, ledgerSummary, planCreditApplication, reconcileInvoice, validMoney, creditMatches } from '../src/lib/finance';

const inv = { total: 150000, paid: 0, termId: 't1', structureId: 's1' };
describe('credits and allocation', () => {
  it('a learner who paid in advance does not owe the full amount', () => {
    const p = planCreditApplication(inv, [{ id: 'c1', remaining: 150000, termId: 't1', structureId: 's1', paidAt: '2026-08-01' }]);
    expect([p.paid, p.balance, p.status]).toEqual([150000, 0, 'paid']);
  });
  it('partial credit leaves a balance and keeps the invoice partial', () => {
    const p = planCreditApplication(inv, [{ id: 'c1', remaining: 50000 }]);
    expect([p.applied, p.balance, p.status]).toEqual([50000, 100000, 'partial']);
  });
  it('never applies more than the balance, and keeps the rest of the credit', () => {
    const p = planCreditApplication({ ...inv, paid: 140000 }, [{ id: 'c1', remaining: 50000 }]);
    expect(p.applications).toEqual([{ creditId: 'c1', amount: 10000 }]);
    expect(p.balance).toBe(0);
  });
  it('uses the oldest credit first and several instalments together', () => {
    const p = planCreditApplication(inv, [{ id: 'new', remaining: 100000, paidAt: '2026-09-01' }, { id: 'old', remaining: 100000, paidAt: '2026-07-01' }]);
    expect(p.applications).toEqual([{ creditId: 'old', amount: 100000 }, { creditId: 'new', amount: 50000 }]);
  });
  it('ignores credits meant for another term or fee category', () => {
    expect(planCreditApplication(inv, [{ id: 'x', remaining: 9999, termId: 't2' }]).applications).toEqual([]);
    expect(planCreditApplication(inv, [{ id: 'y', remaining: 9999, structureId: 's2' }]).applications).toEqual([]);
    expect(creditMatches({}, inv)).toBe(true);
  });
  it('ignores empty credits and already-paid invoices', () => {
    expect(planCreditApplication(inv, [{ id: 'z', remaining: 0 }]).applications).toEqual([]);
    expect(planCreditApplication({ ...inv, paid: 150000 }, [{ id: 'z', remaining: 500 }]).applications).toEqual([]);
  });
});

describe('one source of truth for balances', () => {
  it('total - payments = outstanding', () => {
    expect(reconcileInvoice({ total: 100000 }, [30000, 20000])).toEqual({ paid: 50000, balance: 50000, status: 'partial' });
    expect(reconcileInvoice({ total: 100000 }, [100000]).status).toBe('paid');
    expect(reconcileInvoice({ total: 100000 }, [-5, 0]).paid).toBe(0);
  });
  it('summary excludes cancelled invoices and reports credit separately', () => {
    const s = ledgerSummary([{ total: 100, paid: 40, status: 'partial' }, { total: 50, paid: 0, status: 'cancelled' }], [{ remaining: 25 }, { remaining: 0 }]);
    expect(s).toEqual({ billed: 100, paid: 40, outstanding: 60, creditAvailable: 25 });
  });
  it('rejects bad amounts', () => {
    expect([validMoney(100), validMoney(0), validMoney(-1), validMoney(NaN), validMoney(10.005), validMoney('5' as unknown)]).toEqual([true, false, false, false, false, false]);
    expect(() => applyPayment({ total: 10, paid: 0 }, -1)).toThrow();
    expect(() => applyPayment({ total: 10, paid: 0 }, 11)).toThrow();
  });
});

describe('duplicate invoice protection', () => {
  const st = { id: 's1', items: [{ label: 'Tuition' }, { label: 'Books' }] };
  it('finds learners already billed for the same category and term', () => {
    const have = alreadyInvoiced([
      { studentId: 'a', termId: 't1', structureId: 's1' },
      { studentId: 'b', termId: 't1', items: [{ label: 'Tuition' }, { label: 'Books' }] },   // legacy invoice without structureId
      { studentId: 'c', termId: 't2', structureId: 's1' },                                    // other term
      { studentId: 'd', termId: 't1', structureId: 's2' },                                    // other category
      { studentId: 'e', termId: 't1', structureId: 's1', status: 'cancelled' },               // cancelled does not count
    ], st, 't1');
    expect([...have].sort()).toEqual(['a', 'b']);
    expect(invoiceKey({ termId: 't1', structureId: 's1' })).toBe('t1|s1');
  });
});
