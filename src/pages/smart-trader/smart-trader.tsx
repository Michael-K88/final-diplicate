import React, { useEffect, useRef, useState, useCallback } from 'react';
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

const SIGNAL_CATEGORIES = [
    { id: 'overunder', label: 'Over / Under', icon: '⬆⬇' },
    { id: 'evenodd', label: 'Even / Odd', icon: '⚡' },
    { id: 'risefall', label: 'Rise / Fall', icon: '📈' },
    { id: 'higherlower', label: 'Higher / Lower', icon: '🔺🔻' },
    { id: 'matches', label: 'Matches', icon: '🎯' },
    { id: 'differs', label: 'Differs', icon: '↔' },
];

function detectStreak(digits: number[], testFn: (d: number) => boolean): { current: number; max: number } {
    let current = 0;
    let max = 0;
    for (let i = digits.length - 1; i >= 0; i--) {
        if (testFn(digits[i])) {
            current++;
        } else break;
    }
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
            const lastD = chunk[chunk.length - 1];
            if (testFn(lastD)) wins++;
            rounds++;
        }
        const rate = rounds > 0 ? wins / rounds : 0;
        if (rate > bestRate) { bestRate = rate; bestTicks = t; }
    }
    return bestTicks;
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

    const overCount = (threshold: number) => digits.filter(d => d > threshold).length;
    const underCount = (threshold: number) => digits.filter(d => d < threshold).length;

    const makeEntry = (testFn: (d: number) => boolean, action: string, prediction?: number): EntryPoint => {
        const streak = detectStreak(digits, testFn);
        const bestTicks = findBestTicks(digits, testFn);
        const trend = analyzeRecentTrend(digits, testFn);
        return {
            action,
            prediction,
            ticks: bestTicks,
            reasoning: `${trend} trend. Best win rate at ${bestTicks} ticks.`,
            streak: streak.current > 0 ? `${streak.current} in a row (max ${streak.max})` : `Max streak: ${streak.max}`,
            bestTime: trend === 'Strengthening' ? 'Now - strong momentum' : trend === 'Stable' ? 'Good - consistent pattern' : 'Wait - pattern weakening',
        };
    };

    const over2Pct = (overCount(2) / total) * 100;
    if (over2Pct >= 75) {
        signals.push({ type: 'overunder', label: 'Over 2', confidence: Math.round(over2Pct), direction: 'up',
            detail: `${overCount(2)}/${total} ticks > 2`,
            entry: makeEntry(d => d > 2, 'DIGITOVER', 2) });
    }

    const under7Pct = (underCount(7) / total) * 100;
    if (under7Pct >= 75) {
        signals.push({ type: 'overunder', label: 'Under 7', confidence: Math.round(under7Pct), direction: 'down',
            detail: `${underCount(7)}/${total} ticks < 7`,
            entry: makeEntry(d => d < 7, 'DIGITUNDER', 7) });
    }

    const over3Pct = (overCount(3) / total) * 100;
    if (over3Pct >= 65) {
        signals.push({ type: 'overunder', label: 'Over 3', confidence: Math.round(over3Pct), direction: 'up',
            detail: `${overCount(3)}/${total} ticks > 3`,
            entry: makeEntry(d => d > 3, 'DIGITOVER', 3) });
    }

    const under6Pct = (underCount(6) / total) * 100;
    if (under6Pct >= 65) {
        signals.push({ type: 'overunder', label: 'Under 6', confidence: Math.round(under6Pct), direction: 'down',
            detail: `${underCount(6)}/${total} ticks < 6`,
            entry: makeEntry(d => d < 6, 'DIGITUNDER', 6) });
    }

    const evenCnt = digits.filter(d => d % 2 === 0).length;
    const evenPct = (evenCnt / total) * 100;
    const oddPct = 100 - evenPct;
    if (evenPct >= 57) {
        signals.push({ type: 'evenodd', label: 'Even', confidence: Math.round(evenPct), direction: 'up',
            detail: `${evenCnt}/${total} even digits`,
            entry: makeEntry(d => d % 2 === 0, 'DIGITEVEN') });
    }
    if (oddPct >= 57) {
        signals.push({ type: 'evenodd', label: 'Odd', confidence: Math.round(oddPct), direction: 'up',
            detail: `${total - evenCnt}/${total} odd digits`,
            entry: makeEntry(d => d % 2 !== 0, 'DIGITODD') });
    }

    if (prices.length >= 20) {
        let rises = 0;
        let falls = 0;
        for (let i = 1; i < prices.length; i++) {
            if (prices[i] > prices[i - 1]) rises++;
            else if (prices[i] < prices[i - 1]) falls++;
        }
        const moves = prices.length - 1;
        const risePct = (rises / moves) * 100;
        const fallPct = (falls / moves) * 100;

        const priceDirections = prices.map((p, i) => i > 0 ? (p > prices[i - 1] ? 1 : p < prices[i - 1] ? -1 : 0) : 0).slice(1);

        if (risePct >= 57) {
            const riseStreak = detectStreak(priceDirections, d => d > 0);
            const trend = analyzeRecentTrend(priceDirections, d => d > 0);
            signals.push({ type: 'risefall', label: 'Rise', confidence: Math.round(risePct), direction: 'up',
                detail: `${rises}/${moves} price rises`,
                entry: { action: 'CALL', ticks: findBestTicks(priceDirections, d => d > 0),
                    reasoning: `${trend} trend. ${rises} rises in ${moves} moves.`,
                    streak: riseStreak.current > 0 ? `${riseStreak.current} consecutive rises (max ${riseStreak.max})` : `Max streak: ${riseStreak.max}`,
                    bestTime: trend === 'Strengthening' ? 'Now - strong upward momentum' : trend === 'Stable' ? 'Good - steady uptrend' : 'Caution - momentum fading' } });
        }
        if (fallPct >= 57) {
            const fallStreak = detectStreak(priceDirections, d => d < 0);
            const trend = analyzeRecentTrend(priceDirections, d => d < 0);
            signals.push({ type: 'risefall', label: 'Fall', confidence: Math.round(fallPct), direction: 'down',
                detail: `${falls}/${moves} price falls`,
                entry: { action: 'PUT', ticks: findBestTicks(priceDirections, d => d < 0),
                    reasoning: `${trend} trend. ${falls} falls in ${moves} moves.`,
                    streak: fallStreak.current > 0 ? `${fallStreak.current} consecutive falls (max ${fallStreak.max})` : `Max streak: ${fallStreak.max}`,
                    bestTime: trend === 'Strengthening' ? 'Now - strong downward momentum' : trend === 'Stable' ? 'Good - steady downtrend' : 'Caution - momentum fading' } });
        }

        let higher = 0;
        let lower = 0;
        const midIdx = Math.floor(prices.length / 2);
        const recentPrices = prices.slice(midIdx);
        const refPrice = prices[midIdx];
        recentPrices.forEach(p => { if (p > refPrice) higher++; else if (p < refPrice) lower++; });
        const hlTotal = recentPrices.length;
        const higherPct = (higher / hlTotal) * 100;
        const lowerPct = (lower / hlTotal) * 100;
        if (higherPct >= 57) {
            signals.push({ type: 'higherlower', label: 'Higher', confidence: Math.round(higherPct), direction: 'up',
                detail: `${higher}/${hlTotal} prices higher than mid-session`,
                entry: { action: 'HIGHER', ticks: 5, reasoning: `Price trending above mid-point (${refPrice.toFixed(2)}). ${higher} of ${hlTotal} recent ticks are higher.`,
                    streak: `${higher} above / ${lower} below mid`, bestTime: prices[prices.length - 1] > refPrice ? 'Now - currently above mid' : 'Wait for price to cross above' } });
        }
        if (lowerPct >= 57) {
            signals.push({ type: 'higherlower', label: 'Lower', confidence: Math.round(lowerPct), direction: 'down',
                detail: `${lower}/${hlTotal} prices lower than mid-session`,
                entry: { action: 'LOWER', ticks: 5, reasoning: `Price trending below mid-point (${refPrice.toFixed(2)}). ${lower} of ${hlTotal} recent ticks are lower.`,
                    streak: `${lower} below / ${higher} above mid`, bestTime: prices[prices.length - 1] < refPrice ? 'Now - currently below mid' : 'Wait for price to cross below' } });
        }
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
        signals.push({ type: 'matches', label: `Match ${m.digit}`, confidence: Math.min(95, Math.round(m.pct * 3.5)), direction: 'up',
            detail: `Digit ${m.digit}: ${m.pct}% overall, ${m.recentPct}% recent`,
            entry: { action: 'DIGITMATCH', prediction: m.digit, ticks: findBestTicks(digits, d => d === m.digit),
                reasoning: `${trend}. Digit ${m.digit} appears ${m.pct}% (expected 10%). Recent: ${m.recentPct}%.`,
                streak: streak.current > 0 ? `Last ${streak.current} ticks matched (max ${streak.max})` : `Max match streak: ${streak.max}`,
                bestTime: trend === 'Strengthening' ? 'Now - digit frequency increasing' : trend === 'Stable' ? 'Good - consistent appearance' : 'Wait - frequency declining' } });
    });

    differDigits.sort((a, b) => b.pct - a.pct);
    differDigits.slice(0, 2).forEach(d => {
        const streak = detectStreak(digits, x => x !== d.digit);
        const trend = analyzeRecentTrend(digits, x => x !== d.digit);
        signals.push({ type: 'differs', label: `Differ ${d.digit}`, confidence: Math.min(95, Math.round(d.pct * 1.1)), direction: 'down',
            detail: `Digit ${d.digit}: appears only ${100 - d.pct}% of ticks`,
            entry: { action: 'DIGITDIFF', prediction: d.digit, ticks: findBestTicks(digits, x => x !== d.digit),
                reasoning: `${trend}. Digit ${d.digit} rarely appears (${100 - d.pct}%). Recent: ${d.recentPct}%.`,
                streak: streak.current > 0 ? `Last ${streak.current} ticks differed (max ${streak.max})` : `Max differ streak: ${streak.max}`,
                bestTime: trend === 'Strengthening' ? 'Now - digit becoming rarer' : trend === 'Stable' ? 'Good - consistently rare' : 'Caution - digit appearing more often' } });
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
    const [activeCategory, setActiveCategory] = useState('overunder');
    const [isConnected, setIsConnected] = useState(false);
    const [totalTicks, setTotalTicks] = useState(0);
    const [expandedCard, setExpandedCard] = useState<string | null>(null);

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
        setTotalTicks(tickCountRef.current);
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
                const { active_symbols, error } = await api.send({ active_symbols: 'brief' });
                if (error) throw error;
                const syn = (active_symbols || [])
                    .filter((s: any) => /synthetic/i.test(s.market) || /^R_/.test(s.symbol))
                    .map((s: any) => ({ symbol: s.symbol, display_name: s.display_name }));
                setSymbols(syn);
                setIsConnected(true);

                syn.forEach((s: SymbolInfo) => symbolMapRef.current.set(s.symbol, s.display_name));

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
                    } catch (histErr) { console.warn('History fetch failed for', s.symbol, histErr); }

                    try {
                        const { subscription, error: tickErr } = await api.send({ ticks: s.symbol, subscribe: 1 });
                        if (!tickErr && subscription?.id) tickStreamsRef.current.set(s.symbol, subscription.id);
                    } catch (subErr) { console.warn('Tick subscribe failed for', s.symbol, subErr); }
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
                    } catch (parseErr) { console.warn('Tick parse error', parseErr); }
                };
                mainListenerRef.current = onMsg;
                api?.connection?.addEventListener('message', onMsg);
            } catch (e: any) { console.error('Scanner init error', e); }
        };
        init();

        return () => {
            if (updateTimerRef.current) clearInterval(updateTimerRef.current);
            if (mainListenerRef.current) api?.connection?.removeEventListener('message', mainListenerRef.current);
            tickStreamsRef.current.forEach((id) => { try { api?.forget?.({ forget: id }); } catch (e) { console.warn('forget error', e); } });
            tickStreamsRef.current.clear();
            api?.disconnect?.();
        };
    }, []);

    const allSignals: (Signal & { symbol: string; display_name: string })[] = [];
    symbolSignals.forEach((ss) => {
        ss.signals.forEach(sig => allSignals.push({ ...sig, symbol: ss.symbol, display_name: ss.display_name }));
    });

    const getBest2Markets = (categoryId: string) => {
        const catSignals = allSignals.filter(s => s.type === categoryId).sort((a, b) => b.confidence - a.confidence);
        const seen = new Set<string>();
        const best: typeof catSignals = [];
        for (const sig of catSignals) {
            if (!seen.has(sig.symbol)) {
                seen.add(sig.symbol);
                best.push(sig);
                if (best.length >= 2) break;
            }
        }
        return best;
    };

    const filteredSignals = allSignals.filter(s => s.type === activeCategory).sort((a, b) => b.confidence - a.confidence);
    const top2Markets = getBest2Markets(activeCategory);

    const categoryCounts = new Map<string, number>();
    SIGNAL_CATEGORIES.forEach(cat => categoryCounts.set(cat.id, allSignals.filter(s => s.type === cat.id).length));

    const getConfidenceColor = (confidence: number) => {
        if (confidence >= 80) return 'excellent';
        if (confidence >= 70) return 'strong';
        if (confidence >= 60) return 'good';
        return 'moderate';
    };

    const toggleCard = (key: string) => setExpandedCard(prev => prev === key ? null : key);

    return (
        <div className='quantum-scanner'>
            <div className='qs-header'>
                <div className='qs-header__left'>
                    <div className='qs-header__icon'>🔬</div>
                    <div>
                        <h1 className='qs-header__title'>Quantum Market Scanner</h1>
                        <p className='qs-header__subtitle'>Real-time signal analysis across all synthetic markets</p>
                    </div>
                </div>
                <div className='qs-header__right'>
                    <div className='qs-header__stat'>
                        <span className='qs-header__stat-value'>{symbols.length}</span>
                        <span className='qs-header__stat-label'>Markets</span>
                    </div>
                    <div className='qs-header__stat'>
                        <span className='qs-header__stat-value'>{allSignals.length}</span>
                        <span className='qs-header__stat-label'>Signals</span>
                    </div>
                    <div className='qs-header__stat'>
                        <span className='qs-header__stat-value'>{totalTicks}</span>
                        <span className='qs-header__stat-label'>Ticks</span>
                    </div>
                    <div className={`qs-header__status ${isConnected ? 'live' : ''}`}>
                        <span className='qs-header__dot' />
                        {isConnected ? 'Scanning' : 'Connecting'}
                    </div>
                </div>
            </div>

            <div className='qs-nav'>
                {SIGNAL_CATEGORIES.map(cat => (
                    <button key={cat.id} className={`qs-nav__item ${activeCategory === cat.id ? 'active' : ''}`}
                        onClick={() => setActiveCategory(cat.id)}>
                        <span className='qs-nav__icon'>{cat.icon}</span>
                        <span className='qs-nav__label'>{cat.label}</span>
                        <span className='qs-nav__badge'>{categoryCounts.get(cat.id) || 0}</span>
                    </button>
                ))}
            </div>

            <div className='qs-body'>
                <div className='qs-signals'>
                    {top2Markets.length > 0 && (
                        <div className='qs-best-markets'>
                            <div className='qs-best-markets__title'>
                                Best 2 Markets for {SIGNAL_CATEGORIES.find(c => c.id === activeCategory)?.label}
                            </div>
                            <div className='qs-best-markets__cards'>
                                {top2Markets.map((sig, idx) => (
                                    <div key={`best-${idx}`} className={`qs-best-card ${getConfidenceColor(sig.confidence)}`}>
                                        <div className='qs-best-card__rank'>#{idx + 1}</div>
                                        <div className='qs-best-card__info'>
                                            <div className='qs-best-card__market'>{sig.display_name}</div>
                                            <div className='qs-best-card__signal'>
                                                <span className={`qs-best-card__arrow ${sig.direction}`}>
                                                    {sig.direction === 'up' ? '▲' : '▼'}
                                                </span>
                                                {sig.label} — {sig.confidence}%
                                            </div>
                                        </div>
                                        <div className='qs-best-card__entry'>
                                            <div className='qs-best-card__entry-title'>Entry Point</div>
                                            <div className='qs-best-card__entry-row'>
                                                <span className='qs-best-card__entry-label'>Action:</span>
                                                <span className='qs-best-card__entry-value'>{sig.entry.action}{sig.entry.prediction !== undefined ? ` (${sig.entry.prediction})` : ''}</span>
                                            </div>
                                            <div className='qs-best-card__entry-row'>
                                                <span className='qs-best-card__entry-label'>Ticks:</span>
                                                <span className='qs-best-card__entry-value'>{sig.entry.ticks}</span>
                                            </div>
                                            <div className='qs-best-card__entry-row'>
                                                <span className='qs-best-card__entry-label'>Timing:</span>
                                                <span className='qs-best-card__entry-value timing'>{sig.entry.bestTime}</span>
                                            </div>
                                            <div className='qs-best-card__entry-row'>
                                                <span className='qs-best-card__entry-label'>Streak:</span>
                                                <span className='qs-best-card__entry-value'>{sig.entry.streak}</span>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className='qs-signals__header'>
                        <h2 className='qs-signals__title'>
                            {SIGNAL_CATEGORIES.find(c => c.id === activeCategory)?.icon}{' '}
                            All {SIGNAL_CATEGORIES.find(c => c.id === activeCategory)?.label} Signals
                        </h2>
                        <span className='qs-signals__count'>{filteredSignals.length} found</span>
                    </div>

                    {filteredSignals.length === 0 && (
                        <div className='qs-empty'>
                            <div className='qs-empty__icon'>📡</div>
                            <div className='qs-empty__text'>
                                {isConnected ? 'No signals meet the confidence threshold yet. Scanner is analyzing...' : 'Connecting to markets...'}
                            </div>
                            {isConnected && <div className='qs-empty__hint'>Signals appear when confidence levels reach the required thresholds</div>}
                        </div>
                    )}

                    <div className='qs-signal-list'>
                        {filteredSignals.map((sig) => {
                            const cardKey = `${sig.symbol}-${sig.label}`;
                            const isExpanded = expandedCard === cardKey;
                            return (
                                <div key={cardKey} className={`qs-signal-card ${getConfidenceColor(sig.confidence)} ${isExpanded ? 'expanded' : ''}`}
                                    onClick={() => toggleCard(cardKey)}>
                                    <div className='qs-signal-card__top'>
                                        <div className='qs-signal-card__market'>{sig.display_name}</div>
                                        <div className={`qs-signal-card__badge ${getConfidenceColor(sig.confidence)}`}>{sig.confidence}%</div>
                                    </div>
                                    <div className='qs-signal-card__signal'>
                                        <span className={`qs-signal-card__arrow ${sig.direction}`}>
                                            {sig.direction === 'up' ? '▲' : sig.direction === 'down' ? '▼' : '●'}
                                        </span>
                                        <span className='qs-signal-card__label'>{sig.label}</span>
                                    </div>
                                    <div className='qs-signal-card__detail'>{sig.detail}</div>
                                    <div className='qs-signal-card__bar'>
                                        <div className={`qs-signal-card__bar-fill ${getConfidenceColor(sig.confidence)}`} style={{ width: `${sig.confidence}%` }} />
                                    </div>
                                    {isExpanded && (
                                        <div className='qs-signal-card__entry'>
                                            <div className='qs-signal-card__entry-title'>📍 Entry Point Analysis</div>
                                            <div className='qs-signal-card__entry-grid'>
                                                <div className='qs-entry-item'>
                                                    <span className='qs-entry-item__label'>Contract</span>
                                                    <span className='qs-entry-item__value'>{sig.entry.action}{sig.entry.prediction !== undefined ? ` (${sig.entry.prediction})` : ''}</span>
                                                </div>
                                                <div className='qs-entry-item'>
                                                    <span className='qs-entry-item__label'>Duration</span>
                                                    <span className='qs-entry-item__value'>{sig.entry.ticks} ticks</span>
                                                </div>
                                                <div className='qs-entry-item'>
                                                    <span className='qs-entry-item__label'>Streak</span>
                                                    <span className='qs-entry-item__value'>{sig.entry.streak}</span>
                                                </div>
                                                <div className='qs-entry-item'>
                                                    <span className='qs-entry-item__label'>Timing</span>
                                                    <span className='qs-entry-item__value timing'>{sig.entry.bestTime}</span>
                                                </div>
                                            </div>
                                            <div className='qs-signal-card__entry-reasoning'>{sig.entry.reasoning}</div>
                                        </div>
                                    )}
                                    {!isExpanded && <div className='qs-signal-card__expand-hint'>Tap for entry point</div>}
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div className='qs-overview'>
                    <h3 className='qs-overview__title'>Best 2 Markets Per Strategy</h3>
                    {SIGNAL_CATEGORIES.map(cat => {
                        const best = getBest2Markets(cat.id);
                        if (best.length === 0) return null;
                        return (
                            <div key={cat.id} className='qs-overview__group'>
                                <div className='qs-overview__group-header'>
                                    <span>{cat.icon} {cat.label}</span>
                                </div>
                                {best.map((sig, idx) => (
                                    <div key={idx} className={`qs-overview__item ${getConfidenceColor(sig.confidence)}`}>
                                        <span className='qs-overview__item-rank'>#{idx + 1}</span>
                                        <div className='qs-overview__item-body'>
                                            <span className='qs-overview__item-market'>{sig.display_name}</span>
                                            <span className='qs-overview__item-signal'>{sig.label}</span>
                                        </div>
                                        <div className='qs-overview__item-right'>
                                            <span className={`qs-overview__item-conf ${getConfidenceColor(sig.confidence)}`}>{sig.confidence}%</span>
                                            <span className='qs-overview__item-ticks'>{sig.entry.ticks}t</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        );
                    })}
                    {allSignals.length === 0 && <div className='qs-overview__empty'>Scanning markets...</div>}
                </div>
            </div>
        </div>
    );
});

export default SmartTrader;
