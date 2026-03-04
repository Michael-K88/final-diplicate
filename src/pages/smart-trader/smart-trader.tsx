import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import { generateDerivApiInstance } from '@/external/bot-skeleton/services/api/appId';
import { useStore } from '@/hooks/useStore';
import './smart-trader.scss';

interface SymbolInfo {
    symbol: string;
    display_name: string;
}

interface EntryPoint {
    action: string;
    prediction?: number;
    ticks: number;
    reasoning: string;
    streak: string;
    bestTime: string;
    topDigits: number[];
    digitFreqs: { digit: number; pct: number }[];
}

interface Signal {
    type: string;
    label: string;
    confidence: number;
    direction: 'up' | 'down' | 'neutral';
    detail: string;
    entry: EntryPoint;
}

interface SymbolSignals {
    symbol: string;
    display_name: string;
    signals: Signal[];
    lastPrice: string;
    lastDigit: number | null;
    tickCount: number;
}

const TICK_HISTORY_SIZE = 150;

const ALLOWED_SYMBOLS: { symbol: string; display_name: string }[] = [
    { symbol: '1HZ10V', display_name: 'Volatility 10 (1s)' },
    { symbol: 'R_10', display_name: 'Volatility 10 Index' },
    { symbol: '1HZ15V', display_name: 'Volatility 15 (1s)' },
    { symbol: '1HZ25V', display_name: 'Volatility 25 (1s)' },
    { symbol: 'R_25', display_name: 'Volatility 25 Index' },
    { symbol: '1HZ30V', display_name: 'Volatility 30 (1s)' },
    { symbol: '1HZ50V', display_name: 'Volatility 50 (1s)' },
    { symbol: 'R_50', display_name: 'Volatility 50 Index' },
    { symbol: '1HZ75V', display_name: 'Volatility 75 (1s)' },
    { symbol: 'R_75', display_name: 'Volatility 75 Index' },
    { symbol: '1HZ90V', display_name: 'Volatility 90 (1s)' },
    { symbol: '1HZ100V', display_name: 'Volatility 100 (1s)' },
    { symbol: 'R_100', display_name: 'Volatility 100 Index' },
];

const SIGNAL_TYPES = [
    { id: 'over2', label: 'OVER 2', threshold: '>75%', color: '#10b981' },
    { id: 'under7', label: 'UNDER 7', threshold: '>75%', color: '#3b82f6' },
    { id: 'higher', label: 'HIGHER', threshold: '>56%', color: '#8b5cf6' },
    { id: 'lower', label: 'LOWER', threshold: '>56%', color: '#6366f1' },
    { id: 'odd', label: 'ODD', threshold: '>56%', color: '#f59e0b' },
    { id: 'over3', label: 'OVER 3', threshold: '>60%', color: '#14b8a6' },
    { id: 'under6', label: 'UNDER 6', threshold: '>60%', color: '#06b6d4' },
    { id: 'even', label: 'EVEN', threshold: '>56%', color: '#a855f7' },
    { id: 'rise', label: 'RISE', threshold: '>56%', color: '#22c55e' },
    { id: 'fall', label: 'FALL', threshold: '>56%', color: '#ef4444' },
    { id: 'matches', label: 'MATCHES', threshold: '>15%', color: '#f97316' },
    { id: 'differs', label: 'DIFFERS', threshold: '>85%', color: '#ec4899' },
];

function detectStreak(digits: number[], testFn: (d: number) => boolean): { current: number; max: number } {
    let current = 0;
    for (let i = digits.length - 1; i >= 0; i--) {
        if (testFn(digits[i])) current++;
        else break;
    }
    let max = 0;
    let streak = 0;
    for (let i = 0; i < digits.length; i++) {
        if (testFn(digits[i])) { streak++; max = Math.max(max, streak); }
        else streak = 0;
    }
    return { current, max };
}

function findBestTicks(digits: number[], testFn: (d: number) => boolean): number {
    let bestTicks = 5;
    let bestRate = 0;
    for (const t of [1, 3, 5, 7, 10]) {
        if (digits.length < t * 3) continue;
        let wins = 0;
        let rounds = 0;
        for (let i = 0; i <= digits.length - t; i += t) {
            const chunk = digits.slice(i, i + t);
            if (testFn(chunk[chunk.length - 1])) wins++;
            rounds++;
        }
        const rate = rounds > 0 ? wins / rounds : 0;
        if (rate > bestRate) { bestRate = rate; bestTicks = t; }
    }
    return bestTicks;
}

