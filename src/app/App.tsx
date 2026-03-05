import { initSurvicate } from '../public-path';
import { lazy, Suspense } from 'react';
import React from 'react';
import { createBrowserRouter, createRoutesFromElements, Route, RouterProvider } from 'react-router-dom';
import AppLoaderWrapper from '@/components/app-loader/app-loader-wrapper';
import { getLoaderDuration, isLoaderEnabled } from '@/components/app-loader/loader-config';
import ChunkLoader from '@/components/loader/chunk-loader';
import RoutePromptDialog from '@/components/route-prompt-dialog';
import { getBotsManifest, prefetchAllXmlInBackground } from '@/utils/freebots-cache';
import { crypto_currencies_display_order, fiat_currencies_display_order } from '@/components/shared';
import { StoreProvider } from '@/hooks/useStore';
import CallbackPage from '@/pages/callback';
import Endpoint from '@/pages/endpoint';
import { TAuthData } from '@/types/api-types';
import { initializeI18n, localize, TranslationProvider } from '@deriv-com/translations';
import CoreStoreProvider from './CoreStoreProvider';
import './app-root.scss';

const Layout = lazy(() => import('../components/layout'));
const AppRoot = lazy(() => import('./app-root'));

const { TRANSLATIONS_CDN_URL, R2_PROJECT_NAME, CROWDIN_BRANCH_NAME } = process.env;
const i18nInstance = initializeI18n({
    cdnUrl: `${TRANSLATIONS_CDN_URL}/${R2_PROJECT_NAME}/${CROWDIN_BRANCH_NAME}`,
});

const router = createBrowserRouter(
    createRoutesFromElements(
        <Route
            path='/'
            element={
                <Suspense
                    fallback={<ChunkLoader message={localize('Please wait while we connect to the server...')} />}
                >
                    <TranslationProvider defaultLang='EN' i18nInstance={i18nInstance}>
                        <StoreProvider>
                            <RoutePromptDialog />
                            <CoreStoreProvider>
                                <Layout />
                            </CoreStoreProvider>
                        </StoreProvider>
                    </TranslationProvider>
                </Suspense>
            }
            errorElement={
                <div style={{ padding: '20px', textAlign: 'center' }}>
                    <h1>🚨 Application Error</h1>
                    <p>Something went wrong. Please check the console for more details.</p>
                    <button onClick={() => window.location.reload()}>Reload Page</button>
                </div>
            }
        >
            {/* All child routes will be passed as children to Layout */}
            <Route index element={<AppRoot />} />
            <Route path='endpoint' element={<Endpoint />} />
            <Route path='callback' element={<CallbackPage />} />
            {/* Catch-all route for debugging */}
            <Route
                path='*'
                element={
                    <div style={{ padding: '20px', textAlign: 'center' }}>
                        <h1>🔍 Route Debug Info</h1>
                        <p>Current URL: {window.location.href}</p>
                        <p>Pathname: {window.location.pathname}</p>
                        <p>Available routes: /, /endpoint, /callback</p>
                        <button onClick={() => (window.location.href = '/')}>Go to Home</button>
                    </div>
                }
            />
        </Route>
    )
);

function App() {
    React.useEffect(() => {
        // Use the invalid token handler hook to automatically retrigger OIDC authentication
        // when an invalid token is detected and the cookie logged state is true

        initSurvicate();
        window?.dataLayer?.push({ event: 'page_load' });

        // Prefetch Free Bots XMLs on startup for instant availability
        // Skip prefetch on very slow connections (2G)
        const shouldPrefetch = !(navigator as any)?.connection || (navigator as any).connection?.effectiveType !== '2g';
        if (shouldPrefetch) {
            setTimeout(async () => {
                try {
                    const manifest = (await getBotsManifest()) || [];
                    if (manifest.length) {
                        prefetchAllXmlInBackground(manifest.map(m => m.file));
                    }
                } catch (e) {
                    console.warn('Prefetch Free Bots failed', e);
                }
            }, 0);
        }

        return () => {
            // Clean up the invalid token handler when the component unmounts
            const survicate_box = document.getElementById('survicate-box');
            if (survicate_box) {
                survicate_box.style.display = 'none';
            }
        };
    }, []);

    React.useEffect(() => {
        const accounts_list = localStorage.getItem('accountsList');
        const client_accounts = localStorage.getItem('clientAccounts');
        const url_params = new URLSearchParams(window.location.search);
        const account_currency = url_params.get('account');
        const validCurrencies = [...fiat_currencies_display_order, ...crypto_currencies_display_order];

        const is_valid_currency = account_currency && validCurrencies.includes(account_currency?.toUpperCase());

        if (!accounts_list || !client_accounts) return;

        try {
            const parsed_accounts = JSON.parse(accounts_list);
            const parsed_client_accounts = JSON.parse(client_accounts) as TAuthData['account_list'];

            const updateLocalStorage = (token: string, loginid: string) => {
                localStorage.setItem('authToken', token);
                localStorage.setItem('active_loginid', loginid);
            };

            // Handle demo account
            if (account_currency?.toUpperCase() === 'DEMO') {
                const demo_account = Object.entries(parsed_accounts).find(([key]) => key.startsWith('VR'));

                if (demo_account) {
                    const [loginid, token] = demo_account;
                    updateLocalStorage(String(token), loginid);
                    return;
                }
            }

            // Handle real account with valid currency
            if (account_currency?.toUpperCase() !== 'DEMO' && is_valid_currency) {
                const real_account = Object.entries(parsed_client_accounts).find(
                    ([loginid, account]) =>
                        !loginid.startsWith('VR') && account.currency.toUpperCase() === account_currency?.toUpperCase()
                );

                if (real_account) {
                    const [loginid, account] = real_account;
                    if ('token' in account) {
                        updateLocalStorage(String(account?.token), loginid);
                    }
                    return;
                }
            }
        } catch (e) {
            console.warn('Error', e); // eslint-disable-line no-console
        }
    }, []);

    return (
        <AppLoaderWrapper duration={getLoaderDuration()} enabled={isLoaderEnabled()}>
            <RouterProvider router={router} />
        </AppLoaderWrapper>
    );
}

export default App;
