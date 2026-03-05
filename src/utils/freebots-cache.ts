import localforage from 'localforage';
import LZString from 'lz-string';

export type TBotsManifestItem = {
    name: string;
    file: string;
    description?: string;
    difficulty?: string;
    strategy?: string;
    features?: string[];
};

const XML_CACHE_PREFIX = 'freebots:xml:';

const memoryCache = new Map<string, string>();
const inflightRequests = new Map<string, Promise<string | null>>();

let XML_BASE = '/xml/';
export const getXmlBase = () => XML_BASE;
const setXmlBase = (base: string) => {
    XML_BASE = base.endsWith('/') ? base : `${base}/`;
};

const decompress = (data: string | null) => (data ? LZString.decompressFromUTF16(data) : null);
const compress = (data: string) => LZString.compressToUTF16(data);

export const getCachedXml = async (file: string): Promise<string | null> => {
    try {
        const key = `${XML_CACHE_PREFIX}${file}`;
        const cached = (await localforage.getItem<string>(key)) || null;
        return decompress(cached);
    } catch {
        return null;
    }
};

export const setCachedXml = async (file: string, xml: string) => {
    try {
        const key = `${XML_CACHE_PREFIX}${file}`;
        await localforage.setItem(key, compress(xml));
    } catch {}
};

export const fetchXmlWithCache = async (file: string): Promise<string | null> => {
    if (memoryCache.has(file)) {
        return memoryCache.get(file)!;
    }

    if (inflightRequests.has(file)) {
        return inflightRequests.get(file)!;
    }

    const doFetch = async (): Promise<string | null> => {
        const cached = await getCachedXml(file);
        if (cached) {
            memoryCache.set(file, cached);
            return cached;
        }

        try {
            const url = `${getXmlBase()}${encodeURIComponent(file)}`;
            const res = await fetch(url, { cache: 'force-cache' });

            if (!res.ok && getXmlBase() !== '/xml/') {
                const fallbackRes = await fetch(`/xml/${encodeURIComponent(file)}`, { cache: 'force-cache' });
                if (!fallbackRes.ok) throw new Error(`${file}: ${fallbackRes.status}`);
                const xml = await fallbackRes.text();
                memoryCache.set(file, xml);
                setCachedXml(file, xml);
                return xml;
            }

            if (!res.ok) throw new Error(`${file}: ${res.status}`);
            const xml = await res.text();
            memoryCache.set(file, xml);
            setCachedXml(file, xml);
            return xml;
        } catch {
            return null;
        }
    };

    const promise = doFetch().finally(() => inflightRequests.delete(file));
    inflightRequests.set(file, promise);
    return promise;
};

export const prefetchAllXmlInBackground = async (files: string[]) => {
    await Promise.allSettled(files.map(file => fetchXmlWithCache(file)));
};

let manifestCache: TBotsManifestItem[] | null = null;

export const getBotsManifest = async (): Promise<TBotsManifestItem[] | null> => {
    if (manifestCache) return manifestCache;

    try {
        const res = await fetch('/xml/bots.json', { cache: 'force-cache' });
        if (!res.ok) return null;
        const data = (await res.json()) as TBotsManifestItem[];
        manifestCache = data;
        setXmlBase('/xml/');
        return data;
    } catch {
        return null;
    }
};
