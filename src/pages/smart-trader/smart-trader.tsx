import React, { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { generateDerivApiInstance, V2GetActiveClientId, V2GetActiveToken } from '@/external/bot-skeleton/services/api/appId';
import { contract_stages } from '@/constants/contract-stage';
import { useStore } from '@/hooks/useStore';
import './smart-trader.scss';

const TRADE_TYPES = [
    { value: 'DIGITOVER', label: 'Digits Over', icon: '⬆' },
    { value: 'DIGITUNDER', label: 'Digits Under', icon: '⬇' },
    { value: 'DIGITEVEN', label: 'Even', icon: '⚡' },
    { value: 'DIGITODD', label: 'Odd', icon: '🔶' },
    { value: 'DIGITMATCH', label: 'Matches', icon: '🎯' },
    { value: 'DIGITDIFF', label: 'Differs', icon: '↔' },
];

const tradeOptionToBuy = (contract_type: string, trade_option: any) => {
    const buy: any = {
        buy: '1',
        price: trade_option.amount,
        parameters: {
            amount: trade_option.amount,
            basis: trade_option.basis,
            contract_type,
            currency: trade_option.currency,
            duration: trade_option.duration,
            duration_unit: trade_option.duration_unit,
            symbol: trade_option.symbol,
        },
    };
    if (trade_option.prediction !== undefined) {
        buy.parameters.selected_tick = trade_option.prediction;
    }
    if (!['TICKLOW', 'TICKHIGH'].includes(contract_type) && trade_option.prediction !== undefined) {
        buy.parameters.barrier = trade_option.prediction;
    }
    return buy;
};

const SmartTrader = observer(() => {
    const store = useStore();
    const { run_panel, transactions } = store;

    const apiRef = useRef<any>(null);
    const tickStreamIdRef = useRef<string | null>(null);
    const messageHandlerRef = useRef<((evt: MessageEvent) => void) | null>(null);
    const lastOutcomeWasLossRef = useRef(false);

    const [is_authorized, setIsAuthorized] = useState(false);
    const [account_currency, setAccountCurrency] = useState<string>('USD');
    const [symbols, setSymbols] = useState<Array<{ symbol: string; display_name: string }>>([]);

    const [symbol, setSymbol] = useState<string>('');
    const [tradeType, setTradeType] = useState<string>('DIGITOVER');
    const [ticks, setTicks] = useState<number>(1);
    const [stake, setStake] = useState<number>(0.5);
    const [baseStake, setBaseStake] = useState<number>(0.5);
    const [ouPredPreLoss, setOuPredPreLoss] = useState<number>(5);
    const [ouPredPostLoss, setOuPredPostLoss] = useState<number>(5);
    const [mdPrediction, setMdPrediction] = useState<number>(5);
    const [martingaleMultiplier, setMartingaleMultiplier] = useState<number>(1.0);

    const [digits, setDigits] = useState<number[]>([]);
    const [lastDigit, setLastDigit] = useState<number | null>(null);
    const [currentPrice, setCurrentPrice] = useState<string>('');
    const [ticksProcessed, setTicksProcessed] = useState<number>(0);

    const [status, setStatus] = useState<string>('');
    const [altEvenOdd, setAltEvenOdd] = useState<boolean>(false);
    const [altOnLoss, setAltOnLoss] = useState<boolean>(false);
    const [consecWins, setConsecWins] = useState<number>(0);
    const [consecLosses, setConsecLosses] = useState<number>(0);
    const [totalProfit, setTotalProfit] = useState<number>(0);
    const [tradeCount, setTradeCount] = useState<number>(0);

    const [is_running, setIsRunning] = useState(false);
    const stopFlagRef = useRef<boolean>(false);

    const getHintClass = (d: number) => {
        if (tradeType === 'DIGITEVEN') return d % 2 === 0 ? 'win' : 'lose';
        if (tradeType === 'DIGITODD') return d % 2 !== 0 ? 'win' : 'lose';
        if (tradeType === 'DIGITOVER' || tradeType === 'DIGITUNDER') {
            const activePred = lastOutcomeWasLossRef.current ? ouPredPostLoss : ouPredPreLoss;
            if (tradeType === 'DIGITOVER') return d > Number(activePred) ? 'win' : d < Number(activePred) ? 'lose' : 'neutral';
            if (tradeType === 'DIGITUNDER') return d < Number(activePred) ? 'win' : d > Number(activePred) ? 'lose' : 'neutral';
        }
        if (tradeType === 'DIGITMATCH') return d === mdPrediction ? 'win' : 'lose';
        if (tradeType === 'DIGITDIFF') return d !== mdPrediction ? 'win' : 'lose';
        return '';
    };

    useEffect(() => {
        const api = generateDerivApiInstance();
        apiRef.current = api;
        const init = async () => {
            try {
                const { active_symbols, error: asErr } = await api.send({ active_symbols: 'brief' });
                if (asErr) throw asErr;
                const syn = (active_symbols || [])
                    .filter((s: any) => /synthetic/i.test(s.market) || /^R_/.test(s.symbol))
                    .map((s: any) => ({ symbol: s.symbol, display_name: s.display_name }));
                setSymbols(syn);
                if (!symbol && syn[0]?.symbol) setSymbol(syn[0].symbol);
                if (syn[0]?.symbol) startTicks(syn[0].symbol);
            } catch (e: any) {
                console.error('SmartTrader init error', e);
                setStatus(e?.message || 'Failed to load symbols');
            }
        };
        init();
        return () => {
            try {
                if (tickStreamIdRef.current) {
                    apiRef.current?.forget({ forget: tickStreamIdRef.current });
                    tickStreamIdRef.current = null;
                }
                if (messageHandlerRef.current) {
                    apiRef.current?.connection?.removeEventListener('message', messageHandlerRef.current);
                    messageHandlerRef.current = null;
                }
                api?.disconnect?.();
            } catch { /* cleanup */ }
        };
    }, []);

    const authorizeIfNeeded = async () => {
        if (is_authorized) return;
        const token = V2GetActiveToken();
        if (!token) {
            setStatus('No token found. Please log in and select an account.');
            throw new Error('No token');
        }
        const { authorize, error } = await apiRef.current.authorize(token);
        if (error) {
            setStatus(`Authorization error: ${error.message || error.code}`);
            throw error;
        }
        setIsAuthorized(true);
        const loginid = authorize?.loginid || V2GetActiveClientId();
        setAccountCurrency(authorize?.currency || 'USD');
        try {
            store?.client?.setLoginId?.(loginid || '');
            store?.client?.setCurrency?.(authorize?.currency || 'USD');
            store?.client?.setIsLoggedIn?.(true);
        } catch {}
    };

    const stopTicks = () => {
        try {
            if (tickStreamIdRef.current) {
                apiRef.current?.forget({ forget: tickStreamIdRef.current });
                tickStreamIdRef.current = null;
            }
            if (messageHandlerRef.current) {
                apiRef.current?.connection?.removeEventListener('message', messageHandlerRef.current);
                messageHandlerRef.current = null;
            }
        } catch {}
    };

    const startTicks = async (sym: string) => {
        stopTicks();
        setDigits([]);
        setLastDigit(null);
        setTicksProcessed(0);
        setCurrentPrice('');
        try {
            const { subscription, error } = await apiRef.current.send({ ticks: sym, subscribe: 1 });
            if (error) throw error;
            if (subscription?.id) tickStreamIdRef.current = subscription.id;
            const onMsg = (evt: MessageEvent) => {
                try {
                    const data = JSON.parse(evt.data as any);
                    if (data?.msg_type === 'tick' && data?.tick?.symbol === sym) {
                        const quote = String(data.tick.quote);
                        const digit = Number(quote.slice(-1));
                        setCurrentPrice(quote);
                        setLastDigit(digit);
                        setDigits(prev => [...prev.slice(-19), digit]);
                        setTicksProcessed(prev => prev + 1);
                    }
                } catch { /* parse error */ }
            };
            messageHandlerRef.current = onMsg;
            apiRef.current?.connection?.addEventListener('message', onMsg);
        } catch (e: any) {
            console.error('startTicks error', e);
        }
    };

    const purchaseOnce = async () => {
        await authorizeIfNeeded();
        const trade_option: any = {
            amount: Number(stake),
            basis: 'stake',
            contractTypes: [tradeType],
            currency: account_currency,
            duration: Number(ticks),
            duration_unit: 't',
            symbol,
        };
        if (tradeType === 'DIGITOVER' || tradeType === 'DIGITUNDER') {
            trade_option.prediction = Number(lastOutcomeWasLossRef.current ? ouPredPostLoss : ouPredPreLoss);
        } else if (tradeType === 'DIGITMATCH' || tradeType === 'DIGITDIFF') {
            trade_option.prediction = Number(mdPrediction);
        }
        const buy_req = tradeOptionToBuy(tradeType, trade_option);
        const { buy, error } = await apiRef.current.buy(buy_req);
        if (error) throw error;
        setStatus(`Purchased: ${buy?.longcode || 'Contract'} (ID: ${buy?.contract_id})`);
        return buy;
    };

    const onRun = async () => {
        setStatus('');
        setIsRunning(true);
        stopFlagRef.current = false;
        run_panel.toggleDrawer(true);
        run_panel.setActiveTabIndex(1);
        run_panel.run_id = `smart-${Date.now()}`;
        run_panel.setIsRunning(true);
        run_panel.setContractStage(contract_stages.STARTING);

        try {
            let lossStreak = 0;
            let step = 0;
            baseStake !== stake && setBaseStake(stake);
            while (!stopFlagRef.current) {
                const effectiveStake = step > 0 ? Number((baseStake * Math.pow(martingaleMultiplier, step)).toFixed(2)) : baseStake;
                setStake(effectiveStake);
                const isOU = tradeType === 'DIGITOVER' || tradeType === 'DIGITUNDER';
                if (isOU) lastOutcomeWasLossRef.current = lossStreak > 0;

                const buy = await purchaseOnce();
                setTradeCount(prev => prev + 1);

                try {
                    const symbol_display = symbols.find(s => s.symbol === symbol)?.display_name || symbol;
                    transactions.onBotContractEvent({
                        contract_id: buy?.contract_id,
                        transaction_ids: { buy: buy?.transaction_id },
                        buy_price: buy?.buy_price,
                        currency: account_currency,
                        contract_type: tradeType as any,
                        underlying: symbol,
                        display_name: symbol_display,
                        date_start: Math.floor(Date.now() / 1000),
                        status: 'open',
                    } as any);
                } catch {}

                run_panel.setHasOpenContract(true);
                run_panel.setContractStage(contract_stages.PURCHASE_SENT);

                try {
                    const res = await apiRef.current.send({
                        proposal_open_contract: 1,
                        contract_id: buy?.contract_id,
                        subscribe: 1,
                    });
                    const { error, proposal_open_contract: pocInit, subscription } = res || {};
                    if (error) throw error;

                    let pocSubId: string | null = subscription?.id || null;
                    const targetId = String(buy?.contract_id || '');

                    if (pocInit && String(pocInit?.contract_id || '') === targetId) {
                        transactions.onBotContractEvent(pocInit);
                        run_panel.setHasOpenContract(true);
                    }

                    const onMsg = (evt: MessageEvent) => {
                        try {
                            const data = JSON.parse(evt.data as any);
                            if (data?.msg_type === 'proposal_open_contract') {
                                const poc = data.proposal_open_contract;
                                if (!pocSubId && data?.subscription?.id) pocSubId = data.subscription.id;
                                if (String(poc?.contract_id || '') === targetId) {
                                    transactions.onBotContractEvent(poc);
                                    run_panel.setHasOpenContract(true);
                                    if (poc?.is_sold || poc?.status === 'sold') {
                                        run_panel.setContractStage(contract_stages.CONTRACT_CLOSED);
                                        run_panel.setHasOpenContract(false);
                                        if (pocSubId) apiRef.current?.forget?.({ forget: pocSubId });
                                        apiRef.current?.connection?.removeEventListener('message', onMsg);
                                        const profit = Number(poc?.profit || 0);
                                        setTotalProfit(prev => prev + profit);
                                        if (profit > 0) {
                                            lastOutcomeWasLossRef.current = false;
                                            lossStreak = 0;
                                            step = 0;
                                            setStake(baseStake);
                                            setConsecWins(prev => prev + 1);
                                            setConsecLosses(0);
                                        } else {
                                            lastOutcomeWasLossRef.current = true;
                                            lossStreak++;
                                            step = Math.min(step + 1, 50);
                                            setConsecLosses(prev => prev + 1);
                                            setConsecWins(0);
                                        }
                                    }
                                }
                            }
                        } catch {}
                    };
                    apiRef.current?.connection?.addEventListener('message', onMsg);
                } catch (subErr) {
                    console.error('subscribe poc error', subErr);
                }

                await new Promise(res => setTimeout(res, 500));
            }
        } catch (e: any) {
            console.error('SmartTrader run loop error', e);
            const msg = e?.message || e?.error?.message || 'Something went wrong';
            setStatus(`Error: ${msg}`);
        } finally {
            setIsRunning(false);
            run_panel.setIsRunning(false);
            run_panel.setHasOpenContract(false);
            run_panel.setContractStage(contract_stages.NOT_RUNNING);
        }
    };

    const onStop = () => {
        stopFlagRef.current = true;
        setIsRunning(false);
    };

    const selectedTradeType = TRADE_TYPES.find(t => t.value === tradeType);
    const balance = Number(store?.client?.balance || 0).toFixed(2);
    const needsPrediction = tradeType === 'DIGITOVER' || tradeType === 'DIGITUNDER';
    const needsMatchPred = tradeType === 'DIGITMATCH' || tradeType === 'DIGITDIFF';

    return (
        <div className='smart-trader'>
            <div className='st-header'>
                <div className='st-header__left'>
                    <div className='st-header__icon'>⚡</div>
                    <div>
                        <h1 className='st-header__title'>Smart Trader</h1>
                        <p className='st-header__subtitle'>Automated digit trading with strategy</p>
                    </div>
                </div>
                <div className='st-header__right'>
                    <div className='st-header__balance'>
                        <span className='st-header__balance-label'>Balance</span>
                        <span className='st-header__balance-value'>{balance} {account_currency}</span>
                    </div>
                    <div className={`st-header__status ${ticksProcessed > 0 ? 'live' : ''}`}>
                        <span className='st-header__status-dot' />
                        {ticksProcessed > 0 ? 'Live' : 'Connecting'}
                    </div>
                </div>
            </div>

            <div className='st-body'>
                <div className='st-sidebar'>
                    <div className='st-section'>
                        <div className='st-section__title'>Market</div>
                        <select
                            className='st-select'
                            value={symbol}
                            onChange={e => { setSymbol(e.target.value); startTicks(e.target.value); }}
                        >
                            {symbols.map(s => (
                                <option key={s.symbol} value={s.symbol}>{s.display_name}</option>
                            ))}
                        </select>
                    </div>

                    <div className='st-section'>
                        <div className='st-section__title'>Trade Type</div>
                        <div className='st-trade-types'>
                            {TRADE_TYPES.map(t => (
                                <button
                                    key={t.value}
                                    className={`st-trade-type ${tradeType === t.value ? 'active' : ''}`}
                                    onClick={() => setTradeType(t.value)}
                                >
                                    <span className='st-trade-type__icon'>{t.icon}</span>
                                    <span className='st-trade-type__label'>{t.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className='st-section'>
                        <div className='st-section__title'>Parameters</div>
                        <div className='st-params'>
                            <div className='st-param'>
                                <label>Duration (Ticks)</label>
                                <div className='st-param__control'>
                                    <button onClick={() => setTicks(Math.max(1, ticks - 1))}>-</button>
                                    <input type='number' min={1} max={10} value={ticks} onChange={e => setTicks(Number(e.target.value))} />
                                    <button onClick={() => setTicks(Math.min(10, ticks + 1))}>+</button>
                                </div>
                            </div>
                            <div className='st-param'>
                                <label>Stake ({account_currency})</label>
                                <div className='st-param__control'>
                                    <button onClick={() => setStake(Math.max(0.35, +(stake - 0.5).toFixed(2)))}>-</button>
                                    <input type='number' step='0.01' min={0.35} value={stake} onChange={e => setStake(Number(e.target.value))} />
                                    <button onClick={() => setStake(+(stake + 0.5).toFixed(2))}>+</button>
                                </div>
                            </div>
                        </div>
                    </div>

                    {needsPrediction && (
                        <div className='st-section'>
                            <div className='st-section__title'>Prediction Digits</div>
                            <div className='st-params'>
                                <div className='st-param'>
                                    <label>Pre-Loss</label>
                                    <div className='st-digit-picker'>
                                        {[0,1,2,3,4,5,6,7,8,9].map(d => (
                                            <button key={d} className={`st-digit-btn ${ouPredPreLoss === d ? 'active' : ''}`}
                                                onClick={() => setOuPredPreLoss(d)}>{d}</button>
                                        ))}
                                    </div>
                                </div>
                                <div className='st-param'>
                                    <label>Post-Loss</label>
                                    <div className='st-digit-picker'>
                                        {[0,1,2,3,4,5,6,7,8,9].map(d => (
                                            <button key={d} className={`st-digit-btn ${ouPredPostLoss === d ? 'active' : ''}`}
                                                onClick={() => setOuPredPostLoss(d)}>{d}</button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {needsMatchPred && (
                        <div className='st-section'>
                            <div className='st-section__title'>Prediction Digit</div>
                            <div className='st-digit-picker'>
                                {[0,1,2,3,4,5,6,7,8,9].map(d => (
                                    <button key={d} className={`st-digit-btn ${mdPrediction === d ? 'active' : ''}`}
                                        onClick={() => setMdPrediction(d)}>{d}</button>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className='st-section'>
                        <div className='st-section__title'>Strategy</div>
                        <div className='st-param'>
                            <label>Martingale Multiplier</label>
                            <div className='st-param__control'>
                                <button onClick={() => setMartingaleMultiplier(Math.max(1, +(martingaleMultiplier - 0.1).toFixed(1)))}>-</button>
                                <input type='number' min={1} step='0.1' value={martingaleMultiplier}
                                    onChange={e => setMartingaleMultiplier(Math.max(1, Number(e.target.value)))} />
                                <button onClick={() => setMartingaleMultiplier(+(martingaleMultiplier + 0.1).toFixed(1))}>+</button>
                            </div>
                        </div>
                        <div className='st-toggles'>
                            <label className='st-toggle'>
                                <span>Alternate Even/Odd</span>
                                <div className={`st-toggle__switch ${altEvenOdd ? 'on' : ''}`}
                                    onClick={() => setAltEvenOdd(!altEvenOdd)}>
                                    <div className='st-toggle__knob' />
                                </div>
                            </label>
                            <label className='st-toggle'>
                                <span>Alternate on Loss</span>
                                <div className={`st-toggle__switch ${altOnLoss ? 'on' : ''}`}
                                    onClick={() => setAltOnLoss(!altOnLoss)}>
                                    <div className='st-toggle__knob' />
                                </div>
                            </label>
                        </div>
                    </div>

                    <div className='st-actions'>
                        {!is_running ? (
                            <>
                                <button className='st-btn st-btn--trade' onClick={onRun} disabled={!symbol}>
                                    Trade Once
                                </button>
                                <button className='st-btn st-btn--auto' onClick={onRun} disabled={!symbol}>
                                    Auto Trade
                                </button>
                            </>
                        ) : (
                            <button className='st-btn st-btn--stop' onClick={onStop}>
                                Stop Trading
                            </button>
                        )}
                    </div>
                </div>

                <div className='st-main'>
                    <div className='st-live-panel'>
                        <div className='st-live-panel__header'>
                            <div className='st-live-panel__title'>Live Digit Stream</div>
                            <div className='st-live-panel__info'>
                                <span className='st-live-panel__price'>{currentPrice || '---'}</span>
                                <span className='st-live-panel__ticks'>{ticksProcessed} ticks</span>
                            </div>
                        </div>
                        <div className='st-digit-stream'>
                            {digits.length === 0 && (
                                <div className='st-digit-stream__empty'>Waiting for market data...</div>
                            )}
                            {digits.map((d, idx) => (
                                <div
                                    key={`${idx}-${d}`}
                                    className={`st-digit-cell ${getHintClass(d)} ${idx === digits.length - 1 ? 'latest' : ''}`}
                                >
                                    {d}
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className='st-stats-grid'>
                        <div className='st-stat-card st-stat-card--profit'>
                            <div className='st-stat-card__label'>Total P/L</div>
                            <div className={`st-stat-card__value ${totalProfit >= 0 ? 'positive' : 'negative'}`}>
                                {totalProfit >= 0 ? '+' : ''}{totalProfit.toFixed(2)}
                            </div>
                        </div>
                        <div className='st-stat-card'>
                            <div className='st-stat-card__label'>Last Digit</div>
                            <div className='st-stat-card__value highlight'>{lastDigit ?? '-'}</div>
                        </div>
                        <div className='st-stat-card'>
                            <div className='st-stat-card__label'>Win Streak</div>
                            <div className='st-stat-card__value positive'>{consecWins}</div>
                        </div>
                        <div className='st-stat-card'>
                            <div className='st-stat-card__label'>Loss Streak</div>
                            <div className='st-stat-card__value negative'>{consecLosses}</div>
                        </div>
                        <div className='st-stat-card'>
                            <div className='st-stat-card__label'>Trades</div>
                            <div className='st-stat-card__value'>{tradeCount}</div>
                        </div>
                        <div className='st-stat-card'>
                            <div className='st-stat-card__label'>Strategy</div>
                            <div className='st-stat-card__value small'>{selectedTradeType?.label || '-'}</div>
                        </div>
                    </div>

                    {status && (
                        <div className={`st-status ${/error|fail/i.test(status) ? 'error' : 'info'}`}>
                            {status}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
});

export default SmartTrader;
