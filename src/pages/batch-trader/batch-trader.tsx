import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import { generateDerivApiInstance, V2GetActiveToken, V2GetActiveClientId } from '@/external/bot-skeleton/services/api/appId';
import { useStore } from '@/hooks/useStore';
import './batch-trader.scss';

const APP_ID = 128207;
const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

const MARKETS = [
    { label: 'Volatility 10 (1s) Index', symbol: '1HZ10V' },
    { label: 'Volatility 10 Index', symbol: 'R_10' },
    { label: 'Volatility 15 (1s) Index', symbol: '1HZ15V' },
    { label: 'Volatility 25 (1s) Index', symbol: '1HZ25V' },
    { label: 'Volatility 25 Index', symbol: 'R_25' },
    { label: 'Volatility 30 (1s) Index', symbol: '1HZ30V' },
    { label: 'Volatility 50 (1s) Index', symbol: '1HZ50V' },
    { label: 'Volatility 50 Index', symbol: 'R_50' },
    { label: 'Volatility 75 (1s) Index', symbol: '1HZ75V' },
    { label: 'Volatility 75 Index', symbol: 'R_75' },
    { label: 'Volatility 90 (1s) Index', symbol: '1HZ90V' },
    { label: 'Volatility 100 (1s) Index', symbol: '1HZ100V' },
    { label: 'Volatility 100 Index', symbol: 'R_100' },
];

const CONTRACT_GROUPS = [
    { label: 'Odd/Even', value: 'odd_even' },
    { label: 'Over/Under', value: 'over_under' },
    { label: 'Matches/Differs', value: 'matches_differs' },
    { label: 'Rise/Fall', value: 'rise_fall' },
];

const CONTRACT_MAP: Record<string, { a: string; b: string; aLabel: string; bLabel: string; aIcon: string; bIcon: string }> = {
    odd_even: { a: 'DIGITODD', b: 'DIGITEVEN', aLabel: 'Odd', bLabel: 'Even', aIcon: '⬆', bIcon: '⬇' },
    over_under: { a: 'DIGITOVER', b: 'DIGITUNDER', aLabel: 'Over', bLabel: 'Under', aIcon: '⬆', bIcon: '⬇' },
    matches_differs: { a: 'DIGITMATCH', b: 'DIGITDIFF', aLabel: 'Matches', bLabel: 'Differs', aIcon: '⬆', bIcon: '⬇' },
    rise_fall: { a: 'CALL', b: 'PUT', aLabel: 'Rise', bLabel: 'Fall', aIcon: '⬆', bIcon: '⬇' },
};

const DIGIT_BASE_COLORS = [
    '#3b82f6', '#eab308', '#8b5cf6', '#f97316', '#6b7280',
    '#06b6d4', '#14b8a6', '#3b82f6', '#ef4444', '#22c55e',
];

const RANK_COLORS = {
    most: '#22c55e',
    second: '#3b82f6',
    secondLast: '#eab308',
    least: '#ef4444',
};

const requiresBarrier = (type: string) =>
    ['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'].includes(type);

interface Trade {
    id: string;
    contractType: string;
    buyPrice: number;
    status: 'pending' | 'won' | 'lost' | 'error';
    profit: number;
    error?: string;
    time: string;
}

const NAV_ITEMS = [
    { id: 'trade', icon: '📊', label: 'Trade' },
    { id: 'stats', icon: '📈', label: 'Stats' },
    { id: 'log', icon: '📋', label: 'Log' },
    { id: 'risk', icon: '🛡️', label: 'Risk' },
];

const TYPE_LABELS: Record<string, string> = {
    DIGITODD: 'Odd', DIGITEVEN: 'Even', DIGITOVER: 'Over', DIGITUNDER: 'Under',
    DIGITMATCH: 'Matches', DIGITDIFF: 'Differs', CALL: 'Rise', PUT: 'Fall',
};

function getDigitRankColor(digitFreqs: number[], digitIndex: number): string {
    if (digitFreqs.every(f => f === 0)) return DIGIT_BASE_COLORS[digitIndex];
    const indexed = digitFreqs.map((f, i) => ({ f, i }));
    const sorted = [...indexed].sort((a, b) => b.f - a.f);
    const rank = sorted.findIndex(s => s.i === digitIndex);
    if (rank === 0) return RANK_COLORS.most;
    if (rank === 1) return RANK_COLORS.second;
    if (rank === sorted.length - 1) return RANK_COLORS.least;
    if (rank === sorted.length - 2) return RANK_COLORS.secondLast;
    return DIGIT_BASE_COLORS[digitIndex];
}

