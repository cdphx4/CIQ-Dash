import React, { useState, useMemo, useCallback } from 'react';
import { LineChart, Line, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

const COUNTRY_NAMES = {
  US: 'United States', CH: 'Switzerland', GB: 'United Kingdom', IL: 'Israel',
  DE: 'Germany', AT: 'Austria', PL: 'Poland', NL: 'Netherlands', CA: 'Canada',
  DK: 'Denmark', FR: 'France', JP: 'Japan', BR: 'Brazil', GE: 'Georgia',
  IT: 'Italy', HK: 'Hong Kong', AM: 'Armenia'
};

const PISTE = {
  green: '#22c55e',
  blue: '#3b82f6',
  red: '#ef4444',
  orange: '#f59e0b',
  black: '#18181b',
  white: '#fafafa',
  snow: '#f1f5f9',
  slate: '#64748b',
  dark: '#0c0c0c',
};

const COLORS = [
  PISTE.green, PISTE.blue, PISTE.orange, '#22d3ee',
  '#a855f7', '#f472b6', '#84cc16', '#06b6d4',
  '#8b5cf6', '#ec4899', '#65a30d', '#14b8a6'
];

// Symbol lookup for common currencies that may appear in Connect IQ payouts.
// Codes not in the map fall back to "CODE " prefix (e.g. "NOK 12.34").
const CURRENCY_SYMBOLS = {
  USD: '$',  EUR: '€',  GBP: '£',  JPY: '¥',  CNY: '¥',
  CAD: 'CA$', AUD: 'A$', NZD: 'NZ$', CHF: 'CHF',
  SEK: 'kr', NOK: 'kr', DKK: 'kr', PLN: 'zł',
  BRL: 'R$', INR: '₹', KRW: '₩', MXN: 'MX$',
  HKD: 'HK$', SGD: 'S$', TWD: 'NT$', ZAR: 'R',
  CZK: 'Kč', HUF: 'Ft', ILS: '₪', RUB: '₽', THB: '฿', TRY: '₺',
};

const symbolFor = (code) => CURRENCY_SYMBOLS[code] || `${code} `;

// Format a numeric value with the detected currency symbol.
// Multi-letter symbols (CHF, kr, Kč...) get a thin space; glyphs ($, €, £...) sit flush.
const fmtMoney = (value, code, opts = {}) => {
  const { fractionDigits = 2 } = opts;
  const num = Number(value) || 0;
  const sym = symbolFor(code);
  const needsSpace = sym.length > 2 && !sym.endsWith('$');
  return `${sym}${needsSpace ? ' ' : ''}${num.toFixed(fractionDigits)}`;
};

const parseDate = (dateStr) => {
  if (!dateStr) return null;
  const dateMatch = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!dateMatch) return null;
  const [, year, month, day] = dateMatch;
  const timeMatch = dateStr.match(/(\d{2}):(\d{2}):(\d{2})/);
  if (timeMatch) {
    const [, hour, min, sec] = timeMatch;
    return new Date(Date.UTC(+year, +month - 1, +day, +hour, +min, +sec));
  }
  return new Date(Date.UTC(+year, +month - 1, +day));
};

