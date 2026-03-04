import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import './batch-trader.scss';

const APP_ID = 128207;
const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

const MARKETS = [
    { label: 'Volatility 10 (1s)', symbol: '1HZ10V' },
    { label: 'Volatility 10 Index', symbol: 'R_10' },
    { label: 'Volatility 15 (1s)', symbol: '1HZ15V' },
    { label: 'Volatility 25 (1s)', symbol: '1HZ25V' },
    { label: 'Volatility 25 Index', symbol: 'R_25' },
    { label: 'Volatility 30 (1s)', symbol: '1HZ30V' },
    { label: 'Volatility 50 (1s)', symbol: '1HZ50V' },
    { label: 'Volatility 50 Index', symbol: 'R_50' },
    { label: 'Volatility 75 (1s)', symbol: '1HZ75V' },
    { label: 'Volatility 75 Index', symbol: 'R_75' },
    { label: 'Volatility 90 (1s)', symbol: '1HZ90V' },
    { label: 'Volatility 100 (1s)', symbol: '1HZ100V' },
    { label: 'Volatility 100 Index', symbol: 'R_100' },
];

const CONTRACT_GROUPS = [
    { label: 'Odd/Even', value: 'odd_even' },
    { label: 'Over/Under', value: 'over_under' },
    { label: 'Matches/Differs', value: 'matches_differs' },
    { label: 'Rise/Fall', value: 'rise_fall' },
];

const CONTRACT_MAP: Record<string, { a: string; b: string; aLabel: string; bLabel: string }> = {
    odd_even: { a: 'DIGITODD', b: 'DIGITEVEN', aLabel: 'Odd', bLabel: 'Even' },
    over_under: { a: 'DIGITOVER', b: 'DIGITUNDER', aLabel: 'Over', bLabel: 'Under' },
    matches_differs: { a: 'DIGITMATCH', b: 'DIGITDIFF', aLabel: 'Matches', bLabel: 'Differs' },
    rise_fall: { a: 'CALL', b: 'PUT', aLabel: 'Rise', bLabel: 'Fall' },
};

const DIGIT_COLORS = [
    '#6366f1', '#8b5cf6', '#a855f7', '#ec4899', '#f43f5e',
    '#f97316', '#eab308', '#22c55e', '#14b8a6', '#3b82f6',
];

