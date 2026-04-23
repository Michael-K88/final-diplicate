import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import { runInAction } from 'mobx';
import { generateDerivApiInstance, V2GetActiveToken } from '@/external/bot-skeleton/services/api/appId';
import { useStore } from '@/hooks/useStore';
import { contract_stages } from '@/constants/contract-stage';
import './batch-trader.scss';

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

const CONTRACT_MAP: Record<string, { a: string; b: string; aLabel: string; bLabel: string }> = {
    odd_even: { a: 'DIGITODD', b: 'DIGITEVEN', aLabel: 'Odd', bLabel: 'Even' },
    over_under: { a: 'DIGITOVER', b: 'DIGITUNDER', aLabel: 'Over', bLabel: 'Under' },
    matches_differs: { a: 'DIGITMATCH', b: 'DIGITDIFF', aLabel: 'Matches', bLabel: 'Differs' },
    rise_fall: { a: 'CALL', b: 'PUT', aLabel: 'Rise', bLabel: 'Fall' },
};

const DIGIT_BASE_COLORS = [
    '#3b82f6', '#eab308', '#8b5cf6', '#f97316', '#6b7280',
    '#06b6d4', '#14b8a6', '#3b82f6', '#ef4444', '#22c55e',
];

const RANK_COLORS = { most: '#22c55e', second: '#3b82f6', secondLast: '#eab308', least: '#ef4444' };

