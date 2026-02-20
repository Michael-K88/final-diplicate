import React, { lazy, Suspense, useEffect } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { useLocation, useNavigate } from 'react-router-dom';
import ChunkLoader from '@/components/loader/chunk-loader';
import { generateOAuthURL } from '@/components/shared';
import DesktopWrapper from '@/components/shared_ui/desktop-wrapper';
import Dialog from '@/components/shared_ui/dialog';
import MobileWrapper from '@/components/shared_ui/mobile-wrapper';
import Tabs from '@/components/shared_ui/tabs/tabs';
import TradingViewModal from '@/components/trading-view-chart/trading-view-modal';
import { DBOT_TABS, TAB_IDS } from '@/constants/bot-contents';
import { api_base, updateWorkspaceName } from '@/external/bot-skeleton';
import { CONNECTION_STATUS } from '@/external/bot-skeleton/services/api/observables/connection-status-stream';
import { isDbotRTL } from '@/external/bot-skeleton/utils/workspace';
import { useOauth2 } from '@/hooks/auth/useOauth2';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';
import useTMB from '@/hooks/useTMB';
import { handleOidcAuthFailure } from '@/utils/auth-utils';
import {
    LabelPairedChartLineCaptionRegularIcon,
    LabelPairedPuzzlePieceTwoCaptionBoldIcon,
    LabelPairedSignalCaptionRegularIcon,
} from '@deriv/quill-icons/LabelPaired';
import { LegacyChartsIcon, LegacyIndicatorsIcon } from '@deriv/quill-icons/Legacy';
import { requestOidcAuthentication } from '@deriv-com/auth-client';
import { Localize, localize } from '@deriv-com/translations';
import { useDevice } from '@deriv-com/ui';
import RunPanel from '../../components/run-panel';
import ChartModal from '../chart/chart-modal';
import RunStrategy from '../dashboard/run-strategy';
import './main.scss';

const TradingView = lazy(() => import('../tradingview'));
const AnalysisTool = lazy(() => import('../analysis-tool'));
const Signals = lazy(() => import('../signals'));
const CopyTrading = lazy(() => import('../copy-trading'));
const SmartTrader = lazy(() => import('../smart-trader'));
const ProTool = lazy(() => import('../pro-tool'));
const Dtrader = lazy(() => import('../dtrader'));
// Import FreeBots directly instead of lazy loading for faster access
import FreeBots from '../free-bots';

