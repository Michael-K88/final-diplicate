type TTabsTitle = {
    [key: string]: string | number;
};

type TDashboardTabIndex = {
    [key: string]: number;
};

export const tabs_title: TTabsTitle = Object.freeze({
    WORKSPACE: 'Workspace',
    CHART: 'Chart',
});

export const DBOT_TABS: TDashboardTabIndex = Object.freeze({
    DASHBOARD: 999,
    BOT_BUILDER: 0,
    CHART: 998,
    FREE_BOTS: 1,
    COPY_TRADING: 2,
    SMART_TRADER: 3,
    DTRADER: 4,
    TUTORIAL: 997,
});

export const MAX_STRATEGIES = 10;

export const TAB_IDS = [
    'id-bot-builder',
    'id-free-bots',
    'id-copy-trading',
    'id-smart-trader',
    'id-dtrader',
];

export const DEBOUNCE_INTERVAL_TIME = 500;
