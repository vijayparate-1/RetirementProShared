import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://nigxjhhsyxcywtjwhbjp.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pZ3hqaGhzeXhjeXd0andoYmpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxMDMxNDUsImV4cCI6MjA4ODY3OTE0NX0.FDoOPCm9L44pJy_EnVd_7MTdJTtJVyddQqdMpwuzmNA';
const db = createClient(SUPABASE_URL, SUPABASE_ANON);
import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine, Area,
  AreaChart, PieChart, Pie, Cell, ComposedChart
} from "recharts";

// ── Income tax: ATO resident rates 2025-26
// Source: ato.gov.au/tax-rates-and-codes/tax-rates-australian-residents
// ── CGT calculation (50% discount if held > 12 months) ──
function calcCGT(gain, otherIncome, longTerm = true) {
  const taxableGain = longTerm ? gain * 0.5 : gain;
  const taxWithGain    = calcNetTax(otherIncome + taxableGain);
  const taxWithoutGain = calcNetTax(otherIncome);
  return Math.max(0, taxWithGain - taxWithoutGain);
}

// ── Super contribution tax (15% on concessional, Div 293 if income > $250k) ──
function calcSuperTax(concessional, totalIncome) {
  const baseTax  = concessional * 0.15;
  const div293   = totalIncome > 250000 ? Math.min(concessional, totalIncome - 250000) * 0.15 : 0;
  return Math.round(baseTax + div293);
}

// ── Low & Middle Income Tax Offset (LMITO — expired 2022-23, kept for history) ──
function calcLAMITO(inc) { return 0; } // expired — placeholder

// ── SAPTO: Seniors & Pensioners Tax Offset ──
function calcSAPTO(inc, married) {
  const maxOffset = married ? 1602 : 2230;
  const shadeIn   = married ? 28974 : 32279;
  const shadeOut  = married ? 50119 : 50119;
  if (inc <= shadeIn)  return maxOffset;
  if (inc >= shadeOut) return 0;
  return Math.max(0, maxOffset - (inc - shadeIn) * 0.125);
}

// ── Net tax for retiree (includes SAPTO) ──
function calcRetireeTax(inc, married) {
  return Math.max(0, calcIncomeTax(inc) + calcMedicareLevy(inc) - calcLITO(inc) - calcSAPTO(inc, married));
}
function calcIncomeTax(inc) {
  if (inc <= 18200)  return 0;
  if (inc <= 45000)  return (inc - 18200) * 0.16;
  if (inc <= 135000) return 4288 + (inc - 45000) * 0.30;
  if (inc <= 190000) return 31288 + (inc - 135000) * 0.37;
  return 51638 + (inc - 190000) * 0.45;
}
// ── Medicare levy: 2% above shade-in; nil ≤ $26,000 (2025-26, unchanged)
function calcMedicareLevy(inc) {
  if (inc <= 26000) return 0;
  if (inc <= 32500) return (inc - 26000) * 0.10;
  return inc * 0.02;
}
// ── LITO: 2025-26 (unchanged from 2022-23 onwards)
// Source: ato.gov.au/individuals-and-families/income-deductions-offsets-and-records/tax-offsets/low-income-tax-offset
function calcLITO(inc) {
  if (inc <= 37500) return 700;
  if (inc <= 45000) return 700 - (inc - 37500) * 0.05;
  if (inc <= 66667) return 325 - (inc - 45000) * 0.015;
  return 0;
}
function calcNetTax(inc) {
  return Math.max(0, calcIncomeTax(inc) + calcMedicareLevy(inc) - calcLITO(inc));
}
// ── Marginal rate: 2025-26 brackets
function getMarginalRate(inc) {
  if (inc <= 18200)  return 0;
  if (inc <= 45000)  return 0.16;
  if (inc <= 135000) return 0.30;
  if (inc <= 190000) return 0.37;
  return 0.45;
}
function getSGRate(year) {
  if (year <= 2024) return 0.115; // 11.5% applied from 1 Jul 2024
  if (year === 2025) return 0.115;
  return 0.12; // 12% from 1 Jul 2025 onwards
}
function getPreservationAge(birthYear) {
  if (birthYear <= 1959) return 55;
  if (birthYear === 1960) return 56;
  if (birthYear === 1961) return 57;
  if (birthYear === 1962) return 58;
  if (birthYear === 1963) return 59;
  return 60;
}
function getMinDrawdown(age) {
  if (age < 65) return 0.04;
  if (age < 75) return 0.05;
  if (age < 80) return 0.06;
  if (age < 85) return 0.07;
  if (age < 90) return 0.09;
  return 0.14;
}
// ── Age Pension: Services Australia rates effective 20 September 2025
// Single full: $1,178.70/fn × 26 = $30,646.20/yr
// Couple full:   $888.50/fn each × 26 × 2 = $46,202/yr combined
// Assets lower threshold (full pension starts tapering):
//   Single homeowner $321,500 | Single non-homeowner $579,500
//   Couple homeowner $481,500 | Couple non-homeowner $739,500
// Assets upper cutoff (pension = $0):
//   Single homeowner $714,500 | Single non-homeowner $972,500
//   Couple homeowner $1,074,000 | Couple non-homeowner $1,332,000
// Taper: $3 per fortnight per $1,000 excess = $78/yr per $1,000
// Income free area: Single $218/fn = $5,668/yr | Couple $380/fn = $9,880/yr
// Income taper: 50¢ per $1 above free area
const AP = {
  singleFull:            30646,
  coupleFull:            46202,
  assetsSingleHome:      321500,
  assetsSingleNoHome:    579500,
  assetsCoupleHome:      481500,
  assetsCoupleNoHome:    739500,
  cutoffSingleHome:      714500,
  cutoffSingleNoHome:    972500,
  cutoffCoupleHome:     1074000,
  cutoffCoupleNoHome:   1332000,
  incSingle:              5668,
  incCouple:              9880,
};
function calcAgePension(age, married, homeowner, assessableAssets, assessableIncome, enabled, financialAssets = 0, hasWorkBonus = false) {
  if (!enabled || age < 67) return 0;
  const full    = married ? AP.coupleFull     : AP.singleFull;
  const lower   = married ? (homeowner ? AP.assetsCoupleHome   : AP.assetsCoupleNoHome)
                          : (homeowner ? AP.assetsSingleHome   : AP.assetsSingleNoHome);
  const cutoff  = married ? (homeowner ? AP.cutoffCoupleHome   : AP.cutoffCoupleNoHome)
                          : (homeowner ? AP.cutoffSingleHome   : AP.cutoffSingleNoHome);
  const incFree = married ? AP.incCouple : AP.incSingle;
  if (assessableAssets >= cutoff) return 0;

  // ── Assets test taper ──
  const assetExcess     = Math.max(0, assessableAssets - lower);
  const assetReduction  = (assetExcess / 1000) * 78;

  // ── Deeming on financial assets (Centrelink deems income regardless of actual return) ──
  const deemLower = married ? 103800 : 62600;   // FY2025-26 deeming thresholds
  const deemRateL = 0.0025;                      // 0.25% on amount up to threshold
  const deemRateH = 0.0225;                      // 2.25% on amount above threshold
  const financialForDeem = Math.max(0, financialAssets);
  const deemedIncome = financialForDeem <= deemLower
    ? financialForDeem * deemRateL
    : (deemLower * deemRateL) + ((financialForDeem - deemLower) * deemRateH);

  // ── Work Bonus — $300/fn ($7,800/yr) offset on employment income ──
  const workBonusOffset = hasWorkBonus ? 7800 : 0;
  const totalAssessableIncome = Math.max(0, assessableIncome + deemedIncome - workBonusOffset);

  // ── Income test taper — 50¢ per $1 above free area ──
  const incExcess      = Math.max(0, totalAssessableIncome - incFree);
  const incReduction   = incExcess * 0.50;

  // ── Take the lower pension (most restrictive test wins) ──
  const fromAssets = Math.max(0, full - assetReduction);
  const fromIncome = Math.max(0, full - incReduction);
  const pension    = Math.min(fromAssets, fromIncome);

  return Math.round(Math.max(0, pension));
}
function runProjection(inp) {
  const { currentAge, retirementAge, lifeExpectancy, birthYear, married, homeowner,
    superBalance, voluntarySuper, extraSuper, isSMSF, smsfAdminCost,
    outsideSuper, dividendYield, annualSavingsRate, properties,
    annualIncome, partnerIncome, otherIncome, annualExpenses, retirementExpenses,
    windfalls, bigExpenses, healthcareExpenses, agedCareAge, agedCareCost,
    debts, rateSchedule, inflationRate, agePensionEnabled, withdrawalOrder,
    downsizeEnabled, downsizeAmount, downsizeSalePrice,
    ttrEnabled, ttrSalarySacrificeExtra } = inp;

  const baseReturn = inp.returnRate;
  const preservAge = getPreservationAge(birthYear);
  const currentYear = new Date().getFullYear();
  const data = [];

  // Downsizer: one-time lump sum added to super at start (age 55+)
  const downsizeValidAmt = (downsizeEnabled && currentAge >= 55)
    ? Math.min(downsizeAmount || 0, Math.min(downsizeSalePrice || 0, married ? 600000 : 300000))
    : 0;

  let super_ = superBalance + downsizeValidAmt;
  let superPension = 0;
  let outside = outsideSuper;

  // ── NEW: PPOR ──────────────────────────────────────────
  let pporValue    = inp.ppor?.value    || 0;
  let pporMortgage = inp.ppor?.mortgage || 0;
  const pporGrowth = inp.ppor?.growthRate   || 0.04;
  const pporRate   = inp.ppor?.mortgageRate || 0.065;

  // ── NEW: financial asset balances ─────────────────────
  const assetItems = inp.assetItems || [];
  let assetBals    = assetItems.map(a => a.value || 0);

  // ── NEW: offset accounts reduce mortgage interest ──────
  const totalOffset = (inp.offsetAccounts || []).reduce((s,o) => s+(o.balance||0), 0);
  let props = (properties || []).map(p => ({ ...p, value: p.value, mortgage: p.mortgage || 0, loanRemaining: p.loanYears || 0 }));
  let debtsArr = (debts || []).map(d => ({ ...d }));

  for (let i = 0; i <= lifeExpectancy - currentAge; i++) {
    const age = currentAge + i;
    const year = currentYear + i;
    const inflFactor = Math.pow(1 + inflationRate, i);
    const isRetired = age >= retirementAge;
    const inPensionPhase = isRetired && age >= preservAge;
    let returnRate = baseReturn;
    if (rateSchedule && rateSchedule.length > 0) {
      const sched = rateSchedule.slice().sort((a, b) => a.age - b.age);
      for (const s of sched) { if (age >= s.age) returnRate = s.rate / 100; }
    }
    const smsfCost = isSMSF ? (smsfAdminCost || 3500) : 0;

    if (inPensionPhase && superPension === 0 && super_ > 0) { superPension = super_; super_ = 0; }

    if (inPensionPhase) superPension = Math.max(0, superPension * (1 + returnRate) - smsfCost);
    else super_ = Math.max(0, super_ * (1 + returnRate * 0.85) - smsfCost);

    const divIncome = outside * (dividendYield || 0.04);
    outside = outside * (1 + returnRate) + divIncome * 0.15;

    // ── NEW: grow PPOR ─────────────────────────────────
    pporValue    = pporValue * (1 + pporGrowth);
    pporMortgage = Math.max(0, pporMortgage - (pporMortgage * pporRate * 0.3));

    // ── NEW: grow each financial asset ─────────────────
    assetBals = assetBals.map((bal, i) => {
      const item = assetItems[i];
      return Math.max(0, bal * (1 + (item.returnRate || 0)) + (item.annualContrib || 0));
    });
    const totalAssetItems = assetBals.reduce((s,v) => s+v, 0);
    const offsetBenefit   = totalOffset * (inp.mortgageRate || 0.065);

    let totalRentalIncome = 0, totalPropertyEquity = 0, totalPropertyValue = 0;
    props = props.map(p => {
      const isUnderConstruction = p.isNewBuild && age < (p.buildCompleteAge || currentAge);
      const pv = isUnderConstruction ? p.value : p.value * (1 + (inp.propertyGrowthRate || 0.04));
      let pmortgage = p.mortgage;
      if (pmortgage > 0 && p.loanRemaining > 0) {
        const r = 0.06; const interest = pmortgage * r;
        const payment = pmortgage * r / (1 - Math.pow(1 + r, -p.loanRemaining));
        pmortgage = Math.max(0, pmortgage - (payment - interest));
      }
      const rentalNet = isUnderConstruction ? 0 : (p.weeklyRent || 0) * 52 * (1 - (p.expenseRatio || 0.25));
      totalRentalIncome += rentalNet;
      totalPropertyEquity += pv - pmortgage;
      totalPropertyValue += pv;
      return { ...p, value: pv, mortgage: pmortgage, loanRemaining: Math.max(0, p.loanRemaining - 1) };
    });

    debtsArr = debtsArr.map(d => {
      if (d.balance <= 0) return d;
      const interest = d.balance * (d.rate / 100);
      return { ...d, balance: Math.max(0, d.balance + interest - (d.monthlyRepayment || 0) * 12) };
    });
    const totalDebtBalance = debtsArr.reduce((s, d) => s + d.balance, 0);

    let netSalary = 0, superContrib = 0;
    if (!isRetired) {
      const sg = Math.min(annualIncome * getSGRate(year), 20000);
      // TTR: extra salary sacrifice during preservation age window (up to concessional cap)
      const ttrExtra = (ttrEnabled && age >= preservAge && age < retirementAge)
        ? Math.min(ttrSalarySacrificeExtra || 0, Math.max(0, 30000 - sg - (voluntarySuper || 0)))
        : 0;
      const salarySacrifice = Math.min((voluntarySuper || 0) + ttrExtra, Math.max(0, 30000 - sg));
      superContrib = sg + salarySacrifice;
      const tax = calcNetTax(annualIncome - salarySacrifice) + calcNetTax(partnerIncome || 0);
      netSalary = (annualIncome - salarySacrifice + (partnerIncome || 0)) - tax;
      if (inPensionPhase) superPension += superContrib; else super_ += superContrib;
      outside += netSalary * (annualSavingsRate || 0.05);
      if ((extraSuper || 0) > 0) { if (inPensionPhase) superPension += extraSuper; else super_ += extraSuper; }
    }

    const agePension = calcAgePension(age, married, homeowner,
      Math.max(0, superPension + outside + totalPropertyEquity - totalDebtBalance - (homeowner ? (props.find(p => p.isPrimary)?.value || 0) : 0)),
      totalRentalIncome + (otherIncome || 0), agePensionEnabled);

    const windfall = (windfalls || []).filter(w => w.age === age).reduce((s, w) => s + w.amount, 0);
    const bigExp = (bigExpenses || []).filter(w => w.age === age).reduce((s, w) => s + w.amount, 0);
    outside += windfall - bigExp;

    const healthExp = age >= 65 ? (healthcareExpenses || 0) * inflFactor : 0;
    const agedCareExp = age >= (agedCareAge || 85) ? (agedCareCost || 0) * inflFactor : 0;
    const livingExp = (isRetired ? retirementExpenses : annualExpenses) * inflFactor;
    const totalExp = livingExp + healthExp + agedCareExp;
    const totalIncomeSrc = (isRetired ? 0 : netSalary) + agePension + totalRentalIncome + (otherIncome || 0);
    const gap = Math.max(0, totalExp - totalIncomeSrc);

    if (isRetired && gap > 0) {
      const order = withdrawalOrder || ["super", "outside"];
      let remaining = gap;
      for (const src of order) {
        if (remaining <= 0) break;
        if (src === "outside" && outside > 0) { const d = Math.min(outside, remaining); outside -= d; remaining -= d; }
        else if (src === "super") {
          if (superPension > 0) { const d = Math.min(superPension, remaining); superPension -= d; remaining -= d; }
          else if (super_ > 0) { const d = Math.min(super_, remaining); super_ -= d; remaining -= d; }
        }
      }
    }
    if (inPensionPhase && superPension > 0) {
      const minDraw = superPension * getMinDrawdown(age);
      const alreadyDrawn = Math.min(gap, superPension);
      if (alreadyDrawn < minDraw) { const extra = minDraw - alreadyDrawn; superPension = Math.max(0, superPension - extra); outside += extra; }
    }

    const pporEquity = Math.max(0, pporValue - pporMortgage);
    const netWorth = Math.max(0, super_) + Math.max(0, superPension) + Math.max(0, outside)
      + totalAssetItems + totalPropertyEquity + pporEquity - totalDebtBalance;
    const investableNetWorth = Math.max(0, super_) + Math.max(0, superPension)
      + Math.max(0, outside) + totalAssetItems + totalPropertyEquity - totalDebtBalance;
    const pensionAssessable = Math.max(0, outside) + totalAssetItems + totalPropertyEquity
      + (age >= 67 ? Math.max(0, super_) + Math.max(0, superPension) : 0);
    data.push({
      age, year,
      super: Math.round(Math.max(0, super_)),
      superPension: Math.round(Math.max(0, superPension)),
      outside: Math.round(Math.max(0, outside)),
      propertyEquity: Math.round(Math.max(0, totalPropertyEquity)),
      totalPropertyValue: Math.round(totalPropertyValue),
      pporValue: Math.round(pporValue),
      pporEquity: Math.round(pporEquity),
      totalAssetItems: Math.round(totalAssetItems),
      offsetBenefit: Math.round(offsetBenefit),
      investableNetWorth: Math.round(investableNetWorth),
      pensionAssessable: Math.round(pensionAssessable),
      netWorth: Math.round(netWorth),
      expenses: Math.round(totalExp), livingExp: Math.round(livingExp),
      income: Math.round(totalIncomeSrc),
      agePension: Math.round(agePension),
      rentalIncome: Math.round(totalRentalIncome),
      superContrib: Math.round(superContrib),
      totalDebt: Math.round(Math.max(0, totalDebtBalance)),
      healthExp: Math.round(healthExp + agedCareExp),
      salaryIncome: Math.round(age < inp.retirementAge ? (inp.annualIncome || 0) : 0),
      partnerIncome: Math.round(age < inp.retirementAge ? (inp.partnerIncome || 0) : 0),
      otherIncome: Math.round(inp.otherIncome || 0),
      dividendIncome: Math.round((outside || 0) * (inp.dividendYield || 0.035)),
      tdInterest: Math.round(
        ((inp.assetItems || []).find(a => a.type === "term_deposit")?.value || 0)
        * ((inp.assetItems || []).find(a => a.type === "term_deposit")?.returnRate || 0.045)
      ),
      superDrawdown: Math.round(
        age >= inp.retirementAge
          ? Math.max(0, totalExp - agePension - totalRentalIncome)
          : 0
      ),
      surplus: Math.round(totalIncomeSrc - totalExp),
    });
  }
  return data;
}

function runMonteCarlo(inp, runs = 400) {
  let successes = 0, bankruptcies = 0;
  const allRuns = [];
  const finalValues = [];

  // ── Build weighted portfolio return & volatility from asset items ──
  const assetItems   = (inp.assetItems || []).filter(a => (a.value || 0) > 0);
  const totalAssetVal = assetItems.reduce((s, a) => s + (a.value || 0), 0);

  // Weighted mean return across asset classes (falls back to inp.returnRate)
  const weightedReturn = totalAssetVal > 0
    ? assetItems.reduce((s, a) => s + (a.value / totalAssetVal) * (a.returnRate || 0), 0)
    : (inp.returnRate || 0.075);

  // Weighted volatility (std dev) across asset classes (falls back to 10%)
  const weightedVol = totalAssetVal > 0
    ? assetItems.reduce((s, a) => s + (a.value / totalAssetVal) * (a.volatility || 0.10), 0)
    : 0.10;

  // Blended portfolio: super uses inp.returnRate, outside-super uses weighted asset returns
  const totalPort     = (inp.superBalance || 0) + (inp.outsideSuper || 0) + totalAssetVal;
  const superWeight   = totalPort > 0 ? (inp.superBalance || 0) / totalPort : 0.5;
  const outsideWeight = totalPort > 0 ? ((inp.outsideSuper || 0) + totalAssetVal) / totalPort : 0.5;

  const blendedReturn = superWeight * (inp.returnRate || 0.075)
                      + outsideWeight * weightedReturn;
  const blendedVol    = superWeight * 0.10
                      + outsideWeight * weightedVol;

  // Use Box-Muller transform for normally distributed returns (more realistic than uniform)
  const randn = () => {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  };

  for (let r = 0; r < runs; r++) {
    let s = inp.superBalance + inp.outsideSuper + totalAssetVal;
    const results = [];
    let wentBankrupt = false;
    for (let i = 0; i <= inp.lifeExpectancy - inp.currentAge; i++) {
      const age = inp.currentAge + i;
      // Normally distributed return using blended portfolio parameters
      const ret = blendedReturn + randn() * blendedVol;
      const inf = (inp.inflationRate || 0.03) + (Math.random() - 0.5) * 0.02;
      const inflFactor = Math.pow(1 + inf, i);
      const isRet = age >= inp.retirementAge;
      const totalRent = (inp.properties || []).reduce((sum, p) => sum + (p.weeklyRent || 0) * 52 * 0.75, 0);
      const ap = calcAgePension(age, inp.married, inp.homeowner, s * 0.7, totalRent, inp.agePensionEnabled);
      const exp = (isRet ? inp.retirementExpenses : inp.annualExpenses) * inflFactor;
      const sg = isRet ? 0 : inp.annualIncome * getSGRate(new Date().getFullYear() + i);
      if (!isRet) s += sg + (inp.voluntarySuper || 0);
      s *= 1 + ret;
      if (isRet) { const gap = exp - ap - totalRent - (inp.otherIncome || 0); if (gap > 0) s = Math.max(0, s - gap); }
      if (s <= 0 && isRet && !wentBankrupt) wentBankrupt = true;
      results.push(Math.max(0, s));
    }
    allRuns.push(results);
    const final = results[results.length - 1];
    finalValues.push(final);
    if (final > 0) successes++;
    if (wentBankrupt) bankruptcies++;
  }

  const yrs = inp.lifeExpectancy - inp.currentAge + 1;
  const p10 = [], p25 = [], p50 = [], p75 = [], p90 = [];
  for (let i = 0; i < yrs; i++) {
    const vals = allRuns.map(r => r[i] || 0).sort((a, b) => a - b);
    const g = (p) => vals[Math.floor(runs * p)] || 0;
    p10.push({ age: inp.currentAge + i, value: g(0.1) });
    p25.push({ age: inp.currentAge + i, value: g(0.25) });
    p50.push({ age: inp.currentAge + i, value: g(0.5) });
    p75.push({ age: inp.currentAge + i, value: g(0.75) });
    p90.push({ age: inp.currentAge + i, value: g(0.9) });
  }

  const sortedFinal = [...finalValues].sort((a, b) => a - b);
  const mean = finalValues.reduce((s, v) => s + v, 0) / runs;
  const variance = finalValues.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / runs;
  const stdDev = Math.sqrt(variance);
  const worst = sortedFinal[0];
  const best  = sortedFinal[sortedFinal.length - 1];

  return {
    successRate: successes / runs,
    bankruptcyRate: bankruptcies / runs,
    mean, stdDev, worst, best,
    runs,
    p10, p25, p50, p75, p90,
  };
}

const aud = (n, d = 0) => {
  if (isNaN(n) || n === undefined) return "A$0";
  const abs = Math.abs(n);
  const str = abs.toLocaleString("en-AU", { maximumFractionDigits: d });
  return n < 0 ? `-A$${str}` : `A$${str}`;
};
const pct = n => `${((n || 0) * 100).toFixed(1)}%`;
const uid = () => Math.random().toString(36).slice(2, 8);

const C = {
  bg: "#f4faf6", card: "#ffffff", border: "#cde0d4",
  super: "#2563eb", pension: "#7c3aed", prop: "#d97706",
  outside: "#059669", debt: "#dc2626", health: "#db2777",
  main: "#16a34a", smsf: "#0284c7", text: "#1a2e1d", muted: "#4b7055",
  warn: "#d97706", ok: "#16a34a", bad: "#dc2626"
};

const TT = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#ffffff", border: `1px solid ${C.main}66`, borderRadius: 8, padding: "8px 12px", fontSize: 11, boxShadow:"0 2px 8px #0001" }}>      <div style={{ color: C.muted, marginBottom: 5, borderBottom: `1px solid ${C.border}`, paddingBottom: 4 }}>Age {label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 14, marginBottom: 2 }}>
          <span style={{ color: C.muted }}>{p.name}</span>
          <span style={{ color: p.color, fontWeight: 700 }}>{typeof p.value === "number" && Math.abs(p.value) > 100 ? aud(p.value) : p.value}</span>
        </div>
      ))}
    </div>
  );
};

// ── Reusable SVG Sankey Chart ──────────────────────────────────────────
const SankeyChart = ({ nodes, links, width = 600, height = 340 }) => {
  const COL_W = 140;
  const NODE_H_MIN = 24;
  const PAD = 8;

  // Group nodes by column
  const cols = [...new Set(nodes.map(n => n.col))].sort((a,b)=>a-b);
  const colNodes = cols.map(c => nodes.filter(n => n.col === c));

  // Calculate node heights proportional to value
  const maxVal = Math.max(...nodes.map(n => n.value || 1));
  const totalH = height - (nodes.filter(n=>n.col===0).length - 1) * PAD;

  // Assign y positions per column
  const positioned = {};
  colNodes.forEach((cnodes, ci) => {
    const colTotal = cnodes.reduce((s,n) => s + (n.value||0), 0) || 1;
    let y = 20;
    cnodes.forEach(n => {
      const h = Math.max(NODE_H_MIN, ((n.value||0) / colTotal) * (height - cnodes.length * PAD - 40));
      positioned[n.id] = { ...n, y, h, x: ci * (width / cols.length) + 10 };
      y += h + PAD;
    });
  });

  // Draw curved links between nodes
  const drawnLinks = links.map((lk, i) => {
    const src = positioned[lk.source];
    const tgt = positioned[lk.target];
    if (!src || !tgt) return null;
    const srcTotal = links.filter(l=>l.source===lk.source).reduce((s,l)=>s+(l.value||0),0)||1;
    const tgtTotal = links.filter(l=>l.target===lk.target).reduce((s,l)=>s+(l.value||0),0)||1;
    const srcH = (lk.value / srcTotal) * src.h;
    const tgtH = (lk.value / tgtTotal) * tgt.h;

    // Track offsets
    if (!src._outY) src._outY = src.y;
    if (!tgt._inY)  tgt._inY  = tgt.y;
    const sy = src._outY;
    const ty = tgt._inY;
    src._outY += srcH;
    tgt._inY  += tgtH;

    const x1 = src.x + COL_W - 10;
    const x2 = tgt.x;
    const cx = (x1 + x2) / 2;

    return (
      <g key={i}>
        <path
          d={`M${x1},${sy} C${cx},${sy} ${cx},${ty} ${x2},${ty}
             L${x2},${ty+tgtH} C${cx},${ty+tgtH} ${cx},${sy+srcH} ${x1},${sy+srcH} Z`}
          fill={lk.color || src.color || "#ccc"}
          opacity={0.35}
        />
      </g>
    );
  });

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`}
      style={{ overflow:"visible", fontFamily:"monospace" }}>
      {drawnLinks}
      {Object.values(positioned).map(n => (
        <g key={n.id}>
          <rect x={n.x} y={n.y} width={COL_W-10} height={n.h}
            rx={4} fill={n.color} opacity={0.9} />
          <text x={n.x + (COL_W-10)/2} y={n.y + n.h/2 - 5}
            textAnchor="middle" fontSize={9} fontWeight={700} fill="white">
            {n.label}
          </text>
          <text x={n.x + (COL_W-10)/2} y={n.y + n.h/2 + 8}
            textAnchor="middle" fontSize={8} fill="white" opacity={0.9}>
            {aud(n.value)}
          </text>
        </g>
      ))}
    </svg>
  );
};
const KPI = ({ label, value, sub, color = C.main, size = 20 }) => (
  <div style={{ background: C.card, border: `1px solid ${color}30`, borderTop: `2px solid ${color}`, borderRadius: 10, padding: "12px 14px" }}>
    <div style={{ fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>{label}</div>
    <div style={{ fontSize: size, fontWeight: 900, color, lineHeight: 1 }}>{value}</div>
    {sub && <div style={{ fontSize: 10, color: C.muted, marginTop: 5 }}>{sub}</div>}
  </div>
);

const Card = ({ title, icon, color = C.main, children, action }) => (
  <div style={{ background: C.card, border: `1px solid ${C.border}`, borderTop: `2px solid ${color}`, borderRadius: 12, padding: 18, marginBottom: 16 }}>
    {title && (
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {icon && <span style={{ fontSize: 15 }}>{icon}</span>}
          <span style={{ fontSize: 11, fontWeight: 800, color, textTransform: "uppercase", letterSpacing: "0.1em" }}>{title}</span>
        </div>
        {action}
      </div>
    )}
    {children}
  </div>
);

const Sld = ({ label, value, min, max, step = 1, onChange, fmt2 = v => v, note, color = C.main }) => (
  <div style={{ marginBottom: 14 }}>
    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
      <span style={{ fontSize: 11, color: C.muted }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 700, color, fontFamily: "monospace" }}>{fmt2(value)}</span>
    </div>
    <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))}
      style={{ width: "100%", accentColor: color, cursor: "pointer" }} />
    {note && <div style={{ fontSize: 9, color: "#4b7055", marginTop: 2 }}>{note}</div>}
  </div>
);

const Fld = ({ label, value, onChange, pre = "A$", suf, note, type = "number" }) => (
  <div style={{ marginBottom: 11 }}>
    {label && <label style={{ display: "block", fontSize: 10, color: C.muted, marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</label>}
    <div style={{ display: "flex", alignItems: "center", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, overflow: "hidden" }}>
      {pre && <span style={{ padding: "5px 7px", color: C.muted, fontSize: 11, borderRight: `1px solid ${C.border}` }}>{pre}</span>}
      <input type={type} value={value} onChange={e => onChange(type === "number" ? (Number(e.target.value) || 0) : e.target.value)}
        style={{ flex: 1, background: "none", border: "none", outline: "none", padding: "5px 8px", color: C.text, fontSize: 12, fontFamily: "monospace" }} />
      {suf && <span style={{ padding: "5px 7px", color: C.muted, fontSize: 11, borderLeft: `1px solid ${C.border}` }}>{suf}</span>}
    </div>
    {note && <div style={{ fontSize: 9, color: "#4b7055", marginTop: 2 }}>{note}</div>}
  </div>
);

const Tog = ({ label, value, onChange, note }) => (
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, padding: "7px 0", borderBottom: `1px solid ${C.border}` }}>
    <div>
      <div style={{ fontSize: 11, color: C.text }}>{label}</div>
      {note && <div style={{ fontSize: 9, color: C.muted }}>{note}</div>}
    </div>
    <button onClick={() => onChange(!value)} style={{ background: value ? C.ok : C.border, border: "none", borderRadius: 20, width: 42, height: 22, cursor: "pointer", position: "relative", transition: "background 0.2s", flexShrink: 0 }}>
      <div style={{ position: "absolute", top: 3, left: value ? 21 : 3, width: 16, height: 16, borderRadius: "50%", background: "white", transition: "left 0.2s" }} />
    </button>
  </div>
);

const Row = ({ k, v, color, bold }) => (
  <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px solid ${C.border}`, fontSize: 11 }}>
    <span style={{ color: C.muted }}>{k}</span>
    <span style={{ color: color || C.text, fontFamily: "monospace", fontWeight: bold ? 800 : 500 }}>{v}</span>
  </div>
);

const Btn = ({ onClick, children, color = C.main, small }) => (
  <button onClick={onClick} style={{ background: `${color}22`, border: `1px solid ${color}55`, borderRadius: 6, padding: small ? "3px 8px" : "6px 14px", color, fontSize: small ? 10 : 12, fontWeight: 700, cursor: "pointer" }}>
    {children}
  </button>
);

const Badge = ({ children, color = C.main }) => (
  <span style={{ background: `${color}22`, border: `1px solid ${color}44`, borderRadius: 20, padding: "2px 8px", fontSize: 10, color, fontWeight: 700 }}>{children}</span>
);

const AlertBox = ({ icon, msg, color }) => (
  <div style={{ display: "flex", gap: 10, padding: "10px 14px", borderRadius: 8, background: `${color}11`, border: `1px solid ${color}33`, borderLeft: `3px solid ${color}`, fontSize: 11, lineHeight: 1.6, marginBottom: 8 }}>
    <span style={{ fontSize: 14, flexShrink: 0 }}>{icon}</span>
    <span style={{ color: "#374151" }}>{msg}</span>
  </div>
);

const TABS = [
  { id: "dashboard", label: "🏠 Dashboard" },
 { id: "inputs", label: "⚙️ Personal" },
  { id: "assets", label: "🏦 Assets" },
  { id: "properties", label: "🏘️ Properties" },
  { id: "super", label: "🦘 Super & SMSF" },
{ id: "superstrategy", label: "🎯 Super Strategy" },
  { id: "ttr", label: "🔄 TTR Strategy" },
  { id: "annuity", label: "💰 Annuity" },
  { id: "tax", label: "🧾 Tax" },
  { id: "centrelink", label: "🏛️ Centrelink" },
  { id: "debts", label: "💳 Debts" },
  { id: "events", label: "🎯 Life Events" },
  { id: "healthcare", label: "🏥 Healthcare" },
  { id: "rates", label: "📐 Rates & Scenarios" },
  { id: "cashflow", label: "💰 Cash Flow" },
  { id: "montecarlo", label: "🎲 Monte Carlo" },
  { id: "agepension", label: "👴 Age Pension" },
  { id: "estate", label: "🏛️ Estate" },
  { id: "wellness", label: "💚 Wellness" },
  { id: "reports", label: "📋 Reports" },
  { id: "networth", label: "💰 Net Worth" },
  { id: "tests", label: "🧪 Tests", hidden: true },
  { id: "tests2", label: "🔬 Tests 2", hidden: true },
];

export default function App() {
  const [tab, setTab] = useState("dashboard");
  const [pdfLoading, setPdfLoading] = useState(false);
  const THIS_YEAR = new Date().getFullYear();
  // Born 1981 = age 45 in 2026 — single source of truth
  const DEFAULT_BIRTH_YEAR = THIS_YEAR - 45;

  const defInp = {
    currentAge: 45, retirementAge: 65, lifeExpectancy: 90, birthYear: DEFAULT_BIRTH_YEAR,
    married: false, homeowner: true,
    superBalance: 280000, voluntarySuper: 10000, extraSuper: 0,
    isSMSF: false, smsfAdminCost: 3500,
    outsideSuper: 80000, dividendYield: 0.04, annualSavingsRate: 0.08,
    ppor: {
      address: "", value: 0, mortgage: 0,
      mortgageRate: 0.065, growthRate: 0.04, isPPOR: true,
    },
    assetItems: [
      { id:"a1", type:"shares_au",    label:"ASX / ETF Portfolio",     value:0, annualContrib:0, returnRate:0.095, volatility:0.16,  notes:"" },
      { id:"a2", type:"shares_intl",  label:"International Shares",    value:0, annualContrib:0, returnRate:0.105, volatility:0.17,  notes:"" },
      { id:"a3", type:"gold",         label:"Gold / Precious Metals",  value:0, annualContrib:0, returnRate:0.06,  volatility:0.15,  notes:"" },
      { id:"a4", type:"crypto",       label:"Bitcoin / Crypto",        value:0, annualContrib:0, returnRate:0.15,  volatility:0.55,  notes:"" },
      { id:"a5", type:"term_deposit", label:"Term Deposits / Cash",    value:0, annualContrib:0, returnRate:0.045, volatility:0.005, notes:"" },
      { id:"a6", type:"jewelry",      label:"Jewelry / Collectibles",  value:0, annualContrib:0, returnRate:0.03,  volatility:0.10,  notes:"" },
      { id:"a7", type:"vehicle",      label:"Vehicle / Car",           value:0, annualContrib:0, returnRate:-0.08, volatility:0.05,  notes:"" },
    ],
    offsetAccounts: [],
    properties: [
      { id: "p1", label: "Primary Residence", value: 900000, mortgage: 350000, weeklyRent: 0, loanYears: 22, expenseRatio: 0.25, isNewBuild: false, buildCompleteAge: 45, constructionCost: 0, isPrimary: true },
    ],
    annualIncome: 120000, partnerIncome: 0, otherIncome: 0,
    annualExpenses: 70000, retirementExpenses: 55000,
    healthcareExpenses: 5000, agedCareAge: 85, agedCareCost: 60000,
    debts: [], windfalls: [], bigExpenses: [],
    returnRate: 0.075, inflationRate: 0.03, propertyGrowthRate: 0.04,
    rateSchedule: [],
    agePensionEnabled: true,
    withdrawalOrder: ["super", "outside"],
    estateHasWill: false, estateHasPOA: false, estateHasACD: false,
    estateHasSuper: false, estateHasTrust: false,
    // Downsizer contribution
    downsizeEnabled: false, downsizeSalePrice: 900000, downsizeAmount: 300000,
    // TTR strategy
    ttrEnabled: false, ttrIncomeStream: 0, ttrSalarySacrificeExtra: 0,
  };

  const [inp, setInp] = useState(defInp);
  const set = useCallback((k) => (v) => setInp(p => ({ ...p, [k]: v })), []);
  const setNested = useCallback((k, id, field, val) =>
    setInp(p => ({ ...p, [k]: p[k].map(item => item.id === id ? { ...item, [field]: val } : item) })), []);

  const [sankeyMode, setSankeyMode] = useState("simple"); // "simple" | "detailed"
  const [nwSankeyMode, setNwSankeyMode] = useState("simple");
  const [session, setSession] = useState(null);
const [authEmail, setAuthEmail] = useState('');
const [authPassword, setAuthPassword] = useState('');
const [authError, setAuthError] = useState('');
const [authMode, setAuthMode] = useState('login'); // 'login' | 'signup'
const [saving, setSaving] = useState(false);
const [lastSaved, setLastSaved] = useState(null);
const [dbLoaded, setDbLoaded] = useState(false);
  const [readinessOpen, setReadinessOpen] = useState(false);
  const [spendOpen, setSpendOpen] = useState(false);
  const [spendCategories, setSpendCategories] = useState([
    { id:"s1", label:"Housing & Utilities",   preCurrent:18000, preRetire:12000, icon:"🏠", color:"#0891b2" },
    { id:"s2", label:"Food & Groceries",       preCurrent:12000, preRetire:10000, icon:"🛒", color:"#16a34a" },
    { id:"s3", label:"Transport & Car",        preCurrent:8000,  preRetire:5000,  icon:"🚗", color:"#d97706" },
    { id:"s4", label:"Health & Medical",       preCurrent:3000,  preRetire:6000,  icon:"🏥", color:"#db2777" },
    { id:"s5", label:"Leisure & Entertainment",preCurrent:6000,  preRetire:8000,  icon:"🎭", color:"#7c3aed" },
    { id:"s6", label:"Travel & Holidays",      preCurrent:5000,  preRetire:10000, icon:"✈️", color:"#0284c7" },
    { id:"s7", label:"Insurance",              preCurrent:4000,  preRetire:3000,  icon:"🛡️", color:"#4b7055" },
    { id:"s8", label:"Other / Misc",           preCurrent:4000,  preRetire:4000,  icon:"📦", color:"#6b7280" },
  ]);
  const [scenB, setScenB] = useState({ retirementAge: 60, retirementExpenses: 65000, returnRate: 0.075, inflationRate: 0.03 });
  const [scenBActive, setScenBActive] = useState(false);
  const [scenarios, setScenarios] = useState([
    { id:"s1", name:"Scenario B — Early Retire",   color:"#ea580c", active:true,
      retirementAge: 60, superBalance: null, retirementExpenses: 65000,
      propertyGrowthRate: 0.04, returnRate: 0.075 },
    { id:"s2", name:"Scenario C — Conservative",   color:"#7c3aed", active:true,
      retirementAge: 67, superBalance: null, retirementExpenses: 55000,
      propertyGrowthRate: 0.03, returnRate: 0.055 },
    { id:"s3", name:"Scenario D — Optimistic",     color:"#0891b2", active:false,
      retirementAge: 63, superBalance: null, retirementExpenses: 72000,
      propertyGrowthRate: 0.06, returnRate: 0.095 },
  ]);
  const [mcRuns, setMcRuns] = useState(400);

  const [taxVizOpen, setTaxVizOpen] = useState(false);
  const [taxVizIncome, setTaxVizIncome] = useState(0);
  const [taxVizIncome2, setTaxVizIncome2] = useState(0);
  const [taxVizShowCompare, setTaxVizShowCompare] = useState(false);
  const [annuity, setAnnuity] = useState({
    purchaseAmount: 200000,
    startAge: 67,
    type: "lifetime",       // "lifetime" | "term"
    termYears: 20,
    rate: 0.055,            // 5.5% p.a. payout rate
    indexed: false,         // inflation-indexed
    indexRate: 0.025,       // CPI assumption
    gender: "male",
    reversionary: false,    // partner continues receiving after death
    reversionaryPct: 0.60,  // 60% to partner
  });
  const setAnn = f => v => setAnnuity(p => ({ ...p, [f]: v }));
  // ── Life Expectancy Calculator state (Personal tab) ──
  const [leGender,   setLeGender]   = useState("male");
  const [leSmoker,   setLeSmoker]   = useState(false);
  const [leHealth,   setLeHealth]   = useState("Good");
  const [leExercise, setLeExercise] = useState("Occasional");
  const [leBMI,      setLeBMI]      = useState("Normal");
  const [leState,    setLeState]    = useState("");
  const [leSeifa,    setLeSeifa]    = useState("");
  const [leOpen,     setLeOpen]     = useState(false);

  // ── GOOGLE SHEETS INTEGRATION ──────────────────────────────────────────────
  // Paste your deployed Google Apps Script Web App URL here:
  const SHEETS_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbxxWuYgv4GiYhKr2_7hXFLMwrZFFsXDtGcCvX4ycalRMRV-8kk1t-39CWZ9KnH76FKT/exec";
  const [saveStatus, setSaveStatus] = useState("idle"); // "idle" | "saving" | "saved" | "error"

 // ── Auth session listener ──
  useEffect(() => {
    db.auth.getSession().then(({ data: { session } }) => setSession(session));
    const { data: { subscription } } = db.auth.onAuthStateChange((_e, session) => setSession(session));
    return () => subscription.unsubscribe();
  }, []);

  // ── Load from Supabase on login ──
  useEffect(() => {
    if (!session || dbLoaded) return;
    const load = async () => {
      const { data } = await db
        .from('shared_retirement_data')
        .select('data')
        .eq('user_email', session.user.email)
        .single();
      if (data?.data && Object.keys(data.data).length > 0) {
        setInp(prev => ({ ...prev, ...data.data }));
      }
      setDbLoaded(true);
    };
    load();
  }, [session]);

  // ── Auto-save to Supabase ──
  useEffect(() => {
    if (!session || !dbLoaded) return;
    const timer = setTimeout(async () => {
      setSaving(true);
      const { data: existing } = await db
        .from('shared_retirement_data')
        .select('id')
        .eq('user_email', session.user.email)
        .single();
      if (existing) {
        await db.from('shared_retirement_data')
          .update({ data: inp, updated_at: new Date().toISOString() })
          .eq('user_email', session.user.email);
      } else {
        await db.from('shared_retirement_data')
          .insert({ user_email: session.user.email, data: inp });
      }
      setSaving(false);
      setLastSaved(new Date());
    }, 1500);
    return () => clearTimeout(timer);
  }, [inp, session, dbLoaded]);  const saveToSheets = useCallback(() => {
    setSaveStatus("saving");
    const payload = {
      timestamp:              new Date().toLocaleString("en-AU"),
      clientName:             inp.clientName || "",
      birthYear:              inp.birthYear,
      currentAge:             inp.currentAge,
      retirementAge:          inp.retirementAge,
      lifeExpectancy:         inp.lifeExpectancy,
      married:                inp.married ? "Yes" : "No",
      homeowner:              inp.homeowner ? "Yes" : "No",
      superBalance:           inp.superBalance,
      voluntarySuper:         inp.voluntarySuper,
      extraSuper:             inp.extraSuper,
      outsideSuper:           inp.outsideSuper,
      annualIncome:           inp.annualIncome,
      partnerIncome:          inp.partnerIncome,
      otherIncome:            inp.otherIncome,
      annualExpenses:         inp.annualExpenses,
      retirementExpenses:     inp.retirementExpenses,
      annualSavingsRate:      ((inp.annualSavingsRate || 0) * 100).toFixed(1) + "%",
      returnRate:             ((inp.returnRate || 0) * 100).toFixed(2) + "%",
      inflationRate:          ((inp.inflationRate || 0) * 100).toFixed(2) + "%",
      propertyGrowthRate:     ((inp.propertyGrowthRate || 0) * 100).toFixed(2) + "%",
      isSMSF:                 inp.isSMSF ? "Yes" : "No",
      smsfAdminCost:          inp.smsfAdminCost,
      agePensionEnabled:      inp.agePensionEnabled ? "Yes" : "No",
      healthcareExpenses:     inp.healthcareExpenses,
      agedCareAge:            inp.agedCareAge,
      agedCareCost:           inp.agedCareCost,
     dividendYield:          ((inp.dividendYield || 0) * 100).toFixed(2) + "%",
      nw_superBalance:        inp.superBalance,
      nw_outsideSuper:        inp.outsideSuper,
      nw_totalPropertyValue:  inp.properties.reduce((s, p) => s + (p.value || 0), 0),
      nw_totalPropertyEquity: inp.properties.reduce((s, p) => s + (p.value || 0) - (p.mortgage || 0), 0),
      nw_totalDebt:           inp.debts.reduce((s, d) => s + (d.balance || 0), 0)
                            + inp.properties.reduce((s, p) => s + (p.mortgage || 0), 0),
      nw_netWorth:            inp.superBalance + inp.outsideSuper
                            + inp.properties.reduce((s, p) => s + (p.value || 0) - (p.mortgage || 0), 0)
                            - inp.debts.reduce((s, d) => s + (d.balance || 0), 0)
                            - inp.properties.reduce((s, p) => s + (p.mortgage || 0), 0),
    };
    fetch(SHEETS_WEBHOOK_URL, {
      method: "POST",
      mode: "no-cors",                          // required for Apps Script
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(() => {
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 3000);
      })
      .catch(() => {
        setSaveStatus("error");
        setTimeout(() => setSaveStatus("idle"), 4000);
      });
  }, [inp, SHEETS_WEBHOOK_URL]);
  // ───────────────────────────────────────────────────────────────────────────

  const proj = useMemo(() => runProjection(inp), [inp]);
  const projB = useMemo(() => scenBActive ? runProjection({ ...inp, ...scenB }) : [], [inp, scenB, scenBActive]);
  const scenarioProjs = useMemo(() =>
    scenarios.map(s => ({
      ...s,
      proj: s.active ? runProjection({
        ...inp,
        retirementAge:      s.retirementAge,
        retirementExpenses: s.retirementExpenses,
        propertyGrowthRate: s.propertyGrowthRate,
        returnRate:         s.returnRate,
        superBalance:       s.superBalance ?? inp.superBalance,
      }) : [],
    })),
  [inp, scenarios]);
  const mc = useMemo(() => runMonteCarlo(inp, mcRuns), [inp, mcRuns]);

  const preservAge = getPreservationAge(inp.birthYear);
  const retireRow = proj.find(d => d.age === inp.retirementAge) || proj[0] || {};
  const endRow = proj[proj.length - 1] || {};
  const sgRate = getSGRate(new Date().getFullYear());
  const sgAmount = inp.annualIncome * sgRate;
  const totalSuperContrib = sgAmount + inp.voluntarySuper;
  const concRoom = Math.max(0, 30000 - totalSuperContrib);
  const annualTax = calcNetTax(inp.annualIncome);
  const marginalRate = getMarginalRate(inp.annualIncome);
  const netTakeHome = inp.annualIncome - annualTax;
  const totalRentalIncome = inp.properties.reduce((s, p) => s + (p.weeklyRent || 0) * 52 * (1 - (p.expenseRatio || 0.25)), 0);
  const totalPropertyValue = inp.properties.reduce((s, p) => s + (p.value || 0), 0);
  const totalPropertyEquity = inp.properties.reduce((s, p) => s + (p.value || 0) - (p.mortgage || 0), 0);
  const totalDebt = inp.debts.reduce((s, d) => s + (d.balance || 0), 0) + inp.properties.reduce((s, p) => s + (p.mortgage || 0), 0);
  const agePensionAtRetire = calcAgePension(67, inp.married, inp.homeowner,
    Math.max(0, (retireRow.netWorth || 0) - (inp.homeowner ? (inp.properties.find(p => p.isPrimary)?.value || 0) : 0)),
    totalRentalIncome + inp.otherIncome, inp.agePensionEnabled);
  const successColor = mc.successRate > 0.85 ? C.ok : mc.successRate > 0.65 ? C.warn : C.bad;

  const wellnessItems = [
    { label: "Monte Carlo Success", score: Math.round(mc.successRate * 40), max: 40, pass: mc.successRate >= 0.8 },
    { label: "Super Contributions", score: totalSuperContrib >= 25000 ? 15 : Math.round(totalSuperContrib / 25000 * 15), max: 15, pass: totalSuperContrib >= 20000 },
    { label: "Debt Ratio", score: totalDebt / Math.max(1, totalPropertyValue) < 0.5 ? 15 : Math.round(Math.max(0, 1 - totalDebt / Math.max(1,totalPropertyValue)) * 15), max: 15, pass: totalDebt / Math.max(1, totalPropertyValue) < 0.6 },
    { label: "Savings Rate", score: (inp.annualSavingsRate || 0) >= 0.15 ? 10 : Math.round((inp.annualSavingsRate || 0) / 0.15 * 10), max: 10, pass: (inp.annualSavingsRate || 0) >= 0.1 },
    { label: "Diversification", score: inp.properties.length >= 2 && inp.outsideSuper > 0 ? 10 : 5, max: 10, pass: inp.properties.length >= 1 && inp.outsideSuper > 0 },
    { label: "Estate Planning", score: (inp.estateHasWill ? 5 : 0) + (inp.estateHasPOA ? 5 : 0), max: 10, pass: inp.estateHasWill },
  ];
  const wellnessTotal = wellnessItems.reduce((s, w) => s + Math.min(w.score, w.max), 0);
  const wellnessGrade = wellnessTotal >= 85 ? "A" : wellnessTotal >= 70 ? "B" : wellnessTotal >= 55 ? "C" : "D";
  const wellnessColor = wellnessTotal >= 85 ? C.ok : wellnessTotal >= 70 ? C.main : wellnessTotal >= 55 ? C.warn : C.bad;

  const cf = d => d.age % 2 === 0 || d.age === inp.retirementAge || d.age === inp.currentAge;

  const addProperty = () => setInp(p => ({ ...p, properties: [...p.properties, { id: uid(), label: `Investment Property ${p.properties.length}`, value: 700000, mortgage: 400000, weeklyRent: 650, loanYears: 25, expenseRatio: 0.25, isNewBuild: false, buildCompleteAge: inp.currentAge + 2, constructionCost: 0, isPrimary: false }] }));
  const addNewBuild = () => setInp(p => ({ ...p, properties: [...p.properties, { id: uid(), label: "New Build – House & Land", value: 650000, mortgage: 500000, weeklyRent: 580, loanYears: 25, expenseRatio: 0.25, isNewBuild: true, buildCompleteAge: inp.currentAge + 2, constructionCost: 350000, isPrimary: false }] }));
  const addDebt = () => setInp(p => ({ ...p, debts: [...p.debts, { id: uid(), label: "Personal Loan", balance: 20000, rate: 8.5, monthlyRepayment: 450 }] }));
  const addWindfall = () => setInp(p => ({ ...p, windfalls: [...p.windfalls, { id: uid(), label: "Inheritance", age: 65, amount: 100000 }] }));
  const addBigExpense = () => setInp(p => ({ ...p, bigExpenses: [...p.bigExpenses, { id: uid(), label: "Renovation", age: 60, amount: 50000 }] }));
  const addRatePoint = () => setInp(p => ({ ...p, rateSchedule: [...p.rateSchedule, { id: uid(), age: inp.retirementAge, rate: 5.5 }] }));

  if (!session) return (
    <div style={{ minHeight:"100vh", background:"#0f172a",
      display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ background:"white", borderRadius:16, padding:"40px 48px",
        textAlign:"center", boxShadow:"0 20px 60px rgba(0,0,0,0.3)",
        minWidth:360 }}>
        <div style={{ fontSize:48, marginBottom:8 }}>🦘</div>
        <div style={{ fontSize:22, fontWeight:900, color:"#0f172a",
          marginBottom:4 }}>AUS Retirement Pro</div>
        <div style={{ fontSize:12, color:"#64748b", marginBottom:28 }}>
          {authMode==='login' ? 'Sign in to your account' : 'Create your account'}
        </div>

        <input
          type="email"
          placeholder="Email address"
          value={authEmail}
          onChange={e=>{ setAuthEmail(e.target.value); setAuthError(''); }}
          style={{ width:"100%", padding:"12px 16px", borderRadius:8,
            border:`2px solid ${authError?"#ef4444":"#e2e8f0"}`,
            fontSize:14, marginBottom:10, boxSizing:"border-box",
            outline:"none" }}
        />
        <input
          type="password"
          placeholder="Password"
          value={authPassword}
          onChange={e=>{ setAuthPassword(e.target.value); setAuthError(''); }}
          onKeyDown={async e=>{ if(e.key==='Enter') {
            if(authMode==='login'){
              const {error} = await db.auth.signInWithPassword({email:authEmail, password:authPassword});
              if(error) setAuthError(error.message);
            } else {
              const {error} = await db.auth.signUp({email:authEmail, password:authPassword});
              if(error) setAuthError(error.message);
              else setAuthError('Check your email to confirm your account');
            }
          }}}
          style={{ width:"100%", padding:"12px 16px", borderRadius:8,
            border:`2px solid ${authError?"#ef4444":"#e2e8f0"}`,
            fontSize:14, marginBottom:12, boxSizing:"border-box",
            outline:"none" }}
        />

        {authError && (
          <div style={{ color: authError.includes('Check') ? "#16a34a" : "#ef4444",
            fontSize:12, marginBottom:12 }}>
            {authError}
          </div>
        )}

        <button
          onClick={async ()=>{
            if(authMode==='login'){
              const {error} = await db.auth.signInWithPassword({email:authEmail, password:authPassword});
              if(error) setAuthError(error.message);
            } else {
              const {error} = await db.auth.signUp({email:authEmail, password:authPassword});
              if(error) setAuthError(error.message);
              else setAuthError('Check your email to confirm your account');
            }
          }}
          style={{ width:"100%", padding:"12px", borderRadius:8,
            background:"#0f172a", color:"white", border:"none",
            fontSize:15, fontWeight:700, cursor:"pointer", marginBottom:14 }}>
          {authMode==='login' ? 'Sign In →' : 'Create Account →'}
        </button>

        <div style={{ fontSize:12, color:"#64748b" }}>
          {authMode==='login' ? "Don't have an account? " : "Already have an account? "}
          <span onClick={()=>{ setAuthMode(authMode==='login'?'signup':'login'); setAuthError(''); }}
            style={{ color:"#2563eb", cursor:"pointer", fontWeight:700 }}>
            {authMode==='login' ? 'Sign Up' : 'Sign In'}
          </span>
        </div>

        <div style={{ fontSize:10, color:"#94a3b8", marginTop:20 }}>
          Developed by Vijay Parate using Claude AI
        </div>
      </div>
    </div>
  );

  if (!unlocked) return (
    <div style={{ minHeight:"100vh", background:"#0f172a",
      display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ background:"white", borderRadius:16, padding:"40px 48px",
        textAlign:"center", boxShadow:"0 20px 60px rgba(0,0,0,0.3)",
        minWidth:340 }}>
        <div style={{ fontSize:48, marginBottom:8 }}>🦘</div>
        <div style={{ fontSize:22, fontWeight:900, color:"#0f172a",
          marginBottom:4 }}>AUS Retirement Pro</div>
        <div style={{ fontSize:12, color:"#64748b", marginBottom:28 }}>
          Personal Financial Planning Tool
        </div>
        <input
          type="password"
          placeholder="Enter passcode"
          value={passcode}
          onChange={e=>{ setPasscode(e.target.value); setPasscodeError(false); }}
          onKeyDown={e=>{ if(e.key==='Enter'){
            if(passcode===APP_PASSCODE){ setUnlocked(true); }
            else { setPasscodeError(true); }
          }}}
          style={{ width:"100%", padding:"12px 16px", borderRadius:8,
            border:`2px solid ${passcodeError?"#ef4444":"#e2e8f0"}`,
            fontSize:16, marginBottom:12, boxSizing:"border-box",
            outline:"none", textAlign:"center", letterSpacing:"0.2em" }}
        />
        {passcodeError && (
          <div style={{ color:"#ef4444", fontSize:12, marginBottom:12 }}>
            Incorrect passcode — try again
          </div>
        )}
        <button
          onClick={()=>{
            if(passcode===APP_PASSCODE){ setUnlocked(true); }
            else { setPasscodeError(true); }
          }}
          style={{ width:"100%", padding:"12px", borderRadius:8,
            background:"#0f172a", color:"white", border:"none",
            fontSize:15, fontWeight:700, cursor:"pointer" }}>
          Enter →
        </button>
        <div style={{ fontSize:10, color:"#94a3b8", marginTop:20 }}>
          Developed by Vijay Parate using Claude AI
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "monospace", fontSize: 13 }}>
      {/* HEADER */}
      <div style={{ background: "#ffffff", borderBottom: `1px solid ${C.border}`, padding: "0 12px", position: "sticky", top: 0, zIndex: 100, boxShadow: "0 1px 4px #0001" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0 4px", flexWrap: "wrap" }}>
          <div style={{ width: 34, height: 34, background: `linear-gradient(135deg, ${C.main}, ${C.super})`, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0, cursor: "pointer" }} onClick={() => setTab(t => t === "dashboard" ? "tests" : t === "tests" ? "tests2" : "dashboard")} title="Click to cycle: Dashboard → Tests → Tests 2">🦘</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 900, color: C.main }}>AUS Retirement Pro</div>
            <div style={{ fontSize: 9, color: C.muted }}>Super · SMSF · Multi-Property · Age Pension · ATO FY2025-26</div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
            <div style={{ fontSize: 9, color: C.muted, fontStyle: "italic", whiteSpace: "nowrap" }}>
              Developed by <strong style={{ color: C.main }}>Vijay Parate</strong> using <strong style={{ color: C.super }}>Claude AI</strong>
            </div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end" }}>
            <Badge color={C.ok}>ATO FY25-26 ✓</Badge>
            <Badge color={C.super}>SG {(sgRate*100).toFixed(1)}%</Badge>
            {inp.isSMSF && <Badge color={C.smsf}>SMSF</Badge>}
            <Badge color={wellnessColor}>{wellnessGrade} {wellnessTotal}/100</Badge>
              <span style={{ fontSize:10, color: saving ? "#f59e0b" : "#94a3b8",
  fontWeight:700, marginLeft:8 }}>
  {saving ? "💾 Saving..." : lastSaved instanceof Date ? `✅ Saved ${lastSaved.toLocaleTimeString()}` : ""}
<button onClick={()=>{ db.auth.signOut(); }}
  style={{ fontSize:10, color:"#64748b", background:"#f1f5f9",
    border:"1px solid #e2e8f0", borderRadius:6,
    padding:"3px 10px", cursor:"pointer", marginLeft:8 }}>
  Sign Out
</button>
</span>
            {(() => {
              const mcScore    = Math.round((mc.successRate||0) * 25);
              const asfa       = inp.married ? 72663 : 51630;
              const retIncome  = (retireRow.income||0);
              const incRepScore= Math.min(20, Math.round((retIncome / Math.max(1, inp.annualIncome||1)) * 20));
              const superScore = Math.min(15, Math.round(((retireRow.super||0)+(retireRow.superPension||0)) / Math.max(1, asfa*20) * 15));
              const apScore    = Math.min(10, Math.round((agePensionAtRetire / Math.max(1, inp.married?AP.coupleFull:AP.singleFull)) * 10));
              const propScore  = Math.min(10, Math.round((totalPropertyEquity / Math.max(1, (retireRow.netWorth||1))) * 10));
              const debtScore  = Math.min(10, Math.round(Math.max(0, 1 - totalDebt/Math.max(1,totalPropertyValue)) * 10));
              const estateScore= Math.min(5, [inp.estateHasWill,inp.estateHasPOA,inp.estateHasACD,inp.estateHasSuper,inp.estateHasTrust].filter(Boolean).length);
              const bufferYrs  = Math.max(0, (inp.lifeExpectancy||87) - inp.retirementAge);
              const bufferScore= Math.min(5, Math.round(bufferYrs/25*5));
              const total      = mcScore+incRepScore+superScore+apScore+propScore+debtScore+estateScore+bufferScore;
              const rc         = total>=80?C.ok:total>=60?C.warn:C.bad;
              return <Badge color={rc}>🎯 {total}/100</Badge>;
            })()}
            {/* ── SAVE TO GOOGLE SHEETS BUTTON ── */}
            <button
              onClick={saveToSheets}
              disabled={saveStatus === "saving"}
              style={{
                marginLeft: 6,
                background: saveStatus === "saved"  ? "#16a34a"
                          : saveStatus === "error"  ? "#dc2626"
                          : saveStatus === "saving" ? "#0369a1"
                          : "linear-gradient(135deg, #16a34a, #0ea5e9)",
                border: "none",
                borderRadius: 6,
                padding: "5px 11px",
                color: "white",
                fontSize: 10,
                fontWeight: 800,
                cursor: saveStatus === "saving" ? "wait" : "pointer",
                display: "flex",
                alignItems: "center",
                gap: 5,
                transition: "background 0.2s",
                fontFamily: "monospace",
                whiteSpace: "nowrap",
                opacity: saveStatus === "saving" ? 0.75 : 1,
              }}
            >
              {saveStatus === "saving" ? "⏳ Saving…"
               : saveStatus === "saved"  ? "✅ Saved!"
               : saveStatus === "error"  ? "❌ Error — retry"
               : "📊 Save to Sheets"}
            </button>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", overflowX: "auto", gap: 0, paddingBottom: 2 }}>
          {TABS.filter(t => !t.hidden).map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: "6px 10px", background: "none", border: "none", borderBottom: tab === t.id ? `2px solid ${C.main}` : "2px solid transparent", color: tab === t.id ? C.main : C.muted, cursor: "pointer", fontSize: 10, fontWeight: tab === t.id ? 800 : 400, whiteSpace: "nowrap" }}>{t.label}</button>
          ))}
          {/* Hidden test tabs — only shown when active */}
          {tab === "tests" && (
            <button style={{ padding: "6px 10px", background: "none", border: "none", borderBottom: `2px solid #a78bfa`, color: "#a78bfa", cursor: "pointer", fontSize: 10, fontWeight: 800, whiteSpace: "nowrap" }}>🧪 Tests</button>
          )}
          {tab === "tests2" && (
            <button style={{ padding: "6px 10px", background: "none", border: "none", borderBottom: `2px solid #7c3aed`, color: "#7c3aed", cursor: "pointer", fontSize: 10, fontWeight: 800, whiteSpace: "nowrap" }}>🔬 Tests 2</button>
          )}
        </div>
      </div>

      <div style={{ padding: "16px 12px" }}>

        {/* ═══ DASHBOARD ═══ */}
        {tab === "dashboard" && (
          <>
          {/* ══ RETIREMENT READINESS SCORE ══ */}
            {(() => {
              // ── Score calculations ──
              const asfa         = inp.married ? 72663 : 51630;
              const retIncome    = retireRow.income || 0;
              const retSuper     = (retireRow.super||0) + (retireRow.superPension||0);

              const components = [
                {
                  id:"montecarlo", label:"Monte Carlo Success", icon:"🎲", tab:"montecarlo",
                  max:25, color:C.super,
                  score: Math.round((mc.successRate||0) * 25),
                  detail: `${pct(mc.successRate||0)} probability portfolio lasts to age ${inp.lifeExpectancy||87}`,
                  fix: mc.successRate < 0.8 ? "Increase super contributions or reduce retirement expenses" : null,
                },
                {
                  id:"income", label:"Income Replacement", icon:"💰", tab:"cashflow",
                  max:20, color:C.ok,
                  score: Math.min(20, Math.round((retIncome / Math.max(1, inp.annualIncome||1)) * 20)),
                  detail: `${pct(retIncome/Math.max(1,inp.annualIncome||1))} of pre-retirement income replaced`,
                  fix: retIncome < inp.annualIncome*0.7 ? "Target 70%+ income replacement — review super drawdown and rental income" : null,
                },
                {
                  id:"super", label:"Super vs ASFA Standard", icon:"🦘", tab:"super",
                  max:15, color:C.super,
                  score: Math.min(15, Math.round(retSuper / Math.max(1, asfa*20) * 15)),
                  detail: `${aud(retSuper)} super at retirement vs ASFA comfortable ${aud(asfa)}/yr`,
                  fix: retSuper < asfa*15 ? "Increase salary sacrifice or non-concessional contributions" : null,
                },
                {
                  id:"pension", label:"Age Pension Entitlement", icon:"👴", tab:"agepension",
                  max:10, color:C.pension,
                  score: Math.min(10, Math.round((agePensionAtRetire/Math.max(1,inp.married?AP.coupleFull:AP.singleFull))*10)),
                  detail: agePensionAtRetire>0 ? `Est. ${aud(agePensionAtRetire)}/yr Age Pension at 67` : "Not currently eligible for Age Pension",
                  fix: agePensionAtRetire===0 && retSuper>3000000 ? "High assets reduce pension — consider structuring assets differently" : null,
                },
                {
                  id:"property", label:"Property Equity", icon:"🏘️", tab:"properties",
                  max:10, color:C.prop,
                  score: Math.min(10, Math.round((totalPropertyEquity/Math.max(1,retireRow.netWorth||1))*10)),
                  detail: `${aud(totalPropertyEquity)} property equity — ${pct(totalPropertyEquity/Math.max(1,retireRow.netWorth||1))} of net worth`,
                  fix: inp.properties.length===0 ? "Consider property investment to diversify retirement assets" : null,
                },
                {
                  id:"debt", label:"Debt Ratio", icon:"💳", tab:"debts",
                  max:10, color:C.warn,
                  score: Math.min(10, Math.round(Math.max(0,1-totalDebt/Math.max(1,totalPropertyValue))*10)),
                  detail: `${aud(totalDebt)} total debt vs ${aud(totalPropertyValue)} property value`,
                  fix: totalDebt/Math.max(1,totalPropertyValue) > 0.6 ? "Reduce high-interest debt and accelerate mortgage repayment" : null,
                },
                {
                  id:"estate", label:"Estate Planning", icon:"🏛️", tab:"estate",
                  max:5, color:"#a78bfa",
                  score: Math.min(5,[inp.estateHasWill,inp.estateHasPOA,inp.estateHasACD,inp.estateHasSuper,inp.estateHasTrust].filter(Boolean).length),
                  detail: `${[inp.estateHasWill,inp.estateHasPOA,inp.estateHasACD,inp.estateHasSuper,inp.estateHasTrust].filter(Boolean).length}/5 estate documents completed`,
                  fix: !inp.estateHasWill ? "Create a Will immediately — without it assets distributed by intestacy laws" : !inp.estateHasPOA ? "Set up Enduring Power of Attorney" : null,
                },
                {
                  id:"buffer", label:"Retirement Buffer", icon:"⏳", tab:"montecarlo",
                  max:5, color:C.main,
                  score: Math.min(5, Math.round(Math.max(0,(inp.lifeExpectancy||87)-inp.retirementAge)/25*5)),
                  detail: `${Math.max(0,(inp.lifeExpectancy||87)-inp.retirementAge)} years of retirement to fund (age ${inp.retirementAge}–${inp.lifeExpectancy||87})`,
                  fix: inp.retirementAge < 60 ? "Early retirement significantly increases funding required — model different ages" : null,
                },
              ];

              const totalScore = components.reduce((s,c)=>s+c.score,0);
              const scoreColor = totalScore>=80?C.ok:totalScore>=60?C.warn:C.bad;
              const scoreBg    = totalScore>=80?"#f0fdf4":totalScore>=60?"#fffbeb":"#fef2f2";
              const scoreLabel = totalScore>=80?"On Track 🟢":totalScore>=60?"Needs Attention 🟡":"Action Required 🔴";
              const topActions = components.filter(c=>c.fix).slice(0,3);

              return (
                <div style={{ background:"white", border:`2px solid ${scoreColor}44`,
                  borderRadius:14, overflow:"hidden", marginBottom:16,
                  boxShadow:`0 4px 20px ${scoreColor}15` }}>

                  {/* ── Header bar — always visible ── */}
                  <div onClick={()=>setReadinessOpen(o=>!o)} style={{ cursor:"pointer",
                    background:`linear-gradient(135deg, ${scoreBg}, white)`,
                    padding:"16px 20px", borderBottom:`1px solid ${scoreColor}22`,
                    display:"flex", alignItems:"center", gap:16 }}>

                    {/* Score circle */}
                    <div style={{ width:72, height:72, borderRadius:"50%", flexShrink:0,
                      background:`conic-gradient(${scoreColor} ${totalScore*3.6}deg, #f1f5f9 0deg)`,
                      display:"flex", alignItems:"center", justifyContent:"center",
                      boxShadow:`0 0 0 4px white, 0 0 0 6px ${scoreColor}33` }}>
                      <div style={{ width:56, height:56, borderRadius:"50%",
                        background:"white", display:"flex", flexDirection:"column",
                        alignItems:"center", justifyContent:"center" }}>
                        <div style={{ fontSize:20, fontWeight:900, color:scoreColor, lineHeight:1 }}>{totalScore}</div>
                        <div style={{ fontSize:8, color:C.muted, fontWeight:700 }}>/ 100</div>
                      </div>
                    </div>

                    {/* Title + progress bar */}
                    <div style={{ flex:1 }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
                        <div>
                          <div style={{ fontSize:14, fontWeight:900, color:C.text }}>
                            Retirement Readiness Score
                          </div>
                          <div style={{ fontSize:11, color:scoreColor, fontWeight:700 }}>{scoreLabel}</div>
                        </div>
                        <span style={{ fontSize:16, color:scoreColor }}>{readinessOpen?"▲":"▼"}</span>
                      </div>
                      {/* Progress bar with colour bands */}
                      <div style={{ position:"relative", height:12, background:"#f1f5f9",
                        borderRadius:6, overflow:"hidden" }}>
                        {/* Colour band background */}
                        <div style={{ position:"absolute", inset:0, display:"flex" }}>
                          <div style={{ width:"60%", background:"#fecaca44" }} />
                          <div style={{ width:"20%", background:"#fef08a44" }} />
                          <div style={{ width:"20%", background:"#bbf7d044" }} />
                        </div>
                        {/* Score fill */}
                        <div style={{ position:"absolute", top:0, left:0, height:"100%",
                          width:`${totalScore}%`, borderRadius:6,
                          background:`linear-gradient(90deg, ${C.bad}, ${C.warn} 60%, ${C.ok})`,
                          transition:"width 0.6s ease", opacity:0.9 }} />
                        {/* Band markers */}
                        {[60,80].map(m=>(
                          <div key={m} style={{ position:"absolute", top:0, left:`${m}%`,
                            width:2, height:"100%", background:"white", opacity:0.7 }} />
                        ))}
                      </div>
                      <div style={{ display:"flex", justifyContent:"space-between",
                        fontSize:8, color:C.muted, marginTop:3 }}>
                        <span>0 — Action Required</span>
                        <span>60 — Needs Attention</span>
                        <span>80 — On Track</span>
                        <span>100</span>
                      </div>
                    </div>
                  </div>

                  {/* ── Expandable detail ── */}
                  {readinessOpen && (
                    <div style={{ padding:"16px 20px" }}>

                      {/* Component breakdown */}
                      <div style={{ marginBottom:16 }}>
                        <div style={{ fontSize:11, fontWeight:800, color:C.text,
                          marginBottom:10, textTransform:"uppercase",
                          letterSpacing:"0.07em" }}>Score Breakdown</div>
                        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                          {components.map(c=>(
                            <div key={c.id} style={{ background:"#f8fafc",
                              border:`1px solid ${c.color}22`, borderRadius:10,
                              padding:"10px 12px" }}>
                              <div style={{ display:"flex", justifyContent:"space-between",
                                alignItems:"center", marginBottom:6 }}>
                                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                                  <span style={{ fontSize:14 }}>{c.icon}</span>
                                  <span style={{ fontSize:10, fontWeight:800,
                                    color:c.color }}>{c.label}</span>
                                </div>
                                <div style={{ fontSize:12, fontWeight:900,
                                  color:c.score===c.max?C.ok:c.score>=c.max*0.6?C.warn:C.bad }}>
                                  {c.score}/{c.max}
                                </div>
                              </div>
                              {/* Mini progress bar */}
                              <div style={{ height:5, background:`${c.color}22`,
                                borderRadius:3, marginBottom:5 }}>
                                <div style={{ height:5, borderRadius:3,
                                  width:`${c.score/c.max*100}%`,
                                  background:c.color, transition:"width 0.4s" }} />
                              </div>
                              <div style={{ fontSize:9, color:C.muted,
                                lineHeight:1.5 }}>{c.detail}</div>
                              {c.fix && (
                                <button onClick={()=>setTab(c.tab)}
                                  style={{ marginTop:6, fontSize:9, color:c.color,
                                    background:`${c.color}10`,
                                    border:`1px solid ${c.color}33`,
                                    borderRadius:5, padding:"3px 8px",
                                    cursor:"pointer", fontWeight:700 }}>
                                  Fix this → {c.tab} tab
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Top 3 actions */}
                      {topActions.length > 0 && (
                        <div style={{ background:`${scoreColor}08`,
                          border:`1.5px solid ${scoreColor}33`,
                          borderRadius:10, padding:"12px 14px" }}>
                          <div style={{ fontSize:11, fontWeight:900, color:scoreColor,
                            marginBottom:10, textTransform:"uppercase",
                            letterSpacing:"0.07em" }}>
                            🎯 Top {topActions.length} Actions to Improve Your Score
                          </div>
                          {topActions.map((a,i)=>(
                            <div key={i} style={{ display:"flex", gap:10,
                              alignItems:"flex-start", marginBottom:8,
                              padding:"8px 10px", background:"white",
                              borderRadius:8, border:`1px solid ${a.color}22` }}>
                              <div style={{ width:22, height:22, borderRadius:"50%",
                                background:a.color, color:"white",
                                display:"flex", alignItems:"center",
                                justifyContent:"center", fontSize:11,
                                fontWeight:900, flexShrink:0 }}>{i+1}</div>
                              <div style={{ flex:1 }}>
                                <div style={{ fontSize:10, fontWeight:800,
                                  color:a.color, marginBottom:2 }}>
                                  {a.icon} {a.label}
                                </div>
                                <div style={{ fontSize:10, color:C.muted,
                                  lineHeight:1.6 }}>{a.fix}</div>
                              </div>
                              <button onClick={()=>setTab(a.tab)}
                                style={{ fontSize:10, color:"white",
                                  background:a.color, border:"none",
                                  borderRadius:6, padding:"4px 10px",
                                  cursor:"pointer", fontWeight:700,
                                  flexShrink:0 }}>
                                Fix →
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {totalScore >= 80 && (
                        <div style={{ background:"#f0fdf4", border:`1px solid ${C.ok}44`,
                          borderRadius:10, padding:"12px 14px", textAlign:"center" }}>
                          <div style={{ fontSize:13, fontWeight:900, color:C.ok }}>
                            ✅ Excellent Retirement Readiness!
                          </div>
                          <div style={{ fontSize:11, color:C.muted, marginTop:4 }}>
                            Your retirement plan scores {totalScore}/100 — you are well on track.
                            Review annually and after major life events.
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}
           {/* ── ROW 1: Hero — Readiness Score + Net Worth ── */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:14 }}>

              {/* Net Worth hero card */}
              <div style={{ background:"white", border:`2px solid ${C.main}33`,
                borderRadius:14, padding:"18px 20px",
                boxShadow:`0 4px 20px ${C.main}10` }}>
                <div style={{ fontSize:10, fontWeight:800, color:C.muted,
                  textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:12 }}>
                  💰 Net Worth Snapshot
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:12 }}>
                  {[
                    { label:"Today",           val:aud(proj[0]?.netWorth||0),       color:C.main,   sub:"Current net worth" },
                    { label:`At Retirement`,   val:aud(retireRow.netWorth||0),      color:C.super,  sub:`Age ${inp.retirementAge}` },
                    { label:"Estate at 90",    val:aud(endRow.netWorth||0),         color:"#a78bfa",sub:"Projected estate" },
                    { label:"Property Equity", val:aud(totalPropertyEquity),        color:C.prop,   sub:`${inp.properties.length} propert${inp.properties.length===1?"y":"ies"}` },
                  ].map(m=>(
                    <div key={m.label} style={{ background:"#f8fafc",
                      borderRadius:10, padding:"10px 12px",
                      border:`1px solid ${m.color}22` }}>
                      <div style={{ fontSize:9, color:C.muted, fontWeight:700,
                        textTransform:"uppercase", marginBottom:3 }}>{m.label}</div>
                      <div style={{ fontSize:16, fontWeight:900, color:m.color,
                        fontFamily:"monospace" }}>{m.val}</div>
                      <div style={{ fontSize:9, color:C.muted, marginTop:2 }}>{m.sub}</div>
                    </div>
                  ))}
                </div>
                {/* Mini net worth trend bar */}
                <div style={{ fontSize:9, color:C.muted, fontWeight:700,
                  marginBottom:5, textTransform:"uppercase" }}>
                  Wealth trajectory
                </div>
                <div style={{ display:"flex", alignItems:"flex-end", gap:2, height:36 }}>
                  {proj.filter((_,i)=>i%4===0).slice(0,15).map((d,i,arr)=>{
                    const maxNW = Math.max(...arr.map(x=>x.netWorth||0))||1;
                    const h = Math.max(4, ((d.netWorth||0)/maxNW)*34);
                    const isRetire = d.age === inp.retirementAge;
                    return (
                      <div key={i} style={{ flex:1, display:"flex",
                        flexDirection:"column", alignItems:"center", gap:1 }}>
                        <div style={{ width:"100%", height:h,
                          background: isRetire ? "#a78bfa" : C.main,
                          borderRadius:"2px 2px 0 0", opacity:0.7 }} />
                        {isRetire && <div style={{ fontSize:6, color:"#a78bfa",
                          fontWeight:800, whiteSpace:"nowrap" }}>RET</div>}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Readiness score — compact version alongside NW */}
              <div style={{ background:"white", border:`2px solid ${C.ok}33`,
                borderRadius:14, padding:"18px 20px",
                boxShadow:`0 4px 20px ${C.ok}10` }}>
                <div style={{ fontSize:10, fontWeight:800, color:C.muted,
                  textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:12 }}>
                  🎯 Retirement Readiness
                </div>
                {(() => {
                  const asfa = inp.married?72663:51630;
                  const retIncome = retireRow.income||0;
                  const retSuper  = (retireRow.super||0)+(retireRow.superPension||0);
                  const scores = [
                    Math.round((mc.successRate||0)*25),
                    Math.min(20,Math.round((retIncome/Math.max(1,inp.annualIncome||1))*20)),
                    Math.min(15,Math.round(retSuper/Math.max(1,asfa*20)*15)),
                    Math.min(10,Math.round((agePensionAtRetire/Math.max(1,inp.married?AP.coupleFull:AP.singleFull))*10)),
                    Math.min(10,Math.round((totalPropertyEquity/Math.max(1,retireRow.netWorth||1))*10)),
                    Math.min(10,Math.round(Math.max(0,1-totalDebt/Math.max(1,totalPropertyValue))*10)),
                    Math.min(5,[inp.estateHasWill,inp.estateHasPOA,inp.estateHasACD,inp.estateHasSuper,inp.estateHasTrust].filter(Boolean).length),
                    Math.min(5,Math.round(Math.max(0,(inp.lifeExpectancy||87)-inp.retirementAge)/25*5)),
                  ];
                  const total = scores.reduce((s,v)=>s+v,0);
                  const sc = total>=80?C.ok:total>=60?C.warn:C.bad;
                  const label = total>=80?"On Track":"Needs Attention";
                  return (
                    <>
                      <div style={{ display:"flex", alignItems:"center", gap:16, marginBottom:14 }}>
                        {/* Big score circle */}
                        <div style={{ width:80, height:80, borderRadius:"50%", flexShrink:0,
                          background:`conic-gradient(${sc} ${total*3.6}deg, #f1f5f9 0deg)`,
                          display:"flex", alignItems:"center", justifyContent:"center",
                          boxShadow:`0 0 0 4px white, 0 0 0 6px ${sc}33` }}>
                          <div style={{ width:62, height:62, borderRadius:"50%",
                            background:"white", display:"flex", flexDirection:"column",
                            alignItems:"center", justifyContent:"center" }}>
                            <div style={{ fontSize:22, fontWeight:900,
                              color:sc, lineHeight:1 }}>{total}</div>
                            <div style={{ fontSize:8, color:C.muted }}>/ 100</div>
                          </div>
                        </div>
                        <div style={{ flex:1 }}>
                          <div style={{ fontSize:16, fontWeight:900, color:sc,
                            marginBottom:4 }}>{label}</div>
                          {/* Colour band bar */}
                          <div style={{ position:"relative", height:10,
                            background:"#f1f5f9", borderRadius:5, overflow:"hidden",
                            marginBottom:4 }}>
                            <div style={{ position:"absolute", inset:0, display:"flex" }}>
                              <div style={{ width:"60%", background:"#fecaca44" }}/>
                              <div style={{ width:"20%", background:"#fef08a44" }}/>
                              <div style={{ width:"20%", background:"#bbf7d044" }}/>
                            </div>
                            <div style={{ position:"absolute", top:0, left:0,
                              height:"100%", width:`${total}%`, borderRadius:5,
                              background:`linear-gradient(90deg,${C.bad},${C.warn} 60%,${C.ok})`,
                              opacity:0.9 }} />
                            {[60,80].map(m=>(
                              <div key={m} style={{ position:"absolute", top:0,
                                left:`${m}%`, width:2, height:"100%",
                                background:"white", opacity:0.7 }} />
                            ))}
                          </div>
                          <div style={{ fontSize:9, color:C.muted }}>
                            Monte Carlo: {pct(mc.successRate)} · Income replacement: {pct((retireRow.income||0)/Math.max(1,inp.annualIncome||1))}
                          </div>
                        </div>
                      </div>
                      {/* Component mini bars */}
                      {[
                        ["🎲 Monte Carlo",     scores[0], 25, C.super,   "montecarlo"],
                        ["💰 Income Replace",  scores[1], 20, C.ok,      "cashflow"],
                        ["🦘 Super vs ASFA",   scores[2], 15, C.super,   "super"],
                        ["👴 Age Pension",      scores[3], 10, C.pension, "agepension"],
                        ["🏘️ Property",        scores[4], 10, C.prop,    "properties"],
                        ["💳 Debt Ratio",       scores[5], 10, C.warn,    "debts"],
                        ["🏛️ Estate",          scores[6],  5, "#a78bfa", "estate"],
                        ["⏳ Buffer",           scores[7],  5, C.main,    "montecarlo"],
                      ].map(([label,s,max,color,t])=>(
                        <div key={label} style={{ display:"flex", alignItems:"center",
                          gap:6, marginBottom:4, cursor:"pointer" }}
                          onClick={()=>setTab(t)}>
                          <div style={{ fontSize:9, color:C.muted, width:110,
                            flexShrink:0 }}>{label}</div>
                          <div style={{ flex:1, height:5, background:`${color}22`,
                            borderRadius:3 }}>
                            <div style={{ height:5, width:`${s/max*100}%`,
                              background:color, borderRadius:3 }} />
                          </div>
                          <div style={{ fontSize:9, fontWeight:700, color:color,
                            width:30, textAlign:"right" }}>{s}/{max}</div>
                        </div>
                      ))}
                    </>
                  );
                })()}
              </div>
            </div>

            {/* ── ROW 2: Quick Stats ── */}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(6,1fr)", gap:8, marginBottom:14 }}>
              {[
                { icon:"⏰", label:"Years to Retire",    val: Math.max(0,inp.retirementAge-inp.currentAge),       color:C.main,   fmt: v=>`${v} yrs` },
                { icon:"💵", label:"Monthly Ret. Income", val: (retireRow.income||0)/12,                          color:C.ok,     fmt: v=>aud(v) },
                { icon:"📈", label:"Savings Rate",        val: (inp.annualSavingsRate||0)*100,                    color:C.super,  fmt: v=>`${v.toFixed(0)}%` },
                { icon:"🧾", label:"Marginal Tax Rate",   val: marginalRate*100,                                  color:C.warn,   fmt: v=>`${v.toFixed(0)}%` },
                { icon:"🦘", label:"Super at Retire",     val: (retireRow.super||0)+(retireRow.superPension||0),  color:C.super,  fmt: v=>aud(v) },
                { icon:"👴", label:"Age Pension/yr",      val: agePensionAtRetire,                                color:C.pension,fmt: v=>v>0?aud(v):"None" },
              ].map(m=>(
                <div key={m.label} style={{ background:"white", borderRadius:10,
                  border:`1.5px solid ${m.color}22`, padding:"10px 12px",
                  textAlign:"center" }}>
                  <div style={{ fontSize:16, marginBottom:4 }}>{m.icon}</div>
                  <div style={{ fontSize:14, fontWeight:900, color:m.color,
                    fontFamily:"monospace" }}>{m.fmt(m.val)}</div>
                  <div style={{ fontSize:9, color:C.muted, marginTop:2,
                    fontWeight:700 }}>{m.label}</div>
                </div>
              ))}
            </div>

            {/* ── ROW 3: Life Milestones Timeline ── */}
            <div style={{ background:"white", border:`1.5px solid ${C.border}`,
              borderRadius:12, padding:"16px 20px", marginBottom:14 }}>
              <div style={{ fontSize:11, fontWeight:800, color:C.text,
                marginBottom:14, textTransform:"uppercase",
                letterSpacing:"0.07em" }}>🗓️ Life Milestones Timeline</div>
              {(() => {
                const milestones = [
                  { age: inp.currentAge,       label:"Today",        color:C.main,    icon:"👤" },
                  { age: preservAge,            label:"Preservation", color:C.super,   icon:"🔓" },
                  { age: inp.retirementAge,     label:"Retirement",   color:"#a78bfa", icon:"🎉" },
                  { age: 67,                    label:"Age Pension",  color:C.pension, icon:"👴" },
                  { age: inp.lifeExpectancy||87,label:"Life Exp.",    color:C.bad,     icon:"⭐" },
                ].sort((a,b)=>a.age-b.age);
                const minAge = inp.currentAge;
                const maxAge = inp.lifeExpectancy||87;
                const span   = maxAge - minAge;
                return (
                  <div style={{ position:"relative", paddingBottom:28 }}>
                    {/* Timeline bar */}
                    <div style={{ position:"relative", height:8, background:"#f1f5f9",
                      borderRadius:4, margin:"0 20px" }}>
                      {/* Progress to retirement */}
                      <div style={{ position:"absolute", left:0, top:0, height:"100%",
                        width:`${Math.min(100,(inp.retirementAge-minAge)/span*100)}%`,
                        background:`linear-gradient(90deg,${C.main},#a78bfa)`,
                        borderRadius:4, opacity:0.4 }} />
                      {/* Milestone dots */}
                      {milestones.map((m,i)=>{
                        const pct2 = Math.min(100,Math.max(0,(m.age-minAge)/span*100));
                        const isPast = m.age <= inp.currentAge;
                        return (
                          <div key={i} style={{ position:"absolute",
                            left:`${pct2}%`, top:"50%",
                            transform:"translate(-50%,-50%)" }}>
                            <div style={{ width:16, height:16, borderRadius:"50%",
                              background: isPast ? C.muted : m.color,
                              border:`2px solid white`,
                              boxShadow:`0 0 0 2px ${isPast?C.muted:m.color}44`,
                              display:"flex", alignItems:"center",
                              justifyContent:"center", fontSize:8 }}>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {/* Labels below */}
                    {milestones.map((m,i)=>{
                      const pct2 = Math.min(96,Math.max(2,(m.age-minAge)/span*100));
                      const isPast = m.age <= inp.currentAge;
                      return (
                        <div key={i} style={{ position:"absolute",
                          left:`${pct2}%`, top:16,
                          transform:"translateX(-50%)",
                          textAlign:"center", minWidth:60 }}>
                          <div style={{ fontSize:14 }}>{m.icon}</div>
                          <div style={{ fontSize:9, fontWeight:800,
                            color: isPast ? C.muted : m.color,
                            whiteSpace:"nowrap" }}>{m.label}</div>
                          <div style={{ fontSize:9, color:C.muted }}>Age {m.age}</div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>

            {/* ── ROW 4: Alerts & Warnings ── */}
            {(() => {
              const alerts = [];
              if (totalSuperContrib > 30000) alerts.push({ level:"🔴", msg:`Concessional cap exceeded — ${aud(totalSuperContrib)} vs $30,000 cap`, tab:"super", color:C.bad });
              if (mc.successRate < 0.7) alerts.push({ level:"🔴", msg:`Monte Carlo success rate ${pct(mc.successRate)} — portfolio may not last to age ${inp.lifeExpectancy||87}`, tab:"montecarlo", color:C.bad });
              if (!inp.estateHasWill) alerts.push({ level:"🔴", msg:"No Will — assets will be distributed by intestacy laws", tab:"estate", color:C.bad });
              if (totalDebt/Math.max(1,totalPropertyValue) > 0.7) alerts.push({ level:"🟡", msg:`High debt ratio ${pct(totalDebt/Math.max(1,totalPropertyValue))} — consider accelerating repayments`, tab:"debts", color:C.warn });
              if (concRoom > 5000) alerts.push({ level:"🟡", msg:`${aud(concRoom)} unused concessional cap — consider salary sacrifice to save tax`, tab:"superstrategy", color:C.warn });
              if (!inp.estateHasPOA) alerts.push({ level:"🟡", msg:"No Enduring Power of Attorney — essential if incapacitated", tab:"estate", color:C.warn });
              if (inp.annualSavingsRate < 0.05) alerts.push({ level:"🟡", msg:`Low savings rate ${pct(inp.annualSavingsRate||0)} — target 10–15% for retirement security`, tab:"cashflow", color:C.warn });
              if ((retireRow.income||0) < (inp.annualIncome||0)*0.5) alerts.push({ level:"🟡", msg:`Retirement income ${pct((retireRow.income||0)/Math.max(1,inp.annualIncome||1))} of current income — below 70% target`, tab:"cashflow", color:C.warn });
              if (inp.superBalance > 1500000) alerts.push({ level:"🟡", msg:`Super balance ${aud(inp.superBalance)} approaching Transfer Balance Cap ($1.9M)`, tab:"super", color:C.warn });
              if (alerts.length === 0) return (
                <div style={{ background:"#f0fdf4", border:`1.5px solid ${C.ok}44`,
                  borderRadius:12, padding:"12px 16px", marginBottom:14,
                  display:"flex", alignItems:"center", gap:10 }}>
                  <span style={{ fontSize:20 }}>✅</span>
                  <div style={{ fontSize:12, fontWeight:700, color:C.ok }}>
                    No alerts — your retirement plan looks healthy!
                  </div>
                </div>
              );
              return (
                <div style={{ background:"white", border:`1.5px solid ${C.bad}22`,
                  borderRadius:12, padding:"14px 16px", marginBottom:14 }}>
                  <div style={{ fontSize:11, fontWeight:800, color:C.text,
                    marginBottom:10, textTransform:"uppercase",
                    letterSpacing:"0.07em" }}>
                    ⚠️ Alerts & Warnings ({alerts.length})
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                    {alerts.map((a,i)=>(
                      <div key={i} style={{ display:"flex", alignItems:"center",
                        gap:10, background:`${a.color}08`,
                        border:`1px solid ${a.color}22`, borderRadius:8,
                        padding:"8px 12px" }}>
                        <span style={{ fontSize:14, flexShrink:0 }}>{a.level}</span>
                        <span style={{ fontSize:11, color:C.text, flex:1,
                          lineHeight:1.5 }}>{a.msg}</span>
                        <button onClick={()=>setTab(a.tab)}
                          style={{ fontSize:10, color:"white", background:a.color,
                            border:"none", borderRadius:6, padding:"3px 10px",
                            cursor:"pointer", fontWeight:700, flexShrink:0 }}>
                          Fix →
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* ── ROW 5: Net Worth Chart + Super Trajectory ── */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:14 }}>
              <Card title="Net Worth Trajectory" icon="📊" color={C.main}>
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={proj.filter(cf)}>
                    <defs>
                      <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={C.main} stopOpacity={0.3}/><stop offset="95%" stopColor={C.main} stopOpacity={0}/></linearGradient>
                      <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={C.super} stopOpacity={0.2}/><stop offset="95%" stopColor={C.super} stopOpacity={0}/></linearGradient>
                      <linearGradient id="g3" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={C.prop} stopOpacity={0.2}/><stop offset="95%" stopColor={C.prop} stopOpacity={0}/></linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                    <XAxis dataKey="age" stroke={C.muted} tick={{fontSize:10}} />
                    <YAxis stroke={C.muted} tick={{fontSize:10}} tickFormatter={v=>`$${(v/1e6).toFixed(1)}M`} />
                    <Tooltip content={<TT />} />
                    <Legend wrapperStyle={{fontSize:10}} />
                    <ReferenceLine x={inp.retirementAge} stroke="#a78bfa" strokeDasharray="4 2" label={{value:`Ret.${inp.retirementAge}`,fill:"#a78bfa",fontSize:8}} />
                    <ReferenceLine x={67} stroke={C.pension} strokeDasharray="2 4" label={{value:"AP67",fill:C.pension,fontSize:8}} />
                    <Area type="monotone" dataKey="netWorth" name="Total Net Worth" stroke={C.main} fill="url(#g1)" strokeWidth={2.5} dot={false} />
                    <Area type="monotone" dataKey="superPension" name="Super (Pension)" stroke={C.super} fill="url(#g2)" strokeWidth={1.5} dot={false} />
                    <Area type="monotone" dataKey="propertyEquity" name="Property Equity" stroke={C.prop} fill="url(#g3)" strokeWidth={1.5} dot={false} />
                    <Area type="monotone" dataKey="outside" name="Outside Super" stroke={C.outside} fill="none" strokeWidth={1.5} strokeDasharray="3 2" dot={false} />
                    {scenBActive && <Area type="monotone" data={projB.filter(cf)} dataKey="netWorth" name="Scenario B" stroke={C.warn} fill="none" strokeWidth={2} strokeDasharray="6 3" dot={false} />}
                  </AreaChart>
                </ResponsiveContainer>
              </Card>

              {/* Super Trajectory mini card */}
              <Card title="Super Trajectory" icon="🦘" color={C.super}>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, marginBottom:12 }}>
                  {[
                    { label:"Today",        val:aud(inp.superBalance),                                              color:C.super },
                    { label:"At Retire",    val:aud((retireRow.super||0)+(retireRow.superPension||0)),              color:C.ok },
                    { label:"ASFA Target",  val:aud(inp.married?72663*16:51630*16),                                 color:C.warn },
                  ].map(m=>(
                    <div key={m.label} style={{ background:"#f8fafc",
                      borderRadius:8, padding:"8px 10px", textAlign:"center",
                      border:`1px solid ${m.color}22` }}>
                      <div style={{ fontSize:9, color:C.muted, marginBottom:3 }}>{m.label}</div>
                      <div style={{ fontSize:12, fontWeight:900, color:m.color,
                        fontFamily:"monospace" }}>{m.val}</div>
                    </div>
                  ))}
                </div>
                {/* ASFA comparison bar */}
                {(() => {
                  const retSuper  = (retireRow.super||0)+(retireRow.superPension||0);
                  const asfaTarget= inp.married ? 72663*16 : 51630*16;
                  const pct2      = Math.min(100, retSuper/Math.max(1,asfaTarget)*100);
                  const barColor  = pct2>=100?C.ok:pct2>=70?C.warn:C.bad;
                  return (
                    <>
                      <div style={{ fontSize:10, color:C.muted, marginBottom:4 }}>
                        vs ASFA Comfortable target ({pct(pct2/100)})
                      </div>
                      <div style={{ height:10, background:`${barColor}22`,
                        borderRadius:5, marginBottom:10, position:"relative" }}>
                        <div style={{ height:10, width:`${pct2}%`,
                          background:barColor, borderRadius:5,
                          transition:"width 0.4s" }} />
                        {pct2 < 100 && (
                          <div style={{ position:"absolute", right:0, top:0,
                            height:10, width:`${100-pct2}%`,
                            background:`${C.bad}22`, borderRadius:"0 5px 5px 0",
                            borderLeft:`2px dashed ${C.bad}44` }} />
                        )}
                      </div>
                    </>
                  );
                })()}
                <ResponsiveContainer width="100%" height={120}>
                  <AreaChart data={proj.filter(cf)}>
                    <defs>
                      <linearGradient id="gs2" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={C.super} stopOpacity={0.3}/>
                        <stop offset="95%" stopColor={C.super} stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="age" stroke={C.muted} tick={{fontSize:9}} />
                    <YAxis hide />
                    <Tooltip content={<TT />} />
                    <ReferenceLine x={inp.retirementAge} stroke="#a78bfa" strokeDasharray="4 2" />
                    <Area type="monotone" dataKey="super" name="Super" stroke={C.super} fill="url(#gs2)" strokeWidth={2} dot={false} />
                    <Area type="monotone" dataKey="superPension" name="Pension Phase" stroke="#60a5fa" fill="none" strokeWidth={1.5} strokeDasharray="4 2" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </Card>
            </div>

            {/* ── ROW 6: Income Sources + Property ── */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:14 }}>
              <Card title="Retirement Income Sources" icon="💰" color={C.pension}>
                <div style={{ display:"flex", gap:12, alignItems:"center" }}>
                  <PieChart width={120} height={120}>
                    <Pie data={[
                      { name:"Age Pension",  value:agePensionAtRetire },
                      { name:"Super Draw",   value:Math.max(0,inp.retirementExpenses-agePensionAtRetire-totalRentalIncome-inp.otherIncome) },
                      { name:"Rental",       value:totalRentalIncome },
                      { name:"Other",        value:inp.otherIncome },
                    ].filter(x=>x.value>0)}
                    cx={55} cy={55} innerRadius={32} outerRadius={52}
                    dataKey="value" paddingAngle={3}>
                      {[C.pension,C.super,C.prop,C.outside].map((c,i)=><Cell key={i} fill={c} />)}
                    </Pie>
                  </PieChart>
                  <div style={{ flex:1 }}>
                    {[
                      ["Age Pension",    agePensionAtRetire,                                                           C.pension],
                      ["Super Drawdown", Math.max(0,inp.retirementExpenses-agePensionAtRetire-totalRentalIncome),      C.super  ],
                      ["Rental",         totalRentalIncome,                                                            C.prop   ],
                      ["Other",          inp.otherIncome,                                                              C.outside],
                    ].map(([k,v,c])=>(
                      <div key={k} style={{ display:"flex", justifyContent:"space-between",
                        padding:"4px 0", borderBottom:`1px solid ${C.border}`, fontSize:11 }}>
                        <span style={{ color:C.muted }}>{k}</span>
                        <span style={{ color:c, fontWeight:700 }}>{aud(v)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </Card>

              <Card title="Property Portfolio" icon="🏘️" color={C.prop}>
                {inp.properties.map(p=>(
                  <div key={p.id} style={{ padding:"7px 0", borderBottom:`1px solid ${C.border}` }}>
                    <div style={{ display:"flex", justifyContent:"space-between" }}>
                      <span style={{ fontSize:11, color:C.text }}>{p.label} {p.isNewBuild&&<Badge color={C.warn}>Build</Badge>}</span>
                      <span style={{ color:C.prop, fontWeight:700 }}>{aud(p.value)}</span>
                    </div>
                    <div style={{ fontSize:10, color:C.muted }}>
                      Equity: {aud(p.value-p.mortgage)} · Rent: {aud((p.weeklyRent||0)*52)}/yr · Yield: {pct((p.weeklyRent||0)*52/Math.max(1,p.value))}
                    </div>
                  </div>
                ))}
                <div style={{ display:"flex", justifyContent:"space-between",
                  padding:"8px 0 0", fontWeight:800, fontSize:11 }}>
                  <span style={{ color:C.muted }}>Total Equity</span>
                  <span style={{ color:C.prop }}>{aud(totalPropertyEquity)}</span>
                </div>
              </Card>
            </div>

            {/* ── ROW 7: Quick Action Shortcuts ── */}
            <div style={{ background:"white", border:`1.5px solid ${C.border}`,
              borderRadius:12, padding:"14px 16px" }}>
              <div style={{ fontSize:11, fontWeight:800, color:C.text,
                marginBottom:10, textTransform:"uppercase",
                letterSpacing:"0.07em" }}>⚡ Quick Actions</div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))", gap:8 }}>
                {[
                  { icon:"🦘", label:"Update Super",        tab:"super",       color:C.super   },
                  { icon:"🎯", label:"Super Strategy",      tab:"superstrategy",color:C.main   },
                  { icon:"🏘️", label:"Properties",         tab:"properties",  color:C.prop    },
                  { icon:"🧾", label:"Tax Planning",        tab:"tax",         color:C.warn    },
                  { icon:"👴", label:"Age Pension",         tab:"agepension",  color:C.pension },
                  { icon:"💰", label:"Cash Flow",           tab:"cashflow",    color:C.ok      },
                  { icon:"🎲", label:"Monte Carlo",         tab:"montecarlo",  color:C.super   },
                  { icon:"🏛️", label:"Estate Planning",    tab:"estate",      color:"#a78bfa" },
                  { icon:"💊", label:"Centrelink",          tab:"centrelink",  color:"#0891b2" },
                  { icon:"💰", label:"Annuity",             tab:"annuity",     color:C.pension },
                ].map(a=>(
                  <button key={a.tab} onClick={()=>setTab(a.tab)}
                    style={{ background:`${a.color}08`,
                      border:`1.5px solid ${a.color}33`, borderRadius:10,
                      padding:"10px 8px", cursor:"pointer",
                      display:"flex", flexDirection:"column",
                      alignItems:"center", gap:4,
                      transition:"all 0.15s" }}
                    onMouseEnter={e=>e.currentTarget.style.background=`${a.color}18`}
                    onMouseLeave={e=>e.currentTarget.style.background=`${a.color}08`}>
                    <span style={{ fontSize:20 }}>{a.icon}</span>
                    <span style={{ fontSize:10, fontWeight:700,
                      color:a.color }}>{a.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
{/* ═══ ASSETS ═══ */}
        {tab === "assets" && (() => {

          // ── constants ──────────────────────────────────────────────
          const ASSET_TYPES = {
            shares_au:    { label:"ASX / ETF Shares",        icon:"📈", color:C.outside,  defReturn:0.095, defVol:0.16  },
            shares_intl:  { label:"International Shares",    icon:"🌏", color:"#0891b2",  defReturn:0.105, defVol:0.17  },
            gold:         { label:"Gold / Precious Metals",  icon:"🥇", color:C.prop,     defReturn:0.06,  defVol:0.15  },
            crypto:       { label:"Bitcoin / Crypto",        icon:"₿",  color:"#f59e0b",  defReturn:0.15,  defVol:0.55  },
            term_deposit: { label:"Term Deposits / Cash",    icon:"🏦", color:C.super,    defReturn:0.045, defVol:0.005 },
            jewelry:      { label:"Jewelry / Collectibles",  icon:"💎", color:"#7c3aed",  defReturn:0.03,  defVol:0.10  },
            vehicle:      { label:"Vehicle / Car",           icon:"🚗", color:C.muted,    defReturn:-0.08, defVol:0.05  },
            other:        { label:"Other Asset",             icon:"📦", color:C.muted,    defReturn:0.04,  defVol:0.10  },
          };

          // ── derived totals ─────────────────────────────────────────
          const ppor          = inp.ppor || {};
          const pporEquity    = Math.max(0, (ppor.value||0) - (ppor.mortgage||0));
          const items         = inp.assetItems || [];
          const offsets       = inp.offsetAccounts || [];

          const totalFinancial   = items.reduce((s,a) => s+(a.value||0), 0);
          const totalOffset      = offsets.reduce((s,o) => s+(o.balance||0), 0);
          const totalMortgages   = inp.properties.reduce((s,p) => s+(p.mortgage||0), 0);
          const effectiveMortgage= Math.max(0, totalMortgages - totalOffset);
          const interestSaved    = totalOffset * (inp.mortgageRate||0.065);

          const totalNetWorth    = inp.superBalance + totalFinancial + pporEquity
                                 + totalPropertyEquity - totalDebt;
          const investableNW     = inp.superBalance + totalFinancial
                                 + totalPropertyEquity - totalDebt;
          const pensionAssets    = totalFinancial + totalPropertyEquity;
          // Note: super counted for pension asset test only from age 67+

          // weighted portfolio volatility
          const totalForVol   = items.reduce((s,a) => s+Math.abs(a.value||0), 0) || 1;
          const weightedVol   = items.reduce((s,a) =>
            s + (Math.abs(a.value||0)/totalForVol)*(a.volatility||0), 0);

          // ── PPOR helpers ───────────────────────────────────────────
          const setPPOR = (field, val) =>
            setInp(p => ({
              ...p,
              ppor: { ...(p.ppor||{}), [field]: val },
              properties: p.properties.map(pr =>
                pr.isPrimary
                  ? { ...pr,
                      value:    field === "value"    ? val : pr.value,
                      mortgage: field === "mortgage" ? val : pr.mortgage,
                    }
                  : pr
              ),
            }));

          // ── asset item helpers ─────────────────────────────────────
          const addItem = (type) => {
            const t = ASSET_TYPES[type] || ASSET_TYPES.other;
            set("assetItems")([...items, {
              id: `a${Date.now()}`, type,
              label: t.label, value: 0, annualContrib: 0,
              returnRate: t.defReturn, volatility: t.defVol, notes: "",
            }]);
          };
          const updItem = (id, field, val) =>
            set("assetItems")(items.map(a => a.id===id ? {...a,[field]:val} : a));
          const delItem = (id) =>
            set("assetItems")(items.filter(a => a.id!==id));

          // ── offset helpers ─────────────────────────────────────────
          const addOffset = () => set("offsetAccounts")([...offsets, {
            id:`o${Date.now()}`, label:`Offset Account ${offsets.length+1}`,
            balance:0, linkedPropertyId:"",
          }]);
          const updOffset = (id, field, val) =>
            set("offsetAccounts")(offsets.map(o => o.id===id ? {...o,[field]:val} : o));
          const delOffset = (id) =>
            set("offsetAccounts")(offsets.filter(o => o.id!==id));

          // ── 30yr projection chart ──────────────────────────────────
          const projData = [];
          let bals = items.map(a => a.value||0);
          let pv   = ppor.value || 0;
          let ipv  = inp.properties.reduce((s,p) => s+(p.value||0), 0);
          for (let yr=0; yr<=30; yr+=5) {
            const entry = {
              year: `+${yr}yr`,
              "Super":                Math.round(inp.superBalance * Math.pow(1+(inp.returnRate||0.075), yr)),
              "PPOR Equity":          Math.round(Math.max(0, pv * Math.pow(1+(ppor.growthRate||0.04),yr) - (ppor.mortgage||0))),
              "Investment Properties":Math.round(ipv * Math.pow(1+(inp.propertyGrowthRate||0.04), yr)),
              "Financial Assets":     Math.round(bals.reduce((s,b)=>s+b,0)),
            };
            projData.push(entry);
            bals = bals.map((b,i) => b*(1+(items[i].returnRate||0))+(items[i].annualContrib||0));
          }

          return (
            <>
            {/* ── Property Analyser Pro link ── */}
              <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:10 }}>
                <a href="https://property-analyser-pro-3mr1.vercel.app" target="_blank" rel="noopener noreferrer"
                  style={{ display:"inline-flex", alignItems:"center", gap:6,
                    background:"linear-gradient(135deg, #0f172a, #1e3a5f)",
                    border:"1.5px solid #2563eb44", borderRadius:8,
                    padding:"6px 14px", textDecoration:"none",
                    color:"white", fontSize:10, fontWeight:800,
                    boxShadow:"0 2px 8px #2563eb22" }}>
                  <span style={{ fontSize:13 }}>🏘️</span>
                  <div>
                    <div style={{ fontSize:10, fontWeight:900 }}>Property Analyser Pro ↗</div>
                    <div style={{ fontSize:8, color:"#93c5fd", fontWeight:400 }}>IRR · DCF · Stamp Duty · Neg. Gearing</div>
                  </div>
                </a>
              </div>
              {/* ── 3-figure Net Worth summary ────────── */}
              <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginBottom:16 }}>
                {[
                  { label:"Total Net Worth",            val:totalNetWorth,  color:C.main,
                    sub:"Incl. PPOR equity", icon:"🏡" },
                  { label:"Investable NW (ex-PPOR)",        val:investableNW,   color:C.super,
                    sub:"Excl. PPOR — liquid wealth", icon:"💼" },
                  { label:"Pension-Assessable Assets",   val:pensionAssets,  color:C.pension,
                    sub:"Excl. PPOR + super (pre-67)", icon:"🏛️" },
                ].map(m => (
                  <div key={m.label} style={{ background:"white", borderRadius:12,
                    border:`2px solid ${m.color}22`, padding:"14px 16px",
                    boxShadow:"0 1px 4px rgba(0,0,0,0.06)", overflow:"hidden", minWidth:0 }}>
                    <div style={{ fontSize:18, marginBottom:4 }}>{m.icon}</div>
                    <div style={{ fontSize:11, color:C.muted, marginBottom:4,
                      textTransform:"uppercase", letterSpacing:"0.06em", fontWeight:700 }}>{m.label}</div>
                    <div style={{ fontSize:22, fontWeight:900, color:m.color,
                      fontFamily:"monospace", marginBottom:4 }}>{aud(m.val)}</div>
                    <div style={{ fontSize:10, color:C.muted }}>{m.sub}</div>
                  </div>
                ))}
              </div>
              <AlertBox icon="ℹ️" color={C.super}
                msg="PPOR (your home) counts toward Total Net Worth but is excluded from the Age Pension asset test and Investable Net Worth. Super in accumulation is excluded from the pension asset test until age 67." />

              {/* ══════════════════════════════════════════
                  SECTION 1 — REAL ESTATE
              ══════════════════════════════════════════ */}
              <div style={{ display:"flex", alignItems:"center", gap:10, margin:"20px 0 10px",
                borderBottom:`2px solid ${C.prop}`, paddingBottom:6 }}>
                <span style={{ fontSize:20 }}>🏘️</span>
                <span style={{ fontSize:15, fontWeight:900, color:C.prop, letterSpacing:"-0.02em" }}>
                  REAL ESTATE
                </span>
                <button onClick={() => { setTab("properties"); }}
                  style={{ marginLeft:"auto", background:C.prop, color:"#fff", border:"none",
                    borderRadius:20, padding:"4px 14px", fontSize:10, fontWeight:700,
                    cursor:"pointer", letterSpacing:"0.04em" }}>
                  ➜ Full detail in Properties tab
                </button>
              </div>

             {/* PPOR card */}
              <Card title="Principal Place of Residence (PPOR / Family Home)" icon="🏡" color={C.prop}
                action={<Badge color={C.ok}>✓ Pension exempt</Badge>}>

                {/* PPOR toggle — not everyone owns */}
                <Tog label="I own my home (PPOR)"
                  value={(ppor.value || 0) > 0 || ppor.hasHome || false}
                  onChange={v => setPPOR("hasHome", v)}
                  note="Toggle on to enter your home value. PPOR is excluded from the Age Pension asset test." />

                {(ppor.hasHome || (ppor.value || 0) > 0) ? (
                  <>
                    <div style={{ background:"#fffbeb", border:`1px solid ${C.prop}44`,
                      borderRadius:8, padding:"7px 12px", fontSize:10, color:"#92400e", marginBottom:12 }}>
                      <strong>🏛️ Age Pension rule:</strong> Your home is exempt from the Centrelink
                      asset test. PPOR <em>is</em> counted in Total Net Worth but
                      <em> not</em> in Pension-Assessable Assets or Investable Net Worth.
                    </div>
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                      <Fld label="Address / Description" value={ppor.address||""}
                        onChange={v => setPPOR("address",v)} pre="" note="e.g. 12 Smith St, Melbourne" />
                      <Fld label="Current Market Value ($)" value={ppor.value||0} type="number"
                        onChange={v => setPPOR("value",Number(v))} pre="$" />
                      <Fld label="Mortgage Remaining ($)" value={ppor.mortgage||0} type="number"
                        onChange={v => setPPOR("mortgage",Number(v))} pre="$"
                        note="Enter 0 if fully owned" />
                      <div style={{ background:C.bg, borderRadius:8, padding:"9px 12px",
                        display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                        <span style={{ fontSize:11, color:C.muted }}>PPOR Equity</span>
                        <span style={{ fontSize:16, fontWeight:800, color:C.prop,
                          fontFamily:"monospace" }}>{aud(pporEquity)}</span>
                      </div>
                    </div>
                    <div style={{ marginTop:10 }}>
                      <Sld label="Annual Growth Rate" value={ppor.growthRate||0.04}
                        min={0} max={0.12} step={0.005}
                        onChange={v => setPPOR("growthRate",v)}
                        fmt2={v=>`${(v*100).toFixed(1)}%`}
                        note="Australian residential long-run avg ~4–5% nominal (CoreLogic/RBA)"
                        color={C.prop} />
                    </div>
                    <div style={{ marginTop:8, display:"flex", gap:10, flexWrap:"wrap" }}>
                      {[
                        { label:"Market Value",  val:aud(ppor.value||0),   color:C.prop  },
                        { label:"Mortgage",      val:aud(ppor.mortgage||0),color:C.debt  },
                        { label:"Equity",        val:aud(pporEquity),       color:C.ok   },
                        { label:"In Net Worth",  val:"✓ Yes",               color:C.ok   },
                        { label:"Pension Test",  val:"✗ Excluded",          color:C.warn },
                      ].map(m => (
                        <div key={m.label} style={{ background:"white", border:`1px solid ${C.border}`,
                          borderRadius:8, padding:"6px 12px", textAlign:"center", minWidth:90 }}>
                          <div style={{ fontSize:9, color:C.muted, marginBottom:2 }}>{m.label}</div>
                          <div style={{ fontSize:12, fontWeight:800, color:m.color,
                            fontFamily:"monospace" }}>{m.val}</div>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div style={{ background:C.bg, borderRadius:10, padding:"16px",
                    textAlign:"center", border:`2px dashed ${C.border}`, marginTop:8 }}>
                    <div style={{ fontSize:24, marginBottom:6 }}>🏠</div>
                    <div style={{ fontSize:12, fontWeight:700, color:C.muted, marginBottom:4 }}>
                      No PPOR entered
                    </div>
                    <div style={{ fontSize:10, color:C.muted, lineHeight:1.6 }}>
                      Toggle "I own my home" above to add your home value.<br/>
                      If you rent, your PPOR equity is $0 — which is correct for net worth purposes.
                    </div>
                  </div>
                )}
              </Card>
                <div style={{ background:"#fffbeb", border:`1px solid ${C.prop}44`,
                  borderRadius:8, padding:"7px 12px", fontSize:10, color:"#92400e", marginBottom:12 }}>
                  <strong>🏛️ Age Pension rule:</strong> Your home is exempt from the Centrelink asset test.
                  As a homeowner, your asset threshold is lower — reflecting that your home provides housing value.
                  PPOR <em>is</em> counted in your Total Net Worth and retirement wealth picture.
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                  <Fld label="Address / Description" value={ppor.address||""}
                    onChange={v => setPPOR("address",v)} note="e.g. 12 Smith St, Melbourne" />
                  <Fld label="Current Value ($)" value={ppor.value||0} type="number"
                    onChange={v => setPPOR("value",Number(v))} pre="$" />
                  <Fld label="Mortgage Remaining ($)" value={ppor.mortgage||0} type="number"
                    onChange={v => setPPOR("mortgage",Number(v))} pre="$" />
                  <div>
                    <div style={{ display:"flex", justifyContent:"space-between",
                      background:C.bg, borderRadius:8, padding:"9px 12px" }}>
                      <span style={{ fontSize:11, color:C.muted }}>PPOR Equity</span>
                      <span style={{ fontSize:14, fontWeight:800, color:C.prop,
                        fontFamily:"monospace" }}>{aud(pporEquity)}</span>
                    </div>
                  </div>
                </div>
                <div style={{ marginTop:10 }}>
                  <Sld label="Annual Growth Rate" value={ppor.growthRate||0.04}
                    min={0} max={0.12} step={0.005}
                    onChange={v => setPPOR("growthRate",v)}
                    fmt2={v=>`${(v*100).toFixed(1)}%`}
                    note="Australian residential property long-run avg ~4–5% nominal (CoreLogic/RBA)"
                    color={C.prop} />
                </div>
              

              {/* Investment properties — summary from inp.properties[] */}
              {inp.properties.filter(p => !p.isPrimary).length > 0 && (
                <div>
                  <div style={{ fontSize:11, fontWeight:800, color:C.muted, margin:"12px 0 6px",
                    textTransform:"uppercase", letterSpacing:"0.07em" }}>
                    Investment Properties ({inp.properties.length})
                  </div>
                {inp.properties.filter(p => !p.isPrimary).map((p, idx) => {
                    const eq = Math.max(0,(p.value||0)-(p.mortgage||0));
                    const netRent = (p.weeklyRent||0)*52*(1-(p.expenseRatio||0.25));
                    const linked = offsets.filter(o => o.linkedPropertyId === p.id || o.linkedPropertyId === String(idx));
                    const offsetBal = linked.reduce((s,o) => s+(o.balance||0), 0);
                    return (
                      <div key={p.id||idx} style={{ background:"white", border:`1.5px solid ${C.border}`,
                        borderRadius:12, padding:"12px 14px", marginBottom:8,
                        boxShadow:"0 1px 3px rgba(0,0,0,0.05)" }}>
                        <div style={{ display:"flex", justifyContent:"space-between",
                          alignItems:"flex-start", marginBottom:10 }}>
                          <div>
                            <div style={{ fontWeight:800, fontSize:13, color:C.text }}>
                              🏢 {p.address || `Investment Property ${idx+1}`}
                            </div>
                            <div style={{ fontSize:10, color:C.muted, marginTop:2 }}>
                              Investment property · <span style={{ color:C.prop }}>Pension assessable</span>
                            </div>
                          </div>
                          <button onClick={() => setTab("properties")}
                            style={{ background:C.bg, border:`1px solid ${C.border}`, borderRadius:20,
                              padding:"3px 12px", fontSize:10, color:C.muted, cursor:"pointer" }}>
                            Edit detail ➜
                          </button>
                        </div>
                        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:6 }}>
                          {[
                            { label:"Value",        val:aud(p.value||0),  color:C.prop   },
                            { label:"Mortgage",     val:aud(p.mortgage||0), color:C.debt },
                            { label:"Equity",       val:aud(eq),          color:C.ok     },
                            { label:"Net Rent/yr",  val:aud(netRent),     color:C.outside},
                          ].map(m => (
                            <div key={m.label} style={{ background:C.bg, borderRadius:8,
                              padding:"7px 10px", textAlign:"center" }}>
                              <div style={{ fontSize:9, color:C.muted, marginBottom:2,
                                textTransform:"uppercase", letterSpacing:"0.05em" }}>{m.label}</div>
                              <div style={{ fontSize:12, fontWeight:800, color:m.color,
                                fontFamily:"monospace" }}>{m.val}</div>
                            </div>
                          ))}
                        </div>
                        {offsetBal > 0 && (
                          <div style={{ marginTop:8, fontSize:10, color:C.ok, background:"#f0fdf4",
                            borderRadius:6, padding:"5px 10px" }}>
                            ✓ Offset account: {aud(offsetBal)} linked
                            — saves {aud(offsetBal*(inp.mortgageRate||0.065))}/yr interest
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {inp.properties.filter(p => !p.isPrimary).length === 0 && (
                <div style={{ textAlign:"center", padding:"20px", color:C.muted, fontSize:12,
                  background:C.bg, borderRadius:10, border:`2px dashed ${C.border}`, marginTop:8 }}>
                  No investment properties added yet.
                  <button onClick={() => setTab("properties")}
                    style={{ background:"none", border:"none", color:C.prop, fontWeight:700,
                      cursor:"pointer", fontSize:12 }}> Add in Properties tab →</button>
                </div>
              )}

              {/* Offset accounts section */}
              <Card title="Rental Property Offset Accounts" icon="⚖️" color={C.prop}
                action={<Btn onClick={addOffset} small color={C.prop}>+ Add Offset</Btn>}>
                <div style={{ fontSize:11, color:C.muted, marginBottom:10 }}>
                  Offset account balances are netted against your mortgage for interest purposes.
                  Unlike redraw, funds stay accessible. Link each offset to its property below.
                </div>
                {offsets.length === 0 && (
                  <div style={{ fontSize:11, color:C.muted, fontStyle:"italic" }}>
                    No offset accounts added yet.
                  </div>
                )}
                {offsets.map(o => (
                  <div key={o.id} style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr auto",
                    gap:8, alignItems:"end", marginBottom:8,
                    background:C.bg, borderRadius:8, padding:"8px 10px" }}>
                    <Fld label="Account Label" value={o.label||""}
                      onChange={v => updOffset(o.id,"label",v)} />
                    <Fld label="Balance ($)" value={o.balance||0} type="number"
                      onChange={v => updOffset(o.id,"balance",Number(v))} pre="$"
                      note={`Saves ${aud((o.balance||0)*(inp.mortgageRate||0.065))}/yr`} />
                    <div>
                      <div style={{ fontSize:10, color:C.muted, marginBottom:4 }}>Link to Property</div>
                      <select value={o.linkedPropertyId||""}
                        onChange={e => updOffset(o.id,"linkedPropertyId",e.target.value)}
                        style={{ width:"100%", padding:"6px 8px", borderRadius:6,
                          border:`1px solid ${C.border}`, fontSize:11, background:"white" }}>
                        <option value="">— not linked —</option>
                        {inp.properties.map((p,i) => (
                          <option key={p.id||i} value={p.id||String(i)}>
                            {p.address || `Property ${i+1}`}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button onClick={() => delOffset(o.id)}
                      style={{ background:"none", border:"none", color:C.bad,
                        cursor:"pointer", fontSize:16, paddingBottom:4 }}>✕</button>
                  </div>
                ))}
                {offsets.length > 0 && (
                  <div style={{ display:"flex", gap:10, marginTop:8, flexWrap:"wrap" }}>
                    {[
                      { label:"Total offset", val:aud(totalOffset), color:C.ok },
                      { label:"Interest saved/yr", val:aud(interestSaved), color:C.ok },
                      { label:"Effective mortgage", val:aud(effectiveMortgage), color:C.super },
                    ].map(m => (
                      <div key={m.label} style={{ background:"white", border:`1px solid ${C.border}`,
                        borderRadius:8, padding:"7px 12px" }}>
                        <div style={{ fontSize:9, color:C.muted }}>{m.label}</div>
                        <div style={{ fontWeight:800, color:m.color, fontFamily:"monospace",
                          fontSize:12 }}>{m.val}</div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              {/* ══════════════════════════════════════════
                  SECTION 2 — SUPERANNUATION (read-only)
              ══════════════════════════════════════════ */}
              <div style={{ display:"flex", alignItems:"center", gap:10, margin:"20px 0 10px",
                borderBottom:`2px solid ${C.super}`, paddingBottom:6 }}>
                <span style={{ fontSize:20 }}>🏛️</span>
                <span style={{ fontSize:15, fontWeight:900, color:C.super }}>SUPERANNUATION</span>
                <button onClick={() => setTab("super")}
                  style={{ marginLeft:"auto", background:C.super, color:"#fff", border:"none",
                    borderRadius:20, padding:"4px 14px", fontSize:10, fontWeight:700, cursor:"pointer" }}>
                  ➜ Manage in Super tab
                </button>
              </div>
              <div style={{ background:"white", border:`1.5px solid ${C.border}`, borderRadius:12,
                padding:"12px 14px", marginBottom:4 }}>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:6 }}>
                  {[
                    { label:"Super Balance",    val:aud(inp.superBalance),        color:C.super },
                    { label:"Outside Super",    val:aud(inp.outsideSuper),         color:C.outside },
                    { label:"Annual SG",        val:aud(inp.annualIncome*0.12),    color:C.super },
                    { label:"Voluntary Contrib",val:aud(inp.voluntarySuper||0),    color:C.ok },
                  ].map(m => (
                    <div key={m.label} style={{ background:C.bg, borderRadius:8,
                      padding:"8px 10px", textAlign:"center" }}>
                      <div style={{ fontSize:9, color:C.muted, marginBottom:3,
                        textTransform:"uppercase", letterSpacing:"0.05em" }}>{m.label}</div>
                      <div style={{ fontSize:13, fontWeight:800, color:m.color,
                        fontFamily:"monospace" }}>{m.val}</div>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize:10, color:C.muted, marginTop:8, fontStyle:"italic" }}>
                  Super in accumulation phase is <strong>not assessed</strong> for Age Pension purposes
                  until you reach pension age (67). Edit super details, contributions and SMSF in the Super tab.
                </div>
              </div>

              {/* ══════════════════════════════════════════
                  SECTION 3 — FINANCIAL ASSETS
              ══════════════════════════════════════════ */}
              <div style={{ display:"flex", alignItems:"center", gap:10, margin:"20px 0 10px",
                borderBottom:`2px solid ${C.outside}`, paddingBottom:6 }}>
                <span style={{ fontSize:20 }}>💼</span>
                <span style={{ fontSize:15, fontWeight:900, color:C.outside }}>
                  FINANCIAL ASSETS (Outside Super)
                </span>
              </div>

              {/* Add asset buttons */}
              <div style={{ background:C.bg, borderRadius:10, padding:"10px 14px", marginBottom:12 }}>
                <div style={{ fontSize:10, color:C.muted, marginBottom:8, fontWeight:700 }}>
                  ADD ASSET CLASS
                </div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
                  {Object.entries(ASSET_TYPES).map(([type, t]) => (
                    <button key={type} onClick={() => addItem(type)}
                      style={{ background:"white", border:`1.5px solid ${t.color}`,
                        borderRadius:20, padding:"5px 14px", fontSize:11, color:t.color,
                        fontWeight:700, cursor:"pointer" }}>
                      {t.icon} {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Asset item cards */}
              {items.length === 0 && (
                <div style={{ textAlign:"center", padding:"28px", color:C.muted, fontSize:12,
                  background:C.bg, borderRadius:10, border:`2px dashed ${C.border}` }}>
                  <div style={{ fontSize:28, marginBottom:6 }}>💼</div>
                  No financial assets added yet. Use the buttons above.
                </div>
              )}

              {items.map(item => {
                const t      = ASSET_TYPES[item.type] || ASSET_TYPES.other;
                const isCrypto  = item.type === "crypto";
                const isVehicle = item.type === "vehicle";
                const realReturn = item.returnRate - 0.025;
                const proj10 = (item.value||0) * Math.pow(1+item.returnRate, 10);
                const riskCat = item.volatility < 0.05 ? "Defensive"
                  : item.volatility < 0.12 ? "Conservative"
                  : item.volatility < 0.18 ? "Balanced"
                  : item.volatility < 0.28 ? "Growth" : "High Growth / Speculative";

                return (
                  <Card key={item.id} icon={t.icon} color={t.color}
                    title={
                      <input value={item.label}
                        onChange={e => updItem(item.id,"label",e.target.value)}
                        style={{ border:"none", background:"transparent", fontWeight:800,
                          fontSize:14, color:C.text, width:"100%", outline:"none" }} />
                    }
                    action={
                      <button onClick={() => delItem(item.id)}
                        style={{ background:"none", border:"none", color:C.bad,
                          cursor:"pointer", fontSize:16 }}>✕</button>
                    }>

                    {/* Value + contribution */}
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:8 }}>
                      <Fld label="Current Value ($)" value={item.value||0} type="number"
                        onChange={v => updItem(item.id,"value",Number(v))} pre="$" />
                      <Fld label="Annual Contribution ($)" value={item.annualContrib||0} type="number"
                        onChange={v => updItem(item.id,"annualContrib",Number(v))} pre="$"
                        note="How much you add per year (DCA / regular saving)" />
                    </div>

                    {/* Assumption sliders */}
                    <div style={{ background:C.bg, borderRadius:10, padding:"10px 14px", marginTop:4 }}>
                      <div style={{ fontSize:10, color:C.muted, fontWeight:800,
                        textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:8 }}>
                        📐 Growth & Risk Assumptions
                      </div>

                      <Sld label="Expected Annual Return"
                        value={item.returnRate}
                        min={isVehicle ? -0.20 : -0.05}
                        max={isCrypto ? 0.60 : 0.25}
                        step={0.005}
                        onChange={v => updItem(item.id,"returnRate",v)}
                        fmt2={v=>`${(v*100).toFixed(1)}%`}
                        color={item.returnRate<0 ? C.bad : item.returnRate>0.15 ? C.warn : C.ok}
                        note={
                          item.type==="shares_au"    ? "ASX 200 total return incl. dividends ~9.5–10% (Vanguard/Dimensional 30yr)" :
                          item.type==="shares_intl"  ? "MSCI World ex-AU in AUD ~10.5% (Vanguard Index Chart 2025)" :
                          item.type==="gold"         ? "Gold long-run nominal avg ~6%; short-run volatile (RBA/World Gold Council)" :
                          item.type==="crypto"       ? "Bitcoin: bear 1% → base 10–15% → bull 20%+ (Morgan Stanley 2024)" :
                          item.type==="term_deposit" ? "Current AU term deposits ~4–5% p.a.; proxies RBA cash rate + spread" :
                          item.type==="jewelry"      ? "Approx CPI ~2.5–3%; illiquid, subjective; collectibles may vary widely" :
                          item.type==="vehicle"      ? "New cars depreciate ~15%/yr; used ~8%/yr. Set 0% for classic collectibles." :
                          "Set your own growth assumption"
                        }
                      />

                      <Sld label="Annual Volatility (Std Dev)"
                        value={item.volatility}
                        min={0} max={isCrypto ? 0.90 : 0.50}
                        step={0.005}
                        onChange={v => updItem(item.id,"volatility",v)}
                        fmt2={v=>`±${(v*100).toFixed(1)}%`}
                        color={item.volatility>0.40 ? C.bad : item.volatility>0.20 ? C.warn : C.ok}
                        note={
                          item.type==="shares_au"    ? "ASX historical volatility ~15–17% (std dev of annual returns)" :
                          item.type==="shares_intl"  ? "Global equities ~17% volatility (BlackRock/Bloomberg 2025)" :
                          item.type==="gold"         ? "Gold ~15.1% annualised volatility (BlackRock/Bloomberg Jan 2025)" :
                          item.type==="crypto"       ? "Bitcoin ~54% annualised volatility (BlackRock/Bloomberg Jan 2025)" :
                          item.type==="term_deposit" ? "Near-zero — capital guaranteed by APRA up to $250k per ADI" :
                          "Higher volatility = wider range of Monte Carlo outcomes"
                        }
                      />

                      {/* Live feedback row */}
                      <div style={{ display:"flex", gap:8, marginTop:10, flexWrap:"wrap" }}>
                        {[
                          { label:"Real return (after 2.5% CPI)",
                            val:`${(realReturn*100).toFixed(1)}%`,
                            color: realReturn>0 ? C.ok : C.bad },
                          { label:"10yr projection",
                            val:aud(Math.max(0,proj10)),
                            color:C.main },
                          { label:"Risk category",
                            val:riskCat,
                            color:item.volatility<0.05?C.ok:item.volatility<0.18?C.warn:C.bad },
                          { label:"Monte Carlo sigma",
                            val:`±${pct(item.volatility)}`,
                            color:C.muted },
                        ].map(m => (
                          <div key={m.label} style={{ background:"white",
                            border:`1px solid ${C.border}`, borderRadius:8,
                            padding:"6px 10px", minWidth:130 }}>
                            <div style={{ fontSize:9, color:C.muted, marginBottom:2 }}>{m.label}</div>
                            <div style={{ fontSize:12, fontWeight:800, color:m.color,
                              fontFamily:"monospace" }}>{m.val}</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div style={{ marginTop:8 }}>
                      <Fld label="Notes (optional)" value={item.notes||""}
                        onChange={v => updItem(item.id,"notes",v)}
                        note="e.g. broker, ticker, account name, platform" />
                    </div>
                  </Card>
                );
              })}

              {/* ══════════════════════════════════════════
                  SECTION 4 — PORTFOLIO PROJECTION CHART
              ══════════════════════════════════════════ */}
              {(items.filter(a=>(a.value||0)>0).length > 0 || (ppor.value||0) > 0) && (
                <Card title="Total Wealth Projection — 30 Years" icon="📈" color={C.main}>
                  <div style={{ fontSize:11, color:C.muted, marginBottom:8 }}>
                    Each asset class grows at its own assumed rate. Adjust sliders above to see impact immediately.
                  </div>
                  <ResponsiveContainer width="100%" height={260}>
                    <AreaChart data={projData}>
                      <defs>
                        {[
                          ["super",  C.super  ],
                          ["ppor",   C.prop   ],
                          ["ip",     "#c2410c"],
                          ["fin",    C.outside],
                        ].map(([id, color]) => (
                          <linearGradient key={id} id={`ag_${id}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%"  stopColor={color} stopOpacity={0.35}/>
                            <stop offset="95%" stopColor={color} stopOpacity={0}/>
                          </linearGradient>
                        ))}
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                      <XAxis dataKey="year" stroke={C.muted} tick={{ fontSize:10 }} />
                      <YAxis stroke={C.muted} tick={{ fontSize:10 }}
                        tickFormatter={v => v>=1e6 ? `$${(v/1e6).toFixed(1)}M` : `$${(v/1e3).toFixed(0)}k`} />
                      <Tooltip content={<TT />} />
                      <Legend wrapperStyle={{ fontSize:10 }} />
                      <Area type="monotone" dataKey="Super"
                        stroke={C.super}   fill="url(#ag_super)" strokeWidth={2} dot={false} />
                      <Area type="monotone" dataKey="PPOR Equity"
                        stroke={C.prop}    fill="url(#ag_ppor)"  strokeWidth={2} dot={false} />
                      <Area type="monotone" dataKey="Investment Properties"
                        stroke="#c2410c"   fill="url(#ag_ip)"    strokeWidth={1.5} dot={false} />
                      <Area type="monotone" dataKey="Financial Assets"
                        stroke={C.outside} fill="url(#ag_fin)"   strokeWidth={1.5} dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </Card>
              )}

              {/* ══════════════════════════════════════════
                  SECTION 5 — ASSUMPTIONS REFERENCE
              ══════════════════════════════════════════ */}
              <Card title="Default Assumptions — Research Basis" icon="📚" color={C.muted}>
                <div style={{ overflowX:"auto" }}>
                  <table style={{ width:"100%", borderCollapse:"collapse", fontSize:10 }}>
                    <thead>
                      <tr style={{ borderBottom:`2px solid ${C.border}`, background:C.bg }}>
                        {["Asset","Default Return","Volatility","Risk","Source"].map(h => (
                          <th key={h} style={{ padding:"6px 8px", textAlign:"left", color:C.muted,
                            fontWeight:700, fontSize:9, textTransform:"uppercase",
                            letterSpacing:"0.05em" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ["🏘️ Residential Property (AU)", "4–5%", "±8%",   "Balanced",    "CoreLogic / RBA long-run nominal (1990–2024)"],
                        ["📈 ASX / ETF Shares",           "9.5%", "±16%",  "Growth",      "ASX 200 total return incl. dividends (Vanguard 30yr)"],
                        ["🌏 International Shares",       "10.5%","±17%",  "Growth",      "MSCI World ex-AU AUD (Vanguard Index Chart 2025)"],
                        ["🥇 Gold",                       "6.0%", "±15%",  "Balanced",    "Gold long-run avg; 15.1% vol (BlackRock/Bloomberg 2025)"],
                        ["₿  Bitcoin / Crypto",           "15.0%","±55%",  "Speculative", "BTC 10yr est (Morgan Stanley 2024); vol (BlackRock 2025)"],
                        ["🏦 Term Deposits",              "4.5%", "±0.5%", "Defensive",   "RBA cash rate + spread; APRA guaranteed to $250k/ADI"],
                        ["💎 Jewelry / Collectibles",     "3.0%", "±10%",  "Conservative","Approx CPI; illiquid, subjective valuation"],
                        ["🚗 Vehicle / Car",              "–8.0%","±5%",   "Depreciating","Typical depreciation; set 0% for classic collectibles"],
                      ].map(([a,r,v,risk,src]) => (
                        <tr key={a} style={{ borderBottom:`1px solid ${C.border}22` }}>
                          <td style={{ padding:"5px 8px", fontWeight:700, color:C.text }}>{a}</td>
                          <td style={{ padding:"5px 8px", color:C.ok, fontFamily:"monospace", fontWeight:700 }}>{r}</td>
                          <td style={{ padding:"5px 8px", color:C.warn, fontFamily:"monospace" }}>{v}</td>
                          <td style={{ padding:"5px 8px", color:C.muted }}>{risk}</td>
                          <td style={{ padding:"5px 8px", color:C.muted, fontSize:9 }}>{src}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ fontSize:9, color:C.muted, marginTop:8, lineHeight:1.6 }}>
                  Sources: CoreLogic Pain & Gain 2024 · RBA Bulletin · Vanguard 2025 Index Chart ·
                  Dimensional Fund Advisors · BlackRock/Bloomberg Jan 2025 · Morgan Stanley 2024 ·
                  APRA Banking Statistics. General information only — not personal financial advice (ASIC RG 244).
                </div>
              </Card>

              {items.length > 0 && (
                <AlertBox icon="🎲" color={C.super}
                  msg={`${items.length} financial asset class${items.length>1?"es":""} tracked
                    (weighted volatility ±${pct(weightedVol)}). All flow through to
                    runProjection() and Monte Carlo. View updated results in those tabs.`} />
              )}

              <div style={{ textAlign:"center", fontSize:9, color:C.muted,
                padding:"10px 0", borderTop:`1px solid ${C.border}`, marginTop:4 }}>
                🇦🇺 PPOR excluded from Age Pension asset test per Social Security Act 1991 s.11(1) ·
                Super in accumulation excluded until age 67 · General Advice only (ASIC RG 244)
              </div>
            </>
          );
        })()}
        {/* ═══ PERSONAL & INCOME ═══ */}
        {tab === "inputs" && (() => {
          // ── ABS Life Tables 2022-24 (age-specific remaining life expectancy) ──
          const lifeTableMale = {
            0:81.1,1:80.4,2:79.4,3:78.4,4:77.5,5:76.5,6:75.5,7:74.5,8:73.5,9:72.5,10:71.5,11:70.5,
            12:69.5,13:68.6,14:67.6,15:66.7,16:65.8,17:64.8,18:63.9,19:63.0,20:62.1,21:61.2,22:60.2,
            23:59.3,24:58.4,25:57.5,26:56.6,27:55.7,28:54.7,29:53.8,30:52.9,31:52.0,32:51.1,33:50.1,
            34:49.2,35:48.3,36:47.4,37:46.5,38:45.5,39:44.6,40:43.7,41:42.8,42:41.9,43:41.0,44:40.1,
            45:39.2,46:38.3,47:37.4,48:36.5,49:35.6,50:34.7,51:33.8,52:32.9,53:32.1,54:31.2,55:30.3,
            56:29.5,57:28.6,58:27.7,59:26.9,60:26.0,61:25.2,62:24.3,63:23.5,64:22.6,65:21.8,66:21.0,
            67:20.1,68:19.3,69:18.5,70:17.7,71:16.9,72:16.1,73:15.4,74:14.6,75:13.8,76:13.1,77:12.3,
            78:11.6,79:10.9,80:10.2,81:9.5,82:8.9,83:8.2,84:7.6,85:7.0,86:6.4,87:5.9,88:5.4,89:4.9,
            90:4.4,91:4.0,92:3.6,93:3.2,94:2.9,95:2.6,96:2.3,97:2.1,98:1.9,99:1.7,100:1.5
          };
          const lifeTableFemale = {
            0:85.1,1:84.3,2:83.4,3:82.4,4:81.4,5:80.4,6:79.4,7:78.4,8:77.4,9:76.4,10:75.4,11:74.5,
            12:73.5,13:72.5,14:71.5,15:70.6,16:69.6,17:68.6,18:67.6,19:66.7,20:65.7,21:64.7,22:63.7,
            23:62.8,24:61.8,25:60.8,26:59.8,27:58.9,28:57.9,29:56.9,30:55.9,31:55.0,32:54.0,33:53.0,
            34:52.0,35:51.1,36:50.1,37:49.1,38:48.2,39:47.2,40:46.2,41:45.3,42:44.3,43:43.3,44:42.4,
            45:41.4,46:40.5,47:39.5,48:38.6,49:37.6,50:36.7,51:35.7,52:34.8,53:33.8,54:32.9,55:32.0,
            56:31.0,57:30.1,58:29.2,59:28.3,60:27.3,61:26.4,62:25.5,63:24.6,64:23.7,65:22.8,66:21.9,
            67:21.0,68:20.1,69:19.3,70:18.4,71:17.5,72:16.7,73:15.8,74:15.0,75:14.2,76:13.3,77:12.5,
            78:11.8,79:11.0,80:10.2,81:9.5,82:8.8,83:8.1,84:7.5,85:6.8,86:6.2,87:5.7,88:5.2,89:4.7,
            90:4.2,91:3.8,92:3.4,93:3.1,94:2.8,95:2.5,96:2.2,97:2.0,98:1.8,99:1.6,100:1.4
          };
          const stateAdj = {
            "":  { male:0,         female:0        },
            NSW: { male:0.1,       female:0.2      },
            VIC: { male:0.4,       female:0.3      },
            QLD: { male:-0.6,      female:-0.4     },
            SA:  { male:-0.2,      female:-0.2     },
            WA:  { male:0.4,       female:0.6      },
            TAS: { male:-0.8,      female:-1.4     },
            NT:  { male:-4.1,      female:-4.4     },
            ACT: { male:0.9,       female:0.7      },
          };
          const seifaAdj = { "":0, "1":-3.8, "2":-1.9, "3":0, "4":1.9, "5":3.8 };

          // Lifestyle adjustments (on top of ABS base)
          const healthAdj  = { Poor:-5, Fair:-2, Good:0, Excellent:3 };
          const exerciseAdj = { None:-3, Occasional:0, Regular:2, "Very Active":3 };
          const bmiAdj     = { Underweight:-2, Normal:0, Overweight:-2, Obese:-5 };
          const smokingAdj = -10; // consistent with ABS data

          // Local state for the life expectancy calculator — declared at top-level component

          // Calculate life expectancy using age-specific ABS tables
          const leAge = Math.max(0, Math.min(100, inp.currentAge));
          const leBase = (leGender === "male" ? lifeTableMale : lifeTableFemale)[leAge] || 0;
          const leSAdj  = stateAdj[leState]?.[leGender] || 0;
          const leFAdj  = seifaAdj[leSeifa] || 0;
          const leLAdj  = (leSmoker ? smokingAdj : 0)
                        + healthAdj[leHealth]
                        + exerciseAdj[leExercise]
                        + bmiAdj[leBMI];
          const leRemaining = Math.max(1, leBase + leSAdj + leFAdj + leLAdj);
          const leEstimate  = Math.round(leAge + leRemaining);
          const leAusAvg    = leGender === "male" ? 81 : 85;

          // Small radio-button group component (defined inline, avoids hoisting issues)
          const RadioGroup = ({ options, value, onChange, color }) => (
            <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
              {options.map(opt => (
                <button key={opt} onClick={() => onChange(opt)}
                  style={{ padding:"3px 9px", borderRadius:20, border:`1px solid ${value===opt ? color : C.border}`,
                    background: value===opt ? `${color}18` : C.card,
                    color: value===opt ? color : C.muted,
                    fontSize:10, fontWeight: value===opt ? 800 : 500, cursor:"pointer" }}>
                  {opt}
                </button>
              ))}
            </div>
          );

          return (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <Card title="Personal Details" icon="👤" color="#a78bfa">
              {/* Birth Year — auto-updates Current Age */}
              <Fld label="Birth Year" value={inp.birthYear}
                onChange={v => {
                  const age = THIS_YEAR - v;
                  setInp(p => ({ ...p, birthYear: v, currentAge: Math.max(18, Math.min(85, age)) }));
                }}
                pre="" note={`Preservation age: ${preservAge} · Updates age automatically`} />
              {/* Current Age — auto-updates Birth Year */}
              <Sld label="Current Age" value={inp.currentAge} min={18} max={85}
                onChange={v => {
                  const by = THIS_YEAR - v;
                  setInp(p => ({ ...p, currentAge: v, birthYear: by }));
                }}
                color="#a78bfa"
                note={`Birth year: ${inp.birthYear} · Preservation age: ${preservAge}`} />
              <Sld label="Planned Retirement Age" value={inp.retirementAge} min={45} max={75} onChange={set("retirementAge")} color="#a78bfa" />

              {/* ── Plan to Age slider (renamed) ── */}
              <Sld label="Plan to Age" value={inp.lifeExpectancy} min={70} max={100} onChange={set("lifeExpectancy")} color="#a78bfa"
                note={`Projection runs from age ${inp.currentAge} to ${inp.lifeExpectancy} · ${inp.lifeExpectancy - inp.retirementAge} yrs in retirement`} />

              {/* ── Embedded Life Expectancy Calculator ── */}
              <div style={{ border:`1px solid #a78bfa44`, borderRadius:10, overflow:"hidden", marginBottom:12 }}>
                {/* Header / toggle */}
                <button onClick={() => setLeOpen(o => !o)}
                  style={{ width:"100%", display:"flex", justifyContent:"space-between", alignItems:"center",
                    padding:"9px 12px", background:`#a78bfa14`, border:"none", cursor:"pointer", textAlign:"left" }}>
                  <span style={{ fontSize:10, fontWeight:800, color:"#7c3aed", textTransform:"uppercase", letterSpacing:"0.08em" }}>
                    🧬 Calculate Your Life Expectancy
                  </span>
                  <span style={{ fontSize:12, color:"#a78bfa" }}>{leOpen ? "▲" : "▼"}</span>
                </button>

                {leOpen && (
                  <div style={{ padding:"12px 12px 10px", background:"#faf8ff" }}>

                    {/* Gender */}
                    <div style={{ marginBottom:10 }}>
                      <div style={{ fontSize:9, color:C.muted, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:5 }}>Gender</div>
                      <div style={{ display:"flex", gap:6 }}>
                        {["male","female"].map(g => (
                          <button key={g} onClick={() => setLeGender(g)}
                            style={{ flex:1, padding:"6px 0", borderRadius:8, border:`1.5px solid ${leGender===g?"#7c3aed":C.border}`,
                              background: leGender===g ? "#7c3aed18" : C.card,
                              color: leGender===g ? "#7c3aed" : C.muted,
                              fontSize:11, fontWeight: leGender===g ? 800 : 500, cursor:"pointer" }}>
                            {g === "male" ? "♂ Male" : "♀ Female"}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Smoker */}
                    <div style={{ marginBottom:10 }}>
                      <div style={{ fontSize:9, color:C.muted, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:5 }}>Smoker</div>
                      <div style={{ display:"flex", gap:6 }}>
                        {[["No",false],["Yes",true]].map(([label, val]) => (
                          <button key={label} onClick={() => setLeSmoker(val)}
                            style={{ flex:1, padding:"6px 0", borderRadius:8, border:`1.5px solid ${leSmoker===val ? (val ? C.bad : C.ok) : C.border}`,
                              background: leSmoker===val ? (val ? "#dc262614" : "#16a34a14") : C.card,
                              color: leSmoker===val ? (val ? C.bad : C.ok) : C.muted,
                              fontSize:11, fontWeight: leSmoker===val ? 800 : 500, cursor:"pointer" }}>
                            {label}
                          </button>
                        ))}
                      </div>
                      {leSmoker && <div style={{ fontSize:9, color:C.bad, marginTop:3 }}>−10 years (ABS/AIHW estimate)</div>}
                    </div>

                    {/* General Health */}
                    <div style={{ marginBottom:10 }}>
                      <div style={{ fontSize:9, color:C.muted, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:5 }}>General Health</div>
                      <RadioGroup options={["Poor","Fair","Good","Excellent"]} value={leHealth} onChange={setLeHealth} color="#7c3aed" />
                      <div style={{ fontSize:9, color:C.muted, marginTop:3 }}>
                        {leHealth==="Poor"?"−5 yrs":leHealth==="Fair"?"−2 yrs":leHealth==="Good"?"+0 yrs":"+3 yrs"}
                      </div>
                    </div>

                    {/* Exercise */}
                    <div style={{ marginBottom:10 }}>
                      <div style={{ fontSize:9, color:C.muted, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:5 }}>Exercise Level</div>
                      <RadioGroup options={["None","Occasional","Regular","Very Active"]} value={leExercise} onChange={setLeExercise} color="#7c3aed" />
                      <div style={{ fontSize:9, color:C.muted, marginTop:3 }}>
                        {leExercise==="None"?"−3 yrs":leExercise==="Occasional"?"+0 yrs":leExercise==="Regular"?"+2 yrs":"+3 yrs"}
                      </div>
                    </div>

                    {/* BMI */}
                    <div style={{ marginBottom:10 }}>
                      <div style={{ fontSize:9, color:C.muted, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:5 }}>BMI Range</div>
                      <RadioGroup options={["Underweight","Normal","Overweight","Obese"]} value={leBMI} onChange={setLeBMI} color="#7c3aed" />
                      <div style={{ fontSize:9, color:C.muted, marginTop:3 }}>
                        {leBMI==="Normal"?"+0 yrs":leBMI==="Underweight"?"−2 yrs":leBMI==="Overweight"?"−2 yrs":"−5 yrs"}
                      </div>
                    </div>

                    {/* State & SEIFA (from v6) */}
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:12 }}>
                      <div>
                        <div style={{ fontSize:9, color:C.muted, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:4 }}>State / Territory</div>
                        <select value={leState} onChange={e => setLeState(e.target.value)}
                          style={{ width:"100%", padding:"5px 7px", borderRadius:6, border:`1px solid ${C.border}`, background:C.card, color:C.text, fontSize:11, outline:"none" }}>
                          {[["","— National —"],["NSW","NSW"],["VIC","VIC"],["QLD","QLD"],["SA","SA"],["WA","WA"],["TAS","TAS"],["NT","NT"],["ACT","ACT"]].map(([v,l]) =>
                            <option key={v} value={v}>{l}</option>)}
                        </select>
                      </div>
                      <div>
                        <div style={{ fontSize:9, color:C.muted, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:4 }}>SEIFA Quintile</div>
                        <select value={leSeifa} onChange={e => setLeSeifa(e.target.value)}
                          style={{ width:"100%", padding:"5px 7px", borderRadius:6, border:`1px solid ${C.border}`, background:C.card, color:C.text, fontSize:11, outline:"none" }}>
                          {[["","— Avg —"],["1","Q1 Disadv."],["2","Q2"],["3","Q3 Avg"],["4","Q4"],["5","Q5 Adv."]].map(([v,l]) =>
                            <option key={v} value={v}>{l}</option>)}
                        </select>
                      </div>
                    </div>

                    {/* Adjustments summary pill */}
                    {(leSAdj !== 0 || leFAdj !== 0 || leLAdj !== 0) && (
                      <div style={{ background:`#a78bfa11`, border:`1px solid #a78bfa33`, borderRadius:7, padding:"6px 10px", marginBottom:10, fontSize:9, color:C.muted, lineHeight:1.8 }}>
                        <span style={{ color:"#7c3aed", fontWeight:700 }}>Adjustments: </span>
                        {leSmoker && <span style={{ color:C.bad }}> 🚬 −10y</span>}
                        {healthAdj[leHealth]!==0 && <span style={{ color: healthAdj[leHealth]>0 ? C.ok : C.bad }}> ❤️ {healthAdj[leHealth]>0?"+":""}{healthAdj[leHealth]}y</span>}
                        {exerciseAdj[leExercise]!==0 && <span style={{ color: exerciseAdj[leExercise]>0 ? C.ok : C.bad }}> 🏃 {exerciseAdj[leExercise]>0?"+":""}{exerciseAdj[leExercise]}y</span>}
                        {bmiAdj[leBMI]!==0 && <span style={{ color: bmiAdj[leBMI]>0 ? C.ok : C.bad }}> ⚖️ {bmiAdj[leBMI]>0?"+":""}{bmiAdj[leBMI]}y</span>}
                        {leSAdj!==0 && <span style={{ color: leSAdj>0 ? C.ok : C.bad }}> 📍 {leSAdj>0?"+":""}{leSAdj.toFixed(1)}y ({leState})</span>}
                        {leFAdj!==0 && <span style={{ color: leFAdj>0 ? C.ok : C.bad }}> 📊 {leFAdj>0?"+":""}{leFAdj.toFixed(1)}y (SEIFA)</span>}
                      </div>
                    )}

                    {/* Result panel */}
                    <div style={{ background:"#ffffff", border:`2px solid #7c3aed44`, borderRadius:10, padding:"12px 14px" }}>
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:10 }}>
                        <div style={{ textAlign:"center", padding:"8px 4px", background:"#f5f3ff", borderRadius:8 }}>
                          <div style={{ fontSize:9, color:"#7c3aed", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:2 }}>🇦🇺 Australian Average</div>
                          <div style={{ fontSize:22, fontWeight:900, color:"#7c3aed", fontFamily:"monospace" }}>{leAusAvg}</div>
                          <div style={{ fontSize:9, color:C.muted }}>ABS {leGender==="male"?"Male":"Female"} at birth</div>
                        </div>
                        <div style={{ textAlign:"center", padding:"8px 4px", background: leEstimate >= leAusAvg ? "#f0fdf4" : "#fff5f5", borderRadius:8 }}>
                          <div style={{ fontSize:9, color: leEstimate >= leAusAvg ? C.ok : C.bad, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:2 }}>📊 Your Estimate</div>
                          <div style={{ fontSize:22, fontWeight:900, color: leEstimate >= leAusAvg ? C.ok : C.bad, fontFamily:"monospace" }}>{leEstimate}</div>
                          <div style={{ fontSize:9, color:C.muted }}>{leEstimate >= leAusAvg ? "+" : ""}{leEstimate - leAusAvg} yrs vs average</div>
                        </div>
                      </div>
                      {/* Lifetime progress bar */}
                      <div style={{ marginBottom:10 }}>
                        <div style={{ height:6, background:C.border, borderRadius:10, overflow:"hidden" }}>
                          <div style={{ height:"100%", width:`${Math.min(100,(leAge/leEstimate)*100)}%`,
                            background:`linear-gradient(90deg,#7c3aed,${leEstimate>=leAusAvg?C.ok:C.bad})`,
                            borderRadius:10, transition:"width 0.3s ease" }} />
                        </div>
                        <div style={{ fontSize:9, color:C.muted, marginTop:2, textAlign:"center" }}>
                          {Math.round((leAge/leEstimate)*100)}% of estimated lifespan completed · {leEstimate - leAge} yrs remaining
                        </div>
                      </div>
                      {/* Use This Age button */}
                      <button
                        onClick={() => set("lifeExpectancy")(Math.min(100, Math.max(70, leEstimate)))}
                        style={{ width:"100%", padding:"8px 0", borderRadius:8,
                          background:`linear-gradient(135deg,#7c3aed,#a78bfa)`,
                          border:"none", color:"white", fontSize:11, fontWeight:800, cursor:"pointer",
                          letterSpacing:"0.04em" }}>
                        Use This Age → Set Plan to Age to {Math.min(100, Math.max(70, leEstimate))}
                      </button>
                    </div>

                    {/* Source note */}
                    <div style={{ fontSize:8, color:C.muted, marginTop:8, lineHeight:1.6 }}>
                      Source: ABS Life Tables 2022–2024 (age-specific remaining life expectancy) · Lifestyle adjustments: ABS/AIHW research · SEIFA: 7.6yr gap Q1–Q5. Statistical estimates only — not individual predictions.
                    </div>
                  </div>
                )}
              </div>

              {/* Summary row */}
              <div style={{ background: C.bg, borderRadius: 6, padding: 8, fontSize: 10, color: C.muted, marginBottom: 8 }}>
                📅 Born <strong style={{ color: "#a78bfa" }}>{inp.birthYear}</strong> · Age <strong style={{ color: "#a78bfa" }}>{inp.currentAge}</strong> · Retire in <strong style={{ color: "#a78bfa" }}>{Math.max(0, inp.retirementAge - inp.currentAge)} yrs</strong> (age {inp.retirementAge}) · Super access age <strong style={{ color: C.super }}>{preservAge}</strong>
              </div>
              <Tog label="Married / De Facto" value={inp.married} onChange={set("married")} note="Affects Age Pension thresholds" />
              <Tog label="Primary Homeowner" value={inp.homeowner} onChange={set("homeowner")} note="Home excluded from Age Pension assets test" />
            </Card>

            <Card title="Income & Expenses" icon="💼" color={C.main}>
              <Fld label="Annual Gross Salary" value={inp.annualIncome} onChange={set("annualIncome")} note="ATO tax applied automatically" />
              <Fld label="Partner Gross Salary" value={inp.partnerIncome} onChange={set("partnerIncome")} />
              <Fld label="Other Annual Income" value={inp.otherIncome} onChange={set("otherIncome")} note="Dividends, distributions, etc." />
              <Fld label="Current Annual Expenses" value={inp.annualExpenses} onChange={set("annualExpenses")} />
              <Fld label="Retirement Annual Expenses" value={inp.retirementExpenses} onChange={set("retirementExpenses")} note="ASFA Comfortable: $51,630 (single), $72,663 (couple)" />
              <Sld label="Outside-Super Savings Rate" value={(inp.annualSavingsRate||0)*100} min={0} max={40} step={1} onChange={v => set("annualSavingsRate")(v/100)} fmt2={v=>`${v}%`} color={C.main} note="% of net salary saved in shares/ETFs outside super" />
              <div style={{ background: C.bg, borderRadius: 6, padding: 8, fontSize: 10, color: C.muted, marginTop: 6 }}>
                Tax: <strong style={{ color: C.bad }}>{aud(annualTax)}</strong> · Take-home: <strong style={{ color: C.ok }}>{aud(netTakeHome)}</strong> · Eff. rate: <strong style={{ color: C.warn }}>{pct(annualTax/Math.max(1,inp.annualIncome))}</strong>
              </div>
            </Card>

            <Card title="Withdrawal Order" icon="↕️" color={C.outside}>
              <div style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>Which account to draw from first in retirement:</div>
              {(inp.withdrawalOrder || []).map((src, i) => (
                <div key={src} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: C.text }}>{i+1}. {src === "super" ? "🦘 Super / SMSF (0% tax)" : "📈 Outside Super"}</span>
                  <div style={{ display: "flex", gap: 4 }}>
                    {i > 0 && <Btn small onClick={() => { const o=[...inp.withdrawalOrder]; [o[i-1],o[i]]=[o[i],o[i-1]]; set("withdrawalOrder")(o); }} color={C.main}>↑</Btn>}
                    {i < inp.withdrawalOrder.length-1 && <Btn small onClick={() => { const o=[...inp.withdrawalOrder]; [o[i],o[i+1]]=[o[i+1],o[i]]; set("withdrawalOrder")(o); }} color={C.main}>↓</Btn>}
                  </div>
                </div>
              ))}
              <div style={{ fontSize: 10, color: C.muted, marginTop: 6 }}>Tax-optimal: Draw super first (pension phase = 0% tax). Keep outside-super invested longer.</div>
            </Card>
          </div>
          );
        })()}

        {/* ═══ PROPERTIES ═══ */}
        {tab === "properties" && (
          <>
           <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
              <Btn onClick={addProperty} color={C.prop}>+ Add Investment Property</Btn>
              <Btn onClick={addNewBuild} color={C.warn}>+ Add New Build (House & Land)</Btn>
              <div style={{ marginLeft:"auto" }}>
                <a href="https://property-analyser-pro-3mr1.vercel.app" target="_blank" rel="noopener noreferrer"
                  style={{ display:"inline-flex", alignItems:"center", gap:8,
                    background:"linear-gradient(135deg, #0f172a, #1e3a5f)",
                    border:"1.5px solid #2563eb44", borderRadius:10,
                    padding:"8px 16px", textDecoration:"none",
                    color:"white", fontSize:11, fontWeight:800,
                    boxShadow:"0 2px 8px #2563eb22", cursor:"pointer" }}>
                  <span style={{ fontSize:16 }}>🏘️</span>
                  <div>
                    <div style={{ fontSize:11, fontWeight:900, letterSpacing:"0.03em" }}>
                      Property Analyser Pro ↗
                    </div>
                    <div style={{ fontSize:9, color:"#93c5fd", fontWeight:400 }}>
                      IRR · DCF · Stamp Duty · Negative Gearing
                    </div>
                  </div>
                </a>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14 }}>
              {inp.properties.map(p => (
                <Card key={p.id} title={p.label} icon={p.isNewBuild ? "🏗️" : p.isPrimary ? "🏠" : "🏘️"} color={p.isNewBuild ? C.warn : p.isPrimary ? C.muted : C.prop}
                  action={!p.isPrimary && <Btn small onClick={() => setInp(prev => ({ ...prev, properties: prev.properties.filter(x => x.id !== p.id) }))} color={C.bad}>Remove</Btn>}>
                  <Fld label="Label" value={p.label} onChange={v => setNested("properties", p.id, "label", v)} pre="" type="text" />
                  <Fld label="Market Value" value={p.value} onChange={v => setNested("properties", p.id, "value", v)} />
                  <Fld label="Outstanding Mortgage" value={p.mortgage} onChange={v => setNested("properties", p.id, "mortgage", v)} />
                  <Fld label="Loan Years Remaining" value={p.loanYears} onChange={v => setNested("properties", p.id, "loanYears", v)} pre="" suf="yrs" />
                  {!p.isPrimary && <>
                    <Fld label="Weekly Rent" value={p.weeklyRent} onChange={v => setNested("properties", p.id, "weeklyRent", v)} pre="A$" suf="/wk" />
                    <Sld label="Expense Ratio" value={(p.expenseRatio||0.25)*100} min={10} max={50} step={1}
                      onChange={v => setNested("properties", p.id, "expenseRatio", v/100)} fmt2={v=>`${v}%`} color={C.prop}
                      note="PM fees, rates, insurance, repairs. Typical: 20–30%" />
                  </>}
                  {p.isNewBuild && (
                    <div style={{ background: "#fffbeb", border: `1px solid ${C.warn}44`, borderRadius: 8, padding: 10, marginTop: 8 }}>
                      <div style={{ fontSize: 11, color: C.warn, fontWeight: 800, marginBottom: 6 }}>🏗️ New Build Details</div>
                      <Fld label="Total Construction Cost" value={p.constructionCost} onChange={v => setNested("properties", p.id, "constructionCost", v)} />
                      <Sld label="Build Complete Age" value={p.buildCompleteAge||inp.currentAge+2} min={inp.currentAge} max={inp.currentAge+10}
                        onChange={v => setNested("properties", p.id, "buildCompleteAge", v)} fmt2={v=>`Age ${v}`} color={C.warn} />
                      <div style={{ fontSize: 10, color: C.muted, lineHeight: 1.7, marginTop: 6 }}>
                        ✅ No rental during construction · ✅ FHOG may apply<br />
                        ✅ Stamp duty concessions (state-specific)<br />
                        ✅ Depreciation: Div 40 + Div 43 (get QS report)<br />
                        ✅ GST margin scheme may reduce price
                      </div>
                    </div>
                  )}
                  <Tog label="Primary Residence" value={p.isPrimary||false} onChange={v => setNested("properties", p.id, "isPrimary", v)} note="Excluded from Age Pension assets test" />
                  <div style={{ fontSize: 10, color: C.muted, background: C.bg, borderRadius: 6, padding: 6, marginTop: 4 }}>
                    Equity: <strong style={{ color: C.prop }}>{aud(p.value-p.mortgage)}</strong> · Net rent: <strong style={{ color: C.ok }}>{aud((p.weeklyRent||0)*52*(1-(p.expenseRatio||0.25)))}</strong> · Yield: <strong style={{ color: C.warn }}>{pct((p.weeklyRent||0)*52/Math.max(1,p.value))}</strong>
                  </div>
                </Card>
              ))}
            </div>
            <Card title="Property Equity Projection" icon="📈" color={C.prop}>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={proj.filter(cf)}>
                  <defs><linearGradient id="gp" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={C.prop} stopOpacity={0.3}/><stop offset="95%" stopColor={C.prop} stopOpacity={0}/></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="age" stroke={C.muted} tick={{ fontSize: 10 }} />
                  <YAxis stroke={C.muted} tick={{ fontSize: 10 }} tickFormatter={v => `$${(v/1e6).toFixed(2)}M`} />
                  <Tooltip content={<TT />} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Area type="monotone" dataKey="totalPropertyValue" name="Property Value" stroke={C.warn} fill="none" strokeWidth={1.5} strokeDasharray="4 2" dot={false} />
                  <Area type="monotone" dataKey="propertyEquity" name="Property Equity" stroke={C.prop} fill="url(#gp)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </Card>
          </>
        )}

        {/* ═══ SUPER & SMSF ═══ */}
        {tab === "super" && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginBottom: 14 }}>
              <KPI label="Super Balance" value={aud(inp.superBalance)} color={C.super} />
              <KPI label="Employer SG p.a." value={aud(sgAmount)} sub={`${(sgRate*100).toFixed(1)}%`} color={C.super} />
              <KPI label="Total Contribs" value={aud(totalSuperContrib)} sub="Cap: $30,000" color={totalSuperContrib>30000?C.bad:C.ok} />
              <KPI label="Spare Cap" value={aud(concRoom)} sub="Salary sacrifice room" color={C.warn} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <Card title="Super Inputs" icon="🦘" color={C.super}>
                <Fld label="Current Super Balance (All Funds)" value={inp.superBalance} onChange={set("superBalance")} />
                <Fld label="Annual Salary Sacrifice (Concessional)" value={inp.voluntarySuper} onChange={set("voluntarySuper")} note={`Cap: $30,000 incl. SG. Saves ${aud((marginalRate-0.15)*inp.voluntarySuper)} vs salary.`} />
                <Fld label="Annual Non-Concessional" value={inp.extraSuper} onChange={set("extraSuper")} note="Cap: $120,000. After-tax money into super." />
                <Fld label="Outside Super (Shares, ETFs, Cash)" value={inp.outsideSuper} onChange={set("outsideSuper")} />
                <Sld label="Dividend Yield (incl. franking)" value={inp.dividendYield*100} min={1} max={9} step={0.25}
                  onChange={v => set("dividendYield")(v/100)} fmt2={v=>`${v.toFixed(2)}%`} color={C.outside}
                  note="ASX 200 avg ~4-5% gross incl. franking credits" />
              </Card>
              <Card title="SMSF — Self Managed Super Fund" icon="⚙️" color={C.smsf}>
                <Tog label="Use SMSF" value={inp.isSMSF} onChange={set("isSMSF")} note="Direct property, shares, greater control" />
                {inp.isSMSF && (
                  <>
                    <Fld label="Annual SMSF Admin Cost" value={inp.smsfAdminCost} onChange={set("smsfAdminCost")} note="Typical: $3,000–$6,000/yr (audit, accountant, ASIC)" />
                    <div style={{ background: "#eff6ff", border: `1px solid ${C.smsf}44`, borderRadius: 8, padding: 10, fontSize: 10, lineHeight: 1.8, color: C.muted, marginTop: 8 }}>
                      <strong style={{ color: C.smsf }}>SMSF Key Rules (ATO):</strong><br />
                      ✅ Pension phase: <strong style={{ color: C.ok }}>0% tax (tax-free withdrawals)</strong><br />
                      ✅ Accumulation phase earnings: 15% tax<br />
                      ✅ CGT (asset held 12m+): 10% effective rate<br />
                      ✅ Transfer Balance Cap: $1.9M per member<br />
                      ✅ Can hold residential property (LRBA)<br />
                      ✅ Can hold commercial property<br />
                      ⚠️ Min 2 members or corporate trustee<br />
                      ⚠️ Annual ATO audit required<br />
                      ⚠️ In-house asset rule: max 5%<br />
                      ✅ Cost-effective above ~$350k–$500k
                    </div>
                  </>
                )}
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 11, color: C.smsf, fontWeight: 800, marginBottom: 6 }}>ATO Min Drawdown Rates</div>
                  {[[60,"4%"],[65,"5%"],[75,"6%"],[80,"7%"],[85,"9%"],[90,"14%"]].map(([a,r]) => (
                    <div key={a} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: `1px solid ${C.border}`, fontSize: 11 }}>
                      <span style={{ color: C.muted }}>Age {a}+</span>
                      <span style={{ color: inp.currentAge >= a ? C.smsf : C.muted, fontWeight: inp.currentAge >= a ? 800 : 400 }}>{r}</span>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
            <Card title="Super Balance Over Time" icon="📈" color={C.super}>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={proj.filter(cf)}>
                  <defs><linearGradient id="gs" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={C.super} stopOpacity={0.3}/><stop offset="95%" stopColor={C.super} stopOpacity={0}/></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="age" stroke={C.muted} tick={{ fontSize: 10 }} />
                  <YAxis stroke={C.muted} tick={{ fontSize: 10 }} tickFormatter={v => `$${(v/1e6).toFixed(2)}M`} />
                  <Tooltip content={<TT />} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <ReferenceLine x={preservAge} stroke={C.super} strokeDasharray="3 3" label={{ value: `Pres.`, fill: C.super, fontSize: 8 }} />
                  <ReferenceLine x={inp.retirementAge} stroke="#a78bfa" strokeDasharray="4 2" />
                  <Area type="monotone" dataKey="super" name="Super (Accum)" stroke={C.super} fill="url(#gs)" strokeWidth={2} dot={false} />
                  <Area type="monotone" dataKey="superPension" name="Super (Pension 0%tax)" stroke="#60a5fa" fill="none" strokeWidth={2} strokeDasharray="5 2" dot={false} />
                  <Area type="monotone" dataKey="outside" name="Outside Super" stroke={C.outside} fill="none" strokeWidth={1.5} strokeDasharray="2 3" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </Card>

            {/* ── DOWNSIZER CONTRIBUTION ── */}
            <Card title="Downsizer Contribution" icon="🏡" color="#0891b2">
              {inp.currentAge < 55 ? (
                <div style={{ background:"#ecfeff", border:`1px solid #0891b244`, borderRadius:8, padding:"14px 16px", display:"flex", gap:12, alignItems:"center" }}>
                  <span style={{ fontSize:22 }}>🔒</span>
                  <div>
                    <div style={{ fontSize:12, fontWeight:800, color:"#0891b2" }}>Available at age 55+</div>
                    <div style={{ fontSize:11, color:C.muted, marginTop:3 }}>You are {inp.currentAge}. Downsizer contribution eligibility begins at age 55 (ATO — from 1 Jan 2023).</div>
                  </div>
                </div>
              ) : (
                <>
                  <Tog label="Enable Downsizer Contribution" value={inp.downsizeEnabled} onChange={set("downsizeEnabled")}
                    note="Contribute up to $300k (single) / $600k (couple) from home sale proceeds into super, outside normal caps" />

                  {/* Eligibility checklist — always visible at 55+ */}
                  <div style={{ background:"#f0fdfe", border:`1px solid #0891b244`, borderRadius:8, padding:"10px 12px", marginBottom:12 }}>
                    <div style={{ fontSize:10, fontWeight:800, color:"#0891b2", marginBottom:6, textTransform:"uppercase", letterSpacing:"0.07em" }}>Eligibility Checklist</div>
                    {[
                      [inp.currentAge >= 55, `Age 55+ ✓ (you are ${inp.currentAge})`],
                      [inp.homeowner, "Primary homeowner ✓"],
                      [true, "Must have owned home for 10+ continuous years"],
                      [true, "⏱ Contribute within 90 days of settlement"],
                      [true, "Never used downsizer contribution before"],
                      [true, "Property must be in Australia (not a caravan/houseboat)"],
                    ].map(([ok, label], i) => (
                      <div key={i} style={{ fontSize:10, color: ok ? C.ok : C.warn, display:"flex", gap:6, marginBottom:2 }}>
                        <span>{ok ? "✅" : "⚠️"}</span><span style={{ color: ok ? C.text : C.warn }}>{label}</span>
                      </div>
                    ))}
                    {!inp.homeowner && <div style={{ fontSize:10, color:C.bad, marginTop:4 }}>⚠️ Set yourself as a homeowner in Personal tab to use downsizer contribution.</div>}
                  </div>

                  {inp.downsizeEnabled && (
                    <>
                      <Fld label="Sale Price of Home" value={inp.downsizeSalePrice} onChange={set("downsizeSalePrice")}
                        note="Gross sale proceeds before costs" />
                      <Fld label="Downsizer Amount to Contribute" value={inp.downsizeAmount} onChange={v => {
                        const maxAmt = inp.married ? 600000 : 300000;
                        set("downsizeAmount")(Math.min(v, Math.min(inp.downsizeSalePrice, maxAmt)));
                      }} note={`Max: ${aud(inp.married ? 600000 : 300000)} (${inp.married ? "couple" : "single"}) · cannot exceed sale price`} />

                      {/* Impact summary */}
                      <div style={{ background:"#ffffff", border:`2px solid #0891b244`, borderRadius:10, padding:"12px 14px", marginTop:4 }}>
                        <div style={{ fontSize:10, fontWeight:800, color:"#0891b2", marginBottom:8, textTransform:"uppercase", letterSpacing:"0.06em" }}>📊 Impact on Super</div>
                        {(() => {
                          const maxAmt = inp.married ? 600000 : 300000;
                          const validAmt = Math.min(inp.downsizeAmount, Math.min(inp.downsizeSalePrice, maxAmt));
                          const newBal = inp.superBalance + validAmt;
                          const taxSaving = validAmt * 0.15; // non-concessional, no 15% contributions tax
                          return (
                            <>
                              {[
                                ["Current Super Balance", aud(inp.superBalance), C.super],
                                ["Downsizer Amount", aud(validAmt), "#0891b2"],
                                ["New Super Balance", aud(newBal), C.ok],
                                ["Note", "Non-concessional — no 15% tax on entry", C.muted],
                                ["Transfer Balance Cap", "$1,900,000 per member", C.muted],
                                ["Remaining TBC room", aud(Math.max(0, 1900000 - newBal)), newBal > 1900000 ? C.bad : C.ok],
                              ].map(([k,v,c]) => <Row key={k} k={k} v={v} color={c} />)}
                              {newBal > 1900000 && (
                                <div style={{ fontSize:10, color:C.bad, marginTop:6 }}>
                                  ⚠️ Exceeds Transfer Balance Cap. Excess cannot move to pension phase — seek financial advice.
                                </div>
                              )}
                              <div style={{ fontSize:10, color:C.muted, marginTop:6, lineHeight:1.7 }}>
                                💡 Downsizer contributions count towards assessable assets for the Age Pension means test.
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    </>
                  )}
                </>
              )}
            </Card>
          </>
        )}

{/* ═══ SUPER STRATEGY ═══ */}
        {tab === "superstrategy" && (() => {

          const yearsToRetire = Math.max(1, inp.retirementAge - inp.currentAge);
          const concessionalCap = 30000;
          const nonConcessionalCap = 120000;
          const catchUpEnabled = inp.superBalance < 500000;

          // ── Optimiser: run projection at different SS levels ──
          const ssLevels = [0, 5000, 10000, 15000, 20000, 25000,
            Math.max(0, concessionalCap - sgAmount)];
          const uniqueLevels = [...new Set(ssLevels)].sort((a,b)=>a-b);
          const optData = uniqueLevels.map(ss => {
            const p = runProjection({ ...inp, voluntarySuper: ss });
            const retRow = p.find(d => d.age === inp.retirementAge) || {};
            const endRow2 = p[p.length-1] || {};
            const taxSaving = Math.round((marginalRate - 0.15) * ss);
            const netCost   = ss - taxSaving;
            return {
              ss, label:`$${(ss/1000).toFixed(0)}k`,
              superAtRetire: (retRow.super||0)+(retRow.superPension||0),
              netWorthAtRetire: retRow.netWorth||0,
              estateAt90: endRow2.netWorth||0,
              taxSaving, netCost,
            };
          });

          // ── Find optimal SS level (max super at retirement) ──
          const optimal = optData.reduce((a,b) =>
            b.superAtRetire > a.superAtRetire ? b : a);

          // ── Catch-up contributions ──
          const unusedCap = catchUpEnabled
            ? Math.max(0, concessionalCap - totalSuperContrib) * Math.min(5, yearsToRetire)
            : 0;

          // ── Co-contribution ──
          const coContribEligible = inp.annualIncome <= 58445;
          const coContribMax = 500;
          const coContribIncome = Math.min(inp.annualIncome, 58445);
          const coContribAmt = coContribEligible
            ? Math.round(Math.min(coContribMax,
                Math.max(0, (0.5 * Math.min(1000, Math.max(0,
                  coContribIncome - 43445) * 0 + 1000)))))
            : 0;
          const coContribRate = coContribEligible
            ? Math.max(0, 1 - Math.max(0, inp.annualIncome - 43445) / 15000)
            : 0;
          const coContribFinal = Math.round(Math.min(500, coContribRate * 500));

          // ── Spouse contribution ──
          const spouseEligible = inp.married && (inp.partnerIncome || 0) <= 40000;
          const spouseOffset = spouseEligible
            ? Math.min(540, Math.max(0,
                (3000 - Math.max(0, (inp.partnerIncome||0) - 37000)) * 0.18))
            : 0;

          // ── Strategy recommender ──
          const strategies = [];
          if (concRoom > 1000) strategies.push({
            priority: 1, icon:"💰", color: C.super,
            title: "Maximise Salary Sacrifice",
            detail: `You have $${(concRoom/1000).toFixed(1)}k of unused concessional cap. Sacrificing an extra ${aud(concRoom)} saves ${aud(Math.round(marginalRate*concRoom))} in income tax and adds ${aud(Math.round(concRoom*0.85))} to super after 15% contributions tax.`,
            action: `Set salary sacrifice to ${aud(Math.max(0, concessionalCap - sgAmount))}/yr`,
            impact: aud(Math.round((marginalRate - 0.15) * concRoom)) + " tax saving/yr",
          });
          if (catchUpEnabled && yearsToRetire >= 2) strategies.push({
            priority: 2, icon:"⏪", color: "#0891b2",
            title: "Use Catch-Up Contributions",
            detail: `Your super balance is under $500k — you can carry forward unused concessional caps from the past 5 years. Potential extra: up to ${aud(unusedCap)} in catch-up contributions.`,
            action: "Check myGov / ATO online for your carry-forward balance",
            impact: `Up to ${aud(unusedCap)} extra concessional`,
          });
          if (coContribEligible && coContribFinal > 0) strategies.push({
            priority: 3, icon:"🤝", color: C.ok,
            title: "Government Co-Contribution",
            detail: `Your income (${aud(inp.annualIncome)}) qualifies for the government co-contribution. For every $1 of after-tax super contribution (up to $1,000), the government adds up to ${aud(coContribFinal)}.`,
            action: `Contribute $1,000 after-tax to super → get ${aud(coContribFinal)} free from government`,
            impact: `${aud(coContribFinal)} free government money`,
          });
          if (spouseEligible && spouseOffset > 0) strategies.push({
            priority: 4, icon:"👫", color: C.prop,
            title: "Spouse Contribution Tax Offset",
            detail: `Your partner earns ${aud(inp.partnerIncome||0)} — below the $40,000 threshold. Contributing to their super earns you an 18% tax offset, up to ${aud(Math.round(spouseOffset))}.`,
            action: `Contribute $3,000 to spouse super → ${aud(Math.round(spouseOffset))} tax offset`,
            impact: `${aud(Math.round(spouseOffset))} tax offset`,
          });
          if (inp.superBalance < 200000 && yearsToRetire > 10) strategies.push({
            priority: 5, icon:"📈", color: C.warn,
            title: "Review Investment Option",
            detail: `With ${yearsToRetire} years to retirement and a balance of ${aud(inp.superBalance)}, consider a higher-growth investment option. Moving from balanced (7%) to growth (9%) could add significantly to your balance.`,
            action: "Log in to your super fund and review investment options",
            impact: `+${aud(Math.round(inp.superBalance * (0.09-0.07) * yearsToRetire))} est. extra`,
          });
          if (inp.currentAge >= 55 && inp.homeowner) strategies.push({
            priority: 6, icon:"🏡", color: "#0891b2",
            title: "Downsizer Contribution",
            detail: `Aged 55+? If you sell your home, you can contribute up to ${aud(inp.married?600000:300000)} into super outside the normal caps. This is one of the fastest ways to boost super late in life.`,
            action: "Enable Downsizer in the Super & SMSF tab",
            impact: `Up to ${aud(inp.married?600000:300000)} outside normal caps`,
          });
          if (inp.annualIncome > 250000) strategies.push({
            priority: 7, icon:"⚠️", color: C.bad,
            title: "Division 293 Tax Alert",
            detail: `Your income exceeds $250,000 — Division 293 applies an extra 15% tax on concessional contributions, making your effective super tax rate 30% instead of 15%.`,
            action: "Consider non-concessional contributions instead or review with your accountant",
            impact: `Extra ${aud(Math.round(totalSuperContrib * 0.15))} Div 293 tax`,
          });

          return (
            <>
              {/* ── KPI row ── */}
              <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:8, marginBottom:14 }}>
                <KPI label="Current Super"        value={aud(inp.superBalance)}      color={C.super} />
                <KPI label="SG Contributions"     value={aud(sgAmount)}              color={C.super} sub={`${(sgRate*100).toFixed(1)}% of salary`} />
                <KPI label="Salary Sacrifice"     value={aud(inp.voluntarySuper)}    color={C.ok} sub="Concessional" />
                <KPI label="Concessional Room"    value={aud(concRoom)}              color={concRoom>0?C.warn:C.ok} sub="Unused cap this yr" />
                <KPI label="Super at Retirement"  value={aud((retireRow.super||0)+(retireRow.superPension||0))} color={C.super} sub={`Age ${inp.retirementAge}`} />
              </div>

              {/* ── Strategy Recommender ── */}
              <Card title="🎯 Personalised Strategy Recommendations" icon="" color={C.main}>
                <div style={{ fontSize:11, color:C.muted, marginBottom:12 }}>
                  Based on your age ({inp.currentAge}), income ({aud(inp.annualIncome)}),
                  super balance ({aud(inp.superBalance)}) and {yearsToRetire} years to retirement.
                  Ranked by impact.
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                  {strategies.map((s,i) => (
                    <div key={i} style={{ background:"white", border:`1.5px solid ${s.color}33`,
                      borderLeft:`4px solid ${s.color}`, borderRadius:10, padding:"10px 14px",
                      display:"grid", gridTemplateColumns:"auto 1fr auto", gap:12, alignItems:"start" }}>
                      <div style={{ fontSize:22, lineHeight:1 }}>{s.icon}</div>
                      <div>
                        <div style={{ fontSize:12, fontWeight:900, color:s.color, marginBottom:3 }}>
                          #{s.priority} {s.title}
                        </div>
                        <div style={{ fontSize:10, color:C.muted, lineHeight:1.7, marginBottom:4 }}>
                          {s.detail}
                        </div>
                        <div style={{ fontSize:10, color:C.text, fontWeight:700 }}>
                          ✅ Action: {s.action}
                        </div>
                      </div>
                      <div style={{ background:`${s.color}15`, border:`1px solid ${s.color}33`,
                        borderRadius:8, padding:"6px 10px", textAlign:"center", minWidth:100 }}>
                        <div style={{ fontSize:9, color:C.muted, marginBottom:2 }}>IMPACT</div>
                        <div style={{ fontSize:11, fontWeight:900, color:s.color }}>{s.impact}</div>
                      </div>
                    </div>
                  ))}
                  {strategies.length === 0 && (
                    <div style={{ textAlign:"center", padding:20, color:C.ok, fontWeight:800 }}>
                      ✅ Your super strategy looks optimised!
                    </div>
                  )}
                </div>
              </Card>

              {/* ── Salary Sacrifice Optimiser ── */}
              <Card title="Salary Sacrifice Optimiser" icon="💰" color={C.super}>
                <div style={{ fontSize:11, color:C.muted, marginBottom:12 }}>
                  Compares super balance and estate outcome at different salary sacrifice levels.
                  Optimal level highlighted in blue.
                </div>
                <ResponsiveContainer width="100%" height={220}>
                  <ComposedChart data={optData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                    <XAxis dataKey="label" stroke={C.muted} tick={{fontSize:10}} />
                    <YAxis yAxisId="left" stroke={C.super} tick={{fontSize:10}}
                      tickFormatter={v=>`$${(v/1e6).toFixed(1)}M`} />
                    <YAxis yAxisId="right" orientation="right" stroke={C.ok}
                      tick={{fontSize:10}} tickFormatter={v=>`$${(v/1000).toFixed(0)}k`} />
                    <Tooltip content={<TT />} />
                    <Legend wrapperStyle={{fontSize:10}} />
                    <Bar yAxisId="left" dataKey="superAtRetire" name="Super at Retirement"
                      radius={[4,4,0,0]}>
                      {optData.map((d,i) => (
                        <Cell key={i} fill={d.ss===optimal.ss ? C.super : `${C.super}66`} />
                      ))}
                    </Bar>
                    <Line yAxisId="right" type="monotone" dataKey="taxSaving"
                      name="Annual Tax Saving" stroke={C.ok} strokeWidth={2} dot={true} />
                  </ComposedChart>
                </ResponsiveContainer>

                {/* Optimiser table */}
                <div style={{ overflowX:"auto", marginTop:12 }}>
                  <table style={{ width:"100%", borderCollapse:"collapse", fontSize:10 }}>
                    <thead>
                      <tr style={{ background:"#f8fafc" }}>
                        {["Salary Sacrifice","Super at Retire","Net Worth at Retire",
                          "Estate at 90","Annual Tax Saving","Net Cost to You"].map(h=>(
                          <th key={h} style={{ padding:"5px 10px", textAlign:"right",
                            color:C.muted, fontWeight:700, fontSize:9, textTransform:"uppercase",
                            borderBottom:`2px solid ${C.border}` }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {optData.map((d,i) => (
                        <tr key={i} style={{
                          borderBottom:`1px solid ${C.border}22`,
                          background: d.ss===optimal.ss ? "#eff6ff" : "transparent",
                          fontWeight: d.ss===optimal.ss ? 800 : 400 }}>
                          <td style={{ padding:"5px 10px", textAlign:"right",
                            color: d.ss===optimal.ss ? C.super : C.text }}>
                            {aud(d.ss)}{d.ss===optimal.ss?" ⭐":""}
                          </td>
                          <td style={{ padding:"5px 10px", textAlign:"right", color:C.super }}>{aud(d.superAtRetire)}</td>
                          <td style={{ padding:"5px 10px", textAlign:"right", color:C.main }}>{aud(d.netWorthAtRetire)}</td>
                          <td style={{ padding:"5px 10px", textAlign:"right", color:C.text }}>{aud(d.estateAt90)}</td>
                          <td style={{ padding:"5px 10px", textAlign:"right", color:C.ok }}>{aud(d.taxSaving)}</td>
                          <td style={{ padding:"5px 10px", textAlign:"right", color:C.warn }}>{aud(d.netCost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ fontSize:10, color:C.muted, marginTop:8 }}>
                  ⭐ Optimal = highest super at retirement · Net cost = sacrifice minus tax saving
                </div>
              </Card>

              {/* ── Catch-up + Co-contribution + Spouse ── */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:14 }}>

                {/* Catch-up */}
                <Card title="Catch-Up Contributions" icon="⏪" color="#0891b2">
                  <div style={{ fontSize:10, color:C.muted, marginBottom:8, lineHeight:1.7 }}>
                    If your super balance is under $500k you can carry forward unused
                    concessional caps from the previous 5 years.
                  </div>
                  {[
                    ["Balance under $500k", catchUpEnabled ? "✅ Eligible" : "❌ Over $500k"],
                    ["Current Concessional Cap", aud(concessionalCap)],
                    ["Your SG + Sacrifice", aud(totalSuperContrib)],
                    ["Unused Cap This Year", aud(concRoom)],
                    ["Est. 5yr Carry-Forward", aud(unusedCap)],
                  ].map(([k,v])=><Row key={k} k={k} v={v} />)}
                  <div style={{ marginTop:8, background:"#ecfeff", border:"1px solid #0891b244",
                    borderRadius:8, padding:"8px 10px", fontSize:10, color:"#0891b2", fontWeight:700 }}>
                    💡 Check your exact carry-forward balance in myGov → ATO → Super
                  </div>
                </Card>

                {/* Co-contribution */}
                <Card title="Government Co-Contribution" icon="🤝" color={C.ok}>
                  <div style={{ fontSize:10, color:C.muted, marginBottom:8, lineHeight:1.7 }}>
                    For low-to-middle income earners who make after-tax super contributions.
                    Government matches up to 50¢ per $1, max $500.
                  </div>
                  {[
                    ["Your Income", aud(inp.annualIncome)],
                    ["Lower Threshold", aud(43445)],
                    ["Upper Threshold", aud(58445)],
                    ["Eligible", coContribEligible ? "✅ Yes" : "❌ Income too high"],
                    ["Co-contrib Rate", `${(coContribRate*100).toFixed(0)}¢ per $1`],
                    ["Max Govt Contribution", aud(coContribFinal)],
                    ["Action Required", "Contribute $1,000 after-tax to super"],
                  ].map(([k,v])=><Row key={k} k={k} v={v} />)}
                  {!coContribEligible && (
                    <div style={{ marginTop:8, background:"#fef2f2", border:"1px solid #dc262633",
                      borderRadius:8, padding:"8px 10px", fontSize:10, color:C.bad }}>
                      ❌ Income ${aud(inp.annualIncome)} exceeds $58,445 threshold
                    </div>
                  )}
                </Card>

                {/* Spouse contribution */}
                <Card title="Spouse Contribution Offset" icon="👫" color={C.prop}>
                  <div style={{ fontSize:10, color:C.muted, marginBottom:8, lineHeight:1.7 }}>
                    Contribute to your spouse's super and receive an 18% tax offset
                    (up to $540) if their income is under $40,000.
                  </div>
                  {[
                    ["Married / De Facto", inp.married ? "✅ Yes" : "❌ Not set"],
                    ["Partner Income", aud(inp.partnerIncome||0)],
                    ["Income Threshold", aud(40000)],
                    ["Eligible", spouseEligible ? "✅ Yes" : "❌ Not eligible"],
                    ["Contribution for Max Offset", aud(3000)],
                    ["Tax Offset (18%)", aud(Math.round(spouseOffset))],
                  ].map(([k,v])=><Row key={k} k={k} v={v} />)}
                  {!inp.married && (
                    <div style={{ marginTop:8, background:"#fffbeb", border:"1px solid #f59e0b44",
                      borderRadius:8, padding:"8px 10px", fontSize:10, color:C.warn }}>
                      ⚠️ Enable Married/De Facto in Personal tab to check eligibility
                    </div>
                  )}
                </Card>
              </div>

              {/* ── Non-concessional + TBC ── */}
              <Card title="Non-Concessional Contributions & Transfer Balance Cap" icon="🏦" color={C.pension}>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
                  <div>
                    <div style={{ fontSize:11, fontWeight:800, color:C.pension, marginBottom:8 }}>
                      Non-Concessional (After-Tax)
                    </div>
                    {[
                      ["Annual NCC Cap",          aud(nonConcessionalCap)],
                      ["3-Year Bring-Forward",     aud(nonConcessionalCap*3)],
                      ["Your Current NCC",         aud(inp.extraSuper||0)],
                      ["Remaining NCC Room",       aud(Math.max(0,nonConcessionalCap-(inp.extraSuper||0)))],
                      ["Tax on Entry",             "0% (after-tax money)"],
                      ["Earnings Tax in Super",    "15% accumulation / 0% pension"],
                    ].map(([k,v])=><Row key={k} k={k} v={v} />)}
                  </div>
                  <div>
                    <div style={{ fontSize:11, fontWeight:800, color:C.pension, marginBottom:8 }}>
                      Transfer Balance Cap (TBC)
                    </div>
                    {[
                      ["TBC Limit",               aud(1900000)],
                      ["Your Super Balance",       aud(inp.superBalance)],
                      ["TBC Used (inp)",           aud(inp.tbcUsed||0)],
                      ["TBC Remaining",            aud(Math.max(0,1900000-(inp.tbcUsed||0)))],
                      ["Super at Retirement",      aud((retireRow.super||0)+(retireRow.superPension||0))],
                      ["TBC Status at Retire",     (retireRow.super||0)+(retireRow.superPension||0) > 1900000 ? "⚠️ May exceed cap" : "✅ Within cap"],
                    ].map(([k,v])=><Row key={k} k={k} v={v} />)}
                  </div>
                </div>
                <div style={{ marginTop:10, background:`${C.pension}10`, border:`1px solid ${C.pension}33`,
                  borderRadius:8, padding:"8px 12px", fontSize:10, color:C.muted, lineHeight:1.8 }}>
                  💡 Once in pension phase, earnings are <strong>0% tax</strong>.
                  Amounts above the TBC must stay in accumulation (15% tax on earnings).
                  Non-concessional contributions don't count toward the $30k concessional cap.
                </div>
              </Card>

              {/* ── Disclaimer ── */}
              <div style={{ fontSize:9, color:C.muted, lineHeight:1.8, background:C.bg,
                borderRadius:8, padding:"8px 12px" }}>
                📋 Contribution caps: Concessional $30,000 · Non-Concessional $120,000 (FY2025-26) ·
                Catch-up available if balance {"<"} $500k · Co-contribution thresholds $43,445–$58,445 ·
                Spouse offset threshold $37,000–$40,000 · TBC $1,900,000 · General information only (ASIC RG 244)
              </div>
            </>
          );
        })()}
          {/* ═══ ANNUITY MODELLER ═══ */}
        {tab === "annuity" && (() => {

          // ── Core calculations ──
          const yrsToStart   = Math.max(0, annuity.startAge - inp.currentAge);
          const lifeExp      = inp.lifeExpectancy || 87;
          const lifetimeYrs  = Math.max(1, lifeExp - annuity.startAge);
          const termYrs      = annuity.type === "term" ? annuity.termYears : lifetimeYrs;

          // Annual income from annuity
          const annualIncome = annuity.purchaseAmount * annuity.rate;

          // Indexed: income grows at CPI each year
          const getIncome = yr =>
            annuity.indexed
              ? annualIncome * Math.pow(1 + annuity.indexRate, yr)
              : annualIncome;

          // Total payments received over term
          const totalPayments = Array.from({length: termYrs}, (_,i) => getIncome(i))
            .reduce((s,v) => s+v, 0);

          // ABP comparison — same amount invested, drawing at same rate, 7% growth
          const abpGrowthRate = inp.returnRate || 0.07;
          let abpBal = annuity.purchaseAmount;
          const abpData = [];
          for (let yr = 0; yr <= termYrs; yr++) {
            const age = annuity.startAge + yr;
            const income = getIncome(yr);
            abpData.push({
              age, yr,
              annuityIncome: yr < termYrs ? Math.round(getIncome(yr)) : 0,
              annuityBalance: annuity.type === "lifetime" ? 0 : Math.round(Math.max(0, annuity.purchaseAmount - income * yr)),
              abpBalance: Math.round(Math.max(0, abpBal)),
              abpIncome: Math.round(income), // same drawdown for fair comparison
              cumulativeAnnuity: Math.round(Array.from({length:yr},(_,i)=>getIncome(i)).reduce((s,v)=>s+v,0)),
              cumulativeABP: Math.round(income * yr),
            });
            abpBal = (abpBal - income) * (1 + abpGrowthRate);
          }

          // Break-even age — when cumulative annuity payments exceed purchase price
          const breakEvenYr = abpData.findIndex(d => d.cumulativeAnnuity >= annuity.purchaseAmount);
          const breakEvenAge = breakEvenYr >= 0 ? annuity.startAge + breakEvenYr : null;

          // ABP runs out age
          const abpRunsOutIdx = abpData.findIndex(d => d.abpBalance <= 0);
          const abpRunsOutAge = abpRunsOutIdx >= 0 ? annuity.startAge + abpRunsOutIdx : null;

          // Centrelink treatment
          // Lifetime annuity: asset value = purchase price * (remaining life / original life) — deferred annuity schedule
          const deductibleAmount = annuity.purchaseAmount / Math.max(1, lifetimeYrs);
          const assessableAnnuityAsset = Math.max(0, annuity.purchaseAmount - deductibleAmount * yrsToStart);
          // Income test: actual payments counted as income
          const annuityIncomeTest = annualIncome;

          // Fixed vs indexed comparison data
          const fixedIncome  = annuity.purchaseAmount * annuity.rate;
          const compData = Array.from({length: Math.min(termYrs, 30)}, (_,i) => ({
            age: annuity.startAge + i,
            fixedIncome:   Math.round(fixedIncome),
            indexedIncome: Math.round(fixedIncome * Math.pow(1 + annuity.indexRate, i)),
            inflationCost: Math.round(fixedIncome * Math.pow(1 + annuity.indexRate, i) - fixedIncome),
          }));

          return (
            <>
              {/* ── KPI row ── */}
              <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:8, marginBottom:14 }}>
                <KPI label="Purchase Amount"    value={aud(annuity.purchaseAmount)} color={C.main} />
                <KPI label="Annual Income"      value={aud(annualIncome)}           color={C.ok} sub={`${(annuity.rate*100).toFixed(2)}% payout rate`} />
                <KPI label="Fortnightly"        value={aud(annualIncome/26)}        color={C.ok} />
                <KPI label="Break-Even Age"     value={breakEvenAge ? `Age ${breakEvenAge}` : "N/A"} color={C.warn} sub="When payments = purchase price" />
                <KPI label="Total Payments"     value={aud(totalPayments)}          color={C.super} sub={`Over ${termYrs} years`} />
              </div>

              {/* ── Inputs ── */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
                <Card title="Annuity Inputs" icon="⚙️" color={C.main}>
                  <Fld label="Purchase Amount" value={annuity.purchaseAmount} onChange={setAnn("purchaseAmount")} note="Amount used to buy the annuity (from super or savings)" />
                  <Sld label="Start Age" value={annuity.startAge} min={55} max={85} step={1}
                    onChange={setAnn("startAge")} fmt2={v=>`Age ${v}`} color={C.main} />
                  <Sld label="Payout Rate" value={annuity.rate*100} min={3} max={9} step={0.1}
                    onChange={v=>setAnn("rate")(v/100)} fmt2={v=>`${v.toFixed(1)}%`} color={C.ok}
                    note="Typical lifetime annuity: 5–6.5%. Term: 4–7%." />
                  <div style={{ marginBottom:10 }}>
                    <div style={{ fontSize:10, color:C.muted, fontWeight:700, marginBottom:6 }}>Annuity Type</div>
                    <div style={{ display:"flex", gap:0, border:`1px solid ${C.border}`, borderRadius:8, overflow:"hidden", width:"fit-content" }}>
                      {[["lifetime","♾️ Lifetime"],["term","📅 Term"]].map(([v,l])=>(
                        <button key={v} onClick={()=>setAnn("type")(v)}
                          style={{ padding:"6px 18px", background:annuity.type===v?C.main:C.card,
                            color:annuity.type===v?"white":C.muted,
                            border:"none", fontSize:11, fontWeight:800, cursor:"pointer" }}>{l}</button>
                      ))}
                    </div>
                  </div>
                  {annuity.type === "term" && (
                    <Sld label="Term (years)" value={annuity.termYears} min={5} max={30} step={1}
                      onChange={setAnn("termYears")} fmt2={v=>`${v} years`} color={C.super} />
                  )}
                  <div style={{ marginBottom:10 }}>
                    <div style={{ fontSize:10, color:C.muted, fontWeight:700, marginBottom:6 }}>Inflation Indexing</div>
                    <div style={{ display:"flex", gap:0, border:`1px solid ${C.border}`, borderRadius:8, overflow:"hidden", width:"fit-content" }}>
                      {[["false","Fixed"],["true","CPI Indexed"]].map(([v,l])=>(
                        <button key={v} onClick={()=>setAnn("indexed")(v==="true")}
                          style={{ padding:"6px 18px",
                            background:(annuity.indexed?"true":"false")===v?C.main:C.card,
                            color:(annuity.indexed?"true":"false")===v?"white":C.muted,
                            border:"none", fontSize:11, fontWeight:800, cursor:"pointer" }}>{l}</button>
                      ))}
                    </div>
                  </div>
                  {annuity.indexed && (
                    <Sld label="Index Rate (CPI)" value={annuity.indexRate*100} min={1} max={5} step={0.25}
                      onChange={v=>setAnn("indexRate")(v/100)} fmt2={v=>`${v.toFixed(2)}%`} color={C.warn} />
                  )}
                  <div style={{ marginBottom:10 }}>
                    <div style={{ fontSize:10, color:C.muted, fontWeight:700, marginBottom:6 }}>Gender (affects pricing)</div>
                    <div style={{ display:"flex", gap:0, border:`1px solid ${C.border}`, borderRadius:8, overflow:"hidden", width:"fit-content" }}>
                      {[["male","👨 Male"],["female","👩 Female"]].map(([v,l])=>(
                        <button key={v} onClick={()=>setAnn("gender")(v)}
                          style={{ padding:"6px 18px", background:annuity.gender===v?C.main:C.card,
                            color:annuity.gender===v?"white":C.muted,
                            border:"none", fontSize:11, fontWeight:800, cursor:"pointer" }}>{l}</button>
                      ))}
                    </div>
                  </div>
                  <Tog label="Reversionary (partner continues after death)"
                    value={annuity.reversionary} onChange={setAnn("reversionary")}
                    note="Partner receives a % of income after you die. Reduces initial income." />
                  {annuity.reversionary && (
                    <Sld label="Partner Reversion %" value={annuity.reversionaryPct*100}
                      min={33} max={100} step={1}
                      onChange={v=>setAnn("reversionaryPct")(v/100)}
                      fmt2={v=>`${v.toFixed(0)}%`} color={C.prop}
                      note="Typically 60% or 100% of original income" />
                  )}
                </Card>

                {/* Summary card */}
                <Card title="Annuity Summary" icon="📊" color={C.ok}>
                  {[
                    ["Type",                annuity.type==="lifetime"?"Lifetime (income for life)":"Term Annuity"],
                    ["Purchase Amount",     aud(annuity.purchaseAmount)],
                    ["Start Age",           `Age ${annuity.startAge}`],
                    ["Payout Rate",         `${(annuity.rate*100).toFixed(2)}% p.a.`],
                    ["Annual Income",       aud(annualIncome)],
                    ["Monthly Income",      aud(annualIncome/12)],
                    ["Fortnightly Income",  aud(annualIncome/26)],
                    ["Indexing",            annuity.indexed?`CPI ${(annuity.indexRate*100).toFixed(2)}%`:"Fixed (no indexing)"],
                    ["Term",                annuity.type==="term"?`${annuity.termYears} years`:`${lifetimeYrs} years (to age ${lifeExp})`],
                    ["Total Payments",      aud(totalPayments)],
                    ["Capital Returned",    annuity.type==="lifetime"?"$0 (capital consumed)":aud(0)],
                    ["Break-Even Age",      breakEvenAge?`Age ${breakEvenAge}`:"Beyond life expectancy"],
                    ["Reversionary",        annuity.reversionary?`Yes — ${(annuity.reversionaryPct*100).toFixed(0)}% to partner`:"No"],
                    ["Gender",              annuity.gender==="male"?"Male":"Female"],
                  ].map(([k,v])=><Row key={k} k={k} v={v} />)}

                  {/* Pros/cons */}
                  <div style={{ marginTop:10, display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                    <div style={{ background:"#f0fdf4", border:`1px solid ${C.ok}33`,
                      borderRadius:8, padding:"8px 10px" }}>
                      <div style={{ fontSize:10, fontWeight:800, color:C.ok, marginBottom:4 }}>✅ Pros</div>
                      {["Guaranteed income for life","No investment risk","Centrelink-friendly treatment",
                        "Simplifies retirement income","Peace of mind"].map(p=>(
                        <div key={p} style={{ fontSize:9, color:C.muted, marginBottom:2 }}>• {p}</div>
                      ))}
                    </div>
                    <div style={{ background:"#fff7ed", border:`1px solid ${C.warn}33`,
                      borderRadius:8, padding:"8px 10px" }}>
                      <div style={{ fontSize:10, fontWeight:800, color:C.warn, marginBottom:4 }}>⚠️ Cons</div>
                      {["Capital lost at death","Locked in — no flexibility","Inflation erodes fixed income",
                        "Low returns vs growth assets","No estate value"].map(p=>(
                        <div key={p} style={{ fontSize:9, color:C.muted, marginBottom:2 }}>• {p}</div>
                      ))}
                    </div>
                  </div>
                </Card>
              </div>

              {/* ── Annuity vs ABP comparison chart ── */}
              <Card title="Annuity vs Account-Based Pension (ABP) — Balance Over Time" icon="📈" color={C.super}>
                <div style={{ fontSize:11, color:C.muted, marginBottom:8 }}>
                  Same {aud(annuity.purchaseAmount)} — annuity pays fixed income, ABP invested at {((inp.returnRate||0.07)*100).toFixed(1)}% with same drawdown.
                  ABP retains capital but may run out. Annuity guaranteed for life.
                </div>
                <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart data={abpData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                    <XAxis dataKey="age" stroke={C.muted} tick={{fontSize:10}} label={{value:"Age",position:"insideBottom",offset:-2,fontSize:10}} />
                    <YAxis stroke={C.muted} tick={{fontSize:10}} tickFormatter={v=>`$${(v/1000).toFixed(0)}k`} />
                    <Tooltip content={<TT />} />
                    <Legend wrapperStyle={{fontSize:10}} />
                    {breakEvenAge && <ReferenceLine x={breakEvenAge} stroke={C.warn}
                      strokeDasharray="4 2" label={{value:"Break-even",fill:C.warn,fontSize:9}} />}
                    {abpRunsOutAge && <ReferenceLine x={abpRunsOutAge} stroke={C.bad}
                      strokeDasharray="4 2" label={{value:"ABP runs out",fill:C.bad,fontSize:9}} />}
                    <Area type="monotone" dataKey="abpBalance" name="ABP Balance"
                      stroke={C.super} fill={`${C.super}22`} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="cumulativeAnnuity" name="Cumulative Annuity Payments"
                      stroke={C.ok} strokeWidth={2.5} dot={false} strokeDasharray="5 2" />
                    <ReferenceLine y={annuity.purchaseAmount} stroke={C.main}
                      strokeDasharray="3 3" label={{value:"Purchase Price",fill:C.main,fontSize:9,position:"right"}} />
                  </ComposedChart>
                </ResponsiveContainer>
              </Card>

              {/* ── Income comparison chart ── */}
              <Card title="Annual Income — Annuity vs ABP Drawdown" icon="💰" color={C.ok}>
                <ResponsiveContainer width="100%" height={220}>
                  <ComposedChart data={abpData.filter((_,i)=>i%2===0)}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                    <XAxis dataKey="age" stroke={C.muted} tick={{fontSize:10}} />
                    <YAxis stroke={C.muted} tick={{fontSize:10}} tickFormatter={v=>`$${(v/1000).toFixed(0)}k`} />
                    <Tooltip content={<TT />} />
                    <Legend wrapperStyle={{fontSize:10}} />
                    <Bar dataKey="annuityIncome" name="Annuity Income" fill={C.ok} radius={[3,3,0,0]} />
                    <Line type="monotone" dataKey="abpIncome" name="ABP Drawdown"
                      stroke={C.super} strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </Card>

              {/* ── Fixed vs Indexed comparison ── */}
              <Card title="Fixed vs CPI-Indexed Income Comparison" icon="📊" color={C.warn}>
                <div style={{ fontSize:11, color:C.muted, marginBottom:8 }}>
                  Fixed income loses purchasing power over time. Indexed income keeps pace with inflation
                  but starts lower (lower payout rate from provider).
                </div>
                <ResponsiveContainer width="100%" height={220}>
                  <ComposedChart data={compData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                    <XAxis dataKey="age" stroke={C.muted} tick={{fontSize:10}} />
                    <YAxis stroke={C.muted} tick={{fontSize:10}} tickFormatter={v=>`$${(v/1000).toFixed(0)}k`} />
                    <Tooltip content={<TT />} />
                    <Legend wrapperStyle={{fontSize:10}} />
                    <Line type="monotone" dataKey="fixedIncome" name="Fixed Income"
                      stroke={C.bad} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="indexedIncome" name="CPI-Indexed Income"
                      stroke={C.ok} strokeWidth={2} dot={false} />
                    <Area type="monotone" dataKey="inflationCost" name="Indexing Benefit"
                      stroke={C.warn} fill={`${C.warn}22`} strokeWidth={1} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, marginTop:10 }}>
                  {[
                    ["Fixed Income (yr 1)",   aud(fixedIncome),                                    C.bad ],
                    ["Indexed Income (yr 10)", aud(fixedIncome*Math.pow(1+annuity.indexRate,10)),   C.ok  ],
                    ["Indexed Income (yr 20)", aud(fixedIncome*Math.pow(1+annuity.indexRate,20)),   C.ok  ],
                  ].map(([k,v,c])=>(
                    <div key={k} style={{ background:"white", border:`1px solid ${c}33`,
                      borderRadius:8, padding:"8px 10px", textAlign:"center" }}>
                      <div style={{ fontSize:9, color:C.muted, marginBottom:3 }}>{k}</div>
                      <div style={{ fontSize:14, fontWeight:900, color:c }}>{v}</div>
                    </div>
                  ))}
                </div>
              </Card>

              {/* ── Break-even table ── */}
              <Card title="Break-Even Analysis" icon="⚖️" color={C.main}>
                <div style={{ fontSize:11, color:C.muted, marginBottom:10 }}>
                  At what age do total annuity payments equal the original purchase price?
                  Living beyond break-even age means the annuity was financially beneficial.
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, marginBottom:12 }}>
                  {[
                    ["Purchase Price",    aud(annuity.purchaseAmount),                    C.main ],
                    ["Annual Income",     aud(annualIncome),                              C.ok   ],
                    ["Break-Even Years",  breakEvenAge?`${breakEvenAge-annuity.startAge} years`:"N/A", C.warn],
                    ["Break-Even Age",    breakEvenAge?`Age ${breakEvenAge}`:"N/A",       breakEvenAge&&breakEvenAge<=lifeExp?C.ok:C.bad],
                  ].map(([k,v,c])=>(
                    <div key={k} style={{ background:"white", border:`1px solid ${c}33`,
                      borderRadius:8, padding:"8px 10px", textAlign:"center" }}>
                      <div style={{ fontSize:9, color:C.muted, marginBottom:3 }}>{k}</div>
                      <div style={{ fontSize:14, fontWeight:900, color:c }}>{v}</div>
                    </div>
                  ))}
                </div>
                <div style={{ overflowX:"auto" }}>
                  <table style={{ width:"100%", borderCollapse:"collapse", fontSize:10 }}>
                    <thead>
                      <tr style={{ background:"#f8fafc" }}>
                        {["Age","Year","Annual Income","Cumulative Payments","vs Purchase Price","ABP Balance"].map(h=>(
                          <th key={h} style={{ padding:"5px 10px", textAlign:"right",
                            color:C.muted, fontWeight:700, fontSize:9, textTransform:"uppercase",
                            borderBottom:`2px solid ${C.border}` }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {abpData.filter((_,i)=>i%3===0).map((d,i)=>{
                        const isBreakEven = d.age === breakEvenAge;
                        return (
                          <tr key={i} style={{ borderBottom:`1px solid ${C.border}22`,
                            background: isBreakEven?"#f0fdf4":d.age===inp.currentAge?`${C.main}08`:"transparent",
                            fontWeight: isBreakEven?800:400 }}>
                            <td style={{ padding:"5px 10px", textAlign:"right", color:C.text }}>
                              {d.age}{isBreakEven?" ⭐":""}
                            </td>
                            <td style={{ padding:"5px 10px", textAlign:"right", color:C.muted }}>Yr {d.yr}</td>
                            <td style={{ padding:"5px 10px", textAlign:"right", color:C.ok }}>{aud(d.annuityIncome)}</td>
                            <td style={{ padding:"5px 10px", textAlign:"right", color:C.main }}>{aud(d.cumulativeAnnuity)}</td>
                            <td style={{ padding:"5px 10px", textAlign:"right",
                              color:d.cumulativeAnnuity>=annuity.purchaseAmount?C.ok:C.bad }}>
                              {d.cumulativeAnnuity>=annuity.purchaseAmount
                                ? `+${aud(d.cumulativeAnnuity-annuity.purchaseAmount)}`
                                : `-${aud(annuity.purchaseAmount-d.cumulativeAnnuity)}`}
                            </td>
                            <td style={{ padding:"5px 10px", textAlign:"right",
                              color:d.abpBalance>0?C.super:C.bad }}>{aud(d.abpBalance)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>

              {/* ── Centrelink treatment ── */}
              <Card title="Centrelink Treatment of Annuities" icon="🏛️" color={C.pension}>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
                  <div>
                    <div style={{ fontSize:11, fontWeight:800, color:C.pension, marginBottom:8 }}>
                      Assets Test Treatment
                    </div>
                    {[
                      ["Purchase Price",          aud(annuity.purchaseAmount)],
                      ["Deductible Amount/yr",     aud(deductibleAmount)],
                      ["Years to Start",           yrsToStart],
                      ["Assessable Asset Value",   aud(assessableAnnuityAsset)],
                      ["vs Lump Sum",              `Saves ${aud(annuity.purchaseAmount - assessableAnnuityAsset)} in assessable assets`],
                    ].map(([k,v])=><Row key={k} k={k} v={v} />)}
                    <div style={{ marginTop:8, background:`${C.pension}10`,
                      border:`1px solid ${C.pension}33`, borderRadius:8,
                      padding:"8px 10px", fontSize:10, color:C.muted, lineHeight:1.7 }}>
                      💡 Complying lifetime annuities get favourable assets test treatment —
                      only 60% of purchase price assessed for assets test after age 84,
                      or after 5 years if purchased after 84.
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize:11, fontWeight:800, color:C.pension, marginBottom:8 }}>
                      Income Test Treatment
                    </div>
                    {[
                      ["Annual Annuity Income",    aud(annualIncome)],
                      ["Deductible Amount",        aud(deductibleAmount)],
                      ["Assessable Income",        aud(Math.max(0, annualIncome - deductibleAmount))],
                      ["Age Pension Free Area",    aud(inp.married ? AP.incCouple : AP.incSingle)],
                      ["Impact on Age Pension",    aud(Math.max(0, annualIncome - deductibleAmount - (inp.married?AP.incCouple:AP.incSingle)) * 0.5) + " reduction/yr"],
                    ].map(([k,v])=><Row key={k} k={k} v={v} />)}
                    <div style={{ marginTop:8, background:"#fef2f2",
                      border:`1px solid ${C.bad}33`, borderRadius:8,
                      padding:"8px 10px", fontSize:10, color:C.muted, lineHeight:1.7 }}>
                      ⚠️ Annuity income counts toward the income test.
                      However complying annuities get a deductible amount reducing assessable income.
                      See Age Pension tab for full means test.
                    </div>
                  </div>
                </div>
                <div style={{ marginTop:10, background:"#fffbeb",
                  border:"1px solid #f59e0b44", borderRadius:8,
                  padding:"8px 12px", fontSize:10, color:"#92400e", lineHeight:1.8 }}>
                  📋 <strong>Key rule:</strong> Complying lifetime annuities purchased from super
                  (post 1 July 2019) get 60% assets test assessment after age 84.
                  Non-complying annuities assessed at full purchase price. Always seek advice
                  on structuring to maximise Age Pension entitlement.
                  <strong> Source:</strong> servicesaustralia.gov.au · DSS Schedule 1A
                </div>
              </Card>

              {/* ── Disclaimer ── */}
              <div style={{ fontSize:9, color:C.muted, lineHeight:1.8,
                background:C.bg, borderRadius:8, padding:"8px 12px" }}>
                📋 Annuity rates are indicative only. Actual rates vary by provider, age, gender,
                term and market conditions. Australian providers include Challenger, TAL, AMP.
                Compare at moneysmart.gov.au · General information only (ASIC RG 244)
              </div>
            </>
          );
        })()}
        {/* ═══ TTR STRATEGY ═══ */}
        {tab === "ttr" && (() => {
          const ttrEligible = inp.currentAge >= preservAge && inp.currentAge < inp.retirementAge;
          const ttrMinIncome = Math.round(inp.superBalance * 0.04);
          const ttrMaxIncome = Math.round(inp.superBalance * 0.10);
          const ttrIncome = inp.ttrEnabled ? Math.min(ttrMaxIncome, Math.max(ttrMinIncome, inp.ttrIncomeStream || ttrMinIncome)) : 0;
          const extraSS = inp.ttrEnabled ? (inp.ttrSalarySacrificeExtra || 0) : 0;
          const taxSavingOnSS = extraSS * (marginalRate - 0.15);
          const ttrTaxOnIncome = ttrIncome * 0.15;
          const netBenefit = taxSavingOnSS - ttrTaxOnIncome;
          const ttrPctOfBalance = inp.superBalance > 0 ? (ttrIncome / inp.superBalance * 100).toFixed(1) : 0;
          return (
            <>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(155px,1fr))", gap:8, marginBottom:16 }}>
                <KPI label="TTR Eligible" value={ttrEligible ? "Yes ✅" : "Not Yet"} color={ttrEligible ? C.ok : C.warn} />
                <KPI label="Preservation Age" value={preservAge} sub={`Born ${inp.birthYear}`} color={C.super} />
                <KPI label="TTR Income (annual)" value={inp.ttrEnabled ? aud(ttrIncome) : "—"} color="#0284c7" />
                <KPI label="Net Tax Benefit p.a." value={inp.ttrEnabled ? aud(netBenefit) : "—"} color={netBenefit >= 0 ? C.ok : C.bad} />
              </div>

              {!ttrEligible && (
                <div style={{ background: inp.currentAge < preservAge ? "#fff7ed" : "#f0fdf4", border:`2px solid ${inp.currentAge < preservAge ? C.warn : C.ok}`, borderRadius:12, padding:"16px 20px", marginBottom:16, display:"flex", gap:14, alignItems:"center" }}>
                  <span style={{ fontSize:32 }}>{inp.currentAge < preservAge ? "🔒" : "🎓"}</span>
                  <div>
                    <div style={{ fontSize:14, fontWeight:900, color: inp.currentAge < preservAge ? C.warn : C.ok }}>
                      {inp.currentAge < preservAge
                        ? `TTR available from age ${preservAge} (${preservAge - inp.currentAge} years away)`
                        : `You're ${inp.currentAge} — past retirement age ${inp.retirementAge}, TTR window has closed`}
                    </div>
                    <div style={{ fontSize:11, color:C.muted, marginTop:4 }}>
                      TTR applies between preservation age ({preservAge}) and full retirement ({inp.retirementAge}).
                    </div>
                  </div>
                </div>
              )}

              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
                <Card title="TTR Setup" icon="🔄" color="#0284c7">
                  <Tog label="Enable TTR Strategy" value={inp.ttrEnabled} onChange={set("ttrEnabled")}
                    note={ttrEligible ? `Eligible: age ${inp.currentAge}, preservation age ${preservAge}` : `Not eligible until age ${preservAge}`} />

                  {inp.ttrEnabled && ttrEligible && (
                    <>
                      <div style={{ background:"#f0f9ff", border:`1px solid #0284c733`, borderRadius:8, padding:"10px 12px", marginBottom:12, fontSize:10, color:C.muted, lineHeight:1.8 }}>
                        <strong style={{ color:"#0284c7" }}>TTR Income Stream range:</strong><br/>
                        Min 4%: <strong style={{ color:C.ok }}>{aud(ttrMinIncome)}/yr</strong> · Max 10%: <strong style={{ color:C.warn }}>{aud(ttrMaxIncome)}/yr</strong>
                      </div>
                      <Fld label="TTR Income Stream (annual)" value={inp.ttrIncomeStream || ttrMinIncome}
                        onChange={v => set("ttrIncomeStream")(Math.min(ttrMaxIncome, Math.max(ttrMinIncome, v)))}
                        note={`${ttrPctOfBalance}% of super · Min $${(ttrMinIncome/1000).toFixed(0)}k, Max $${(ttrMaxIncome/1000).toFixed(0)}k`} />
                      <Fld label="Extra Salary Sacrifice (increase)" value={inp.ttrSalarySacrificeExtra || 0}
                        onChange={set("ttrSalarySacrificeExtra")}
                        note={`Cap check: current ${aud(totalSuperContrib + extraSS)} vs $30,000 cap. Tax saving: ${aud(taxSavingOnSS)}`} />
                      {totalSuperContrib + extraSS > 30000 && (
                        <div style={{ fontSize:10, color:C.bad }}>⚠️ Extra sacrifice may exceed concessional cap — reduce to avoid penalty tax.</div>
                      )}
                    </>
                  )}
                </Card>

                <Card title="TTR Tax Analysis" icon="🧾" color="#0284c7">
                  {inp.ttrEnabled && ttrEligible ? (
                    <>
                      {[
                        ["TTR Income Stream (gross)", aud(ttrIncome), "#0284c7"],
                        ["Tax on TTR income (15%)", aud(ttrTaxOnIncome), C.bad],
                        ["TTR Income (after tax)", aud(ttrIncome - ttrTaxOnIncome), C.ok],
                        ["—", "—", C.muted],
                        ["Extra Salary Sacrifice", aud(extraSS), C.super],
                        [`Marginal rate (${pct(marginalRate)}) vs super (15%)`, "", C.muted],
                        ["Tax saving from extra SS", aud(taxSavingOnSS), C.ok],
                        ["—", "—", C.muted],
                        ["Net annual benefit", aud(netBenefit), netBenefit >= 0 ? C.ok : C.bad],
                        ["Super balance impact (yr 1)", aud(extraSS - ttrIncome), extraSS >= ttrIncome ? C.ok : C.warn],
                      ].map(([k,v,c]) => k === "—" ? <div key={k+v} style={{ height:1, background:C.border, margin:"4px 0" }} /> : <Row key={k} k={k} v={v} color={c} />)}
                      <div style={{ fontSize:10, color:C.muted, marginTop:8, background:C.bg, borderRadius:6, padding:8, lineHeight:1.7 }}>
                        {netBenefit >= 0
                          ? `✅ Strategy is tax-positive: saving ${aud(netBenefit)} p.a. compared to drawing purely from salary.`
                          : `⚠️ Net negative: increase salary sacrifice or reduce TTR draw to improve outcome.`}
                      </div>
                    </>
                  ) : (
                    <div style={{ color:C.muted, fontSize:11 }}>Enable TTR strategy to see tax analysis.</div>
                  )}
                </Card>
              </div>

              {/* Plain English explainer */}
              <Card title="How TTR Works — Plain English" icon="💬" color="#0284c7">
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
                  <div>
                    <div style={{ fontSize:11, fontWeight:800, color:"#0284c7", marginBottom:8 }}>📖 The Strategy</div>
                    <div style={{ fontSize:11, color:C.text, lineHeight:1.9 }}>
                      A <strong>Transition to Retirement (TTR)</strong> pension lets you draw from your super while you're still working, once you've reached your preservation age ({preservAge}).<br/><br/>
                      The idea is simple: you <strong>start drawing</strong> a small income from super (4–10% of balance), and simultaneously <strong>increase your salary sacrifice</strong> by the same amount — keeping your take-home pay the same.<br/><br/>
                      Because super is taxed at only <strong>15%</strong> while your marginal rate might be 30–45%, the roundtrip saves real money each year.
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize:11, fontWeight:800, color:"#0284c7", marginBottom:8 }}>✅ Key Rules (ATO)</div>
                    <div style={{ fontSize:11, color:C.muted, lineHeight:1.9 }}>
                      ✅ Must have reached preservation age ({preservAge})<br/>
                      ✅ Still working (employed or self-employed)<br/>
                      ✅ TTR income: min 4%, max 10% of balance per year<br/>
                      ⚠️ TTR pension earnings taxed at <strong>15%</strong> (unlike retirement pension which is 0%)<br/>
                      ⚠️ Cannot withdraw lump sums in TTR phase<br/>
                      ✅ Concessional cap still applies: $30,000/yr total<br/>
                      ✅ Becomes a retirement pension (0% tax) when you:<br/>
                      &nbsp;&nbsp;&nbsp;• Turn 65, or<br/>
                      &nbsp;&nbsp;&nbsp;• Meet a condition of release (retire, cease employment)<br/>
                      <br/>
                      <strong style={{ color:"#0284c7" }}>Source:</strong> ATO — ato.gov.au/super/transition-to-retirement
                    </div>
                  </div>
                </div>
                <div style={{ background:"#f0f9ff", border:`1px solid #0284c733`, borderRadius:8, padding:"10px 12px", marginTop:10, fontSize:10, color:C.muted }}>
                  💡 <strong>Example:</strong> Age 60, $400k super, $120k salary, 30% marginal rate. Draw $20k TTR (5%), redirect $20k to salary sacrifice. Save ($20k × 15%) = $3,000/yr in tax — zero change to take-home pay.
                </div>
              </Card>
            </>
          );
        })()}

        {/* ═══ TAX ═══ */}
        {tab === "tax" && (() => {

          // ── Current year calcs ──
          const gross         = inp.annualIncome || 0;
          const partner       = inp.partnerIncome || 0;
          const ssPre         = inp.voluntarySuper || 0;
          const taxableIncome = Math.max(0, gross - ssPre);
          const sgAmount      = Math.round(gross * getSGRate(new Date().getFullYear()));
          const concessional  = sgAmount + ssPre;
          const marginalRate  = getMarginalRate(taxableIncome);
          const incomeTax     = calcIncomeTax(taxableIncome);
          const medicare      = calcMedicareLevy(taxableIncome);
          const lito          = calcLITO(taxableIncome);
          const netTax        = calcNetTax(taxableIncome);
          const effRate       = netTax / Math.max(1, taxableIncome);
          const takeHome      = taxableIncome - netTax;
          const superTax      = calcSuperTax(concessional, gross);
          const superSaving   = Math.round((marginalRate - 0.15) * ssPre);
          const div293        = gross > 250000 ? Math.round(Math.min(concessional, gross - 250000) * 0.15) : 0;

          // ── Tax visualiser income (initialise from inp if not set) ──
          const vizIncome  = taxVizIncome  || gross || 80000;
          const vizIncome2 = taxVizIncome2 || partner || 60000;
          // ── Partner tax ──
          const partnerTax    = partner > 0 ? calcNetTax(partner) : 0;
          const partnerEff    = partnerTax / Math.max(1, partner);
          const householdTax  = netTax + partnerTax;
          const householdNet  = gross + partner - ssPre - householdTax;

          // ── Retirement tax (age 67+) ──
          const retireIncome  = inp.retirementExpenses || 0;
          const retireeTax    = calcRetireeTax(retireIncome, inp.married);
          const saptoAmt      = calcSAPTO(retireIncome, inp.married);

          // ── Rental income tax ──
          const rentalGross   = (inp.properties||[]).filter(p=>!p.isPrimary)
            .reduce((s,p)=>(s+(p.weeklyRent||0)*52),0);
          const rentalExp     = (inp.properties||[]).filter(p=>!p.isPrimary)
            .reduce((s,p)=>(s+(p.weeklyRent||0)*52*(p.expenseRatio||0.25)),0);
          const rentalNet     = rentalGross - rentalExp;
          const rentalTaxImpact = Math.round(calcNetTax(taxableIncome + rentalNet) - netTax);

          // ── CGT estimates ──
          const propVal       = (inp.properties||[]).filter(p=>!p.isPrimary)
            .reduce((s,p)=>s+(p.value||0),0);
          const propCost      = propVal * 0.7; // assume 30% gain
          const propCGT       = calcCGT(propVal - propCost, taxableIncome, true);
          const shareVal      = (inp.assetItems||[]).find(a=>a.type==="shares_au")?.value || 0;
          const shareCGT      = calcCGT(shareVal * 0.3, taxableIncome, true); // assume 30% gain

          // ── Tax over time projection ──
          const taxOverTime = proj.filter(d=>d.age%5===0).map(d => {
            const inc  = d.age < inp.retirementAge ? gross : (d.income || 0);
            const tax  = d.age >= 67
              ? calcRetireeTax(inc, inp.married)
              : calcNetTax(inc);
            return { age:d.age, grossIncome:Math.round(inc), taxPaid:Math.round(tax),
              netIncome:Math.round(inc-tax), effectiveRate: inc > 0 ? tax/inc : 0 };
          });

          return (
            <>
            {/* ── TAX BRACKET VISUALISER (collapsible) ── */}
              {(() => {
                // ── Tax breakdown helper ──
                const breakdown = inc => {
                  const ss    = inc === vizIncome ? ssPre : 0;
                  const taxable = Math.max(0, inc - ss);
                  const brackets = [
                    { label:"Tax-Free",  min:0,      max:18200,  rate:0,    color:"#86efac" },
                    { label:"19%",       min:18201,  max:45000,  rate:0.19, color:"#fde68a" },
                    { label:"32.5%",     min:45001,  max:135000, rate:0.325,color:"#fca5a5" },
                    { label:"37%",       min:135001, max:190000, rate:0.37, color:"#f87171" },
                    { label:"45%",       min:190001, max:Infinity,rate:0.45,color:"#dc2626" },
                  ];
                  const litoAmt  = calcLITO(taxable);
                  const medAmt   = calcMedicareLevy(taxable);
                  const baseTax  = calcIncomeTax(taxable);
                  const netTaxAmt= calcNetTax(taxable);
                  const effR     = netTaxAmt / Math.max(1, taxable);
                  const margR    = getMarginalRate(taxable);
                  const slices   = brackets.map(b => ({
                    ...b,
                    amount: Math.max(0, Math.min(taxable, b.max) - b.min + 1),
                    tax:    Math.max(0, Math.min(taxable, b.max) - Math.max(0, b.min - 1)) * b.rate,
                  })).filter(b => b.amount > 0);
                  return { taxable, ss, slices, litoAmt, medAmt, baseTax, netTaxAmt, effR, margR };
                };

                const b1 = breakdown(vizIncome);
                const b2 = breakdown(vizIncome2);

                const BracketBar = ({ bd, income, label, color }) => (
                  <div style={{ marginBottom:16 }}>
                    <div style={{ fontSize:11, fontWeight:800, color, marginBottom:6 }}>
                      {label} — {aud(income)}
                      {bd.ss > 0 && <span style={{ fontSize:9, color:C.muted, fontWeight:400 }}>
                        {" "}(taxable: {aud(bd.taxable)} after {aud(bd.ss)} SS)
                      </span>}
                    </div>
                    {/* Stacked bracket bar */}
                    <div style={{ display:"flex", height:36, borderRadius:8,
                      overflow:"hidden", border:`1px solid ${C.border}`, marginBottom:6 }}>
                      {bd.slices.map((s,i) => (
                        <div key={i} style={{
                          width:`${(s.amount/Math.max(1,bd.taxable))*100}%`,
                          background:s.color, position:"relative",
                          display:"flex", alignItems:"center", justifyContent:"center",
                          minWidth: s.amount/bd.taxable > 0.08 ? 0 : 0 }}>
                          {s.amount/bd.taxable > 0.1 && (
                            <span style={{ fontSize:8, fontWeight:800,
                              color: s.rate===0?"#166534":"#7f1d1d", whiteSpace:"nowrap" }}>
                              {s.label}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                    {/* Bracket legend */}
                    <div style={{ display:"flex", flexWrap:"wrap", gap:4, marginBottom:8 }}>
                      {bd.slices.map((s,i) => (
                        <div key={i} style={{ display:"flex", alignItems:"center",
                          gap:3, fontSize:9 }}>
                          <div style={{ width:10, height:10, borderRadius:2,
                            background:s.color, flexShrink:0 }} />
                          <span style={{ color:C.muted }}>
                            {s.label}: {aud(s.amount)} → <strong>{aud(Math.round(s.tax))}</strong>
                          </span>
                        </div>
                      ))}
                    </div>
                    {/* Medicare, LITO, Net breakdown */}
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:6 }}>
                      {[
                        ["Base Tax",    aud(Math.round(bd.baseTax)),   C.bad  ],
                        ["LITO Relief", `-${aud(Math.round(bd.litoAmt))}`, C.ok],
                        ["Medicare",    `+${aud(Math.round(bd.medAmt))}`,  C.warn],
                        ["Net Tax",     aud(Math.round(bd.netTaxAmt)), C.bad  ],
                        ["Take Home",   aud(Math.round(income - bd.netTaxAmt - bd.ss)), C.ok],
                      ].map(([k,v,c])=>(
                        <div key={k} style={{ background:"white", border:`1px solid ${c}22`,
                          borderRadius:8, padding:"6px 8px", textAlign:"center" }}>
                          <div style={{ fontSize:8, color:C.muted, marginBottom:2 }}>{k}</div>
                          <div style={{ fontSize:11, fontWeight:900, color:c }}>{v}</div>
                        </div>
                      ))}
                    </div>
                    {/* Gauge row */}
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginTop:8 }}>
                      {[
                        ["Effective Rate", bd.effR,  C.warn],
                        ["Marginal Rate",  bd.margR, C.bad ],
                      ].map(([lbl,rate,c])=>(
                        <div key={lbl} style={{ background:"white", border:`1px solid ${c}22`,
                          borderRadius:8, padding:"8px 10px" }}>
                          <div style={{ display:"flex", justifyContent:"space-between",
                            marginBottom:4, fontSize:10 }}>
                            <span style={{ color:C.muted, fontWeight:700 }}>{lbl}</span>
                            <span style={{ color:c, fontWeight:900 }}>{(rate*100).toFixed(1)}%</span>
                          </div>
                          <div style={{ height:8, background:`${c}22`, borderRadius:4 }}>
                            <div style={{ height:8, width:`${Math.min(100,rate*100/45*100)}%`,
                              background:c, borderRadius:4,
                              transition:"width 0.3s ease" }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );

                return (
                  <div style={{ background:"white", border:`1.5px solid ${C.tax||"#f97316"}44`,
                    borderRadius:12, overflow:"hidden", marginBottom:14 }}>
                    {/* Header */}
                    <div onClick={()=>setTaxVizOpen(o=>!o)}
                      style={{ padding:"12px 16px", cursor:"pointer",
                        display:"flex", alignItems:"center", gap:10,
                        background: taxVizOpen?`${C.warn}12`:"white",
                        borderBottom: taxVizOpen?`1px solid ${C.warn}33`:"none" }}>
                      <span style={{ fontSize:18 }}>🎚️</span>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:12, fontWeight:900, color:C.warn }}>
                          Live Tax Bracket Visualiser
                          <span style={{ fontSize:10, fontWeight:400,
                            color:C.muted, marginLeft:8 }}>
                            — drag slider to see real-time tax impact
                          </span>
                        </div>
                        <div style={{ fontSize:10, color:C.muted, marginTop:1 }}>
                          Effective rate: <strong style={{color:C.warn}}>{(b1.effR*100).toFixed(1)}%</strong>
                          &nbsp;·&nbsp;
                          Marginal rate: <strong style={{color:C.bad}}>{(b1.margR*100).toFixed(0)}%</strong>
                          &nbsp;·&nbsp;
                          Net tax: <strong style={{color:C.bad}}>{aud(Math.round(b1.netTaxAmt))}</strong>
                        </div>
                      </div>
                      <span style={{ fontSize:16, color:C.warn, fontWeight:900 }}>
                        {taxVizOpen?"▲":"▼"}
                      </span>
                    </div>

                    {taxVizOpen && (
                      <div style={{ padding:"16px" }}>
                        {/* Income 1 slider */}
                        <div style={{ marginBottom:16 }}>
                          <div style={{ display:"flex", justifyContent:"space-between",
                            fontSize:11, fontWeight:800, color:C.main, marginBottom:4 }}>
                            <span>💼 Primary Income</span>
                            <span style={{ color:C.ok, fontSize:14 }}>{aud(vizIncome)}</span>
                          </div>
                          <input type="range" min={0} max={400000} step={1000}
                            value={vizIncome}
                            onChange={e=>setTaxVizIncome(parseInt(e.target.value))}
                            style={{ width:"100%", accentColor:C.main, height:6 }} />
                          <div style={{ display:"flex", justifyContent:"space-between",
                            fontSize:9, color:C.muted, marginTop:2 }}>
                            <span>$0</span><span>$100k</span><span>$200k</span>
                            <span>$300k</span><span>$400k</span>
                          </div>
                        </div>

                        {/* SS impact */}
                        {ssPre > 0 && (
                          <div style={{ background:`${C.super}10`, border:`1px solid ${C.super}33`,
                            borderRadius:8, padding:"8px 12px", marginBottom:12,
                            fontSize:10, color:C.muted }}>
                            💰 Salary sacrifice <strong style={{color:C.super}}>{aud(ssPre)}</strong> reduces
                            taxable income from <strong>{aud(vizIncome)}</strong> to{" "}
                            <strong style={{color:C.ok}}>{aud(Math.max(0,vizIncome-ssPre))}</strong>
                            {" "}— saving <strong style={{color:C.ok}}>{aud(Math.round((b1.margR-0.15)*ssPre))}</strong> in tax
                          </div>
                        )}

                        <BracketBar bd={b1} income={vizIncome}
                          label="Primary Income" color={C.main} />

                        {/* Compare toggle */}
                        <div style={{ display:"flex", alignItems:"center", gap:10,
                          marginBottom:14, paddingTop:8,
                          borderTop:`1px solid ${C.border}` }}>
                          <button onClick={()=>setTaxVizShowCompare(c=>!c)}
                            style={{ padding:"5px 14px",
                              background:taxVizShowCompare?C.main:C.card,
                              color:taxVizShowCompare?"white":C.muted,
                              border:`1px solid ${C.border}`, borderRadius:8,
                              fontSize:11, fontWeight:800, cursor:"pointer" }}>
                            {taxVizShowCompare?"▲ Hide":"⚖️ Compare two incomes"}
                          </button>
                          {taxVizShowCompare && (
                            <span style={{ fontSize:10, color:C.muted }}>
                              Household combined tax: <strong style={{color:C.bad}}>
                                {aud(Math.round(b1.netTaxAmt+b2.netTaxAmt))}
                              </strong>
                            </span>
                          )}
                        </div>

                        {taxVizShowCompare && (
                          <>
                            <div style={{ marginBottom:16 }}>
                              <div style={{ display:"flex", justifyContent:"space-between",
                                fontSize:11, fontWeight:800, color:C.prop, marginBottom:4 }}>
                                <span>👫 Partner / Second Income</span>
                                <span style={{ color:C.prop, fontSize:14 }}>{aud(vizIncome2)}</span>
                              </div>
                              <input type="range" min={0} max={400000} step={1000}
                                value={vizIncome2}
                                onChange={e=>setTaxVizIncome2(parseInt(e.target.value))}
                                style={{ width:"100%", accentColor:C.prop, height:6 }} />
                              <div style={{ display:"flex", justifyContent:"space-between",
                                fontSize:9, color:C.muted, marginTop:2 }}>
                                <span>$0</span><span>$100k</span><span>$200k</span>
                                <span>$300k</span><span>$400k</span>
                              </div>
                            </div>
                            <BracketBar bd={b2} income={vizIncome2}
                              label="Partner Income" color={C.prop} />

                            {/* Side by side summary */}
                            <div style={{ background:"#f8fafc", border:`1px solid ${C.border}`,
                              borderRadius:10, padding:"12px 14px", marginTop:4 }}>
                              <div style={{ fontSize:11, fontWeight:800, color:C.text,
                                marginBottom:8 }}>Household Comparison</div>
                              <div style={{ display:"grid",
                                gridTemplateColumns:"2fr 1fr 1fr 1fr", gap:0 }}>
                                {["","Primary","Partner","Combined"].map((h,i)=>(
                                  <div key={i} style={{ padding:"4px 8px", fontSize:9,
                                    color:C.muted, fontWeight:800,
                                    textTransform:"uppercase", borderBottom:`2px solid ${C.border}` }}>
                                    {h}
                                  </div>
                                ))}
                                {[
                                  ["Gross Income",    aud(vizIncome),                    aud(vizIncome2),                    aud(vizIncome+vizIncome2)],
                                  ["Net Tax",         aud(Math.round(b1.netTaxAmt)),     aud(Math.round(b2.netTaxAmt)),      aud(Math.round(b1.netTaxAmt+b2.netTaxAmt))],
                                  ["Effective Rate",  `${(b1.effR*100).toFixed(1)}%`,    `${(b2.effR*100).toFixed(1)}%`,     `${((b1.netTaxAmt+b2.netTaxAmt)/(vizIncome+vizIncome2||1)*100).toFixed(1)}%`],
                                  ["Marginal Rate",   `${(b1.margR*100).toFixed(0)}%`,   `${(b2.margR*100).toFixed(0)}%`,    "—"],
                                  ["Take Home",       aud(Math.round(vizIncome-b1.netTaxAmt-b1.ss)), aud(Math.round(vizIncome2-b2.netTaxAmt)), aud(Math.round(vizIncome+vizIncome2-b1.netTaxAmt-b2.netTaxAmt-b1.ss))],
                                ].map(([label,...vals],ri)=>
                                  [label,...vals].map((cell,ci)=>(
                                    <div key={`${ri}-${ci}`} style={{
                                      padding:"5px 8px", fontSize:10,
                                      borderBottom:`1px solid ${C.border}22`,
                                      fontWeight: ci===0?700:ci===3?800:400,
                                      color: ci===0?C.text:ci===3?C.main:C.muted,
                                      background: ri%2===0?"transparent":"#f8fafc" }}>
                                      {cell}
                                    </div>
                                  ))
                                )}
                              </div>
                            </div>
                          </>
                        )}

                        {/* ATO brackets reference */}
                        <div style={{ marginTop:14, background:"#fffbeb",
                          border:"1px solid #f59e0b44", borderRadius:8,
                          padding:"8px 12px", fontSize:9, color:"#92400e", lineHeight:1.8 }}>
                          📋 <strong>ATO FY2025-26 brackets:</strong> $0–$18,200 (0%) ·
                          $18,201–$45,000 (19%) · $45,001–$135,000 (32.5%) ·
                          $135,001–$190,000 (37%) · $190,001+ (45%) ·
                          Medicare levy 2% · LITO up to $700 offset
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
              {/* ── KPI row ── */}
              <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, marginBottom:14 }}>
                <KPI label="Gross Income"      value={aud(gross)}        color={C.text} />
                <KPI label="Total Tax Payable" value={aud(netTax)}       color={C.bad}  sub={`Eff. rate ${pct(effRate)}`} />
                <KPI label="Net Take-Home"     value={aud(takeHome)}     color={C.ok}   />
                <KPI label="Super Tax Saving"  value={aud(superSaving)}  color={C.super} sub="Salary sacrifice benefit" />
              </div>

              {/* ── Main tax breakdown + brackets ── */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:14 }}>

                <Card title="Your Tax Breakdown FY2025-26" icon="🧾" color={C.bad}>
                  {/* Visual tax bar */}
                  <div style={{ marginBottom:12 }}>
                    <div style={{ fontSize:10, color:C.muted, marginBottom:4 }}>
                      Gross ${(gross/1000).toFixed(0)}k breakdown
                    </div>
                    <div style={{ display:"flex", height:20, borderRadius:6, overflow:"hidden", width:"100%" }}>
                      <div style={{ width:`${(takeHome/Math.max(1,gross))*100}%`, background:C.ok }} title={`Take-home: ${aud(takeHome)}`} />
                      <div style={{ width:`${(netTax/Math.max(1,gross))*100}%`, background:C.bad }} title={`Tax: ${aud(netTax)}`} />
                      <div style={{ width:`${(ssPre/Math.max(1,gross))*100}%`, background:C.super }} title={`Super sacrifice: ${aud(ssPre)}`} />
                    </div>
                    <div style={{ display:"flex", gap:12, marginTop:4, fontSize:9 }}>
                      {[[C.ok,"Take-home"],[C.bad,"Tax"],[C.super,"Super sacrifice"]].map(([c,l])=>(
                        <span key={l} style={{ display:"flex", alignItems:"center", gap:3 }}>
                          <span style={{ width:8, height:8, borderRadius:2, background:c, display:"inline-block" }} />
                          <span style={{ color:C.muted }}>{l}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                  {[
                    ["Gross Salary",          aud(gross),          C.text],
                    ["Less Salary Sacrifice",  `−${aud(ssPre)}`,   C.super],
                    ["Taxable Income",         aud(taxableIncome),  C.text],
                    ["Income Tax",             aud(incomeTax),      C.bad],
                    ["Less LITO",              `−${aud(lito)}`,    C.ok],
                    ["Medicare Levy (2%)",     aud(medicare),       C.health],
                    ["Net Tax Payable",        aud(netTax),         C.bad],
                    ["Effective Rate",         pct(effRate),        C.warn],
                    ["Marginal Rate",          pct(marginalRate),   C.warn],
                    ["Net Take-Home",          aud(takeHome),       C.ok],
                    ["SG Contributions",       aud(sgAmount),       C.super],
                    ["Super Tax (15%)",        aud(superTax),       C.super],
                    div293 > 0 ? ["Div 293 Extra Tax", aud(div293), C.bad] : null,
                    ["Salary Sacrifice Saving",aud(superSaving),    C.ok],
                  ].filter(Boolean).map(([k,v,c])=><Row key={k} k={k} v={v} color={c} />)}
                </Card>

                <Card title="Tax Brackets FY2025-26" icon="📊" color={C.bad}>
                  {[
                    [0,      18200,  "Nil",          "#6b7280"],
                    [18201,  45000,  "16¢ per $1",   C.warn],
                    [45001,  135000, "30¢ per $1",   "#f97316"],
                    [135001, 190000, "37¢ per $1",   C.bad],
                    [190001, Infinity,"45¢ per $1",  "#991b1b"],
                  ].map(([lo,hi,rate,c])=>{
                    const active = taxableIncome > lo;
                    const width  = active ? Math.min(100, ((Math.min(taxableIncome,hi)-lo)/(hi===Infinity?50000:hi-lo))*100) : 0;
                    return (
                      <div key={lo} style={{ marginBottom:8 }}>
                        <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, marginBottom:2 }}>
                          <span style={{ color:active?c:C.muted, fontWeight:active?800:400 }}>
                            ${(lo/1000).toFixed(0)}k{hi===Infinity?"+":`–$${(hi/1000).toFixed(0)}k`}
                          </span>
                          <span style={{ color:C.text, fontWeight:active?700:400 }}>{rate}</span>
                        </div>
                        <div style={{ height:6, background:`${c}22`, borderRadius:3 }}>
                          <div style={{ height:6, width:`${width}%`, background:c, borderRadius:3, transition:"width 0.3s" }} />
                        </div>
                      </div>
                    );
                  })}
                  <div style={{ marginTop:10, background:C.bg, borderRadius:8, padding:10,
                    fontSize:10, color:C.muted, lineHeight:1.8 }}>
                    <strong style={{color:C.main}}>Your bracket: {pct(marginalRate)}</strong><br/>
                    {div293>0 && <><strong style={{color:C.bad}}>⚠️ Div 293 applies — extra 15% on super</strong><br/></>}
                    Rental income added to taxable income<br/>
                    Negative gearing losses are deductible<br/>
                    CGT: 50% discount if asset held {">"} 12 months<br/>
                    Super pension phase: 0% tax on withdrawals
                  </div>
                </Card>
              </div>

              {/* ── Super tax + CGT + Rental ── */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:14, marginBottom:14 }}>

                <Card title="Super Tax" icon="🏦" color={C.super}>
                  {[
                    ["SG Contributions",        aud(sgAmount)],
                    ["Salary Sacrifice",         aud(ssPre)],
                    ["Total Concessional",       aud(concessional)],
                    ["Concessional Cap",         aud(30000)],
                    ["Tax in Super (15%)",       aud(superTax)],
                    ["Div 293 (if income>$250k)",aud(div293)],
                    ["Your Marginal Rate",       pct(marginalRate)],
                    ["Tax Saving vs Marginal",   aud(superSaving)],
                  ].map(([k,v])=><Row key={k} k={k} v={v} />)}
                  <div style={{ marginTop:8, background:`${C.super}12`, borderRadius:8,
                    padding:"8px 10px", fontSize:10, color:C.super, fontWeight:700 }}>
                    💡 Super pension phase: 0% tax on income and withdrawals (age 60+)
                  </div>
                </Card>

                <Card title="Capital Gains Tax (CGT)" icon="📈" color={C.prop}>
                  {[
                    ["Investment Property Value", aud(propVal)],
                    ["Estimated Cost Base (70%)",  aud(Math.round(propCost))],
                    ["Estimated Capital Gain",     aud(Math.round(propVal-propCost))],
                    ["After 50% CGT Discount",     aud(Math.round((propVal-propCost)*0.5))],
                    ["Est. CGT Payable",           aud(propCGT)],
                    ["ASX Shares Value",           aud(shareVal)],
                    ["Est. Share CGT (30% gain)",  aud(shareCGT)],
                  ].map(([k,v])=><Row key={k} k={k} v={v} />)}
                  <div style={{ marginTop:8, background:`${C.prop}12`, borderRadius:8,
                    padding:"8px 10px", fontSize:10, color:C.prop, fontWeight:700 }}>
                    💡 Hold assets {">"} 12 months for 50% CGT discount. Sell in low-income years to minimise CGT.
                  </div>
                </Card>

                <Card title="Rental Income Tax" icon="🏘️" color={C.prop}>
                  {[
                    ["Gross Rental Income",        aud(rentalGross)],
                    ["Less Expenses",              `−${aud(Math.round(rentalExp))}`],
                    ["Net Rental Income",          aud(Math.round(rentalNet))],
                    ["Added to Taxable Income",    rentalNet >= 0 ? "Yes (positive gearing)" : "Deductible (negative gearing)"],
                    ["Tax Impact at Marginal Rate",aud(rentalTaxImpact)],
                    ["Effective Rental Tax Rate",  rentalGross > 0 ? pct(rentalTaxImpact/Math.max(1,rentalGross)) : "N/A"],
                  ].map(([k,v])=><Row key={k} k={k} v={v} />)}
                  <div style={{ marginTop:8, background:`${C.prop}12`, borderRadius:8,
                    padding:"8px 10px", fontSize:10, color:C.prop, fontWeight:700 }}>
                    💡 Negative gearing: rental loss reduces your taxable income at marginal rate.
                  </div>
                </Card>
              </div>

              {/* ── Partner + household + retirement tax ── */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:14 }}>

                <Card title="Household Tax Summary" icon="👫" color={C.main}>
                  {[
                    ["Your Gross Income",          aud(gross)],
                    ["Your Tax",                   aud(netTax)],
                    ["Your Effective Rate",         pct(effRate)],
                    partner > 0 ? ["Partner Gross Income", aud(partner)] : null,
                    partner > 0 ? ["Partner Tax",          aud(partnerTax)] : null,
                    partner > 0 ? ["Partner Effective Rate", pct(partnerEff)] : null,
                    ["Combined Gross",             aud(gross + partner)],
                    ["Combined Tax",               aud(householdTax)],
                    ["Combined Net",               aud(householdNet)],
                  ].filter(Boolean).map(([k,v])=><Row key={k} k={k} v={v} />)}
                  {partner === 0 && (
                    <div style={{ fontSize:10, color:C.muted, marginTop:8 }}>
                      Add partner income in the Personal tab to see household tax splitting.
                    </div>
                  )}
                </Card>

                <Card title="Retirement Tax (Age 67+)" icon="🌅" color={C.pension}>
                  <div style={{ fontSize:10, color:C.muted, marginBottom:8 }}>
                    Based on your retirement expenses as income proxy.
                  </div>
                  {[
                    ["Estimated Retirement Income", aud(retireIncome)],
                    ["Income Tax (brackets)",       aud(calcIncomeTax(retireIncome))],
                    ["Less LITO",                   `−${aud(calcLITO(retireIncome))}`],
                    ["Less SAPTO",                  `−${aud(saptoAmt)}`],
                    ["Medicare Levy",               aud(calcMedicareLevy(retireIncome))],
                    ["Net Tax in Retirement",       aud(retireeTax)],
                    ["Effective Rate",              pct(retireeTax/Math.max(1,retireIncome))],
                    ["Super Pension Withdrawals",   "0% tax (age 60+)"],
                    ["Lump Sum Withdrawals",        "0% tax (age 60+)"],
                  ].map(([k,v])=><Row key={k} k={k} v={v} />)}
                  <div style={{ marginTop:8, background:`${C.pension}12`, borderRadius:8,
                    padding:"8px 10px", fontSize:10, color:C.pension, fontWeight:700 }}>
                    💡 SAPTO saves retirees up to {aud(inp.married?1602:2230)}/yr in tax.
                    Super pension is completely tax-free from age 60.
                  </div>
                </Card>
              </div>

              {/* ── Tax over time table ── */}
              <Card title="Tax Over Time (5-Year Intervals)" icon="📅" color={C.bad}>
                <div style={{ overflowX:"auto" }}>
                  <table style={{ width:"100%", borderCollapse:"collapse", fontSize:10 }}>
                    <thead>
                      <tr style={{ background:"#fef2f2" }}>
                        {["Age","Gross Income","Tax Paid","Net Income","Effective Rate"].map(h=>(
                          <th key={h} style={{ padding:"5px 10px", textAlign:"right",
                            color:C.bad, fontWeight:800, fontSize:9, textTransform:"uppercase",
                            borderBottom:`2px solid ${C.bad}44` }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {taxOverTime.map(d=>(
                        <tr key={d.age} style={{ borderBottom:`1px solid ${C.border}22`,
                          background: d.age===inp.retirementAge?"#eff6ff":
                            d.age===67?"#f5f3ff":"transparent" }}>
                          <td style={{ padding:"5px 10px", textAlign:"right", fontWeight:700,
                            color:d.age===inp.retirementAge?C.super:d.age===67?C.pension:C.muted }}>{d.age}</td>
                          <td style={{ padding:"5px 10px", textAlign:"right", color:C.text }}>{aud(d.grossIncome)}</td>
                          <td style={{ padding:"5px 10px", textAlign:"right", color:C.bad }}>{aud(d.taxPaid)}</td>
                          <td style={{ padding:"5px 10px", textAlign:"right", color:C.ok }}>{aud(d.netIncome)}</td>
                          <td style={{ padding:"5px 10px", textAlign:"right", color:C.warn }}>{pct(d.effectiveRate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ fontSize:9, color:C.muted, marginTop:8 }}>
                  🟦 Retirement age · 🟣 Age Pension age (67) · SAPTO applied from age 67 · Super pension 0% tax from age 60
                </div>
              </Card>
            </>
          );
        })()}
        {/* ═══ DEBTS ═══ */}
        {tab === "debts" && (
          <>
            <div style={{ marginBottom: 12 }}><Btn onClick={addDebt} color={C.bad}>+ Add Debt / Loan</Btn></div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
              {inp.debts.map(d => (
                <Card key={d.id} title={d.label} icon="💳" color={C.bad}
                  action={<Btn small onClick={() => setInp(p=>({...p, debts:p.debts.filter(x=>x.id!==d.id)}))} color={C.bad}>Remove</Btn>}>
                  <Fld label="Debt Name" value={d.label} onChange={v=>setNested("debts",d.id,"label",v)} pre="" type="text" />
                  <Fld label="Outstanding Balance" value={d.balance} onChange={v=>setNested("debts",d.id,"balance",v)} />
                  <Fld label="Interest Rate" value={d.rate} onChange={v=>setNested("debts",d.id,"rate",v)} pre="" suf="% p.a." />
                  <Fld label="Monthly Repayment" value={d.monthlyRepayment} onChange={v=>setNested("debts",d.id,"monthlyRepayment",v)} />
                  <div style={{ fontSize:10, color:C.muted }}>Annual interest: <strong style={{color:C.bad}}>{aud(d.balance*d.rate/100)}</strong></div>
                </Card>
              ))}
              {inp.debts.length===0 && <div style={{ color:C.muted, fontSize:12 }}>No debts added. Click "+ Add Debt" to model personal loans, car loans, credit cards, etc.</div>}
            </div>
            <Card title="Total Debt Overview" icon="📊" color={C.bad}>
              {[["Mortgage Balances",aud(inp.properties.reduce((s,p)=>s+(p.mortgage||0),0))],["Other Debts",aud(inp.debts.reduce((s,d)=>s+(d.balance||0),0))],["Total Debt",aud(totalDebt)],["LVR",pct(totalDebt/Math.max(1,totalPropertyValue))]].map(([k,v])=><Row key={k} k={k} v={v} />)}
            </Card>
          </>
        )}

        {/* ═══ LIFE EVENTS ═══ */}
        {tab === "events" && (
          <>
            <div style={{ display:"flex", gap:8, marginBottom:14, flexWrap:"wrap" }}>
              <Btn onClick={addWindfall} color={C.ok}>+ Windfall / Inheritance</Btn>
              <Btn onClick={addBigExpense} color={C.warn}>+ Big Expense</Btn>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
              <Card title="Windfalls & One-Off Income" icon="🎁" color={C.ok}>
                {inp.windfalls.map(w=>(
                  <div key={w.id} style={{ display:"flex", gap:6, marginBottom:6, alignItems:"flex-end" }}>
                    <Fld value={w.label} onChange={v=>setNested("windfalls",w.id,"label",v)} pre="" type="text" />
                    <Fld value={w.age} onChange={v=>setNested("windfalls",w.id,"age",v)} pre="Age" />
                    <Fld value={w.amount} onChange={v=>setNested("windfalls",w.id,"amount",v)} />
                    <Btn small onClick={()=>setInp(p=>({...p,windfalls:p.windfalls.filter(x=>x.id!==w.id)}))} color={C.bad}>×</Btn>
                  </div>
                ))}
                {inp.windfalls.length===0 && <div style={{color:C.muted,fontSize:11}}>Add inheritance, business sale, downsizing proceeds, etc.</div>}
              </Card>
              <Card title="Big Expenses / Lump-Sum Costs" icon="💸" color={C.warn}>
                {inp.bigExpenses.map(e=>(
                  <div key={e.id} style={{ display:"flex", gap:6, marginBottom:6, alignItems:"flex-end" }}>
                    <Fld value={e.label} onChange={v=>setNested("bigExpenses",e.id,"label",v)} pre="" type="text" />
                    <Fld value={e.age} onChange={v=>setNested("bigExpenses",e.id,"age",v)} pre="Age" />
                    <Fld value={e.amount} onChange={v=>setNested("bigExpenses",e.id,"amount",v)} />
                    <Btn small onClick={()=>setInp(p=>({...p,bigExpenses:p.bigExpenses.filter(x=>x.id!==e.id)}))} color={C.bad}>×</Btn>
                  </div>
                ))}
                {inp.bigExpenses.length===0 && <div style={{color:C.muted,fontSize:11}}>Add renovations, travel, uni fees, car purchase, etc.</div>}
              </Card>
            </div>
          </>
        )}

        {/* ═══ HEALTHCARE ═══ */}
        {tab === "healthcare" && (
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
            <Card title="Healthcare Expenses" icon="🏥" color={C.health}>
              <Fld label="Annual Healthcare Cost (from age 65)" value={inp.healthcareExpenses} onChange={set("healthcareExpenses")} note="Private health, dental, specialists, physio, meds" />
              <Fld label="Aged Care Start Age" value={inp.agedCareAge} onChange={set("agedCareAge")} pre="" suf="yrs" note="Avg Australian entry ~85" />
              <Fld label="Annual Aged Care Cost" value={inp.agedCareCost} onChange={set("agedCareCost")} note="Residential: $40k–80k p.a. depending on RAD/facility" />
              <div style={{ background:C.bg, borderRadius:8, padding:10, fontSize:10, color:C.muted, lineHeight:1.7, marginTop:8 }}>
                <strong style={{color:C.health}}>Australian Aged Care (2024):</strong><br/>
                RAD average: ~$550,000 · DAP: daily accommodation payment<br/>
                Basic daily care fee: ~$63/day (~$23k/yr)<br/>
                Means-tested care fee: up to ~$34k/yr<br/>
                Lifetime cap: ~$80,100 (indexed)
              </div>
            </Card>
            <Card title="Healthcare Cost Projection" icon="📈" color={C.health}>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={proj.filter(d=>d.age>=60&&d.age%2===0)}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="age" stroke={C.muted} tick={{fontSize:10}} />
                  <YAxis stroke={C.muted} tick={{fontSize:10}} tickFormatter={v=>`$${(v/1000).toFixed(0)}k`} />
                  <Tooltip content={<TT />} />
                  <Bar dataKey="healthExp" name="Healthcare + Aged Care" fill={C.health} radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </div>
        )}

        {/* ═══ RATES & SCENARIOS ═══ */}
        {tab === "rates" && (
          <>
            <Card title="Base Return & Rate Assumptions" icon="📐" color={C.main}>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:16 }}>
                <Sld label="Portfolio Return Rate" value={inp.returnRate*100} min={1} max={15} step={0.25} onChange={v=>set("returnRate")(v/100)} fmt2={v=>`${v.toFixed(2)}%`} color={C.main} note="Balanced ~7.5% | Growth ~9% | Conservative ~5%" />
                <Sld label="CPI / Inflation Rate" value={inp.inflationRate*100} min={0.5} max={10} step={0.25} onChange={v=>set("inflationRate")(v/100)} fmt2={v=>`${v.toFixed(2)}%`} color={C.warn} note="RBA target 2–3%. Expenses grow at this rate." />
                <Sld label="Property Growth Rate" value={inp.propertyGrowthRate*100} min={0} max={10} step={0.25} onChange={v=>set("propertyGrowthRate")(v/100)} fmt2={v=>`${v.toFixed(2)}%`} color={C.prop} note="CoreLogic long-run avg ~4% nationally" />
              </div>
            </Card>

            <Card title="Rate Glide Path — Change Return at Specific Ages" icon="🗓️" color={C.main}
              action={<Btn onClick={addRatePoint} color={C.main}>+ Add Rate Change</Btn>}>
              <div style={{ fontSize:11, color:C.muted, marginBottom:10 }}>Model lifecycle investing: growth when young → conservative near retirement.</div>
              {inp.rateSchedule.map(s=>(
                <div key={s.id} style={{ display:"flex", gap:8, marginBottom:8, alignItems:"center" }}>
                  <span style={{ fontSize:11, color:C.muted, whiteSpace:"nowrap" }}>From age</span>
                  <Fld value={s.age} onChange={v=>setNested("rateSchedule",s.id,"age",v)} pre="" suf="→" />
                  <Fld value={s.rate} onChange={v=>setNested("rateSchedule",s.id,"rate",v)} pre="" suf="% return" />
                  <Btn small onClick={()=>setInp(p=>({...p,rateSchedule:p.rateSchedule.filter(x=>x.id!==s.id)}))} color={C.bad}>Remove</Btn>
                </div>
              ))}
              {inp.rateSchedule.length===0 && <div style={{color:C.muted,fontSize:11}}>No rate changes. Example: Age 60 → 7%, Age 65 → 5.5%</div>}
            </Card>

            {/* ── 3-Scenario Comparison ── */}
            <Card title="Scenario Comparison — Up to 3 Custom What-Ifs" icon="🔀" color={C.warn}>
              <div style={{ fontSize:11, color:C.muted, marginBottom:16 }}>
                Compare your Base plan against up to 3 alternative scenarios. Base is locked to your current inputs.
              </div>

              {/* ── Side-by-side scenario cards ── */}
              <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12, marginBottom:20 }}>

                {/* BASE CARD — read only */}
                <div style={{ background:"white", border:`2px solid ${C.main}`, borderRadius:12, overflow:"hidden" }}>
                  <div style={{ background:C.main, padding:"8px 12px", color:"white", fontWeight:800, fontSize:11, textAlign:"center" }}>
                    📊 Base Plan
                  </div>
                  <div style={{ padding:"10px 12px" }}>
                    {[
                      { label:"Retirement Age",     val:`Age ${inp.retirementAge}` },
                      { label:"Super Balance",       val:aud(inp.superBalance) },
                      { label:"Retire Expenses",     val:aud(inp.retirementExpenses) },
                      { label:"Property Growth",     val:`${(inp.propertyGrowthRate*100).toFixed(1)}%` },
                      { label:"Asset Returns",       val:`${(inp.returnRate*100).toFixed(1)}%` },
                    ].map(row=>(
                      <div key={row.label} style={{ marginBottom:10 }}>
                        <div style={{ fontSize:9, color:C.muted, fontWeight:700, textTransform:"uppercase", marginBottom:2 }}>{row.label}</div>
                        <div style={{ fontSize:14, fontWeight:900, color:C.main, fontFamily:"monospace" }}>{row.val}</div>
                        <div style={{ height:4, background:`${C.main}22`, borderRadius:2, marginTop:4 }}>
                          <div style={{ height:4, width:"100%", background:`${C.main}44`, borderRadius:2 }} />
                        </div>
                      </div>
                    ))}
                    <div style={{ marginTop:8, padding:"6px 8px", background:`${C.main}10`, borderRadius:8, fontSize:10, color:C.main, fontWeight:700, textAlign:"center" }}>
                      🔒 Locked to Personal tab
                    </div>
                  </div>
                </div>

                {/* SCENARIO CARDS — editable */}
                {scenarios.map(s=>(
                  <div key={s.id} style={{ background:"white", border:`2px solid ${s.active?s.color:C.border}`,
                    borderRadius:12, overflow:"hidden", opacity:s.active?1:0.6 }}>
                    <div style={{ background:s.active?s.color:"#e2e8f0", padding:"6px 12px",
                      display:"flex", alignItems:"center", gap:6 }}>
                      <input type="checkbox" checked={s.active}
                        onChange={e=>setScenarios(prev=>prev.map(x=>x.id===s.id?{...x,active:e.target.checked}:x))}
                        style={{ accentColor:"white", cursor:"pointer" }} />
                      <input value={s.name}
                        onChange={e=>setScenarios(prev=>prev.map(x=>x.id===s.id?{...x,name:e.target.value}:x))}
                        style={{ flex:1, background:"transparent", border:"none", color:"white",
                          fontWeight:800, fontSize:10, outline:"none", cursor:"text" }} />
                    </div>
                    <div style={{ padding:"10px 12px" }}>
                      {[
                        { label:"Retirement Age", field:"retirementAge",
                          fmt:v=>`Age ${v}`, min:45, max:75, step:1, isInt:true },
                        { label:"Super Balance", field:"superBalance",
                          fmt:v=>aud(v??inp.superBalance), min:0, max:2000000, step:10000, isInt:false },
                        { label:"Retire Expenses", field:"retirementExpenses",
                          fmt:v=>aud(v), min:20000, max:200000, step:1000, isInt:false },
                        { label:"Property Growth", field:"propertyGrowthRate",
                          fmt:v=>`${(v*100).toFixed(1)}%`, min:0, max:0.12, step:0.005, isInt:false },
                        { label:"Asset Returns", field:"returnRate",
                          fmt:v=>`${(v*100).toFixed(1)}%`, min:0.01, max:0.15, step:0.005, isInt:false },
                      ].map(row=>{
                        const val = s[row.field] ?? (row.field==="superBalance"?inp.superBalance:row.field==="propertyGrowthRate"?inp.propertyGrowthRate:row.field==="returnRate"?inp.returnRate:row.field==="retirementExpenses"?inp.retirementExpenses:inp.retirementAge);
                        return (
                          <div key={row.label} style={{ marginBottom:10 }}>
                            <div style={{ fontSize:9, color:C.muted, fontWeight:700, textTransform:"uppercase", marginBottom:2 }}>{row.label}</div>
                            <div style={{ fontSize:13, fontWeight:900, color:s.active?s.color:C.muted, fontFamily:"monospace" }}>{row.fmt(val)}</div>
                            <input type="range" min={row.min} max={row.max} step={row.step}
                              value={val} disabled={!s.active}
                              onChange={e=>{
                                const v = row.isInt?parseInt(e.target.value):parseFloat(e.target.value);
                                setScenarios(prev=>prev.map(x=>x.id===s.id?{...x,[row.field]:v}:x));
                              }}
                              style={{ width:"100%", accentColor:s.color, cursor:s.active?"pointer":"not-allowed", marginTop:2 }} />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              {/* ── Comparison chart ── */}
              <div style={{ marginTop:20 }}>
                <div style={{ fontSize:11, fontWeight:800, color:C.text, marginBottom:8 }}>
                  📈 Net Worth Projection — All Scenarios
                </div>
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                    <XAxis dataKey="age" type="number"
                      domain={[inp.currentAge, inp.lifeExpectancy]}
                      stroke={C.muted} tick={{fontSize:10}} />
                    <YAxis stroke={C.muted} tick={{fontSize:10}}
                      tickFormatter={v=>`$${(v/1e6).toFixed(1)}M`} />
                    <Tooltip content={<TT />} />
                    <Legend wrapperStyle={{fontSize:10}} />
                    <ReferenceLine x={inp.retirementAge} stroke={C.main}
                      strokeDasharray="4 2" label={{value:"Base Retire",fontSize:8,fill:C.main}} />
                    <Line data={proj.filter(cf)} type="monotone" dataKey="netWorth"
                      name={`📊 Base (Retire ${inp.retirementAge})`}
                      stroke={C.main} strokeWidth={3} dot={false} />
                    {scenarioProjs.filter(s=>s.active && s.proj.length>0).map(s=>(
                      <Line key={s.id} data={s.proj.filter(cf)} type="monotone" dataKey="netWorth"
                        name={s.name} stroke={s.color} strokeWidth={2}
                        strokeDasharray="5 3" dot={false} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* ── Summary comparison table ── */}
              <div style={{ marginTop:16 }}>
                <div style={{ fontSize:11, fontWeight:800, color:C.text, marginBottom:8 }}>
                  📋 Key Outcomes at a Glance
                </div>
                <div style={{ overflowX:"auto" }}>
                  <table style={{ width:"100%", borderCollapse:"collapse", fontSize:10 }}>
                    <thead>
                      <tr style={{ background:"#f8fafc" }}>
                        {["Metric", "Base", ...scenarios.map(s=>s.name)].map((h,i)=>(
                          <th key={i} style={{ padding:"6px 10px", textAlign:"right",
                            color: i===0?C.muted : i===1?C.main : scenarios[i-2].color,
                            fontWeight:800, fontSize:9, textTransform:"uppercase",
                            borderBottom:`2px solid ${i===0?C.border:i===1?C.main:scenarios[i-2].color}` }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { label:"Net Worth at Retirement",
                          fn:(p,s) => aud(p.find(d=>d.age===(s?.retirementAge??inp.retirementAge))?.netWorth||0) },
                        { label:"Net Worth at Age 75",
                          fn:(p) => aud(p.find(d=>d.age===75)?.netWorth||0) },
                        { label:"Estate at Age 90",
                          fn:(p) => aud(p[p.length-1]?.netWorth||0) },
                        { label:"Super at Retirement",
                          fn:(p,s) => aud((p.find(d=>d.age===(s?.retirementAge??inp.retirementAge))?.super||0)+(p.find(d=>d.age===(s?.retirementAge??inp.retirementAge))?.superPension||0)) },
                        { label:"Peak Age Pension/yr",
                          fn:(p) => aud(Math.max(...p.map(d=>d.agePension||0))) },
                        { label:"Total Retirement Income (20yr)",
                          fn:(p,s) => {
                            const retAge = s?.retirementAge ?? inp.retirementAge;
                            const slice = p.filter(d=>d.age>=retAge && d.age<retAge+20);
                            return aud(slice.reduce((sum,d)=>sum+(d.income||0),0));
                          }},
                      ].map(row=>(
                        <tr key={row.label} style={{ borderBottom:`1px solid ${C.border}22` }}>
                          <td style={{ padding:"5px 10px", color:C.muted, fontWeight:700 }}>{row.label}</td>
                          <td style={{ padding:"5px 10px", textAlign:"right", color:C.main, fontWeight:700 }}>
                            {row.fn(proj, null)}
                          </td>
                          {scenarioProjs.map(s=>(
                            <td key={s.id} style={{ padding:"5px 10px", textAlign:"right",
                              color: s.active ? s.color : C.muted,
                              fontWeight: s.active ? 700 : 400,
                              opacity: s.active ? 1 : 0.4 }}>
                              {s.active ? row.fn(s.proj, s) : "—"}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* ── Best scenario callout ── */}
              {(() => {
                const active = scenarioProjs.filter(s=>s.active && s.proj.length>0);
                if (active.length === 0) return null;
                const baseEstate = proj[proj.length-1]?.netWorth || 0;
                const all = [
                  { name:`Base (Retire ${inp.retirementAge})`, color:C.main, val:baseEstate },
                  ...active.map(s=>({ name:s.name, color:s.color, val:s.proj[s.proj.length-1]?.netWorth||0 }))
                ];
                const best = all.reduce((a,b)=>a.val>b.val?a:b);
                const worst = all.reduce((a,b)=>a.val<b.val?a:b);
                return (
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginTop:14 }}>
                    <div style={{ background:`${C.ok}12`, border:`1px solid ${C.ok}44`,
                      borderRadius:10, padding:"10px 14px" }}>
                      <div style={{ fontSize:10, color:C.ok, fontWeight:800, marginBottom:3 }}>
                        🏆 Best Estate Outcome
                      </div>
                      <div style={{ fontSize:16, fontWeight:900, color:best.color, fontFamily:"monospace" }}>
                        {best.name}
                      </div>
                      <div style={{ fontSize:12, color:C.ok, fontWeight:700 }}>{aud(best.val)} at age 90</div>
                    </div>
                    <div style={{ background:`${C.bad}12`, border:`1px solid ${C.bad}44`,
                      borderRadius:10, padding:"10px 14px" }}>
                      <div style={{ fontSize:10, color:C.bad, fontWeight:800, marginBottom:3 }}>
                        ⚠️ Lowest Estate Outcome
                      </div>
                      <div style={{ fontSize:16, fontWeight:900, color:worst.color, fontFamily:"monospace" }}>
                        {worst.name}
                      </div>
                      <div style={{ fontSize:12, color:C.bad, fontWeight:700 }}>{aud(worst.val)} at age 90</div>
                    </div>
                  </div>
                );
              })()}
            </Card>
          </>
        )}

{/* ═══ SANKEY COMPONENT ═══ */}
        {/* ═══ CASH FLOW ═══ */}
        {/* ═══ CASH FLOW ═══ */}
        {tab === "cashflow" && (() => {

          // ── derived totals for KPI row ──
          const retRow   = proj.find(d => d.age === inp.retirementAge) || {};
          const nowRow   = proj[0] || {};
          const peakSurp = Math.max(...proj.map(d => d.surplus || 0));
          const defYears = proj.filter(d => (d.surplus || 0) < 0).length;

          return (
            <>
              {/* ── KPI summary ── */}
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))", gap:8, marginBottom:14 }}>
                {[
                  { label:"Current Annual Income",  val:aud(nowRow.income),    color:C.ok   },
                  { label:"Current Annual Expenses", val:aud(nowRow.expenses),  color:C.bad  },
                  { label:"Current Surplus",         val:aud(nowRow.surplus),   color:(nowRow.surplus||0)>=0?C.ok:C.bad },
                  { label:"Income at Retirement",    val:aud(retRow.income),    color:C.super },
                  { label:"Expenses at Retirement",  val:aud(retRow.expenses),  color:C.bad  },
                  { label:"Deficit Years",           val:defYears,              color:defYears>0?C.bad:C.ok, sub:"years where expenses > income" },
                ].map(m=>(
                  <div key={m.label} style={{ background:"white", borderRadius:10,
                    border:`1.5px solid ${m.color}22`, padding:"10px 12px" }}>
                    <div style={{ fontSize:9, color:C.muted, textTransform:"uppercase",
                      letterSpacing:"0.06em", fontWeight:700, marginBottom:3 }}>{m.label}</div>
                    <div style={{ fontSize:18, fontWeight:900, color:m.color,
                      fontFamily:"monospace" }}>{m.val}</div>
                    {m.sub && <div style={{ fontSize:9, color:C.muted, marginTop:2 }}>{m.sub}</div>}
                  </div>
                ))}
              </div>

{/* ── Cash Flow Sankey ── */}
              <Card title="Cash Flow Sankey — Where Does Your Money Go?" icon="🌊" color={C.main}>
                {/* Toggle */}
                <div style={{ display:"flex", gap:0, border:`1px solid ${C.border}`,
                  borderRadius:8, overflow:"hidden", marginBottom:14, width:"fit-content" }}>
                  {[["simple","Simple"],["detailed","Detailed"]].map(([m,l])=>(
                    <button key={m} onClick={()=>setSankeyMode(m)}
                      style={{ padding:"5px 18px", background:sankeyMode===m?C.main:C.card,
                        color:sankeyMode===m?"white":C.muted, border:"none",
                        fontSize:11, fontWeight:800, cursor:"pointer" }}>{l}</button>
                  ))}
                </div>

                {(() => {
                  const row = proj[0] || {};
                  const salary   = row.salaryIncome   || inp.annualIncome || 0;
                  const rental   = row.rentalIncome   || 0;
                  const divs     = row.dividendIncome || 0;
                  const td       = row.tdInterest     || 0;
                  const other    = inp.otherIncome    || 0;
                  const totalInc = salary + rental + divs + td + other;
                  const tax      = calcNetTax(salary);
                  const superC   = sgAmount + (inp.voluntarySuper||0);
                  const expenses = row.expenses || inp.annualExpenses || 0;
                  const savings  = Math.max(0, totalInc - tax - superC - expenses);

                  if (sankeyMode === "simple") {
                    const nodes = [
                      // Col 0 — income sources
                      ...(salary>0  ? [{ id:"sal", label:"Salary",    value:salary,  col:0, color:C.main    }] : []),
                      ...(rental>0  ? [{ id:"ren", label:"Rental",    value:rental,  col:0, color:C.prop    }] : []),
                      ...(divs>0    ? [{ id:"div", label:"Dividends", value:divs,    col:0, color:C.outside }] : []),
                      ...(td>0      ? [{ id:"tdi", label:"TD Int.",   value:td,      col:0, color:"#0284c7" }] : []),
                      ...(other>0   ? [{ id:"oth", label:"Other",     value:other,   col:0, color:C.muted   }] : []),
                      // Col 1 — total
                      { id:"tot", label:"Total Income", value:totalInc, col:1, color:C.text },
                      // Col 2 — outflows
                      ...(tax>0    ? [{ id:"tax", label:"Tax",        value:tax,     col:2, color:C.bad     }] : []),
                      ...(superC>0 ? [{ id:"sup", label:"Super",      value:superC,  col:2, color:C.super   }] : []),
                      { id:"exp",   label:"Expenses",   value:expenses,              col:2, color:"#f97316" },
                      ...(savings>0? [{ id:"sav", label:"Savings",    value:savings, col:2, color:C.ok      }] : []),
                    ];
                    const links = [
                      ...(salary>0  ? [{ source:"sal", target:"tot", value:salary,  color:C.main    }] : []),
                      ...(rental>0  ? [{ source:"ren", target:"tot", value:rental,  color:C.prop    }] : []),
                      ...(divs>0    ? [{ source:"div", target:"tot", value:divs,    color:C.outside }] : []),
                      ...(td>0      ? [{ source:"tdi", target:"tot", value:td,      color:"#0284c7" }] : []),
                      ...(other>0   ? [{ source:"oth", target:"tot", value:other,   color:C.muted   }] : []),
                      ...(tax>0    ? [{ source:"tot", target:"tax",  value:tax,     color:C.bad     }] : []),
                      ...(superC>0 ? [{ source:"tot", target:"sup",  value:superC,  color:C.super   }] : []),
                      { source:"tot", target:"exp", value:expenses,                  color:"#f97316" },
                      ...(savings>0? [{ source:"tot", target:"sav",  value:savings, color:C.ok      }] : []),
                    ];
                    return <SankeyChart nodes={nodes} links={links} width={680} height={320} />;
                  }

                  // Detailed — break expenses into spending categories
                  const cats = spendCategories.filter(c=>c.preCurrent>0);
                  const catTotal = cats.reduce((s,c)=>s+c.preCurrent,0)||1;
                  const scaleFactor = expenses / catTotal;

                  const nodes = [
                    ...(salary>0  ? [{ id:"sal", label:"Salary",    value:salary,  col:0, color:C.main    }] : []),
                    ...(rental>0  ? [{ id:"ren", label:"Rental",    value:rental,  col:0, color:C.prop    }] : []),
                    ...(divs>0    ? [{ id:"div", label:"Dividends", value:divs,    col:0, color:C.outside }] : []),
                    ...(td>0      ? [{ id:"tdi", label:"TD Int.",   value:td,      col:0, color:"#0284c7" }] : []),
                    ...(other>0   ? [{ id:"oth", label:"Other",     value:other,   col:0, color:C.muted   }] : []),
                    { id:"tot",   label:"Total Income", value:totalInc,              col:1, color:C.text   },
                    ...(tax>0    ? [{ id:"tax", label:"Tax",        value:tax,     col:2, color:C.bad     }] : []),
                    ...(superC>0 ? [{ id:"sup", label:"Super",      value:superC,  col:2, color:C.super   }] : []),
                    { id:"expb",  label:"Expenses",     value:expenses,              col:2, color:"#f97316"},
                    ...(savings>0? [{ id:"sav", label:"Savings",    value:savings, col:2, color:C.ok      }] : []),
                    ...cats.map(c => ({
                      id:`cat_${c.id}`, label:c.label, col:3,
                      value:Math.round(c.preCurrent * scaleFactor),
                      color:c.color,
                    })),
                  ];
                  const links = [
                    ...(salary>0  ? [{ source:"sal", target:"tot", value:salary,  color:C.main    }] : []),
                    ...(rental>0  ? [{ source:"ren", target:"tot", value:rental,  color:C.prop    }] : []),
                    ...(divs>0    ? [{ source:"div", target:"tot", value:divs,    color:C.outside }] : []),
                    ...(td>0      ? [{ source:"tdi", target:"tot", value:td,      color:"#0284c7" }] : []),
                    ...(other>0   ? [{ source:"oth", target:"tot", value:other,   color:C.muted   }] : []),
                    ...(tax>0    ? [{ source:"tot", target:"tax",  value:tax,     color:C.bad     }] : []),
                    ...(superC>0 ? [{ source:"tot", target:"sup",  value:superC,  color:C.super   }] : []),
                    { source:"tot", target:"expb", value:expenses,                  color:"#f97316"},
                    ...(savings>0? [{ source:"tot", target:"sav",  value:savings, color:C.ok      }] : []),
                    ...cats.map(c => ({
                      source:"expb", target:`cat_${c.id}`,
                      value:Math.round(c.preCurrent * scaleFactor),
                      color:c.color,
                    })),
                  ];
                  return <SankeyChart nodes={nodes} links={links} width={820} height={380} />;
                })()}
              </Card>                                
              {/* ── Income vs Expenses chart ── */}
              <Card title="Annual Cash Flow — Income vs Expenses" icon="💰" color={C.ok}>
                <ResponsiveContainer width="100%" height={280}>
                  <ComposedChart data={proj.filter(cf)}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                    <XAxis dataKey="age" stroke={C.muted} tick={{fontSize:10}} />
                    <YAxis stroke={C.muted} tick={{fontSize:10}}
                      tickFormatter={v=>`$${(v/1000).toFixed(0)}k`} />
                    <Tooltip content={<TT />} />
                    <Legend wrapperStyle={{fontSize:10}} />
                    <ReferenceLine x={inp.retirementAge} stroke="#a78bfa"
                      strokeDasharray="4 2" label={{value:"Retire",fontSize:9,fill:"#a78bfa"}} />
                    <ReferenceLine x={67} stroke={C.pension}
                      strokeDasharray="4 2" label={{value:"Pension",fontSize:9,fill:C.pension}} />
                    <Bar dataKey="salaryIncome"  name="Salary"        fill={C.main}    stackId="inc" />
                    <Bar dataKey="rentalIncome"  name="Rental Income" fill={C.prop}    stackId="inc" />
                    <Bar dataKey="dividendIncome" name="Dividends"    fill={C.outside} stackId="inc" />
                    <Bar dataKey="tdInterest"    name="TD Interest"   fill="#0284c7"   stackId="inc" />
                    <Bar dataKey="agePension"    name="Age Pension"   fill={C.pension} stackId="inc" />
                    <Bar dataKey="offsetBenefit" name="Offset Saving" fill={C.ok}      stackId="inc" />
                    <Line type="monotone" dataKey="expenses" name="Total Expenses"
                      stroke={C.bad} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="income" name="Total Income"
                      stroke={C.ok} strokeWidth={2.5} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </Card>

              {/* ── Surplus/Deficit chart ── */}
              <Card title="Annual Surplus / Deficit" icon="📊" color={C.super}>
                <div style={{ fontSize:11, color:C.muted, marginBottom:8 }}>
                  Green = surplus (income exceeds expenses) · Red = deficit (drawing down capital)
                </div>
                <ResponsiveContainer width="100%" height={200}>
                  <ComposedChart data={proj.filter(cf)}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                    <XAxis dataKey="age" stroke={C.muted} tick={{fontSize:10}} />
                    <YAxis stroke={C.muted} tick={{fontSize:10}}
                      tickFormatter={v=>`$${(v/1000).toFixed(0)}k`} />
                    <Tooltip content={<TT />} />
                    <ReferenceLine y={0} stroke={C.border} strokeWidth={2} />
                    <ReferenceLine x={inp.retirementAge} stroke="#a78bfa" strokeDasharray="4 2" />
                    <Bar dataKey="surplus" name="Surplus / Deficit"
                      fill={C.ok}
                      cell={undefined}
                      isAnimationActive={false}>
                      {proj.filter(cf).map((d, i) => (
                        <Cell key={i} fill={(d.surplus||0) >= 0 ? C.ok : C.bad} />
                      ))}
                    </Bar>
                  </ComposedChart>
                </ResponsiveContainer>
              </Card>

              {/* ── Income breakdown chart ── */}
              <Card title="Income Sources Breakdown" icon="📈" color={C.main}>
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={proj.filter(cf)}>
                    <defs>
                      {[["sal",C.main],["rent",C.prop],["div",C.outside],["td","#0284c7"],
                        ["pen",C.pension],["off",C.ok]].map(([id,color])=>(
                        <linearGradient key={id} id={`cf_${id}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor={color} stopOpacity={0.5}/>
                          <stop offset="95%" stopColor={color} stopOpacity={0.05}/>
                        </linearGradient>
                      ))}
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                    <XAxis dataKey="age" stroke={C.muted} tick={{fontSize:10}} />
                    <YAxis stroke={C.muted} tick={{fontSize:10}}
                      tickFormatter={v=>`$${(v/1000).toFixed(0)}k`} />
                    <Tooltip content={<TT />} />
                    <Legend wrapperStyle={{fontSize:10}} />
                    <ReferenceLine x={inp.retirementAge} stroke="#a78bfa" strokeDasharray="4 2" />
                    <Area type="monotone" dataKey="salaryIncome"   name="Salary"        stroke={C.main}    fill="url(#cf_sal)"  stackId="s" />
                    <Area type="monotone" dataKey="rentalIncome"   name="Rental"        stroke={C.prop}    fill="url(#cf_rent)" stackId="s" />
                    <Area type="monotone" dataKey="dividendIncome" name="Dividends"     stroke={C.outside} fill="url(#cf_div)"  stackId="s" />
                    <Area type="monotone" dataKey="tdInterest"     name="TD Interest"   stroke="#0284c7"   fill="url(#cf_td)"   stackId="s" />
                    <Area type="monotone" dataKey="agePension"     name="Age Pension"   stroke={C.pension} fill="url(#cf_pen)"  stackId="s" />
                    <Area type="monotone" dataKey="offsetBenefit"  name="Offset Saving" stroke={C.ok}      fill="url(#cf_off)"  stackId="s" />
                  </AreaChart>
                </ResponsiveContainer>
              </Card>

              {/* ── Detailed table with surplus column ── */}
              <Card title="Year-by-Year Cash Flow Table" icon="📋" color={C.ok}
                action={
                  <div style={{ fontSize:10, color:C.muted }}>
                    🟩 Surplus &nbsp;🟥 Deficit
                  </div>
                }>
                <div style={{ overflowX:"auto" }}>
                  <table style={{ width:"100%", borderCollapse:"collapse", fontSize:10 }}>
                    <thead>
                      <tr style={{ borderBottom:`2px solid ${C.border}`, background:"#f8fafc" }}>
                        {["Age","Year","Salary","Rental","Dividends","TD Int.","Age Pension","Offset $","Total Income","Expenses","Health","Surplus / Deficit","Super Bal","Net Worth"].map(h=>(
                          <th key={h} style={{ padding:"5px 7px", color:C.muted,
                            textAlign:"right", fontWeight:700, fontSize:9,
                            textTransform:"uppercase", whiteSpace:"nowrap" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {proj.filter(d=>d.age%5===0).map(d=>{
                        const surp = d.surplus || 0;
                        return (
                          <tr key={d.age} style={{
                            borderBottom:`1px solid ${C.border}22`,
                            background: d.age===inp.retirementAge?"#eff6ff"
                              : d.age===67?"#f5f3ff":"transparent"
                          }}>
                            <td style={{ padding:"5px 7px", textAlign:"right", fontWeight:700,
                              color:d.age===inp.retirementAge?C.super:d.age===67?C.pension:C.muted }}>
                              {d.age}
                            </td>
                            <td style={{ padding:"5px 7px", textAlign:"right", color:C.muted }}>{d.year}</td>
                            <td style={{ padding:"5px 7px", textAlign:"right", color:C.main }}>{aud(d.salaryIncome||0)}</td>
                            <td style={{ padding:"5px 7px", textAlign:"right", color:C.prop }}>{aud(d.rentalIncome||0)}</td>
                            <td style={{ padding:"5px 7px", textAlign:"right", color:C.outside }}>{aud(d.dividendIncome||0)}</td>
                            <td style={{ padding:"5px 7px", textAlign:"right", color:"#0284c7" }}>{aud(d.tdInterest||0)}</td>
                            <td style={{ padding:"5px 7px", textAlign:"right", color:C.pension }}>{aud(d.agePension||0)}</td>
                            <td style={{ padding:"5px 7px", textAlign:"right", color:C.ok }}>{aud(d.offsetBenefit||0)}</td>
                            <td style={{ padding:"5px 7px", textAlign:"right", fontWeight:700, color:C.ok }}>{aud(d.income||0)}</td>
                            <td style={{ padding:"5px 7px", textAlign:"right", color:C.bad }}>{aud(d.expenses||0)}</td>
                            <td style={{ padding:"5px 7px", textAlign:"right", color:C.health }}>{aud(d.healthExp||0)}</td>
                            <td style={{ padding:"5px 7px", textAlign:"right", fontWeight:800,
                              color: surp>=0?C.ok:C.bad,
                              background: surp>=0?"#f0fdf422":"#fef2f222",
                              borderRadius:4 }}>
                              {surp>=0?"+" : ""}{aud(surp)}
                            </td>
                            <td style={{ padding:"5px 7px", textAlign:"right", color:C.super }}>{aud((d.super||0)+(d.superPension||0))}</td>
                            <td style={{ padding:"5px 7px", textAlign:"right", fontWeight:700, color:C.main }}>{aud(d.netWorth||0)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div style={{ fontSize:9, color:C.muted, marginTop:8, lineHeight:1.6 }}>
                  🟦 Retirement age &nbsp;🟣 Age Pension age (67) &nbsp;
                  Surplus = Total Income − Total Expenses &nbsp;·&nbsp;
                  Deficit years draw from super / outside-super capital &nbsp;·&nbsp;
                  General information only (ASIC RG 244)
                </div>
              </Card>

             {/* ── Spending Planner ── */}
              <div style={{ background:"white", border:`1.5px solid ${C.warn}44`,
                borderRadius:12, overflow:"hidden", marginBottom:4 }}>

                {/* ── Header — always visible, click to expand ── */}
                <div onClick={()=>setSpendOpen(o=>!o)}
                  style={{ padding:"12px 16px", cursor:"pointer",
                    display:"flex", alignItems:"center", gap:10,
                    background: spendOpen ? `${C.warn}12` : "white",
                    borderBottom: spendOpen ? `1px solid ${C.warn}33` : "none" }}>
                  <span style={{ fontSize:18 }}>📊</span>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:12, fontWeight:900, color:C.warn }}>
                      Spending Planner
                      <span style={{ fontSize:10, fontWeight:400, color:C.muted, marginLeft:8 }}>
                        — optional detail, collapse when not needed
                      </span>
                    </div>
                    <div style={{ fontSize:10, color:C.muted, marginTop:1 }}>
                      Pre-retirement total: <strong style={{color:C.bad}}>{aud(spendCategories.reduce((s,c)=>s+c.preCurrent,0))}</strong>
                      &nbsp;·&nbsp;
                      Retirement total: <strong style={{color:C.bad}}>{aud(spendCategories.reduce((s,c)=>s+c.preRetire,0))}</strong>
                      &nbsp;·&nbsp;
                      ASFA Comfortable: <strong style={{color:C.ok}}>{aud(72663)}</strong>
                    </div>
                  </div>
                  <span style={{ fontSize:16, color:C.warn, fontWeight:900 }}>
                    {spendOpen ? "▲" : "▼"}
                  </span>
                </div>

                {/* ── Expandable content ── */}
                {spendOpen && (
                  <div style={{ padding:"14px 16px" }}>

                    {/* ── Category sliders ── */}
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:16 }}>
                      {spendCategories.map(cat=>{
                        const preTotal  = spendCategories.reduce((s,c)=>s+c.preCurrent,0);
                        const retTotal  = spendCategories.reduce((s,c)=>s+c.preRetire,0);
                        return (
                          <div key={cat.id} style={{ background:"#f8fafc",
                            border:`1px solid ${cat.color}33`, borderRadius:10,
                            padding:"10px 12px" }}>
                            <div style={{ display:"flex", alignItems:"center",
                              gap:6, marginBottom:8 }}>
                              <span style={{ fontSize:16 }}>{cat.icon}</span>
                              <span style={{ fontSize:11, fontWeight:800,
                                color:cat.color }}>{cat.label}</span>
                            </div>
                            {/* Pre-retirement */}
                            <div style={{ marginBottom:8 }}>
                              <div style={{ display:"flex", justifyContent:"space-between",
                                fontSize:9, color:C.muted, marginBottom:2 }}>
                                <span>Pre-Retirement</span>
                                <strong style={{color:cat.color}}>{aud(cat.preCurrent)}</strong>
                              </div>
                              <input type="range" min={0} max={50000} step={500}
                                value={cat.preCurrent}
                                onChange={e=>setSpendCategories(prev=>prev.map(c=>
                                  c.id===cat.id?{...c,preCurrent:parseInt(e.target.value)}:c))}
                                style={{ width:"100%", accentColor:cat.color }} />
                            </div>
                            {/* Retirement */}
                            <div>
                              <div style={{ display:"flex", justifyContent:"space-between",
                                fontSize:9, color:C.muted, marginBottom:2 }}>
                                <span>In Retirement</span>
                                <strong style={{color:cat.color}}>{aud(cat.preRetire)}</strong>
                              </div>
                              <input type="range" min={0} max={50000} step={500}
                                value={cat.preRetire}
                                onChange={e=>setSpendCategories(prev=>prev.map(c=>
                                  c.id===cat.id?{...c,preRetire:parseInt(e.target.value)}:c))}
                                style={{ width:"100%", accentColor:cat.color }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* ── Donut-style breakdown ── */}
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:14 }}>

                      {/* Pre-retirement breakdown */}
                      <div>
                        <div style={{ fontSize:11, fontWeight:800, color:C.text, marginBottom:8 }}>
                          Pre-Retirement Spending
                        </div>
                        {spendCategories.map(cat=>{
                          const total = spendCategories.reduce((s,c)=>s+c.preCurrent,0)||1;
                          const pct2  = Math.round(cat.preCurrent/total*100);
                          return (
                            <div key={cat.id} style={{ marginBottom:6 }}>
                              <div style={{ display:"flex", justifyContent:"space-between",
                                fontSize:10, marginBottom:2 }}>
                                <span style={{ color:C.muted }}>{cat.icon} {cat.label}</span>
                                <span style={{ fontWeight:700, color:cat.color }}>
                                  {aud(cat.preCurrent)} ({pct2}%)
                                </span>
                              </div>
                              <div style={{ height:6, background:`${cat.color}22`, borderRadius:3 }}>
                                <div style={{ height:6, width:`${pct2}%`,
                                  background:cat.color, borderRadius:3 }} />
                              </div>
                            </div>
                          );
                        })}
                        <div style={{ marginTop:8, padding:"6px 10px",
                          background:`${C.bad}10`, borderRadius:8,
                          display:"flex", justifyContent:"space-between", fontSize:11 }}>
                          <span style={{ color:C.muted, fontWeight:700 }}>Total</span>
                          <span style={{ fontWeight:900, color:C.bad }}>
                            {aud(spendCategories.reduce((s,c)=>s+c.preCurrent,0))}
                          </span>
                        </div>
                      </div>

                      {/* Retirement breakdown */}
                      <div>
                        <div style={{ fontSize:11, fontWeight:800, color:C.text, marginBottom:8 }}>
                          Retirement Spending
                        </div>
                        {spendCategories.map(cat=>{
                          const total = spendCategories.reduce((s,c)=>s+c.preRetire,0)||1;
                          const pct2  = Math.round(cat.preRetire/total*100);
                          return (
                            <div key={cat.id} style={{ marginBottom:6 }}>
                              <div style={{ display:"flex", justifyContent:"space-between",
                                fontSize:10, marginBottom:2 }}>
                                <span style={{ color:C.muted }}>{cat.icon} {cat.label}</span>
                                <span style={{ fontWeight:700, color:cat.color }}>
                                  {aud(cat.preRetire)} ({pct2}%)
                                </span>
                              </div>
                              <div style={{ height:6, background:`${cat.color}22`, borderRadius:3 }}>
                                <div style={{ height:6, width:`${pct2}%`,
                                  background:cat.color, borderRadius:3 }} />
                              </div>
                            </div>
                          );
                        })}
                        <div style={{ marginTop:8, padding:"6px 10px",
                          background:`${C.bad}10`, borderRadius:8,
                          display:"flex", justifyContent:"space-between", fontSize:11 }}>
                          <span style={{ color:C.muted, fontWeight:700 }}>Total</span>
                          <span style={{ fontWeight:900, color:C.bad }}>
                            {aud(spendCategories.reduce((s,c)=>s+c.preRetire,0))}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* ── ASFA benchmark comparison ── */}
                    <div style={{ background:"#f0fdf4", border:`1px solid ${C.ok}44`,
                      borderRadius:10, padding:"10px 14px" }}>
                      <div style={{ fontSize:11, fontWeight:800, color:C.ok, marginBottom:8 }}>
                        ASFA Retirement Standard Comparison
                      </div>
                      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8 }}>
                        {[
                          { label:"ASFA Modest (Single)",      val:45808,  color:C.warn },
                          { label:"ASFA Comfortable (Single)", val:51630,  color:C.ok },
                          { label:"ASFA Modest (Couple)",      val:65461,  color:C.warn },
                          { label:"ASFA Comfortable (Couple)", val:72663,  color:C.ok },
                        ].map(b=>{
                          const retTotal = spendCategories.reduce((s,c)=>s+c.preRetire,0);
                          const diff = retTotal - b.val;
                          return (
                            <div key={b.label} style={{ background:"white",
                              border:`1px solid ${b.color}33`, borderRadius:8,
                              padding:"8px 10px", textAlign:"center" }}>
                              <div style={{ fontSize:9, color:C.muted, fontWeight:700,
                                marginBottom:4 }}>{b.label}</div>
                              <div style={{ fontSize:14, fontWeight:900,
                                color:b.color, fontFamily:"monospace" }}>{aud(b.val)}</div>
                              <div style={{ fontSize:9, marginTop:4,
                                color: diff<=0?C.ok:C.bad, fontWeight:700 }}>
                                {diff<=0
                                  ? `✅ ${aud(Math.abs(diff))} under`
                                  : `⚠️ ${aud(diff)} over`}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <div style={{ fontSize:9, color:C.muted, marginTop:8 }}>
                        ASFA Sep 2025 · Comparison against your retirement spending categories total
                      </div>
                    </div>

                    {/* ── Sync hint ── */}
                    <div style={{ marginTop:10, background:"#fffbeb",
                      border:"1px solid #f59e0b44", borderRadius:8,
                      padding:"8px 12px", fontSize:10, color:"#92400e" }}>
                      💡 These categories are for planning purposes only. To update your actual
                      projection expenses, adjust <strong>Retirement Expenses</strong> in the
                      Personal tab. Current projection uses: <strong>{aud(inp.retirementExpenses||0)}/yr</strong>
                    </div>
                  </div>
                )}
              </div>
            </>
          );
        })()}
        {/* ═══ MONTE CARLO ═══ */}
        {tab === "montecarlo" && (
          <>
            {/* ── Simulation controls ── */}
            <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:16, flexWrap:"wrap" }}>
              <div style={{ fontSize:12, fontWeight:800, color:C.text }}>🎲 Monte Carlo Simulations</div>
              <div style={{ display:"flex", gap:0, border:`1px solid ${C.border}`, borderRadius:8, overflow:"hidden" }}>
                {[400, 1000].map(n => (
                  <button key={n} onClick={() => setMcRuns(n)} style={{ padding:"5px 16px", background: mcRuns===n ? C.main : C.card, color: mcRuns===n ? "white" : C.muted, border:"none", fontSize:11, fontWeight:800, cursor:"pointer", transition:"background 0.15s" }}>
                    {n}
                  </button>
                ))}
              </div>
              <div style={{ fontSize:10, color:C.muted }}>
                {mcRuns === 1000 ? "⏱ 1,000 runs — higher precision, slightly slower" : "⚡ 400 runs — fast, good for live editing"}
              </div>
              <div style={{ marginLeft:"auto" }}>
                <span style={{ background:`${successColor}18`, border:`1px solid ${successColor}44`, borderRadius:20, padding:"4px 12px", fontSize:11, fontWeight:800, color:successColor }}>
                  {pct(mc.successRate)} Survival · {pct(mc.bankruptcyRate)} Bankruptcy
                </span>
              </div>
            </div>

            {/* ── Full metrics grid ── */}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(155px, 1fr))", gap:8, marginBottom:16 }}>
              {[
                { icon:"⚠️", label:"10th Pct – Stress",        sub:"Markets underperform 90%",   val:aud(mc.p10[mc.p10.length-1]?.value||0), color:"#dc2626" },
                { icon:"🟠", label:"25th Pct – Bear",           sub:"Pessimistic scenario",         val:aud(mc.p25[mc.p25.length-1]?.value||0), color:"#ea580c" },
                { icon:"🟢", label:"50th Pct – Median",         sub:"Most likely outcome",          val:aud(mc.p50[mc.p50.length-1]?.value||0), color:C.ok },
                { icon:"🔵", label:"75th Pct – Optimistic",     sub:"Positive scenario",            val:aud(mc.p75[mc.p75.length-1]?.value||0), color:"#2563eb" },
                { icon:"🟣", label:"90th Pct – Boom",           sub:"Markets outperform 90%",       val:aud(mc.p90[mc.p90.length-1]?.value||0), color:"#7c3aed" },
                { icon:"⬛", label:"Mean (Average)",             sub:"Expected value across runs",   val:aud(mc.mean||0),                         color:C.text },
                { icon:"📐", label:"Std Deviation",             sub:"Spread of outcomes",           val:aud(mc.stdDev||0),                       color:C.muted },
                { icon:"📉", label:"Worst Case",                sub:"Single worst simulation",      val:aud(mc.worst||0),                        color:"#dc2626" },
                { icon:"📈", label:"Best Case",                 sub:"Single best simulation",       val:aud(mc.best||0),                         color:C.ok },
                { icon:"💀", label:"Bankruptcy Probability",    sub:`Liquidity crisis in ${mc.runs} runs`, val:pct(mc.bankruptcyRate||0),        color:"#dc2626" },
                { icon:"✅", label:"Survival Probability",      sub:`Solvent all ${inp.lifeExpectancy-inp.retirementAge} retirement yrs`, val:pct(mc.successRate||0), color:successColor },
              ].map(m => (
                <div key={m.label} style={{ background:C.card, border:`1px solid ${m.color}30`, borderTop:`2px solid ${m.color}`, borderRadius:10, padding:"10px 12px" }}>
                  <div style={{ fontSize:9, color:C.muted, marginBottom:3 }}>{m.icon} {m.label}</div>
                  <div style={{ fontSize:16, fontWeight:900, color:m.color, fontFamily:"monospace", lineHeight:1 }}>{m.val}</div>
                  <div style={{ fontSize:9, color:C.muted, marginTop:3, lineHeight:1.4 }}>{m.sub}</div>
                </div>
              ))}
            </div>

            {/* ── Fan chart ── */}
            <Card title={`Monte Carlo Fan Chart — ${mc.runs} Simulations`} icon="🎲" color={C.warn}>
              <div style={{ fontSize:11, color:C.muted, marginBottom:8 }}>
                Returns: μ={pct(inp.returnRate)} super · Outside-super σ weighted from {(inp.assetItems||[]).filter(a=>a.value>0).length} asset classes · Age Pension dynamically means-tested
              </div>
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={mc.p50.filter((_,i)=>i%2===0).map((d,i)=>({
                  age:d.age, p10:mc.p10[i*2]?.value||0, p25:mc.p25[i*2]?.value||0,
                  p50:d.value, p75:mc.p75[i*2]?.value||0, p90:mc.p90[i*2]?.value||0
                }))}>
                  <defs>
                    <linearGradient id="mcg90" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#7c3aed" stopOpacity={0.12}/><stop offset="95%" stopColor="#7c3aed" stopOpacity={0}/></linearGradient>
                    <linearGradient id="mcg50" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={C.ok} stopOpacity={0.12}/><stop offset="95%" stopColor={C.ok} stopOpacity={0}/></linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="age" stroke={C.muted} tick={{fontSize:10}} />
                  <YAxis stroke={C.muted} tick={{fontSize:10}} tickFormatter={v=>`$${(v/1e6).toFixed(1)}M`} />
                  <Tooltip content={<TT />} />
                  <Legend wrapperStyle={{fontSize:10}} />
                  <ReferenceLine x={inp.retirementAge} stroke="#a78bfa" strokeDasharray="4 2" label={{value:`Retire ${inp.retirementAge}`,fill:"#a78bfa",fontSize:8}} />
                  <Area type="monotone" dataKey="p90" name="🟣 90th – Boom"      stroke="#7c3aed" fill="url(#mcg90)" strokeWidth={1.5} strokeDasharray="5 2" dot={false} />
                  <Area type="monotone" dataKey="p75" name="🔵 75th – Optimistic" stroke="#2563eb" fill="none" strokeWidth={1.5} strokeDasharray="3 2" dot={false} />
                  <Area type="monotone" dataKey="p50" name="🟢 50th – Median"    stroke={C.ok}   fill="url(#mcg50)" strokeWidth={3} dot={false} />
                  <Area type="monotone" dataKey="p25" name="🟠 25th – Bear"      stroke="#ea580c" fill="none" strokeWidth={1.5} strokeDasharray="3 2" dot={false} />
                  <Area type="monotone" dataKey="p10" name="⚠️ 10th – Stress"    stroke="#dc2626" fill="none" strokeWidth={1.5} strokeDasharray="2 4" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </Card>

            {/* ── Outcome interpretation ── */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
              {[
                {r:"90%+", l:"Excellent", d:"Plan withstands bad market sequences. Consider retiring earlier or spending more.", c:C.ok},
                {r:"70–89%", l:"Good", d:"Solid plan. Monitor and consider extra salary sacrifice or part-time work in early retirement.", c:C.main},
                {r:"<70%", l:"At Risk", d:"Delay retirement, increase super contributions, or reduce retirement spending.", c:C.bad},
              ].map(item=>(
                <div key={item.l} style={{ background:C.card, border:`1px solid ${item.c}33`, borderRadius:8, padding:12 }}>
                  <div style={{ color:item.c, fontWeight:800, fontSize:12, marginBottom:4 }}>{item.r} — {item.l}</div>
                  <div style={{ color:C.muted, fontSize:11, lineHeight:1.6 }}>{item.d}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ═══ AGE PENSION ═══ */}
        {tab === "agepension" && (() => {

          // ── Assessable values at age 67 ──
          const row67          = proj.find(d => d.age === 67) || {};
          const primaryPropVal = inp.properties.find(p => p.isPrimary)?.value || 0;
          const assessAssets   = Math.max(0, (row67.pensionAssessable || 0));
          const financialAssets= Math.max(0, (row67.outside || 0) + ((inp.assetItems||[]).reduce((s,a)=>s+(a.value||0),0)));
          const rentalInc      = (inp.properties||[]).filter(p=>!p.isPrimary).reduce((s,p)=>s+(p.weeklyRent||0)*52*(1-(p.expenseRatio||0.25)),0);
          const partnerInc     = (inp.partnerIncome || 0) * 0.5;
          const assessIncome   = rentalInc + (inp.otherIncome || 0) + partnerInc;
          const hasWorkBonus   = inp.currentAge < 67 || (inp.annualIncome || 0) > 0;

          // ── Deeming calculation for display ──
          const deemLower      = inp.married ? 103800 : 62600;
          const deemRateL      = 0.0025;
          const deemRateH      = 0.0225;
          const deemedIncome   = financialAssets <= deemLower
            ? financialAssets * deemRateL
            : (deemLower * deemRateL) + ((financialAssets - deemLower) * deemRateH);
          const workBonusOff   = hasWorkBonus ? 7800 : 0;
          const totalAssessInc = Math.max(0, assessIncome + deemedIncome - workBonusOff);

          // ── Asset test ──
          const full         = inp.married ? AP.coupleFull : AP.singleFull;
          const lower        = inp.married ? (inp.homeowner ? AP.assetsCoupleHome   : AP.assetsCoupleNoHome)
                                          : (inp.homeowner ? AP.assetsSingleHome   : AP.assetsSingleNoHome);
          const cutoff       = inp.married ? (inp.homeowner ? AP.cutoffCoupleHome   : AP.cutoffCoupleNoHome)
                                          : (inp.homeowner ? AP.cutoffSingleHome   : AP.cutoffSingleNoHome);
          const incFree      = inp.married ? AP.incCouple : AP.incSingle;
          const assetExcess  = Math.max(0, assessAssets - lower);
          const assetReduc   = (assetExcess / 1000) * 78;
          const fromAssets   = Math.max(0, full - assetReduc);

          // ── Income test ──
          const incExcess    = Math.max(0, totalAssessInc - incFree);
          const incReduc     = incExcess * 0.50;
          const fromIncome   = Math.max(0, full - incReduc);

          // ── Final pension (most restrictive test) ──
          const estPension   = assessAssets >= cutoff ? 0 : Math.round(Math.min(fromAssets, fromIncome));
          const bindingTest  = fromAssets <= fromIncome ? "Assets Test" : "Income Test";
          const pensionPct   = Math.min(1, estPension / Math.max(1, full));

          // ── PCC eligibility ──
          const pccEligible  = estPension > 0;
          const pccSingle    = assessAssets < cutoff && totalAssessInc < (incFree + full * 2);

          return (
            <>
              {/* ── KPI row ── */}
              <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, marginBottom:14 }}>
                <KPI label="Est. Age Pension at 67" value={aud(estPension)} sub="Annual (means-tested)" color={C.pension} size={20} />
                <KPI label="Fortnightly Payment" value={aud(Math.round(estPension/26))} sub="Every 2 weeks" color={C.pension} />
                <KPI label="Full Single Rate" value={aud(AP.singleFull)} sub="FY2025-26" color="#a78bfa" />
                <KPI label="Full Couple Rate" value={aud(AP.coupleFull)} sub="FY2025-26 combined" color="#a78bfa" />
              </div>

              {/* ── Pension gauge + breakdown ── */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:14 }}>

                {/* Gauge card */}
                <Card title="Pension Entitlement Gauge" icon="🎯" color={C.pension}>
                  <div style={{ display:"flex", flexDirection:"column", alignItems:"center", padding:"10px 0" }}>
                    {/* SVG semi-circle gauge */}
                    <svg width={220} height={120} viewBox="0 0 220 120">
                      <path d="M 20 110 A 90 90 0 0 1 200 110" fill="none" stroke="#e2e8f0" strokeWidth={18} strokeLinecap="round" />
                      <path d="M 20 110 A 90 90 0 0 1 200 110" fill="none"
                        stroke={pensionPct > 0.8 ? C.ok : pensionPct > 0.4 ? C.warn : C.bad}
                        strokeWidth={18} strokeLinecap="round"
                        strokeDasharray={`${pensionPct * 283} 283`} />
                      <text x={110} y={95} textAnchor="middle" fontSize={22} fontWeight={900}
                        fill={C.pension} fontFamily="monospace">{Math.round(pensionPct*100)}%</text>
                      <text x={110} y={112} textAnchor="middle" fontSize={9} fill={C.muted}>of full pension</text>
                      <text x={20}  y={120} textAnchor="middle" fontSize={8} fill={C.muted}>$0</text>
                      <text x={200} y={120} textAnchor="middle" fontSize={8} fill={C.muted}>{aud(full)}</text>
                    </svg>
                    <div style={{ fontSize:22, fontWeight:900, color:C.pension, fontFamily:"monospace", marginTop:4 }}>
                      {aud(estPension)}<span style={{fontSize:11,fontWeight:400,color:C.muted}}>/yr</span>
                    </div>
                    <div style={{ fontSize:11, color:C.muted, marginTop:2 }}>
                      {aud(Math.round(estPension/26))} per fortnight
                    </div>
                    <div style={{ marginTop:10, padding:"4px 14px", borderRadius:20, fontSize:10, fontWeight:800,
                      background: bindingTest==="Assets Test" ? "#dbeafe" : "#fef3c7",
                      color:       bindingTest==="Assets Test" ? "#1d4ed8"  : "#92400e" }}>
                      ⚠️ Binding: {bindingTest}
                    </div>
                    {/* PCC badge */}
                    <div style={{ marginTop:8, padding:"4px 14px", borderRadius:20, fontSize:10, fontWeight:800,
                      background: pccEligible ? "#f0fdf4" : "#fef2f2",
                      color:       pccEligible ? C.ok      : C.bad }}>
                      {pccEligible ? "✅ Pensioner Concession Card eligible" : "❌ Not eligible for PCC"}
                    </div>
                  </div>
                </Card>
{/* ── Annuity Summary (read-only from Annuity tab) ── */}
              {annuity.purchaseAmount > 0 && (
                <div style={{ background:"#f8fafc", border:`1.5px dashed ${C.main}55`,
                  borderRadius:10, padding:"12px 16px", marginBottom:14,
                  opacity:0.85 }}>
                  <div style={{ display:"flex", justifyContent:"space-between",
                    alignItems:"center", marginBottom:8 }}>
                    <div style={{ fontSize:11, fontWeight:900, color:C.main }}>
                      💰 Annuity — read-only summary (edit in Annuity tab)
                    </div>
                    <button onClick={()=>setTab("annuity")}
                      style={{ fontSize:10, color:C.main, background:"white",
                        border:`1px solid ${C.main}44`, borderRadius:6,
                        padding:"3px 10px", cursor:"pointer", fontWeight:700 }}>
                      Edit →
                    </button>
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, opacity:0.8 }}>
                    {[
                      ["Purchase Amount", aud(annuity.purchaseAmount)],
                      ["Annual Income",   aud(annuity.purchaseAmount * annuity.rate)],
                      ["Type",            annuity.type==="lifetime"?"Lifetime":"Term"],
                      ["Start Age",       `Age ${annuity.startAge}`],
                    ].map(([k,v])=>(
                      <div key={k} style={{ background:"white", borderRadius:8,
                        padding:"7px 10px", border:`1px solid ${C.border}` }}>
                        <div style={{ fontSize:9, color:C.muted }}>{k}</div>
                        <div style={{ fontSize:12, fontWeight:800, color:C.main }}>{v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

                {/* Breakdown table */}
                <Card title="Means Test Breakdown" icon="📋" color={C.pension}>
                  <div style={{ fontSize:10, color:C.muted, marginBottom:10 }}>
                    Centrelink applies both tests — you receive the <strong>lower</strong> result.
                  </div>
                  {/* Assets test block */}
                  <div style={{ background:"#dbeafe22", border:"1px solid #2563eb33", borderRadius:8, padding:10, marginBottom:10 }}>
                    <div style={{ fontSize:10, fontWeight:800, color:"#1d4ed8", marginBottom:6 }}>🏦 Assets Test</div>
                    {[
                      ["Assessable Assets",         aud(assessAssets)],
                      ["Lower Threshold (full)",     aud(lower)],
                      ["Upper Cutoff (zero)",        aud(cutoff)],
                      ["Excess over threshold",      aud(assetExcess)],
                      ["Reduction ($78/$1k excess)", aud(Math.round(assetReduc))],
                      ["Pension from Assets Test",   aud(Math.round(fromAssets))],
                    ].map(([k,v])=>(
                      <div key={k} style={{ display:"flex", justifyContent:"space-between",
                        padding:"3px 0", borderBottom:"1px solid #2563eb11", fontSize:10 }}>
                        <span style={{ color:C.muted }}>{k}</span>
                        <span style={{ fontWeight:700, color:"#1d4ed8" }}>{v}</span>
                      </div>
                    ))}
                  </div>

                  {/* Income test block */}
                  <div style={{ background:"#f5f3ff22", border:"1px solid #7c3aed33", borderRadius:8, padding:10 }}>
                    <div style={{ fontSize:10, fontWeight:800, color:C.pension, marginBottom:6 }}>💰 Income Test (with Deeming)</div>
                    {[
                      ["Rental + Other Income",      aud(Math.round(assessIncome))],
                      ["Financial Assets (deemed)",  aud(Math.round(financialAssets))],
                      ["Deemed Income @ 0.25%/2.25%",aud(Math.round(deemedIncome))],
                      ["Work Bonus Offset",          `−${aud(workBonusOff)}`],
                      ["Total Assessable Income",    aud(Math.round(totalAssessInc))],
                      ["Income Free Area",           aud(incFree)],
                      ["Reduction (50¢/$1 excess)",  aud(Math.round(incReduc))],
                      ["Pension from Income Test",   aud(Math.round(fromIncome))],
                    ].map(([k,v])=>(
                      <div key={k} style={{ display:"flex", justifyContent:"space-between",
                        padding:"3px 0", borderBottom:"1px solid #7c3aed11", fontSize:10 }}>
                        <span style={{ color:C.muted }}>{k}</span>
                        <span style={{ fontWeight:700, color:C.pension }}>{v}</span>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>

              {/* ── Rules reference + Your estimate ── */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:14 }}>
                <Card title="Age Pension Rules (FY2025-26)" icon="👴" color={C.pension}>
                  {[
                    ["Eligibility Age",               "67"],
                    ["Full Single Rate",               `${aud(AP.singleFull)}/yr`],
                    ["Full Couple Rate",               `${aud(AP.coupleFull)}/yr combined`],
                    ["Single Homeowner — Full from",   aud(AP.assetsSingleHome)],
                    ["Single Homeowner — Cutoff at",   aud(AP.cutoffSingleHome)],
                    ["Couple Homeowner — Full from",   aud(AP.assetsCoupleHome)],
                    ["Couple Homeowner — Cutoff at",   aud(AP.cutoffCoupleHome)],
                    ["Asset Taper",                    "$78/yr per $1,000 excess"],
                    ["Income Free Area (Single)",      `${aud(AP.incSingle)}/yr`],
                    ["Income Free Area (Couple)",      `${aud(AP.incCouple)}/yr`],
                    ["Income Taper",                   "50¢ per $1 above free area"],
                    ["Deeming — up to threshold",      "0.25% p.a."],
                    ["Deeming — above threshold",      "2.25% p.a."],
                    ["Deeming Threshold (Single)",     aud(62600)],
                    ["Deeming Threshold (Couple)",     aud(103800)],
                    ["Work Bonus",                     "$300/fn ($7,800/yr) offset"],
                    ["Primary Home",                   "Excluded from assets test"],
                  ].map(([k,v])=><Row key={k} k={k} v={v} />)}
                </Card>

                <Card title="Your Situation" icon="📊" color={C.pension}>
                  <Tog label="Include Age Pension in Projections" value={inp.agePensionEnabled} onChange={set("agePensionEnabled")} />
                  <div style={{ marginTop:10 }}>
                    {[
                      ["Status",              inp.married ? "Couple" : "Single"],
                      ["Homeowner",           inp.homeowner ? "Yes" : "No"],
                      ["Work Bonus",          hasWorkBonus ? "Applicable" : "Not applicable"],
                      ["Net Worth at 67",     aud(row67.netWorth || 0)],
                      ["Assessable Assets",   aud(assessAssets)],
                      ["Financial Assets",    aud(financialAssets)],
                      ["Deemed Income",       aud(Math.round(deemedIncome))],
                      ["Assessable Income",   aud(Math.round(totalAssessInc))],
                      ["Binding Test",        bindingTest],
                      ["Est. Pension p.a.",   aud(estPension)],
                      ["Est. Fortnightly",    aud(Math.round(estPension/26))],
                      ["% of Full Pension",   `${Math.round(pensionPct*100)}%`],
                      ["PCC Eligible",        pccEligible ? "✅ Yes" : "❌ No"],
                    ].map(([k,v])=><Row key={k} k={k} v={v} />)}
                  </div>
                  <div style={{ marginTop:10, background:"#f5f3ff", border:`1px solid ${C.pension}33`,
                    borderRadius:8, padding:10, fontSize:10, lineHeight:1.7, color:C.muted }}>
                    💡 As your super depletes in retirement, assessable assets fall — Age Pension
                    automatically increases. Deeming means Centrelink assumes your cash earns income
                    at set rates regardless of actual returns.
                  </div>
                </Card>
              </div>

              {/* ── Age Pension over time chart ── */}
              <Card title="Age Pension Over Time" icon="📈" color={C.pension}>
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={proj.filter(cf)}>
                    <defs>
                      <linearGradient id="gap" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor={C.pension} stopOpacity={0.3}/>
                        <stop offset="95%" stopColor={C.pension} stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                    <XAxis dataKey="age" stroke={C.muted} tick={{fontSize:10}} />
                    <YAxis stroke={C.muted} tick={{fontSize:10}} tickFormatter={v=>`$${(v/1000).toFixed(0)}k`} />
                    <Tooltip content={<TT />} />
                    <ReferenceLine x={67} stroke={C.pension} strokeDasharray="3 3"
                      label={{value:"AP starts",fill:C.pension,fontSize:8}} />
                    <Area type="monotone" dataKey="agePension" name="Age Pension p.a."
                      stroke={C.pension} fill="url(#gap)" strokeWidth={2} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
                <div style={{ fontSize:9, color:C.muted, marginTop:8, lineHeight:1.6 }}>
                  Pension rises automatically as super/assets deplete. PPOR excluded from assets test.
                  Deeming applied to financial assets. Work Bonus applied if employment income exists.
                </div>
              </Card>
            </>
          );
        })()}

        {/* ═══ CENTRELINK & BENEFITS ═══ */}
        {/* ═══ CENTRELINK & BENEFITS ═══ */}
        {tab === "centrelink" && (() => {
          // ── Derived values for Centrelink calculations ──
          const clAge = inp.currentAge;
          const retRow67 = proj.find(d => d.age === 67) || proj[0] || {};
          const assessableAt67 = Math.max(0,
            (retRow67.netWorth || 0)
            - (inp.homeowner ? (inp.properties.find(p => p.isPrimary)?.value || 0) : 0)
          );
          const apAt67 = calcAgePension(67, inp.married, inp.homeowner, assessableAt67, totalRentalIncome + inp.otherIncome, true);
          const apNow  = calcAgePension(clAge, inp.married, inp.homeowner,
            Math.max(0, (proj[0]?.netWorth || 0) - (inp.homeowner ? (inp.properties.find(p=>p.isPrimary)?.value||0):0)),
            totalRentalIncome + inp.otherIncome, inp.agePensionEnabled);

          // CSHC: not on AP, age 67+, income thresholds (2025)
          const cshcSingleThreshold = 95400;
          const cshcCoupleThreshold = 152640;
          const cshcIncomeThreshold = inp.married ? cshcCoupleThreshold : cshcSingleThreshold;
          const annualInvestIncome = (inp.outsideSuper * (inp.dividendYield || 0.04)) + totalRentalIncome + (inp.otherIncome || 0);
          const cshcEligibleAge = clAge >= 67;
          const cshcEligibleIncome = annualInvestIncome < cshcIncomeThreshold;
          const cshcEligibleNoAP = apNow === 0;

          // Rent Assistance (for non-homeowners)
          const rentAssistSingle = 4368;  // ~$168/fn 2025
          const rentAssistCouple = 4108;
          const rentAssist = inp.homeowner ? 0 : (inp.married ? rentAssistCouple : rentAssistSingle);

          // JobSeeker: age 55-67 if below income threshold
          const jsEligible = clAge >= 55 && clAge < 67;
          const jsRateSingle = 18200; // approx annual JobSeeker 2025 single
          const jsRateCouple = 16380;

          return (
            <>
            {/* ── TOTAL BENEFITS KPI ── */}
              {(() => {
                const energySuppSingle = 637;
                const energySuppCouple = 481;
                const energySupp = clAge >= 67 ? (inp.married ? energySuppCouple : energySuppSingle) : 0;
                const totalBenefits =
                  (clAge >= 67 ? apAt67 : 0) +
                  (cshcEligibleAge && cshcEligibleNoAP && cshcEligibleIncome ? 1200 : 0) +
                  (!inp.homeowner ? rentAssist : 0) +
                  (jsEligible ? (inp.married ? jsRateCouple : jsRateSingle) : 0) +
                  energySupp;
                return (
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))", gap:8, marginBottom:14 }}>
                    <KPI label="Total Est. Benefits/yr" value={aud(totalBenefits)} color={C.ok} sub="All applicable payments" />
                    <KPI label="Age Pension" value={clAge>=67?aud(apAt67):"🔒 Age 67+"} color={C.pension} />
                    <KPI label="CSHC Value" value={cshcEligibleAge&&cshcEligibleNoAP&&cshcEligibleIncome?"~$1,200/yr":"Not eligible"} color="#0891b2" sub="PBS + bulk billing savings" />
                    <KPI label="Rent Assistance" value={inp.homeowner?"N/A (homeowner)":aud(rentAssist)} color="#7c3aed" />
                    <KPI label="Energy Supplement" value={clAge>=67?aud(energySupp):"🔒 Age 67+"} color={C.warn} sub="Auto with Age Pension" />
                  </div>
                );
              })()}

              {/* ── BENEFITS TIMELINE CHART ── */}
              <Card title="Benefits Timeline — What You Can Access at Each Age" icon="📅" color={C.main}>
                <div style={{ fontSize:11, color:C.muted, marginBottom:12 }}>
                  Shows which Centrelink benefits become available as you age. Based on your current inputs.
                </div>
                <div style={{ position:"relative", overflowX:"auto" }}>
                  {(() => {
                    const ages = [55,60,65,67,70,75,80,85,90];
                    const benefits = [
                      { label:"JobSeeker",         color:C.warn,    check: a => a >= 55 && a < 67 },
                      { label:"State Seniors Card", color:C.prop,   check: a => a >= 60 },
                      { label:"Preservation Age",  color:C.super,   check: a => a >= preservAge },
                      { label:"Age Pension",        color:C.pension, check: a => a >= 67 },
                      { label:"CSHC",               color:"#0891b2", check: a => a >= 67 && cshcEligibleIncome },
                      { label:"Energy Supplement",  color:C.ok,     check: a => a >= 67 },
                      { label:"Rent Assistance",    color:"#7c3aed", check: a => a >= 67 && !inp.homeowner },
                    ];
                    return (
                      <table style={{ width:"100%", borderCollapse:"collapse", fontSize:10 }}>
                        <thead>
                          <tr style={{ background:"#f8fafc" }}>
                            <th style={{ padding:"6px 10px", textAlign:"left", color:C.muted,
                              fontWeight:700, fontSize:9, textTransform:"uppercase",
                              borderBottom:`2px solid ${C.border}`, minWidth:140 }}>Benefit</th>
                            {ages.map(a => (
                              <th key={a} style={{ padding:"6px 8px", textAlign:"center",
                                color: a === clAge ? C.main : C.muted,
                                fontWeight: a === clAge ? 900 : 700,
                                fontSize:9, borderBottom:`2px solid ${C.border}`,
                                background: a === clAge ? `${C.main}10` : "transparent" }}>
                                {a}{a === clAge ? " 👤" : ""}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {benefits.map((b,i) => (
                            <tr key={i} style={{ borderBottom:`1px solid ${C.border}22`,
                              background: i%2===0?"transparent":"#fafafa" }}>
                              <td style={{ padding:"7px 10px", fontWeight:700,
                                color:b.color, fontSize:10 }}>{b.label}</td>
                              {ages.map(a => (
                                <td key={a} style={{ padding:"7px 8px", textAlign:"center",
                                  background: a === clAge ? `${C.main}08` : "transparent" }}>
                                  {b.check(a)
                                    ? <span style={{ background:b.color, color:"white",
                                        borderRadius:4, padding:"2px 6px", fontSize:9,
                                        fontWeight:700 }}>✓</span>
                                    : <span style={{ color:C.border, fontSize:12 }}>–</span>}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    );
                  })()}
                </div>
                <div style={{ fontSize:9, color:C.muted, marginTop:8 }}>
                  👤 = your current age · ✓ = available · – = not yet available · Subject to means testing
                </div>
              </Card>
              {/* ── SECTION 1: AGE PENSION ── */}
              <div style={{ fontSize:12, fontWeight:900, color:C.pension, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:10, paddingBottom:5, borderBottom:`2px solid ${C.pension}33` }}>
                👴 Section 1 — Age Pension
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))", gap:8, marginBottom:14 }}>
                <KPI label="Your Age" value={clAge} color={clAge >= 67 ? C.ok : C.warn} />
                <KPI label="Eligible from" value="Age 67" color={C.pension} />
                <KPI label="Est. Pension at 67" value={aud(apAt67)} sub="Annual, means-tested" color={C.pension} />
                <KPI label="Full Single Rate" value={aud(AP.singleFull)} sub="2025-26" color="#a78bfa" />
                <KPI label="Full Couple Rate" value={aud(AP.coupleFull)} sub="2025-26 combined" color="#a78bfa" />
              </div>

              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:20 }}>
                <Card title="Your Age Pension Estimate" icon="📊" color={C.pension}>
                  {[
                    ["Status", inp.married ? "Couple" : "Single"],
                    ["Homeowner", inp.homeowner ? "Yes (home excluded)" : "No"],
                    ["Your Age", clAge],
                    ["Eligible at", "67"],
                    ["Years until eligible", Math.max(0, 67 - clAge)],
                    ["Est. Assessable Assets at 67", aud(assessableAt67)],
                    ["Assets lower threshold", aud(inp.married ? AP.assetsCoupleHome : (inp.homeowner ? AP.assetsSingleHome : AP.assetsSingleNoHome))],
                    ["Assets cutoff (zero pension)", aud(inp.married ? AP.cutoffCoupleHome : (inp.homeowner ? AP.cutoffSingleHome : AP.cutoffSingleNoHome))],
                    ["Rental + Other Income p.a.", aud(totalRentalIncome + inp.otherIncome)],
                    ["Income free area", aud(inp.married ? AP.incCouple : AP.incSingle)],
                    ["Estimated Age Pension p.a.", aud(apAt67)],
                    ["Estimated fortnightly", aud(apAt67 / 26)],
                    ["% of full pension", pct(apAt67 / Math.max(1, inp.married ? AP.coupleFull : AP.singleFull))],
                  ].map(([k,v]) => <Row key={k} k={String(k)} v={String(v)} />)}
                </Card>
                <Card title="Age Pension Rules" icon="📋" color={C.pension}>
                  <div style={{ fontSize:11, color:C.muted, lineHeight:2 }}>
                    ✅ <strong>Eligibility age:</strong> 67 (all Australians born after 1 Jan 1957)<br/>
                    ✅ <strong>Residency:</strong> Australian resident 10+ years<br/>
                    ✅ <strong>Assets test:</strong> Home excluded · tapers $78/yr per $1,000 excess<br/>
                    ✅ <strong>Income test:</strong> 50¢ per $1 above free area<br/>
                    ✅ <strong>Deeming:</strong> Financial assets deemed at 0.25% / 2.25%<br/>
                    ✅ <strong>Works bonus:</strong> Up to $7,800 employment income ignored<br/>
                    💡 As super depletes, Age Pension auto-increases — a built-in safety net<br/>
                    💡 Age Pension is indexed to CPI and Male Total Average Weekly Earnings (MTAWE)<br/><br/>
                    <strong style={{ color:C.pension }}>Source:</strong> servicesaustralia.gov.au — effective Sep 2025
                  </div>
                </Card>
              </div>

              {/* ── SECTION 2: CSHC ── */}
              <div style={{ fontSize:12, fontWeight:900, color:"#0891b2", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:10, paddingBottom:5, borderBottom:`2px solid #0891b233` }}>
                💊 Section 2 — Commonwealth Seniors Health Card (CSHC)
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:20 }}>
                <Card title="Your CSHC Eligibility" icon="🪪" color="#0891b2">
                  {[
                    [cshcEligibleAge, `Age 67+ (you are ${clAge})`, cshcEligibleAge ? C.ok : C.muted],
                    [cshcEligibleNoAP, "Not on Age Pension (or not receiving it)", cshcEligibleNoAP ? C.ok : C.warn],
                    [cshcEligibleIncome, `Adjusted income under ${aud(cshcIncomeThreshold)} (${inp.married?"couple":"single"})`, cshcEligibleIncome ? C.ok : C.warn],
                    [true, `Your est. adjusted income: ${aud(annualInvestIncome)}`, annualInvestIncome < cshcIncomeThreshold ? C.ok : C.bad],
                  ].map(([ok, label, c], i) => (
                    <div key={i} style={{ display:"flex", gap:8, alignItems:"flex-start", padding:"6px 0", borderBottom:`1px solid ${C.border}`, fontSize:11 }}>
                      <span style={{ fontSize:13, flexShrink:0 }}>{ok ? "✅" : "❌"}</span>
                      <span style={{ color: c }}>{label}</span>
                    </div>
                  ))}
                  <div style={{ marginTop:10, background: cshcEligibleAge && cshcEligibleNoAP && cshcEligibleIncome ? "#f0fdf4" : "#fff7ed",
                    border:`2px solid ${cshcEligibleAge && cshcEligibleNoAP && cshcEligibleIncome ? C.ok : C.warn}`,
                    borderRadius:8, padding:"8px 12px", fontSize:11, fontWeight:700,
                    color: cshcEligibleAge && cshcEligibleNoAP && cshcEligibleIncome ? C.ok : C.warn }}>
                    {cshcEligibleAge && cshcEligibleNoAP && cshcEligibleIncome
                      ? "✅ Likely eligible for CSHC"
                      : clAge < 67
                        ? `🔒 Available from age 67 (${67-clAge} years away)`
                        : "⚠️ May not be eligible — check income or Age Pension status"}
                  </div>
                </Card>
                <Card title="CSHC Benefits" icon="🎁" color="#0891b2">
                  <div style={{ fontSize:11, color:C.muted, lineHeight:2 }}>
                    💊 <strong>PBS medicines</strong> at concession rate (~$7.70 per script vs ~$31.60)<br/>
                    🏥 <strong>Bulk billing</strong> more likely for GP visits<br/>
                    📻 <strong>Telephone Allowance</strong> ~$27.20/quarter (internet & mobile)<br/>
                    ✈️ <strong>Seniors Supplement</strong> (if receiving CSHC and other payments)<br/>
                    🦷 Access to <strong>free dental</strong> under CDBS programs in some states<br/>
                    💡 Income threshold 2025: Single <strong>$95,400</strong> · Couple <strong>$152,640</strong><br/>
                    💡 Includes deemed financial income + rental income + employment income<br/>
                    <br/>
                    <strong style={{ color:"#0891b2" }}>Apply:</strong> servicesaustralia.gov.au/cshc or call 132 300
                  </div>
                </Card>
              </div>

              {/* ── SECTION 3: STATE SENIORS CARDS ── */}
              <div style={{ fontSize:12, fontWeight:900, color:C.prop, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:10, paddingBottom:5, borderBottom:`2px solid ${C.prop}33` }}>
                🪙 Section 3 — Seniors Cards by State
              </div>
              <Card title="Australian Seniors Cards — Eligibility & Benefits" icon="🗺️" color={C.prop}>
                <div style={{ overflowX:"auto" }}>
                  <table style={{ width:"100%", borderCollapse:"collapse", fontSize:10 }}>
                    <thead>
                      <tr style={{ background:"#fffbeb", borderBottom:`2px solid ${C.prop}44` }}>
                        {["State","Card Name","Min Age","Work Limit","Key Benefits"].map(h => (
                          <th key={h} style={{ padding:"7px 10px", textAlign:"left", color:C.prop, fontWeight:800, fontSize:9, textTransform:"uppercase", letterSpacing:"0.06em" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ["🟦 NSW", "NSW Seniors Card", "60", "≤20 hrs/wk", "Transport: 50% off trains/buses/ferries (Opal). Retail, dining, entertainment discounts. Gold Opal card daily cap $2.50."],
                        ["🟩 VIC", "Victorian Seniors Card", "60", "≤35 hrs/wk", "Public transport: myki 50% off. Restaurant, retail, cinema, accommodation, hardware discounts. FREE tram/bus/train on public transport for over 70s (PTV daily cap)."],
                        ["🟨 QLD", "Queensland Seniors Card", "65", "Not working FT", "Reduced fares on public transport (TransLink). Discounts: retail, accommodation, medical, dental, optometry, leisure."],
                        ["🟧 SA", "South Australia Seniors Card", "60", "≤20 hrs/wk", "Transport: Adelaide Metro free off-peak. Retail, tourism and hospitality discounts. Free ambulance cover."],
                        ["🔵 WA", "WA Seniors Card", "60", "≤25 hrs/wk", "Transperth free off-peak. Retail, accommodation, dining, leisure discounts."],
                        ["🟫 TAS", "Tasmanian Seniors Card", "60", "Not in full-time work", "Metro Tasmania concessions. Retail and hospitality discounts across the island."],
                        ["🔴 ACT", "ACT Seniors Card", "60", "Not working FT", "ACTION buses free for card holders. Retail and entertainment discounts."],
                        ["⚫ NT", "NT Seniors Card", "60", "Not in full-time work", "Reduced fares on some services. Business directory discounts. Limited compared to other states."],
                      ].map(([state, card, age, work, benefits], i) => (
                        <tr key={state} style={{ borderBottom:`1px solid ${C.border}`, background: i % 2 === 0 ? "transparent" : "#fefce8" }}>
                          <td style={{ padding:"8px 10px", fontWeight:700, color:C.text }}>{state}</td>
                          <td style={{ padding:"8px 10px", color:"#b45309", fontWeight:600 }}>{card}</td>
                          <td style={{ padding:"8px 10px", textAlign:"center", fontWeight:800, color: clAge >= parseInt(age) ? C.ok : C.muted }}>{age}{clAge >= parseInt(age) ? " ✅" : ""}</td>
                          <td style={{ padding:"8px 10px", color:C.muted }}>{work}</td>
                          <td style={{ padding:"8px 10px", color:C.text, lineHeight:1.5 }}>{benefits}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ fontSize:10, color:C.muted, marginTop:10, lineHeight:1.7 }}>
                  💡 Eligibility checkmark (✅) shown where your current age ({clAge}) meets the minimum. Cards are state/territory-issued — apply directly with each state government.
                </div>
              </Card>

              {/* ── SECTION 4: OTHER PAYMENTS ── */}
              <div style={{ fontSize:12, fontWeight:900, color:C.health, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:10, paddingBottom:5, borderBottom:`2px solid ${C.health}33`, marginTop:20 }}>
                💰 Section 4 — Other Centrelink Payments
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))", gap:14 }}>

                {/* Rent Assistance */}
                <Card title="Rent Assistance" icon="🏠" color="#7c3aed">
                  <div style={{ display:"flex", gap:10, marginBottom:10, alignItems:"center" }}>
                    <div style={{ fontSize:28 }}>{inp.homeowner ? "🏡" : "🏢"}</div>
                    <div>
                      <div style={{ fontSize:12, fontWeight:800, color: inp.homeowner ? C.muted : "#7c3aed" }}>
                        {inp.homeowner ? "Not eligible (homeowner)" : "Potentially eligible"}
                      </div>
                      <div style={{ fontSize:10, color:C.muted }}>
                        {inp.homeowner ? "Rent Assistance is for renters only" : `Up to ${aud(rentAssist)}/yr for eligible renters`}
                      </div>
                    </div>
                  </div>
                  {!inp.homeowner && (
                    <>
                      {[
                        ["Max Rent Assistance", aud(inp.married ? rentAssistCouple : rentAssistSingle)],
                        ["Basis", inp.married ? "Couple" : "Single"],
                        ["Fortnightly max", aud((inp.married ? rentAssistCouple : rentAssistSingle) / 26)],
                        ["Must also receive", "Age Pension, Carer Payment or other qualifying payment"],
                      ].map(([k,v]) => <Row key={k} k={k} v={v} />)}
                    </>
                  )}
                  <div style={{ fontSize:10, color:C.muted, marginTop:8, lineHeight:1.7 }}>
                    Paid automatically with Age Pension if you rent privately, in a retirement village, or shared accommodation.<br/>
                    <strong>Source:</strong> servicesaustralia.gov.au/rentassistance
                  </div>
                </Card>

                {/* JobSeeker (55-67) */}
                <Card title="JobSeeker Payment (55–67)" icon="💼" color={C.warn}>
                  <div style={{ marginBottom:10 }}>
                    <div style={{ fontSize:12, fontWeight:800, color: jsEligible ? C.warn : C.muted }}>
                      {jsEligible ? `Age ${clAge} — potentially in JobSeeker window` : clAge < 55 ? `Available age 55+ (${55-clAge} years away)` : "Age 67+ — transition to Age Pension"}
                    </div>
                    <div style={{ fontSize:10, color:C.muted, marginTop:3 }}>Unemployment/income support for those aged 55–66 seeking work</div>
                  </div>
                  {[
                    ["Single rate (approx)", aud(jsRateSingle) + "/yr"],
                    ["Couple rate (each, approx)", aud(jsRateCouple) + "/yr"],
                    ["Fortnightly (single)", aud(jsRateSingle/26)],
                    ["Income free area", "$150/fn · 50¢ taper above"],
                    ["Assets test", "Homeowner $314,000 / Non-homeowner $566,000"],
                    ["Mutual obligation", "Reduced requirements for 55+ (Workforce Australia)"],
                    ["Age 60+", "Volunteer work can count as mutual obligation"],
                  ].map(([k,v]) => <Row key={k} k={k} v={v} />)}
                  <div style={{ fontSize:10, color:C.muted, marginTop:8, lineHeight:1.7 }}>
                    At age 67, JobSeeker transitions automatically to Age Pension eligibility assessment.<br/>
                    <strong>Source:</strong> servicesaustralia.gov.au/jobseeker
                  </div>
                </Card>

                {/* Carer Payment */}
                <Card title="Carer Payment" icon="🤝" color={C.health}>
                  <div style={{ fontSize:11, color:C.muted, lineHeight:2 }}>
                    🤝 <strong>Who:</strong> People providing full-time care for a person with disability, illness or frailty<br/>
                    💰 <strong>Rate:</strong> Same as Age Pension — ~{aud(AP.singleFull)}/yr (single) · ~{aud(AP.coupleFull)}/yr (couple combined)<br/>
                    ✅ <strong>Also receive:</strong> Carer Allowance (~$622/yr supplement)<br/>
                    📋 <strong>ADAT score:</strong> Care receiver must meet care needs threshold<br/>
                    🏥 <strong>Also eligible for:</strong> Carer Supplement ($600/yr), concession card, pharmaceutical benefits<br/>
                    ⚖️ <strong>Income test:</strong> Same thresholds as Age Pension<br/>
                    💡 <strong>Tip:</strong> Can receive Carer Payment AND Age Pension if providing care at 67+<br/><br/>
                    <strong style={{ color:C.health }}>Apply:</strong> servicesaustralia.gov.au/carerpayment or call 132 717
                  </div>
                </Card>
              </div>

{/* ── SECTION 5: LIHCC ── */}
              <div style={{ fontSize:12, fontWeight:900, color:"#0284c7", textTransform:"uppercase",
                letterSpacing:"0.1em", marginBottom:10, paddingBottom:5,
                borderBottom:`2px solid #0284c733`, marginTop:20 }}>
                🩺 Section 5 — Low Income Health Care Card (LIHCC)
              </div>
              {(() => {
                const lihccSingle = 26000;
                const lihccCouple = 44200;
                const lihccThreshold = inp.married ? lihccCouple : lihccSingle;
                const lihccIncome = inp.annualIncome || 0;
                const lihccEligible = lihccIncome <= lihccThreshold && clAge < 67;
                return (
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:20 }}>
                    <Card title="Your LIHCC Eligibility" icon="🩺" color="#0284c7">
                      {[
                        [clAge < 67, `Under Age Pension age (you are ${clAge})`, clAge<67?C.ok:C.muted],
                        [lihccIncome <= lihccThreshold, `Income under ${aud(lihccThreshold)} (${inp.married?"couple":"single"})`, lihccIncome<=lihccThreshold?C.ok:C.bad],
                        [true, `Your income: ${aud(lihccIncome)}`, lihccIncome<=lihccThreshold?C.ok:C.bad],
                      ].map(([ok,label,c],i) => (
                        <div key={i} style={{ display:"flex", gap:8, alignItems:"flex-start",
                          padding:"6px 0", borderBottom:`1px solid ${C.border}`, fontSize:11 }}>
                          <span style={{ fontSize:13, flexShrink:0 }}>{ok?"✅":"❌"}</span>
                          <span style={{ color:c }}>{label}</span>
                        </div>
                      ))}
                      <div style={{ marginTop:10, background: lihccEligible?"#f0fdf4":"#fff7ed",
                        border:`2px solid ${lihccEligible?C.ok:C.warn}`,
                        borderRadius:8, padding:"8px 12px", fontSize:11,
                        fontWeight:700, color: lihccEligible?C.ok:C.warn }}>
                        {lihccEligible
                          ? "✅ Likely eligible for Low Income Health Care Card"
                          : clAge >= 67
                            ? "ℹ️ At 67+ apply for CSHC instead"
                            : `❌ Income ${aud(lihccIncome)} exceeds ${aud(lihccThreshold)} threshold`}
                      </div>
                    </Card>
                    <Card title="LIHCC Benefits" icon="🎁" color="#0284c7">
                      <div style={{ fontSize:11, color:C.muted, lineHeight:2 }}>
                        💊 <strong>PBS medicines</strong> at concession rate (~$7.70 per script)<br/>
                        🏥 <strong>Bulk billing</strong> more accessible for GP visits<br/>
                        👁️ <strong>Optical:</strong> Some optometrists offer concession rates<br/>
                        🦷 <strong>Dental:</strong> Access to public dental waiting lists<br/>
                        🚌 <strong>Some state transport</strong> concessions (varies by state)<br/>
                        📋 <strong>Income test only</strong> — no assets test for LIHCC<br/>
                        🔄 <strong>Reviewed every 12 months</strong> — re-apply if still eligible<br/>
                        💡 <strong>Threshold 2025:</strong> Single {aud(lihccSingle)} · Couple {aud(lihccCouple)}<br/><br/>
                        <strong style={{ color:"#0284c7" }}>Apply:</strong> servicesaustralia.gov.au/lihcc or call 132 490
                      </div>
                    </Card>
                  </div>
                );
              })()}

              {/* ── SECTION 6: DSP ── */}
              <div style={{ fontSize:12, fontWeight:900, color:"#be185d", textTransform:"uppercase",
                letterSpacing:"0.1em", marginBottom:10, paddingBottom:5,
                borderBottom:`2px solid #be185d33`, marginTop:4 }}>
                ♿ Section 6 — Disability Support Pension (DSP)
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:20 }}>
                <Card title="DSP Overview" icon="♿" color="#be185d">
                  <div style={{ fontSize:11, color:C.muted, lineHeight:2 }}>
                    <strong style={{ color:"#be185d" }}>Who is eligible?</strong><br/>
                    ✅ Aged 16 to Age Pension age (67)<br/>
                    ✅ Australian resident<br/>
                    ✅ Permanent physical, intellectual or psychiatric condition<br/>
                    ✅ Condition prevents working 15+ hrs/week at or above minimum wage<br/>
                    ✅ Have completed a Program of Support (or exempt)<br/><br/>
                    <strong style={{ color:"#be185d" }}>Impairment Tables:</strong><br/>
                    Must score 20+ points on ATO Impairment Tables<br/>
                    OR be permanently blind
                  </div>
                </Card>
                <Card title="DSP Rates & Tests" icon="💰" color="#be185d">
                  {[
                    ["Single rate",           aud(AP.singleFull) + "/yr (same as Age Pension)"],
                    ["Couple rate (each)",    aud(AP.coupleFull/2) + "/yr"],
                    ["Pension Supplement",    "~$612/yr additional"],
                    ["Energy Supplement",     "~$637/yr (single)"],
                    ["Income free area",      "$204/fn · tapers above"],
                    ["Assets test",           "Same as Age Pension"],
                    ["Work capacity",         "Under 15 hrs/week at min wage"],
                    ["Transitions at 67",     "Auto-converts to Age Pension"],
                    ["Waiting period",        "No NARWP if Australian-born"],
                  ].map(([k,v]) => <Row key={k} k={k} v={v} />)}
                  <div style={{ marginTop:8, background:"#fdf2f8",
                    border:"1px solid #be185d33", borderRadius:8,
                    padding:"8px 10px", fontSize:10, color:"#be185d", lineHeight:1.7 }}>
                    💡 DSP is the highest non-age Centrelink payment. Many eligible Australians
                    don't apply. At 67 it automatically converts to Age Pension at the same rate.<br/>
                    <strong>Apply:</strong> servicesaustralia.gov.au/dsp or call 132 717
                  </div>
                </Card>
              </div>
              {/* Summary badge row */}
              <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:10, padding:"12px 16px", marginTop:16 }}>
                <div style={{ fontSize:10, fontWeight:800, color:C.muted, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:8 }}>Your Centrelink Summary</div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
                  {[
                    [clAge >= 67 && apAt67 > 0, `👴 Age Pension ~${aud(apAt67)}/yr`],
                    [cshcEligibleAge && cshcEligibleNoAP && cshcEligibleIncome, "💊 CSHC likely eligible"],
                    [!inp.homeowner, `🏠 Rent Assist up to ${aud(rentAssist)}/yr`],
                    [jsEligible, `💼 JobSeeker eligible (${clAge}–67)`],
                    [clAge >= 60, "🪙 State Seniors Card eligible"],
                  ].map(([show, label], i) => show && (
                    <Badge key={i} color={C.ok}>{label}</Badge>
                  ))}
                  {clAge < 67 && apAt67 === 0 && !jsEligible && inp.homeowner && (
                    <span style={{ fontSize:11, color:C.muted }}>Update your age and inputs to see applicable benefits.</span>
                  )}
                </div>
              </div>
            </>
          );
        })()}

        {/* ═══ ESTATE ═══ */}
        {tab === "estate" && (
          <>
           {/* ── Estate KPIs ── */}
            {(() => {
              const estateColor = "#a78bfa";
              const superEnd = (endRow.super||0)+(endRow.superPension||0);
              const propEnd  = endRow.propertyEquity||0;
              const cashEnd  = endRow.outside||0;
              const totalEstate = endRow.netWorth||0;

              // Super death benefit tax for non-dependants
              // Taxable component estimate: 80% of super (typical)
              const taxableComp   = superEnd * 0.80;
              const superDeathTax = taxableComp * 0.17; // 15% + 2% Medicare for non-dependants
              const netSuperToAdultChildren = superEnd - superDeathTax;

              // CGT on investment properties (not PPOR)
              const investProps = inp.properties.filter(p=>!p.isPrimary);
              const totalInvestPropValue = investProps.reduce((s,p)=>s+(p.value||0),0);
              const totalInvestPropCost  = investProps.reduce((s,p)=>s+((p.value||0)*0.6),0); // assume 40% gain
              const cgtGain   = Math.max(0, totalInvestPropValue - totalInvestPropCost);
              const cgtPayable = cgtGain * 0.5 * 0.47; // 50% discount, top marginal rate

              // Checklist score
              const checks = [
                inp.estateHasWill, inp.estateHasPOA, inp.estateHasACD,
                inp.estateHasSuper, inp.estateHasTrust
              ];
              const checkScore = checks.filter(Boolean).length;
              const checkColor = checkScore >= 4 ? C.ok : checkScore >= 2 ? C.warn : C.bad;

              return (
                <>
                  {/* ── KPI Strip ── */}
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))", gap:8, marginBottom:14 }}>
                    <KPI label="Total Estate at 90"     value={aud(totalEstate)}            color={estateColor} />
                    <KPI label="Super Component"        value={aud(superEnd)}               color={C.super} sub="Tax-free to dependants" />
                    <KPI label="Property Component"     value={aud(propEnd)}                color={C.prop} />
                    <KPI label="Cash & Investments"     value={aud(cashEnd)}                color={C.outside} />
                    <KPI label="Super Death Tax Risk"   value={aud(superDeathTax)}          color={C.bad} sub="If left to non-dependants" />
                    <KPI label="Planning Checklist"     value={`${checkScore}/5`}           color={checkColor} sub="Documents completed" />
                  </div>

                  {/* ── Estate Composition chart ── */}
                  <Card title="Estate Composition Over Time" icon="📈" color={estateColor}>
                    <ResponsiveContainer width="100%" height={240}>
                      <AreaChart data={proj.filter(cf)}>
                        <defs>
                          <linearGradient id="gEst" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%"  stopColor={estateColor} stopOpacity={0.3}/>
                            <stop offset="95%" stopColor={estateColor} stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                        <XAxis dataKey="age" stroke={C.muted} tick={{fontSize:10}} />
                        <YAxis stroke={C.muted} tick={{fontSize:10}} tickFormatter={v=>`$${(v/1e6).toFixed(1)}M`} />
                        <Tooltip content={<TT />} />
                        <Legend wrapperStyle={{fontSize:10}} />
                        <ReferenceLine x={inp.retirementAge} stroke="#a78bfa" strokeDasharray="4 2"
                          label={{value:"Retire",fill:"#a78bfa",fontSize:9}} />
                        <Area type="monotone" dataKey="super"         name="Super"            stroke={C.super}    fill={`${C.super}22`}    strokeWidth={1.5} stackId="a" dot={false} />
                        <Area type="monotone" dataKey="superPension"  name="Super (Pension)"  stroke="#60a5fa"    fill="#60a5fa22"         strokeWidth={1.5} stackId="a" dot={false} />
                        <Area type="monotone" dataKey="outside"       name="Cash/Investments" stroke={C.outside}  fill={`${C.outside}22`}  strokeWidth={1.5} stackId="a" dot={false} />
                        <Area type="monotone" dataKey="propertyEquity"name="Property Equity"  stroke={C.prop}     fill={`${C.prop}22`}     strokeWidth={1.5} stackId="a" dot={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </Card>

                  {/* ── Planning Checklist + Super Death Benefits ── */}
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
                    <Card title="Estate Planning Checklist" icon="✅" color={estateColor}>
                      <Tog label="Have a current Will" value={inp.estateHasWill||false}
                        onChange={set("estateHasWill")}
                        note="Without Will, assets distributed by intestacy laws" />
                      <Tog label="Enduring Power of Attorney (EPOA)" value={inp.estateHasPOA||false}
                        onChange={set("estateHasPOA")}
                        note="Allows someone to manage finances if incapacitated" />
                      <Tog label="Advance Care Directive" value={inp.estateHasACD||false}
                        onChange={set("estateHasACD")}
                        note="Documents medical wishes — medical POA" />
                      <Tog label="Super Beneficiary Nominations" value={inp.estateHasSuper||false}
                        onChange={set("estateHasSuper")}
                        note="Binding nominations override Will. Review every 3 years." />
                      <Tog label="Testamentary / Family Trust" value={inp.estateHasTrust||false}
                        onChange={set("estateHasTrust")}
                        note="Tax benefits for beneficiaries — minors taxed at adult rates" />

                      {/* Score bar */}
                      <div style={{ marginTop:12, background:"#f8fafc", borderRadius:8, padding:"10px 12px" }}>
                        <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, marginBottom:6 }}>
                          <span style={{ color:C.muted, fontWeight:700 }}>Planning Score</span>
                          <span style={{ color:checkColor, fontWeight:900 }}>{checkScore}/5</span>
                        </div>
                        <div style={{ height:8, background:`${checkColor}22`, borderRadius:4 }}>
                          <div style={{ height:8, width:`${checkScore/5*100}%`,
                            background:checkColor, borderRadius:4,
                            transition:"width 0.3s" }} />
                        </div>
                        <div style={{ fontSize:9, color:C.muted, marginTop:6 }}>
                          {checkScore === 5 ? "✅ Excellent — all documents in place"
                            : checkScore >= 3 ? "⚠️ Good — complete remaining items"
                            : "❌ Action needed — missing critical documents"}
                        </div>
                      </div>
                    </Card>

                    <Card title="Super Death Benefits Tax" icon="💀" color={C.bad}>
                      <div style={{ fontSize:11, color:C.muted, marginBottom:10, lineHeight:1.7 }}>
                        Super is NOT automatically part of your estate. Tax applies when
                        left to non-dependants (adult children, siblings etc).
                      </div>
                      {[
                        ["Super Balance at 90",          aud(superEnd)],
                        ["Taxable Component (est. 80%)", aud(taxableComp)],
                        ["Tax Rate (non-dependant)",     "15% + 2% Medicare = 17%"],
                        ["Tax Payable",                  aud(superDeathTax)],
                        ["Net to Adult Children",        aud(netSuperToAdultChildren)],
                        ["Tax-Free to Spouse/Dependant", aud(superEnd)],
                      ].map(([k,v])=><Row key={k} k={k} v={v} />)}
                      <div style={{ marginTop:10, background:"#fef2f2",
                        border:`1px solid ${C.bad}33`, borderRadius:8,
                        padding:"8px 10px", fontSize:10, color:C.muted, lineHeight:1.7 }}>
                        💡 <strong>Strategy:</strong> Withdraw super before death and invest
                        outside super to avoid death benefits tax. Or leave to spouse first
                        (tax-free), who then withdraws tax-free in pension phase.
                      </div>
                    </Card>
                  </div>

                  {/* ── CGT + Beneficiary Distribution ── */}
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
                    <Card title="Capital Gains Tax on Inherited Assets" icon="🏘️" color={C.prop}>
                      <div style={{ fontSize:11, color:C.muted, marginBottom:10, lineHeight:1.7 }}>
                        No inheritance tax in Australia — but CGT may apply when
                        beneficiaries sell inherited investment properties.
                      </div>
                      {[
                        ["Investment Properties",        investProps.length],
                        ["Total Invest. Property Value", aud(totalInvestPropValue)],
                        ["Estimated Cost Base",          aud(totalInvestPropCost)],
                        ["Estimated Capital Gain",       aud(cgtGain)],
                        ["After 50% CGT Discount",       aud(cgtGain*0.5)],
                        ["Max CGT Payable (47%)",        aud(cgtPayable)],
                        ["PPOR CGT",                     "Exempt if sold within 2 years"],
                      ].map(([k,v])=><Row key={k} k={k} v={v} />)}
                      <div style={{ marginTop:10, background:`${C.prop}10`,
                        border:`1px solid ${C.prop}33`, borderRadius:8,
                        padding:"8px 10px", fontSize:10, color:C.muted, lineHeight:1.7 }}>
                        💡 Beneficiaries inherit the original cost base. Selling quickly
                        (within 12 months) loses the 50% CGT discount. Consider timing of sale.
                      </div>
                    </Card>

                    <Card title="Beneficiary Distribution Planner" icon="👨‍👩‍👧‍👦" color={estateColor}>
                      <div style={{ fontSize:11, color:C.muted, marginBottom:10, lineHeight:1.7 }}>
                        How your estate might be distributed. Super goes directly to
                        nominated beneficiaries — not via Will.
                      </div>
                      {[
                        ["Total Estate",              aud(totalEstate)],
                        ["Super (via nominations)",   aud(superEnd)],
                        ["Property equity (via Will)", aud(propEnd)],
                        ["Cash/investments (via Will)",aud(cashEnd)],
                        ["Est. CGT on properties",    `−${aud(cgtPayable)}`],
                        ["Est. super death tax",      `−${aud(superDeathTax)}`],
                        ["Net distributable estate",  aud(Math.max(0, totalEstate - cgtPayable - superDeathTax))],
                      ].map(([k,v])=><Row key={k} k={k} v={v} />)}
                      <div style={{ marginTop:10, background:"#f0fdf4",
                        border:`1px solid ${C.ok}33`, borderRadius:8,
                        padding:"8px 10px", fontSize:10, color:C.muted, lineHeight:1.7 }}>
                        💡 <strong>Testamentary trust</strong> can split estate income among
                        beneficiaries taxed at adult rates — significant savings for
                        estates over $500k with minor beneficiaries.
                      </div>
                    </Card>
                  </div>

                  {/* ── Key Rules ── */}
                  <Card title="Australian Estate Planning — Key Rules" icon="📋" color={estateColor}>
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
                      <div style={{ fontSize:11, color:C.muted, lineHeight:2 }}>
                        🔹 <strong style={{color:estateColor}}>No death/inheritance tax</strong> in Australia<br/>
                        🔹 <strong style={{color:estateColor}}>Super death benefits:</strong> Tax-free to dependants · 17% to non-dependants<br/>
                        🔹 <strong style={{color:estateColor}}>Binding nominations</strong> lapse every 3 years (non-lapsing in SMSF)<br/>
                        🔹 <strong style={{color:estateColor}}>Testamentary trust:</strong> Minors taxed at adult rates — saves tax on large estates<br/>
                        🔹 <strong style={{color:estateColor}}>PPOR CGT exemption:</strong> Main residence exempt if sold within 2 years of death<br/>
                        🔹 <strong style={{color:estateColor}}>Intestacy:</strong> No Will = state law distributes assets (may not match wishes)
                      </div>
                      <div style={{ fontSize:11, color:C.muted, lineHeight:2 }}>
                        🔹 <strong style={{color:estateColor}}>EPOA:</strong> Essential — without it, courts appoint administrator if incapacitated<br/>
                        🔹 <strong style={{color:estateColor}}>Granny flat interest:</strong> Can affect Age Pension — get advice<br/>
                        🔹 <strong style={{color:estateColor}}>Life insurance:</strong> Paid outside estate — check beneficiary nominations<br/>
                        🔹 <strong style={{color:estateColor}}>Joint tenancy:</strong> Property passes directly to survivor, bypasses Will<br/>
                        🔹 <strong style={{color:estateColor}}>Digital assets:</strong> Include crypto, online accounts in Will instructions<br/>
                        🔹 <strong style={{color:estateColor}}>Review trigger:</strong> Marriage, divorce, new child, property purchase
                      </div>
                    </div>
                    <div style={{ marginTop:10, background:"#fffbeb",
                      border:"1px solid #f59e0b44", borderRadius:8,
                      padding:"8px 12px", fontSize:10, color:"#92400e" }}>
                      ⚠️ General information only. Estate planning involves complex legal and tax
                      considerations. Always consult a solicitor and financial adviser.
                      <strong> Source:</strong> ATO · Services Australia · ASIC RG 244
                    </div>
                  </Card>
                </>
              );
            })()}
          </>
        )}

        {/* ═══ WELLNESS ═══ */}
        {tab === "wellness" && (
          <>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 2fr", gap:14, marginBottom:16 }}>
              <Card title="Overall Score" icon="💚" color={wellnessColor}>
                <div style={{ textAlign:"center", padding:"20px 0" }}>
                  <div style={{ fontSize:64, fontWeight:900, color:wellnessColor, lineHeight:1 }}>{wellnessGrade}</div>
                  <div style={{ fontSize:24, color:wellnessColor, fontWeight:700, marginTop:4 }}>{wellnessTotal}/100</div>
                  <div style={{ fontSize:11, color:C.muted, marginTop:8 }}>{wellnessTotal>=85?"Excellent — plan is in great shape!":wellnessTotal>=70?"Good — some optimisations available":wellnessTotal>=55?"Needs work — take action on key areas":"At risk — significant changes needed"}</div>
                </div>
              </Card>
              <Card title="Score Breakdown" icon="📊" color={wellnessColor}>
                {wellnessItems.map(item=>(
                  <div key={item.label} style={{ marginBottom:12 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                      <span style={{ fontSize:11, color:item.pass?C.text:C.muted }}>{item.pass?"✅":"⚠️"} {item.label}</span>
                      <span style={{ fontSize:11, color:item.pass?C.ok:C.warn, fontFamily:"monospace", fontWeight:700 }}>{Math.min(item.score,item.max)}/{item.max}</span>
                    </div>
                    <div style={{ height:6, background:C.border, borderRadius:3, overflow:"hidden" }}>
                      <div style={{ height:"100%", width:`${(Math.min(item.score,item.max)/item.max)*100}%`, background:item.pass?C.ok:C.warn, borderRadius:3, transition:"width 0.5s" }} />
                    </div>
                  </div>
                ))}
              </Card>
            </div>
            <Card title="Personalised Recommendations" icon="🎯" color={wellnessColor}>
              {[
                {cond:concRoom>5000,icon:"💡",color:C.super,msg:`Unused concessional cap: ${aud(concRoom)}. Salary sacrificing saves ${aud((marginalRate-0.15)*concRoom)} in tax this year.`},
                {cond:inp.retirementAge<preservAge,icon:"⚠️",color:C.bad,msg:`Retire at ${inp.retirementAge} but preservation age is ${preservAge}. Need ${aud(inp.retirementExpenses*(preservAge-inp.retirementAge))} outside-super to bridge the gap.`},
                {cond:mc.successRate<0.75,icon:"🔴",color:C.bad,msg:`Monte Carlo ${pct(mc.successRate)} below 75%. Consider: salary sacrifice more, delay retirement, or reduce spending to ${aud(inp.retirementExpenses*0.85)}.`},
                {cond:totalRentalIncome===0&&inp.properties.length===1,icon:"🏘️",color:C.prop,msg:"Only a primary residence. An investment property adds rental income, property growth, and portfolio diversification."},
                {cond:agePensionAtRetire>0,icon:"✅",color:C.ok,msg:`You qualify for ${aud(agePensionAtRetire)} p.a. Age Pension (${aud(agePensionAtRetire/26)} fortnightly). This auto-increases as super depletes.`},
                {cond:!inp.estateHasWill,icon:"🏛️",color:"#a78bfa",msg:"No current Will. Without one, assets distributed under intestacy laws. Wills cost ~$300-500 via solicitor."},
                {cond:!inp.isSMSF&&inp.superBalance>400000,icon:"⚙️",color:C.smsf,msg:`Super balance ${aud(inp.superBalance)} — SMSF may be cost-effective (competitive above ~$350k). Gives direct property, shares, and greater control.`},
                {cond:mc.successRate>=0.9,icon:"🎉",color:C.ok,msg:`Excellent! ${pct(mc.successRate)} success rate, estate ${aud(endRow.netWorth||0)}. Consider earlier retirement, more spending, or a testamentary trust.`},
              ].filter(a=>a.cond).map((a,i)=><AlertBox key={i} icon={a.icon} color={a.color} msg={a.msg} />)}
            </Card>
          </>
        )}

      {/* ═══ NET WORTH ═══ */}
        {tab === "networth" && (() => {

          const nwTotalSuper     = inp.superBalance;
          const nwLiquid         = inp.outsideSuper;
          const nwAssetItems     = (inp.assetItems||[]).reduce((s,a) => s+(a.value||0), 0);
          const nwTotalLiquid    = nwLiquid + nwAssetItems;
          const pporEquityNW = (inp.ppor?.hasHome || (inp.ppor?.value||0) > 0)
            ? Math.max(0,(inp.ppor?.value||0)-(inp.ppor?.mortgage||0))
            : 0;
          const nwTotalAssets    = nwTotalSuper + totalPropertyValue + nwTotalLiquid + pporEquityNW;
          const nwNetWorth       = nwTotalAssets - totalDebt;
          const nwInvestable     = nwTotalSuper + totalPropertyEquity + nwTotalLiquid - totalDebt;
          const nwPensionAssets  = totalPropertyEquity + nwTotalLiquid;

          const TBC_LIMIT  = 2000000;
          const tbcUsed    = inp.tbcUsed || 0;
          const tbcRem     = TBC_LIMIT - tbcUsed;
          const tbcPct     = Math.round((tbcUsed / TBC_LIMIT) * 100);

          const ASFA_COMF   = 72663;
          const ASFA_MODEST = 45808;

          const yearsToRet  = Math.max(0, inp.retirementAge - inp.currentAge);
          const projSuper   = nwTotalSuper
            * Math.pow(1 + (inp.returnRate || 0.075), yearsToRet)
            + (inp.voluntarySuper + inp.annualIncome * 0.12)
            * ((Math.pow(1 + (inp.returnRate || 0.075), yearsToRet) - 1)
               / ((inp.returnRate || 0.075) || 0.001));
          const projIncome  = projSuper * 0.04 + (retireRow.agePension || 0);
          const incRepl     = Math.round((projIncome / Math.max(1, inp.retirementExpenses)) * 100);
          const incScore    = Math.min(40, (incRepl / 100) * 40);
          const wlthScore   = Math.min(30, (nwNetWorth / Math.max(1, inp.retirementExpenses * 20)) * 30);
          const tbcScore    = tbcUsed < TBC_LIMIT ? 15 : 5;
          const dbtScore    = nwTotalAssets > 0
            ? Math.max(0, 15 - (totalDebt / Math.max(nwNetWorth, 1)) * 15)
            : 15;
          const rdScore     = Math.round(Math.min(100, incScore + wlthScore + tbcScore + dbtScore));
          const rdColor     = rdScore >= 75 ? C.ok : rdScore >= 55 ? C.warn : C.bad;
          const rdLabel     = rdScore >= 75 ? "On Track" : rdScore >= 55 ? "Needs Attention" : "Action Required";

          const alloc = [
            { label: "Superannuation",  val: nwTotalSuper,              color: C.super   },
            { label: "Property Equity", val: Math.max(0, totalPropertyEquity), color: C.prop    },
            { label: "Cash & Shares",   val: nwLiquid,                  color: C.outside },
          ].filter(a => a.val > 0);
          const allocTotal = alloc.reduce((s, a) => s + a.val, 0) || 1;

          return (
            <>
             <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12, marginBottom:16, width:"100%" }}>
                {[
                  { label:"Total Net Worth",           val:nwNetWorth,      color:C.main,
                    sub:"Incl. PPOR + all assets", icon:"🏡" },
                  { label:"Investable Net Worth",      val:nwInvestable,    color:C.super,
                    sub:"Excl. PPOR — liquid wealth", icon:"💼" },
                  { label:"Pension-Assessable", val:nwPensionAssets, color:C.pension,
                    sub:"Excl. PPOR + super (pre-67)", icon:"🏛️" },
                ].map(m => (
                  <div key={m.label} style={{ background:"white", borderRadius:12,
                    border:`2px solid ${m.color}22`, padding:"12px 14px",
                    overflow:"hidden", minWidth:0 }}>
                    <div style={{ fontSize:16, marginBottom:3 }}>{m.icon}</div>
                    <div style={{ fontSize:9, color:C.muted, textTransform:"uppercase",
  letterSpacing:"0.04em", fontWeight:700, marginBottom:3,
  whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{m.label}</div>
                    <div style={{ fontSize:20, fontWeight:900, color:m.color,
                      fontFamily:"monospace" }}>{aud(m.val)}</div>
                    <div style={{ fontSize:10, color:C.muted, marginTop:2 }}>{m.sub}</div>
                  </div>
                ))}
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(140px, 1fr))", gap:8, marginBottom:16 }}>
                <KPI label="Net Worth Today"      value={aud(nwNetWorth)}    color={C.main}    size={20} />
                <KPI label="Total Super"          value={aud(nwTotalSuper)}  color={C.super}   sub={`${Math.round(nwTotalSuper/Math.max(1,nwTotalAssets)*100)}% of assets`} />
                <KPI label="Property Equity"      value={aud(Math.max(0,totalPropertyEquity))} color={C.prop} sub={`${inp.properties.length} propert${inp.properties.length===1?"y":"ies"}`} />
                 <KPI label="Cash & Shares"        value={aud(nwTotalLiquid)} color={C.outside} sub={`${(inp.assetItems||[]).filter(a=>a.value>0).length} classes + outside super`} />
                <KPI label="Total Debt"           value={aud(totalDebt)}     color={C.debt}    />
                <KPI label="TBC Remaining"        value={aud(tbcRem)}        color={C.super}   sub={`${tbcPct}% of $2M used`} />
                <KPI label="Readiness Score"      value={`${rdScore}/100`}   color={rdColor}   sub={rdLabel} />
                <KPI label="Income Replacement"   value={`${incRepl}%`}      color={incRepl >= 100 ? C.ok : C.warn} sub={`of ${aud(inp.retirementExpenses)} goal`} />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
                {/* ── Net Worth Sankey ── */}
              <Card title="Net Worth Sankey — Assets to Net Worth" icon="🌊" color={C.main}>
                <div style={{ display:"flex", gap:0, border:`1px solid ${C.border}`,
                  borderRadius:8, overflow:"hidden", marginBottom:14, width:"fit-content" }}>
                  {[["simple","Simple"],["detailed","Detailed"]].map(([m,l])=>(
                    <button key={m} onClick={()=>setNwSankeyMode(m)}
                      style={{ padding:"5px 18px", background:nwSankeyMode===m?C.main:C.card,
                        color:nwSankeyMode===m?"white":C.muted, border:"none",
                        fontSize:11, fontWeight:800, cursor:"pointer" }}>{l}</button>
                  ))}
                </div>
                {(() => {
                  const superVal  = inp.superBalance || 0;
                  const propVal   = Math.max(0, totalPropertyEquity);
                  const pporVal   = pporEquityNW || 0;
                  const cashVal   = inp.outsideSuper || 0;
                  const assetItemsVal = (inp.assetItems||[]).reduce((s,a)=>s+(a.value||0),0);
                  const totalAssets = superVal + propVal + pporVal + cashVal + assetItemsVal;
                  const debt      = totalDebt || 0;
                  const netWorth  = Math.max(0, totalAssets - debt);

                  if (nwSankeyMode === "simple") {
                    const nodes = [
                      ...(superVal>0      ? [{ id:"sup", label:"Super",       value:superVal,      col:0, color:C.super   }] : []),
                      ...(pporVal>0       ? [{ id:"ppor",label:"PPOR Equity", value:pporVal,       col:0, color:"#0891b2" }] : []),
                      ...(propVal>0       ? [{ id:"prp", label:"Prop Equity", value:propVal,       col:0, color:C.prop    }] : []),
                      ...(cashVal>0       ? [{ id:"cas", label:"Cash/Shares", value:cashVal,       col:0, color:C.outside }] : []),
                      ...(assetItemsVal>0 ? [{ id:"ait", label:"Assets",      value:assetItemsVal, col:0, color:"#7c3aed" }] : []),
                      { id:"tot", label:"Total Assets", value:totalAssets, col:1, color:C.text },
                      ...(debt>0    ? [{ id:"dbt", label:"Debt",      value:debt,      col:2, color:C.bad  }] : []),
                      { id:"nwt",   label:"Net Worth",  value:netWorth,                col:2, color:C.ok   },
                    ];
                    const links = [
                      ...(superVal>0      ? [{ source:"sup",  target:"tot", value:superVal,      color:C.super   }] : []),
                      ...(pporVal>0       ? [{ source:"ppor", target:"tot", value:pporVal,       color:"#0891b2" }] : []),
                      ...(propVal>0       ? [{ source:"prp",  target:"tot", value:propVal,       color:C.prop    }] : []),
                      ...(cashVal>0       ? [{ source:"cas",  target:"tot", value:cashVal,       color:C.outside }] : []),
                      ...(assetItemsVal>0 ? [{ source:"ait",  target:"tot", value:assetItemsVal, color:"#7c3aed" }] : []),
                      ...(debt>0    ? [{ source:"tot", target:"dbt", value:debt,      color:C.bad  }] : []),
                      { source:"tot", target:"nwt", value:netWorth,                              color:C.ok   },
                    ];
                    return <SankeyChart nodes={nodes} links={links} width={620} height={300} />;
                  }

                  // Detailed — break assets into sub-types
                  const assetItems = (inp.assetItems||[]).filter(a=>(a.value||0)>0);
                  const nodes = [
                    ...(superVal>0  ? [{ id:"sup",  label:"Super",       value:superVal,  col:0, color:C.super   }] : []),
                    ...(pporVal>0   ? [{ id:"ppor", label:"PPOR Equity", value:pporVal,   col:0, color:"#0891b2" }] : []),
                    ...(propVal>0   ? [{ id:"prp",  label:"Prop Equity", value:propVal,   col:0, color:C.prop    }] : []),
                    ...(cashVal>0   ? [{ id:"cas",  label:"Outside Super",value:cashVal,  col:0, color:C.outside }] : []),
                    ...assetItems.map(a=>({ id:`a_${a.id}`, label:a.label,
                      value:a.value, col:0, color:"#7c3aed" })),
                    { id:"tot", label:"Total Assets", value:totalAssets, col:1, color:C.text },
                    ...(debt>0  ? [{ id:"dbt", label:"Total Debt", value:debt,     col:2, color:C.bad }] : []),
                    { id:"nwt", label:"Net Worth",    value:netWorth,               col:2, color:C.ok  },
                    // Col 3 — debt breakdown
                    ...inp.properties.filter(p=>p.mortgage>0).map(p=>({
                      id:`m_${p.id}`, label:`${p.label} Mtg`,
                      value:p.mortgage, col:3, color:C.bad,
                    })),
                    ...inp.debts.filter(d=>d.balance>0).map(d=>({
                      id:`d_${d.id}`, label:d.label,
                      value:d.balance, col:3, color:"#ef4444",
                    })),
                  ];
                  const links = [
                    ...(superVal>0  ? [{ source:"sup",  target:"tot", value:superVal,  color:C.super   }] : []),
                    ...(pporVal>0   ? [{ source:"ppor", target:"tot", value:pporVal,   color:"#0891b2" }] : []),
                    ...(propVal>0   ? [{ source:"prp",  target:"tot", value:propVal,   color:C.prop    }] : []),
                    ...(cashVal>0   ? [{ source:"cas",  target:"tot", value:cashVal,   color:C.outside }] : []),
                    ...assetItems.map(a=>({ source:`a_${a.id}`, target:"tot",
                      value:a.value, color:"#7c3aed" })),
                    ...(debt>0  ? [{ source:"tot", target:"dbt", value:debt,     color:C.bad }] : []),
                    { source:"tot", target:"nwt", value:netWorth,                              color:C.ok  },
                    ...inp.properties.filter(p=>p.mortgage>0).map(p=>({
                      source:"dbt", target:`m_${p.id}`,
                      value:p.mortgage, color:C.bad,
                    })),
                    ...inp.debts.filter(d=>d.balance>0).map(d=>({
                      source:"dbt", target:`d_${d.id}`,
                      value:d.balance, color:"#ef4444",
                    })),
                  ];
                  return <SankeyChart nodes={nodes} links={links} width={820} height={360} />;
                })()}
              </Card>
                  <Card title="Asset Allocation" icon="🥧" color={C.main}>
                  <div style={{ display: "flex", height: 18, borderRadius: 6, overflow: "hidden", marginBottom: 10 }}>
                    {alloc.map(a => (
                      <div key={a.label} style={{ width: `${(a.val/allocTotal)*100}%`, background: a.color, minWidth: 2 }} />
                    ))}
                  </div>
                  {alloc.map(a => (
                    <div key={a.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", borderBottom: `1px solid ${C.border}`, fontSize: 11 }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: a.color, display: "inline-block" }} />
                        <span style={{ color: C.muted }}>{a.label}</span>
                      </span>
                      <span style={{ color: a.color, fontWeight: 700, fontFamily: "monospace" }}>
                        {aud(a.val)} <span style={{ color: C.muted, fontWeight: 400 }}>({Math.round(a.val/allocTotal*100)}%)</span>
                      </span>
                    </div>
                  ))}
                  <div style={{ background: C.bg, borderRadius: 8, padding: "9px 10px", fontSize: 10, color: C.muted, marginTop: 10 }}>
                    <div style={{ fontWeight: 800, color: C.main, marginBottom: 5, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.07em" }}>🇦🇺 ASFA Benchmarks (couple, FY2025)</div>
                    <div style={{ display: "flex", gap: "1.5rem" }}>
                      <div><div style={{ fontSize: 9 }}>Modest</div><div style={{ fontWeight: 800, color: C.text }}>{aud(ASFA_MODEST)}/yr</div></div>
                      <div><div style={{ fontSize: 9 }}>Comfortable</div><div style={{ fontWeight: 800, color: C.ok }}>{aud(ASFA_COMF)}/yr</div></div>
                      <div><div style={{ fontSize: 9 }}>Your Goal</div><div style={{ fontWeight: 800, color: C.main }}>{aud(inp.retirementExpenses)}/yr</div></div>
                    </div>
                  </div>
                </Card>

                <Card title="Assets vs Liabilities" icon="📋" color={C.main}>
                  <div style={{ fontSize: 10, color: C.super, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Assets</div>
                  {[
                    ["Superannuation",       nwTotalSuper,       C.super  ],
                    ["Property (gross)",     totalPropertyValue, C.prop   ],
                    ["Cash & Shares",        nwLiquid,           C.outside],
                  ].map(([k, v, c]) => v > 0 && (
                    <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: `1px solid ${C.border}`, fontSize: 11 }}>
                      <span style={{ color: C.muted }}>{k}</span>
                      <span style={{ color: c, fontWeight: 600, fontFamily: "monospace" }}>{aud(v)}</span>
                    </div>
                  ))}
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontWeight: 800, fontSize: 11, borderTop: `1px solid ${C.border}`, marginTop: 2 }}>
                    <span style={{ color: C.muted }}>Total Assets</span>
                    <span style={{ color: C.ok, fontFamily: "monospace" }}>{aud(nwTotalAssets)}</span>
                  </div>
                  <div style={{ height: 1, background: C.border, margin: "8px 0" }} />
                  <div style={{ fontSize: 10, color: C.debt, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Liabilities</div>
                  {[
                    ["Mortgages",   inp.properties.reduce((s,p) => s+(p.mortgage||0), 0), C.debt],
                    ["Other Debts", inp.debts.reduce((s,d) => s+(d.balance||0), 0),       C.debt],
                  ].map(([k, v, c]) => v > 0 && (
                    <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: `1px solid ${C.border}`, fontSize: 11 }}>
                      <span style={{ color: C.muted }}>{k}</span>
                      <span style={{ color: c, fontWeight: 600, fontFamily: "monospace" }}>({aud(v)})</span>
                    </div>
                  ))}
                  {totalDebt === 0 && <div style={{ fontSize: 11, color: C.ok, padding: "4px 0" }}>✓ Debt free</div>}
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontWeight: 800, fontSize: 11, borderTop: `1px solid ${C.border}`, marginTop: 2 }}>
                    <span style={{ color: C.muted }}>Total Liabilities</span>
                    <span style={{ color: C.debt, fontFamily: "monospace" }}>({aud(totalDebt)})</span>
                  </div>
                  <div style={{ background: C.text, borderRadius: 8, padding: "10px 12px", marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ color: "rgba(255,255,255,0.6)", fontSize: 12, fontWeight: 700 }}>Net Worth</span>
                    <span style={{ color: "#4ade80", fontFamily: "monospace", fontSize: 18, fontWeight: 900 }}>{aud(nwNetWorth)}</span>
                  </div>
                </Card>
              </div>

              <Card title="Net Worth Projection to Age 90" icon="📈" color={C.main}>
                <div style={{ fontSize: 11, color: C.muted, marginBottom: 10 }}>
                  Based on {((inp.returnRate||0.075)*100).toFixed(1)}% super return · {((inp.propertyGrowthRate||0.04)*100).toFixed(1)}% property growth · retirement at age {inp.retirementAge}
                </div>
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={proj.filter(cf)}>
                    <defs>
                      <linearGradient id="nwg1" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={C.main} stopOpacity={0.3}/><stop offset="95%" stopColor={C.main} stopOpacity={0}/></linearGradient>
                      <linearGradient id="nwg2" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={C.super} stopOpacity={0.2}/><stop offset="95%" stopColor={C.super} stopOpacity={0}/></linearGradient>
                      <linearGradient id="nwg3" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={C.prop} stopOpacity={0.2}/><stop offset="95%" stopColor={C.prop} stopOpacity={0}/></linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                    <XAxis dataKey="age" stroke={C.muted} tick={{ fontSize: 10 }} />
                    <YAxis stroke={C.muted} tick={{ fontSize: 10 }} tickFormatter={v => `$${(v/1e6).toFixed(1)}M`} />
                    <Tooltip content={<TT />} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <ReferenceLine x={inp.retirementAge} stroke="#a78bfa" strokeDasharray="4 2" label={{ value: `Retire ${inp.retirementAge}`, fill: "#a78bfa", fontSize: 8 }} />
                    <ReferenceLine x={67} stroke={C.pension} strokeDasharray="2 4" label={{ value: "AP 67", fill: C.pension, fontSize: 8 }} />
                    <Area type="monotone" dataKey="netWorth"       name="Total Net Worth"  stroke={C.main}    fill="url(#nwg1)" strokeWidth={2.5} dot={false} />
                    <Area type="monotone" dataKey="superPension"   name="Super (Pension)"  stroke={C.super}   fill="url(#nwg2)" strokeWidth={1.5} dot={false} />
                    <Area type="monotone" dataKey="propertyEquity" name="Property Equity"  stroke={C.prop}    fill="url(#nwg3)" strokeWidth={1.5} dot={false} />
                    <Area type="monotone" dataKey="outside"        name="Outside Super"    stroke={C.outside} fill="none"       strokeWidth={1.5} strokeDasharray="3 2" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </Card>

              <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 14, marginTop: 14 }}>
                <Card title="Readiness Score" icon="🎯" color={rdColor}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "12px 0 8px" }}>
                    {(() => {
                      const r = 44, circ = 2 * Math.PI * r;
                      const offset = circ - (rdScore / 100) * circ;
                      return (
                        <svg width={110} height={110} viewBox="0 0 110 110">
                          <circle cx={55} cy={55} r={r} fill="none" stroke={C.border} strokeWidth={9} />
                          <circle cx={55} cy={55} r={r} fill="none" stroke={rdColor} strokeWidth={9}
                            strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
                            transform="rotate(-90 55 55)" />
                          <text x={55} y={51} textAnchor="middle" dominantBaseline="middle"
                            fontSize={24} fontWeight={900} fill={rdColor} fontFamily="monospace">{rdScore}</text>
                          <text x={55} y={66} textAnchor="middle" dominantBaseline="middle"
                            fontSize={8} fill={C.muted} fontFamily="sans-serif">OUT OF 100</text>
                        </svg>
                      );
                    })()}
                    <div style={{ fontSize: 11, fontWeight: 800, color: rdColor, textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 4 }}>{rdLabel}</div>
                  </div>
                  <div style={{ minWidth: 180 }}>
                    {[
                      { label: "Income Replacement", val: `${incRepl}%`,  ok: incRepl >= 100 },
                      { label: "Super Checkpoint",   val: aud(nwTotalSuper), ok: nwTotalSuper >= 200000 },
                      { label: "Debt-to-Assets",     val: `${Math.round(totalDebt/Math.max(nwTotalAssets,1)*100)}%`, ok: totalDebt/Math.max(nwTotalAssets,1) < 0.4 },
                      { label: "TBC Headroom",       val: aud(tbcRem),    ok: tbcRem > 200000 },
                    ].map(c => (
                      <div key={c.label} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: `1px solid ${C.border}`, fontSize: 11 }}>
                        <span style={{ color: C.muted }}>{c.label}</span>
                        <span style={{ fontWeight: 700, fontFamily: "monospace", color: c.ok ? C.ok : C.warn }}>{c.ok ? "✓ " : "⚠ "}{c.val}</span>
                      </div>
                    ))}
                  </div>
                </Card>

                <Card title="Top Actions to Improve Your Score" icon="💡" color={C.main}>
                  {[
                    {
                      show: incRepl < 100,
                      pri: "HIGH", priColor: C.bad, bg: "#fef2f2",
                      title: "Boost Super Contributions",
                      body: `Projected income (${aud(projIncome)}/yr) covers only ${incRepl}% of your ${aud(inp.retirementExpenses)}/yr goal.`,
                      au: `You have ${aud(Math.max(0, 30000 - inp.annualIncome*0.12 - inp.voluntarySuper))} unused concessional cap. Salary sacrifice saves ${pct(getMarginalRate(inp.annualIncome)-0.15)} vs taking it as salary.`,
                    },
                    {
                      show: tbcPct > 80,
                      pri: "HIGH", priColor: C.warn, bg: "#fffbeb",
                      title: "Transfer Balance Cap Warning",
                      body: `${tbcPct}% of the $2M TBC used. Excess pension assets attract 15% tax on earnings.`,
                      au: "Consider keeping funds in accumulation phase. See the TTR tab for strategy options.",
                    },
                    {
                      show: inp.debts.reduce((s,d) => s+d.balance, 0) > 10000,
                      pri: "MED", priColor: C.warn, bg: "#fff7ed",
                      title: "Pay Down High-Interest Debt",
                      body: `${aud(inp.debts.reduce((s,d) => s+d.balance, 0))} in personal debt — check the Debts tab.`,
                      au: "Non-deductible personal debt should typically be cleared before extra super contributions.",
                    },
                    {
                      show: !inp.estateHasWill,
                      pri: "LOW", priColor: "#a78bfa", bg: "#f5f3ff",
                      title: "No Will Recorded",
                      body: "Without a Will, assets may be distributed under intestacy laws, not your wishes.",
                      au: "Also check super Binding Death Nominations — they lapse every 3 years. See Estate tab.",
                    },
                    {
                      show: rdScore >= 75,
                      pri: "INFO", priColor: C.ok, bg: "#f0fdf4",
                      title: "Strong Position — Review Estate Plans",
                      body: `Readiness score ${rdScore}/100. Focus on wealth protection and tax-efficient transfer.`,
                      au: "Super death benefits to non-dependants attract 17% tax. A testamentary trust can reduce this for large estates.",
                    },
                  ].filter(a => a.show).map((a, i) => (
                    <div key={i} style={{ background: a.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px", marginBottom: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}>
                        <span style={{ background: a.priColor, color: "#fff", fontSize: 9, fontFamily: "monospace", letterSpacing: "0.1em", padding: "1px 7px", borderRadius: 100, fontWeight: 800 }}>{a.pri}</span>
                        <span style={{ fontWeight: 800, color: C.text, fontSize: 12 }}>{a.title}</span>
                      </div>
                      <div style={{ fontSize: 11, color: C.text, lineHeight: 1.55, marginBottom: 6 }}>{a.body}</div>
                      <div style={{ fontSize: 10, color: C.muted, background: "rgba(0,0,0,0.03)", borderRadius: 5, padding: "5px 8px", lineHeight: 1.5 }}>🇦🇺 {a.au}</div>
                    </div>
                  ))}
                </Card>
              </div>

              <Card title="Net Worth at a Glance — 5-Year Milestones" icon="📊" color={C.main} action={<Badge color={C.main}>Live data</Badge>}>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
                    <thead>
                      <tr style={{ borderBottom: `2px solid ${C.border}`, background: C.bg }}>
                        {["Age","Year","Super","Property Equity","Outside Super","Total Debt","Net Worth"].map(h => (
                          <th key={h} style={{ padding: "6px 8px", textAlign: "right", color: C.muted, fontWeight: 700, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {proj
                        .filter(d => d.age % 5 === 0 || d.age === inp.retirementAge || d.age === inp.currentAge)
                        .filter((d, i, arr) => arr.findIndex(x => x.age === d.age) === i)
                        .map((d, i) => (
                          <tr key={d.age} style={{ borderBottom: `1px solid ${C.border}11`, background: d.age === inp.retirementAge ? "#eff6ff" : d.age === inp.currentAge ? "#f0fdf4" : i%2===0 ? "transparent" : `${C.bg}88` }}>
                            {[
                              [d.age === inp.retirementAge ? `${d.age} 🎯` : d.age === inp.currentAge ? `${d.age} 📍` : d.age, d.age === inp.retirementAge ? C.super : d.age === inp.currentAge ? C.ok : C.muted],
                              [d.year,                              C.muted  ],
                              [aud(d.super + d.superPension),       C.super  ],
                              [aud(d.propertyEquity),               C.prop   ],
                              [aud(d.outside),                      C.outside],
                              [aud(d.totalDebt),                    C.debt   ],
                              [aud(d.netWorth),                     C.main   ],
                            ].map(([v, c], j) => (
                              <td key={j} style={{ padding: "5px 8px", textAlign: "right", color: c, fontFamily: "monospace", fontWeight: j===6 ? 800 : 400 }}>{v}</td>
                            ))}
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </Card>
{/* ABS Peer Comparison */}
{(() => {
  // ABS SIH 2019-20 mean net worth by age group ($'000) — adjusted ~15% for 2024 CPI
  const ABS_DATA = [
    { age: "25–29", mean: 278,  p25: 28,   median: 105,  p75: 385  },
    { age: "30–34", mean: 507,  p25: 68,   median: 280,  p75: 720  },
    { age: "35–39", mean: 638,  p25: 120,  median: 410,  p75: 940  },
    { age: "40–44", mean: 967,  p25: 210,  median: 600,  p75: 1350 },
    { age: "45–49", mean: 1213, p25: 320,  median: 790,  p75: 1700 },
    { age: "50–54", mean: 1394, p25: 400,  median: 980,  p75: 2050 },
    { age: "55–59", mean: 1671, p25: 480,  median: 1180, p75: 2400 },
    { age: "60–64", mean: 1841, p25: 510,  median: 1250, p75: 2650 },
    { age: "65–69", mean: 2110, p25: 490,  median: 1200, p75: 2700 },
    { age: "70–74", mean: 1735, p25: 420,  median: 1050, p75: 2400 },
    { age: "75+",   mean: 1342, p25: 310,  median: 780,  p75: 2000 },
  ];

  // Find user's age group
  const age = inp.currentAge;
  const band = age < 30 ? "25–29"
    : age < 35 ? "30–34"
    : age < 40 ? "35–39"
    : age < 45 ? "40–44"
    : age < 50 ? "45–49"
    : age < 55 ? "50–54"
    : age < 60 ? "55–59"
    : age < 65 ? "60–64"
    : age < 70 ? "65–69"
    : age < 75 ? "70–74" : "75+";

  const peer = ABS_DATA.find(d => d.age === band) || ABS_DATA[4];
  const nwK = Math.round(nwNetWorth / 1000);

  // Determine percentile bracket
  const pctLabel = nwNetWorth < peer.p25 * 1000 ? "Bottom 25%"
    : nwNetWorth < peer.median * 1000 ? "25th – 50th percentile"
    : nwNetWorth < peer.p75 * 1000 ? "50th – 75th percentile (above median)"
    : nwNetWorth < peer.mean * 1000 * 1.5 ? "Top 25%"
    : "Top 10% (estimated)";

  const pctColor = nwNetWorth < peer.p25 * 1000 ? C.bad
    : nwNetWorth < peer.median * 1000 ? C.warn
    : C.ok;

  // Bar chart data — show user's net worth vs peer benchmarks
  const barData = [
    { label: "25th %ile", value: peer.p25,   color: "#e5e7eb" },
    { label: "Median",    value: peer.median, color: "#93c5fd" },
    { label: "75th %ile", value: peer.p75,   color: "#60a5fa" },
    { label: "Mean",      value: peer.mean,  color: "#3b82f6" },
    { label: "You",       value: nwK,        color: C.main,   isUser: true },
  ];
  const maxVal = Math.max(...barData.map(b => b.value), 1);

  return (
    <Card title={`How You Compare — Australians Aged ${band}`} icon="🇦🇺" color={C.super}
      action={<Badge color={C.muted} style={{ fontSize: 9 }}>ABS SIH 2019-20 (CPI-adjusted)</Badge>}>

      {/* Percentile Badge */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ background: pctColor, color: "#fff", borderRadius: 20, padding: "5px 16px", fontWeight: 800, fontSize: 13 }}>
          {pctLabel}
        </div>
        <div style={{ fontSize: 12, color: C.muted }}>
          for age {band} Australian households
        </div>
      </div>

      {/* Horizontal bar chart */}
      <div style={{ marginBottom: 14 }}>
        {barData.map(b => (
          <div key={b.label} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <div style={{ width: 70, fontSize: 10, color: b.isUser ? C.main : C.muted, fontWeight: b.isUser ? 800 : 400, textAlign: "right", flexShrink: 0 }}>
              {b.label}
            </div>
            <div style={{ flex: 1, background: "#f3f4f6", borderRadius: 4, height: b.isUser ? 22 : 16, overflow: "hidden", position: "relative" }}>
              <div style={{
                width: `${Math.min(100, (b.value / maxVal) * 100)}%`,
                background: b.isUser ? `linear-gradient(90deg, ${C.main}, #4ade80)` : b.color,
                height: "100%",
                borderRadius: 4,
                transition: "width 0.4s ease",
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
                paddingRight: 6,
              }}>
                {b.value > maxVal * 0.25 && (
                  <span style={{ fontSize: 9, fontWeight: 700, color: b.isUser ? "#fff" : "#374151" }}>
                    {aud(b.value * 1000)}
                  </span>
                )}
              </div>
              {b.value <= maxVal * 0.25 && (
                <span style={{ position: "absolute", left: `${Math.min(100, (b.value / maxVal) * 100) + 1}%`, top: "50%", transform: "translateY(-50%)", fontSize: 9, color: "#374151", fontWeight: b.isUser ? 700 : 400 }}>
                  {aud(b.value * 1000)}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Quick stats row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6, marginBottom: 10 }}>
        {[
          { label: "Your Net Worth",  val: aud(nwNetWorth),         color: C.main  },
          { label: `Median (${band})`, val: aud(peer.median * 1000), color: C.super },
          { label: "vs Median",       val: `${nwNetWorth >= peer.median*1000 ? "+" : ""}${aud(nwNetWorth - peer.median*1000)}`, color: nwNetWorth >= peer.median*1000 ? C.ok : C.bad },
          { label: `Mean (${band})`,  val: aud(peer.mean * 1000),   color: C.muted },
        ].map(s => (
          <div key={s.label} style={{ background: C.bg, borderRadius: 8, padding: "8px 10px", textAlign: "center" }}>
            <div style={{ fontSize: 9, color: C.muted, marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.06em" }}>{s.label}</div>
            <div style={{ fontSize: 12, fontWeight: 800, color: s.color, fontFamily: "monospace" }}>{s.val}</div>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 9, color: C.muted, background: C.bg, borderRadius: 6, padding: "7px 10px", lineHeight: 1.6 }}>
        📊 <strong>Source:</strong> ABS Survey of Income and Housing 2019–20, adjusted for CPI to approximate 2024 values.
        Mean is skewed higher by top-wealth households — median is the more typical benchmark.
        Percentile brackets are approximate. This is general information only (ASIC RG 244).
      </div>
    </Card>
  );
})()}
              {tbcPct > 80 && (
                <AlertBox icon="⚠️" color={C.warn}
                  msg={`Transfer Balance Cap: ${tbcPct}% used — only ${aud(tbcRem)} of tax-free pension space remaining. Excess pension balances attract 15% tax on earnings.`} />
              )}

              <div style={{ textAlign: "center", fontSize: 9, color: C.muted, padding: "10px 0", borderTop: `1px solid ${C.border}`, marginTop: 4 }}>
                🇦🇺 ASFA FY2025 · TBC $2,000,000 · ATO FY2025-26 · General Advice only — not personal financial advice (ASIC RG 244)
              </div>
            </>
          );
        })()}
        {tab === "reports" && (
          <>
            {/* PDF DOWNLOAD BUTTON */}
            <div style={{ display:"flex", gap:10, marginBottom:16, alignItems:"center", flexWrap:"wrap" }}>
              <button
                onClick={() => {
                  // Load jsPDF + html2canvas dynamically then generate PDF
                  const loadScript = (src) => new Promise((res, rej) => {
                    if (document.querySelector(`script[src="${src}"]`)) return res();
                    const s = document.createElement("script");
                    s.src = src;
                    s.onload = res;
                    s.onerror = rej;
                    document.head.appendChild(s);
                  });
                  setPdfLoading(true);
                  Promise.all([
                    loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"),
                    loadScript("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"),
                  ]).then(() => {
                    const { jsPDF } = window.jspdf;
                    const el = document.getElementById("pdf-report-content");
                    window.html2canvas(el, {
                      scale: 2,
                      useCORS: true,
                      backgroundColor: "#f4faf6",
                      logging: false,
                    }).then(canvas => {
                      const imgData = canvas.toDataURL("image/png");
                      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
                      const pdfW = pdf.internal.pageSize.getWidth();
                      const pdfH = pdf.internal.pageSize.getHeight();
                      const canvasW = canvas.width;
                      const canvasH = canvas.height;
                      const ratio = pdfW / canvasW;
                      const totalH = canvasH * ratio;
                      let yOffset = 0;
                      let page = 0;
                      while (yOffset < totalH) {
                        if (page > 0) pdf.addPage();
                        pdf.addImage(imgData, "PNG", 0, -yOffset, pdfW, totalH);
                        yOffset += pdfH;
                        page++;
                      }
                      pdf.save(`AUS-Retirement-Plan-Age${inp.currentAge}-${new Date().getFullYear()}.pdf`);
                      setPdfLoading(false);
                    });
                  }).catch(() => setPdfLoading(false));
                }}
                style={{ background: "linear-gradient(135deg, #16a34a, #3b82f6)", border:"none", borderRadius:8, padding:"10px 22px", color:"white", fontSize:13, fontWeight:900, cursor:"pointer", display:"flex", alignItems:"center", gap:8, fontFamily:"monospace" }}>
                {pdfLoading ? "⏳ Generating PDF..." : "📄 Download PDF Report"}
              </button>
              <span style={{ fontSize:11, color:C.muted }}>Includes all inputs, outputs, projections table & charts</span>
            </div>

            {/* HIDDEN PDF CONTENT — rendered off-screen for capture */}
            <div id="pdf-report-content" style={{ background:"#f4faf6", padding:24, fontFamily:"monospace", color:"#1a2e1d" }}>

              {/* COVER */}
              <div style={{ textAlign:"center", padding:"30px 0 20px", borderBottom:"2px solid #16a34a", marginBottom:20 }}>
                <div style={{ fontSize:28, fontWeight:900, color:"#16a34a" }}>🦘 AUS Retirement Pro</div>
                <div style={{ fontSize:14, color:"#4b7055", marginTop:6 }}>Australian Retirement Plan — Full Report</div>
                <div style={{ fontSize:12, color:"#4b7055", marginTop:4 }}>Generated: {new Date().toLocaleDateString("en-AU", {day:"2-digit",month:"long",year:"numeric"})} · ATO FY2025-26</div>
                <div style={{ display:"flex", justifyContent:"center", gap:16, marginTop:14, flexWrap:"wrap" }}>
                  {[["Born",inp.birthYear],["Current Age",inp.currentAge],["Retire At",inp.retirementAge],["Status",inp.married?"Couple":"Single"],["SMSF",inp.isSMSF?"Yes":"No"],["Wellness",`${wellnessGrade} ${wellnessTotal}/100`]].map(([k,v])=>(
                    <div key={k} style={{ background:"#ffffff", border:"1px solid #cde0d4", borderRadius:8, padding:"8px 14px", textAlign:"center" }}>
                      <div style={{ fontSize:9, color:"#4b7055", textTransform:"uppercase" }}>{k}</div>
                      <div style={{ fontSize:14, fontWeight:800, color:"#16a34a" }}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* SECTION 1 — KEY OUTCOMES */}
              <div style={{ fontSize:13, fontWeight:900, color:"#16a34a", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:10 }}>1. Key Outcomes</div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, marginBottom:20 }}>
                {[
                  ["Super at Retirement", aud((retireRow.superPension||0)+(retireRow.super||0)), "#3b82f6"],
                  ["Net Worth at Retirement", aud(retireRow.netWorth||0), "#16a34a"],
                  ["Age Pension p.a.", agePensionAtRetire>0?aud(agePensionAtRetire):"Not eligible", "#8b5cf6"],
                  ["Monte Carlo Success", pct(mc.successRate), successColor],
                  ["Total Property Value", aud(totalPropertyValue), "#f59e0b"],
                  ["Net Rental Income p.a.", aud(totalRentalIncome), "#f59e0b"],
                  ["Estate at Age 90", aud(endRow.netWorth||0), "#a78bfa"],
                  ["Wellness Score", `${wellnessGrade} (${wellnessTotal}/100)`, wellnessColor],
                ].map(([k,v,c])=>(
                  <div key={k} style={{ background:"#ffffff", border:`1px solid ${c}33`, borderTop:`2px solid ${c}`, borderRadius:8, padding:"10px 12px" }}>
                    <div style={{ fontSize:9, color:"#4b7055", textTransform:"uppercase", marginBottom:4 }}>{k}</div>
                    <div style={{ fontSize:16, fontWeight:900, color:c }}>{v}</div>
                  </div>
                ))}
              </div>

              {/* SECTION 2 — INPUTS */}
              <div style={{ fontSize:13, fontWeight:900, color:"#16a34a", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:10 }}>2. Your Inputs</div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12, marginBottom:20 }}>
                {/* Personal */}
                <div style={{ background:"#ffffff", border:"1px solid #cde0d4", borderRadius:8, padding:12 }}>
                  <div style={{ fontSize:10, color:"#a78bfa", fontWeight:800, marginBottom:8 }}>PERSONAL</div>
                  {[["Birth Year",inp.birthYear],["Current Age",inp.currentAge],["Retirement Age",inp.retirementAge],["Life Expectancy",inp.lifeExpectancy],["Years to Retire",Math.max(0,inp.retirementAge-inp.currentAge)],["Years in Retirement",inp.lifeExpectancy-inp.retirementAge],["Preservation Age",preservAge],["Status",inp.married?"Couple/De Facto":"Single"],["Homeowner",inp.homeowner?"Yes":"No"],["SMSF",inp.isSMSF?"Yes":"No"]].map(([k,v])=>(
                    <div key={k} style={{ display:"flex", justifyContent:"space-between", padding:"4px 0", borderBottom:"1px solid #cde0d466", fontSize:10 }}>
                      <span style={{ color:"#4b7055" }}>{k}</span><span style={{ color:"#1a2e1d", fontWeight:600 }}>{v}</span>
                    </div>
                  ))}
                </div>
                {/* Income & Expenses */}
                <div style={{ background:"#ffffff", border:"1px solid #cde0d4", borderRadius:8, padding:12 }}>
                  <div style={{ fontSize:10, color:"#16a34a", fontWeight:800, marginBottom:8 }}>INCOME & EXPENSES</div>
                  {[["Gross Salary",aud(inp.annualIncome)],["Partner Salary",aud(inp.partnerIncome)],["Other Income",aud(inp.otherIncome)],["Current Expenses",aud(inp.annualExpenses)],["Retirement Expenses",aud(inp.retirementExpenses)],["ATO Tax (salary)",aud(annualTax)],["Net Take-Home",aud(netTakeHome)],["Effective Tax Rate",pct(annualTax/Math.max(1,inp.annualIncome))],["Marginal Rate",pct(marginalRate)],["Savings Rate",`${((inp.annualSavingsRate||0)*100).toFixed(0)}%`]].map(([k,v])=>(
                    <div key={k} style={{ display:"flex", justifyContent:"space-between", padding:"4px 0", borderBottom:"1px solid #cde0d466", fontSize:10 }}>
                      <span style={{ color:"#4b7055" }}>{k}</span><span style={{ color:"#1a2e1d", fontWeight:600 }}>{v}</span>
                    </div>
                  ))}
                </div>
                {/* Super & Returns */}
                <div style={{ background:"#ffffff", border:"1px solid #cde0d4", borderRadius:8, padding:12 }}>
                  <div style={{ fontSize:10, color:"#3b82f6", fontWeight:800, marginBottom:8 }}>SUPER & ASSUMPTIONS</div>
                  {[["Super Balance",aud(inp.superBalance)],["Salary Sacrifice",aud(inp.voluntarySuper)],["Non-Concessional",aud(inp.extraSuper)],["Outside Super",aud(inp.outsideSuper)],["SG Rate",`${(sgRate*100).toFixed(1)}%`],["Total Contribs p.a.",aud(totalSuperContrib)],["Unused Cap",aud(concRoom)],["Return Rate",pct(inp.returnRate)],["Inflation (CPI)",pct(inp.inflationRate)],["Property Growth",pct(inp.propertyGrowthRate)],["SMSF Admin Cost",inp.isSMSF?aud(inp.smsfAdminCost):"N/A"]].map(([k,v])=>(
                    <div key={k} style={{ display:"flex", justifyContent:"space-between", padding:"4px 0", borderBottom:"1px solid #cde0d466", fontSize:10 }}>
                      <span style={{ color:"#4b7055" }}>{k}</span><span style={{ color:"#1a2e1d", fontWeight:600 }}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* SECTION 3 — PROPERTIES */}
              <div style={{ fontSize:13, fontWeight:900, color:"#f59e0b", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:10 }}>3. Property Portfolio</div>
              <div style={{ display:"grid", gridTemplateColumns:`repeat(${Math.min(inp.properties.length,3)},1fr)`, gap:10, marginBottom:20 }}>
                {inp.properties.map(p=>(
                  <div key={p.id} style={{ background:"#ffffff", border:"1px solid #f59e0b33", borderTop:"2px solid #f59e0b", borderRadius:8, padding:12 }}>
                    <div style={{ fontSize:11, color:"#f59e0b", fontWeight:800, marginBottom:6 }}>{p.label} {p.isNewBuild?"🏗️":""} {p.isPrimary?"🏠":""}</div>
                    {[["Value",aud(p.value)],["Mortgage",aud(p.mortgage)],["Equity",aud(p.value-p.mortgage)],["Weekly Rent",`${aud(p.weeklyRent)}/wk`],["Net Rent p.a.",aud((p.weeklyRent||0)*52*(1-(p.expenseRatio||0.25)))],["Gross Yield",pct((p.weeklyRent||0)*52/Math.max(1,p.value))],["Loan Years",p.loanYears],["Primary Res.",p.isPrimary?"Yes (AP exempt)":"No"]].map(([k,v])=>(
                      <div key={k} style={{ display:"flex", justifyContent:"space-between", padding:"3px 0", borderBottom:"1px solid #cde0d466", fontSize:10 }}>
                        <span style={{ color:"#4b7055" }}>{k}</span><span style={{ color:"#1a2e1d", fontWeight:600 }}>{v}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              <div style={{ display:"flex", gap:20, background:"#ffffff", border:"1px solid #f59e0b33", borderRadius:8, padding:12, marginBottom:20 }}>
                {[["Total Portfolio Value",aud(totalPropertyValue),"#f59e0b"],["Total Equity",aud(totalPropertyEquity),"#f59e0b"],["Total Mortgage",aud(inp.properties.reduce((s,p)=>s+(p.mortgage||0),0)),"#ef4444"],["Net Rental p.a.",aud(totalRentalIncome),"#059669"]].map(([k,v,c])=>(
                  <div key={k} style={{ flex:1, textAlign:"center" }}>
                    <div style={{ fontSize:9, color:"#4b7055", textTransform:"uppercase", marginBottom:3 }}>{k}</div>
                    <div style={{ fontSize:16, fontWeight:900, color:c }}>{v}</div>
                  </div>
                ))}
              </div>

              {/* SECTION 4 — PROJECTIONS TABLE */}
              <div style={{ fontSize:13, fontWeight:900, color:"#16a34a", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:10 }}>4. Projections Table (5-Year Intervals)</div>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:10, marginBottom:20 }}>
                <thead>
                  <tr style={{ background:"#ffffff", borderBottom:"2px solid #16a34a" }}>
                    {["Age","Year","Super Balance","Outside Super","Prop. Equity","Net Worth","Rental p.a.","Age Pension","Expenses"].map(h=>(
                      <th key={h} style={{ padding:"6px 8px", color:"#16a34a", textAlign:"right", fontWeight:800, fontSize:9 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {proj.filter(d=>d.age%5===0||d.age===inp.retirementAge||d.age===67).filter((d,i,arr)=>arr.findIndex(x=>x.age===d.age)===i).map((d,i)=>(
                    <tr key={d.age} style={{ background: d.age===inp.retirementAge?"#eff6ff":d.age===67?"#f5f3ff":i%2===0?"#f8faf800":"transparent", borderBottom:"1px solid #cde0d433" }}>
                      {[
                        [d.age===inp.retirementAge?`${d.age} 🎯`:d.age===67?`${d.age} 👴`:d.age, d.age===inp.retirementAge?"#3b82f6":d.age===67?"#8b5cf6":"#4b7055"],
                        [d.year,"#4b7055"],
                        [aud(d.super+d.superPension),"#3b82f6"],
                        [aud(d.outside),"#059669"],
                        [aud(d.propertyEquity),"#f59e0b"],
                        [aud(d.netWorth),"#16a34a"],
                        [aud(d.rentalIncome),"#f59e0b"],
                        [aud(d.agePension),"#8b5cf6"],
                        [aud(d.expenses),"#ef4444"],
                      ].map(([v,c],j)=>(
                        <td key={j} style={{ padding:"5px 8px", textAlign:"right", color:c, fontWeight: j===5?800:400 }}>{v}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* SECTION 5 — NET WORTH CHART (using Recharts rendered in DOM) */}
              <div style={{ fontSize:13, fontWeight:900, color:"#16a34a", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:10 }}>5. Net Worth Projection Chart</div>
              <div style={{ background:"#ffffff", border:"1px solid #cde0d4", borderRadius:8, padding:16, marginBottom:20 }}>
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={proj.filter(d=>d.age%2===0||d.age===inp.retirementAge)}>
                    <defs>
                      <linearGradient id="pdf-g1" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#16a34a" stopOpacity={0.3}/><stop offset="95%" stopColor="#16a34a" stopOpacity={0}/></linearGradient>
                      <linearGradient id="pdf-g2" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2}/><stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/></linearGradient>
                      <linearGradient id="pdf-g3" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#f59e0b" stopOpacity={0.2}/><stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/></linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#cde0d4" />
                    <XAxis dataKey="age" stroke="#4b7055" tick={{ fontSize:10 }} />
                    <YAxis stroke="#4b7055" tick={{ fontSize:10 }} tickFormatter={v=>`$${(v/1e6).toFixed(1)}M`} />
                    <Tooltip content={<TT />} />
                    <Legend wrapperStyle={{ fontSize:10 }} />
                    <ReferenceLine x={inp.retirementAge} stroke="#a78bfa" strokeDasharray="4 2" label={{ value:`Retire ${inp.retirementAge}`, fill:"#a78bfa", fontSize:9 }} />
                    <ReferenceLine x={67} stroke="#8b5cf6" strokeDasharray="2 4" label={{ value:"AP 67", fill:"#8b5cf6", fontSize:9 }} />
                    <Area type="monotone" dataKey="netWorth" name="Total Net Worth" stroke="#16a34a" fill="url(#pdf-g1)" strokeWidth={2.5} dot={false} />
                    <Area type="monotone" dataKey="superPension" name="Super" stroke="#3b82f6" fill="url(#pdf-g2)" strokeWidth={1.5} dot={false} />
                    <Area type="monotone" dataKey="propertyEquity" name="Property Equity" stroke="#f59e0b" fill="url(#pdf-g3)" strokeWidth={1.5} dot={false} />
                    <Area type="monotone" dataKey="outside" name="Outside Super" stroke="#059669" fill="none" strokeWidth={1.5} strokeDasharray="3 2" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* SECTION 6 — INCOME vs EXPENSES CHART */}
              <div style={{ fontSize:13, fontWeight:900, color:"#059669", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:10 }}>6. Retirement Income vs Expenses</div>
              <div style={{ background:"#ffffff", border:"1px solid #cde0d4", borderRadius:8, padding:16, marginBottom:20 }}>

                {/* ── Min drawdown reference table ── */}
                <div style={{ display:"flex", gap:6, marginBottom:10, flexWrap:"wrap" }}>
                  <div style={{ fontSize:9, color:"#4b7055", fontWeight:700, alignSelf:"center", marginRight:4 }}>MIN DRAWDOWN:</div>
                  {[[55,4],[60,4],[65,5],[70,5],[75,6],[80,7],[85,9],[90,11]].map(([age,pct])=>(
                    <div key={age} style={{ background:"#f4faf6", border:"1px solid #cde0d4", borderRadius:6,
                      padding:"2px 7px", fontSize:9, color:"#2563eb", fontWeight:700 }}>
                      Age {age}: {pct}%
                    </div>
                  ))}
                  <div style={{ fontSize:9, color:"#4b7055", alignSelf:"center", marginLeft:4 }}>
                    — ATO minimum pension payment rules
                  </div>
                </div>

                {/* ── Income vs Expenses chart ── */}
                <ResponsiveContainer width="100%" height={220}>
                  <ComposedChart data={proj.filter(d=>d.age%2===0||d.age===inp.retirementAge)}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#cde0d4" />
                    <XAxis dataKey="age" stroke="#4b7055" tick={{ fontSize:10 }} />
                    <YAxis stroke="#4b7055" tick={{ fontSize:10 }} tickFormatter={v=>`$${(v/1000).toFixed(0)}k`} />
                    <Tooltip content={<TT />} />
                    <Legend wrapperStyle={{ fontSize:10 }} />
                    <ReferenceLine x={inp.retirementAge} stroke="#a78bfa" strokeDasharray="4 2" />
                    <Bar dataKey="rentalIncome" name="Rental Income" fill="#f59e0b" stackId="inc" />
                    <Bar dataKey="agePension"   name="Age Pension"   fill="#8b5cf6" stackId="inc" />
                    <Line type="monotone" dataKey="expenses" name="Total Expenses" stroke="#ef4444" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="income"   name="Total Income"   stroke="#059669" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>

                {/* ── Funding gap chart ── */}
                <div style={{ fontSize:11, fontWeight:800, color:"#1a2e1d", margin:"16px 0 6px" }}>
                  Funding Gap — Capital Required Per Year
                </div>
                <div style={{ fontSize:10, color:"#4b7055", marginBottom:8 }}>
                  Amount drawn from super/assets to cover expenses not met by pension + rental income.
                  User can choose to draw more than the minimum.
                </div>
                <ResponsiveContainer width="100%" height={240}>
                  <ComposedChart data={proj.filter(d=>d.age>=inp.retirementAge && (d.age%2===0||d.age===inp.retirementAge)).map(d=>{
                    const gap       = Math.max(0, (d.expenses||0) - (d.agePension||0) - (d.rentalIncome||0));
                    const minRate   = d.age>=90?0.11:d.age>=85?0.09:d.age>=80?0.07:d.age>=75?0.06:d.age>=70?0.05:d.age>=65?0.05:d.age>=60?0.04:0.04;
                    const superBal  = (d.super||0)+(d.superPension||0);
                    const minDraw   = Math.round(superBal * minRate);
                    const superDraw = Math.min(gap, superBal);
                    const assetDraw = Math.max(0, gap - superDraw);
                    return {
                      age:       d.age,
                      superDraw,
                      assetDraw,
                      minDraw,
                      superBal,
                    };
                  })}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#cde0d4" />
                    <XAxis dataKey="age" stroke="#4b7055" tick={{ fontSize:10 }} />
                    <YAxis yAxisId="left" stroke="#4b7055" tick={{ fontSize:10 }}
                      tickFormatter={v=>`$${(v/1000).toFixed(0)}k`} />
                    <YAxis yAxisId="right" orientation="right" stroke="#2563eb"
                      tick={{ fontSize:10 }} tickFormatter={v=>`$${(v/1e6).toFixed(1)}M`} />
                    <Tooltip content={<TT />} />
                    <Legend wrapperStyle={{ fontSize:10 }} />
                    <ReferenceLine yAxisId="left" y={0} stroke="#cde0d4" />

                    {/* Stacked gap bars — super first then other assets */}
                    <Bar yAxisId="left" dataKey="superDraw" name="Gap — from Super"
                      fill="#2563eb" stackId="gap" />
                    <Bar yAxisId="left" dataKey="assetDraw" name="Gap — from Assets/Property"
                      fill="#059669" stackId="gap" />

                    {/* Min drawdown line */}
                    <Line yAxisId="left" type="monotone" dataKey="minDraw"
                      name="Min Drawdown (ATO)"
                      stroke="#ef4444" strokeWidth={1.5} strokeDasharray="4 2" dot={false} />

                    {/* Super balance on right axis */}
                    <Line yAxisId="right" type="monotone" dataKey="superBal"
                      name="Super Balance (right axis)"
                      stroke="#2563eb" strokeWidth={2} dot={false} strokeDasharray="3 1" />
                  </ComposedChart>
                </ResponsiveContainer>

                {/* ── Min drawdown explainer ── */}
                <div style={{ background:"#eff6ff", border:"1px solid #2563eb33",
                  borderRadius:8, padding:"8px 12px", marginTop:10, fontSize:10, color:"#1e40af" }}>
                  <strong>🔴 Red dashed line</strong> = ATO minimum pension payment (% of super balance by age bracket).
                  You must draw <em>at least</em> this amount from super each year once in pension phase.
                  Drawing more reduces your super faster but may reduce tax. &nbsp;
                  <strong>🔵 Blue bars</strong> = super drawdown · <strong>🟢 Green bars</strong> = other assets/property.
                </div>
              </div>

              {/* SECTION 7 — MONTE CARLO CHART */}
              <div style={{ fontSize:13, fontWeight:900, color:"#f59e0b", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:10 }}>7. Monte Carlo — 400 Simulations</div>
              <div style={{ background:"#ffffff", border:"1px solid #cde0d4", borderRadius:8, padding:16, marginBottom:20 }}>
                <div style={{ display:"flex", gap:16, marginBottom:10 }}>
                  {[["Success Rate",pct(mc.successRate),successColor],["Median at 90",aud(mc.p50[mc.p50.length-1]?.value||0),"#16a34a"],["Best (90th)",aud(mc.p90[mc.p90.length-1]?.value||0),"#16a34a"],["Worst (10th)",aud(mc.p10[mc.p10.length-1]?.value||0),"#ef4444"]].map(([k,v,c])=>(
                    <div key={k} style={{ flex:1, background:"#f4faf6", borderRadius:6, padding:"8px 10px", textAlign:"center" }}>
                      <div style={{ fontSize:9, color:"#4b7055", textTransform:"uppercase", marginBottom:3 }}>{k}</div>
                      <div style={{ fontSize:16, fontWeight:900, color:c }}>{v}</div>
                    </div>
                  ))}
                </div>
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={mc.p50.filter((_,i)=>i%2===0).map((d,i)=>({ age:d.age, p10:mc.p10[i*2]?.value||0, p50:d.value, p90:mc.p90[i*2]?.value||0 }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#cde0d4" />
                    <XAxis dataKey="age" stroke="#4b7055" tick={{ fontSize:10 }} />
                    <YAxis stroke="#4b7055" tick={{ fontSize:10 }} tickFormatter={v=>`$${(v/1e6).toFixed(1)}M`} />
                    <Tooltip content={<TT />} />
                    <Legend wrapperStyle={{ fontSize:10 }} />
                    <Area type="monotone" dataKey="p90" name="90th Pct (Best)" stroke="#16a34a" fill="none" strokeWidth={1.5} strokeDasharray="5 2" dot={false} />
                    <Area type="monotone" dataKey="p50" name="Median" stroke="#f59e0b" fill="none" strokeWidth={3} dot={false} />
                    <Area type="monotone" dataKey="p10" name="10th Pct (Worst)" stroke="#ef4444" fill="none" strokeWidth={1.5} strokeDasharray="2 4" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* SECTION 8 — AGE PENSION */}
              <div style={{ fontSize:13, fontWeight:900, color:"#8b5cf6", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:10 }}>8. Age Pension Analysis</div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:20 }}>
                <div style={{ background:"#ffffff", border:"1px solid #8b5cf633", borderRadius:8, padding:12 }}>
                  <div style={{ fontSize:10, color:"#8b5cf6", fontWeight:800, marginBottom:8 }}>YOUR ESTIMATE</div>
                  {[["Status",inp.married?"Couple":"Single"],["Homeowner",inp.homeowner?"Yes":"No"],["Eligibility Age","67"],["Est. Annual Pension",aud(agePensionAtRetire)],["Est. Fortnightly",aud(agePensionAtRetire/26)],["% of Full Pension",pct(agePensionAtRetire/Math.max(1,inp.married?AP.coupleFull:AP.singleFull))],["Full Single Rate",aud(AP.singleFull)],["Full Couple Rate",aud(AP.coupleFull)],["Asset Test (homeowner)",aud(inp.married?AP.assetsCoupleHome:AP.assetsSingleHome)],["Age Pension Enabled",inp.agePensionEnabled?"Yes":"No"]].map(([k,v])=>(
                    <div key={k} style={{ display:"flex", justifyContent:"space-between", padding:"4px 0", borderBottom:"1px solid #cde0d466", fontSize:10 }}>
                      <span style={{ color:"#4b7055" }}>{k}</span><span style={{ color:"#1a2e1d", fontWeight:600 }}>{v}</span>
                    </div>
                  ))}
                </div>
                <div style={{ background:"#ffffff", border:"1px solid #8b5cf633", borderRadius:8, padding:12 }}>
                  <div style={{ fontSize:10, color:"#8b5cf6", fontWeight:800, marginBottom:8 }}>AGE PENSION OVER TIME</div>
                  <ResponsiveContainer width="100%" height={180}>
                    <AreaChart data={proj.filter(d=>d.age>=60&&d.age%2===0)}>
                      <defs><linearGradient id="pdf-gp" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3}/><stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/></linearGradient></defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#cde0d4" />
                      <XAxis dataKey="age" stroke="#4b7055" tick={{ fontSize:9 }} />
                      <YAxis stroke="#4b7055" tick={{ fontSize:9 }} tickFormatter={v=>`$${(v/1000).toFixed(0)}k`} />
                      <Tooltip content={<TT />} />
                      <Area type="monotone" dataKey="agePension" name="Age Pension" stroke="#8b5cf6" fill="url(#pdf-gp)" strokeWidth={2} dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* SECTION 9 — TAX & SUPER SUMMARY */}
              <div style={{ fontSize:13, fontWeight:900, color:"#ef4444", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:10 }}>9. Tax & Super Summary</div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:20 }}>
                <div style={{ background:"#ffffff", border:"1px solid #ef444433", borderRadius:8, padding:12 }}>
                  <div style={{ fontSize:10, color:"#ef4444", fontWeight:800, marginBottom:8 }}>ATO TAX BREAKDOWN</div>
                  {[["Gross Salary",aud(inp.annualIncome)],["Income Tax",aud(calcIncomeTax(inp.annualIncome))],["Less LITO",`–${aud(calcLITO(inp.annualIncome))}`],["Medicare Levy (2%)",aud(calcMedicareLevy(inp.annualIncome))],["Total Tax",aud(annualTax)],["Effective Rate",pct(annualTax/Math.max(1,inp.annualIncome))],["Marginal Rate",pct(marginalRate)],["Net Take-Home",aud(netTakeHome)],["Weekly Take-Home",aud(netTakeHome/52)]].map(([k,v])=>(
                    <div key={k} style={{ display:"flex", justifyContent:"space-between", padding:"4px 0", borderBottom:"1px solid #cde0d466", fontSize:10 }}>
                      <span style={{ color:"#4b7055" }}>{k}</span><span style={{ color:"#1a2e1d", fontWeight:600 }}>{v}</span>
                    </div>
                  ))}
                </div>
                <div style={{ background:"#ffffff", border:"1px solid #3b82f633", borderRadius:8, padding:12 }}>
                  <div style={{ fontSize:10, color:"#3b82f6", fontWeight:800, marginBottom:8 }}>SUPER DETAIL</div>
                  {[["Current Balance",aud(inp.superBalance)],["Employer SG p.a.",aud(sgAmount)],["SG Rate",`${(sgRate*100).toFixed(1)}%`],["Salary Sacrifice",aud(inp.voluntarySuper)],["Non-Concessional",aud(inp.extraSuper)],["Total Contribs",aud(totalSuperContrib)],["Concessional Cap","$30,000"],["Unused Cap",aud(concRoom)],["Tax Saved vs Salary",aud((marginalRate-0.15)*inp.voluntarySuper)],["Super at Retirement",aud((retireRow.superPension||0)+(retireRow.super||0))],["Pension Phase Tax","0% (ATO — tax free)"]].map(([k,v])=>(
                    <div key={k} style={{ display:"flex", justifyContent:"space-between", padding:"4px 0", borderBottom:"1px solid #cde0d466", fontSize:10 }}>
                      <span style={{ color:"#4b7055" }}>{k}</span><span style={{ color:"#1a2e1d", fontWeight:600 }}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* SECTION 10 — WELLNESS & ALERTS */}
              <div style={{ fontSize:13, fontWeight:900, color:wellnessColor, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:10 }}>10. Wellness Score & Alerts</div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 2fr", gap:12, marginBottom:20 }}>
                <div style={{ background:"#ffffff", border:`1px solid ${wellnessColor}33`, borderTop:`3px solid ${wellnessColor}`, borderRadius:8, padding:16, textAlign:"center" }}>
                  <div style={{ fontSize:56, fontWeight:900, color:wellnessColor }}>{wellnessGrade}</div>
                  <div style={{ fontSize:22, color:wellnessColor, fontWeight:700 }}>{wellnessTotal}/100</div>
                  <div style={{ fontSize:10, color:"#4b7055", marginTop:6 }}>{wellnessTotal>=85?"Excellent":wellnessTotal>=70?"Good":wellnessTotal>=55?"Needs Work":"At Risk"}</div>
                </div>
                <div style={{ background:"#ffffff", border:"1px solid #cde0d4", borderRadius:8, padding:12 }}>
                  {wellnessItems.map(item=>(
                    <div key={item.label} style={{ marginBottom:8 }}>
                      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                        <span style={{ fontSize:10, color:item.pass?"#1a2e1d":"#4b7055" }}>{item.pass?"✅":"⚠️"} {item.label}</span>
                        <span style={{ fontSize:10, color:item.pass?"#16a34a":"#f59e0b", fontWeight:700 }}>{Math.min(item.score,item.max)}/{item.max}</span>
                      </div>
                      <div style={{ height:5, background:"#cde0d4", borderRadius:3 }}>
                        <div style={{ height:"100%", width:`${(Math.min(item.score,item.max)/item.max)*100}%`, background:item.pass?"#16a34a":"#f59e0b", borderRadius:3 }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* ALERTS */}
              <div style={{ marginBottom:20 }}>
                {[
                  {cond:concRoom>5000,icon:"💡",color:"#3b82f6",msg:`Unused concessional cap: ${aud(concRoom)}. Salary sacrificing saves ${aud((marginalRate-0.15)*concRoom)} in tax this year.`},
                  {cond:inp.retirementAge<preservAge,icon:"⚠️",color:"#ef4444",msg:`Retire at ${inp.retirementAge} but preservation age is ${preservAge}. Bridge gap with ${aud(inp.retirementExpenses*(preservAge-inp.retirementAge))} outside super.`},
                  {cond:mc.successRate<0.75,icon:"🔴",color:"#ef4444",msg:`Monte Carlo ${pct(mc.successRate)} below 75%. Increase contributions, delay retirement, or reduce spending.`},
                  {cond:agePensionAtRetire>0,icon:"✅",color:"#16a34a",msg:`Eligible for ${aud(agePensionAtRetire)} Age Pension p.a. (${aud(agePensionAtRetire/26)} fortnightly). Automatically increases as super depletes.`},
                  {cond:!inp.estateHasWill,icon:"🏛️",color:"#a78bfa",msg:"No Will recorded. Intestacy laws may not match your wishes. A solicitor Will costs ~$300–500."},
                  {cond:!inp.isSMSF&&inp.superBalance>400000,icon:"⚙️",color:"#0ea5e9",msg:`Super balance ${aud(inp.superBalance)} — SMSF may be cost-effective above ~$350k. Gives direct property access and greater control.`},
                  {cond:inp.properties.some(p=>p.isNewBuild),icon:"🏗️",color:"#f59e0b",msg:"New build: get Quantity Surveyor depreciation report, check FHOG eligibility and state stamp duty concessions."},
                  {cond:mc.successRate>=0.9,icon:"🎉",color:"#16a34a",msg:`Excellent! ${pct(mc.successRate)} Monte Carlo success. Estate of ${aud(endRow.netWorth||0)} — consider testamentary trust for tax-effective wealth transfer.`},
                ].filter(a=>a.cond).map((a,i)=>(
                  <div key={i} style={{ display:"flex", gap:8, padding:"8px 12px", borderRadius:6, background:`${a.color}11`, border:`1px solid ${a.color}33`, borderLeft:`3px solid ${a.color}`, fontSize:10, lineHeight:1.6, marginBottom:6, color:"#374151" }}>
                    <span>{a.icon}</span><span>{a.msg}</span>
                  </div>
                ))}
              </div>

              {/* FOOTER */}
              <div style={{ textAlign:"center", padding:"12px 0 4px", borderTop:"1px solid #cde0d4", fontSize:9, color:"#374151" }}>
                AUS Retirement Pro · Educational purposes only · ATO FY2025-26 · Services Australia Sep 2025 · ASFA 2024<br/>
                Consult a licensed Australian Financial Planner (AFP/CFP) before making financial decisions.<br/>
                Generated: {new Date().toLocaleDateString("en-AU", {day:"2-digit",month:"long",year:"numeric",hour:"2-digit",minute:"2-digit"})}
              </div>

            </div>{/* end pdf-report-content */}

            {/* ── VISIBLE REPORTS SECTION (same as before) ── */}
            <Card title="🇦🇺 Full Australian Retirement Plan Summary" icon="📋" color={C.main}>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20 }}>
                <div>
                  <div style={{ fontSize:11, color:C.main, fontWeight:800, marginBottom:8 }}>PERSONAL SNAPSHOT</div>
                  {[["Current Age",inp.currentAge],["Retirement Age",inp.retirementAge],["Life Expectancy",inp.lifeExpectancy],["Years to Retire",Math.max(0,inp.retirementAge-inp.currentAge)],["Years in Retirement",inp.lifeExpectancy-inp.retirementAge],["Preservation Age",preservAge],["Status",inp.married?"Couple":"Single"],["Homeowner",inp.homeowner?"Yes":"No"],["SMSF",inp.isSMSF?"Yes":"No"],["Wellness",`${wellnessGrade} (${wellnessTotal}/100)`]].map(([k,v])=><Row key={k} k={k} v={String(v)} />)}
                </div>
                <div>
                  <div style={{ fontSize:11, color:C.main, fontWeight:800, marginBottom:8 }}>FINANCIAL SUMMARY</div>
                  {[["Current Super Balance",aud(inp.superBalance)],["Outside-Super Assets",aud(inp.outsideSuper)],["Total Property Value",aud(totalPropertyValue)],["Total Property Equity",aud(totalPropertyEquity)],["Total Debt",aud(totalDebt)],["Net Worth Today",aud(inp.superBalance+inp.outsideSuper+totalPropertyEquity-inp.debts.reduce((s,d)=>s+d.balance,0))],["Super at Retirement",aud((retireRow.superPension||0)+(retireRow.super||0))],["Net Worth at Retirement",aud(retireRow.netWorth||0)],["Retirement Expenses p.a.",aud(inp.retirementExpenses)],["Rental Income p.a.",aud(totalRentalIncome)],["Age Pension p.a.",aud(agePensionAtRetire)],["Monte Carlo Success",pct(mc.successRate)],["Estate at Age 90",aud(endRow.netWorth||0)]].map(([k,v])=><Row key={k} k={k} v={v} />)}
                </div>
              </div>
            </Card>

            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12 }}>
              <Card title="🦘 Super Report" color={C.super}>
                {[["Current Balance",aud(inp.superBalance)],["SG Rate",`${(sgRate*100).toFixed(1)}%`],["SG p.a.",aud(sgAmount)],["Salary Sacrifice",aud(inp.voluntarySuper)],["Non-Concessional",aud(inp.extraSuper)],["Total Contribs",aud(totalSuperContrib)],["Concess. Cap","$30,000"],["Unused Cap",aud(concRoom)],["Tax Saved",aud((marginalRate-0.15)*inp.voluntarySuper)],["SMSF",inp.isSMSF?`Yes – $${inp.smsfAdminCost}/yr`:"No"],["Super at Retire",aud((retireRow.superPension||0)+(retireRow.super||0))],["Pension Phase Tax","0% (ATO rule)"]].map(([k,v])=><Row key={k} k={k} v={v} />)}
              </Card>
              <Card title="🏘️ Property Report" color={C.prop}>
                {inp.properties.map(p=>(
                  <div key={p.id} style={{ marginBottom:8, paddingBottom:8, borderBottom:`1px solid ${C.border}` }}>
                    <div style={{ fontSize:10, color:C.prop, fontWeight:700, marginBottom:3 }}>{p.label} {p.isNewBuild?"🏗️":""}</div>
                    {[["Value",aud(p.value)],["Mortgage",aud(p.mortgage)],["Equity",aud(p.value-p.mortgage)],["Net Rent p.a.",aud((p.weeklyRent||0)*52*(1-(p.expenseRatio||0.25)))],["Gross Yield",pct((p.weeklyRent||0)*52/Math.max(1,p.value))]].map(([k,v])=><Row key={k} k={k} v={v} />)}
                  </div>
                ))}
                <Row k="Total Portfolio" v={aud(totalPropertyValue)} bold />
                <Row k="Total Equity" v={aud(totalPropertyEquity)} bold />
                <Row k="Total Net Rent" v={aud(totalRentalIncome)} bold />
              </Card>
              <Card title="🎲 Monte Carlo & Age Pension" color={C.warn}>
                {[["Success Rate",pct(mc.successRate)],["Simulations","400"],["Mean Return",pct(inp.returnRate)],["Median at 90",aud(mc.p50[mc.p50.length-1]?.value||0)],["90th Pct at 90",aud(mc.p90[mc.p90.length-1]?.value||0)],["10th Pct at 90",aud(mc.p10[mc.p10.length-1]?.value||0)],["—","—"],["AP Eligible Age","67"],["Est. Pension p.a.",aud(agePensionAtRetire)],["Fortnightly",aud(agePensionAtRetire/26)],["% of Full",pct(agePensionAtRetire/Math.max(1,inp.married?AP.coupleFull:AP.singleFull))]].map(([k,v])=><Row key={k} k={k} v={v} />)}
              </Card>
            </div>

            <Card title="⚠️ Personalised Alerts" icon="🎯" color={C.warn}>
              {[
                {cond:concRoom>5000,icon:"💡",color:C.super,msg:`Unused concessional cap ${aud(concRoom)} — salary sacrifice saves ${aud((marginalRate-0.15)*concRoom)} in tax.`},
                {cond:inp.retirementAge<preservAge,icon:"⚠️",color:C.bad,msg:`Retirement age ${inp.retirementAge} < preservation age ${preservAge}. Bridge gap with ${aud(inp.retirementExpenses*(preservAge-inp.retirementAge))} outside super.`},
                {cond:mc.successRate<0.75,icon:"🔴",color:C.bad,msg:`Monte Carlo ${pct(mc.successRate)} below 75%. Increase contributions, delay retirement, or reduce expenses.`},
                {cond:agePensionAtRetire>0,icon:"✅",color:C.ok,msg:`Age Pension ${aud(agePensionAtRetire)} p.a. — increases automatically as super depletes.`},
                {cond:!inp.estateHasWill,icon:"🏛️",color:"#a78bfa",msg:"No Will recorded. Intestacy laws may not reflect your wishes."},
                {cond:!inp.isSMSF&&inp.superBalance>400000,icon:"⚙️",color:C.smsf,msg:`Super ${aud(inp.superBalance)} — SMSF may offer greater control and cost savings.`},
                {cond:inp.properties.some(p=>p.isNewBuild),icon:"🏗️",color:C.warn,msg:"New build: get QS depreciation report, check FHOG and stamp duty concessions in your state."},
                {cond:mc.successRate>=0.9&&(endRow.netWorth||0)>500000,icon:"🎉",color:C.ok,msg:`Outstanding! ${pct(mc.successRate)} success, estate ${aud(endRow.netWorth||0)}. Consider testamentary trust for tax-effective wealth transfer.`},
              ].filter(a=>a.cond).map((a,i)=><AlertBox key={i} icon={a.icon} color={a.color} msg={a.msg} />)}
            </Card>

            <div style={{ textAlign:"center", padding:"10px 0", fontSize:9, color:"#374151", borderTop:`1px solid ${C.border}` }}>
              Educational purposes only. ATO FY2025-26. Services Australia Sep 2025. ASFA 2024. Consult a licensed Australian Financial Planner (AFP/CFP) before decisions.
            </div>
          </>
        )}

        {/* ═══ TESTS (hidden) ═══ */}
        {tab === "tests" && (() => {
          const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;
          // ── Expected values verified against:
          // Tax: ato.gov.au/tax-rates-and-codes/tax-rates-australian-residents (2025-26)
          // LITO: ato.gov.au/.../low-income-tax-offset (unchanged from 2022-23)
          // Age Pension: servicesaustralia.gov.au, effective 20 Sep 2025
          //   Single full $30,646/yr | Homeowner lower $321,500 | cutoff $714,500
          //   Taper: $78/yr per $1,000 excess assets
          const tests = [
            // ── INCOME TAX (2025-26) ──
            { group: "Income Tax",  name: "calcIncomeTax(18200) = 0",
              expected: 0,      got: calcIncomeTax(18200),      pass: calcIncomeTax(18200) === 0 },
            { group: "Income Tax",  name: "calcIncomeTax(30000) = 1888  [16% bracket]",
              expected: 1888,   got: calcIncomeTax(30000),      pass: near(calcIncomeTax(30000), 1888) },
            { group: "Income Tax",  name: "calcIncomeTax(45000) = 4288  [top of 16% bracket]",
              expected: 4288,   got: calcIncomeTax(45000),      pass: near(calcIncomeTax(45000), 4288) },
            { group: "Income Tax",  name: "calcIncomeTax(135000) = 31288  [top of 30% bracket]",
              expected: 31288,  got: calcIncomeTax(135000),     pass: near(calcIncomeTax(135000), 31288) },
            { group: "Income Tax",  name: "calcIncomeTax(200000) = 56138  [45% bracket]",
              expected: 56138,  got: calcIncomeTax(200000),     pass: near(calcIncomeTax(200000), 56138) },
            // ── MEDICARE LEVY ──
            { group: "Medicare Levy", name: "calcMedicareLevy(20000) = 0  [below threshold]",
              expected: 0,      got: calcMedicareLevy(20000),   pass: calcMedicareLevy(20000) === 0 },
            { group: "Medicare Levy", name: "calcMedicareLevy(120000) = 2400  [2% flat]",
              expected: 2400,   got: calcMedicareLevy(120000),  pass: near(calcMedicareLevy(120000), 2400) },
            // ── LITO (unchanged 2022-23 onwards) ──
            { group: "LITO",    name: "calcLITO(20000) = 700  [max offset]",
              expected: 700,    got: calcLITO(20000),           pass: calcLITO(20000) === 700 },
            { group: "LITO",    name: "calcLITO(37500) = 700  [taper starts above]",
              expected: 700,    got: calcLITO(37500),           pass: calcLITO(37500) === 700 },
            { group: "LITO",    name: "calcLITO(66667) = 0  [fully tapered out]",
              expected: 0,      got: Math.round(calcLITO(66667)),  pass: Math.round(calcLITO(66667)) === 0 },
            // ── NET TAX (tax + medicare − LITO) ──
            { group: "Net Tax", name: "calcNetTax(18200) = 0",
              expected: 0,      got: calcNetTax(18200),         pass: calcNetTax(18200) === 0 },
            { group: "Net Tax", name: "calcNetTax(45000) = 4863  [4288 tax + 900 medicare − 325 LITO]",
              expected: 4863,   got: calcNetTax(45000),         pass: near(calcNetTax(45000), 4863) },
            { group: "Net Tax", name: "calcNetTax(200000) = 60138  [56138 + 4000 − 0 LITO]",
              expected: 60138,  got: calcNetTax(200000),        pass: near(calcNetTax(200000), 60138) },
            // ── SG RATE ──
            { group: "SG Rate", name: "getSGRate(2025) = 0.115  [11.5% from 1 Jul 2024]",
              expected: 0.115,  got: getSGRate(2025),           pass: getSGRate(2025) === 0.115 },
            { group: "SG Rate", name: "getSGRate(2026) = 0.12  [12% from 1 Jul 2025]",
              expected: 0.12,   got: getSGRate(2026),           pass: getSGRate(2026) === 0.12 },
            { group: "SG Rate", name: "120000 × getSGRate(2026) = 14400",
              expected: 14400,  got: 120000 * getSGRate(2026),  pass: near(120000 * getSGRate(2026), 14400) },
            // ── AGE PENSION (Sep 2025 rates) ──
            // Single full = $30,646/yr | lower $321,500 | cutoff $714,500
            { group: "Age Pension", name: "Age 65 → 0  [not yet eligible, must be 67+]",
              expected: 0,      got: calcAgePension(65, false, true, 200000, 0, true),
              pass: calcAgePension(65, false, true, 200000, 0, true) === 0 },
            { group: "Age Pension", name: "Age 67, single, home, $200k assets → full $30,646",
              expected: 30646,  got: calcAgePension(67, false, true, 200000, 0, true),
              pass: near(calcAgePension(67, false, true, 200000, 0, true), 30646, 10) },
            { group: "Age Pension", name: "Age 67, single, home, $715k assets → 0  [above $714,500 cutoff]",
              expected: 0,      got: calcAgePension(67, false, true, 715000, 0, true),
              pass: calcAgePension(67, false, true, 715000, 0, true) === 0 },
            // ── PRESERVATION AGE ──
            { group: "Preservation Age", name: "birthYear 1959 → 55",
              expected: 55,     got: getPreservationAge(1959),  pass: getPreservationAge(1959) === 55 },
            { group: "Preservation Age", name: "birthYear 1964 → 60",
              expected: 60,     got: getPreservationAge(1964),  pass: getPreservationAge(1964) === 60 },
            { group: "Preservation Age", name: "birthYear 1970 → 60",
              expected: 60,     got: getPreservationAge(1970),  pass: getPreservationAge(1970) === 60 },
          ];

          const passed = tests.filter(t => t.pass).length;
          const total  = tests.length;
          const allPass = passed === total;
          const groups  = [...new Set(tests.map(t => t.group))];

          return (
            <>
              {/* Score banner */}
              <div style={{ background: allPass ? "#f0fdf4" : "#fff7ed", border: `2px solid ${allPass ? C.ok : C.warn}`, borderRadius: 12, padding: "16px 20px", marginBottom: 20, display: "flex", alignItems: "center", gap: 16 }}>
                <div style={{ fontSize: 48, lineHeight: 1 }}>{allPass ? "✅" : "⚠️"}</div>
                <div>
                  <div style={{ fontSize: 22, fontWeight: 900, color: allPass ? C.ok : C.warn, fontFamily: "monospace" }}>{passed}/{total} tests passed</div>
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>
                    {allPass ? "All mathematical functions are working correctly." : `${total - passed} test${total - passed !== 1 ? "s" : ""} failing — check the table below for details.`}
                  </div>
                  <div style={{ fontSize: 10, color: C.muted, marginTop: 6 }}>
                    💡 Access this tab by clicking the 🦘 logo in the top-left corner.
                  </div>
                </div>
              </div>

              {/* Results grouped by category */}
              {groups.map(group => {
                const groupTests = tests.filter(t => t.group === group);
                const groupPassed = groupTests.filter(t => t.pass).length;
                const groupColor = groupPassed === groupTests.length ? C.ok : C.bad;
                return (
                  <div key={group} style={{ marginBottom: 16 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      <div style={{ fontSize: 11, fontWeight: 800, color: groupColor, textTransform: "uppercase", letterSpacing: "0.08em" }}>{group}</div>
                      <div style={{ fontSize: 10, background: `${groupColor}18`, border: `1px solid ${groupColor}44`, borderRadius: 20, padding: "1px 8px", color: groupColor, fontWeight: 700 }}>{groupPassed}/{groupTests.length}</div>
                    </div>
                    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                        <thead>
                          <tr style={{ background: "#f4faf6", borderBottom: `1px solid ${C.border}` }}>
                            {["Test", "Expected", "Got", "Result"].map(h => (
                              <th key={h} style={{ padding: "7px 12px", textAlign: h === "Test" ? "left" : "right", color: C.muted, fontWeight: 700, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {groupTests.map((t, i) => (
                            <tr key={i} style={{ borderBottom: i < groupTests.length - 1 ? `1px solid ${C.border}` : "none", background: t.pass ? "transparent" : "#fff5f5" }}>
                              <td style={{ padding: "8px 12px", color: C.text, fontFamily: "monospace", fontSize: 10 }}>{t.name}</td>
                              <td style={{ padding: "8px 12px", textAlign: "right", color: C.muted, fontFamily: "monospace", fontSize: 10 }}>{typeof t.expected === "number" ? t.expected.toLocaleString() : t.expected}</td>
                              <td style={{ padding: "8px 12px", textAlign: "right", fontFamily: "monospace", fontSize: 10, color: t.pass ? C.text : C.bad, fontWeight: t.pass ? 400 : 700 }}>{typeof t.got === "number" ? (Number.isInteger(t.got) ? t.got.toLocaleString() : t.got.toFixed(4)) : t.got}</td>
                              <td style={{ padding: "8px 12px", textAlign: "right" }}>
                                <span style={{ background: t.pass ? "#dcfce7" : "#fee2e2", color: t.pass ? "#166534" : "#991b1b", borderRadius: 6, padding: "2px 10px", fontWeight: 800, fontSize: 10 }}>
                                  {t.pass ? "PASS" : "FAIL"}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}

              {/* Close button */}
              <div style={{ textAlign: "center", marginTop: 12 }}>
                <button onClick={() => setTab("dashboard")} style={{ background: `${C.main}18`, border: `1px solid ${C.main}44`, borderRadius: 8, padding: "8px 20px", color: C.main, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                  ← Back to Dashboard
                </button>
              </div>
            </>
          );
        })()}

        {/* ═══ TESTS 2 — runProjection & runMonteCarlo Scenario Tests ═══ */}
        {tab === "tests2" && (() => {
          const near = (a, b, tol) => Math.abs(a - b) <= tol;
          const fmt = v => typeof v === "number" ? aud(v) : String(v);

          // ── Base scenario shared across most projection tests ──
          const BASE = {
            currentAge: 40, retirementAge: 65, lifeExpectancy: 90, birthYear: 1985,
            married: false, homeowner: true,
            superBalance: 200000, voluntarySuper: 0, extraSuper: 0,
            isSMSF: false, smsfAdminCost: 3500,
            outsideSuper: 50000, dividendYield: 0.04, annualSavingsRate: 0.0,
            properties: [], annualIncome: 100000, partnerIncome: 0, otherIncome: 0,
            annualExpenses: 60000, retirementExpenses: 50000,
            healthcareExpenses: 0, agedCareAge: 90, agedCareCost: 0,
            debts: [], windfalls: [], bigExpenses: [],
            returnRate: 0.07, inflationRate: 0.03, propertyGrowthRate: 0.04,
            rateSchedule: [], agePensionEnabled: false, withdrawalOrder: ["super", "outside"],
          };

          // Helper: run projection and get row at given age
          const projAt = (overrides, age) => {
            const data = runProjection({ ...BASE, ...overrides });
            return data.find(d => d.age === age) || {};
          };
          const projLast = (overrides) => {
            const data = runProjection({ ...BASE, ...overrides });
            return data[data.length - 1] || {};
          };
          const projFirst = (overrides) => runProjection({ ...BASE, ...overrides })[0] || {};

          // ── Run all projection tests ──
          const projTests = [];

          // GROUP: Super accumulation
          (() => {
            const g = "Super Accumulation";
            // Age 40 start, 7% return, 25 years to retire — super should grow
            const atRetire = projAt({}, 65);
            projTests.push({ group: g, name: "Super balance grows from $200k at 40 → > $200k at 65 (7% return + SG contributions)", got: atRetire.super || atRetire.superPension, pass: (atRetire.super || atRetire.superPension || 0) > 200000, expected: "> A$200,000" });

            // With $20k salary sacrifice: super should be higher
            const withSS = projAt({ voluntarySuper: 20000 }, 65);
            const withoutSS = projAt({ voluntarySuper: 0 }, 65);
            const ssSuper = withSS.super || withSS.superPension || 0;
            const noSsSuper = withoutSS.super || withoutSS.superPension || 0;
            projTests.push({ group: g, name: "Salary sacrifice $20k/yr → higher super at 65 vs no sacrifice", got: ssSuper, pass: ssSuper > noSsSuper, expected: `> ${aud(noSsSuper)} (no sacrifice)` });

            // SMSF admin cost reduces super vs no SMSF
            const withSMSF = projAt({ isSMSF: true, smsfAdminCost: 5000 }, 65);
            const smsfSuper = withSMSF.super || withSMSF.superPension || 0;
            projTests.push({ group: g, name: "SMSF $5k/yr admin cost → lower super at 65 vs no SMSF", got: smsfSuper, pass: smsfSuper < noSsSuper, expected: `< ${aud(noSsSuper)} (no SMSF)` });

            // Higher return rate → more super
            const hi = projAt({ returnRate: 0.10 }, 65);
            const lo = projAt({ returnRate: 0.04 }, 65);
            const hiS = hi.super || hi.superPension || 0;
            const loS = lo.super || lo.superPension || 0;
            projTests.push({ group: g, name: "10% return rate → more super at 65 than 4% return", got: hiS, pass: hiS > loS, expected: `> ${aud(loS)} (4% return)` });
          })();

          // GROUP: Outside super (investments)
          (() => {
            const g = "Outside Super (Investments)";
            // Outside super grows when savings rate > 0
            const withSav = projAt({ annualSavingsRate: 0.10 }, 65);
            const noSav = projAt({ annualSavingsRate: 0.00 }, 65);
            projTests.push({ group: g, name: "10% savings rate → higher outside super at 65 vs 0% savings", got: withSav.outside, pass: (withSav.outside || 0) > (noSav.outside || 0), expected: `> ${aud(noSav.outside || 0)} (no savings)` });

            // Windfall at 50 increases outside super at 65
            const withWF = projAt({ windfalls: [{ id: "w1", age: 50, amount: 100000 }] }, 65);
            const noWF = projAt({}, 65);
            projTests.push({ group: g, name: "$100k windfall at age 50 → higher outside super at 65", got: withWF.outside, pass: (withWF.outside || 0) > (noWF.outside || 0), expected: `> ${aud(noWF.outside || 0)} (no windfall)` });

            // Big expense at 50 reduces outside super
            const withBE = projAt({ bigExpenses: [{ id: "b1", age: 50, amount: 80000 }] }, 65);
            projTests.push({ group: g, name: "$80k big expense at 50 → lower outside super at 65 vs no expense", got: withBE.outside, pass: (withBE.outside || 0) < (noWF.outside || 0), expected: `< ${aud(noWF.outside || 0)} (no expense)` });
          })();

          // GROUP: Property module
          (() => {
            const g = "Property & Rental";
            const withProp = projAt({ properties: [{ id: "p1", label: "IP", value: 600000, mortgage: 400000, weeklyRent: 600, loanYears: 25, expenseRatio: 0.25, isNewBuild: false, isPrimary: false }] }, 65);
            const noProp = projAt({}, 65);
            projTests.push({ group: g, name: "IP $600k at 4% growth → property equity > 0 at 65", got: withProp.propertyEquity, pass: (withProp.propertyEquity || 0) > 0, expected: "> A$0" });
            projTests.push({ group: g, name: "With rental property → net worth at 65 > no property", got: withProp.netWorth, pass: (withProp.netWorth || 0) > (noProp.netWorth || 0), expected: `> ${aud(noProp.netWorth || 0)}` });

            // New build under construction at currentAge = no rental income initially
            const newBuild = projAt({ properties: [{ id: "nb1", label: "NB", value: 500000, mortgage: 400000, weeklyRent: 500, loanYears: 25, expenseRatio: 0.25, isNewBuild: true, buildCompleteAge: 43, isPrimary: false }] }, 41);
            projTests.push({ group: g, name: "New build under construction at age 41 (complete age 43) → rentalIncome = 0", got: newBuild.rentalIncome, pass: (newBuild.rentalIncome || 0) === 0, expected: "A$0" });

            // After build complete, rental income appears
            const newBuildPost = projAt({ properties: [{ id: "nb1", label: "NB", value: 500000, mortgage: 400000, weeklyRent: 500, loanYears: 25, expenseRatio: 0.25, isNewBuild: true, buildCompleteAge: 43, isPrimary: false }] }, 45);
            projTests.push({ group: g, name: "New build post-completion at age 45 (complete age 43) → rentalIncome > 0", got: newBuildPost.rentalIncome, pass: (newBuildPost.rentalIncome || 0) > 0, expected: "> A$0" });
          })();

          // GROUP: Debt module
          (() => {
            const g = "Debt Repayment";
            // Debt balance should reduce over time with repayments
            const atStart = projFirst({ debts: [{ id: "d1", label: "Car Loan", balance: 30000, rate: 7, monthlyRepayment: 600 }] });
            const atLater = projAt({ debts: [{ id: "d1", label: "Car Loan", balance: 30000, rate: 7, monthlyRepayment: 600 }] }, 45);
            projTests.push({ group: g, name: "$30k car loan at 7%, $600/mo → debt balance lower at 45 than 40", got: atLater.totalDebt, pass: (atLater.totalDebt || 0) < (atStart.totalDebt || 30000), expected: `< ${aud(atStart.totalDebt || 30000)}` });

            // Debt fully paid off eventually: high repayment
            const fullyPaid = projAt({ debts: [{ id: "d1", label: "Small Loan", balance: 10000, rate: 5, monthlyRepayment: 1000 }] }, 43);
            projTests.push({ group: g, name: "$10k loan, $1,000/mo → fully repaid by age 43", got: fullyPaid.totalDebt, pass: (fullyPaid.totalDebt || 0) === 0, expected: "A$0" });
          })();

          // GROUP: Income & Tax
          (() => {
            const g = "Income & Tax in Projection";
            const highInc = projAt({ annualIncome: 200000 }, 42);
            const lowInc = projAt({ annualIncome: 60000 }, 42);
            projTests.push({ group: g, name: "$200k income → higher super contributions at 42 than $60k income", got: highInc.superContrib, pass: (highInc.superContrib || 0) > (lowInc.superContrib || 0), expected: `> ${aud(lowInc.superContrib || 0)}` });

            // Retirement: no super contributions post-retirement
            const retiredRow = projAt({}, 66);
            projTests.push({ group: g, name: "Age 66 (post-retirement) → superContrib = 0", got: retiredRow.superContrib, pass: (retiredRow.superContrib || 0) === 0, expected: "A$0" });

            // Partner income adds to super/take-home
            const withPartner = projAt({ partnerIncome: 80000 }, 50);
            const noPartner = projAt({}, 50);
            projTests.push({ group: g, name: "Partner $80k income → higher outside super at 50 vs single income", got: withPartner.outside, pass: (withPartner.outside || 0) > (noPartner.outside || 0), expected: `> ${aud(noPartner.outside || 0)}` });
          })();

          // GROUP: Healthcare & Aged Care
          (() => {
            const g = "Healthcare & Aged Care";
            // Healthcare expenses from 65 — reduce net worth vs no expenses
            const withHC = projAt({ healthcareExpenses: 8000 }, 75);
            const noHC = projAt({ healthcareExpenses: 0 }, 75);
            projTests.push({ group: g, name: "$8k/yr healthcare from 65 → lower net worth at 75 than $0 healthcare", got: withHC.netWorth, pass: (withHC.netWorth || 0) < (noHC.netWorth || 0), expected: `< ${aud(noHC.netWorth || 0)}` });
            projTests.push({ group: g, name: "healthExp at age 75 > 0 when healthcareExpenses = $8k", got: withHC.healthExp, pass: (withHC.healthExp || 0) > 0, expected: "> A$0" });

            // Aged care from 80 — expenses appear at that age
            const withAC = projAt({ agedCareAge: 80, agedCareCost: 50000 }, 80);
            const noAC = projAt({ agedCareAge: 80, agedCareCost: 0 }, 80);
            projTests.push({ group: g, name: "$50k/yr aged care from 80 → healthExp at 80 > $0", got: withAC.healthExp, pass: (withAC.healthExp || 0) > 0, expected: "> A$0" });
            projTests.push({ group: g, name: "$50k/yr aged care → net worth at 85 lower than $0 aged care", got: projAt({ agedCareAge: 80, agedCareCost: 50000 }, 85).netWorth, pass: (projAt({ agedCareAge: 80, agedCareCost: 50000 }, 85).netWorth || 0) < (noAC.netWorth || 0), expected: `< ${aud(noAC.netWorth || 0)}` });
          })();

          // GROUP: Age Pension integration in projection
          (() => {
            const g = "Age Pension in Projection";
            const withAP = projAt({ agePensionEnabled: true, superBalance: 100000, outsideSuper: 50000 }, 70);
            const noAP = projAt({ agePensionEnabled: false, superBalance: 100000, outsideSuper: 50000 }, 70);
            projTests.push({ group: g, name: "Age Pension enabled → agePension > 0 at 70 (low assets, homeowner)", got: withAP.agePension, pass: (withAP.agePension || 0) > 0, expected: "> A$0" });
            projTests.push({ group: g, name: "Age Pension enabled → net worth at 80 higher than disabled (pension cushions drawdown)", got: projAt({ agePensionEnabled: true, superBalance: 100000, outsideSuper: 50000 }, 80).netWorth, pass: (projAt({ agePensionEnabled: true, superBalance: 100000, outsideSuper: 50000 }, 80).netWorth || 0) >= (projAt({ agePensionEnabled: false, superBalance: 100000, outsideSuper: 50000 }, 80).netWorth || 0), expected: `>= ${aud(projAt({ agePensionEnabled: false }, 80).netWorth || 0)}` });
          })();

          // GROUP: Rate schedule
          (() => {
            const g = "Rate Schedule (Glide Path)";
            const withSched = projAt({ rateSchedule: [{ id: "r1", age: 65, rate: 4.0 }] }, 70);
            const noSched = projAt({ rateSchedule: [] }, 70);
            projTests.push({ group: g, name: "Rate drops to 4% at 65 → lower net worth at 70 than constant 7%", got: withSched.netWorth, pass: (withSched.netWorth || 0) < (noSched.netWorth || 0), expected: `< ${aud(noSched.netWorth || 0)}` });
          })();

          // GROUP: Withdrawal order
          (() => {
            const g = "Withdrawal Order";
            const superFirst = projAt({ retirementAge: 60, withdrawalOrder: ["super", "outside"], superBalance: 300000, outsideSuper: 200000 }, 70);
            const outsideFirst = projAt({ retirementAge: 60, withdrawalOrder: ["outside", "super"], superBalance: 300000, outsideSuper: 200000 }, 70);
            // When drawing outside first, outside should be lower
            projTests.push({ group: g, name: "Draw outside first → lower outside super at 70 vs draw super first", got: outsideFirst.outside, pass: (outsideFirst.outside || 0) <= (superFirst.outside || 0), expected: `<= ${aud(superFirst.outside || 0)}` });
            // When drawing super first, super should be lower
            projTests.push({ group: g, name: "Draw super first → lower super at 70 vs draw outside first", got: superFirst.superPension || superFirst.super, pass: (superFirst.superPension || superFirst.super || 0) <= (outsideFirst.superPension || outsideFirst.super || 0), expected: `<= ${aud(outsideFirst.superPension || outsideFirst.super || 0)}` });
          })();

          // ── Monte Carlo scenario tests ──
          const mcTests = [];
          (() => {
            const g = "Monte Carlo — Core Behaviour";
            // 1. Success rate must be between 0 and 1
            const mc1 = runMonteCarlo(BASE, 200);
            mcTests.push({ group: g, name: "successRate ∈ [0, 1] for baseline scenario", got: mc1.successRate.toFixed(4), pass: mc1.successRate >= 0 && mc1.successRate <= 1, expected: "0.0 – 1.0" });
            mcTests.push({ group: g, name: "bankruptcyRate ∈ [0, 1]", got: mc1.bankruptcyRate.toFixed(4), pass: mc1.bankruptcyRate >= 0 && mc1.bankruptcyRate <= 1, expected: "0.0 – 1.0" });
            mcTests.push({ group: g, name: "successRate + bankruptcyRate ≤ 1.0 (not mutually exclusive but bounded)", got: (mc1.successRate + mc1.bankruptcyRate).toFixed(4), pass: mc1.successRate + mc1.bankruptcyRate <= 2.0, expected: "<= 2.0" });

            // 2. Percentile ordering: p10 ≤ p25 ≤ p50 ≤ p75 ≤ p90 at final year
            const last = mc1.p50.length - 1;
            const p10f = mc1.p10[last]?.value || 0;
            const p25f = mc1.p25[last]?.value || 0;
            const p50f = mc1.p50[last]?.value || 0;
            const p75f = mc1.p75[last]?.value || 0;
            const p90f = mc1.p90[last]?.value || 0;
            mcTests.push({ group: g, name: "p10 ≤ p25 at final age (stress ≤ bear)", got: `${aud(p10f)} ≤ ${aud(p25f)}`, pass: p10f <= p25f, expected: "p10 ≤ p25" });
            mcTests.push({ group: g, name: "p25 ≤ p50 at final age (bear ≤ median)", got: `${aud(p25f)} ≤ ${aud(p50f)}`, pass: p25f <= p50f, expected: "p25 ≤ p50" });
            mcTests.push({ group: g, name: "p50 ≤ p75 at final age (median ≤ optimistic)", got: `${aud(p50f)} ≤ ${aud(p75f)}`, pass: p50f <= p75f, expected: "p50 ≤ p75" });
            mcTests.push({ group: g, name: "p75 ≤ p90 at final age (optimistic ≤ boom)", got: `${aud(p75f)} ≤ ${aud(p90f)}`, pass: p75f <= p90f, expected: "p75 ≤ p90" });

            // 3. worst ≤ p10 ≤ mean ≤ p90 ≤ best
            mcTests.push({ group: g, name: "worst ≤ p10 final (worst case is at or below stress pct)", got: `${aud(mc1.worst || 0)} ≤ ${aud(p10f)}`, pass: (mc1.worst || 0) <= p10f, expected: "worst ≤ p10" });
            mcTests.push({ group: g, name: "best ≥ p90 final (best case is at or above boom pct)", got: `${aud(mc1.best || 0)} ≥ ${aud(p90f)}`, pass: (mc1.best || 0) >= p90f, expected: "best ≥ p90" });
            mcTests.push({ group: g, name: "mean ≥ p10 final (average better than worst 10%)", got: `${aud(mc1.mean || 0)} ≥ ${aud(p10f)}`, pass: (mc1.mean || 0) >= p10f, expected: "mean ≥ p10" });
            mcTests.push({ group: g, name: "stdDev > 0 (outcomes spread across runs)", got: aud(mc1.stdDev || 0), pass: (mc1.stdDev || 0) > 0, expected: "> A$0" });
          })();

          (() => {
            const g = "Monte Carlo — Scenario Sensitivity";
            // Better return rate → higher success rate
            const mcHi = runMonteCarlo({ ...BASE, returnRate: 0.10 }, 200);
            const mcLo = runMonteCarlo({ ...BASE, returnRate: 0.04 }, 200);
            mcTests.push({ group: g, name: "10% return rate → higher success rate than 4% return", got: `${pct(mcHi.successRate)} vs ${pct(mcLo.successRate)}`, pass: mcHi.successRate >= mcLo.successRate, expected: "hiReturn ≥ loReturn" });

            // More super → generally higher success
            const mcRich = runMonteCarlo({ ...BASE, superBalance: 800000, outsideSuper: 200000 }, 200);
            const mcPoor = runMonteCarlo({ ...BASE, superBalance: 50000, outsideSuper: 10000 }, 200);
            mcTests.push({ group: g, name: "$1M starting portfolio → higher success rate than $60k starting portfolio", got: `${pct(mcRich.successRate)} vs ${pct(mcPoor.successRate)}`, pass: mcRich.successRate >= mcPoor.successRate, expected: "rich ≥ poor" });

            // Later retirement → higher success (more accumulation time)
            const mcLateRetire = runMonteCarlo({ ...BASE, retirementAge: 70 }, 200);
            const mcEarlyRetire = runMonteCarlo({ ...BASE, retirementAge: 55 }, 200);
            mcTests.push({ group: g, name: "Retire at 70 → higher success rate than retire at 55", got: `${pct(mcLateRetire.successRate)} vs ${pct(mcEarlyRetire.successRate)}`, pass: mcLateRetire.successRate >= mcEarlyRetire.successRate, expected: "later ≥ earlier" });

            // Lower retirement expenses → higher success
            const mcCheap = runMonteCarlo({ ...BASE, retirementExpenses: 30000 }, 200);
            const mcExpensive = runMonteCarlo({ ...BASE, retirementExpenses: 100000 }, 200);
            mcTests.push({ group: g, name: "$30k/yr retirement expenses → higher success than $100k/yr", got: `${pct(mcCheap.successRate)} vs ${pct(mcExpensive.successRate)}`, pass: mcCheap.successRate >= mcExpensive.successRate, expected: "cheap ≥ expensive" });

            // p50 (median outcome) array has correct length
            const mc2 = runMonteCarlo(BASE, 200);
            const expectedLen = BASE.lifeExpectancy - BASE.currentAge + 1;
            mcTests.push({ group: g, name: `p50 array length = ${expectedLen} (one value per year ${BASE.currentAge}–${BASE.lifeExpectancy})`, got: mc2.p50.length, pass: mc2.p50.length === expectedLen, expected: expectedLen });

            // Ages in p50 array are sequential starting from currentAge
            mcTests.push({ group: g, name: `p50[0].age = ${BASE.currentAge} (starts at current age)`, got: mc2.p50[0]?.age, pass: mc2.p50[0]?.age === BASE.currentAge, expected: BASE.currentAge });
            mcTests.push({ group: g, name: `p50[last].age = ${BASE.lifeExpectancy} (ends at life expectancy)`, got: mc2.p50[mc2.p50.length-1]?.age, pass: mc2.p50[mc2.p50.length-1]?.age === BASE.lifeExpectancy, expected: BASE.lifeExpectancy });
          })();

          // ── Combine both test suites ──
          const allTests2 = [...projTests, ...mcTests];
          const passed2 = allTests2.filter(t => t.pass).length;
          const total2 = allTests2.length;
          const allPass2 = passed2 === total2;
          const groups2 = [...new Set(allTests2.map(t => t.group))];

          return (
            <>
              {/* Score banner */}
              <div style={{ background: allPass2 ? "#f0fdf4" : "#fff7ed", border: `2px solid ${allPass2 ? C.ok : C.warn}`, borderRadius: 12, padding: "16px 20px", marginBottom: 20, display: "flex", alignItems: "center", gap: 16 }}>
                <div style={{ fontSize: 48, lineHeight: 1 }}>{allPass2 ? "✅" : "⚠️"}</div>
                <div>
                  <div style={{ fontSize: 22, fontWeight: 900, color: allPass2 ? C.ok : C.warn, fontFamily: "monospace" }}>{passed2}/{total2} scenario tests passed</div>
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>
                    {allPass2 ? "All projection and Monte Carlo scenarios behave correctly." : `${total2 - passed2} scenario test${total2 - passed2 !== 1 ? "s" : ""} failing — projection logic may have edge cases.`}
                  </div>
                  <div style={{ fontSize: 10, color: C.muted, marginTop: 4 }}>
                    🔬 <strong>runProjection</strong>: {projTests.filter(t=>t.pass).length}/{projTests.length} · <strong>runMonteCarlo</strong>: {mcTests.filter(t=>t.pass).length}/{mcTests.length} · Click 🦘 logo to cycle between test panels
                  </div>
                </div>
              </div>

              {/* Module summary bar */}
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(130px, 1fr))", gap:8, marginBottom:16 }}>
                {groups2.map(g => {
                  const gt = allTests2.filter(t => t.group === g);
                  const gp = gt.filter(t => t.pass).length;
                  const ok = gp === gt.length;
                  return (
                    <div key={g} style={{ background: C.card, border:`1px solid ${ok ? C.ok : C.bad}33`, borderTop:`2px solid ${ok ? C.ok : C.bad}`, borderRadius:8, padding:"8px 10px" }}>
                      <div style={{ fontSize:9, color: ok ? C.ok : C.bad, fontWeight:800 }}>{ok ? "✅" : "❌"} {g}</div>
                      <div style={{ fontSize:12, fontWeight:900, color: ok ? C.ok : C.bad, fontFamily:"monospace" }}>{gp}/{gt.length}</div>
                    </div>
                  );
                })}
              </div>

              {/* Results per group */}
              {groups2.map(group => {
                const groupTests2 = allTests2.filter(t => t.group === group);
                const gPass = groupTests2.filter(t => t.pass).length;
                const gColor = gPass === groupTests2.length ? C.ok : C.bad;
                const isMC = group.startsWith("Monte Carlo");
                return (
                  <div key={group} style={{ marginBottom: 16 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
                      <div style={{ fontSize:11, fontWeight:800, color:gColor, textTransform:"uppercase", letterSpacing:"0.08em" }}>
                        {isMC ? "🎲" : "💰"} {group}
                      </div>
                      <div style={{ fontSize:10, background:`${gColor}18`, border:`1px solid ${gColor}44`, borderRadius:20, padding:"1px 8px", color:gColor, fontWeight:700 }}>{gPass}/{groupTests2.length}</div>
                    </div>
                    <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:10, overflow:"hidden" }}>
                      <table style={{ width:"100%", borderCollapse:"collapse", fontSize:10 }}>
                        <thead>
                          <tr style={{ background:"#f4faf6", borderBottom:`1px solid ${C.border}` }}>
                            {["Scenario", "Expected", "Got", "Result"].map(h => (
                              <th key={h} style={{ padding:"6px 10px", textAlign: h==="Scenario" ? "left" : "right", color:C.muted, fontWeight:700, fontSize:9, textTransform:"uppercase", letterSpacing:"0.06em" }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {groupTests2.map((t, i) => (
                            <tr key={i} style={{ borderBottom: i < groupTests2.length-1 ? `1px solid ${C.border}` : "none", background: t.pass ? "transparent" : "#fff5f5" }}>
                              <td style={{ padding:"7px 10px", color:C.text, fontSize:10, lineHeight:1.5 }}>{t.name}</td>
                              <td style={{ padding:"7px 10px", textAlign:"right", color:C.muted, fontFamily:"monospace", fontSize:10, whiteSpace:"nowrap" }}>{typeof t.expected === "number" ? t.expected.toLocaleString() : t.expected}</td>
                              <td style={{ padding:"7px 10px", textAlign:"right", fontFamily:"monospace", fontSize:10, color: t.pass ? C.text : C.bad, fontWeight: t.pass ? 400 : 700, whiteSpace:"nowrap" }}>{typeof t.got === "number" ? (Number.isInteger(t.got) ? aud(t.got) : t.got.toFixed(4)) : t.got}</td>
                              <td style={{ padding:"7px 10px", textAlign:"right" }}>
                                <span style={{ background: t.pass ? "#dcfce7" : "#fee2e2", color: t.pass ? "#166534" : "#991b1b", borderRadius:6, padding:"2px 8px", fontWeight:800, fontSize:9 }}>
                                  {t.pass ? "PASS" : "FAIL"}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}

              <div style={{ textAlign:"center", marginTop:12 }}>
                <button onClick={() => setTab("dashboard")} style={{ background:`${C.main}18`, border:`1px solid ${C.main}44`, borderRadius:8, padding:"8px 20px", color:C.main, fontSize:12, fontWeight:700, cursor:"pointer" }}>
                  ← Back to Dashboard
                </button>
              </div>
            </>
          );
        })()}
      </div>

      {/* ── SITE-WIDE DISCLAIMER FOOTER ── */}
      <div style={{ background: "#f0f4f1", borderTop: `1px solid ${C.border}`, padding: "14px 20px", marginTop: 8 }}>
        <div style={{ maxWidth: 900, margin: "0 auto", textAlign: "center" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>⚠️ Disclaimer</div>
          <div style={{ fontSize: 10, color: "#4b5563", lineHeight: 1.7 }}>
            The information on this website is for general information purposes only and does not constitute financial, investment, or legal advice.
            It does not take into account your personal objectives, financial situation, or needs. Any information, results needs checking.
            You should consider seeking independent, professional advice before making any financial decisions.
          </div>
          <div style={{ marginTop: 8, fontSize: 9, color: C.muted }}>
            Developed by <strong style={{ color: C.main }}>Vijay Parate</strong> using <strong style={{ color: C.super }}>Claude AI</strong> · ATO FY2025-26 · Services Australia Sep 2025
          </div>
        </div>
      </div>
    </div>
  );
}