const BatchTrader: React.FC = observer(() => {
    const { transactions, run_panel } = useStore();

    const [activeNav, setActiveNav] = useState('trade');
    const [authStatus, setAuthStatus] = useState<'idle' | 'connecting' | 'ready' | 'error'>('idle');
    const [authError, setAuthError] = useState('');
    const [balance, setBalance] = useState(0);
    const [currency, setCurrency] = useState('USD');
    const [loginId, setLoginId] = useState('');

    const [market, setMarket] = useState(MARKETS[0].symbol);
    const [contractGroup, setContractGroup] = useState('over_under');
    const [duration, setDuration] = useState(1);
    const [stake, setStake] = useState(0.5);
    const [bulkCount, setBulkCount] = useState(1);
    const [prediction, setPrediction] = useState<number>(1);
    const [delayMs, setDelayMs] = useState(500);

    const [currentTick, setCurrentTick] = useState('');
    const [lastDigit, setLastDigit] = useState<number | null>(null);
    const digitHistoryRef = useRef<number[]>([]);
    const [digitFreqs, setDigitFreqs] = useState<number[]>(Array(10).fill(0));
    const [tickCount, setTickCount] = useState(0);

    const [isExecuting, setIsExecuting] = useState(false);
    const [trades, setTrades] = useState<Trade[]>([]);
    const [totalPnL, setTotalPnL] = useState(0);
    const [wins, setWins] = useState(0);
    const [losses, setLosses] = useState(0);
    const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });
    const [tradeError, setTradeError] = useState('');

    const [stopLoss, setStopLoss] = useState(0);
    const [takeProfit, setTakeProfit] = useState(0);

    const apiRef = useRef<any>(null);
    const tickWsRef = useRef<WebSocket | null>(null);
    const stopBatchRef = useRef(false);
    const pnlRef = useRef(0);
    const riskRef = useRef({ stopLoss: 0, takeProfit: 0 });
    riskRef.current = { stopLoss, takeProfit };
    const settledContractsRef = useRef<Set<string>>(new Set());
    const pipSizeRef = useRef<number>(2);
    const authorizedRef = useRef(false);
    const currencyRef = useRef('USD');

    const isReady = authStatus === 'ready';

    const updateDigitFreqs = useCallback((history: number[]) => {
        const counts = Array(10).fill(0);
        history.forEach(d => counts[d]++);
        const total = history.length || 1;
        setDigitFreqs(counts.map(c => parseFloat(((c / total) * 100).toFixed(1))));
    }, []);

    const handleTickRef = useRef<(tick: any) => void>();
    handleTickRef.current = (tick: any) => {
        const pipSize = tick.pip_size ?? pipSizeRef.current;
        pipSizeRef.current = pipSize;
        const priceStr = tick.quote.toFixed(pipSize);
        const digit = parseInt(priceStr.slice(-1));
        setCurrentTick(priceStr);
        setLastDigit(digit);
        const history = digitHistoryRef.current;
        history.push(digit);
        if (history.length > 1000) history.shift();
        setTickCount(history.length);
        updateDigitFreqs(history);
    };

    useEffect(() => {
        if (tickWsRef.current) {
            tickWsRef.current.close();
            tickWsRef.current = null;
        }

        digitHistoryRef.current = [];
        setDigitFreqs(Array(10).fill(0));
        setCurrentTick('');
        setLastDigit(null);
        setTickCount(0);

        let historyLoaded = false;

        const ws = new WebSocket(WS_URL);

        ws.onopen = () => {
            ws.send(JSON.stringify({
                ticks_history: market,
                count: 1000,
                end: 'latest',
                style: 'ticks',
            }));
        };

        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);

            if (data.msg_type === 'history' && data.history) {
                const prices = data.history.prices || [];
                const pipSize: number = data.pip_size ?? pipSizeRef.current;
                pipSizeRef.current = pipSize;
                const digits = prices.map((p: number) => parseInt(p.toFixed(pipSize).slice(-1)));
                digitHistoryRef.current = digits;
                setTickCount(digits.length);
                const counts = Array(10).fill(0);
                digits.forEach((d: number) => counts[d]++);
                const total = digits.length || 1;
                setDigitFreqs(counts.map((c: number) => parseFloat(((c / total) * 100).toFixed(1))));
                if (prices.length > 0) {
                    const lastPrice = prices[prices.length - 1].toFixed(pipSize);
                    const lastD = parseInt(lastPrice.slice(-1));
                    setCurrentTick(lastPrice);
                    setLastDigit(lastD);
                }
                historyLoaded = true;
                ws.send(JSON.stringify({ ticks: market, subscribe: 1 }));
            }

            if (data.msg_type === 'tick' && data.tick && historyLoaded) {
                handleTickRef.current?.(data.tick);
            }
        };

        ws.onerror = () => {};

        tickWsRef.current = ws;

        return () => {
            ws.close();
        };
    }, [market]);

    useEffect(() => {
        const initApi = async () => {
            const token = V2GetActiveToken();
            if (!token) {
                setAuthStatus('error');
                setAuthError('Please log in to your Deriv account to use Batch Trader.');
                return;
            }
            setAuthStatus('connecting');
            try {
                const api = generateDerivApiInstance();
                apiRef.current = api;
                const { authorize, error } = await api.authorize(token);
                if (error) throw new Error(error.message || 'Authorization failed');
                authorizedRef.current = true;
                currencyRef.current = authorize.currency || 'USD';
                setAuthStatus('ready');
                setBalance(parseFloat(authorize.balance));
                setCurrency(authorize.currency || 'USD');
                setLoginId(authorize.loginid || '');
            } catch (e: any) {
                setAuthStatus('error');
                setAuthError(e.message || 'Failed to connect. Please log in and try again.');
            }
        };
        initApi();
        return () => {
            apiRef.current?.disconnect?.();
            tickWsRef.current?.close();
        };
    }, []);

    const purchaseOne = useCallback(async (contractType: string): Promise<void> => {
        const api = apiRef.current;
        if (!api || !authorizedRef.current) throw new Error('Not connected');

        const needBarrier = requiresBarrier(contractType);
        const cur = currencyRef.current;

        const proposalReq: any = {
            proposal: 1,
            amount: stake,
            basis: 'stake',
            contract_type: contractType,
            currency: cur,
            duration,
            duration_unit: 't',
            symbol: market,
        };
        if (needBarrier) proposalReq.barrier = prediction.toString();

        const proposalRes = await api.send(proposalReq);
        if (proposalRes.error) throw new Error(proposalRes.error.message);

        const buyRes = await api.send({
            buy: proposalRes.proposal.id,
            price: proposalRes.proposal.ask_price,
        });
        if (buyRes.error) throw new Error(buyRes.error.message);

        const buy = buyRes.buy;
        const contractId = String(buy.contract_id);
        const tradeTime = new Date().toLocaleTimeString();

        const trade: Trade = {
            id: contractId,
            contractType,
            buyPrice: parseFloat(buy.buy_price),
            status: 'pending',
            profit: 0,
            time: tradeTime,
        };
        setTrades(prev => [trade, ...prev]);

        try {
            transactions.onBotContractEvent({
                contract_id: buy.contract_id,
                transaction_ids: { buy: buy.transaction_id },
                buy_price: buy.buy_price,
                currency: cur,
                contract_type: contractType as any,
                underlying: market,
                date_start: Math.floor(Date.now() / 1000),
                status: 'open',
            } as any);
        } catch (e) { /* ignore */ }

        run_panel.toggleDrawer(true);

        try {
            const pocRes = await api.send({
                proposal_open_contract: 1,
                contract_id: buy.contract_id,
                subscribe: 1,
            });
            let pocSubId: string | null = pocRes?.subscription?.id || null;

            if (pocRes?.proposal_open_contract) {
                try { transactions.onBotContractEvent(pocRes.proposal_open_contract); } catch (e) { /* ignore */ }
            }

            const onMsg = (evt: MessageEvent) => {
                try {
                    const data = JSON.parse(evt.data as string);
                    if (data?.msg_type === 'proposal_open_contract') {
                        const poc = data.proposal_open_contract;
                        if (!pocSubId && data?.subscription?.id) pocSubId = data.subscription.id;
                        if (String(poc?.contract_id || '') === contractId) {
                            try { transactions.onBotContractEvent(poc); } catch (e) { /* ignore */ }
                            if (poc?.is_sold || poc?.status === 'sold') {
                                if (pocSubId) api.send({ forget: pocSubId }).catch(() => {});
                                api.connection?.removeEventListener?.('message', onMsg);

                                if (settledContractsRef.current.has(contractId)) return;
                                settledContractsRef.current.add(contractId);

                                const profit = parseFloat(poc.profit) || 0;
                                pnlRef.current += profit;
                                setTotalPnL(pnlRef.current);
                                setTrades(prev => prev.map(t =>
                                    t.id === contractId
                                        ? { ...t, status: profit >= 0 ? 'won' : 'lost', profit }
                                        : t
                                ));
                                if (profit >= 0) setWins(w => w + 1);
                                else setLosses(l => l + 1);

                                if (poc.balance_after) {
                                    setBalance(parseFloat(poc.balance_after));
                                }

                                const risk = riskRef.current;
                                if (risk.stopLoss > 0 && pnlRef.current <= -risk.stopLoss) stopBatchRef.current = true;
                                if (risk.takeProfit > 0 && pnlRef.current >= risk.takeProfit) stopBatchRef.current = true;
                            }
                        }
                    }
                } catch (e) { /* ignore */ }
            };
            api.connection?.addEventListener?.('message', onMsg);
        } catch (e) { /* ignore poc subscribe errors */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [market, duration, stake, prediction, transactions, run_panel]);

    const executeBatch = useCallback(async (contractType: string) => {
        if (!isReady) {
            setTradeError(authError || 'Please log in to your Deriv account to trade.');
            setTimeout(() => setTradeError(''), 4000);
            return;
        }
        if (isExecuting) return;

        setIsExecuting(true);
        stopBatchRef.current = false;
        setBatchProgress({ current: 0, total: bulkCount });

        for (let i = 0; i < bulkCount; i++) {
            if (stopBatchRef.current) break;
            setBatchProgress({ current: i + 1, total: bulkCount });
            try {
                await purchaseOne(contractType);
                if (delayMs > 0 && i < bulkCount - 1) {
                    await new Promise(r => setTimeout(r, delayMs));
                }
            } catch (error: any) {
                const trade: Trade = {
                    id: `err-${Date.now()}-${i}`,
                    contractType,
                    buyPrice: stake,
                    status: 'error',
                    profit: 0,
                    error: error.message || 'Trade failed',
                    time: new Date().toLocaleTimeString(),
                };
                setTrades(prev => [trade, ...prev]);
                if (error.message?.includes?.('InsufficientBalance') || error.code === 'InsufficientBalance') {
                    stopBatchRef.current = true;
                }
            }
        }

        setIsExecuting(false);
    }, [isReady, isExecuting, bulkCount, delayMs, stake, purchaseOne, authError]);

    const stopBatch = useCallback(() => { stopBatchRef.current = true; }, []);

    const resetStats = useCallback(() => {
        setTrades([]);
        setTotalPnL(0);
        setWins(0);
        setLosses(0);
        pnlRef.current = 0;
        settledContractsRef.current.clear();
    }, []);

    const currentContract = CONTRACT_MAP[contractGroup];
    const showPrediction = contractGroup === 'over_under' || contractGroup === 'matches_differs';
    const winRate = wins + losses > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : '0.0';

    const isDigitValid = useCallback((digit: number, contractType: string) => {
        if (contractType === 'DIGITOVER') return digit >= 0 && digit <= 8;
        if (contractType === 'DIGITUNDER') return digit >= 1 && digit <= 9;
        return digit >= 0 && digit <= 9;
    }, []);

    const aPercent = digitFreqs.length && showPrediction
        ? (contractGroup === 'over_under'
            ? digitFreqs.slice(prediction + 1).reduce((a, b) => a + b, 0).toFixed(0)
            : digitFreqs[prediction]?.toFixed(0) || '0')
        : '50';
    const bPercent = digitFreqs.length && showPrediction
        ? (contractGroup === 'over_under'
            ? digitFreqs.slice(0, prediction).reduce((a, b) => a + b, 0).toFixed(0)
            : (100 - (digitFreqs[prediction] || 0)).toFixed(0))
        : '50';

    const digitRankColors = useMemo(() => {
        return digitFreqs.map((_, i) => getDigitRankColor(digitFreqs, i));
    }, [digitFreqs]);

    return (
        <div className='bbt'>
            <nav className='bbt-nav'>
                {NAV_ITEMS.map(item => (
                    <button
                        key={item.id}
                        className={`bbt-nav__item ${activeNav === item.id ? 'bbt-nav__item--active' : ''}`}
                        onClick={() => setActiveNav(item.id)}
                        title={item.label}
                    >
                        <span className='bbt-nav__icon'>{item.icon}</span>
                        <span className='bbt-nav__label'>{item.label}</span>
                    </button>
                ))}
                <div className='bbt-nav__spacer' />
                <div className={`bbt-nav__status ${isReady ? 'bbt-nav__status--ok' : authStatus === 'connecting' ? 'bbt-nav__status--connecting' : ''}`} />
            </nav>

            <div className='bbt-main'>
                <div className='bbt-header'>
                    <div className='bbt-header__left'>
                        <span className='bbt-header__accent' />
                        <div>
                            <h1 className='bbt-header__title'>Batch Buying Tool</h1>
                            <p className='bbt-header__sub'>Execute strategic bulk trades with advanced prediction analysis</p>
                        </div>
                    </div>
                    <div className='bbt-header__right'>
                        {authStatus === 'connecting' && (
                            <span className='bbt-auth__info'>Connecting...</span>
                        )}
                        {authStatus === 'ready' && (
                            <span className='bbt-auth__info'>{loginId} • {balance.toFixed(2)} {currency}</span>
                        )}
                        {authStatus === 'error' && (
                            <span className='bbt-auth__error'>{authError}</span>
                        )}
                    </div>
                </div>

                <div className='bbt-body'>
                    {activeNav === 'trade' && (
                        <div className='bbt-trade'>
                            <div className='bbt-card'>
                                <h2 className='bbt-card__heading'>{currentContract.aLabel}/{currentContract.bLabel}</h2>

                                <label className='bbt-label'>Select Market</label>
                                <select className='bbt-select' value={market} onChange={e => setMarket(e.target.value)}>
                                    {MARKETS.map(m => <option key={m.symbol} value={m.symbol}>{m.label}</option>)}
                                </select>

                                <label className='bbt-label'>Contract Type</label>
                                <select className='bbt-select' value={contractGroup} onChange={e => setContractGroup(e.target.value)}>
                                    {CONTRACT_GROUPS.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
                                </select>

                                <div className='bbt-row3'>
                                    <div>
                                        <label className='bbt-label'>Ticks</label>
                                        <input type='number' className='bbt-input' value={duration} min={1} max={10}
                                            onChange={e => setDuration(parseInt(e.target.value) || 1)} />
                                    </div>
                                    <div>
                                        <label className='bbt-label'>Stake</label>
                                        <input type='number' className='bbt-input' value={stake} min={0.35} step={0.01}
                                            onChange={e => setStake(parseFloat(e.target.value) || 0.35)} />
                                    </div>
                                    <div>
                                        <label className='bbt-label'>No. of Bulk Trades</label>
                                        <input type='number' className='bbt-input' value={bulkCount} min={1} max={100}
                                            onChange={e => setBulkCount(parseInt(e.target.value) || 1)} />
                                    </div>
                                </div>

                                {showPrediction && (
                                    <>
                                        <label className='bbt-label'>Select Prediction Digit</label>
                                        <input
                                            type='number'
                                            className='bbt-input bbt-input--pred'
                                            value={prediction}
                                            min={0}
                                            max={9}
                                            onChange={e => setPrediction(Math.max(0, Math.min(9, parseInt(e.target.value) || 0)))}
                                        />
                                    </>
                                )}

                                <div className='bbt-curtick'>
                                    <span className='bbt-curtick__label'>Current Tick:</span>
                                    <span className='bbt-curtick__val'>
                                        {currentTick ? (
                                            <>
                                                {currentTick.slice(0, -1)}
                                                <span className='bbt-curtick__digit' style={{ color: digitRankColors[lastDigit ?? 0] }}>
                                                    {currentTick.slice(-1)}
                                                </span>
                                            </>
                                        ) : (
                                            <span className='bbt-curtick__waiting'>Connecting...</span>
                                        )}
                                    </span>
                                </div>

                                <div className='bbt-digits'>
                                    <h4 className='bbt-digits__title'>Digit Statistics (Last {tickCount} ticks)</h4>
                                    <div className='bbt-digits__grid'>
                                        {digitFreqs.map((freq, i) => {
                                            const isActive = lastDigit === i;
                                            const isSelected = prediction === i && showPrediction;
                                            const pct = freq || 0;
                                            const circumference = 2 * Math.PI * 22;
                                            const dashOffset = circumference - (circumference * pct / 100);
                                            const ringColor = digitRankColors[i];
                                            return (
                                                <div
                                                    key={i}
                                                    className={`bbt-digit ${isActive ? 'bbt-digit--active' : ''} ${isSelected ? 'bbt-digit--sel' : ''}`}
                                                    onClick={() => showPrediction && setPrediction(i)}
                                                >
                                                    <svg className='bbt-digit__ring' viewBox='0 0 50 50'>
                                                        <circle cx='25' cy='25' r='22' fill='#2d3748' stroke='#4a5568' strokeWidth='2.5' />
                                                        <circle
                                                            cx='25' cy='25' r='22' fill='none'
                                                            stroke={ringColor}
                                                            strokeWidth='3'
                                                            strokeDasharray={circumference}
                                                            strokeDashoffset={dashOffset}
                                                            strokeLinecap='round'
                                                            transform='rotate(-90 25 25)'
                                                        />
                                                    </svg>
                                                    <div className='bbt-digit__inner'>
                                                        <span className='bbt-digit__num'>{i}</span>
                                                        <span className='bbt-digit__pct' style={{ color: ringColor }}>{freq}%</span>
                                                    </div>
                                                    {isActive && <div className='bbt-digit__cursor' />}
                                                    {isSelected && <div className='bbt-digit__sel-ring' />}
                                                </div>
                                            );
                                        })}
                                    </div>
                                    <div className='bbt-digits__legend'>
                                        <span className='bbt-digits__legend-item'><span className='bbt-digits__legend-dot' style={{ background: RANK_COLORS.most }} />Most</span>
                                        <span className='bbt-digits__legend-item'><span className='bbt-digits__legend-dot' style={{ background: RANK_COLORS.second }} />2nd Most</span>
                                        <span className='bbt-digits__legend-item'><span className='bbt-digits__legend-dot' style={{ background: RANK_COLORS.secondLast }} />2nd Least</span>
                                        <span className='bbt-digits__legend-item'><span className='bbt-digits__legend-dot' style={{ background: RANK_COLORS.least }} />Least</span>
                                    </div>
                                </div>

                                <div className='bbt-actions'>
                                    {isExecuting ? (
                                        <>
                                            <div className='bbt-actions__progress'>
                                                <div className='bbt-actions__spinner' />
                                                Executing {batchProgress.current} / {batchProgress.total}
                                            </div>
                                            <button className='bbt-actions__stop' onClick={stopBatch}>Stop</button>
                                        </>
                                    ) : (
                                        <>
                                            <button
                                                className='bbt-actions__btn bbt-actions__btn--a'
                                                onClick={() => executeBatch(currentContract.a)}
                                                disabled={requiresBarrier(currentContract.a) && isReady && !isDigitValid(prediction, currentContract.a)}
                                            >
                                                <span className='bbt-actions__btn-icon'>{currentContract.aIcon}</span>
                                                <span className='bbt-actions__btn-label'>{currentContract.aLabel} {showPrediction ? prediction : ''}</span>
                                                <span className='bbt-actions__btn-pct'>{aPercent}%</span>
                                            </button>
                                            <button
                                                className='bbt-actions__btn bbt-actions__btn--b'
                                                onClick={() => executeBatch(currentContract.b)}
                                                disabled={requiresBarrier(currentContract.b) && isReady && !isDigitValid(prediction, currentContract.b)}
                                            >
                                                <span className='bbt-actions__btn-icon'>{currentContract.bIcon}</span>
                                                <span className='bbt-actions__btn-label'>{currentContract.bLabel} {showPrediction ? prediction : ''}</span>
                                                <span className='bbt-actions__btn-pct'>{bPercent}%</span>
                                            </button>
                                        </>
                                    )}
                                </div>
                                {tradeError && (
                                    <div className='bbt-trade-error'>{tradeError}</div>
                                )}
                            </div>
                        </div>
                    )}

                    {activeNav === 'stats' && (
                        <div className='bbt-stats-panel'>
                            <div className='bbt-card'>
                                <h2 className='bbt-card__heading'>Trading Statistics</h2>
                                <div className='bbt-stats-grid'>
                                    <div className='bbt-stat-card'>
                                        <span className='bbt-stat-card__label'>Balance</span>
                                        <span className='bbt-stat-card__value'>{balance.toFixed(2)} {currency}</span>
                                    </div>
                                    <div className='bbt-stat-card'>
                                        <span className='bbt-stat-card__label'>Total P/L</span>
                                        <span className={`bbt-stat-card__value ${totalPnL >= 0 ? 'bbt-stat-card__value--green' : 'bbt-stat-card__value--red'}`}>
                                            {totalPnL >= 0 ? '+' : ''}{totalPnL.toFixed(2)}
                                        </span>
                                    </div>
                                    <div className='bbt-stat-card'>
                                        <span className='bbt-stat-card__label'>Win Rate</span>
                                        <span className='bbt-stat-card__value'>{winRate}%</span>
                                    </div>
                                    <div className='bbt-stat-card'>
                                        <span className='bbt-stat-card__label'>Wins / Losses</span>
                                        <span className='bbt-stat-card__value'>
                                            <span className='bbt-stat-card__value--green'>{wins}</span>
                                            {' / '}
                                            <span className='bbt-stat-card__value--red'>{losses}</span>
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeNav === 'log' && (
                        <div className='bbt-log-panel'>
                            <div className='bbt-card'>
                                <div className='bbt-log-header'>
                                    <h2 className='bbt-card__heading'>Trade Log</h2>
                                    <button className='bbt-log-clear' onClick={resetStats}>Clear All</button>
                                </div>
                                <div className='bbt-log-list'>
                                    {trades.length === 0 ? (
                                        <div className='bbt-log-empty'>No trades yet. Execute a batch to see results here.</div>
                                    ) : (
                                        trades.map((t) => (
                                            <div key={t.id} className={`bbt-log-item bbt-log-item--${t.status}`}>
                                                <div className='bbt-log-item__left'>
                                                    <span className={`bbt-log-item__badge bbt-log-item__badge--${t.status}`}>
                                                        {t.status === 'won' ? '✓' : t.status === 'lost' ? '✗' : t.status === 'error' ? '!' : '⏳'}
                                                    </span>
                                                    <div>
                                                        <span className='bbt-log-item__type'>{TYPE_LABELS[t.contractType] || t.contractType}</span>
                                                        <span className='bbt-log-item__time'>{t.time}</span>
                                                    </div>
                                                </div>
                                                <div className='bbt-log-item__right'>
                                                    <span className='bbt-log-item__stake'>${t.buyPrice.toFixed(2)}</span>
                                                    {t.status === 'won' && <span className='bbt-log-item__profit'>+{t.profit.toFixed(2)}</span>}
                                                    {t.status === 'lost' && <span className='bbt-log-item__loss'>{t.profit.toFixed(2)}</span>}
                                                    {t.status === 'pending' && <span className='bbt-log-item__pending'>Pending</span>}
                                                    {t.status === 'error' && <span className='bbt-log-item__err'>{t.error}</span>}
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {activeNav === 'risk' && (
                        <div className='bbt-risk-panel'>
                            <div className='bbt-card'>
                                <h2 className='bbt-card__heading'>Risk Management</h2>
                                <div className='bbt-risk-grid'>
                                    <div>
                                        <label className='bbt-label'>Stop Loss</label>
                                        <input type='number' className='bbt-input' value={stopLoss} min={0} step={0.5}
                                            onChange={e => setStopLoss(parseFloat(e.target.value) || 0)} />
                                        <span className='bbt-risk-hint'>Trading stops when total loss reaches this amount (0 = disabled)</span>
                                    </div>
                                    <div>
                                        <label className='bbt-label'>Take Profit</label>
                                        <input type='number' className='bbt-input' value={takeProfit} min={0} step={0.5}
                                            onChange={e => setTakeProfit(parseFloat(e.target.value) || 0)} />
                                        <span className='bbt-risk-hint'>Trading stops when total profit reaches this amount (0 = disabled)</span>
                                    </div>
                                    <div>
                                        <label className='bbt-label'>Delay Between Trades (ms)</label>
                                        <input type='number' className='bbt-input' value={delayMs} min={0} step={100}
                                            onChange={e => setDelayMs(parseInt(e.target.value) || 0)} />
                                        <span className='bbt-risk-hint'>Milliseconds to wait between each trade in a batch</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
});

export default BatchTrader;
