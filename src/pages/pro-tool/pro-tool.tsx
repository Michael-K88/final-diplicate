import React, { useEffect, useRef, useState, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import { generateDerivApiInstance, V2GetActiveToken, V2GetActiveClientId } from '@/external/bot-skeleton/services/api/appId';
import { tradeOptionToBuy } from '@/external/bot-skeleton/services/tradeEngine/utils/helpers';
import { useStore } from '@/hooks/useStore';
import './pro-tool.scss';

interface SymbolInfo {
  symbol: string;
  display_name: string;
}

interface TradeResult {
  id: string;
  type: string;
  profit?: number;
  status: 'open' | 'won' | 'lost';
  timestamp: number;
}

const ProTool = observer(() => {
  const { transactions } = useStore();

  const apiRef = useRef<any>(null);
  const tickStreamIdRef = useRef<string | null>(null);
  const tickListenerRef = useRef<((evt: MessageEvent) => void) | null>(null);
  const autoTradeRef = useRef<boolean>(false);
  const stopFlagRef = useRef(false);
  const currencyRef = useRef<string>('USD');

  const [symbols, setSymbols] = useState<SymbolInfo[]>([]);
  const [symbol, setSymbol] = useState('');
  const [accountCurrency, setAccountCurrency] = useState('USD');
  const [lastDigit, setLastDigit] = useState<number | null>(null);
  const [digitHistory, setDigitHistory] = useState<number[]>([]);
  const [ticksProcessed, setTicksProcessed] = useState(0);
  const [currentPrice, setCurrentPrice] = useState<string>('');
  const [isConnected, setIsConnected] = useState(false);

  const [activeCard, setActiveCard] = useState<string>('digits');
  const [status, setStatus] = useState('');
  const [isTrading, setIsTrading] = useState(false);
  const [tradeResults, setTradeResults] = useState<TradeResult[]>([]);

  const [stake, setStake] = useState(1);
  const [ticks, setTicks] = useState(5);
  const [digitMode, setDigitMode] = useState('over');
  const [predictionDigit, setPredictionDigit] = useState(7);
  const [parity, setParity] = useState('even');
  const [direction, setDirection] = useState('rise');
  const [matchType, setMatchType] = useState('matches');
  const [matchDigit, setMatchDigit] = useState(4);
  const [isAutoTrading, setIsAutoTrading] = useState(false);

  const digitCounts = React.useMemo(() => {
    const counts = new Array(10).fill(0);
    digitHistory.forEach(d => counts[d]++);
    return counts;
  }, [digitHistory]);

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
        if (syn[0]?.symbol) {
          setSymbol(syn[0].symbol);
          startTicks(syn[0].symbol);
        }
        setIsConnected(true);
      } catch (e: any) {
        setStatus(`Connection error: ${e?.message || 'Unknown'}`);
      }
    };
    init();
    return () => {
      stopFlagRef.current = true;
      autoTradeRef.current = false;
      stopTicks();
      apiRef.current?.disconnect?.();
    };
  }, []);

  const startTicks = async (sym: string) => {
    stopTicks();
    setDigitHistory([]);
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
            setDigitHistory(prev => [...prev.slice(-49), digit]);
            setTicksProcessed(prev => prev + 1);
          }
        } catch (e) { console.warn('tick parse error', e); }
      };
      tickListenerRef.current = onMsg;
      apiRef.current?.connection?.addEventListener('message', onMsg);
    } catch (e: any) {
      setStatus(`Tick error: ${e?.message || 'Unknown'}`);
    }
  };

  const stopTicks = () => {
    if (tickListenerRef.current && apiRef.current?.connection) {
      apiRef.current.connection.removeEventListener('message', tickListenerRef.current);
      tickListenerRef.current = null;
    }
    if (tickStreamIdRef.current && apiRef.current) {
      apiRef.current.forget?.({ forget: tickStreamIdRef.current });
      tickStreamIdRef.current = null;
    }
  };

  const handleSymbolChange = (newSymbol: string) => {
    setSymbol(newSymbol);
    startTicks(newSymbol);
  };

  const authorizeIfNeeded = async () => {
    const token = V2GetActiveToken();
    const clientId = V2GetActiveClientId();
    if (!token || !clientId) throw new Error('Please log in to trade');
    try {
      const { authorize, error } = await apiRef.current.authorize(token);
      if (error) throw error;
      const cur = authorize?.currency || 'USD';
      currencyRef.current = cur;
      setAccountCurrency(cur);
      return authorize;
    } catch (e: any) {
      throw new Error(`Auth failed: ${e?.message || 'Unknown'}`);
    }
  };

  const purchaseContract = async (tradeType: string, prediction?: number) => {
    await authorizeIfNeeded();
    const activeCurrency = currencyRef.current;
    const trade_option: any = {
      amount: Number(stake),
      basis: 'stake',
      contractTypes: [tradeType],
      currency: activeCurrency,
      duration: Number(ticks),
      duration_unit: 't',
      symbol,
    };
    if (prediction !== undefined) trade_option.prediction = Number(prediction);

    const buy_req = tradeOptionToBuy(tradeType, trade_option);
    const { buy, error } = await apiRef.current.buy(buy_req);
    if (error) throw error;

    const resultId = String(buy?.contract_id || Date.now());
    const newResult: TradeResult = {
      id: resultId,
      type: tradeType,
      status: 'open',
      timestamp: Date.now(),
    };
    setTradeResults(prev => [newResult, ...prev.slice(0, 19)]);

    try {
      const symbolDisplay = symbols.find(s => s.symbol === symbol)?.display_name || symbol;
      transactions.onBotContractEvent({
        contract_id: buy?.contract_id,
        transaction_ids: { buy: buy?.transaction_id },
        buy_price: buy?.buy_price,
        currency: activeCurrency,
        contract_type: tradeType as any,
        underlying: symbol,
        display_name: symbolDisplay,
        date_start: Math.floor(Date.now() / 1000),
        status: 'open',
      } as any);
    } catch (e) { console.warn('transaction log error', e); }

    try {
      const res = await apiRef.current.send({
        proposal_open_contract: 1,
        contract_id: buy?.contract_id,
        subscribe: 1,
      });
      const { error: subErr, proposal_open_contract: pocInit, subscription: sub } = res || {};
      if (subErr) throw subErr;
      let pocSubId: string | null = sub?.id || null;
      const targetId = String(buy?.contract_id || '');

      if (pocInit && String(pocInit?.contract_id || '') === targetId) {
        transactions.onBotContractEvent(pocInit);
      }

      const onMsg = (evt: MessageEvent) => {
        try {
          const data = JSON.parse(evt.data as any);
          if (data?.msg_type === 'proposal_open_contract') {
            const poc = data.proposal_open_contract;
            if (!pocSubId && data?.subscription?.id) pocSubId = data.subscription.id;
            if (String(poc?.contract_id || '') === targetId) {
              transactions.onBotContractEvent(poc);
              if (poc?.is_sold || poc?.status === 'sold') {
                if (pocSubId) apiRef.current?.forget?.({ forget: pocSubId });
                apiRef.current?.connection?.removeEventListener('message', onMsg);
                const profit = Number(poc?.profit || 0);
                setTradeResults(prev =>
                  prev.map(r => r.id === resultId ? { ...r, profit, status: profit > 0 ? 'won' : 'lost' } : r)
                );
              }
            }
          }
        } catch (e) { console.warn('poc parse error', e); }
      };
      apiRef.current?.connection?.addEventListener('message', onMsg);
    } catch (e) { console.warn('poc subscribe error', e); }

    return buy;
  };

  const getTradeParams = useCallback(() => {
    switch (activeCard) {
      case 'digits':
        return { type: digitMode === 'over' ? 'DIGITOVER' : 'DIGITUNDER', prediction: predictionDigit };
      case 'evenodd':
        return { type: parity === 'even' ? 'DIGITEVEN' : 'DIGITODD' };
      case 'risefall':
        return { type: direction === 'rise' ? 'CALL' : 'PUT' };
      case 'matchdiff':
        return { type: matchType === 'matches' ? 'DIGITMATCH' : 'DIGITDIFF', prediction: matchDigit };
      default:
        return { type: 'DIGITOVER', prediction: 7 };
    }
  }, [activeCard, digitMode, predictionDigit, parity, direction, matchType, matchDigit]);

  const handleTradeOnce = async () => {
    if (isTrading) return;
    setIsTrading(true);
    setStatus('Placing trade...');
    try {
      const params = getTradeParams();
      await purchaseContract(params.type, params.prediction);
      setStatus('Trade placed successfully');
    } catch (e: any) {
      setStatus(`Error: ${e?.message || 'Trade failed'}`);
    } finally {
      setIsTrading(false);
    }
  };

  const handleAutoTrade = async () => {
    if (isAutoTrading) {
      stopFlagRef.current = true;
      autoTradeRef.current = false;
      setIsAutoTrading(false);
      setStatus('Auto trade stopped');
      return;
    }
    setIsAutoTrading(true);
    stopFlagRef.current = false;
    autoTradeRef.current = true;
    setStatus('Auto trading started...');

    const runLoop = async () => {
      while (autoTradeRef.current && !stopFlagRef.current) {
        try {
          setIsTrading(true);
          const params = getTradeParams();
          await purchaseContract(params.type, params.prediction);
          setStatus('Auto trade: waiting for result...');
          await new Promise(resolve => setTimeout(resolve, (ticks + 2) * 1000));
        } catch (e: any) {
          setStatus(`Auto trade error: ${e?.message || 'Failed'}`);
          await new Promise(resolve => setTimeout(resolve, 3000));
        } finally {
          setIsTrading(false);
        }
      }
      setIsAutoTrading(false);
      setIsTrading(false);
    };
    runLoop();
  };

  const wonCount = tradeResults.filter(r => r.status === 'won').length;
  const lostCount = tradeResults.filter(r => r.status === 'lost').length;
  const totalProfit = tradeResults.reduce((sum, r) => sum + (r.profit || 0), 0);

  const cards = [
    { key: 'digits', label: 'Over/Under', color: '#003366' },
    { key: 'evenodd', label: 'Even/Odd', color: '#7c3aed' },
    { key: 'risefall', label: 'Rise/Fall', color: '#059669' },
    { key: 'matchdiff', label: 'Match/Differ', color: '#dc2626' },
  ];

  return (
    <div className="pro-tool">
      <div className="pro-tool__header">
        <h1>Pro Tool</h1>
        <p>Advanced trading interface for quick execution</p>
      </div>

      <div className="pro-tool__market-bar">
        <div className="market-bar__left">
          <select
            className="market-bar__select"
            value={symbol}
            onChange={(e) => handleSymbolChange(e.target.value)}
          >
            {symbols.map(s => (
              <option key={s.symbol} value={s.symbol}>{s.display_name}</option>
            ))}
          </select>
          <div className="market-bar__connection">
            <span className={`connection-dot ${isConnected ? 'connected' : ''}`} />
            {isConnected ? 'Live' : 'Connecting...'}
          </div>
        </div>
        <div className="market-bar__right">
          <div className="market-bar__price">
            <span className="price-label">Price</span>
            <span className="price-value">{currentPrice || '---'}</span>
          </div>
          <div className="market-bar__digit">
            <span className="digit-label">Last Digit</span>
            <span className="digit-value">{lastDigit !== null ? lastDigit : '-'}</span>
          </div>
          <div className="market-bar__ticks">
            <span className="ticks-label">Ticks</span>
            <span className="ticks-value">{ticksProcessed}</span>
          </div>
        </div>
      </div>

      <div className="pro-tool__digit-chart">
        <div className="digit-chart__title">Digit Distribution</div>
        <div className="digit-chart__circles">
          {(() => {
            const total = digitHistory.length || 1;
            const uniqueSorted = [...new Set(digitCounts)].filter(v => v > 0).sort((a, b) => b - a);
            const len = uniqueSorted.length;
            return digitCounts.map((count, i) => {
            const pct = Math.round((count / total) * 100);
            const circumference = 2 * Math.PI * 28;
            const offset = circumference - (pct / 100) * circumference;
            let colorClass = 'default';
            if (count > 0 && len >= 2) {
              const rankFromTop = uniqueSorted.indexOf(count);
              const rankFromBottom = len - 1 - rankFromTop;
              if (rankFromTop === 0) colorClass = 'green';
              else if (rankFromBottom === 0) colorClass = 'red';
              else if (rankFromTop === 1) colorClass = 'blue';
              else if (rankFromBottom === 1) colorClass = 'yellow';
            }
            return (
              <div key={i} className={`digit-circle ${lastDigit === i ? 'pulse' : ''}`}>
                <svg className="digit-circle__svg" viewBox="0 0 64 64">
                  <circle className="digit-circle__track" cx="32" cy="32" r="28" />
                  <circle
                    className={`digit-circle__fill ${colorClass}`}
                    cx="32" cy="32" r="28"
                    strokeDasharray={circumference}
                    strokeDashoffset={offset}
                  />
                </svg>
                <div className="digit-circle__content">
                  <span className="digit-circle__digit">{i}</span>
                  <span className={`digit-circle__pct ${colorClass}`}>{pct}%</span>
                </div>
              </div>
            );
          });
          })()}
        </div>
      </div>

      <div className="pro-tool__content">
        <div className="pro-tool__cards">
          <div className="card-tabs">
            {cards.map(c => (
              <button
                key={c.key}
                className={`card-tab ${activeCard === c.key ? 'active' : ''}`}
                style={activeCard === c.key ? { borderColor: c.color, color: c.color } : {}}
                onClick={() => setActiveCard(c.key)}
              >
                {c.label}
              </button>
            ))}
          </div>

          <div className="card-body">
            {activeCard === 'digits' && (
              <div className="trade-form">
                <div className="form-row">
                  <div className="form-group">
                    <label>Trade Type</label>
                    <div className="toggle-group">
                      <button className={`toggle-btn ${digitMode === 'over' ? 'active' : ''}`} onClick={() => setDigitMode('over')}>Over</button>
                      <button className={`toggle-btn ${digitMode === 'under' ? 'active' : ''}`} onClick={() => setDigitMode('under')}>Under</button>
                    </div>
                  </div>
                  <div className="form-group">
                    <label>Prediction</label>
                    <div className="digit-selector">
                      {[0,1,2,3,4,5,6,7,8,9].map(d => (
                        <button key={d} className={`digit-btn ${predictionDigit === d ? 'active' : ''}`} onClick={() => setPredictionDigit(d)}>{d}</button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeCard === 'evenodd' && (
              <div className="trade-form">
                <div className="form-row">
                  <div className="form-group">
                    <label>Select Type</label>
                    <div className="toggle-group">
                      <button className={`toggle-btn ${parity === 'even' ? 'active' : ''}`} onClick={() => setParity('even')}>Even</button>
                      <button className={`toggle-btn ${parity === 'odd' ? 'active' : ''}`} onClick={() => setParity('odd')}>Odd</button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeCard === 'risefall' && (
              <div className="trade-form">
                <div className="form-row">
                  <div className="form-group">
                    <label>Direction</label>
                    <div className="toggle-group">
                      <button className={`toggle-btn rise ${direction === 'rise' ? 'active' : ''}`} onClick={() => setDirection('rise')}>▲ Rise</button>
                      <button className={`toggle-btn fall ${direction === 'fall' ? 'active' : ''}`} onClick={() => setDirection('fall')}>▼ Fall</button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeCard === 'matchdiff' && (
              <div className="trade-form">
                <div className="form-row">
                  <div className="form-group">
                    <label>Type</label>
                    <div className="toggle-group">
                      <button className={`toggle-btn ${matchType === 'matches' ? 'active' : ''}`} onClick={() => setMatchType('matches')}>Matches</button>
                      <button className={`toggle-btn ${matchType === 'differs' ? 'active' : ''}`} onClick={() => setMatchType('differs')}>Differs</button>
                    </div>
                  </div>
                  <div className="form-group">
                    <label>Target Digit</label>
                    <div className="digit-selector">
                      {[0,1,2,3,4,5,6,7,8,9].map(d => (
                        <button key={d} className={`digit-btn ${matchDigit === d ? 'active' : ''}`} onClick={() => setMatchDigit(d)}>{d}</button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="trade-params">
              <div className="param-group">
                <label>Stake ({accountCurrency})</label>
                <input type="number" min={0.35} step={0.01} value={stake} onChange={(e) => setStake(Number(e.target.value))} />
              </div>
              <div className="param-group">
                <label>Ticks</label>
                <input type="number" min={1} max={10} value={ticks} onChange={(e) => setTicks(Number(e.target.value))} />
              </div>
            </div>

            <div className="trade-actions">
              <button className="trade-btn trade-btn--once" onClick={handleTradeOnce} disabled={isTrading || !symbol}>
                {isTrading && !isAutoTrading ? 'Trading...' : 'Trade Once'}
              </button>
              <button
                className={`trade-btn ${isAutoTrading ? 'trade-btn--stop' : 'trade-btn--auto'}`}
                onClick={handleAutoTrade}
                disabled={!symbol || (isTrading && !isAutoTrading)}
              >
                {isAutoTrading ? 'Stop Auto' : 'Auto Trade'}
              </button>
            </div>

            {status && (
              <div className={`trade-status ${status.includes('Error') || status.includes('error') ? 'error' : 'success'}`}>
                {status}
              </div>
            )}
          </div>
        </div>

        <div className="pro-tool__stats">
          <div className="stats-header">Trade Results</div>
          <div className="stats-summary">
            <div className="stat-item won">
              <span className="stat-number">{wonCount}</span>
              <span className="stat-label">Won</span>
            </div>
            <div className="stat-item lost">
              <span className="stat-number">{lostCount}</span>
              <span className="stat-label">Lost</span>
            </div>
            <div className={`stat-item ${totalProfit >= 0 ? 'profit' : 'loss'}`}>
              <span className="stat-number">{totalProfit >= 0 ? '+' : ''}{totalProfit.toFixed(2)}</span>
              <span className="stat-label">P/L ({accountCurrency})</span>
            </div>
          </div>
          <div className="results-list">
            {tradeResults.length === 0 && (
              <div className="results-empty">No trades yet. Place a trade to see results.</div>
            )}
            {tradeResults.map(r => (
              <div key={r.id} className={`result-item ${r.status}`}>
                <span className="result-type">{r.type}</span>
                <span className={`result-status ${r.status}`}>
                  {r.status === 'open' ? '⏳' : r.status === 'won' ? '✓' : '✗'}
                  {r.status !== 'open' && r.profit !== undefined && ` ${r.profit >= 0 ? '+' : ''}${r.profit.toFixed(2)}`}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
});

export default ProTool;
