import React, { useState, useRef, useCallback, useEffect } from 'react';
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
    { label: 'Odd/Even', value: 'odd_even', icon: '🎲' },
    { label: 'Over/Under', value: 'over_under', icon: '📊' },
    { label: 'Matches/Differs', value: 'matches_differs', icon: '🎯' },
    { label: 'Rise/Fall', value: 'rise_fall', icon: '📈' },
];

const CONTRACT_MAP: Record<string, { a: string; b: string; aLabel: string; bLabel: string; aIcon: string; bIcon: string }> = {
    odd_even: { a: 'DIGITODD', b: 'DIGITEVEN', aLabel: 'Odd', bLabel: 'Even', aIcon: '⬆', bIcon: '⬇' },
    over_under: { a: 'DIGITOVER', b: 'DIGITUNDER', aLabel: 'Over', bLabel: 'Under', aIcon: '⬆', bIcon: '⬇' },
    matches_differs: { a: 'DIGITMATCH', b: 'DIGITDIFF', aLabel: 'Matches', bLabel: 'Differs', aIcon: '⬆', bIcon: '⬇' },
    rise_fall: { a: 'CALL', b: 'PUT', aLabel: 'Rise', bLabel: 'Fall', aIcon: '⬆', bIcon: '⬇' },
};

const DIGIT_COLORS = [
    '#2563eb', '#eab308', '#6366f1', '#f97316', '#64748b',
    '#8b5cf6', '#14b8a6', '#3b82f6', '#ef4444', '#22c55e',
];

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

