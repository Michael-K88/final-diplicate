import React, { useEffect, useRef, useState, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import { generateDerivApiInstance } from '@/external/bot-skeleton/services/api/appId';
import { useStore } from '@/hooks/useStore';
import './smart-trader.scss';

interface SymbolInfo {
    symbol: string;
    display_name: string;
}

interface Signal {
    type: string;
    label: string;
    confidence: number;
    direction: 'up' | 'down' | 'neutral';
    detail: string;
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

function analyzeSignals(digits: number[], prices: number[]): Signal[] {
    const signals: Signal[] = [];
    if (digits.length < 20) return signals;

    const total = digits.length;
    const counts = new Array(10).fill(0);
    digits.forEach(d => counts[d]++);

    const overCount = (threshold: number) => digits.filter(d => d > threshold).length;
    const underCount = (threshold: number) => digits.filter(d => d < threshold).length;

    const over2Pct = (overCount(2) / total) * 100;
    if (over2Pct >= 75) {
        signals.push({ type: 'overunder', label: 'Over 2', confidence: Math.round(over2Pct), direction: 'up', detail: `${overCount(2)}/${total} ticks > 2` });
    }

    const under7Pct = (underCount(7) / total) * 100;
    if (under7Pct >= 75) {
        signals.push({ type: 'overunder', label: 'Under 7', confidence: Math.round(under7Pct), direction: 'down', detail: `${underCount(7)}/${total} ticks < 7` });
    }

    const over3Pct = (overCount(3) / total) * 100;
    if (over3Pct >= 65) {
        signals.push({ type: 'overunder', label: 'Over 3', confidence: Math.round(over3Pct), direction: 'up', detail: `${overCount(3)}/${total} ticks > 3` });
    }

    const under6Pct = (underCount(6) / total) * 100;
    if (under6Pct >= 65) {
        signals.push({ type: 'overunder', label: 'Under 6', confidence: Math.round(under6Pct), direction: 'down', detail: `${underCount(6)}/${total} ticks < 6` });
    }

    const evenCount = digits.filter(d => d % 2 === 0).length;
    const evenPct = (evenCount / total) * 100;
    const oddPct = 100 - evenPct;
    if (evenPct >= 57) {
        signals.push({ type: 'evenodd', label: 'Even', confidence: Math.round(evenPct), direction: 'up', detail: `${evenCount}/${total} even digits` });
    }
    if (oddPct >= 57) {
        signals.push({ type: 'evenodd', label: 'Odd', confidence: Math.round(oddPct), direction: 'up', detail: `${total - evenCount}/${total} odd digits` });
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
        if (risePct >= 57) {
            signals.push({ type: 'risefall', label: 'Rise', confidence: Math.round(risePct), direction: 'up', detail: `${rises}/${moves} price rises` });
        }
        if (fallPct >= 57) {
            signals.push({ type: 'risefall', label: 'Fall', confidence: Math.round(fallPct), direction: 'down', detail: `${falls}/${moves} price falls` });
        }

        let higher = 0;
        let lower = 0;
        const midIdx = Math.floor(prices.length / 2);
        const recentPrices = prices.slice(midIdx);
        const refPrice = prices[midIdx];
        recentPrices.forEach(p => {
            if (p > refPrice) higher++;
            else if (p < refPrice) lower++;
        });
        const hlTotal = recentPrices.length;
        const higherPct = (higher / hlTotal) * 100;
        const lowerPct = (lower / hlTotal) * 100;
        if (higherPct >= 57) {
            signals.push({ type: 'higherlower', label: 'Higher', confidence: Math.round(higherPct), direction: 'up', detail: `${higher}/${hlTotal} prices higher than mid` });
        }
        if (lowerPct >= 57) {
            signals.push({ type: 'higherlower', label: 'Lower', confidence: Math.round(lowerPct), direction: 'down', detail: `${lower}/${hlTotal} prices lower than mid` });
        }
    }

    const recentWindow = digits.slice(-50);
    const recentCounts = new Array(10).fill(0);
    recentWindow.forEach(d => recentCounts[d]++);

    const matchDigits: { digit: number; pct: number }[] = [];
    const differDigits: { digit: number; pct: number }[] = [];
    for (let d = 0; d < 10; d++) {
        const freq = (counts[d] / total) * 100;
        const recentFreq = recentWindow.length > 0 ? (recentCounts[d] / recentWindow.length) * 100 : 0;
        const avgFreq = (freq + recentFreq) / 2;
        if (avgFreq >= 12) {
            matchDigits.push({ digit: d, pct: Math.round(avgFreq) });
        }
        if (avgFreq <= 7) {
            differDigits.push({ digit: d, pct: Math.round(100 - avgFreq) });
        }
    }

    matchDigits.sort((a, b) => b.pct - a.pct);
    matchDigits.slice(0, 2).forEach(m => {
        signals.push({ type: 'matches', label: `Match ${m.digit}`, confidence: Math.min(95, Math.round(m.pct * 3.5)), direction: 'up', detail: `Digit ${m.digit} appears ${m.pct}% of ticks` });
    });

    differDigits.sort((a, b) => b.pct - a.pct);
    differDigits.slice(0, 2).forEach(d => {
        signals.push({ type: 'differs', label: `Differ ${d.digit}`, confidence: Math.min(95, Math.round(d.pct * 1.1)), direction: 'down', detail: `Digit ${d.digit} appears rarely (${100 - d.pct}%)` });
    });

    return signals;
}

const SmartTrader = observer(() => {
    useStore();
    const apiRef = useRef<any>(null);
    const tickStreamsRef = useRef<Map<string, string>>(new Map());
    const listenersRef = useRef<Map<string, (evt: MessageEvent) => void>>(new Map());
    const tickDataRef = useRef<Map<string, { digits: number[]; prices: number[] }>>(new Map());

    const [symbols, setSymbols] = useState<SymbolInfo[]>([]);
    const [symbolSignals, setSymbolSignals] = useState<Map<string, SymbolSignals>>(new Map());
    const [activeCategory, setActiveCategory] = useState('overunder');
    const [isConnected, setIsConnected] = useState(false);
    const [totalTicks, setTotalTicks] = useState(0);

    const updateSignalsForSymbol = useCallback((sym: string, displayName: string) => {
        const data = tickDataRef.current.get(sym);
        if (!data || data.digits.length < 10) return;

        const signals = analyzeSignals(data.digits, data.prices);
        const lastPrice = data.prices.length > 0 ? String(data.prices[data.prices.length - 1]) : '---';
        const lastDigit = data.digits.length > 0 ? data.digits[data.digits.length - 1] : null;

        setSymbolSignals(prev => {
            const next = new Map(prev);
            next.set(sym, {
                symbol: sym,
                display_name: displayName,
                signals,
                lastPrice,
                lastDigit,
                tickCount: data.digits.length,
            });
            return next;
        });
    }, []);

    useEffect(() => {
        const api = generateDerivApiInstance();
        apiRef.current = api;

        const init = async () => {
            try {
                const { active_symbols, error } = await api.send({ active_symbols: 'brief' });
                if (error) throw error;
                const syn = (active_symbols || [])
                    .filter((s: any) => /synthetic/i.test(s.market) || /^R_/.test(s.symbol))
                    .map((s: any) => ({ symbol: s.symbol, display_name: s.display_name }));
                setSymbols(syn);
                setIsConnected(true);

                for (const s of syn) {
                    tickDataRef.current.set(s.symbol, { digits: [], prices: [] });
                    try {
                        const histRes = await api.send({
                            ticks_history: s.symbol,
                            count: TICK_HISTORY_SIZE,
                            end: 'latest',
                            style: 'ticks',
                        });
                        if (histRes?.history?.prices) {
                            const histPrices = histRes.history.prices.map(Number);
                            const histDigits = histPrices.map((p: number) => Number(String(p).slice(-1)));
                            tickDataRef.current.set(s.symbol, { digits: histDigits, prices: histPrices });
                            updateSignalsForSymbol(s.symbol, s.display_name);
                        }
                    } catch (histErr) { console.warn('History fetch failed for', s.symbol, histErr); }

                    try {
                        const { subscription, error: tickErr } = await api.send({ ticks: s.symbol, subscribe: 1 });
                        if (!tickErr && subscription?.id) {
                            tickStreamsRef.current.set(s.symbol, subscription.id);
                        }
                    } catch (subErr) { console.warn('Tick subscribe failed for', s.symbol, subErr); }

                    const onMsg = (evt: MessageEvent) => {
                        try {
                            const d = JSON.parse(evt.data);
                            if (d?.msg_type === 'tick' && d?.tick?.symbol === s.symbol) {
                                const price = Number(d.tick.quote);
                                const digit = Number(String(d.tick.quote).slice(-1));
                                const data = tickDataRef.current.get(s.symbol);
                                if (data) {
                                    data.digits = [...data.digits.slice(-(TICK_HISTORY_SIZE - 1)), digit];
                                    data.prices = [...data.prices.slice(-(TICK_HISTORY_SIZE - 1)), price];
                                    tickDataRef.current.set(s.symbol, data);
                                }
                                setTotalTicks(prev => prev + 1);
                                if (data && data.digits.length % 5 === 0) {
                                    updateSignalsForSymbol(s.symbol, s.display_name);
                                }
                            }
                        } catch (parseErr) { console.warn('Tick parse error', parseErr); }
                    };
                    listenersRef.current.set(s.symbol, onMsg);
                    api?.connection?.addEventListener('message', onMsg);
                }
            } catch (e: any) {
                console.error('Scanner init error', e);
            }
        };
        init();

        return () => {
            listenersRef.current.forEach((listener) => {
                api?.connection?.removeEventListener('message', listener);
            });
            tickStreamsRef.current.forEach((id) => {
                try { api?.forget?.({ forget: id }); } catch (e) { console.warn('forget error', e); }
            });
            listenersRef.current.clear();
            tickStreamsRef.current.clear();
            api?.disconnect?.();
        };
    }, []);

    const allSignals: (Signal & { symbol: string; display_name: string })[] = [];
    symbolSignals.forEach((ss) => {
        ss.signals.forEach(sig => {
            allSignals.push({ ...sig, symbol: ss.symbol, display_name: ss.display_name });
        });
    });

    const filteredSignals = allSignals
        .filter(s => s.type === activeCategory)
        .sort((a, b) => b.confidence - a.confidence);

    const bestByCategory = new Map<string, typeof allSignals>();
    allSignals.forEach(s => {
        if (!bestByCategory.has(s.type)) bestByCategory.set(s.type, []);
        bestByCategory.get(s.type)!.push(s);
    });
    bestByCategory.forEach((sigs, cat) => {
        sigs.sort((a, b) => b.confidence - a.confidence);
        bestByCategory.set(cat, sigs.slice(0, 4));
    });

    const categoryCounts = new Map<string, number>();
    SIGNAL_CATEGORIES.forEach(cat => {
        categoryCounts.set(cat.id, allSignals.filter(s => s.type === cat.id).length);
    });

    const getConfidenceColor = (confidence: number) => {
        if (confidence >= 80) return 'excellent';
        if (confidence >= 70) return 'strong';
        if (confidence >= 60) return 'good';
        return 'moderate';
    };

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
                    <button
                        key={cat.id}
                        className={`qs-nav__item ${activeCategory === cat.id ? 'active' : ''}`}
                        onClick={() => setActiveCategory(cat.id)}
                    >
                        <span className='qs-nav__icon'>{cat.icon}</span>
                        <span className='qs-nav__label'>{cat.label}</span>
                        <span className='qs-nav__badge'>{categoryCounts.get(cat.id) || 0}</span>
                    </button>
                ))}
            </div>

            <div className='qs-body'>
                <div className='qs-signals'>
                    <div className='qs-signals__header'>
                        <h2 className='qs-signals__title'>
                            {SIGNAL_CATEGORIES.find(c => c.id === activeCategory)?.icon}{' '}
                            {SIGNAL_CATEGORIES.find(c => c.id === activeCategory)?.label} Signals
                        </h2>
                        <span className='qs-signals__count'>{filteredSignals.length} found</span>
                    </div>

                    {filteredSignals.length === 0 && (
                        <div className='qs-empty'>
                            <div className='qs-empty__icon'>📡</div>
                            <div className='qs-empty__text'>
                                {isConnected
                                    ? 'No signals meet the confidence threshold yet. Scanner is analyzing...'
                                    : 'Connecting to markets...'}
                            </div>
                            {isConnected && (
                                <div className='qs-empty__hint'>
                                    Signals appear when confidence levels reach the required thresholds
                                </div>
                            )}
                        </div>
                    )}

                    <div className='qs-signal-list'>
                        {filteredSignals.map((sig, idx) => (
                            <div key={`${sig.symbol}-${sig.label}-${idx}`} className={`qs-signal-card ${getConfidenceColor(sig.confidence)}`}>
                                <div className='qs-signal-card__top'>
                                    <div className='qs-signal-card__market'>{sig.display_name}</div>
                                    <div className={`qs-signal-card__badge ${getConfidenceColor(sig.confidence)}`}>
                                        {sig.confidence}%
                                    </div>
                                </div>
                                <div className='qs-signal-card__signal'>
                                    <span className={`qs-signal-card__arrow ${sig.direction}`}>
                                        {sig.direction === 'up' ? '▲' : sig.direction === 'down' ? '▼' : '●'}
                                    </span>
                                    <span className='qs-signal-card__label'>{sig.label}</span>
                                </div>
                                <div className='qs-signal-card__detail'>{sig.detail}</div>
                                <div className='qs-signal-card__bar'>
                                    <div
                                        className={`qs-signal-card__bar-fill ${getConfidenceColor(sig.confidence)}`}
                                        style={{ width: `${sig.confidence}%` }}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className='qs-overview'>
                    <h3 className='qs-overview__title'>Top Signals Overview</h3>
                    {SIGNAL_CATEGORIES.map(cat => {
                        const catSignals = bestByCategory.get(cat.id) || [];
                        if (catSignals.length === 0) return null;
                        return (
                            <div key={cat.id} className='qs-overview__group'>
                                <div className='qs-overview__group-header'>
                                    <span>{cat.icon} {cat.label}</span>
                                    <span className='qs-overview__group-count'>{catSignals.length}</span>
                                </div>
                                {catSignals.slice(0, 2).map((sig, idx) => (
                                    <div key={idx} className={`qs-overview__item ${getConfidenceColor(sig.confidence)}`}>
                                        <span className='qs-overview__item-market'>{sig.display_name}</span>
                                        <span className='qs-overview__item-signal'>{sig.label}</span>
                                        <span className={`qs-overview__item-conf ${getConfidenceColor(sig.confidence)}`}>
                                            {sig.confidence}%
                                        </span>
                                    </div>
                                ))}
                            </div>
                        );
                    })}
                    {allSignals.length === 0 && (
                        <div className='qs-overview__empty'>Scanning markets...</div>
                    )}
                </div>
            </div>
        </div>
    );
});

export default SmartTrader;
