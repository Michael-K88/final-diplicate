import React, { useEffect, useState } from 'react';
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


const FreeBots = observer(() => {
    const { dashboard, app } = useStore();
    const { active_tab, setActiveTab, setPendingFreeBot } = dashboard;
    const [availableBots, setAvailableBots] = useState<BotData[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const getXmlFiles = () => {
        return [
            'AUTO C4 PRO Version.xml',
            'Bandwagon Entry Point Bot.xml',
            'Differs-ODD-EVEN.xml',
            'Gold Miner Pro.xml',
            'Greenprint Profit Bot.xml',
            'H L Auto Vault.xml',
            'Master AI Under 9.xml',
            'Mkorean SV4.xml',
            'Super Elite.xml',
            'Upgraded Candle Mine.xml',
            '$DollarprinterbotOrignal$.xml',
            '360 PRINTER BOT____ [ Version 2.2 ].xml',
            'Candle-Mine Version 2  (2).xml',
            'TC Bot 1.1.xml',
            'legoospeedbot.xml',
        ];
    };

    // Wait for workspace to be available
    const waitForWorkspace = (maxAttempts = 10, delay = 500) => {
        return new Promise((resolve, reject) => {
            let attempts = 0;

            const checkWorkspace = () => {
                attempts++;
                if (window.Blockly?.derivWorkspace) {
                    console.log('Workspace is ready!');
                    resolve(window.Blockly.derivWorkspace);
                } else if (attempts >= maxAttempts) {
                    reject(new Error('Workspace not available after maximum attempts'));
                } else {
                    console.log(`Waiting for workspace... attempt ${attempts}/${maxAttempts}`);
                    setTimeout(checkWorkspace, delay);
                }
            };

            checkWorkspace();
        });
    };

    // Load bot into builder
    const loadBotIntoBuilder = async (bot: BotData) => {
        try {
            if (bot.xml) {
                console.log('Loading bot:', bot.name);
                console.log('Blockly workspace available:', !!window.Blockly?.derivWorkspace);

                // Flag the selected bot for the Bot Builder to load after navigation
                setPendingFreeBot({ name: bot.name, xml: bot.xml });

                // Navigate to Bot Builder; loading will be handled when workspace is ready
                setActiveTab(DBOT_TABS.BOT_BUILDER);

                console.log('Navigating to Bot Builder to load bot:', bot.name);
            }
        } catch (error) {
            console.error('Error loading bot:', error);
        }
    };

    // Load bots with instant UI and progressive loading (no blocking spinner)
    useEffect(() => {
        const loadBots = async () => {
            if (active_tab !== DBOT_TABS.FREE_BOTS) return;

            setError(null);

            // 0) Immediately render skeleton cards from a small fallback list
            const fallback = getXmlFiles().map(file => ({ name: file.replace('.xml', ''), file }));
            const initialSkeleton: BotData[] = fallback.map(item => ({
                name: (item.name || item.file.replace('.xml', '')).replace(/[_-]/g, ' '),
                description: `Advanced trading bot: ${(item.name || item.file.replace('.xml', '')).replace(/[_-]/g, ' ')}`,
                difficulty: 'Intermediate',
                strategy: 'Multi-Strategy',
                features: DEFAULT_FEATURES,
                xml: '',
            }));
            setAvailableBots(initialSkeleton);
            setIsLoading(false); // hide "Loading free bots..." right away

            try {
                // 1) Fetch manifest with timeout; fallback to initial list if slow
                const withTimeout = <T,>(p: Promise<T>, ms = 800): Promise<T | null> =>
                    new Promise(resolve => {
                        const t = setTimeout(() => resolve(null), ms);
                        p.then(r => {
                            clearTimeout(t);
                            resolve(r);
                        }).catch(() => {
                            clearTimeout(t);
                            resolve(null);
                        });
                    });

                const manifest = (await withTimeout(getBotsManifest(), 800)) || fallback;

                // 2) If manifest differs, update skeletons to match
                const skeletonBots: BotData[] = manifest.map(item => ({
                    name: (item.name || item.file.replace('.xml', '')).replace(/[_-]/g, ' '),
                    description: `Advanced trading bot: ${(item.name || item.file.replace('.xml', '')).replace(/[_-]/g, ' ')}`,
                    difficulty: 'Intermediate',
                    strategy: 'Multi-Strategy',
                    features: DEFAULT_FEATURES,
                    xml: '',
                }));
                setAvailableBots(skeletonBots);

                // 3) Load XMLs progressively in background
                const loadedBots: BotData[] = [];
                for (let i = 0; i < manifest.length; i++) {
                    const item = manifest[i];
                    try {
                        const xml = await fetchXmlWithCache(item.file);
                        if (xml) {
                            const botName = (item.name || item.file.replace('.xml', '')).replace(/[_-]/g, ' ');
                            loadedBots.push({
                                name: botName,
                                description: `Advanced trading bot: ${botName}`,
                                difficulty: 'Intermediate',
                                strategy: 'Multi-Strategy',
                                features: DEFAULT_FEATURES,
                                xml,
                            });
                            setAvailableBots([...loadedBots, ...skeletonBots.slice(loadedBots.length)]);
                        }
                    } catch (err) {
                        console.warn(`Failed to load ${item.file}:`, err);
                    }
                }
            } catch (error) {
                console.error('Error loading bots:', error);
                setError('Failed to load bots. Please try again.');
            }
        };

        loadBots();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active_tab]);

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
                            <div key={index} className='free-bot-card'>
                                <div className='free-bot-card__header'>
                                    <Text size='s' weight='bold' className='free-bot-card__title'>
                                        {bot.name}
                                    </Text>
                                    <div className='free-bot-card__badges'>
                                        <span className='free-bot-card__badge free-bot-card__badge--difficulty'>
                                            {bot.difficulty}
                                        </span>
                                        <span className='free-bot-card__badge free-bot-card__badge--strategy'>
                                            {bot.strategy}
                                        </span>
                                    </div>
                                </div>

                                <Text size='xs' color='general' className='free-bot-card__description'>
                                    {bot.description}
                                </Text>

                                <div className='free-bot-card__features'>
                                    {bot.features.map((feature, featureIndex) => (
                                        <span key={featureIndex} className='free-bot-card__feature'>
                                            {feature}
                                        </span>
                                    ))}
                                </div>

                                <Button
                                    className='free-bot-card__load-btn'
                                    onClick={() => loadBotIntoBuilder(bot)}
                                    primary
                                    has_effect
                                    type='button'
                                    disabled={!bot.xml} // Disable if XML not loaded yet
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