function getTopDigits(counts: number[], total: number, n: number): { digit: number; pct: number }[] {
    return counts
        .map((c, d) => ({ digit: d, pct: total > 0 ? Math.round((c / total) * 100) : 0 }))
        .sort((a, b) => b.pct - a.pct)
        .slice(0, n);
}

function analyzeRecentTrend(digits: number[], testFn: (d: number) => boolean): string {
    const last10 = digits.slice(-10);
    const last30 = digits.slice(-30);
    const r10 = last10.length > 0 ? last10.filter(testFn).length / last10.length : 0;
    const r30 = last30.length > 0 ? last30.filter(testFn).length / last30.length : 0;
    if (r10 > r30 + 0.1) return 'Strengthening';
    if (r10 < r30 - 0.1) return 'Weakening';
    return 'Stable';
}

function analyzeSignals(digits: number[], prices: number[]): Signal[] {
    const signals: Signal[] = [];
    if (digits.length < 20) return signals;

    const total = digits.length;
    const counts = new Array(10).fill(0);
    digits.forEach(d => counts[d]++);
    const topDigitsAll = getTopDigits(counts, total, 3);
    const digitFreqs = counts.map((c, d) => ({ digit: d, pct: total > 0 ? Math.round((c / total) * 100) : 0 }));

    const overCount = (threshold: number) => digits.filter(d => d > threshold).length;
    const underCount = (threshold: number) => digits.filter(d => d < threshold).length;

    const makeEntry = (testFn: (d: number) => boolean, action: string, prediction?: number): EntryPoint => {
        const streak = detectStreak(digits, testFn);
        const bestTicks = findBestTicks(digits, testFn);
        const trend = analyzeRecentTrend(digits, testFn);
        return {
            action, prediction, ticks: bestTicks,
            reasoning: trend === 'Strengthening' ? 'Likely higher digits' : trend === 'Weakening' ? 'weak pattern detected' : 'Likely higher digits',
            streak: streak.current > 0 ? `${streak.current} in a row (max ${streak.max})` : `Max streak: ${streak.max}`,
            bestTime: trend === 'Strengthening' ? 'Now' : trend === 'Stable' ? 'Good' : 'Wait',
            topDigits: topDigitsAll.map(d => d.digit),
            digitFreqs,
        };
    };

    const over2Pct = (overCount(2) / total) * 100;
    if (over2Pct >= 75)
        signals.push({ type: 'over2', label: 'Over 2', confidence: Math.round(over2Pct * 10) / 10, direction: 'up',
            detail: `${overCount(2)}/${total} ticks > 2`, entry: makeEntry(d => d > 2, 'DIGITOVER', 2) });

    const under7Pct = (underCount(7) / total) * 100;
    if (under7Pct >= 75)
        signals.push({ type: 'under7', label: 'Under 7', confidence: Math.round(under7Pct * 10) / 10, direction: 'down',
            detail: `${underCount(7)}/${total} ticks < 7`, entry: makeEntry(d => d < 7, 'DIGITUNDER', 7) });

    const over3Pct = (overCount(3) / total) * 100;
    if (over3Pct >= 60)
        signals.push({ type: 'over3', label: 'Over 3', confidence: Math.round(over3Pct * 10) / 10, direction: 'up',
            detail: `${overCount(3)}/${total} ticks > 3`, entry: makeEntry(d => d > 3, 'DIGITOVER', 3) });

    const under6Pct = (underCount(6) / total) * 100;
    if (under6Pct >= 60)
        signals.push({ type: 'under6', label: 'Under 6', confidence: Math.round(under6Pct * 10) / 10, direction: 'down',
            detail: `${underCount(6)}/${total} ticks < 6`, entry: makeEntry(d => d < 6, 'DIGITUNDER', 6) });

    const evenCnt = digits.filter(d => d % 2 === 0).length;
    const evenPct = (evenCnt / total) * 100;
    const oddPct = 100 - evenPct;
    if (evenPct >= 56)
        signals.push({ type: 'even', label: 'Even', confidence: Math.round(evenPct * 10) / 10, direction: 'up',
            detail: `${evenCnt}/${total} even`, entry: makeEntry(d => d % 2 === 0, 'DIGITEVEN') });
    if (oddPct >= 56)
        signals.push({ type: 'odd', label: 'Odd', confidence: Math.round(oddPct * 10) / 10, direction: 'up',
            detail: `${total - evenCnt}/${total} odd`, entry: makeEntry(d => d % 2 !== 0, 'DIGITODD') });

    if (prices.length >= 20) {
        let rises = 0, falls = 0;
        for (let i = 1; i < prices.length; i++) {
            if (prices[i] > prices[i - 1]) rises++;
            else if (prices[i] < prices[i - 1]) falls++;
        }
        const moves = prices.length - 1;
        const risePct = (rises / moves) * 100;
        const fallPct = (falls / moves) * 100;
        const priceDirections = prices.map((p, i) => i > 0 ? (p > prices[i - 1] ? 1 : p < prices[i - 1] ? -1 : 0) : 0).slice(1);

        if (risePct >= 56) {
            const rS = detectStreak(priceDirections, d => d > 0);
            const trend = analyzeRecentTrend(priceDirections, d => d > 0);
            signals.push({ type: 'rise', label: 'Rise', confidence: Math.round(risePct * 10) / 10, direction: 'up',
                detail: `${rises}/${moves} rises`,
                entry: { action: 'CALL', ticks: findBestTicks(priceDirections, d => d > 0),
                    reasoning: trend === 'Strengthening' ? 'Strong upward momentum' : 'Upward trend detected',
                    streak: rS.current > 0 ? `${rS.current} rises (max ${rS.max})` : `Max: ${rS.max}`,
                    bestTime: trend === 'Strengthening' ? 'Now' : 'Good', topDigits: topDigitsAll.map(d => d.digit), digitFreqs } });
        }
        if (fallPct >= 56) {
            const fS = detectStreak(priceDirections, d => d < 0);
            const trend = analyzeRecentTrend(priceDirections, d => d < 0);
            signals.push({ type: 'fall', label: 'Fall', confidence: Math.round(fallPct * 10) / 10, direction: 'down',
                detail: `${falls}/${moves} falls`,
                entry: { action: 'PUT', ticks: findBestTicks(priceDirections, d => d < 0),
                    reasoning: trend === 'Strengthening' ? 'Strong downward momentum' : 'Downward trend detected',
                    streak: fS.current > 0 ? `${fS.current} falls (max ${fS.max})` : `Max: ${fS.max}`,
                    bestTime: trend === 'Strengthening' ? 'Now' : 'Good', topDigits: topDigitsAll.map(d => d.digit), digitFreqs } });
        }

        let higher = 0, lower = 0;
        const midIdx = Math.floor(prices.length / 2);
        const recentPrices = prices.slice(midIdx);
        const refPrice = prices[midIdx];
        recentPrices.forEach(p => { if (p > refPrice) higher++; else if (p < refPrice) lower++; });
        const hlTotal = recentPrices.length;
        const higherPct = (higher / hlTotal) * 100;
        const lowerPct = (lower / hlTotal) * 100;
        if (higherPct >= 56)
            signals.push({ type: 'higher', label: 'Higher', confidence: Math.round(higherPct * 10) / 10, direction: 'up',
                detail: `${higher}/${hlTotal} higher`,
                entry: { action: 'HIGHER', ticks: 5, reasoning: 'Likely higher digits',
                    streak: `${higher} above / ${lower} below`, bestTime: prices[prices.length - 1] > refPrice ? 'Now' : 'Wait',
                    topDigits: topDigitsAll.map(d => d.digit), digitFreqs } });
        if (lowerPct >= 56)
            signals.push({ type: 'lower', label: 'Lower', confidence: Math.round(lowerPct * 10) / 10, direction: 'down',
                detail: `${lower}/${hlTotal} lower`,
                entry: { action: 'LOWER', ticks: 5, reasoning: 'Likely lower digits',
                    streak: `${lower} below / ${higher} above`, bestTime: prices[prices.length - 1] < refPrice ? 'Now' : 'Wait',
                    topDigits: topDigitsAll.map(d => d.digit), digitFreqs } });
    }

    const recentWindow = digits.slice(-50);
    const recentCounts = new Array(10).fill(0);
    recentWindow.forEach(d => recentCounts[d]++);

    const matchDigits: { digit: number; pct: number; recentPct: number }[] = [];
    const differDigits: { digit: number; pct: number; recentPct: number }[] = [];
    for (let d = 0; d < 10; d++) {
        const freq = (counts[d] / total) * 100;
        const recentFreq = recentWindow.length > 0 ? (recentCounts[d] / recentWindow.length) * 100 : 0;
        const avgFreq = (freq + recentFreq) / 2;
        if (avgFreq >= 12) matchDigits.push({ digit: d, pct: Math.round(avgFreq), recentPct: Math.round(recentFreq) });
        if (avgFreq <= 7) differDigits.push({ digit: d, pct: Math.round(100 - avgFreq), recentPct: Math.round(recentFreq) });
    }

    matchDigits.sort((a, b) => b.pct - a.pct);
    matchDigits.slice(0, 2).forEach(m => {
        const streak = detectStreak(digits, d => d === m.digit);
        const trend = analyzeRecentTrend(digits, d => d === m.digit);
        const matchFreqs = [
            { digit: m.digit, pct: m.pct },
            ...digitFreqs.filter(df => df.digit !== m.digit).sort((a, b) => b.pct - a.pct).slice(0, 2),
        ];
        signals.push({ type: 'matches', label: `Match ${m.digit}`, confidence: Math.round(m.pct * 10) / 10, direction: 'up',
            detail: `Digit ${m.digit}: ${m.pct}% avg`,
            entry: { action: 'DIGITMATCH', prediction: m.digit, ticks: findBestTicks(digits, d => d === m.digit),
                reasoning: trend === 'Strengthening' ? 'Digit rising' : trend === 'Stable' ? 'Digit consistent' : 'weak pattern detected',
                streak: streak.current > 0 ? `${streak.current} matches (max ${streak.max})` : `Max: ${streak.max}`,
                bestTime: trend === 'Strengthening' ? 'Now' : 'Good',
                topDigits: [m.digit], digitFreqs: matchFreqs } });
    });

    differDigits.sort((a, b) => b.pct - a.pct);
    differDigits.slice(0, 2).forEach(d => {
        const streak = detectStreak(digits, x => x !== d.digit);
        const trend = analyzeRecentTrend(digits, x => x !== d.digit);
        const diffFreqs = [
            { digit: d.digit, pct: 100 - d.pct },
            ...digitFreqs.filter(df => df.digit !== d.digit).sort((a, b) => a.pct - b.pct).slice(0, 2),
        ];
        signals.push({ type: 'differs', label: `Differ ${d.digit}`, confidence: Math.round(d.pct * 10) / 10, direction: 'down',
            detail: `Digit ${d.digit}: only ${100 - d.pct}%`,
            entry: { action: 'DIGITDIFF', prediction: d.digit, ticks: findBestTicks(digits, x => x !== d.digit),
                reasoning: trend === 'Strengthening' ? 'Digit becoming rarer' : trend === 'Stable' ? 'Consistently rare' : 'weak pattern detected',
                streak: streak.current > 0 ? `${streak.current} differs (max ${streak.max})` : `Max: ${streak.max}`,
                bestTime: trend === 'Strengthening' ? 'Now' : 'Good',
                topDigits: [d.digit], digitFreqs: diffFreqs } });
    });

    return signals;
}