const getDateString = (dateStr) => {
  if (!dateStr) return '';
  const match = dateStr.match(/(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
};

const formatDateSafe = (dateStr) => {
  if (!dateStr) return '';
  const match = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return dateStr;
  const [, year, month, day] = match;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[+month - 1]} ${+day}`;
};

const parseCSV = (text) => {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.trim().split('\n').filter(line => line.trim());
  if (lines.length < 2) return [];

  const firstLine = lines[0];
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  const semiCount = (firstLine.match(/;/g) || []).length;

  let delimiter = ',';
  if (tabCount >= commaCount && tabCount >= semiCount) delimiter = '\t';
  else if (semiCount > commaCount) delimiter = ';';

  const parseLine = (line) => {
    const values = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const nextChar = line[i + 1];
      if (char === '"') {
        if (!inQuotes) { inQuotes = true; }
        else if (nextChar === '"') { current += '"'; i++; }
        else { inQuotes = false; }
      } else if (char === delimiter && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim());
    return values;
  };

  const headers = parseLine(lines[0]).map(h => h.replace(/^["']|["']$/g, '').trim());
  const dateKey = headers.find(h => h.toLowerCase().includes('transaction') && h.toLowerCase().includes('date'));
  const shareKey = headers.find(h => h.toLowerCase().includes('developer') && h.toLowerCase().includes('share'));

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const lowerLine = line.toLowerCase();
    if (lowerLine.startsWith('return') || lowerLine.startsWith('refund') ||
        lowerLine.startsWith('summary') || lowerLine.startsWith('total') ||
        lowerLine.includes('--- ')) break;

    const values = parseLine(line);
    if (values.length < headers.length / 2) continue;

    const obj = {};
    headers.forEach((h, idx) => { obj[h] = (values[idx] || '').replace(/^["']|["']$/g, '').trim(); });

    if (!dateKey || !obj[dateKey]) continue;
    if (!/\d{4}-\d{2}-\d{2}/.test(obj[dateKey])) continue;
    if (shareKey) {
      const share = parseFloat(obj[shareKey]);
      if (isNaN(share) || share <= 0) continue;
    }
    rows.push(obj);
  }
  return rows;
};

export default function SkiPinDashboard() {
  const [rawData, setRawData] = useState([]);
  const [hoveredCountry, setHoveredCountry] = useState(null);
  const [error, setError] = useState(null);
  const [debugInfo, setDebugInfo] = useState(null);
  const [selectedApp, setSelectedApp] = useState('all');

  const handleFileUpload = useCallback((e) => {
    const file = e.target.files[0];
    if (!file) return;
    setError(null); setDebugInfo(null);
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = parseCSV(event.target.result);
        if (parsed.length === 0) { setError('No valid data rows found. Check CSV format.'); return; }
        setRawData(parsed);
        setDebugInfo(`Loaded ${parsed.length} transactions`);
      } catch (err) { setError(`Parse error: ${err.message}`); }
    };
    reader.onerror = () => setError('Failed to read file');
    reader.readAsText(file);
  }, []);

  const handlePaste = useCallback((e) => {
    const text = e.clipboardData.getData('text');
    if (text && text.includes('Transaction Date')) {
      e.preventDefault();
      setError(null);
      try {
        const parsed = parseCSV(text);
        if (parsed.length === 0) { setError('No valid data found in pasted content'); return; }
        setRawData(parsed);
        setDebugInfo(`Loaded ${parsed.length} transactions from clipboard`);
      } catch (err) { setError(`Parse error: ${err.message}`); }
    }
  }, []);

  React.useEffect(() => {
    const handleGlobalPaste = (e) => {
      if (rawData.length === 0) {
        const text = e.clipboardData.getData('text');
        if (text && text.includes('Transaction Date')) {
          e.preventDefault();
          setError(null);
          try {
            const parsed = parseCSV(text);
            if (parsed.length > 0) { setRawData(parsed); setDebugInfo(`Loaded ${parsed.length} transactions from clipboard`); }
          } catch (err) { setError(`Parse error: ${err.message}`); }
        }
      }
    };
    window.addEventListener('paste', handleGlobalPaste);
    return () => window.removeEventListener('paste', handleGlobalPaste);
  }, [rawData.length]);

  const stats = useMemo(() => {
    if (!rawData.length) return null;

    // Detect currency from the "Share Currency" column. Use the most common
    // value across rows so a stray row with a different code can't break the UI.
    const currencyCounts = new Map();
    rawData.forEach(r => {
      const c = (r['Share Currency'] || '').trim().toUpperCase();
      if (c) currencyCounts.set(c, (currencyCounts.get(c) || 0) + 1);
    });
    let currency = 'USD';
    let topCount = 0;
    for (const [code, count] of currencyCounts) {
      if (count > topCount) { topCount = count; currency = code; }
    }
    const currencyMixed = currencyCounts.size > 1;

    const appSet = new Map();
    rawData.forEach(r => {
      const title = r['Title'] || 'Unknown App';
      if (!appSet.has(title)) appSet.set(title, { id: title, title, sales: 0, revenue: 0 });
      appSet.get(title).sales++;
      appSet.get(title).revenue += parseFloat(r['Developer Share'] || 0);
    });
    const appList = Array.from(appSet.values()).sort((a, b) => b.revenue - a.revenue);
    const hasMultipleApps = appList.length > 1;

    const filteredData = selectedApp === 'all' ? rawData : rawData.filter(r => r['Title'] === selectedApp);

    const totalRevenue = filteredData.reduce((sum, r) => sum + parseFloat(r['Developer Share'] || 0), 0);
    const totalSales = filteredData.length;
    const avgSale = totalSales > 0 ? totalRevenue / totalSales : 0;

    const byDate = {};
    filteredData.forEach(r => {
      const date = getDateString(r['Transaction Date']);
      if (!date) return;
      if (!byDate[date]) byDate[date] = { date, sales: 0, revenue: 0 };
      byDate[date].sales++;
      byDate[date].revenue += parseFloat(r['Developer Share'] || 0);
    });
    const dailyData = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));

    let cumRevenue = 0, cumSales = 0;
    const cumulativeData = dailyData.map(d => {
      cumRevenue += d.revenue; cumSales += d.sales;
      return { ...d, cumRevenue: Math.round(cumRevenue * 100) / 100, cumSales };
    });

    const byCountry = {};
    filteredData.forEach(r => {
      const country = r['Country of Sale'];
      if (!byCountry[country]) byCountry[country] = { code: country, name: COUNTRY_NAMES[country] || country, sales: 0, revenue: 0 };
      byCountry[country].sales++;
      byCountry[country].revenue += parseFloat(r['Developer Share'] || 0);
    });
    const countryData = Object.values(byCountry).sort((a, b) => b.revenue - a.revenue);

    const byWeek = {};
    filteredData.forEach(r => {
      const date = parseDate(r['Transaction Date']);
      if (!date || isNaN(date.getTime())) return;
      const day = date.getUTCDay();
      const diff = day === 0 ? -6 : 1 - day;
      const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + diff));
      const weekKey = monday.toISOString().split('T')[0];
      if (!byWeek[weekKey]) byWeek[weekKey] = { week: weekKey, sales: 0, revenue: 0 };
      byWeek[weekKey].sales++;
      byWeek[weekKey].revenue += parseFloat(r['Developer Share'] || 0);
    });
    const weeklyData = Object.values(byWeek).sort((a, b) => a.week.localeCompare(b.week));

    const byDayOfWeek = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    filteredData.forEach(r => {
      const date = parseDate(r['Transaction Date']);
      if (!date || isNaN(date.getTime())) return;
      byDayOfWeek[date.getUTCDay()]++;
    });
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayOfWeekData = Object.entries(byDayOfWeek).map(([day, sales]) => ({ day: dayNames[day], sales }));

    const byHour = {};
    for (let i = 0; i < 24; i++) byHour[i] = 0;
    filteredData.forEach(r => {
      const date = parseDate(r['Transaction Date']);
      if (!date || isNaN(date.getTime())) return;
      byHour[date.getUTCHours()]++;
    });
    const hourlyData = Object.entries(byHour).map(([hour, sales]) => ({ hour: `${hour.toString().padStart(2, '0')}:00`, sales }));

    const totalDays = dailyData.length;
    const avgDailySales = totalSales / totalDays;
    const weekdayCounts = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    const weekdaySales = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    dailyData.forEach(d => {
      const match = d.date.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (!match) return;
      const [, year, month, day] = match;
      const dow = new Date(Date.UTC(+year, +month - 1, +day)).getUTCDay();
      weekdayCounts[dow]++;
      weekdaySales[dow] += d.sales;
    });
    const dowMultipliers = {};
    for (let i = 0; i < 7; i++) {
      dowMultipliers[i] = weekdayCounts[i] > 0
        ? (avgDailySales > 0 ? (weekdaySales[i] / weekdayCounts[i]) / avgDailySales : 1)
        : 1;
    }

    let weeklyGrowthRate = 0;
    if (weeklyData.length >= 2) {
      const n = weeklyData.length;
      const xVals = weeklyData.map((_, i) => i);
      const yVals = weeklyData.map(w => w.sales);
      const xMean = xVals.reduce((a, b) => a + b, 0) / n;
      const yMean = yVals.reduce((a, b) => a + b, 0) / n;
      let numerator = 0, denominator = 0;
      for (let i = 0; i < n; i++) {
        numerator += (xVals[i] - xMean) * (yVals[i] - yMean);
        denominator += (xVals[i] - xMean) ** 2;
      }
      if (denominator > 0) {
        const slope = numerator / denominator;
        weeklyGrowthRate = yMean > 0 ? slope / yMean : 0;
      }
    }

    let forecastData = [];
    let forecastSummary = { projectedSales: 0, projectedRevenue: 0, weeklyGrowthPct: 0, bestDay: 'N/A', worstDay: 'N/A' };

    if (dailyData.length > 0 && cumulativeData.length > 0) {
      const lastDateStr = dailyData[dailyData.length - 1].date;
      const lastMatch = lastDateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (!lastMatch) return { totalRevenue, totalSales, avgSale, dailyData, cumulativeData, countryData, weeklyData, dayOfWeekData, hourlyData, forecastData, forecastSummary, dowMultipliers, appList, hasMultipleApps, currency, currencyMixed };

      const [, lastYear, lastMonth, lastDay] = lastMatch;
      const lastDate = new Date(Date.UTC(+lastYear, +lastMonth - 1, +lastDay));
      const lastCumRevenue = cumulativeData[cumulativeData.length - 1].cumRevenue;
      const lastCumSales = cumulativeData[cumulativeData.length - 1].cumSales;

      const recentWeekSales = dailyData.slice(-7).reduce((sum, d) => sum + d.sales, 0);
      const recentWeekDays = Math.min(7, dailyData.length);
      const baselineDailySales = recentWeekDays > 0 ? recentWeekSales / recentWeekDays : 0;

      let forecastCumSales = lastCumSales;
      let forecastCumRevenue = lastCumRevenue;

      const transitionDays = Math.min(5, dailyData.length);
      for (let i = transitionDays; i > 0; i--) {
        const d = cumulativeData[cumulativeData.length - i];
        if (d) forecastData.push({ date: d.date, cumSales: d.cumSales, cumRevenue: d.cumRevenue, type: 'actual' });
      }

      for (let i = 1; i <= 30; i++) {
        const forecastDate = new Date(lastDate);
        forecastDate.setUTCDate(forecastDate.getUTCDate() + i);
        const dateStr = forecastDate.toISOString().split('T')[0];
        const dow = forecastDate.getUTCDay();
        const weeksOut = i / 7;
        const growthFactor = 1 + (weeklyGrowthRate * weeksOut);
        const predictedSales = baselineDailySales * dowMultipliers[dow] * Math.max(0.5, growthFactor);
        forecastCumSales += predictedSales;
        forecastCumRevenue += predictedSales * avgSale;
        forecastData.push({
          date: dateStr,
          cumSales: Math.round(forecastCumSales * 10) / 10,
          cumRevenue: Math.round(forecastCumRevenue * 100) / 100,
          predictedSales: Math.round(predictedSales * 10) / 10,
          type: 'forecast'
        });
      }

      const sortedDow = Object.entries(dowMultipliers).sort((a, b) => b[1] - a[1]);
      forecastSummary = {
        projectedSales: Math.round(forecastCumSales - lastCumSales),
        projectedRevenue: Math.round((forecastCumRevenue - lastCumRevenue) * 100) / 100,
        weeklyGrowthPct: Math.round(weeklyGrowthRate * 100 * 10) / 10,
        bestDay: sortedDow.length > 0 ? dayNames[sortedDow[0][0]] : 'N/A',
        worstDay: sortedDow.length > 0 ? dayNames[sortedDow[sortedDow.length - 1][0]] : 'N/A',
      };
    }

    return { totalRevenue, totalSales, avgSale, dailyData, cumulativeData, countryData, weeklyData, dayOfWeekData, hourlyData, forecastData, forecastSummary, dowMultipliers, appList, hasMultipleApps, currency, currencyMixed };
  }, [rawData, selectedApp]);

  const formatDate = formatDateSafe;

  const loadSampleData = () => {
    const sampleCSV = `Transaction Date\tSettlement Date\tTitle\tDeveloper Name\tCountry of Sale\tDeveloper Share\tShare Currency
2025-12-01 09:15:22 UTC\t2025-12-03 06:00:00 UTC\tSample App A\tSample Dev\tUS\t3.40\tUSD
2025-12-01 14:22:11 UTC\t2025-12-03 06:00:00 UTC\tSample App A\tSample Dev\tGB\t3.78\tUSD
2025-12-02 08:45:33 UTC\t2025-12-04 06:00:00 UTC\tSample App B\tSample Dev\tUS\t3.40\tUSD
2025-12-02 11:30:45 UTC\t2025-12-04 06:00:00 UTC\tSample App C\tSample Dev\tUS\t3.40\tUSD
2025-12-02 16:20:18 UTC\t2025-12-04 06:00:00 UTC\tSample App C\tSample Dev\tDE\t3.82\tUSD
2025-12-03 10:11:55 UTC\t2025-12-05 06:00:00 UTC\tSample App A\tSample Dev\tCH\t4.05\tUSD
2025-12-03 19:44:02 UTC\t2025-12-05 06:00:00 UTC\tSample App C\tSample Dev\tCA\t3.95\tUSD
2025-12-04 07:33:28 UTC\t2025-12-06 06:00:00 UTC\tSample App A\tSample Dev\tUS\t3.40\tUSD
2025-12-04 12:15:44 UTC\t2025-12-06 06:00:00 UTC\tSample App B\tSample Dev\tFR\t3.71\tUSD
2025-12-05 08:22:17 UTC\t2025-12-08 06:00:00 UTC\tSample App A\tSample Dev\tUS\t3.40\tUSD
2025-12-05 15:40:33 UTC\t2025-12-08 06:00:00 UTC\tSample App A\tSample Dev\tDE\t3.85\tUSD
2025-12-05 21:55:09 UTC\t2025-12-08 06:00:00 UTC\tSample App C\tSample Dev\tUS\t3.40\tUSD
2025-12-06 10:28:41 UTC\t2025-12-09 06:00:00 UTC\tSample App B\tSample Dev\tUS\t3.40\tUSD
2025-12-07 09:17:55 UTC\t2025-12-10 06:00:00 UTC\tSample App A\tSample Dev\tJP\t3.12\tUSD
2025-12-07 14:33:22 UTC\t2025-12-10 06:00:00 UTC\tSample App A\tSample Dev\tUS\t3.40\tUSD
2025-12-08 11:45:18 UTC\t2025-12-11 06:00:00 UTC\tSample App B\tSample Dev\tGB\t3.76\tUSD
2025-12-08 16:22:05 UTC\t2025-12-11 06:00:00 UTC\tSample App C\tSample Dev\tDE\t3.88\tUSD
2025-12-09 08:55:33 UTC\t2025-12-12 06:00:00 UTC\tSample App A\tSample Dev\tUS\t3.40\tUSD
2025-12-09 13:40:27 UTC\t2025-12-12 06:00:00 UTC\tSample App A\tSample Dev\tCA\t4.02\tUSD
2025-12-10 10:15:44 UTC\t2025-12-13 06:00:00 UTC\tSample App A\tSample Dev\tUS\t3.40\tUSD
2025-12-10 17:28:11 UTC\t2025-12-13 06:00:00 UTC\tSample App B\tSample Dev\tUS\t3.40\tUSD
2025-12-11 09:33:55 UTC\t2025-12-14 06:00:00 UTC\tSample App A\tSample Dev\tCH\t4.11\tUSD
2025-12-12 08:17:22 UTC\t2025-12-15 06:00:00 UTC\tSample App A\tSample Dev\tUS\t3.40\tUSD
2025-12-12 14:45:09 UTC\t2025-12-15 06:00:00 UTC\tSample App A\tSample Dev\tGB\t3.79\tUSD
2025-12-12 19:22:33 UTC\t2025-12-15 06:00:00 UTC\tSample App B\tSample Dev\tDE\t3.84\tUSD
2025-12-13 11:55:17 UTC\t2025-12-16 06:00:00 UTC\tSample App C\tSample Dev\tUS\t3.40\tUSD
2025-12-14 10:28:44 UTC\t2025-12-17 06:00:00 UTC\tSample App A\tSample Dev\tUS\t3.40\tUSD
2025-12-14 15:33:28 UTC\t2025-12-17 06:00:00 UTC\tSample App A\tSample Dev\tUS\t3.40\tUSD
2025-12-15 09:17:55 UTC\t2025-12-18 06:00:00 UTC\tSample App A\tSample Dev\tDE\t3.87\tUSD
2025-12-15 14:40:11 UTC\t2025-12-18 06:00:00 UTC\tSample App B\tSample Dev\tUS\t3.40\tUSD
2025-12-16 08:22:33 UTC\t2025-12-19 06:00:00 UTC\tSample App A\tSample Dev\tFR\t3.68\tUSD
2025-12-16 12:55:47 UTC\t2025-12-19 06:00:00 UTC\tSample App A\tSample Dev\tUS\t3.40\tUSD
2025-12-17 10:33:22 UTC\t2025-12-20 06:00:00 UTC\tSample App A\tSample Dev\tUS\t3.40\tUSD
2025-12-17 16:17:09 UTC\t2025-12-20 06:00:00 UTC\tSample App B\tSample Dev\tCH\t4.08\tUSD
2025-12-18 09:45:55 UTC\t2025-12-21 06:00:00 UTC\tSample App A\tSample Dev\tCA\t3.98\tUSD
2025-12-18 14:28:33 UTC\t2025-12-21 06:00:00 UTC\tSample App A\tSample Dev\tUS\t3.40\tUSD
2025-12-19 11:17:22 UTC\t2025-12-22 06:00:00 UTC\tSample App A\tSample Dev\tGB\t3.81\tUSD
2025-12-19 15:55:44 UTC\t2025-12-22 06:00:00 UTC\tSample App B\tSample Dev\tUS\t3.40\tUSD
2025-12-20 08:33:17 UTC\t2025-12-23 06:00:00 UTC\tSample App A\tSample Dev\tUS\t3.40\tUSD
2025-12-20 13:40:28 UTC\t2025-12-23 06:00:00 UTC\tSample App A\tSample Dev\tDE\t3.83\tUSD
2025-12-21 10:22:55 UTC\t2025-12-24 06:00:00 UTC\tSample App A\tSample Dev\tUS\t3.40\tUSD
2025-12-22 09:17:33 UTC\t2025-12-26 06:00:00 UTC\tSample App A\tSample Dev\tJP\t3.15\tUSD
2025-12-22 14:45:11 UTC\t2025-12-26 06:00:00 UTC\tSample App A\tSample Dev\tUS\t3.40\tUSD
2025-12-22 18:28:44 UTC\t2025-12-26 06:00:00 UTC\tSample App B\tSample Dev\tUS\t3.40\tUSD
2025-12-23 11:55:22 UTC\t2025-12-27 06:00:00 UTC\tSample App A\tSample Dev\tCH\t4.02\tUSD
2025-12-24 08:33:55 UTC\t2025-12-28 06:00:00 UTC\tSample App A\tSample Dev\tUS\t3.40\tUSD
2025-12-24 15:17:09 UTC\t2025-12-28 06:00:00 UTC\tSample App A\tSample Dev\tGB\t3.74\tUSD
2025-12-26 10:45:33 UTC\t2025-12-29 06:00:00 UTC\tSample App A\tSample Dev\tUS\t3.40\tUSD
2025-12-26 14:22:17 UTC\t2025-12-29 06:00:00 UTC\tSample App B\tSample Dev\tDE\t3.86\tUSD
2025-12-27 09:55:44 UTC\t2025-12-30 06:00:00 UTC\tSample App A\tSample Dev\tCA\t4.05\tUSD
2025-12-27 16:33:28 UTC\t2025-12-30 06:00:00 UTC\tSample App A\tSample Dev\tUS\t3.40\tUSD
2025-12-28 11:17:55 UTC\t2025-12-31 06:00:00 UTC\tSample App A\tSample Dev\tUS\t3.40\tUSD
2025-12-28 15:40:22 UTC\t2025-12-31 06:00:00 UTC\tSample App A\tSample Dev\tFR\t3.72\tUSD
2025-12-29 10:28:33 UTC\t2026-01-02 06:00:00 UTC\tSample App A\tSample Dev\tDE\t3.89\tUSD
2025-12-29 14:55:11 UTC\t2026-01-02 06:00:00 UTC\tSample App B\tSample Dev\tUS\t3.40\tUSD
2025-12-30 08:45:44 UTC\t2026-01-03 06:00:00 UTC\tSample App A\tSample Dev\tUS\t3.40\tUSD
2025-12-30 13:22:09 UTC\t2026-01-03 06:00:00 UTC\tSample App A\tSample Dev\tCH\t4.08\tUSD
2025-12-31 10:17:55 UTC\t2026-01-04 06:00:00 UTC\tSample App A\tSample Dev\tUS\t3.40\tUSD
2025-12-31 15:33:28 UTC\t2026-01-04 06:00:00 UTC\tSample App A\tSample Dev\tGB\t3.77\tUSD
2026-01-01 11:45:22 UTC\t2026-01-05 06:00:00 UTC\tSample App A\tSample Dev\tUS\t3.40\tUSD
2026-01-01 16:28:55 UTC\t2026-01-05 06:00:00 UTC\tSample App A\tSample Dev\tUS\t3.40\tUSD
2026-01-02 09:55:33 UTC\t2026-01-06 06:00:00 UTC\tSample App A\tSample Dev\tDE\t3.84\tUSD
2026-01-02 14:17:44 UTC\t2026-01-06 06:00:00 UTC\tSample App B\tSample Dev\tUS\t3.40\tUSD
2026-01-03 10:33:17 UTC\t2026-01-07 06:00:00 UTC\tSample App A\tSample Dev\tCA\t3.99\tUSD
2026-01-03 15:45:28 UTC\t2026-01-07 06:00:00 UTC\tSample App A\tSample Dev\tUS\t3.40\tUSD
2026-01-03 19:22:55 UTC\t2026-01-07 06:00:00 UTC\tSample App A\tSample Dev\tJP\t3.18\tUSD
2026-01-04 08:55:11 UTC\t2026-01-08 06:00:00 UTC\tSample App A\tSample Dev\tUS\t3.40\tUSD
2026-01-04 13:17:33 UTC\t2026-01-08 06:00:00 UTC\tSample App A\tSample Dev\tCH\t4.12\tUSD
2026-01-04 17:40:44 UTC\t2026-01-08 06:00:00 UTC\tSample App B\tSample Dev\tGB\t3.75\tUSD
2026-01-05 10:28:22 UTC\t2026-01-09 06:00:00 UTC\tSample App A\tSample Dev\tUS\t3.40\tUSD
2026-01-05 14:55:55 UTC\t2026-01-09 06:00:00 UTC\tSample App A\tSample Dev\tDE\t3.86\tUSD
2026-01-06 09:33:17 UTC\t2026-01-10 06:00:00 UTC\tSample App A\tSample Dev\tFR\t3.69\tUSD
2026-01-06 15:17:28 UTC\t2026-01-10 06:00:00 UTC\tSample App A\tSample Dev\tUS\t3.40\tUSD
2026-01-07 11:45:44 UTC\t2026-01-11 06:00:00 UTC\tSample App A\tSample Dev\tUS\t3.40\tUSD
2026-01-07 16:22:33 UTC\t2026-01-11 06:00:00 UTC\tSample App B\tSample Dev\tUS\t3.40\tUSD
2026-01-08 10:55:11 UTC\t2026-01-12 06:00:00 UTC\tSample App A\tSample Dev\tGB\t3.80\tUSD
2026-01-08 14:33:55 UTC\t2026-01-12 06:00:00 UTC\tSample App A\tSample Dev\tUS\t3.40\tUSD
2026-01-08 18:17:22 UTC\t2026-01-12 06:00:00 UTC\tSample App A\tSample Dev\tCA\t4.01\tUSD
2026-01-09 09:45:33 UTC\t2026-01-13 06:00:00 UTC\tSample App A\tSample Dev\tUS\t3.40\tUSD
2026-01-09 13:28:44 UTC\t2026-01-13 06:00:00 UTC\tSample App A\tSample Dev\tDE\t3.91\tUSD
2026-01-10 10:17:55 UTC\t2026-01-14 06:00:00 UTC\tSample App A\tSample Dev\tCH\t4.06\tUSD
2026-01-10 15:55:22 UTC\t2026-01-14 06:00:00 UTC\tSample App B\tSample Dev\tUS\t3.40\tUSD
2026-01-11 11:33:17 UTC\t2026-01-15 06:00:00 UTC\tSample App A\tSample Dev\tUS\t3.40\tUSD
2026-01-11 16:45:28 UTC\t2026-01-15 06:00:00 UTC\tSample App A\tSample Dev\tJP\t3.21\tUSD
2026-01-12 09:22:55 UTC\t2026-01-16 06:00:00 UTC\tSample App A\tSample Dev\tUS\t3.40\tUSD
2026-01-12 14:17:33 UTC\t2026-01-16 06:00:00 UTC\tSample App A\tSample Dev\tGB\t3.82\tUSD
2026-01-12 18:40:11 UTC\t2026-01-16 06:00:00 UTC\tSample App A\tSample Dev\tDE\t3.88\tUSD
2026-01-13 10:55:44 UTC\t2026-01-17 06:00:00 UTC\tSample App B\tSample Dev\tCA\t3.96\tUSD
2026-01-14 09:33:22 UTC\t2026-01-18 06:00:00 UTC\tSample App A\tSample Dev\tUS\t3.40\tUSD
2026-01-14 15:17:55 UTC\t2026-01-18 06:00:00 UTC\tSample App A\tSample Dev\tUS\t3.40\tUSD
2026-01-15 11:45:33 UTC\t2026-01-19 06:00:00 UTC\tSample App A\tSample Dev\tFR\t3.73\tUSD
2026-01-15 16:28:17 UTC\t2026-01-19 06:00:00 UTC\tSample App A\tSample Dev\tCH\t4.09\tUSD
2026-01-16 10:22:44 UTC\t2026-01-20 06:00:00 UTC\tSample App A\tSample Dev\tUS\t3.40\tUSD
2026-01-16 14:55:28 UTC\t2026-01-20 06:00:00 UTC\tSample App B\tSample Dev\tDE\t3.83\tUSD
2026-01-17 09:17:55 UTC\t2026-01-21 06:00:00 UTC\tSample App A\tSample Dev\tCA\t4.04\tUSD
2026-01-17 13:33:11 UTC\t2026-01-21 06:00:00 UTC\tSample App A\tSample Dev\tUS\t3.40\tUSD
2026-01-17 17:45:33 UTC\t2026-01-21 06:00:00 UTC\tSample App A\tSample Dev\tGB\t3.76\tUSD
2026-01-18 10:28:22 UTC\t2026-01-22 06:00:00 UTC\tSample App A\tSample Dev\tUS\t3.40\tUSD
2026-01-18 15:55:44 UTC\t2026-01-22 06:00:00 UTC\tSample App A\tSample Dev\tDE\t3.85\tUSD
2026-01-19 11:17:17 UTC\t2026-01-23 06:00:00 UTC\tSample App A\tSample Dev\tJP\t3.14\tUSD
2026-01-19 16:33:28 UTC\t2026-01-23 06:00:00 UTC\tSample App B\tSample Dev\tUS\t3.40\tUSD
2026-01-20 09:45:55 UTC\t2026-01-24 06:00:00 UTC\tSample App A\tSample Dev\tUS\t3.40\tUSD
2026-01-20 14:22:33 UTC\t2026-01-24 06:00:00 UTC\tSample App A\tSample Dev\tCH\t4.07\tUSD
2026-01-21 10:55:11 UTC\t2026-01-25 06:00:00 UTC\tSample App A\tSample Dev\tUS\t3.40\tUSD
2026-01-21 15:17:44 UTC\t2026-01-25 06:00:00 UTC\tSample App A\tSample Dev\tFR\t3.70\tUSD
2026-01-22 09:33:22 UTC\t2026-01-26 06:00:00 UTC\tSample App A\tSample Dev\tGB\t3.79\tUSD
2026-01-22 14:45:55 UTC\t2026-01-26 06:00:00 UTC\tSample App B\tSample Dev\tUS\t3.40\tUSD
2026-01-23 11:28:17 UTC\t2026-01-27 06:00:00 UTC\tSample App A\tSample Dev\tUS\t3.40\tUSD
2026-01-23 16:55:33 UTC\t2026-01-27 06:00:00 UTC\tSample App A\tSample Dev\tDE\t3.90\tUSD
2026-01-24 10:17:44 UTC\t2026-01-28 06:00:00 UTC\tSample App A\tSample Dev\tCA\t4.00\tUSD
2026-01-24 15:33:22 UTC\t2026-01-28 06:00:00 UTC\tSample App A\tSample Dev\tUS\t3.40\tUSD
2026-01-25 09:45:11 UTC\t2026-01-29 06:00:00 UTC\tSample App A\tSample Dev\tCH\t4.10\tUSD
2026-01-25 14:22:55 UTC\t2026-01-29 06:00:00 UTC\tSample App A\tSample Dev\tUS\t3.40\tUSD
2026-01-26 10:55:28 UTC\t2026-01-30 06:00:00 UTC\tSample App B\tSample Dev\tGB\t3.78\tUSD
2026-01-26 15:17:33 UTC\t2026-01-30 06:00:00 UTC\tSample App A\tSample Dev\tJP\t3.17\tUSD
2026-01-27 11:33:44 UTC\t2026-01-31 06:00:00 UTC\tSample App A\tSample Dev\tUS\t3.40\tUSD
2026-01-27 16:45:22 UTC\t2026-01-31 06:00:00 UTC\tSample App A\tSample Dev\tDE\t3.87\tUSD
2026-01-28 09:28:55 UTC\t2026-02-01 06:00:00 UTC\tSample App A\tSample Dev\tUS\t3.40\tUSD
2026-01-28 14:55:17 UTC\t2026-02-01 06:00:00 UTC\tSample App A\tSample Dev\tFR\t3.71\tUSD
2026-01-29 10:17:33 UTC\t2026-02-02 06:00:00 UTC\tSample App A\tSample Dev\tCA\t4.03\tUSD
2026-01-29 15:33:44 UTC\t2026-02-02 06:00:00 UTC\tSample App B\tSample Dev\tUS\t3.40\tUSD
2026-01-30 11:45:22 UTC\t2026-02-03 06:00:00 UTC\tSample App A\tSample Dev\tUS\t3.40\tUSD
2026-01-30 16:28:55 UTC\t2026-02-03 06:00:00 UTC\tSample App A\tSample Dev\tCH\t4.05\tUSD
2026-01-31 09:55:17 UTC\t2026-02-04 06:00:00 UTC\tSample App A\tSample Dev\tGB\t3.81\tUSD
2026-01-31 14:17:33 UTC\t2026-02-04 06:00:00 UTC\tSample App A\tSample Dev\tUS\t3.40\tUSD`;
    const parsed = parseCSV(sampleCSV);
    setRawData(parsed);
    setDebugInfo(`Loaded ${parsed.length} sample transactions`);
  };

  if (!rawData.length) {
    return (
      <div
        onPaste={handlePaste}
        tabIndex={0}
        style={{
          minHeight: '100vh', background: PISTE.dark, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          fontFamily: "'DM Sans', system-ui, sans-serif", padding: '20px',
          outline: 'none', position: 'relative'
        }}
      >
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          pointerEvents: 'none', opacity: 0.35, zIndex: 1000,
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 512 512' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
          backgroundSize: '256px 256px', mixBlendMode: 'overlay'
        }}/>
        <div style={{
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '16px', padding: '40px', textAlign: 'center',
          maxWidth: '420px', position: 'relative', zIndex: 1
        }}>
          <div style={{ marginBottom: '28px' }}>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginBottom: '20px' }}>
              <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: PISTE.green }} />
              <div style={{ width: '32px', height: '32px', borderRadius: '6px', background: PISTE.blue }} />
              <div style={{ width: '32px', height: '32px', borderRadius: '6px', background: PISTE.orange, transform: 'rotate(45deg)' }} />
              <div style={{ width: '32px', height: '32px', borderRadius: '6px', background: PISTE.black, border: `2px solid ${PISTE.white}` }} />
            </div>
            <h1 style={{ color: PISTE.white, fontSize: '28px', fontWeight: '700', marginBottom: '8px', letterSpacing: '-0.5px' }}>
              CIQ Sales Dashboard
            </h1>
            <p style={{ color: PISTE.slate, fontSize: '14px' }}>Visualize your Connect IQ sales</p>
          </div>

          <label style={{
            display: 'block', padding: '28px', border: `2px dashed ${PISTE.blue}60`,
            borderRadius: '12px', cursor: 'pointer', transition: 'all 0.2s',
            background: 'rgba(59, 130, 246, 0.05)'
          }}>
            <input type="file" accept=".csv,.tsv,.txt" onChange={handleFileUpload} style={{ display: 'none' }} />
            <div style={{ color: PISTE.blue, fontSize: '40px', marginBottom: '12px' }}>↑</div>
            <div style={{ color: PISTE.white, fontSize: '16px', fontWeight: '600', marginBottom: '6px' }}>Select your CSV</div>
            <div style={{ color: PISTE.slate, fontSize: '12px' }}>or paste with Ctrl+V / Cmd+V</div>
          </label>

          {error && (
            <div style={{ marginTop: '16px', padding: '12px', background: `${PISTE.red}20`, borderRadius: '8px', border: `1px solid ${PISTE.red}40` }}>
              <p style={{ color: PISTE.red, fontSize: '13px', margin: 0 }}>⚠ {error}</p>
              {debugInfo && <p style={{ color: PISTE.slate, fontSize: '11px', margin: '8px 0 0', wordBreak: 'break-all' }}>{debugInfo}</p>}
            </div>
          )}

          <button
            onClick={loadSampleData}
            style={{
              marginTop: '16px', padding: '10px 20px', background: 'transparent',
              border: `1px solid ${PISTE.green}`, borderRadius: '8px',
              color: PISTE.green, fontSize: '13px', fontWeight: '500', cursor: 'pointer'
            }}
          >
            Load Sample Data
          </button>

          <div style={{ marginTop: '16px', padding: '12px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px' }}>
            <p style={{ color: PISTE.slate, fontSize: '11px', margin: 0 }}>
              <a
                href="https://apps-developer.garmin.com/developer/dashboard?dashboardTab=2&merchantDashboard=documents"
                target="_blank"
                rel="noopener noreferrer"
                title="app-developer.garmin.com → Merchant Account → Documents → + Request"
                style={{ color: PISTE.slate, textDecoration: 'none' }}
              >
                📄 Get Sales Report ↗
              </a>
            </p>
          </div>

          <p style={{ marginTop: '20px', marginBottom: 0, fontSize: '11px', color: PISTE.slate }}>
            If you find this useful,{' '}
            <a
              href="https://buymeacoffee.com/chaphi"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: PISTE.orange, textDecoration: 'none', fontWeight: '500' }}
              onMouseEnter={e => e.target.style.textDecoration = 'underline'}
              onMouseLeave={e => e.target.style.textDecoration = 'none'}
            >
              buy me a coffee ☕
            </a>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh', background: PISTE.dark,
      fontFamily: "'DM Sans', system-ui, sans-serif", color: PISTE.white,
      padding: '16px', overflowX: 'hidden', maxWidth: '100vw', position: 'relative'
    }}>
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        pointerEvents: 'none', opacity: 0.35, zIndex: 1000,
        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 512 512' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
        backgroundSize: '256px 256px', mixBlendMode: 'overlay'
      }}/>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@500&display=swap');
        * { box-sizing: border-box; }
        html, body { overflow-x: hidden; -webkit-overflow-scrolling: touch; margin: 0; padding: 0; background: ${PISTE.dark}; }
        .card { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 20px; transition: all 0.3s; overflow: hidden; position: relative; }
        .card:hover { border-color: rgba(255,255,255,0.15); box-shadow: 0 8px 32px rgba(0,0,0,0.5); }
        .stat-card { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); }
        .recharts-wrapper { touch-action: pan-y; -webkit-user-select: none; user-select: none; }
        .recharts-default-tooltip { background-color: ${PISTE.dark} !important; border: 1px solid rgba(255,255,255,0.15) !important; border-radius: 8px !important; color: ${PISTE.white} !important; }
        .recharts-tooltip-label { color: ${PISTE.white} !important; }
        .recharts-tooltip-item { color: ${PISTE.white} !important; }
        @media (max-width: 768px) { .card { padding: 14px; border-radius: 12px; } h1 { font-size: 20px !important; } h3 { font-size: 14px !important; } }
      `}</style>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '12px', position: 'relative', zIndex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div onClick={() => setRawData([])} style={{ display: 'flex', gap: '6px', alignItems: 'center', cursor: 'pointer' }}>
            <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: PISTE.green }} />
            <div style={{ width: '24px', height: '24px', borderRadius: '4px', background: PISTE.blue }} />
            <div style={{ width: '24px', height: '24px', borderRadius: '4px', background: PISTE.orange, transform: 'rotate(45deg)' }} />
          </div>
          <div>
            <h1 onClick={() => setRawData([])} style={{ fontSize: '24px', fontWeight: '700', margin: 0, letterSpacing: '-0.5px', color: PISTE.white, cursor: 'pointer' }}>CIQ Sales Dashboard</h1>
            <p style={{ color: PISTE.slate, margin: 0, fontSize: '12px' }}>
              {selectedApp !== 'all' && stats.appList.find(a => a.id === selectedApp)?.title && (
                <span style={{ color: PISTE.blue }}>
                  {stats.appList.find(a => a.id === selectedApp).title.substring(0, 35)}
                  {stats.appList.find(a => a.id === selectedApp).title.length > 35 ? '...' : ''} •{' '}
                </span>
              )}
              {stats.dailyData[0]?.date} → {stats.dailyData[stats.dailyData.length - 1]?.date}
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          {debugInfo && <span style={{ color: PISTE.slate, fontSize: '11px' }}>✓ {debugInfo}</span>}
          {stats.hasMultipleApps && (
            <select value={selectedApp} onChange={(e) => setSelectedApp(e.target.value)}
              style={{ padding: '8px 12px', background: 'rgba(255,255,255,0.08)', border: `1px solid ${PISTE.blue}`, borderRadius: '8px', fontSize: '12px', fontWeight: '500', color: PISTE.white, cursor: 'pointer', outline: 'none', maxWidth: '180px' }}>
              <option value="all" style={{ background: PISTE.dark }}>All Apps ({stats.appList.length})</option>
              {stats.appList.map(app => (
                <option key={app.id} value={app.id} style={{ background: PISTE.dark }}>
                  {app.title.length > 25 ? app.title.substring(0, 25) + '...' : app.title}
                </option>
              ))}
            </select>
          )}
          <label style={{ padding: '8px 16px', background: PISTE.green, border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: '600', color: PISTE.white }}>
            <input type="file" accept=".csv,.tsv,.txt" onChange={handleFileUpload} style={{ display: 'none' }} />
            ↑ Import
          </label>
        </div>
      </div>

      {/* Key Metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))', gap: '10px', marginBottom: '16px', position: 'relative', zIndex: 1 }}>
        {[
          { label: 'Revenue', value: fmtMoney(stats.totalRevenue, stats.currency), color: PISTE.green },
          { label: 'Sales', value: stats.totalSales, color: PISTE.blue },
          { label: 'Avg/Sale', value: fmtMoney(stats.avgSale, stats.currency), color: PISTE.orange },
          { label: 'Countries', value: stats.countryData.length, color: PISTE.white }
        ].map((stat, i) => (
          <div key={i} className="card stat-card" style={{ padding: '14px' }}>
            <p style={{ color: PISTE.slate, fontSize: '10px', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '600' }}>{stat.label}</p>
            <p style={{ fontSize: '22px', fontWeight: '700', margin: 0, fontFamily: "'JetBrains Mono', monospace", color: stat.color }}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* App Breakdown */}
      {stats.hasMultipleApps && selectedApp === 'all' && (
        <div className="card" style={{ marginBottom: '16px', border: `1px solid ${PISTE.blue}30` }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: '600', color: PISTE.white }}>Revenue by App</h3>
          <div style={{ width: '100%', overflowX: 'auto' }}>
            <ResponsiveContainer width="100%" height={Math.max(160, stats.appList.length * 36)}>
              <BarChart data={stats.appList} layout="vertical" margin={{ left: 10, right: 10, top: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis type="number" stroke={PISTE.slate} fontSize={10} tickFormatter={v => fmtMoney(v, stats.currency, { fractionDigits: 0 })} />
                <YAxis type="category" dataKey="title" stroke="#64748b" fontSize={10} width={100} tickFormatter={t => t.length > 15 ? t.substring(0, 15) + '...' : t} />
                <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid rgba(168, 85, 247, 0.3)', borderRadius: '12px', color: PISTE.white }} formatter={(v, name) => [name === 'revenue' ? fmtMoney(v, stats.currency) : v, name === 'revenue' ? 'Revenue' : 'Sales']} />
                <Bar dataKey="revenue" fill="#a78bfa" radius={[0, 6, 6, 0]} name="revenue" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div style={{ display: 'grid', gap: '8px', marginTop: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))' }}>
            {stats.appList.slice(0, 4).map((app) => (
              <div key={app.id} onClick={() => setSelectedApp(app.id)}
                style={{ padding: '12px', background: 'rgba(255,255,255,0.03)', borderRadius: '10px', cursor: 'pointer', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ fontSize: '12px', fontWeight: '500', color: '#e2e8f0', marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{app.title}</div>
                <div style={{ display: 'flex', gap: '12px', fontSize: '11px', color: '#94a3b8' }}>
                  <span><span style={{ color: '#a78bfa', fontWeight: '600' }}>{fmtMoney(app.revenue, stats.currency)}</span></span>
                  <span><span style={{ color: '#60a5fa', fontWeight: '600' }}>{app.sales}</span> sales</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Charts Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 400px), 1fr))', gap: '16px' }}>

        {/* Cumulative Revenue */}
        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: '600', color: PISTE.white }}>Cumulative Revenue & Sales</h3>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={stats.cumulativeData}>
              <defs>
                <linearGradient id="gradientRevenue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={PISTE.green} stopOpacity={0.4}/>
                  <stop offset="95%" stopColor={PISTE.green} stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="date" tickFormatter={formatDate} stroke={PISTE.slate} fontSize={10} />
              <YAxis yAxisId="left" stroke={PISTE.green} fontSize={10} tickFormatter={v => fmtMoney(v, stats.currency, { fractionDigits: 0 })} />
              <YAxis yAxisId="right" orientation="right" stroke={PISTE.blue} fontSize={10} />
              <Tooltip contentStyle={{ background: PISTE.dark, border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', color: PISTE.white }}
                formatter={(value, name) => [name === 'cumRevenue' ? fmtMoney(value, stats.currency) : value, name === 'cumRevenue' ? 'Revenue' : 'Sales']}
                labelFormatter={formatDate} />
              <Area yAxisId="left" type="monotone" dataKey="cumRevenue" stroke={PISTE.green} strokeWidth={2} fill="url(#gradientRevenue)" />
              <Line yAxisId="right" type="monotone" dataKey="cumSales" stroke={PISTE.blue} strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Daily Sales */}
        <div className="card">
          <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: '600', color: PISTE.white }}>Daily Sales</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={stats.dailyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="date" tickFormatter={formatDate} stroke={PISTE.slate} fontSize={9} angle={-45} textAnchor="end" height={50} />
              <YAxis stroke={PISTE.slate} fontSize={10} allowDecimals={false} />
              <Tooltip contentStyle={{ background: PISTE.dark, border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', color: PISTE.white }} formatter={(v) => [v, 'Sales']} labelFormatter={formatDate} />
              <Bar dataKey="sales" fill={PISTE.blue} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Country Distribution */}
        <div className="card">
          <h3 style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: '600', color: PISTE.white }}>Sales by Country</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie data={stats.countryData} dataKey="sales" nameKey="code" cx="50%" cy="50%" innerRadius={30} outerRadius={60} paddingAngle={2}
                  onMouseEnter={(_, i) => setHoveredCountry(i)} onMouseLeave={() => setHoveredCountry(null)}>
                  {stats.countryData.map((entry, i) => (
                    <Cell key={entry.code} fill={COLORS[i % COLORS.length]}
                      opacity={hoveredCountry === null || hoveredCountry === i ? 1 : 0.4}
                      stroke={hoveredCountry === i ? PISTE.white : 'none'} strokeWidth={2} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ background: PISTE.dark, border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', color: PISTE.white }}
                  labelStyle={{ color: PISTE.white }} itemStyle={{ color: PISTE.white }}
                  formatter={(v, n, p) => [`${v} sales (${fmtMoney(p.payload.revenue, stats.currency)})`, p.payload.name]} />
              </PieChart>
            </ResponsiveContainer>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '4px', maxHeight: '120px', overflowY: 'auto' }}>
              {stats.countryData.slice(0, 8).map((c, i) => (
                <div key={c.code} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 6px', borderRadius: '4px', background: hoveredCountry === i ? 'rgba(255,255,255,0.1)' : 'transparent', cursor: 'default' }}
                  onMouseEnter={() => setHoveredCountry(i)} onMouseLeave={() => setHoveredCountry(null)}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
                    <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: COLORS[i % COLORS.length], flexShrink: 0 }}/>
                    <span style={{ fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.code}</span>
                  </span>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '11px', color: '#94a3b8', flexShrink: 0 }}>{c.sales}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Weekly Revenue */}
        <div className="card">
          <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: '600', color: PISTE.white }}>Weekly Revenue</h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={stats.weeklyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="week" tickFormatter={formatDateSafe} stroke={PISTE.slate} fontSize={10} />
              <YAxis stroke={PISTE.slate} fontSize={10} tickFormatter={v => fmtMoney(v, stats.currency, { fractionDigits: 0 })} />
              <Tooltip contentStyle={{ background: PISTE.dark, border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', color: PISTE.white }}
                formatter={(v) => [fmtMoney(v, stats.currency), 'Revenue']}
                labelFormatter={(w) => {
                  const match = w.match(/(\d{4})-(\d{2})-(\d{2})/);
                  if (!match) return w;
                  const [, year, month, day] = match;
                  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                  const start = new Date(Date.UTC(+year, +month - 1, +day));
                  const end = new Date(start); end.setUTCDate(end.getUTCDate() + 6);
                  return `Week of ${months[+month-1]} ${+day} – ${months[end.getUTCMonth()]} ${end.getUTCDate()}`;
                }} />
              <Bar dataKey="revenue" fill={PISTE.green} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Day of Week */}
        <div className="card">
          <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: '600', color: PISTE.white }}>Sales by Day</h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={stats.dayOfWeekData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis type="number" stroke={PISTE.slate} fontSize={10} />
              <YAxis type="category" dataKey="day" stroke={PISTE.slate} fontSize={10} width={35} />
              <Tooltip contentStyle={{ background: PISTE.dark, border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', color: PISTE.white }} formatter={(v) => [v, 'Sales']} />
              <Bar dataKey="sales" fill={PISTE.orange} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Hourly Distribution */}
        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: '600', color: PISTE.white }}>Sales by Hour (UTC)</h3>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={stats.hourlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="hour" stroke={PISTE.slate} fontSize={9} interval={3} />
              <YAxis stroke={PISTE.slate} fontSize={10} allowDecimals={false} />
              <Tooltip contentStyle={{ background: PISTE.dark, border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', color: PISTE.white }} formatter={(v) => [v, 'Sales']} />
              <Bar dataKey="sales" fill={PISTE.blue} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* 30-Day Forecast */}
        {stats.forecastData && stats.forecastData.length > 0 && (
          <div className="card" style={{ gridColumn: '1 / -1', border: `1px solid ${PISTE.blue}40` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px', flexWrap: 'wrap', gap: '10px' }}>
              <div>
                <h3 style={{ margin: '0 0 4px', fontSize: '14px', fontWeight: '600', color: PISTE.white }}>30-Day Forecast</h3>
                <p style={{ margin: 0, fontSize: '11px', color: PISTE.slate }}>
                  {stats.weeklyData.length}-week trend • {stats.forecastSummary.weeklyGrowthPct > 0 ? '+' : ''}{stats.forecastSummary.weeklyGrowthPct}%/week
                </p>
              </div>
              <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ margin: 0, fontSize: '10px', color: PISTE.slate, textTransform: 'uppercase', letterSpacing: '1px' }}>Sales</p>
                  <p style={{ margin: 0, fontSize: '18px', fontWeight: '700', fontFamily: "'JetBrains Mono', monospace", color: PISTE.green }}>+{stats.forecastSummary.projectedSales}</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ margin: 0, fontSize: '10px', color: PISTE.slate, textTransform: 'uppercase', letterSpacing: '1px' }}>Revenue</p>
                  <p style={{ margin: 0, fontSize: '18px', fontWeight: '700', fontFamily: "'JetBrains Mono', monospace", color: PISTE.green }}>+{fmtMoney(stats.forecastSummary.projectedRevenue, stats.currency)}</p>
                </div>
              </div>
            </div>

            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={stats.forecastData}>
                <defs>
                  <linearGradient id="gradientActual" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={PISTE.green} stopOpacity={0.4}/>
                    <stop offset="95%" stopColor={PISTE.green} stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="gradientForecast" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={PISTE.orange} stopOpacity={0.4}/>
                    <stop offset="95%" stopColor={PISTE.orange} stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="date" tickFormatter={formatDateSafe} stroke={PISTE.slate} fontSize={9} interval={5} />
                <YAxis yAxisId="revenue" stroke={PISTE.green} fontSize={10} tickFormatter={v => fmtMoney(v, stats.currency, { fractionDigits: 0 })} />
                <YAxis yAxisId="sales" orientation="right" stroke={PISTE.blue} fontSize={10} />
                <Tooltip contentStyle={{ background: PISTE.dark, border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', color: PISTE.white }}
                  formatter={(value, name) => {
                    if (name === 'cumRevenue') return [fmtMoney(value, stats.currency), 'Revenue'];
                    if (name === 'cumSales') return [Math.round(value), 'Sales'];
                    return [value, name];
                  }}
                  labelFormatter={(d) => {
                    const item = stats.forecastData.find(f => f.date === d);
                    const type = item?.type === 'forecast' ? ' (Forecast)' : '';
                    const match = d.match(/(\d{4})-(\d{2})-(\d{2})/);
                    if (!match) return d + type;
                    const [, year, month, day] = match;
                    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
                    const dateObj = new Date(Date.UTC(+year, +month - 1, +day));
                    return `${days[dateObj.getUTCDay()]} ${months[+month-1]} ${+day}${type}`;
                  }} />
                <Area yAxisId="revenue" type="monotone" dataKey="cumRevenue" stroke={PISTE.green} strokeWidth={2} fill="url(#gradientForecast)"
                  dot={(props) => {
                    const { cx, cy, payload } = props;
                    if (payload.type === 'actual') return null;
                    const idx = stats.forecastData.findIndex(f => f.date === payload.date);
                    if (idx % 7 !== 0) return null;
                    return <circle key={payload.date} cx={cx} cy={cy} r={3} fill={PISTE.orange} />;
                  }} />
                <Line yAxisId="sales" type="monotone" dataKey="cumSales" stroke={PISTE.blue} strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>

            <div style={{ display: 'flex', gap: '12px', marginTop: '10px', padding: '10px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: '140px' }}>
                <p style={{ margin: '0 0 4px', fontSize: '11px', fontWeight: '600', color: PISTE.white }}>Insights</p>
                <p style={{ margin: 0, fontSize: '10px', color: PISTE.slate, lineHeight: 1.5 }}>
                  Best: <span style={{ color: PISTE.green }}>{stats.forecastSummary.bestDay}</span> ·{' '}
                  Slow: <span style={{ color: PISTE.orange }}>{stats.forecastSummary.worstDay}</span> ·{' '}
                  <span style={{ color: stats.forecastSummary.weeklyGrowthPct >= 0 ? PISTE.green : PISTE.orange }}>
                    {stats.forecastSummary.weeklyGrowthPct >= 0 ? '↑' : '↓'} {stats.forecastSummary.weeklyGrowthPct}%/wk
                  </span>
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      <div style={{ marginTop: '24px', textAlign: 'center', color: PISTE.slate, fontSize: '11px', position: 'relative', zIndex: 1, paddingBottom: '8px' }}>
        CIQ Sales Dashboard • Visualize your Connect IQ sales
        <div style={{ marginTop: '8px' }}>
          If you find this useful,{' '}
          <a
            href="https://buymeacoffee.com/chaphi"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: PISTE.orange, textDecoration: 'none', fontWeight: '500' }}
            onMouseEnter={e => e.target.style.textDecoration = 'underline'}
            onMouseLeave={e => e.target.style.textDecoration = 'none'}
          >
            buy me a coffee ☕
          </a>
        </div>
      </div>
    </div>
  );
}
