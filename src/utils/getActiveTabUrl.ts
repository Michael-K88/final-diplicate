export const getActiveTabUrl = () => {
    const current_tab_number = localStorage.getItem('active_tab');
    const TAB_NAMES = ['bot_builder', 'free_bots', 'smart_trader', 'dtrader'] as const;
    const index = Number(current_tab_number);
    const current_tab_name = index >= 0 && index < TAB_NAMES.length ? TAB_NAMES[index] : TAB_NAMES[0];

    const current_url = window.location.href.split('#')[0];
    const active_tab_url = `${current_url}#${current_tab_name}`;
    return active_tab_url;
};
