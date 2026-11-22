(() => {
    'use strict';

    const script = document.currentScript;
    const endpoint = new URL(script.dataset.endpoint || '/_browser-event', location.href);
    if (endpoint.origin !== location.origin || window.browserDomainLogInstalled) return;
    window.browserDomainLogInstalled = true;

    const bytes = crypto.getRandomValues(new Uint8Array(16));
    const visit = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    const resources = new Set();

    function httpHost(value) {
        if (typeof value !== 'string' || !value) return '';
        try {
            const url = new URL(value, document.baseURI);
            return /^https?:$/.test(url.protocol) ? url.hostname : '';
        } catch {
            return '';
        }
    }

    function report(event, host, kind) {
        const url = new URL(endpoint);
        url.search = new URLSearchParams({
            visit, ms: Math.round(performance.now()), event, host, kind
        });
        try {
            if (navigator.sendBeacon(url)) return;
        } catch {
            // Some browsers or page policies disallow beacons.
        }
        fetch(url, {method: 'POST', keepalive: true}).catch(() => {});
    }

    function recordResources(entries) {
        for (const entry of entries) {
            const host = httpHost(entry.name);
            if (!host || host === location.hostname) continue;
            const kind = entry.initiatorType || 'other';
            const key = kind + '/' + host;
            if (resources.has(key)) continue;
            resources.add(key);
            report('resource', host, kind);
        }
    }

    let firstClick = true;
    function recordClick(event) {
        if (!event.isTrusted || (event.type === 'auxclick' && event.button !== 1)) return;
        const anchor = event.composedPath().find(node =>
            node.matches && node.matches('a[href], area[href]'));
        const host = anchor ? httpHost(anchor.getAttribute('href')) : '';
        if (firstClick || (host && host !== location.hostname)) {
            report(firstClick ? 'first_click' : 'external_click', host, anchor ? 'link' : 'other');
        }
        firstClick = false;
    }
    window.addEventListener('click', recordClick, true);
    window.addEventListener('auxclick', recordClick, true);

    if (window.navigation) {
        window.navigation.addEventListener('navigate', event => {
            const host = httpHost(event.destination.url);
            if (host && host !== location.hostname) report('navigate', host, 'destination');
        });
    }

    const originalOpen = window.open;
    window.open = function (...args) {
        const result = Reflect.apply(originalOpen, this, args);
        const host = httpHost(args[0]);
        if (host && host !== location.hostname) report('window_open', host, 'attempt');
        return result;
    };

    if (window.PerformanceObserver) {
        const observer = new PerformanceObserver(list => recordResources(list.getEntries()));
        observer.observe({entryTypes: ['resource']});
    }
    recordResources(performance.getEntriesByType('resource'));
})();