const BatchTrader: React.FC = () => {
    const [token, setToken] = useState('');
    const [isConnected, setIsConnected] = useState(false);
    const [isAuthorized, setIsAuthorized] = useState(false);
    const [connectError, setConnectError] = useState('');
    const [activeNav, setActiveNav] = useState('trade');

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

    const [stopLoss, setStopLoss] = useState(0);
    const [takeProfit, setTakeProfit] = useState(0);

    const wsRef = useRef<WebSocket | null>(null);
    const reqIdRef = useRef(1);
    const pendingRef = useRef<Map<number, { resolve: Function; reject: Function }>>(new Map());
    const stopBatchRef = useRef(false);
    const tickSubIdRef = useRef<string | null>(null);
    const pnlRef = useRef(0);
    const riskRef = useRef({ stopLoss: 0, takeProfit: 0 });
    riskRef.current = { stopLoss, takeProfit };
    const settledContractsRef = useRef<Set<string>>(new Set());
    const contractSubsRef = useRef<Map<string, string>>(new Map());

    const sendRequest = useCallback((request: any): Promise<any> => {
        return new Promise((resolve, reject) => {
            if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
                reject({ message: 'WebSocket not connected' });
                return;
            }
            const id = reqIdRef.current++;
            pendingRef.current.set(id, { resolve, reject });
            wsRef.current.send(JSON.stringify({ ...request, req_id: id }));
            setTimeout(() => {
                if (pendingRef.current.has(id)) {
                    pendingRef.current.delete(id);
                    reject({ message: 'Request timeout' });
                }
            }, 15000);
        });
    }, []);

    const updateDigitFreqs = useCallback((history: number[]) => {
        const counts = Array(10).fill(0);
        history.forEach(d => counts[d]++);
        const total = history.length || 1;
        setDigitFreqs(counts.map(c => parseFloat(((c / total) * 100).toFixed(1))));
    }, []);

    const handleTick = useCallback((tick: any) => {
        const price = tick.quote.toString();
        const digit = parseInt(price.slice(-1));
        setCurrentTick(price);
        setLastDigit(digit);
        const history = digitHistoryRef.current;
        history.push(digit);
        if (history.length > 1000) history.shift();
        setTickCount(history.length);
        updateDigitFreqs(history);
    }, [updateDigitFreqs]);

    const handleContractUpdate = useCallback((contract: any, subscriptionId?: string) => {
        if (contract.is_sold || contract.is_expired || contract.status === 'sold') {
            const contractId = contract.contract_id?.toString();
            if (!contractId || settledContractsRef.current.has(contractId)) return;
            settledContractsRef.current.add(contractId);

            if (subscriptionId && wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({ forget: subscriptionId }));
                contractSubsRef.current.delete(contractId);
            }

            const profit = parseFloat(contract.profit) || 0;

            setTrades(prev => prev.map(t =>
                t.id === contractId
                    ? { ...t, status: profit >= 0 ? 'won' : 'lost', profit }
                    : t
            ));

            if (profit >= 0) setWins(w => w + 1);
            else setLosses(l => l + 1);

            pnlRef.current += profit;
            setTotalPnL(pnlRef.current);

            if (contract.balance_after) {
                setBalance(parseFloat(contract.balance_after));
            }

            const risk = riskRef.current;
            if (risk.stopLoss > 0 && pnlRef.current <= -risk.stopLoss) {
                stopBatchRef.current = true;
            }
            if (risk.takeProfit > 0 && pnlRef.current >= risk.takeProfit) {
                stopBatchRef.current = true;
            }
        }
    }, []);

    const connect = useCallback(() => {
        if (!token.trim()) {
            setConnectError('Please enter your API token');
            return;
        }
        setConnectError('');
        const ws = new WebSocket(WS_URL);

        ws.onopen = () => {
            setIsConnected(true);
            ws.send(JSON.stringify({ authorize: token.trim() }));
        };

        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);

            if (data.req_id && pendingRef.current.has(data.req_id)) {
                const { resolve, reject } = pendingRef.current.get(data.req_id)!;
                pendingRef.current.delete(data.req_id);
                if (data.error) reject(data.error);
                else resolve(data);
            }

            if (data.msg_type === 'authorize') {
                if (data.error) {
                    setConnectError(data.error.message || 'Authorization failed');
                    setIsAuthorized(false);
                    ws.close();
                    wsRef.current = null;
                    setIsConnected(false);
                } else {
                    setIsAuthorized(true);
                    setBalance(parseFloat(data.authorize.balance));
                    setCurrency(data.authorize.currency);
                    setLoginId(data.authorize.loginid);
                    ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
                }
            }

            if (data.msg_type === 'tick') {
                handleTick(data.tick);
            }

            if (data.msg_type === 'balance') {
                setBalance(parseFloat(data.balance.balance));
                setCurrency(data.balance.currency);
            }

            if (data.msg_type === 'proposal_open_contract') {
                const subId = data.subscription?.id;
                if (subId && data.proposal_open_contract?.contract_id) {
                    contractSubsRef.current.set(data.proposal_open_contract.contract_id.toString(), subId);
                }
                handleContractUpdate(data.proposal_open_contract, subId);
            }

            if (data.error && !data.req_id) {
                console.warn('Batch Trader WS:', data.error.message);
            }
        };

        ws.onerror = () => {
            setConnectError('Connection error');
            setIsConnected(false);
            setIsAuthorized(false);
        };

        ws.onclose = () => {
            setIsConnected(false);
            setIsAuthorized(false);
        };

        wsRef.current = ws;
    }, [token, handleTick, handleContractUpdate]);

    const disconnect = useCallback(() => {
        wsRef.current?.close();
        wsRef.current = null;
        setIsConnected(false);
        setIsAuthorized(false);
        digitHistoryRef.current = [];
        setDigitFreqs(Array(10).fill(0));
        setCurrentTick('');
        setLastDigit(null);
        setTickCount(0);
    }, []);

    useEffect(() => {
        if (!isAuthorized || !wsRef.current) return;

        if (tickSubIdRef.current) {
            wsRef.current.send(JSON.stringify({ forget: tickSubIdRef.current }));
            tickSubIdRef.current = null;
        }

        digitHistoryRef.current = [];
        setDigitFreqs(Array(10).fill(0));
        setCurrentTick('');
        setLastDigit(null);
        setTickCount(0);

        wsRef.current.send(JSON.stringify({ ticks: market, subscribe: 1 }));

        const ws = wsRef.current;
        const captureSubId = (event: MessageEvent) => {
            const data = JSON.parse(event.data);
            if (data.msg_type === 'tick' && data.subscription) {
                tickSubIdRef.current = data.subscription.id;
                ws.removeEventListener('message', captureSubId);
            }
        };
        ws.addEventListener('message', captureSubId);
    }, [isAuthorized, market]);

    useEffect(() => {
        return () => { wsRef.current?.close(); };
    }, []);

    const executeBatch = useCallback(async (contractType: string) => {
        if (!wsRef.current || !isAuthorized || isExecuting) return;

        const needBarrier = requiresBarrier(contractType);

        setIsExecuting(true);
        stopBatchRef.current = false;
        setBatchProgress({ current: 0, total: bulkCount });

        for (let i = 0; i < bulkCount; i++) {
            if (stopBatchRef.current) break;
            setBatchProgress({ current: i + 1, total: bulkCount });

            try {
                const proposalReq: any = {
                    proposal: 1,
                    amount: stake,
                    basis: 'stake',
                    contract_type: contractType,
                    currency,
                    duration,
                    duration_unit: 't',
                    symbol: market,
                };

                if (needBarrier) {
                    proposalReq.barrier = prediction.toString();
                }

                const proposalRes = await sendRequest(proposalReq);
                const buyRes = await sendRequest({
                    buy: proposalRes.proposal.id,
                    price: proposalRes.proposal.ask_price,
                });

                const contractId = buyRes.buy.contract_id.toString();
                const trade: Trade = {
                    id: contractId,
                    contractType,
                    buyPrice: parseFloat(buyRes.buy.buy_price),
                    status: 'pending',
                    profit: 0,
                    time: new Date().toLocaleTimeString(),
                };

                setTrades(prev => [trade, ...prev]);
                setBalance(parseFloat(buyRes.buy.balance_after));

                wsRef.current?.send(JSON.stringify({
                    proposal_open_contract: 1,
                    contract_id: buyRes.buy.contract_id,
                    subscribe: 1,
                }));

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

                if (error.code === 'InsufficientBalance') {
                    stopBatchRef.current = true;
                }
            }
        }

        setIsExecuting(false);
    }, [isAuthorized, isExecuting, market, duration, stake, bulkCount, prediction, delayMs, currency, sendRequest]);

    const stopBatch = useCallback(() => { stopBatchRef.current = true; }, []);

    const resetStats = useCallback(() => {
        setTrades([]);
        setTotalPnL(0);
        setWins(0);
        setLosses(0);
        pnlRef.current = 0;
        settledContractsRef.current.clear();
        contractSubsRef.current.forEach((subId) => {
            if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({ forget: subId }));
            }
        });
        contractSubsRef.current.clear();
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

    const TYPE_LABELS: Record<string, string> = {
        DIGITODD: 'Odd', DIGITEVEN: 'Even', DIGITOVER: 'Over', DIGITUNDER: 'Under',
        DIGITMATCH: 'Matches', DIGITDIFF: 'Differs', CALL: 'Rise', PUT: 'Fall',
    };

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
                <div className={`bbt-nav__status ${isAuthorized ? 'bbt-nav__status--ok' : ''}`} />
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
                        {!isAuthorized ? (
                            <div className='bbt-auth'>
                                <input
                                    type='password'
                                    className='bbt-auth__input'
                                    placeholder='Enter Deriv API Token'
                                    value={token}
                                    onChange={e => setToken(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && connect()}
                                />
                                <button className='bbt-auth__btn' onClick={connect} disabled={isConnected}>
                                    {isConnected ? 'Connecting...' : 'Connect'}
                                </button>
                            </div>
                        ) : (
                            <div className='bbt-auth'>
                                <span className='bbt-auth__info'>{loginId} • {balance.toFixed(2)} {currency}</span>
                                <button className='bbt-auth__btn bbt-auth__btn--dc' onClick={disconnect}>Disconnect</button>
                            </div>
                        )}
                        {connectError && <span className='bbt-auth__error'>{connectError}</span>}
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

                                {currentTick && (
                                    <div className='bbt-curtick'>
                                        <span className='bbt-curtick__label'>Current Tick:</span>
                                        <span className='bbt-curtick__val'>
                                            {currentTick.slice(0, -1)}
                                            <span className='bbt-curtick__digit' style={{ color: DIGIT_COLORS[lastDigit || 0] }}>
                                                {currentTick.slice(-1)}
                                            </span>
                                        </span>
                                    </div>
                                )}

                                <div className='bbt-digits'>
                                    <h4 className='bbt-digits__title'>Digit Statistics (Last {tickCount} ticks)</h4>
                                    <div className='bbt-digits__grid'>
                                        {digitFreqs.map((freq, i) => {
                                            const isActive = lastDigit === i;
                                            const isSelected = prediction === i && showPrediction;
                                            const pct = freq || 0;
                                            const circumference = 2 * Math.PI * 22;
                                            const dashOffset = circumference - (circumference * pct / 100);
                                            return (
                                                <div
                                                    key={i}
                                                    className={`bbt-digit ${isActive ? 'bbt-digit--active' : ''} ${isSelected ? 'bbt-digit--sel' : ''}`}
                                                    onClick={() => showPrediction && setPrediction(i)}
                                                >
                                                    <svg className='bbt-digit__ring' viewBox='0 0 50 50'>
                                                        <circle cx='25' cy='25' r='22' fill='none' stroke='#e5e7eb' strokeWidth='3' />
                                                        <circle
                                                            cx='25' cy='25' r='22' fill='none'
                                                            stroke={DIGIT_COLORS[i]}
                                                            strokeWidth='3'
                                                            strokeDasharray={circumference}
                                                            strokeDashoffset={dashOffset}
                                                            strokeLinecap='round'
                                                            transform='rotate(-90 25 25)'
                                                        />
                                                    </svg>
                                                    <div className='bbt-digit__inner'>
                                                        <span className='bbt-digit__num'>{i}</span>
                                                        <span className='bbt-digit__pct' style={{ color: DIGIT_COLORS[i] }}>{freq}%</span>
                                                    </div>
                                                </div>
                                            );
                                        })}
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
                                                disabled={!isAuthorized || (requiresBarrier(currentContract.a) && !isDigitValid(prediction, currentContract.a))}
                                            >
                                                <span className='bbt-actions__btn-icon'>{currentContract.aIcon}</span>
                                                <span className='bbt-actions__btn-label'>{currentContract.aLabel} {showPrediction ? prediction : ''}</span>
                                                <span className='bbt-actions__btn-pct'>{aPercent}%</span>
                                            </button>
                                            <button
                                                className='bbt-actions__btn bbt-actions__btn--b'
                                                onClick={() => executeBatch(currentContract.b)}
                                                disabled={!isAuthorized || (requiresBarrier(currentContract.b) && !isDigitValid(prediction, currentContract.b))}
                                            >
                                                <span className='bbt-actions__btn-icon'>{currentContract.bIcon}</span>
                                                <span className='bbt-actions__btn-label'>{currentContract.bLabel} {showPrediction ? prediction : ''}</span>
                                                <span className='bbt-actions__btn-pct'>{bPercent}%</span>
                                            </button>
                                        </>
                                    )}
                                </div>
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
};

export default BatchTrader;