const SmartTrader = observer(() => {
    useStore();
    const apiRef = useRef<any>(null);
    const tickStreamsRef = useRef<Map<string, string>>(new Map());
    const mainListenerRef = useRef<((evt: MessageEvent) => void) | null>(null);
    const tickDataRef = useRef<Map<string, { digits: number[]; prices: number[] }>>(new Map());
    const symbolMapRef = useRef<Map<string, string>>(new Map());
    const tickCountRef = useRef(0);
    const dirtySymbolsRef = useRef<Set<string>>(new Set());
    const updateTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const [symbols, setSymbols] = useState<SymbolInfo[]>([]);
    const [symbolSignals, setSymbolSignals] = useState<Map<string, SymbolSignals>>(new Map());
    const [isConnected, setIsConnected] = useState(false);
    const [lastUpdate, setLastUpdate] = useState('');

    const updateSignalsForSymbol = useCallback((sym: string, displayName: string) => {
        const data = tickDataRef.current.get(sym);
        if (!data || data.digits.length < 10) return;
        const sigs = analyzeSignals(data.digits, data.prices);
        const lastPrice = data.prices.length > 0 ? String(data.prices[data.prices.length - 1]) : '---';
        const lastDigit = data.digits.length > 0 ? data.digits[data.digits.length - 1] : null;
        setSymbolSignals(prev => {
            const next = new Map(prev);
            next.set(sym, { symbol: sym, display_name: displayName, signals: sigs, lastPrice, lastDigit, tickCount: data.digits.length });
            return next;
        });
    }, []);

    const flushDirtySymbols = useCallback(() => {
        const dirty = dirtySymbolsRef.current;
        if (dirty.size === 0) return;
        const toUpdate = new Set(dirty);
        dirty.clear();
        const now = new Date();
        setLastUpdate(now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }));
        toUpdate.forEach(sym => {
            const displayName = symbolMapRef.current.get(sym);
            if (displayName) updateSignalsForSymbol(sym, displayName);
        });
    }, [updateSignalsForSymbol]);

    useEffect(() => {
        const api = generateDerivApiInstance();
        apiRef.current = api;
        updateTimerRef.current = setInterval(() => flushDirtySymbols(), 500);

        const init = async () => {
            try {
                const syn = ALLOWED_SYMBOLS;
                setSymbols(syn);
                setIsConnected(true);
                syn.forEach((s) => symbolMapRef.current.set(s.symbol, s.display_name));

                for (const s of syn) {
                    tickDataRef.current.set(s.symbol, { digits: [], prices: [] });
                    try {
                        const histRes = await api.send({ ticks_history: s.symbol, count: TICK_HISTORY_SIZE, end: 'latest', style: 'ticks' });
                        if (histRes?.history?.prices) {
                            const histPrices = histRes.history.prices.map(Number);
                            const histDigits = histPrices.map((p: number) => Number(String(p).slice(-1)));
                            tickDataRef.current.set(s.symbol, { digits: histDigits, prices: histPrices });
                            updateSignalsForSymbol(s.symbol, s.display_name);
                        }
                    } catch (e) { console.warn('History fetch failed', s.symbol, e); }
                    try {
                        const { subscription, error: tickErr } = await api.send({ ticks: s.symbol, subscribe: 1 });
                        if (!tickErr && subscription?.id) tickStreamsRef.current.set(s.symbol, subscription.id);
                    } catch (e) { console.warn('Subscribe failed', s.symbol, e); }
                }

                const onMsg = (evt: MessageEvent) => {
                    try {
                        const d = JSON.parse(evt.data);
                        if (d?.msg_type === 'tick' && d?.tick?.symbol) {
                            const sym = d.tick.symbol;
                            const data = tickDataRef.current.get(sym);
                            if (!data) return;
                            const price = Number(d.tick.quote);
                            const digit = Number(String(d.tick.quote).slice(-1));
                            data.digits = [...data.digits.slice(-(TICK_HISTORY_SIZE - 1)), digit];
                            data.prices = [...data.prices.slice(-(TICK_HISTORY_SIZE - 1)), price];
                            tickCountRef.current++;
                            if (data.digits.length % 5 === 0) dirtySymbolsRef.current.add(sym);
                        }
                    } catch (e) { console.warn('Parse error', e); }
                };
                mainListenerRef.current = onMsg;
                api?.connection?.addEventListener('message', onMsg);
            } catch (e: any) { console.error('Scanner init error', e); }
        };
        init();

        return () => {
            if (updateTimerRef.current) clearInterval(updateTimerRef.current);
            if (mainListenerRef.current) api?.connection?.removeEventListener('message', mainListenerRef.current);
            tickStreamsRef.current.forEach(id => { try { api?.forget?.({ forget: id }); } catch (e) {} });
            tickStreamsRef.current.clear();
            api?.disconnect?.();
        };
    }, []);

    const allSignals: (Signal & { symbol: string; display_name: string })[] = useMemo(() => {
        const sigs: (Signal & { symbol: string; display_name: string })[] = [];
        symbolSignals.forEach(ss => {
            ss.signals.forEach(sig => sigs.push({ ...sig, symbol: ss.symbol, display_name: ss.display_name }));
        });
        return sigs;
    }, [symbolSignals]);

    const getBest2 = useCallback((typeId: string) => {
        const catSigs = allSignals.filter(s => s.type === typeId).sort((a, b) => b.confidence - a.confidence);
        const seen = new Set<string>();
        const best: typeof catSigs = [];
        for (const sig of catSigs) {
            if (!seen.has(sig.symbol)) {
                seen.add(sig.symbol);
                best.push(sig);
                if (best.length >= 2) break;
            }
        }
        return best;
    }, [allSignals]);

    const getConfClass = (c: number) => {
        if (c >= 80) return 'excellent';
        if (c >= 65) return 'strong';
        if (c >= 55) return 'good';
        return 'moderate';
    };

    const shortenName = (name: string) => {
        return name
            .replace('Volatility ', 'Vol ')
            .replace(' Index', '')
            .replace('(1s)', '(1s)');
    };

    return (
        <div className='qms'>
            <div className='qms-header'>
                <div className='qms-header__left'>
                    <div className='qms-header__icon' />
                    <div>
                        <h1 className='qms-header__title'>QUANTUM MARKET SCANNER</h1>
                        <p className='qms-header__sub'>Real-time Analysis Across 13 Volatility Indices</p>
                    </div>
                </div>
                <div className='qms-header__right'>
                    {isConnected && (
                        <>
                            <span className='qms-header__live'>LIVE</span>
                            <span className='qms-header__time'>Updated: {lastUpdate || '...'}</span>
                        </>
                    )}
                    {!isConnected && <span className='qms-header__time'>Connecting...</span>}
                </div>
            </div>

            <div className='qms-grid'>
                {SIGNAL_TYPES.map(st => {
                    const best = getBest2(st.id);
                    const hasSignals = best.length > 0;
                    return (
                        <div key={st.id} className={`qms-card ${hasSignals ? 'active' : 'empty'}`}
                            style={{ '--card-color': st.color } as React.CSSProperties}>
                            <div className='qms-card__head'>
                                <span className='qms-card__title'>{st.label}</span>
                                <span className='qms-card__threshold'>{st.threshold}</span>
                            </div>
                            {!hasSignals && (
                                <div className='qms-card__empty'>
                                    No signals {st.threshold}
                                </div>
                            )}
                            {best.map((sig, idx) => (
                                <div key={`${sig.symbol}-${idx}`} className='qms-market'>
                                    <div className='qms-market__head'>
                                        <span className='qms-market__rank'>#{idx + 1}</span>
                                        <span className='qms-market__name'>{shortenName(sig.display_name)}</span>
                                        <span className={`qms-market__badge ${getConfClass(sig.confidence)}`}>
                                            {Math.round(sig.confidence)}%
                                        </span>
                                    </div>
                                    <div className='qms-market__conf'>
                                        <span className='qms-market__pct'>{sig.confidence.toFixed(1)}%</span>
                                        <span className={`qms-market__dir ${sig.direction}`}>
                                            {sig.direction === 'up' ? '\u2192' : sig.direction === 'down' ? '\u2192' : '\u2192'}
                                        </span>
                                    </div>
                                    <div className='qms-market__entry'>
                                        <span className='qms-market__entry-label'>ENTRY:</span>
                                        {sig.entry.topDigits.slice(0, 3).map((d, i) => (
                                            <span key={i} className={`qms-digit qms-digit--${i}`}>{d}</span>
                                        ))}
                                    </div>
                                    <div className='qms-market__meta'>
                                        <span className='qms-market__reason'>{sig.entry.reasoning}</span>
                                        <span className='qms-market__ticks'>Next {sig.entry.ticks} ticks</span>
                                    </div>
                                    {(st.id === 'matches' || st.id === 'differs') && sig.entry.digitFreqs.length > 0 && (
                                        <div className='qms-market__freqs'>
                                            {sig.entry.digitFreqs.slice(0, 3).map((df, i) => (
                                                <span key={i} className='qms-market__freq'>
                                                    {df.digit}: {df.pct}%
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    );
                })}
            </div>
        </div>
    );
});

export default SmartTrader;