const APP_ID = 128207;
const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

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
    const { transactions, run_panel, client } = useStore();

    const [activeNav, setActiveNav] = useState('trade');
    const [authStatus, setAuthStatus] = useState<'idle' | 'connecting' | 'ready' | 'error'>('idle');
    const [authError, setAuthError] = useState('');
    const [balance, setBalance] = useState(0);
    const [currency, setCurrency] = useState('USD');
    const [loginId, setLoginId] = useState('');

    const [market, setMarket] = useState(MARKETS[12].symbol); // Vol 100
    const [contractGroup, setContractGroup] = useState('over_under');
    const [duration, setDuration] = useState(1);
    const [stakeStr, setStakeStr] = useState('0.35');
    const stake = Math.max(0.35, parseFloat(stakeStr) || 0.35);
    const [bulkCountStr, setBulkCountStr] = useState('1');
    const bulkCount = Math.max(1, parseInt(bulkCountStr) || 1);
    const [delayMs, setDelayMs] = useState(0);
    const [prediction, setPrediction] = useState<number>(4);

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
    const [tradeErrors, setTradeErrors] = useState<string[]>([]);

    const [stopLoss, setStopLoss] = useState(0);
    const [takeProfit, setTakeProfit] = useState(0);

    const apiRef = useRef<any>(null);
    const tickWsRef = useRef<WebSocket | null>(null);
    const stopBatchRef = useRef(false);
    const pnlRef = useRef(0);
    const riskRef = useRef({ stopLoss: 0, takeProfit: 0 });
    riskRef.current = { stopLoss, takeProfit };
    const delayMsRef = useRef(0);
    delayMsRef.current = delayMs;
    const settledContractsRef = useRef<Set<string>>(new Set());
    const pipSizeRef = useRef<number>(2);
    const authorizedRef = useRef(false);
    const currencyRef = useRef('USD');
    const loginIdRef = useRef('');

    const isReady = authStatus === 'ready';

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
        const counts = Array(10).fill(0);
        history.forEach(d => counts[d]++);
        const total = history.length || 1;
        setDigitFreqs(counts.map(c => parseFloat(((c / total) * 100).toFixed(1))));
    };

    useEffect(() => {
        if (tickWsRef.current) { tickWsRef.current.close(); tickWsRef.current = null; }
        digitHistoryRef.current = [];
        setDigitFreqs(Array(10).fill(0));
        setCurrentTick('');
        setLastDigit(null);
        setTickCount(0);

        let historyLoaded = false;
        const ws = new WebSocket(WS_URL);
        ws.onopen = () => {
            ws.send(JSON.stringify({ ticks_history: market, count: 1000, end: 'latest', style: 'ticks' }));
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
                    setCurrentTick(lastPrice);
                    setLastDigit(parseInt(lastPrice.slice(-1)));
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
        return () => { ws.close(); };
    }, [market]);

    // Create and authorize the trading API once on mount
    useEffect(() => {
        const initApi = async () => {
            const token = V2GetActiveToken();
            if (!token) {
                setAuthStatus('error');
                setAuthError('Please log in to your Deriv account first.');
                return;
            }
            setAuthStatus('connecting');
            try {
                const api = generateDerivApiInstance();
                apiRef.current = api;
                const { authorize, error } = await api.authorize(token);
                if (error) throw new Error((error as any).message || 'Authorization failed');
                authorizedRef.current = true;
                currencyRef.current = authorize.currency || 'USD';
                loginIdRef.current = authorize.loginid || '';
                setAuthStatus('ready');
                setBalance(parseFloat(authorize.balance));
                setCurrency(authorize.currency || 'USD');
                setLoginId(authorize.loginid || '');
                // Set on shared ClientStore so TransactionsStore can key by loginid
                runInAction(() => {
                    client.setLoginId(authorize.loginid || '');
                    client.setIsLoggedIn(true);
                });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Re-authorize the API session to keep it fresh (handles session expiry)
    const ensureAuthorized = useCallback(async () => {
        const token = V2GetActiveToken();
        if (!token) throw new Error('Not logged in. Please log in and try again.');
        const api = apiRef.current;
        if (!api) throw new Error('API not initialized');
        const { authorize, error } = await api.authorize(token);
        if (error) throw new Error((error as any).message || 'Auth failed');
        authorizedRef.current = true;
        currencyRef.current = authorize.currency || 'USD';
        loginIdRef.current = authorize.loginid || '';
        // Ensure loginid is current in the shared store
        runInAction(() => {
            client.setLoginId(authorize.loginid || '');
        });
        return authorize;
    }, [client]);

    // ---------------------------------------------------------------------------
    // Core buy helper with automatic retry (up to 3 attempts, 300 ms back-off).
    // This handles transient API rate-limit and network errors silently.
    // ---------------------------------------------------------------------------
    const buyOne = useCallback(async (contractType: string, api: any): Promise<any> => {
        const needBarrier = requiresBarrier(contractType);
        const stakeVal = Math.max(0.35, parseFloat(stakeStr) || 0.35);
        const cur = currencyRef.current;

        const attempt = async (): Promise<any> => {
            const proposalReq: any = {
                proposal: 1,
                amount: stakeVal,
                basis: 'stake',
                contract_type: contractType,
                currency: cur,
                duration,
                duration_unit: 't',
                symbol: market,
            };
            if (needBarrier) proposalReq.barrier = prediction.toString();

            const proposalRes = await api.send(proposalReq);
            if (proposalRes.error) throw new Error(proposalRes.error.message || 'Proposal failed');
            if (!proposalRes.proposal?.id) throw new Error('No proposal returned from API');

            const buyRes = await api.send({
                buy: proposalRes.proposal.id,
                price: proposalRes.proposal.ask_price,
            });
            if (buyRes.error) throw new Error(buyRes.error.message || 'Buy failed');
            if (!buyRes.buy?.contract_id) throw new Error('No contract_id in buy response');

            return buyRes.buy;
        };

        // Retry up to 3 times with 300 ms back-off between attempts
        const MAX_RETRIES = 3;
        let lastErr: Error = new Error('Unknown error');
        for (let i = 0; i < MAX_RETRIES; i++) {
            try {
                return await attempt();
            } catch (err: any) {
                lastErr = err;
                if (i < MAX_RETRIES - 1) {
                    // Back-off: 300ms, 600ms before retries 2 and 3
                    await new Promise(r => setTimeout(r, 300 * (i + 1)));
                }
            }
        }
        throw lastErr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [market, duration, stakeStr, prediction]);

    // ---------------------------------------------------------------------------
    // Settlement watcher: subscribes to a contract and resolves when it settles.
    // ---------------------------------------------------------------------------
    const watchSettlement = useCallback((
        contractId: string,
        buy: any,
        api: any,
        loginid: string,
        onSettled: (poc: any) => void,
    ): Promise<void> => {
        return new Promise<void>((resolve) => {
            let pocSubId: string | null = null;
            let done = false;

            const finish = (poc: any) => {
                if (done) return;
                done = true;
                api.connection?.removeEventListener?.('message', onMsg);
                if (pocSubId) api.send({ forget: pocSubId }).catch(() => {});
                onSettled(poc);
                resolve();
            };

            const onMsg = (evt: MessageEvent) => {
                try {
                    const data = JSON.parse(evt.data as string);
                    if (data?.msg_type === 'proposal_open_contract') {
                        if (!pocSubId && data?.subscription?.id) pocSubId = data.subscription.id;
                        const poc = data.proposal_open_contract;
                        if (String(poc?.contract_id || '') === contractId) {
                            if (poc?.is_sold || poc?.status === 'sold' || poc?.is_expired) {
                                finish(poc);
                            }
                        }
                    }
                } catch (_) { /* ignore */ }
            };

            // Register listener BEFORE subscribe to avoid missing fast-settling 1-tick contracts
            api.connection?.addEventListener?.('message', onMsg);

            api.send({ proposal_open_contract: 1, contract_id: buy.contract_id, subscribe: 1 })
                .then((pocRes: any) => {
                    if (pocRes?.subscription?.id) pocSubId = pocRes.subscription.id;
                    if (pocRes?.proposal_open_contract) {
                        const poc = pocRes.proposal_open_contract;
                        if (poc?.is_sold || poc?.status === 'sold' || poc?.is_expired) {
                            finish(poc);
                        }
                    }
                })
                .catch(() => { /* listener still running */ });

            // Safety timeout — resolve after 90 s even if no settlement arrives
            setTimeout(() => { if (!done) { done = true; api.connection?.removeEventListener?.('message', onMsg); resolve(); } }, 90_000);
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const executeBatch = useCallback(async (contractType: string) => {
        if (!isReady) {
            setTradeErrors([authError || 'Please log in to your Deriv account to trade.']);
            return;
        }
        if (isExecuting) return;

        setIsExecuting(true);
        setTradeErrors([]);
        stopBatchRef.current = false;
        setBatchProgress({ current: 0, total: bulkCount });

        // Re-authorize before batch to keep session fresh
        try {
            await ensureAuthorized();
        } catch (e: any) {
            setTradeErrors([`Auth error: ${e.message}`]);
            setIsExecuting(false);
            return;
        }

        const api = apiRef.current;
        const loginid = loginIdRef.current;
        const stakeVal = Math.max(0.35, parseFloat(stakeStr) || 0.35);

        // Mirror exactly what the real bot does on start:
        // setIsRunning(true) must come FIRST to prevent the reaction
        // (which watches !is_running) from resetting contract_stage back to NOT_RUNNING.
        runInAction(() => {
            run_panel.setIsRunning(true);
            run_panel.toggleDrawer(true);
            run_panel.setActiveTabIndex(1); // 0=Summary, 1=Transactions, 2=Journal
            run_panel.setContractStage(contract_stages.STARTING);
        });

        // -----------------------------------------------------------------------
        // PHASE 1: Purchase the selected contract `bulkCount` times.
        // When a delay is set (Risk tab), trades run one at a time with that
        // delay between them.  Without a delay they run in concurrent groups of
        // 5 to stay within Deriv's request-rate limit.
        // -----------------------------------------------------------------------
        const CONCURRENCY = 5;
        const successfulBuys: Array<{ buy: any; contractId: string }> = [];
        let completedCount = 0;
        const delay = delayMsRef.current;

        setBatchProgress({ current: 0, total: bulkCount });

        const recordBuy = (buy: any) => {
            const contractId = String(buy.contract_id);
            successfulBuys.push({ buy, contractId });
            setTrades(prev => [{
                id: contractId,
                contractType,
                buyPrice: parseFloat(buy.buy_price),
                status: 'pending' as const,
                profit: 0,
                time: new Date().toLocaleTimeString(),
            }, ...prev]);
        };

        const recordError = (tradeIndex: number, reason: any) => {
            const errMsg = (reason as any)?.message || 'Trade failed';
            setTradeErrors(prev => [...prev.slice(-4), `Trade ${tradeIndex + 1}: ${errMsg}`]);
            setTrades(prev => [{
                id: `err-${Date.now()}-${tradeIndex}`,
                contractType,
                buyPrice: stakeVal,
                status: 'error' as const,
                profit: 0,
                error: errMsg,
                time: new Date().toLocaleTimeString(),
            }, ...prev]);
        };

        // Helper: build a proposal request for the chosen contract type
        const buildProposalReq = () => {
            const req: any = {
                proposal: 1,
                amount: stakeVal,
                basis: 'stake',
                contract_type: contractType,
                currency: currencyRef.current,
                duration,
                duration_unit: 't',
                symbol: market,
            };
            if (requiresBarrier(contractType)) req.barrier = prediction.toString();
            return req;
        };

        if (delay > 0) {
            // Sequential mode: one contract at a time with delay in between
            for (let i = 0; i < bulkCount; i++) {
                if (stopBatchRef.current) break;
                const [result] = await Promise.allSettled([buyOne(contractType, api)]);
                if (result.status === 'fulfilled') recordBuy(result.value);
                else recordError(i, result.reason);
                completedCount++;
                setBatchProgress({ current: completedCount, total: bulkCount });
                if (i < bulkCount - 1 && !stopBatchRef.current) {
                    await new Promise(res => setTimeout(res, delay));
                }
            }
        } else {
            // ---------------------------------------------------------------
            // 2-phase same-tick mode:
            //   Phase A – collect ALL proposals in parallel (grouped to stay
            //             within Deriv's rate limit).
            //   Phase B – fire ALL buy requests at the same instant so every
            //             contract lands on the same entry/exit tick.
            // ---------------------------------------------------------------

            // Phase A: gather proposals
            const allProposalResults: Array<PromiseSettledResult<any>> = [];
            for (let offset = 0; offset < bulkCount; offset += CONCURRENCY) {
                if (stopBatchRef.current) break;
                const groupSize = Math.min(CONCURRENCY, bulkCount - offset);
                const group = await Promise.allSettled(
                    Array.from({ length: groupSize }, () => api.send(buildProposalReq()))
                );
                allProposalResults.push(...group);
            }

            // Separate valid proposals from failed ones
            type ValidEntry = { proposalValue: any; originalIndex: number };
            const validProposals: ValidEntry[] = [];
            allProposalResults.forEach((r, i) => {
                if (r.status === 'rejected' || (r as PromiseFulfilledResult<any>).value?.error) {
                    const errMsg = r.status === 'rejected'
                        ? (r.reason?.message || 'Proposal failed')
                        : ((r as PromiseFulfilledResult<any>).value.error.message || 'Proposal failed');
                    recordError(i, new Error(errMsg));
                    completedCount++;
                } else {
                    validProposals.push({ proposalValue: (r as PromiseFulfilledResult<any>).value, originalIndex: i });
                }
            });

            setBatchProgress({ current: completedCount, total: bulkCount });

            if (validProposals.length > 0 && !stopBatchRef.current) {
                // Phase B: fire ALL buy requests simultaneously → same tick for all
                const buyResults = await Promise.allSettled(
                    validProposals.map(({ proposalValue }) =>
                        api.send({
                            buy: proposalValue.proposal.id,
                            price: proposalValue.proposal.ask_price,
                        })
                    )
                );

                buyResults.forEach((result, idx) => {
                    const originalIndex = validProposals[idx].originalIndex;
                    if (result.status === 'fulfilled') {
                        const buyRes = result.value;
                        if (buyRes?.error) {
                            recordError(originalIndex, new Error(buyRes.error.message || 'Buy failed'));
                        } else if (buyRes?.buy?.contract_id) {
                            recordBuy(buyRes.buy);
                        } else {
                            recordError(originalIndex, new Error('No contract_id in buy response'));
                        }
                    } else {
                        recordError(originalIndex, result.reason);
                    }
                    completedCount++;
                });

                setBatchProgress({ current: completedCount, total: bulkCount });
            }
        }

        // -----------------------------------------------------------------------
        // PHASE 2: Watch all settlements concurrently (non-blocking per contract)
        // -----------------------------------------------------------------------
        await Promise.allSettled(
            successfulBuys.map(({ buy, contractId }) =>
                watchSettlement(contractId, buy, api, loginid, (poc) => {
                    if (settledContractsRef.current.has(contractId)) return;
                    settledContractsRef.current.add(contractId);

                    const profit = parseFloat(poc.profit ?? '0') || 0;
                    pnlRef.current += profit;
                    setTotalPnL(pnlRef.current);
                    setTrades(prev => prev.map(t =>
                        t.id === contractId ? { ...t, status: profit >= 0 ? 'won' : 'lost', profit } : t
                    ));
                    if (profit >= 0) setWins(w => w + 1);
                    else setLosses(l => l + 1);
                    if (poc.balance_after) setBalance(parseFloat(poc.balance_after));

                    // One row per settled trade in the right-panel Transactions tab
                    try {
                        runInAction(() => {
                            if (loginid && client.loginid !== loginid) client.setLoginId(loginid);
                            transactions.onBotContractEvent(poc);
                        });
                    } catch (_) { /* ignore */ }

                    const risk = riskRef.current;
                    if (risk.stopLoss > 0 && pnlRef.current <= -risk.stopLoss) stopBatchRef.current = true;
                    if (risk.takeProfit > 0 && pnlRef.current >= risk.takeProfit) stopBatchRef.current = true;
                })
            )
        );

        setIsExecuting(false);
        // Give the user a few seconds to see the results, then release the running state
        setTimeout(() => {
            runInAction(() => {
                run_panel.setIsRunning(false);
                run_panel.setHasOpenContract(false);
                run_panel.setContractStage(contract_stages.NOT_RUNNING);
            });
        }, 5000);
    }, [isReady, isExecuting, bulkCount, stakeStr, buyOne, watchSettlement, authError, ensureAuthorized, run_panel, client, transactions]);

    const stopBatch = useCallback(() => { stopBatchRef.current = true; }, []);

    const resetAll = useCallback(() => {
        setTrades([]);
        setTotalPnL(0);
        setWins(0);
        setLosses(0);
        setTradeErrors([]);
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

    const digitRankColors = useMemo(() => digitFreqs.map((_, i) => getDigitRankColor(digitFreqs, i)), [digitFreqs]);

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
                        {authStatus === 'connecting' && <span className='bbt-auth__info'>Connecting...</span>}
                        {authStatus === 'ready' && <span className='bbt-auth__info'>{loginId} • {balance.toFixed(2)} {currency}</span>}
                        {authStatus === 'error' && <span className='bbt-auth__error'>⚠ {authError}</span>}
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
                                        <input
                                            type='text' inputMode='numeric' className='bbt-input'
                                            value={duration}
                                            onChange={e => { const v = parseInt(e.target.value.replace(/\D/g, '')); if (!isNaN(v) && v >= 1 && v <= 10) setDuration(v); }}
                                        />
                                    </div>
                                    <div>
                                        <label className='bbt-label'>Stake ({currency})</label>
                                        <input
                                            type='text' inputMode='decimal' className='bbt-input'
                                            value={stakeStr}
                                            onChange={e => setStakeStr(e.target.value.replace(/[^0-9.]/g, ''))}
                                            onBlur={() => { const v = parseFloat(stakeStr); setStakeStr(String(isNaN(v) || v < 0.35 ? '0.35' : v)); }}
                                            placeholder='0.35'
                                        />
                                    </div>
                                    <div>
                                        <label className='bbt-label'>Bulk Trades</label>
                                        <input
                                            type='text' inputMode='numeric' className='bbt-input'
                                            value={bulkCountStr}
                                            onChange={e => setBulkCountStr(e.target.value.replace(/\D/g, ''))}
                                            onBlur={() => { const n = parseInt(bulkCountStr); setBulkCountStr(String(isNaN(n) || n < 1 ? 1 : Math.min(n, 100))); }}
                                            placeholder='1'
                                        />
                                    </div>
                                </div>

                                {showPrediction && (
                                    <div className='bbt-pred-row'>
                                        <label className='bbt-label'>Prediction Digit</label>
                                        <div className='bbt-pred-stepper'>
                                            <button
                                                className='bbt-pred-stepper__btn'
                                                onClick={() => setPrediction(p => Math.max(0, p - 1))}
                                                disabled={prediction <= 0}
                                            >−</button>
                                            <span className='bbt-pred-stepper__val'>{prediction}</span>
                                            <button
                                                className='bbt-pred-stepper__btn'
                                                onClick={() => setPrediction(p => Math.min(9, p + 1))}
                                                disabled={prediction >= 9}
                                            >+</button>
                                        </div>
                                    </div>
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
                                        ) : <span className='bbt-curtick__waiting'>Connecting...</span>}
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
                                                    className={`bbt-digit ${isActive ? 'bbt-digit--active' : ''} ${isSelected ? 'bbt-digit--sel' : ''} ${showPrediction ? 'bbt-digit--clickable' : ''}`}
                                                    onClick={() => { if (showPrediction) setPrediction(i); }}
                                                >
                                                    <svg className='bbt-digit__ring' viewBox='0 0 50 50'>
                                                        <circle cx='25' cy='25' r='22' fill='#2d3748' stroke='#4a5568' strokeWidth='2.5' />
                                                        <circle cx='25' cy='25' r='22' fill='none' stroke={ringColor} strokeWidth='3'
                                                            strokeDasharray={circumference} strokeDashoffset={dashOffset}
                                                            strokeLinecap='round' transform='rotate(-90 25 25)'
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

                                {tradeErrors.length > 0 && (
                                    <div className='bbt-trade-errors'>
                                        {tradeErrors.map((e, i) => <div key={i} className='bbt-trade-error'>{e}</div>)}
                                        <button className='bbt-clear-errors' onClick={() => setTradeErrors([])}>✕ Clear</button>
                                    </div>
                                )}

                                <div className='bbt-preview'>
                                    <span className='bbt-preview__label'>Will execute:</span>
                                    <span className='bbt-preview__spec'>
                                        {bulkCount}×{' '}
                                        <strong>{currentContract.aLabel}{showPrediction ? ` ${prediction}` : ''}</strong>
                                        {' '}or{' '}
                                        <strong>{currentContract.bLabel}{showPrediction ? ` ${prediction}` : ''}</strong>
                                        {' · '}{duration} tick{duration > 1 ? 's' : ''}
                                        {' · '}{stake.toFixed(2)} {currency} each
                                        {bulkCount > 1 && (
                                            <span className='bbt-preview__bulk'> ({bulkCount} contracts per click)</span>
                                        )}
                                    </span>
                                </div>

                                <div className='bbt-actions'>
                                    {isExecuting && (
                                        <div className='bbt-actions__progress'>
                                            <div className='bbt-actions__spinner' />
                                            {batchProgress.current < batchProgress.total
                                                ? `Buying trade ${batchProgress.current + 1} of ${batchProgress.total}...`
                                                : `All ${batchProgress.total} trade${batchProgress.total > 1 ? 's' : ''} placed — awaiting settlement...`}
                                        </div>
                                    )}
                                    <div className='bbt-actions__row'>
                                        <button
                                            className='bbt-actions__btn bbt-actions__btn--a'
                                            onClick={() => executeBatch(currentContract.a)}
                                            disabled={isExecuting || (requiresBarrier(currentContract.a) && isReady && !isDigitValid(prediction, currentContract.a))}
                                        >
                                            <span className='bbt-actions__btn-icon'>⬆</span>
                                            <span className='bbt-actions__btn-label'>{currentContract.aLabel}{showPrediction ? ` ${prediction}` : ''}</span>
                                            <span className='bbt-actions__btn-pct'>{aPercent}%</span>
                                        </button>
                                        <button
                                            className='bbt-actions__btn bbt-actions__btn--b'
                                            onClick={() => executeBatch(currentContract.b)}
                                            disabled={isExecuting || (requiresBarrier(currentContract.b) && isReady && !isDigitValid(prediction, currentContract.b))}
                                        >
                                            <span className='bbt-actions__btn-icon'>⬇</span>
                                            <span className='bbt-actions__btn-label'>{currentContract.bLabel}{showPrediction ? ` ${prediction}` : ''}</span>
                                            <span className='bbt-actions__btn-pct'>{bPercent}%</span>
                                        </button>
                                    </div>
                                    <button
                                        className={`bbt-actions__stop ${!isExecuting ? 'bbt-actions__stop--disabled' : ''}`}
                                        onClick={stopBatch} disabled={!isExecuting}
                                    >
                                        ⏹ Stop
                                    </button>
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
                                    <div className='bbt-stat-card'>
                                        <span className='bbt-stat-card__label'>Total Trades</span>
                                        <span className='bbt-stat-card__value'>{wins + losses}</span>
                                    </div>
                                    <div className='bbt-stat-card'>
                                        <span className='bbt-stat-card__label'>Per Batch</span>
                                        <span className='bbt-stat-card__value'>{bulkCount}</span>
                                    </div>
                                </div>
                                <button className='bbt-log-clear' style={{ marginTop: '16px' }} onClick={resetAll}>Reset Stats</button>
                            </div>
                        </div>
                    )}

                    {activeNav === 'log' && (
                        <div className='bbt-log-panel'>
                            <div className='bbt-card'>
                                <div className='bbt-log-header'>
                                    <h2 className='bbt-card__heading'>Trade Log</h2>
                                    <button className='bbt-log-clear' onClick={resetAll}>Clear All</button>
                                </div>
                                <div className='bbt-log-list'>
                                    {trades.length === 0 ? (
                                        <div className='bbt-log-empty'>No trades yet. Execute a batch to see results here.</div>
                                    ) : trades.map(t => (
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
                                                <span className='bbt-log-item__stake'>{t.buyPrice.toFixed(2)} {currency}</span>
                                                {t.status === 'won' && <span className='bbt-log-item__profit'>+{t.profit.toFixed(2)}</span>}
                                                {t.status === 'lost' && <span className='bbt-log-item__loss'>{t.profit.toFixed(2)}</span>}
                                                {t.status === 'pending' && <span className='bbt-log-item__pending'>Pending...</span>}
                                                {t.status === 'error' && <span className='bbt-log-item__err'>{t.error}</span>}
                                            </div>
                                        </div>
                                    ))}
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
                                        <label className='bbt-label'>Stop Loss ({currency})</label>
                                        <input type='text' inputMode='decimal' className='bbt-input' value={stopLoss}
                                            onChange={e => setStopLoss(parseFloat(e.target.value.replace(/[^0-9.]/g, '')) || 0)}
                                            placeholder='0' />
                                        <span className='bbt-risk-hint'>Stops when total loss reaches this amount (0 = disabled)</span>
                                    </div>
                                    <div>
                                        <label className='bbt-label'>Take Profit ({currency})</label>
                                        <input type='text' inputMode='decimal' className='bbt-input' value={takeProfit}
                                            onChange={e => setTakeProfit(parseFloat(e.target.value.replace(/[^0-9.]/g, '')) || 0)}
                                            placeholder='0' />
                                        <span className='bbt-risk-hint'>Stops when total profit reaches this amount (0 = disabled)</span>
                                    </div>
                                    <div>
                                        <label className='bbt-label'>Delay Between Trades (ms)</label>
                                        <input type='text' inputMode='numeric' className='bbt-input' value={delayMs}
                                            onChange={e => setDelayMs(parseInt(e.target.value.replace(/\D/g, '')) || 0)}
                                            placeholder='0' />
                                        <span className='bbt-risk-hint'>Milliseconds to wait between trades (0 = no delay)</span>
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
