import React, { useEffect, useState, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import Button from '@/components/shared_ui/button';
import Text from '@/components/shared_ui/text';
import { DBOT_TABS } from '@/constants/bot-contents';
import { useStore } from '@/hooks/useStore';
import { localize } from '@deriv-com/translations';
import { getBotsManifest, prefetchAllXmlInBackground, fetchXmlWithCache } from '@/utils/freebots-cache';
import './free-bots.scss';

interface BotData {
    name: string;
    description: string;
    difficulty: string;
    strategy: string;
    features: string[];
    xml: string;
}

const DEFAULT_FEATURES = ['Automated Trading', 'Risk Management', 'Profit Optimization'];

const FALLBACK_FILES = [
    'Gold Miner Pro.xml',
    'Bandwagon Entry Point Bot.xml',
    'Upgraded Candle Mine.xml',
    'Super Elite.xml',
    'Greenprint Profit Bot.xml',
    'AUTO C4 PRO Version.xml',
    'H L Auto Vault.xml',
    'Master AI Under 9.xml',
    'Mkorean SV4.xml',
    '$DollarprinterbotOrignal$.xml',
    '360 PRINTER BOT____ [ Version 2.2 ].xml',
    'Candle-Mine Version 2  (2).xml',
    'TC Bot 1.1.xml',
];

const makeBotData = (name: string, xml = ''): BotData => ({
    name: name.replace(/[_-]/g, ' '),
    description: `Advanced trading bot: ${name.replace(/[_-]/g, ' ')}`,
    difficulty: 'Intermediate',
    strategy: 'Multi-Strategy',
    features: DEFAULT_FEATURES,
    xml,
});

const FreeBots = observer(() => {
    const { dashboard } = useStore();
    const { active_tab, setActiveTab, setPendingFreeBot } = dashboard;
    const [availableBots, setAvailableBots] = useState<BotData[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const loadedRef = useRef(false);

    const loadBotIntoBuilder = async (bot: BotData) => {
        try {
            if (bot.xml) {
                setPendingFreeBot({ name: bot.name, xml: bot.xml });
                setActiveTab(DBOT_TABS.BOT_BUILDER);
            }
        } catch (err) {
            console.error('Error loading bot:', err);
        }
    };

    useEffect(() => {
        if (active_tab !== DBOT_TABS.FREE_BOTS) return;
        if (loadedRef.current) return;

        const loadBots = async () => {
            setError(null);

            const fallback = FALLBACK_FILES.map(f => ({ name: f.replace('.xml', ''), file: f }));
            const skeletons = fallback.map(item => makeBotData(item.name));
            setAvailableBots(skeletons);
            setIsLoading(false);

            try {
                const manifestPromise = getBotsManifest();
                const timeoutPromise = new Promise<null>(r => setTimeout(() => r(null), 600));
                const manifest = (await Promise.race([manifestPromise, timeoutPromise])) || fallback;

                const files = manifest.map(m => m.file);
                const names = manifest.map(m => (m.name || m.file.replace('.xml', '')));

                if (JSON.stringify(files) !== JSON.stringify(FALLBACK_FILES)) {
                    setAvailableBots(names.map(n => makeBotData(n)));
                }

                const results = await Promise.allSettled(files.map(f => fetchXmlWithCache(f)));

                const bots: BotData[] = results.map((result, i) => {
                    const xml = result.status === 'fulfilled' ? result.value : null;
                    return makeBotData(names[i], xml || '');
                });

                setAvailableBots(bots);
                loadedRef.current = true;
            } catch (err) {
                console.error('Error loading bots:', err);
                setError('Failed to load bots. Please try again.');
            }
        };

        loadBots();
    }, [active_tab]);

    useEffect(() => {
        prefetchAllXmlInBackground(FALLBACK_FILES);
    }, []);

    return (
        <div className='free-bots'>
            <div className='free-bots__container'>
                {isLoading ? (
                    <div className='free-bots__loading'>
                        <Text size='s' color='general'>
                            {localize('Loading free bots...')}
                        </Text>
                    </div>
                ) : error ? (
                    <div className='free-bots__error'>
                        <Text size='s' color='general'>
                            {error}
                        </Text>
                        <div style={{ marginTop: '20px' }}>
                            <Button onClick={() => window.location.reload()}>{localize('Retry')}</Button>
                        </div>
                    </div>
                ) : availableBots.length === 0 ? (
                    <div className='free-bots__empty'>
                        <Text size='s' color='general'>
                            {localize('No bots available at the moment.')}
                        </Text>
                    </div>
                ) : (
                    <div className='free-bots__grid'>
                        {availableBots.map((bot, index) => (
                            <div key={bot.name || index} className='free-bot-card'>
                                <div className='free-bot-card__number'>#{index + 1}</div>
                                <div className='free-bot-card__title'>{bot.name}</div>
                                <div className='free-bot-card__subtitle'>Free and customizable bots</div>
                                <Button
                                    className='free-bot-card__load-btn'
                                    onClick={() => loadBotIntoBuilder(bot)}
                                    primary
                                    has_effect
                                    type='button'
                                    disabled={!bot.xml}
                                >
                                    {bot.xml ? localize('Load Bot') : localize('Loading...')}
                                </Button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
});

export default FreeBots;