const AppWrapper = observer(() => {
    const { connectionStatus } = useApiBase();
    const { dashboard, load_modal, run_panel, quick_strategy, summary_card } = useStore();
    const {
        active_tab,
        active_tour,
        setActiveTab,
        setWebSocketState,
        setActiveTour,
        setTourDialogVisibility,
    } = dashboard;
    const { dashboard_strategies } = load_modal;
    const {
        is_dialog_open,
        is_drawer_open,
        dialog_options,
        onCancelButtonClick,
        onCloseDialog,
        onOkButtonClick,
        stopBot,
    } = run_panel;
    const { is_open } = quick_strategy;
    const { cancel_button_text, ok_button_text, title, message, dismissable, is_closed_on_cancel } = dialog_options as {
        [key: string]: string;
    };
    const { clear } = summary_card;
    const { BOT_BUILDER } = DBOT_TABS;
    const init_render = React.useRef(true);
    const hash = ['bot_builder', 'free_bots', 'copy_trading', 'smart_trader', 'dtrader'];
    const { isDesktop } = useDevice();
    const location = useLocation();
    const navigate = useNavigate();
    // Removed tab shadow states to fix mobile edge fading issue

    let tab_value: number | string = active_tab;
    const GetHashedValue = (tab: number) => {
        tab_value = location.hash?.split('#')[1];
        if (!tab_value) return tab;
        return Number(hash.indexOf(String(tab_value)));
    };
    const active_hash_tab = GetHashedValue(active_tab);

    const { onRenderTMBCheck, isTmbEnabled } = useTMB();

    // Removed intersection observer for tab shadows to fix mobile edge fading

    React.useEffect(() => {
        if (connectionStatus !== CONNECTION_STATUS.OPENED) {
            const is_bot_running = document.getElementById('db-animation__stop-button') !== null;
            if (is_bot_running) {
                clear();
                stopBot();
                api_base.setIsRunning(false);
                setWebSocketState(false);
            }
        }
    }, [clear, connectionStatus, setWebSocketState, stopBot]);

    // Removed updateTabShadowsHeight function to fix mobile edge fading

    React.useEffect(() => {
        // Removed updateTabShadowsHeight call to fix mobile edge fading

        if (is_open) {
            setTourDialogVisibility(false);
        }

        if (init_render.current) {
            setActiveTab(Number(active_hash_tab));
            if (!isDesktop) handleTabChange(Number(active_hash_tab));
            init_render.current = false;
        } else {
            navigate(`#${hash[active_tab] || hash[0]}`);
        }
        if (active_tour !== '') {
            setActiveTour('');
        }

        // Prevent scrolling when tutorial tab is active (only on mobile)
        const mainElement = document.querySelector('.main__container');
        if (active_tab === DBOT_TABS.TUTORIAL && !isDesktop) {
            document.body.style.overflow = 'hidden';
            if (mainElement instanceof HTMLElement) {
                mainElement.classList.add('no-scroll');
            }
        } else {
            document.body.style.overflow = '';
            if (mainElement instanceof HTMLElement) {
                mainElement.classList.remove('no-scroll');
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active_tab]);

    React.useEffect(() => {
        const trashcan_init_id = setTimeout(() => {
            if (active_tab === BOT_BUILDER && Blockly?.derivWorkspace?.trashcan) {
                const trashcanY = window.innerHeight - 250;
                let trashcanX;
                if (is_drawer_open) {
                    trashcanX = isDbotRTL() ? 380 : window.innerWidth - 460;
                } else {
                    trashcanX = isDbotRTL() ? 20 : window.innerWidth - 100;
                }
                Blockly?.derivWorkspace?.trashcan?.setTrashcanPosition(trashcanX, trashcanY);
            }
        }, 100);

        return () => {
            clearTimeout(trashcan_init_id); // Clear the timeout on unmount
        };
        //eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active_tab, is_drawer_open]);

    useEffect(() => {
        let timer: ReturnType<typeof setTimeout>;
        if (dashboard_strategies.length > 0) {
            // Needed to pass this to the Callback Queue as on tab changes
            // document title getting override by 'Bot | Deriv' only
            timer = setTimeout(() => {
                updateWorkspaceName();
            });
        }
        return () => {
            if (timer) clearTimeout(timer);
        };
    }, [dashboard_strategies, active_tab]);

    const handleTabChange = React.useCallback(
        (tab_index: number) => {
            setActiveTab(tab_index);
            const el_id = TAB_IDS[tab_index];
            if (el_id) {
                const el_tab = document.getElementById(el_id);
                setTimeout(() => {
                    el_tab?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
                }, 10);
            }
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [active_tab]
    );

    const { isOAuth2Enabled } = useOauth2();
    const handleLoginGeneration = async () => {
        if (!isOAuth2Enabled) {
            window.location.replace(generateOAuthURL());
        } else {
            const getQueryParams = new URLSearchParams(window.location.search);
            const currency = getQueryParams.get('account') ?? '';
            const query_param_currency = currency || sessionStorage.getItem('query_param_currency') || 'USD';

            try {
                // First, explicitly wait for TMB status to be determined
                const tmbEnabled = await isTmbEnabled();
                // Now use the result of the explicit check
                if (tmbEnabled) {
                    await onRenderTMBCheck();
                } else {
                    try {
                        await requestOidcAuthentication({
                            redirectCallbackUri: `${window.location.origin}/callback`,
                            ...(query_param_currency
                                ? {
                                      state: {
                                          account: query_param_currency,
                                      },
                                  }
                                : {}),
                        });
                    } catch (err) {
                        handleOidcAuthFailure(err);
                    }
                }
            } catch (error) {
                // eslint-disable-next-line no-console
                console.error(error);
            }
        }
    };
    return (
        <React.Fragment>
            <div className='main'>
                <div
                    className={classNames('main__container')}
                >
                    <div>
                        <Tabs active_index={active_tab} className='main__tabs' onTabItemClick={handleTabChange} top>
                            <div
                                label={
                                    <>
                                        <LabelPairedPuzzlePieceTwoCaptionBoldIcon
                                            height='24px'
                                            width='24px'
                                            fill='var(--text-general)'
                                        />
                                        <Localize i18n_default_text='Bot Builder' />
                                    </>
                                }
                                id='id-bot-builder'
                            />
                            <div
                                label={
                                    <>
                                        <LabelPairedPuzzlePieceTwoCaptionBoldIcon
                                            height='24px'
                                            width='24px'
                                            fill='var(--text-general)'
                                        />
                                        <Localize i18n_default_text='Free Bots' />
                                    </>
                                }
                                id='id-free-bots'
                            >
                                <FreeBots />
                            </div>
                            <div
                                label={
                                    <>
                                        <LabelPairedSignalCaptionRegularIcon
                                            height='24px'
                                            width='24px'
                                            fill='var(--text-general)'
                                        />
                                        <Localize i18n_default_text='Copy Trading' />
                                    </>
                                }
                                id='id-copy-trading'
                            >
                                <Suspense
                                    fallback={
                                        <ChunkLoader message={localize('Please wait, loading Copy Trading...')} />
                                    }
                                >
                                    <CopyTrading />
                                </Suspense>
                            </div>
                            <div
                                label={
                                    <>
                                        <LabelPairedPuzzlePieceTwoCaptionBoldIcon
                                            height='24px'
                                            width='24px'
                                            fill='var(--text-general)'
                                        />
                                        <Localize i18n_default_text='Smart Trader' />
                                    </>
                                }
                                id='id-smart-trader'
                            >
                                <Suspense
                                    fallback={<ChunkLoader message={localize('Please wait, loading Smart Trader...')} />}
                                >
                                    <SmartTrader />
                                </Suspense>
                            </div>
                            <div
                                label={
                                    <>
                                        <LabelPairedPuzzlePieceTwoCaptionBoldIcon
                                            height='24px'
                                            width='24px'
                                            fill='var(--text-general)'
                                        />
                                        <Localize i18n_default_text='pRO TOOL' />
                                    </>
                                }
                                id='id-pro-tool'
                            >
                                <Suspense
                                    fallback={<ChunkLoader message={localize('Please wait, loading pRO TOOL...')} />}
                                >
                                    <ProTool />
                                </Suspense>
                            </div>
                            <div
                                label={
                                    <>
                                        <LabelPairedChartLineCaptionRegularIcon
                                            height='24px'
                                            width='24px'
                                            fill='var(--text-general)'
                                        />
                                        <Localize i18n_default_text='DTrader' />
                                    </>
                                }
                                id='id-dtrader'
                            >
                                <Suspense
                                    fallback={<ChunkLoader message={localize('Please wait, loading DTrader...')} />}
                                >
                                    <Dtrader />
                                </Suspense>
                            </div>
                            <div
                                label={
                                    <>
                                        <LegacyChartsIcon height='16px' width='16px' fill='var(--text-general)' />
                                        <Localize i18n_default_text='TradingView' />
                                    </>
                                }
                                id='id-tradingview'
                            >
                                <Suspense
                                    fallback={<ChunkLoader message={localize('Please wait, loading TradingView...')} />}
                                >
                                    <TradingView />
                                </Suspense>
                            </div>
                            <div
                                label={
                                    <>
                                        <LegacyIndicatorsIcon height='16px' width='16px' fill='var(--text-general)' />
                                        <Localize i18n_default_text='Analysis Tool' />
                                    </>
                                }
                                id='id-analysis-tool'
                            >
                                <Suspense
                                    fallback={
                                        <ChunkLoader message={localize('Please wait, loading Analysis Tool...')} />
                                    }
                                >
                                    <AnalysisTool />
                                </Suspense>
                            </div>
                            <div
                                label={
                                    <>
                                        <LabelPairedSignalCaptionRegularIcon
                                            height='16px'
                                            width='16px'
                                            fill='var(--text-general)'
                                        />
                                        <Localize i18n_default_text='Signals' />
                                    </>
                                }
                                id='id-signals'
                            >
                                <Suspense
                                    fallback={<ChunkLoader message={localize('Please wait, loading Signals...')} />}
                                >
                                    <Signals />
                                </Suspense>
                            </div>
                        </Tabs>
                    </div>
                </div>
            </div>
            <DesktopWrapper>
                <div className='main__run-strategy-wrapper'>
                    <RunStrategy />
                    <RunPanel />
                </div>
                <ChartModal />
                <TradingViewModal />
            </DesktopWrapper>
            <MobileWrapper>{!is_open && <RunPanel />}</MobileWrapper>
            <Dialog
                cancel_button_text={cancel_button_text || localize('Cancel')}
                className='dc-dialog__wrapper--fixed'
                confirm_button_text={ok_button_text || localize('Ok')}
                has_close_icon
                is_mobile_full_width={false}
                is_visible={is_dialog_open}
                onCancel={onCancelButtonClick}
                onClose={onCloseDialog}
                onConfirm={onOkButtonClick || onCloseDialog}
                portal_element_id='modal_root'
                title={title}
                login={handleLoginGeneration}
                dismissable={dismissable} // Prevents closing on outside clicks
                is_closed_on_cancel={is_closed_on_cancel}
            >
                {message}
            </Dialog>
        </React.Fragment>
    );
});

export default AppWrapper;