const TYPE_LABELS: Record<string, string> = {
    DIGITODD: 'Odd', DIGITEVEN: 'Even', DIGITOVER: 'Over', DIGITUNDER: 'Under',
    DIGITMATCH: 'Matches', DIGITDIFF: 'Differs', CALL: 'Rise', PUT: 'Fall',
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

const BatchTrader: React.FC = () => {
    const [token, setToken] = useState('');
    const [isConnected, setIsConnected] = useState(false);
    const [isAuthorized, setIsAuthorized] = useState(false);
    const [connectError, setConnectError] = useState('');

    const [balance, setBalance] = useState(0);
    const [currency, setCurrency] = useState('USD');
    const [loginId, setLoginId] = useState('');

    const [market, setMarket] = useState(MARKETS[12].symbol);
    const [contractGroup, setContractGroup] = useState('matches_differs');
    const [duration, setDuration] = useState(1);
    const [stake, setStake] = useState(0.5);
    const [bulkCount, setBulkCount] = useState(1);
    const [prediction, setPrediction] = useState<number>(5);
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

    return (
        <div className='bt'>
            <div className='bt-conn'>
                <div className='bt-conn__left'>
                    <div className={`bt-conn__dot ${isAuthorized ? 'bt-conn__dot--ok' : isConnected ? 'bt-conn__dot--pending' : ''}`} />
                    <span className='bt-conn__label'>
                        {isAuthorized ? `${loginId} | ${balance.toFixed(2)} ${currency}` : isConnected ? 'Authenticating...' : 'Disconnected'}
                    </span>
                </div>
                <div className='bt-conn__right'>
                    {!isAuthorized ? (
                        <>
                            <input
                                type='password'
                                className='bt-conn__input'
                                placeholder='Enter Deriv API Token'
                                value={token}
                                onChange={e => setToken(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && connect()}
                            />
                            <button className='bt-conn__btn' onClick={connect} disabled={isConnected}>
                                Connect
                            </button>
                        </>
                    ) : (
                        <button className='bt-conn__btn bt-conn__btn--dc' onClick={disconnect}>
                            Disconnect
                        </button>
                    )}
                </div>
                {connectError && <div className='bt-conn__error'>{connectError}</div>}
            </div>

            <div className='bt-dash'>
                <div className='bt-left'>
                    <div className='bt-card'>
                        <h3 className='bt-card__title'>{currentContract.aLabel} / {currentContract.bLabel}</h3>

                        <div className='bt-field'>
                            <label className='bt-field__label'>Select Market</label>
                            <select className='bt-field__select' value={market} onChange={e => setMarket(e.target.value)}>
                                {MARKETS.map(m => <option key={m.symbol} value={m.symbol}>{m.label}</option>)}
                            </select>
                        </div>

                        <div className='bt-field'>
                            <label className='bt-field__label'>Contract Type</label>
                            <select className='bt-field__select' value={contractGroup} onChange={e => setContractGroup(e.target.value)}>
                                {CONTRACT_GROUPS.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
                            </select>
                        </div>

                        <div className='bt-row'>
                            <div className='bt-field'>
                                <label className='bt-field__label'>Ticks</label>
                                <input type='number' className='bt-field__input' value={duration} min={1} max={10}
                                    onChange={e => setDuration(parseInt(e.target.value) || 1)} />
                            </div>
                            <div className='bt-field'>
                                <label className='bt-field__label'>Stake</label>
                                <input type='number' className='bt-field__input' value={stake} min={0.35} step={0.01}
                                    onChange={e => setStake(parseFloat(e.target.value) || 0.35)} />
                            </div>
                            <div className='bt-field'>
                                <label className='bt-field__label'>No. of Bulk Trades</label>
                                <input type='number' className='bt-field__input' value={bulkCount} min={1} max={100}
                                    onChange={e => setBulkCount(parseInt(e.target.value) || 1)} />
                            </div>
                        </div>

                        {showPrediction && (
                            <div className='bt-field'>
                                <label className='bt-field__label'>Select Prediction Digit</label>
                                <div className='bt-pred'>
                                    {Array.from({ length: 10 }, (_, i) => (
                                        <button
                                            key={i}
                                            className={`bt-pred__btn ${prediction === i ? 'bt-pred__btn--active' : ''}`}
                                            style={{ '--dc': DIGIT_COLORS[i] } as React.CSSProperties}
                                            onClick={() => setPrediction(i)}
                                        >
                                            {i}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className='bt-row'>
                            <div className='bt-field'>
                                <label className='bt-field__label'>Delay (ms)</label>
                                <input type='number' className='bt-field__input' value={delayMs} min={0} step={100}
                                    onChange={e => setDelayMs(parseInt(e.target.value) || 0)} />
                            </div>
                            <div className='bt-field'>
                                <label className='bt-field__label'>Stop Loss</label>
                                <input type='number' className='bt-field__input' value={stopLoss} min={0} step={0.5}
                                    onChange={e => setStopLoss(parseFloat(e.target.value) || 0)} />
                            </div>
                            <div className='bt-field'>
                                <label className='bt-field__label'>Take Profit</label>
                                <input type='number' className='bt-field__input' value={takeProfit} min={0} step={0.5}
                                    onChange={e => setTakeProfit(parseFloat(e.target.value) || 0)} />
                            </div>
                        </div>

                        {currentTick && (
                            <div className='bt-tick'>
                                <span className='bt-tick__label'>Current Tick:</span>
                                <span className='bt-tick__price'>
                                    {currentTick.slice(0, -1)}
                                    <span className='bt-tick__digit' style={{ color: DIGIT_COLORS[lastDigit || 0] }}>
                                        {currentTick.slice(-1)}
                                    </span>
                                </span>
                            </div>
                        )}

                        <div className='bt-dstats'>
                            <h4 className='bt-dstats__title'>Digit Statistics (Last {tickCount} ticks)</h4>
                            <div className='bt-dstats__grid'>
                                {digitFreqs.map((freq, i) => (
                                    <div key={i} className={`bt-dstat ${lastDigit === i ? 'bt-dstat--active' : ''} ${prediction === i && showPrediction ? 'bt-dstat--sel' : ''}`}>
                                        <div className='bt-dstat__circle' style={{ borderColor: DIGIT_COLORS[i], boxShadow: lastDigit === i ? `0 0 10px ${DIGIT_COLORS[i]}` : 'none' }}>
                                            <span className='bt-dstat__num'>{i}</span>
                                        </div>
                                        <span className='bt-dstat__pct' style={{ color: DIGIT_COLORS[i] }}>{freq}%</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className='bt-actions'>
                            {isExecuting ? (
                                <>
                                    <div className='bt-actions__progress'>
                                        <div className='bt-actions__spinner' />
                                        Executing {batchProgress.current} / {batchProgress.total}
                                    </div>
                                    <button className='bt-actions__btn bt-actions__btn--stop' onClick={stopBatch}>
                                        Stop Batch
                                    </button>
                                </>
                            ) : (
                                <>
                                    <button
                                        className='bt-actions__btn bt-actions__btn--a'
                                        onClick={() => executeBatch(currentContract.a)}
                                        disabled={!isAuthorized || (requiresBarrier(currentContract.a) && !isDigitValid(prediction, currentContract.a))}
                                    >
                                        ★ {currentContract.aLabel}
                                    </button>
                                    <button
                                        className='bt-actions__btn bt-actions__btn--b'
                                        onClick={() => executeBatch(currentContract.b)}
                                        disabled={!isAuthorized || (requiresBarrier(currentContract.b) && !isDigitValid(prediction, currentContract.b))}
                                    >
                                        ★ {currentContract.bLabel}
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>

                <div className='bt-right'>
                    <div className='bt-info'>
                        <div className='bt-info__card'>
                            <span className='bt-info__label'>Balance</span>
                            <span className='bt-info__value'>{balance.toFixed(2)} {currency}</span>
                        </div>
                        <div className='bt-info__card'>
                            <span className='bt-info__label'>Total P/L</span>
                            <span className={`bt-info__value ${totalPnL >= 0 ? 'bt-info__value--profit' : 'bt-info__value--loss'}`}>
                                {totalPnL >= 0 ? '+' : ''}{totalPnL.toFixed(2)}
                            </span>
                        </div>
                        <div className='bt-info__card'>
                            <span className='bt-info__label'>Win Rate</span>
                            <span className='bt-info__value'>{winRate}%</span>
                        </div>
                        <div className='bt-info__card bt-info__card--split'>
                            <div>
                                <span className='bt-info__label'>Wins</span>
                                <span className='bt-info__value bt-info__value--profit'>{wins}</span>
                            </div>
                            <div>
                                <span className='bt-info__label'>Losses</span>
                                <span className='bt-info__value bt-info__value--loss'>{losses}</span>
                            </div>
                        </div>
                    </div>

                    <div className='bt-log'>
                        <div className='bt-log__header'>
                            <h4 className='bt-log__title'>Trade Log ({trades.length})</h4>
                            <button className='bt-log__clear' onClick={resetStats}>Clear All</button>
                        </div>
                        <div className='bt-log__list'>
                            {trades.length === 0 && (
                                <div className='bt-log__empty'>No trades yet. Connect and configure to start batch trading.</div>
                            )}
                            {trades.map((trade, idx) => (
                                <div key={`${trade.id}-${idx}`} className={`bt-log__item bt-log__item--${trade.status}`}>
                                    <div className='bt-log__item-left'>
                                        <span className={`bt-log__item-badge bt-log__item-badge--${trade.status}`}>
                                            {trade.status === 'pending' ? '⏳' : trade.status === 'won' ? '✓' : trade.status === 'lost' ? '✗' : '!'}
                                        </span>
                                        <div>
                                            <span className='bt-log__item-type'>{TYPE_LABELS[trade.contractType] || trade.contractType}</span>
                                            <span className='bt-log__item-time'>{trade.time}</span>
                                        </div>
                                    </div>
                                    <div className='bt-log__item-right'>
                                        <span className='bt-log__item-stake'>-{trade.buyPrice.toFixed(2)}</span>
                                        {trade.status === 'pending' && <span className='bt-log__item-pending'>Pending...</span>}
                                        {trade.status === 'won' && <span className='bt-log__item-profit'>+{trade.profit.toFixed(2)}</span>}
                                        {trade.status === 'lost' && <span className='bt-log__item-loss'>{trade.profit.toFixed(2)}</span>}
                                        {trade.status === 'error' && <span className='bt-log__item-err'>{trade.error}</span>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default BatchTrader;
